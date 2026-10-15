/* Disk store check, run in Chromium: every kind of WAV the store reads by hand goes through tests/long-file-store.html with small pieces (so reads cross many piece edges),
   and must come back sample for sample the same as today's import. M4A cannot be checked here (this Chromium has no AAC): open the page in Safari for that. */
const { chromium } = require('playwright-core');
const F = require('path').resolve(process.env.S);
const results = [];
const ok = (name, pass, info = '') => { results.push((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 900, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const open = async () => { await p.goto('http://localhost:8123/tests/long-file-store.html?piece=10007'); await p.waitForFunction(() => window.ready, null, { timeout: 30000 }); };
  const run = async file => {
    const from = await p.evaluate(() => window.results.length), n = await p.evaluate(() => window.done);
    await p.setInputFiles('#file', F + '/' + file); await p.waitForFunction(k => window.done > k, n, { timeout: 120000 });
    const rows = (await p.evaluate(() => window.results)).slice(from), get = name => (rows.find(r => r.name === name) || { value: '(missing)', state: 'bad' });
    return { rows, get, bad: rows.filter(r => r.state === 'bad') };
  };
  await open();
  const prints = {};
  for (const [file, want] of [['stereo.wav', '16-bit'], ['mono.wav', 'mono'], ['u8.wav', '8-bit'], ['s24.wav', '24-bit'], ['s32.wav', '32-bit'], ['f64.wav', '64-bit float'], ['f32over.wav', '32-bit float'], ['surround.wav', '6 channels folded']]) {
    const r = await run(file), same = r.get('Compared with today\'s import'), wave = r.get('Waveform against today\'s');
    prints[file] = r.get('Fingerprint').value;
    ok(file + ': read in as ' + want, r.get('Read into the store').value.includes(want), r.get('Read into the store').value);
    ok(file + ': peaks and pyramid match the samples', ['Waveform peaks (100 per second)', 'Pyramid, 64 frames', 'Pyramid, 512 frames', 'Pyramid, 4096 frames', 'Read back', 'Read one second, 200 places', 'Playback joins'].every(k => r.get(k).state === 'ok'), r.bad.map(x => x.name + ': ' + x.value).join(' | '));
    ok(file + ': same as today\'s import, sample for sample', same.state === 'ok' && wave.state === 'ok', same.value + ' / ' + wave.value);
    const tl = r.rows.filter(x => /^Tools|^Loudness|(Spectra|Imager|EQ) against today's$/.test(x.name)), vs = tl.filter(x => / against today's$/.test(x.name)), whole = same.value === 'Every sample the same';          // the tools are set against today's only where the import itself is the same to the last sample
    ok(file + ': tools on the store, read in stretches' + (whole ? ' and against today\'s' : ''), ['Tools, read in stretches', 'Tools, whole recording', 'Loudness of the kept part'].every(k => r.get(k).state === 'ok') && tl.every(x => x.state !== 'bad') && vs.length === (whole ? 2 : 0), tl.map(x => x.name + ': ' + x.value).join(' | '));
    if (file === 'f32over.wav') ok('f32over.wav: peaks above full scale are kept', r.get('Highest sample').value.includes('above full scale'), r.get('Highest sample').value);
  }
  for (const file of ['rf64.wav', 'size0.wav', 'sizeff.wav']) {
    const r = await run(file);
    ok(file + ': the same sound as stereo.wav', r.get('Fingerprint').value === prints['stereo.wav'] && !r.bad.length, r.get('Fingerprint').value + ' vs ' + prints['stereo.wav'] + ' ' + r.bad.map(x => x.name + ': ' + x.value).join(' | '));
  }
  // 16-bit by the book: every stored sample is the file's whole number divided by 32768
  await run('stereo.wav');
  const exact = await p.evaluate(async () => {
    const ab = await (await fetch('fixtures/stereo.wav')).arrayBuffer(), pcm = new Int16Array(ab, 44), D = document.getElementById('app').contentWindow.__keyframes.DISK, r = await D.read(0, pcm.length / 2);
    let bad = 0; for (let i = 0; i < pcm.length / 2; i++) if (r.chans[0][i] !== Math.fround(pcm[i * 2] / 32768) || r.chans[1][i] !== Math.fround(pcm[i * 2 + 1] / 32768)) bad++;
    return { n: r.chans[0].length, bad };
  });
  ok('16-bit samples are stored as value / 32768, exactly', exact.n === 176400 && exact.bad === 0, JSON.stringify(exact));
  // M4A: this Chromium has no AAC decoder, so the decoder is stood in for by one that hands over known samples in uneven bits. What is checked is the path from decoder to disk:
  // blocks, left and right in order, the wait for the disk, and a file that ends short keeping its stated length.
  const m4a = await p.evaluate(async () => {
    const W = document.getElementById('app').contentWindow, D = W.__keyframes.DISK, real = W.eval('mp4DecodeAac'), N = 300000, MADE = 290000, val = (i, c) => Math.fround(Math.sin(i * 0.001 + c) * 1.2);
    W.eval('mp4DecodeAac = async (ab, onProgress, sink) => { const info = { ch: 2, sr: 44100, length: ' + N + ' }; if (!(await sink.begin(info))) return null; let at = 0, k = 0; while (at < ' + MADE + ') { const n = Math.min(' + MADE + ' - at, 700 + (k * 131) % 900), pad = k % 3, pl = [new Float32Array(n + pad), new Float32Array(n + pad)]; for (let i = 0; i < n; i++) { pl[0][pad + i] = Math.fround(Math.sin((at + i) * 0.001) * 1.2); pl[1][pad + i] = Math.fround(Math.sin((at + i) * 0.001 + 1) * 1.2); } sink.push(pl, pad, pad + n); at += n; if (++k % 16 === 0) await sink.drain(); } return info; }');
    let m, bad = 0, err = '';
    try { m = await D.importFile(new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0])], 'stand-in.m4a'), { piece: 10007 }); const r = await D.read(0, N); for (let i = 0; i < N; i++) for (let c = 0; c < 2; c++) if (r.chans[c][i] !== (i < MADE ? val(i, c) : 0)) bad++; }
    catch (e) { err = String(e && e.message || e); }
    W.mp4DecodeAac = real; W.eval('mp4DecodeAac = window.mp4DecodeAac');
    return { err, bad, frames: m && m.frames, sr: m && m.sr, ch: m && m.ch, peak: m && m.peak, n: m && m.peaks.length };
  });
  ok('M4A path: decoder output reaches the disk in order, short end padded to the stated length', !m4a.err && m4a.bad === 0 && m4a.frames === 300000 && m4a.sr === 44100 && m4a.ch === 2 && m4a.peak > 1.19 && m4a.n === Math.ceil(300000 / 441), JSON.stringify(m4a));
  const mp3 = await run('loud.mp3');
  ok('MP3 is left to today\'s import', mp3.get('Read into the store').value.startsWith('Not this way'), mp3.get('Read into the store').value);

  // the store outlives the page: after a reload the same file is found again, and Delete frees it
  await run('s24.wav'); await open();
  const again = await run('s24.wav');
  ok('stored recording is found after a reload', again.get('Kept from an earlier visit').value.startsWith('Yes'), again.get('Kept from an earlier visit').value);
  const other = await run('mono.wav');
  ok('a different file is not mistaken for the stored one', other.get('Kept from an earlier visit').value === 'No');
  await p.click('#bClear'); await p.waitForFunction(() => window.results.some(r => r.name === 'Deleted'));
  const gone = await run('mono.wav');
  ok('nothing is kept after Delete', gone.get('Kept from an earlier visit').value === 'No');
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await b.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})().catch(e => { console.log('TEST CRASH', e.message); process.exit(1); });
