// The spectrum view (Spec) for a recording on the disk store, set against the same recording in memory.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-spec-disk.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async disk => { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text().slice(0, 200)); });
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700); return p; };
  const m = await open(0), d = await open(1);
  const toSpec = p => p.evaluate(() => { const r = document.querySelector('input[name=aeView][value=spec]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await toSpec(m); await toSpec(d);
  await m.waitForFunction(() => AE.spec && AE.spec.done >= AE.spec.cols); await d.waitForFunction(() => AE.spec && AE.spec.disk && AE.spec.done >= AE.spec.cols);
  const sd = await d.evaluate(() => ({ cols: AE.spec.cols, t0: AE.spec.t0, cs: AE.spec.cs, painted: (() => { const x = AE.spec.ctx.getImageData(0, 0, AE.spec.cols, 224).data; let n = 0; for (let i = 0; i < x.length; i += 40) if (x[i] > 40 || x[i + 1] > 40 || x[i + 2] > 60) n++; return n; })() }));
  ok('the picture on the store covers the recording and is painted', sd.cols === 1200 && sd.t0 === 0 && sd.painted > 100, JSON.stringify(sd));
  // the same slices as memory: columns 0.02s apart starting where memory's first slice is centred
  const mem = await m.evaluate(() => ({ db: Array.from(AE.spec.db.subarray(0, 200 * SPEC_B)) }));
  const dsk = await d.evaluate(async () => { const t0 = (1024 - 480) / S.audio.sr, r = await DISK.specScan(fxRecipe(AE.d.fx, audCh()), { t0, t1: t0 + 200 * 0.02, cols: 200, K: 1 }); return Array.from(r.db); });
  let worst = 0; for (let i = 0; i < mem.db.length; i++) worst = Math.max(worst, Math.abs(mem.db[i] - dsk[i]));
  ok('the analysis gives the same decibels as memory (200 columns)', worst < 0.01, 'worst ' + worst.toExponential(2) + ' dB');
  // zoom: a new picture for the stretch on screen
  const key0 = await d.evaluate(() => AE.spec.key); await d.evaluate(() => aeZoomSet(1.0, 2.0, false)); await d.waitForFunction(k => AE.spec && AE.spec.key !== k && AE.spec.done >= AE.spec.cols, key0, { timeout: 20000 });
  const z = await d.evaluate(() => ({ t0: AE.spec.t0, end: AE.spec.t0 + AE.spec.cols * AE.spec.cs })); ok('zooming makes a new picture for what is on screen', Math.abs(z.t0 - 1) < 0.01 && Math.abs(z.end - 2) < 0.01, JSON.stringify(z));
  // a Spectra rectangle changes the picture
  const before = await d.evaluate(() => AE.spec.key); await d.evaluate(() => { aeZoomSet(0, S.audio.duration, false); aeFx(fx => { fx.spec.on = true; fx.spec.edits = [{ a: 0.5, b: 2, f0: 800, f1: 3000, mode: 'turn', db: 24 }]; }); });
  await d.waitForFunction(k => AE.spec && AE.spec.key !== k && AE.spec.done >= AE.spec.cols, before, { timeout: 20000 }); ok('a Spectra rectangle makes a new picture', true);
  ok('no errors', !m.errs.length && !d.errs.length, m.errs.concat(d.errs).join(' | ')); await b.close();
})();
