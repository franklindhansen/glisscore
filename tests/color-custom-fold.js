// The custom Background and Ink color rows glide open and shut (the .fa fold) instead of popping; a closed row is inert; reduced motion is instant.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/color-custom-fold.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const h = (p, id) => p.evaluate(i => { const f = document.querySelector('#' + i + 'Fold'); return { h: f.getBoundingClientRect().height, inert: f.firstElementChild.inert, open: f.classList.contains('open') }; }, id);
const pick = (p, sel, v) => p.evaluate(([s, val]) => { const e = document.querySelector(s); e.value = val; e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const reduce of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? 'reduce' : 'no-preference' }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(1200); await p.evaluate(() => { const i = document.querySelector('#invert'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(600);       // Ink color shows only with Invert colors on
    const tag = reduce ? ' (reduced motion)' : '';
    for (const [name, preset, id, other] of [['Background', '#bgPreset', 'bgCustom', '#FFFFFF'], ['Ink color', '#inkPreset', 'inkCustom', '#FFFFFF']]) {
      let s = await h(p, id); ok(name + ': the row starts shut and inert' + tag, s.h < 1 && s.inert && !s.open, JSON.stringify(s));
      await pick(p, preset, 'custom'); await p.waitForTimeout(90); const mid = await h(p, id); await p.waitForTimeout(700); const full = await h(p, id);
      if (reduce) ok(name + ': Custom opens at once' + tag, mid.h > 20 && Math.abs(mid.h - full.h) < 1, JSON.stringify({ mid, full }));
      else ok(name + ': Custom glides open (partway at 90ms, full later)', mid.h > 0 && mid.h < full.h - 2 && full.h > 20 && !full.inert, JSON.stringify({ mid, full }));
      await pick(p, preset, other); await p.waitForTimeout(90); const mid2 = await h(p, id); await p.waitForTimeout(700); const shut = await h(p, id);
      if (reduce) ok(name + ': a preset shuts it at once' + tag, mid2.h < 1 && shut.inert, JSON.stringify({ mid2, shut }));
      else ok(name + ': a preset glides it shut, then it is inert', mid2.h > 0 && mid2.h < full.h && shut.h < 1 && shut.inert, JSON.stringify({ mid2, shut }));
    }
    await p.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
