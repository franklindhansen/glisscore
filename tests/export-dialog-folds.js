// In the export dialog the stall line and the "Save button not doing anything?" line glide in and out (the .fa fold) and the preview fades in; reduced motion is instant.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/export-dialog-folds.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const h = (p, id) => p.evaluate(i => { const f = document.querySelector('#' + i); return { h: f.getBoundingClientRect().height, inert: f.firstElementChild.inert }; }, id);
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const reduce of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? 'reduce' : 'no-preference' }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(800); const tag = reduce ? ' (reduced motion)' : '';
    await p.evaluate(() => { setExpOpen(true); document.querySelector('#expStall').textContent = 'No progress for 20 s. Last step: encode.'; }); await p.waitForTimeout(500);
    for (const [name, id, on, off] of [['the stall line', 'expStallFold', () => foldSet('#expStallFold', true), () => foldSet('#expStallFold', false)], ['the link line', 'expLinkFold', () => foldSet('#expLinkFold', true), () => foldSet('#expLinkFold', false)]]) {
      let s = await h(p, id); ok(name + ' starts shut and inert' + tag, s.h < 1 && s.inert, JSON.stringify(s));
      await p.evaluate(on); await p.waitForTimeout(90); const mid = await h(p, id); await p.waitForTimeout(700); const full = await h(p, id);
      if (reduce) ok(name + ' opens at once' + tag, mid.h > 10 && Math.abs(mid.h - full.h) < 1, JSON.stringify({ mid, full }));
      else ok(name + ' glides open', mid.h > 0 && mid.h < full.h - 2 && full.h > 10 && !full.inert, JSON.stringify({ mid, full }));
      await p.evaluate(off); await p.waitForTimeout(700); s = await h(p, id); ok(name + ' shuts and is inert again' + tag, s.h < 1 && s.inert, JSON.stringify(s));
    }
    const an = await p.evaluate(() => { const v = document.querySelector('#expPreview'); v.hidden = false; return getComputedStyle(v).animationName; });
    ok('the preview fades in when shown' + tag, reduce ? an === 'none' : an === 'fade', an);
    ok('expStallOn follows the stall fold' + tag, await p.evaluate(() => { foldSet('#expStallFold', true); const a = expStallOn(); foldSet('#expStallFold', false); return a && !expStallOn(); }));
    await p.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
