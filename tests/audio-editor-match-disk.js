// EQ match and Match gain on Bypass for a recording on the disk store, set against the same recording in memory.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-match-disk.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async disk => { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text().slice(0, 200)); });
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700); return p; };
  const m = await open(0), d = await open(1);
  for (const p of [m, d]) await p.evaluate(() => { AE.d.vStart = 0.4; AE.d.vEndSet = 4.2; });
  // 1: your own average curve
  const own = p => p.evaluate(async () => Array.from(await aeOwnCurveA()));
  const a = await own(m), c = await own(d); let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - c[i]));
  ok('your own average curve is the same as in memory', a.length === c.length && a.length > 100 && worst < 1e-4, 'worst ' + worst.toExponential(2) + ' dB');
  // 2: a match against a profile file gives the same free curve
  const prof = await m.evaluate(() => { const ref = Float32Array.from(eqAxis, (f, i) => 4 * Math.sin(i / 12) - 2 * Math.cos(i / 31)); return curveToText(curveCenter(ref), 'test'); });
  const bands = p => p.evaluate(async txt => { AE.matchOpen = true; AE.match = null; const f = new File([txt], 'p.txt'); await aeMatchLoad(f, 'profile'); await aeMatchApply(false); return JSON.stringify(AE.d.fx.eq.curve || []); }, prof);
  const ba = await bands(m), bc = await bands(d); ok('EQ match: the same curve', ba === bc && JSON.parse(ba).length === 240, JSON.stringify(JSON.parse(bc).slice(0, 4)));
  // 3: Match gain on Bypass
  const gain = p => p.evaluate(async () => { AE.bp = { eq: true }; AE.bpKey = AE.bpAsk = ''; AE.bpLast = 1; aeBypassGain(); for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 100)); const g = aeBypassGain(); if (AE.bpKey) return g; } return null; });
  for (const p of [m, d]) await p.evaluate(() => { aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 800, g: 6, q: 1, on: true }]; }); });
  for (const p of [m, d]) await p.waitForFunction(() => fxPeek(AE.d.fx), null, { timeout: 30000 });
  const ga = await gain(m), gc = await gain(d); ok('Match gain on Bypass: the same gain', ga != null && gc != null && Math.abs(ga - gc) < 0.002 && Math.abs(ga - 1) > 0.01, ga + ' / ' + gc);
  ok('no errors', !m.errs.length && !d.errs.length, m.errs.concat(d.errs).join(' | ')); await b.close();
})();
