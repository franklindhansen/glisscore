// A surround AAC M4A goes to the disk store folded to stereo, with the same samples as the same file opened in memory. Needs ffmpeg and a browser that decodes AAC.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/surround-m4a-disk.js
const { chromium } = require('playwright-core'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfsur-')), sh = c => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
(async () => {
  const f = path.join(tmp, 'five1.m4a');
  sh(`ffmpeg -v error -y -f lavfi -i "sine=f=300:d=6:r=48000" -f lavfi -i "sine=f=450:d=6:r=48000" -f lavfi -i "sine=f=600:d=6:r=48000" -f lavfi -i "sine=f=80:d=6:r=48000" -f lavfi -i "sine=f=900:d=6:r=48000" -f lavfi -i "sine=f=1200:d=6:r=48000" -filter_complex "[0][1][2][3][4][5]amerge=inputs=6,volume=0.3[a]" -map "[a]" -c:a aac -b:a 384k ${f}`);
  const br = await chromium.launch(), res = {};
  { const p = await br.newPage(); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); const can = await p.evaluate(async () => { try { return (await AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 6, description: new Uint8Array([0x11, 0x90]) })).supported; } catch (e) { return false; } }); await p.close();
    if (!can) { console.log('SKIP this browser has no AAC decoder (the test browser here has none); run it in Chrome or Safari'); await br.close(); return; } }
  for (const disk of [1, 0]) {
    const p = await br.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.name === 'five1.m4a', null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(800);
    res[disk] = await p.evaluate(async () => {
      if (!S.audio) return null; const a = S.audio; let L, R;
      if (a.disk) { const r = await DISK.read(0, DISK.meta.frames); L = Array.from(r.chans[0]); R = Array.from(r.chans[1]); } else { L = Array.from(a.buffer.getChannelData(0)); R = Array.from(a.buffer.getChannelData(1)); }
      let pk = 0; for (const x of L) pk = Math.max(pk, Math.abs(x)); return { disk: !!a.disk, n: L.length, pk, L, R }; });
    ok((disk ? 'disk store' : 'memory') + ': no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  const d = res[1], m = res[0]; ok('the surround file is on the store', !!(d && d.disk) && !!(m && !m.disk));
  if (d && m) { let big = 0; const n = Math.min(d.n, m.n); for (let i = 0; i < n; i++) big = Math.max(big, Math.abs(d.L[i] - m.L[i]), Math.abs(d.R[i] - m.R[i])); ok('stereo fold is the same sound as in memory', big < 1e-6 && Math.abs(d.n - m.n) <= 1 && d.pk > 0.05, 'max difference ' + big + ', frames ' + d.n + ' / ' + m.n + ', peak ' + d.pk); }
  await br.close();
})();
