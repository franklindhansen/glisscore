// AIFF and AIFF-C files read straight into the disk store: every sample must be the one ffmpeg decodes. Needs ffmpeg.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/aiff-disk.js
const { chromium } = require('playwright-core'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfaiff-')), sh = c => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
// a mix of tones, noise, a silent stretch and a loud burst, 12 seconds
const src = `aevalsrc='0.35*sin(2*PI*220*t)+0.2*sin(2*PI*1330*t)*sin(2*PI*0.5*t)+0.05*(random(0)-0.5)+if(between(t,4,5),0,0)+if(between(t,8,8.2),0.4*sin(2*PI*90*t),0)|0.3*sin(2*PI*331*t)+0.1*(random(1)-0.5)':d=12:s=48000`;
const silent = `-f lavfi -i "aevalsrc='if(between(t,3,6),0,0.3*sin(2*PI*500*t))|if(between(t,3,6),0,0.2*sin(2*PI*700*t))':d=9:s=44100"`;
const cases = [
  ['16-bit stereo', `-f lavfi -i "${src}" -c:a pcm_s16be -f aiff`],
  ['24-bit stereo', `-f lavfi -i "${src}" -c:a pcm_s24be -f aiff`],
  ['8-bit stereo (signed in AIFF)', `-f lavfi -i "${src}" -c:a pcm_s8 -f aiff`],
  ['16-bit mono', `-f lavfi -i "${src}" -af "pan=mono|c0=c0" -c:a pcm_s16be -f aiff`],
  ['16-bit little-endian (AIFF-C sowt)', `-f lavfi -i "${src}" -c:a pcm_s16le -f aiff`],
  ['32-bit float (AIFF-C fl32)', `-f lavfi -i "${src}" -af volume=0.9 -c:a pcm_f32be -f aiff`],
  ['64-bit float (AIFF-C fl64)', `-f lavfi -i "${src}" -af volume=0.9 -c:a pcm_f64be -f aiff`],
  ['24-bit at 44.1kHz with silence', `${silent} -c:a pcm_s24be -f aiff`],
  ['16-bit at 96kHz', `-f lavfi -i "${src}" -af aresample=96000 -c:a pcm_s16be -f aiff`],
  ['16-bit at 8kHz', `-f lavfi -i "${src}" -af aresample=8000 -c:a pcm_s16be -f aiff`]
];
(async () => {
  const br = await chromium.launch(); const p = await br.newPage(); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html?disk=1');
  let n = 0;
  for (const [name, args] of cases) {
    const nm = 'c' + (n++) + '.aiff', f = path.join(tmp, nm), raw = path.join(tmp, 't.raw');
    sh(`ffmpeg -v error -y ${args} ${f}`); const fl = /float/.test(name); sh(`ffmpeg -v error -y -i ${f} ${fl ? '-f f32le -c:a pcm_f32le' : '-f s32le -c:a pcm_s32le'} ${raw}`);
    const info = JSON.parse(sh(`ffprobe -v error -show_entries stream=sample_rate,channels -of json ${f}`)).streams[0], buf = fs.readFileSync(raw); let h = 0; for (let i = 0; i + 3 < buf.length; i += 4) h = (Math.imul(h, 31) + buf.readInt32LE(i)) | 0;
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(x => S.audio && S.audio.name === x && !document.querySelector('.busybar'), nm, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(300);
    const got = await p.evaluate(async fl => { if (!S.audio || !S.audio.disk) return { disk: false, mem: !!(S.audio && S.audio.buffer) }; let h = 0, k = 0; const m = DISK.meta, F = new Float32Array(1), U = new Int32Array(F.buffer); for (let at = 0; at < m.frames; at += 65536) { const r = await DISK.read(at, Math.min(65536, m.frames - at)), len = r.chans[0].length; for (let i = 0; i < len; i++) for (let c = 0; c < m.ch; c++) { h = (Math.imul(h, 31) + (fl ? (F[0] = r.chans[c][i], U[0] | 0) : Math.round(r.chans[c][i] * 2147483648))) | 0; } k += len; } return { disk: true, sr: m.sr, ch: m.ch, frames: m.frames, h, name: S.audio.name }; }, fl);
    ok(name + ': every sample is the one ffmpeg decodes', got.disk && got.sr === +info.sample_rate && got.ch === +info.channels && got.frames * got.ch * 4 === buf.length && got.h === h, JSON.stringify(got) + ' expected ' + info.sample_rate + 'Hz ' + info.channels + 'ch ' + buf.length / 4 / info.channels + ' frames');
  }
  // a surround file is folded to stereo on the store, the way a WAV is
  { const f = path.join(tmp, 'six.aiff'); sh(`ffmpeg -v error -y -f lavfi -i "sine=f=300:d=2:r=48000" -af "pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0" -c:a pcm_s16be ${f}`);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'six.aiff', null, { timeout: 30000 }); await p.waitForTimeout(500); ok('a surround AIFF is on the store as stereo', await p.evaluate(() => S.audio.disk && DISK.meta.ch === 2)); }
  // a compressed AIFF-C (ulaw) is left to the browser: it opens in memory or not at all, never on the store
  { const f = path.join(tmp, 'ulaw.aifc'); sh(`ffmpeg -v error -y -f lavfi -i "sine=f=300:d=2:r=8000" -c:a pcm_mulaw -f aiff ${f}`);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'ulaw.aifc', null, { timeout: 20000 }).catch(() => {}); ok('a compressed AIFF-C is not taken by the store', await p.evaluate(() => !(S.audio && S.audio.name === 'ulaw.aifc' && S.audio.disk))); }
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
