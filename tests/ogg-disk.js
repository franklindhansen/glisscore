// Ogg files (Opus and Vorbis) go to the disk store, decoded by the browser's own decoder: the length must be the one ffmpeg decodes and the sound must be the same within what two decoders differ by. Needs ffmpeg.
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
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(x => S.audio && S.audio.name === x && !document.querySelector('.busybar'), nm, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(300);
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
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
