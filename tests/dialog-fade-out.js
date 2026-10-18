// The export warning and the Import/Export dialog fade out like every other dialog (not in one frame); reduced motion closes them at once; reopening mid-fade keeps them open.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/dialog-fade-out.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const state = (p, sel) => p.evaluate(s => { const o = document.querySelector(s); return { hidden: o.hidden, closing: o.classList.contains('closing'), op: +getComputedStyle(o).opacity }; }, sel);
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const reduce of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: reduce ? 'reduce' : 'no-preference' }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); const tag = reduce ? ' (reduced motion)' : '';
    for (const [name, sel, open, close] of [
      ['Import/Export', '#ioDlg', () => openIO(), () => closeIO()],
      ['the export warning', '#warnDlg', () => { window.__w = askWarn('T', 'M', 'Yes'); }, () => document.querySelector('#warnNo').click()]]) {
      await p.evaluate(open); await p.waitForTimeout(500);
      ok(name + ' is open' + tag, !(await state(p, sel)).hidden);
      await p.evaluate(close); await p.waitForTimeout(90); const mid = await state(p, sel);
      if (reduce) ok(name + ' closes at once' + tag, mid.hidden, JSON.stringify(mid));
      else ok(name + ' is still on screen, fading, 90ms after the close' + tag, !mid.hidden && mid.closing && mid.op < 1, JSON.stringify(mid));
      await p.waitForTimeout(400); ok(name + ' is hidden once the fade ends' + tag, (await state(p, sel)).hidden && !(await state(p, sel)).closing);
    }
    if (!reduce) {
      await p.evaluate(() => { openIO(); }); await p.waitForTimeout(400);
      await p.evaluate(() => closeIO()); await p.waitForTimeout(80); await p.evaluate(() => openIO()); await p.waitForTimeout(500);
      const s = await state(p, '#ioDlg'); ok('reopening during the fade keeps the dialog open', !s.hidden && !s.closing && s.op > 0.99, JSON.stringify(s));
    }
    await p.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
