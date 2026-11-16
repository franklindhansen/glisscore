// The ruler's time labels sit in the vertical middle of the ruler band, in the video timeline and the Audio Editor alike: one shared helper (rulerLabelY) gives the baseline from the ruler's height, and both rulers use it.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/ruler-labels.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  const base = 'http://localhost:' + (process.env.PORT || 8123) + '/';
  await p.goto(base + 'index.html?disk=0'); await p.waitForTimeout(500);
  const has = await p.evaluate(() => typeof rulerLabelY === 'function');
  ok('The shared ruler label helper exists', has);
  if (has) for (const h of [24, 26, 30]) {
    const r = await p.evaluate(h => {
      const c = document.createElement('canvas').getContext('2d'); c.font = '11px "Hanken Grotesk",system-ui,sans-serif'; c.textBaseline = 'alphabetic';
      const y = rulerLabelY(c, h), m = c.measureText('0'), top = y - m.actualBoundingBoxAscent, bot = y + m.actualBoundingBoxDescent;
      return { mid: (top + bot) / 2, band: (h - 1) / 2 };
    }, h);
    ok('Ruler ' + h + 'px: the digits sit in the middle of the band', Math.abs(r.mid - r.band) <= 0.25, JSON.stringify(r));
  }
  for (const f of ['js/video-stage.js', 'js/audio-editor.js']) {
    const src = await (await fetch(base + f)).text();
    ok(f + ' draws its ruler labels with the shared helper', /rulerLabelY\(/.test(src));
    ok(f + ' keeps no fixed label height in the ruler', f.includes('video') ? !/, x \+ 4, 11\)/.test(src) && !/px \+ tw \+ 6, 11\)/.test(src) : !/, x \+ 4, 15\)/.test(src));
  }
  ok('No page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
