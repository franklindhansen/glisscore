// The noise graph tells the truth: a made recording (a 440Hz tone over white noise, at two known noise levels) is learned by hand, and the learned profile and the picture are checked against what was put in.
// The profile must peak at 440Hz and stand well above the hiss, must be flat across the hiss, and must rise by the same number of dB as the noise did; in the picture the highest point of the line is at 440Hz,
// louder is always higher, and the line never runs below the plot's floor (over the frequency labels).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-noise-graph.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, secs = 6, n = sr * secs; let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const write = (name, sigma) => {
  const wav = Buffer.alloc(44 + n * 4); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round((0.03 * Math.sin(2 * Math.PI * 440 * i / sr) + sigma * gauss()) * 32767), 44 + i * 4 + c * 2);
  const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, wav); return f;
};
const files = [write('kf-ng-a.wav', 0.002), write('kf-ng-b.wav', 0.004), write('kf-ng-c.wav', 0.00001)];          // the second has twice the noise: 6.02dB more
(async () => {
  const b = await chromium.launch(), res = [];
  for (const f of files) {
    const p = await b.newPage({ viewport: { width: 1100, height: 800 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      aeTool('noise'); await sleep(300); document.querySelector('input[name=aeNrMethod][value=manual]').click(); await sleep(100); AE.nsel = { a: 0.5, b: 5.5 }; AE.nsBy = 'hand'; aeNrPanel();
      document.querySelector('#aeNrLearn').click(); for (let i = 0; i < 200 && !(AE.d.fx.noise.profile && !AE.nrLearning); i++) await sleep(50); await sleep(1500);
      const P = Array.from(AE.d.fx.noise.profile), cv = document.querySelector('#aeNrCv'), W = cv.clientWidth, H = cv.clientHeight, k = cv.width / W, ctx = cv.getContext('2d');
      const px = document.createElement('canvas'); px.width = px.height = 1; const pc = px.getContext('2d'); pc.fillStyle = TL.C.turn; pc.fillRect(0, 0, 1, 1); const want = Array.from(pc.getImageData(0, 0, 1, 1).data);
      const img = ctx.getImageData(0, 0, cv.width, cv.height).data, isLine = (x, y) => { const i = (y * cv.width + x) * 4; return Math.abs(img[i] - want[0]) < 28 && Math.abs(img[i + 1] - want[1]) < 28 && Math.abs(img[i + 2] - want[2]) < 28 && img[i + 3] > 200; };
      const top = x => { for (let y = Math.round(24 * k); y < cv.height; y++) if (isLine(x, y)) return y / k; return null; };
      const lineX = [], below = []; for (let x = 0; x < cv.width; x++) { const t = top(x); if (t !== null) lineX.push([x / k, t]); }
      const floorY = H - 24; let under = 0; for (let y = Math.round((floorY + 4) * k); y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (isLine(x, y)) under++;
      const hi = lineX.reduce((a, c) => (c[1] < a[1] ? c : a), [0, 1e9]), at = f => eqFx(f, W);
      const yAt = f => { const x = Math.round(at(f)), c = lineX.filter(q => Math.abs(q[0] - x) < 2); return c.length ? Math.min(...c.map(q => q[1])) : null; };
      return { P, axis: Array.from(eqAxis), W, H, hiX: hi[0], hiY: hi[1], x440: at(440), y440: yAt(440), y3k: yAt(3000), under, floorY, n: lineX.length };
    });
    res.push(r); ok('no page errors', errs.length === 0, errs.join('; ')); await p.close();
  }
  const [A, B, C] = res, db = (a, lo, hi) => { const v = a.P.filter((_, i) => a.axis[i] >= lo && a.axis[i] <= hi); return v.reduce((s, x) => s + x, 0) / v.length; };
  const pk = a => { let m = 0; a.P.forEach((v, i) => { if (v > a.P[m]) m = i; }); return a.axis[m]; };
  console.log('info: profile peak ' + pk(A).toFixed(0) + 'Hz, peak ' + Math.max(...A.P).toFixed(1) + ', hiss 2k-4k ' + db(A, 2000, 4000).toFixed(1) + ', hiss 6k-12k ' + db(A, 6000, 12000).toFixed(1) + ', hiss 1k-2k ' + db(A, 1000, 2000).toFixed(1));
  ok('the profile peaks at the tone, 440Hz', Math.abs(Math.log2(pk(A) / 440)) < 0.1 && Math.abs(Math.log2(pk(B) / 440)) < 0.1, pk(A).toFixed(0) + 'Hz and ' + pk(B).toFixed(0) + 'Hz');
  ok('the tone stands at least 20dB above the hiss', Math.max(...A.P) - db(A, 2000, 8000) > 20, (Math.max(...A.P) - db(A, 2000, 8000)).toFixed(1) + 'dB');
  ok('white hiss is flat across the graph (within 3dB from 1k to 12k)', Math.abs(db(A, 1000, 2000) - db(A, 6000, 12000)) < 3 && Math.abs(db(A, 2000, 4000) - db(A, 6000, 12000)) < 3, db(A, 1000, 2000).toFixed(1) + ' / ' + db(A, 2000, 4000).toFixed(1) + ' / ' + db(A, 6000, 12000).toFixed(1));
  ok('twice the noise reads 6dB higher (within 1dB)', Math.abs(db(B, 2000, 10000) - db(A, 2000, 10000) - 6.02) < 1, (db(B, 2000, 10000) - db(A, 2000, 10000)).toFixed(2) + 'dB');
  for (const [tag, r] of [['quieter', A], ['louder', B]]) {
    ok(tag + ': the highest point of the line is at 440Hz in the picture', Math.abs(r.hiX - r.x440) < 8, 'x ' + r.hiX.toFixed(0) + ' vs ' + r.x440.toFixed(0));
    ok(tag + ': the line is higher at the tone than in the hiss', r.y440 !== null && r.y3k !== null && r.y3k - r.y440 > 20, r.y440 + ' vs ' + r.y3k);
    ok(tag + ': the line never runs under the plot floor, over the frequency labels', r.n > 100 && r.under === 0, r.under + ' pixels under y=' + r.floorY);
  }
  ok('a tone over almost no noise (hiss far under the plot floor): the line rests on the floor and never runs under it', C.n > 100 && C.under === 0, C.under + ' pixels under y=' + C.floorY);
  ok('the louder noise sits higher in the picture, or equal when the scale follows it', B.y3k <= A.y3k + 2, 'quieter ' + A.y3k + ', louder ' + B.y3k);
  await b.close();
})();
