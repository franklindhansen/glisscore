// Export from the disk store (?disk=1), set against the same recording held in memory: the files must be the same bytes.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-export-disk.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async disk => {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(20000);
    p.errs = []; p.on('pageerror', e => p.errs.push('PAGEERR ' + (e.stack || e).toString().slice(0, 300))); p.on('console', m => { if (m.type() === 'error') p.errs.push('CONSOLE ' + m.text().slice(0, 300)); });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk);
    await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio, null, { timeout: 30000 });
    await p.waitForFunction(() => S.audio.buffer ? (tpGet(S.audio.buffer, S.audio.peaks), TPK.get(S.audio.buffer).tp) : S.audio.tp, null, { timeout: 30000 }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, type: blob.type, size: ab.length, b64: btoa(s) }; }; });
    return p;
  };
  const run = async (p, draft, format, rate) => {
    await p.evaluate(({ draft, format, rate }) => { window.__saved = null; Object.assign(AE.d, { normalize: false, limiter: false, gainDb: 0, vStart: 0, vEndSet: null }, draft); S.set.audioFormat = format; S.set.audioRate = rate || 0; aeRefresh(); }, { draft, format, rate });
    for (let i = 0; i < 80; i++) { const r = await p.evaluate(() => { const d = AE.d, i = aeLoudInfo(d); return { fx: fxActive(d.fx, fxChannels()).length ? !!fxPeek(d.fx) : true, loud: !d.normalize || d.normBy !== 'loud' || (i && i.ready) }; }); if (r.fx && r.loud) break; await p.waitForTimeout(250); }
    await p.evaluate(() => aeExport()); for (let i = 0; i < 120; i++) { if (await p.evaluate(() => !!window.__saved)) break; await p.waitForTimeout(250); }
    return p.evaluate(() => window.__saved);
  };
  const m = await open(0), d = await open(1);
  ok('the recording is on the store', await d.evaluate(() => !!S.audio.disk && !S.audio.buffer));
  const scen = [
    ['WAV 24-bit, whole', {}, 'wav24'], ['WAV 16-bit, trimmed with fades', { vStart: 0.4, vEndSet: 3.9 }, 'wav'], ['WAV 32-bit float', { gainDb: 3 }, 'wav32'],
    ['WAV, peak −3dB', { normalize: true, normBy: 'peak', normPeakDb: -3 }, 'wav24'], ['WAV, loudness −14 with the limiter', { normalize: true, normBy: 'loud', normLufs: -14, limiter: true }, 'wav24'],
    ['WAV at 44.1kHz', { vStart: 0.2, vEndSet: 4.5 }, 'wav24', 44100], ['WAV at 96kHz with the limiter', { normalize: true, normBy: 'loud', normLufs: -16, limiter: true }, 'wav24', 96000],
    ['FLAC 24-bit', { vStart: 0.1 }, 'flac24'], ['FLAC 16-bit at 44.1kHz', {}, 'flac16', 44100]
  ];
  for (const [name, dd, fmt, rate] of scen) {
    const a = await run(m, dd, fmt, rate), c = await run(d, dd, fmt, rate);
    if (/16-bit/.test(name)) {          // 16-bit gets random dither, so two files differ by a bit or two; every sample must be within 2 steps
      let worst = 0; if (a && c && a.size === c.size && fmt === 'wav') { const x = Buffer.from(a.b64, 'base64'), y = Buffer.from(c.b64, 'base64'); for (let i = 44; i + 1 < x.length; i += 2) worst = Math.max(worst, Math.abs(x.readInt16LE(i) - y.readInt16LE(i))); }
      ok(name + ': the same file within the dither', !!a && !!c && a.name === c.name && (fmt === 'wav' ? a.size === c.size && worst <= 2 && a.b64.slice(0, 60) === c.b64.slice(0, 60) : Math.abs(a.size - c.size) < a.size * 0.02), a && c ? a.size + ' / ' + c.size + ' bytes, worst ' + worst : 'no file'); continue;
    }
    ok(name + ': the same file', !!a && !!c && a.name === c.name && a.size === c.size && a.b64 === c.b64, a && c ? a.size + ' / ' + c.size + ' bytes' : 'no file');
  }
  // an EQ band: the file follows the processed sound within the filters' own rounding
  for (const p of [m, d]) await p.evaluate(() => aeFx(fx => { fx.eq.bands = [{ type: 'peaking', f: 800, g: 5, q: 1, on: true }]; fx.eq.on = true; }));
  { const a = await run(m, {}, 'wav24'), c = await run(d, {}, 'wav24');
    const bytes = s => Uint8Array.from(Buffer.from(s, 'base64')), x = bytes(a.b64), y = bytes(c.b64); let worst = 0, n = 0;
    for (let i = 44; i + 2 < x.length; i += 3) { const v = k => { let q = k[i] | (k[i + 1] << 8) | (k[i + 2] << 16); return (q << 8 >> 8) / 8388608; }; worst = Math.max(worst, Math.abs(v(x) - v(y))); n++; }
    ok('with an EQ band: within the filters’ rounding', a.size === c.size && worst < 3e-4, a.size + ' bytes, worst ' + worst.toExponential(2)); }
  // two exports one after the other (each has a file of its own), and Stop export
  { const a = await run(d, {}, 'wav24'), c = await run(d, {}, 'flac24'); const names = await d.evaluate(async () => { const t = DISK.meta.token, dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('kf-audio')).getDirectoryHandle(t), out = []; for await (const n of dir.keys()) if (/^export/.test(n)) out.push(n); return out; });
    ok('a WAV then a FLAC straight after: both files made', !!a && !!c && /wav$/.test(a.name) && /flac$/.test(c.name), names.join(', '));
    const held = await d.evaluate(async () => { const keep = []; const old = window.saveFile; window.saveFile = async (blob, name) => { keep.push({ blob, name }); }; for (const f of ['wav24', 'flac24']) { S.set.audioFormat = f; await aeExport(); } window.saveFile = old; const out = []; for (const k of keep) { try { out.push((await k.blob.arrayBuffer()).byteLength === k.blob.size); } catch (e) { out.push(false); } } return out; });
    ok('the WAV is still whole after a FLAC was exported straight after it (its file is not reused)', held.length === 2 && held.every(Boolean), JSON.stringify(held));
    await d.evaluate(() => { window.__saved = null; S.set.audioFormat = 'flac24'; window.__p = aeExport(); AE.expStop = true; }); await d.evaluate(() => window.__p);
    const r = await d.evaluate(() => ({ saved: !!window.__saved, stop: document.querySelector('#aeExpStop').hidden, btn: document.querySelector('#aeExport span').textContent, dis: document.querySelector('#aeExport').disabled, toast: (document.querySelector('.toast') || {}).textContent }));
    ok('Stop export: no file, the button is back, the stop button is gone', !r.saved && r.stop && r.btn === 'Export audio' && !r.dis && /stopped/.test(r.toast), JSON.stringify(r));
    const e = await run(d, {}, 'wav24'); ok('an export works after a stopped one', !!e && e.size > 1e6); }
  // old export files are cleared when the recording is opened again (a new visit)
  { const left = p => p.evaluate(async () => { const t = DISK.meta.token, dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('kf-audio')).getDirectoryHandle(t), out = []; for await (const n of dir.keys()) if (/^export/.test(n)) out.push(n); return out.length; });
    const before = await left(d); const q = await b.newPage(); q.setDefaultTimeout(30000); await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1'); await q.setInputFiles('#audioIn', FX + '/s24.wav'); await q.waitForFunction(() => S.audio && S.audio.disk); await q.waitForTimeout(500);
    const after = await left(q); ok('export files are cleared when the recording is opened again', before > 0 && after === 0, before + ' before, ' + after + ' after'); await q.close(); }
  // the RF64 header (a file over 4GB cannot be made here): read back what wavHead writes
  { const r = await d.evaluate(() => { const total = 3e9, h = new DataView(wavHead(24, 2, 48000, total, 10, true)), tag = o => String.fromCharCode(h.getUint8(o), h.getUint8(o + 1), h.getUint8(o + 2), h.getUint8(o + 3)), u64 = o => h.getUint32(o, true) + h.getUint32(o + 4, true) * 4294967296;
      return { len: h.byteLength, riff: tag(0), size: h.getUint32(4, true), wave: tag(8), ds64: tag(12), riffSize: u64(20), dataSize: u64(28), samples: u64(36), fmt: tag(48), data: tag(72), dsz: h.getUint32(76, true), want: total * 6 }; });
    ok('RF64 header', r.len === 80 && r.riff === 'RF64' && r.size === 0xffffffff && r.wave === 'WAVE' && r.ds64 === 'ds64' && r.dataSize === r.want && r.riffSize === 80 + r.want - 8 + 10 && r.samples === 3e9 && r.fmt === 'fmt ' && r.data === 'data' && r.dsz === 0xffffffff, JSON.stringify(r)); }
  ok('no errors', m.errs.length === 0 && d.errs.length === 0, m.errs.concat(d.errs).join(' | '));
  await b.close();
})();
