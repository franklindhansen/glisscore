// The settings menu fades out in about 120ms (opacity only), turns around if it is opened again mid-fade, and closes at once under reduced motion.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/menu-fade-out.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const st = p => p.evaluate(() => { const m = document.querySelector('#settingsMenu'), cs = getComputedStyle(m); return { hidden: m.hidden, op: +cs.opacity, tf: cs.transform, exp: document.querySelector('#btnSettings').getAttribute('aria-expanded') }; });
const click = p => p.evaluate(() => document.querySelector('#btnSettings').click());
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const reduce of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: reduce ? 'reduce' : 'no-preference' }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); const tag = reduce ? ' (reduced motion)' : '';
    await click(p); await p.waitForTimeout(400); let s = await st(p);
    ok('the menu opens' + tag, !s.hidden && s.exp === 'true' && s.op > 0.99, JSON.stringify(s));
    if (!reduce) { const o = await p.evaluate(() => { const m = document.querySelector('#settingsMenu'), b = document.querySelector('#btnSettings').getBoundingClientRect(), r = m.getBoundingClientRect(), [x, y] = getComputedStyle(m).transformOrigin.split(' ').map(parseFloat); return { dx: r.left + x - (b.left + b.width / 2), dy: r.top + y - (b.top + b.height / 2) }; });
      ok('it grows from the center of its button', Math.abs(o.dx) < 2 && Math.abs(o.dy) < 2, JSON.stringify(o)); }
    await click(p); await p.waitForTimeout(50); s = await st(p);
    if (reduce) ok('closes at once' + tag, s.hidden && s.exp === 'false', JSON.stringify(s));
    else ok('mid-fade: still shown, fading, no movement, button already reads closed', !s.hidden && s.op < 1 && s.op > 0 && s.tf === 'none' && s.exp === 'false', JSON.stringify(s));
    await p.waitForTimeout(250); s = await st(p); ok('hidden once the fade ends' + tag, s.hidden, JSON.stringify(s));
    if (!reduce) {
      await click(p); await p.waitForTimeout(400); await click(p); await p.waitForTimeout(40); await click(p); await p.waitForTimeout(500); s = await st(p);
      ok('opening again mid-fade brings it back whole', !s.hidden && s.op > 0.99 && s.exp === 'true', JSON.stringify(s));
      await p.keyboard.press('Escape'); await p.waitForTimeout(400); s = await st(p); ok('Escape closes it', s.hidden && s.exp === 'false', JSON.stringify(s));
      await click(p); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector('#menuAbout').click()); await p.waitForTimeout(400);
      ok('choosing About closes the menu and opens About', (await st(p)).hidden && (await p.evaluate(() => !document.querySelector('#aboutDlg').hidden)));
    }
    await p.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
