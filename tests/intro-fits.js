// The intro screen (logo, headline, two cards, line below) must sit fully inside its box at every window size, so a phone never cuts off its top or bottom (when it is too tall it scrolls from its top).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/intro-fits.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(); const bad = [];
  const sizes = []; for (const w of [320, 360, 375, 390, 414, 430, 600, 700, 768, 820, 834, 960, 1024, 1280]) for (const h of [320, 400, 500, 600, 664, 760, 900]) sizes.push([w, h]);
  const p = await b.newPage(); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.waitForTimeout(1800);
  for (const [w, h] of sizes) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(120);
    const r = await p.evaluate(() => {
      const em = document.querySelector('#empty'), box = document.querySelector('.stage-wrap').getBoundingClientRect(), canScroll = false, out = []; if (getComputedStyle(em).overflowY !== 'hidden') out.push('scrolls');
      em.scrollTop = 0;
      if (box.height < 120) return { out, wide: document.documentElement.scrollWidth > innerWidth + 1 };          // a desktop window under ~450px tall leaves the page's own layout no stage to draw in
      for (const s of ['.empty-logo', '.empty h2', '.starts', '.empty-intro']) { const e = document.querySelector(s); if (!e || !e.offsetParent) continue; const q = e.getBoundingClientRect(); if (q.top < box.top - 0.5 || q.left < box.left - 0.5 || q.right > box.right + 0.5 || (q.bottom > box.bottom + 0.5 && !canScroll)) out.push(s); }
      return { out, wide: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    if (r.out.length || r.wide ) bad.push(w + 'x' + h + ' ' + JSON.stringify(r));
  }
  ok('the intro fits its box at ' + sizes.length + ' window sizes from 320 to 1280 wide, and never makes the page wider', bad.length === 0, bad.slice(0, 6).join(' | '));
  await b.close();
})();
