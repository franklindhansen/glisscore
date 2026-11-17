// Ogg files (Opus and Vorbis) go to the disk store, decoded by the browser's own decoder: the length must be the one ffmpeg decodes and the sound must be the same within what two decoders differ by (for Vorbis, the same as the browser's one-shot decoder gives). Needs ffmpeg.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/ogg-disk.js
const { chromium } = require('playwright-core'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfogg-')), sh = c => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const src = `aevalsrc='0.35*sin(2*PI*220*t)+0.2*sin(2*PI*1330*t)*sin(2*PI*0.5*t)+0.05*(random(0)-0.5)|0.3*sin(2*PI*331*t)+0.1*(random(1)-0.5)':d=13.37:s=48000`;
const cases = [
  ['Opus stereo 128k', 'a.opus', `-c:a libopus -b:a 128k`, 48000],
  ['Opus stereo 32k', 'b.opus', `-c:a libopus -b:a 32k`, 48000],
  ['Opus mono', 'c.opus', `-af "pan=mono|c0=c0" -c:a libopus -b:a 64k`, 48000],
  ['Opus in .ogg, 20ms frames', 'd.ogg', `-c:a libopus -b:a 96k -frame_duration 20`, 48000],
  ['Opus 60ms frames', 'e.opus', `-c:a libopus -b:a 96k -frame_duration 60`, 48000],
  ['Vorbis stereo', 'f.ogg', `-c:a vorbis -strict -2 -b:a 160k`, 48000],
  ['Vorbis 44.1kHz', 'h.ogg', `-af aresample=44100 -c:a vorbis -strict -2 -b:a 160k`, 44100]
];
(async () => {
  const br = await chromium.launch(); const p = await br.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1');
  for (const [name, nm, args, rate] of cases) {
    const f = path.join(tmp, nm), raw = path.join(tmp, 't.raw'); sh(`ffmpeg -v error -y -f lavfi -i "${src}" ${args} ${f}`); sh(`ffmpeg -v error -y -i ${f} -f f32le -c:a pcm_f32le ${raw}`);
    const info = JSON.parse(sh(`ffprobe -v error -show_entries stream=sample_rate,channels -of json ${f}`)).streams[0], buf = fs.readFileSync(raw), ref = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    // ffmpeg's own Vorbis decoder reads the second channel of a file from its own (experimental) encoder differently from the reference decoder (libvorbis, as Firefox and Chrome decode it), so for Vorbis the sound is checked against the browser's one-shot decoder, trimmed to the length ffmpeg gives
    if (name.startsWith('Vorbis')) { const one = await p.evaluate(async ([b64, sr, ch]) => { const ab = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer, b = await new OfflineAudioContext(ch, sr, sr).decodeAudioData(ab); return Array.from({ length: ch }, (_, c) => Array.from(b.getChannelData(c))); }, [fs.readFileSync(f).toString('base64'), +info.sample_rate, +info.channels]); for (let i = 0; i < ref.length; i++) ref[i] = one[i % info.channels][Math.floor(i / info.channels)] || 0; }
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(x => S.audio && S.audio.name === x && !document.querySelector('#chips .busybar'), nm, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(300);
    const got = await p.evaluate(async () => { if (!S.audio || !S.audio.disk) return { disk: false }; const m = DISK.meta, r = await DISK.read(0, m.frames); return { disk: true, sr: m.sr, ch: m.ch, frames: m.frames, x: Array.from({ length: m.ch }, (_, c) => Array.from(r.chans[c])) }; });
    let rms = 0, err = 0, lag = 0;
    if (got.disk) { const n = got.frames, ch = got.ch; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const a = got.x[c][i], b = ref[i * ch + c]; rms += b * b; err += (a - b) * (a - b); } }
    const snr = got.disk ? 10 * Math.log10(rms / Math.max(err, 1e-30)) : 0;
    ok(name + ': same length as ffmpeg, and the same sound (signal-to-difference over 30dB)', got.disk && got.sr === +info.sample_rate && got.ch === +info.channels && got.frames * got.ch === ref.length && snr > 30, JSON.stringify({ disk: got.disk, sr: got.sr, ch: got.ch, frames: got.frames, expect: ref.length / info.channels, snr: +snr.toFixed(1) }));
  }
  { const f = path.join(tmp, 'five.opus'); sh(`ffmpeg -v error -y -f lavfi -i "sine=f=300:d=2:r=48000" -af "pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0" -c:a libopus ${f}`);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'five.opus', null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(300); ok('a surround Opus file is not taken by the store (the page decides what to do)', await p.evaluate(() => !(S.audio && S.audio.name === 'five.opus' && S.audio.disk))); }
  { const f = path.join(tmp, 'cut.opus'); const w = fs.readFileSync(path.join(tmp, 'a.opus')), b = Buffer.from(w.subarray(0, Math.floor(w.length / 2))); fs.writeFileSync(f, b);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'cut.opus', null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(300); ok('an Opus file cut short is not taken by the store', await p.evaluate(() => !(S.audio && S.audio.name === 'cut.opus' && S.audio.disk))); }
  { // an Ogg Skeleton track (index data riding beside the sound, as oggz and many web tools write it) must not turn the file away from the store: the sound is the same as the file without it
    const crcT = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; crcT[i] = r >>> 0; }
    const page = (flags, gran, serial, seq, body) => { const h = Buffer.alloc(27 + 1); h.write('OggS', 0); h[5] = flags; h.writeBigInt64LE(BigInt(gran), 6); h.writeUInt32LE(serial, 14); h.writeUInt32LE(seq, 18); h[26] = 1; h[27] = body.length; const all = Buffer.concat([h, body]); let c = 0; for (const b of all) c = ((c << 8) ^ crcT[((c >>> 24) ^ b) & 255]) >>> 0; all.writeUInt32LE(c, 22); return all; };
    const w = fs.readFileSync(path.join(tmp, 'h.ogg')); const ns = w[26]; let sz = 0; for (let i = 0; i < ns; i++) sz += w[27 + i]; const first = w.subarray(0, 27 + ns + sz), rest = w.subarray(27 + ns + sz);
    const fish = page(2, 0, 7777, 0, Buffer.concat([Buffer.from('fishead\0'), Buffer.alloc(56)])), fend = page(4, 0, 7777, 1, Buffer.from('fisbone\0'));
    const f = path.join(tmp, 'skel.ogg'); fs.writeFileSync(f, Buffer.concat([fish, first, fend, rest]));
    const raw = path.join(tmp, 'sk.raw'); sh(`ffmpeg -v error -y -i ${path.join(tmp, 'h.ogg')} -f f32le -c:a pcm_f32le ${raw}`); const want = fs.statSync(raw).size / 8;
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'skel.ogg' && !document.querySelector('#chips .busybar'), null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(300);
    const got = await p.evaluate(() => S.audio && S.audio.name === 'skel.ogg' ? { disk: !!S.audio.disk, frames: S.audio.disk ? DISK.meta.frames : S.audio.buffer.length } : null);
    ok('Vorbis with an Ogg Skeleton track: taken by the store, with the length ffmpeg decodes', !!got && got.disk && got.frames === want, JSON.stringify({ got, want })); }
  { // the memory route (no store): the browser's decoder runs a Vorbis file past the end its last page gives; the length must be the one ffmpeg decodes
    const q = await br.newPage(); q.setDefaultTimeout(60000); await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
    for (const nm of ['f.ogg', 'h.ogg', 'a.opus']) { const f = path.join(tmp, nm), raw = path.join(tmp, 'm.raw'); const info = JSON.parse(sh(`ffprobe -v error -show_entries stream=sample_rate -of json ${f}`)).streams[0]; sh(`ffmpeg -v error -y -i ${f} -ar ${info.sample_rate} -f f32le -c:a pcm_f32le ${raw}`); const want = fs.statSync(raw).size / 8;
      await q.setInputFiles('#audioIn', f); await q.waitForFunction(x => S.audio && S.audio.name === x && S.audio.buffer, nm, { timeout: 60000 }).catch(() => {}); await q.waitForTimeout(300);
      const got = await q.evaluate(() => S.audio.buffer.length); ok(nm + ' in memory: the length is the one ffmpeg decodes', got === want, got + ' vs ' + want); }
    await q.close(); }
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
