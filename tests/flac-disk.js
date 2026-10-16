// FLAC files read straight into the disk store: every sample must be the one ffmpeg decodes. Needs ffmpeg.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/flac-disk.js
const { chromium } = require('playwright-core'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfflac-')), sh = c => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
// a mix of tones, noise, a silent stretch and a loud burst, 12 seconds
const src = `aevalsrc='0.35*sin(2*PI*220*t)+0.2*sin(2*PI*1330*t)*sin(2*PI*0.5*t)+0.05*(random(0)-0.5)+if(between(t,4,5),0,0)+if(between(t,8,8.2),0.4*sin(2*PI*90*t),0)|0.3*sin(2*PI*331*t)+0.1*(random(1)-0.5)':d=12:s=48000`;
const silent = `-f lavfi -i "aevalsrc='if(between(t,3,6),0,0.3*sin(2*PI*500*t))|if(between(t,3,6),0,0.2*sin(2*PI*700*t))':d=9:s=44100"`;
const cases = [
  ['16-bit stereo, level 5', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -compression_level 5`],
  ['16-bit stereo, level 0', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -compression_level 0`],
  ['16-bit stereo, level 8', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -compression_level 8`],
  ['24-bit stereo, level 8', `-f lavfi -i "${src}" -sample_fmt s32 -bits_per_raw_sample 24 -c:a flac -compression_level 8`],
  ['24-bit stereo, left/side', `-f lavfi -i "${src}" -sample_fmt s32 -bits_per_raw_sample 24 -c:a flac -ch_mode left_side`],
  ['16-bit stereo, side/right', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -ch_mode right_side`],
  ['16-bit stereo, mid/side, blocks of 576', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -ch_mode mid_side -frame_size 576`],
  ['16-bit stereo, blocks of 192', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -frame_size 192`],
  ['16-bit stereo, blocks of 4608', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -frame_size 4608 -compression_level 8`],
  ['16-bit stereo, independent channels', `-f lavfi -i "${src}" -sample_fmt s16 -c:a flac -ch_mode indep`],
  ['16-bit mono', `-f lavfi -i "${src}" -af "pan=mono|c0=c0" -sample_fmt s16 -c:a flac`],
  ['16-bit with silence (constant parts), 44.1kHz', `${silent} -sample_fmt s16 -c:a flac -compression_level 8`],
  ['24-bit with silence, 44.1kHz', `${silent} -sample_fmt s32 -bits_per_raw_sample 24 -c:a flac`],
  ['16-bit at 8kHz', `-f lavfi -i "${src}" -af aresample=8000 -sample_fmt s16 -c:a flac`],
  ['16-bit at 96kHz', `-f lavfi -i "${src}" -af aresample=96000 -sample_fmt s16 -c:a flac`]
];
(async () => {
  const br = await chromium.launch(); const p = await br.newPage(); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1');
  let n = 0;
  for (const [name, args] of cases) {
    const nm = 'c' + (n++) + '.flac', f = path.join(tmp, nm), raw = path.join(tmp, 't.raw');
    sh(`ffmpeg -v error -y ${args} ${f}`); sh(`ffmpeg -v error -y -i ${f} -f s32le -c:a pcm_s32le ${raw}`);
    const info = JSON.parse(sh(`ffprobe -v error -show_entries stream=sample_rate,channels -of json ${f}`)).streams[0], buf = fs.readFileSync(raw); let h = 0; for (let i = 0; i + 3 < buf.length; i += 4) h = (Math.imul(h, 31) + buf.readInt32LE(i)) | 0;
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(x => S.audio && S.audio.name === x && !document.querySelector('.busybar'), nm, { timeout: 90000 }).catch(() => {}); await p.waitForTimeout(300);
    const got = await p.evaluate(async () => { if (!S.audio || !S.audio.disk) return { disk: false, mem: !!(S.audio && S.audio.buffer) }; let h = 0, k = 0; const m = DISK.meta; for (let at = 0; at < m.frames; at += 65536) { const r = await DISK.read(at, Math.min(65536, m.frames - at)), len = r.chans[0].length; for (let i = 0; i < len; i++) for (let c = 0; c < m.ch; c++) { h = (Math.imul(h, 31) + Math.round(r.chans[c][i] * 2147483648)) | 0; } k += len; } return { disk: true, sr: m.sr, ch: m.ch, frames: m.frames, h, name: S.audio.name }; });
    ok(name + ': every sample is the one ffmpeg decodes', got.disk && got.sr === +info.sample_rate && got.ch === +info.channels && got.frames * got.ch * 4 === buf.length && got.h === h, JSON.stringify(got) + ' expected ' + info.sample_rate + 'Hz ' + info.channels + 'ch ' + buf.length / 4 / info.channels + ' frames');
  }
  // not read this way: it still opens, in memory as before (three channels, and a file that is not whole)
  { const f = path.join(tmp, 'six.flac'); sh(`ffmpeg -v error -y -f lavfi -i "sine=f=300:d=2:r=48000" -af "pan=5.1|c0=c0|c1=c0|c2=c0|c3=c0|c4=c0|c5=c0" -c:a flac ${f}`);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'six.flac', null, { timeout: 30000 }); ok('a surround FLAC is not taken by the store and opens in memory', await p.evaluate(() => !S.audio.disk && !!S.audio.buffer)); }
  { const f = path.join(tmp, 'cut.flac'); const whole = fs.readFileSync(path.join(tmp, 'c0.flac')); const mid = Buffer.from(whole); mid[Math.floor(whole.length / 2)] ^= 0xff; fs.writeFileSync(f, mid);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'cut.flac', null, { timeout: 30000 }).catch(() => {}); ok('a FLAC with a damaged frame is not taken by the store (the checksum catches it) and the page decides what to do', await p.evaluate(() => !S.audio || S.audio.name !== 'cut.flac' || !S.audio.disk)); }
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
