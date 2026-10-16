// MP3 files read into the disk store (decoded by the browser a piece at a time), set against the browser's one-shot decoder (the file held in memory). Needs ffmpeg with the LAME encoder.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/mp3-disk.js
const { chromium } = require('playwright-core'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfmp3-')), sh = c => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
const src = `-f lavfi -i "aevalsrc='0.35*sin(2*PI*220*t)+0.2*sin(2*PI*1330*t)*sin(2*PI*0.5*t)+0.05*(random(0)-0.5)|0.3*sin(2*PI*331*t)+0.1*(random(1)-0.5)':d=14:s=48000"`;
const cases = [
  ['stereo 192kbps CBR, 48kHz', `${src} -c:a libmp3lame -b:a 192k`],
  ['stereo VBR, 44.1kHz', `${src} -af aresample=44100 -c:a libmp3lame -q:a 2`],
  ['stereo 128kbps without the Xing header', `${src} -c:a libmp3lame -b:a 128k -write_xing 0`],
  ['mono 96kbps, 32kHz', `${src} -af "pan=mono|c0=c0,aresample=32000" -c:a libmp3lame -b:a 96k`],
  ['stereo 64kbps, 22.05kHz (MPEG-2)', `${src} -af aresample=22050 -c:a libmp3lame -b:a 64k`],
  ['joint stereo 320kbps with an ID3 tag', `${src} -c:a libmp3lame -b:a 320k -id3v2_version 3 -metadata title="Test tone" -metadata artist="Nobody"`]
];
(async () => {
  const br = await chromium.launch(); const errs = [];
  const open = async disk => { const p = await br.newPage(); p.setDefaultTimeout(90000); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); return p; };
  const m = await open(0), d = await open(1); let n = 0;
  for (const [name, args] of cases) {
    const nm = 'm' + (n++) + '.mp3', f = path.join(tmp, nm); sh(`ffmpeg -v error -y ${args} ${f}`);
    for (const p of [m, d]) { await p.setInputFiles('#audioIn', f); await p.waitForFunction(x => S.audio && S.audio.name === x && !document.querySelector('.busybar'), nm, { timeout: 90000 }); await p.waitForTimeout(300); }
    const mem = await m.evaluate(() => { const b = S.audio.buffer, x = b.getChannelData(0), y = b.numberOfChannels > 1 ? b.getChannelData(1) : x; return { sr: b.sampleRate, ch: b.numberOfChannels, len: b.length, a: Array.from(x.subarray(30000, 31000)), pk: Math.max(...x.subarray(0, 4000).map(Math.abs)) }; });
    const dsk = await d.evaluate(async () => { if (!S.audio.disk) return { disk: false }; const m = DISK.meta, r = await DISK.read(30000, 1000), r0 = await DISK.read(0, 4000); return { disk: true, sr: m.sr, ch: m.ch, len: m.frames, a: Array.from(r.chans[0]), pk: Math.max(...r0.chans[0].map(Math.abs)) }; });
    let worst = 0; if (dsk.disk) for (let i = 0; i < 1000; i++) worst = Math.max(worst, Math.abs(mem.a[i] - dsk.a[i]));
    ok(name + ': same rate, channels and length as the one-shot decoder', dsk.disk && dsk.sr === mem.sr && dsk.ch === mem.ch && Math.abs(dsk.len - mem.len) <= 1, JSON.stringify({ mem: [mem.sr, mem.ch, mem.len], disk: [dsk.sr, dsk.ch, dsk.len] }));
    ok(name + ': the samples line up with it', dsk.disk && worst < 2e-4, 'worst ' + worst.toExponential(2));
  }
  // odd files: a tag after the last frame, and a file cut short
  { const whole = fs.readFileSync(path.join(tmp, 'm0.mp3')); const v = { 'with an ID3v1 tag after the last frame': Buffer.concat([whole, Buffer.from('TAG' + 'x'.repeat(125))]), 'cut short in the middle of a frame': whole.subarray(0, whole.length - 5003) };
    for (const [name, buf] of Object.entries(v)) { const nm = 'odd' + (n++) + '.mp3'; fs.writeFileSync(path.join(tmp, nm), buf);
      await d.setInputFiles('#audioIn', path.join(tmp, nm)); await d.waitForFunction(x => S.audio && S.audio.name === x && !document.querySelector('.busybar'), nm, { timeout: 90000 }); await d.waitForTimeout(300);
      const r = await d.evaluate(() => ({ disk: !!S.audio.disk, len: S.audio.disk ? DISK.meta.frames : S.audio.buffer.length, dur: S.audio.duration })); ok(name + ': it opens (' + (r.disk ? 'on the store' : 'in memory') + ') with about the right length', r.dur > 13 && r.dur < 14.1, JSON.stringify(r)); } }
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
