// The credits font list fades out in about 100ms on a pick or blur (the value is set first), leaves at once when nothing matches, comes back whole if reopened mid-fade, and closes at once under reduced motion.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/font-list-fade.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const st = p => p.evaluate(() => { const i = document.querySelector('#credFont'), l = document.querySelector('#credFontList'); return { hidden: l.hidden, op: +getComputedStyle(l).opacity, exp: i.getAttribute('aria-expanded'), val: i.value, n: l.children.length }; });
const ev = (p, t) => p.evaluate(t => document.querySelector('#credFont').dispatchEvent(new Event(t)), t);
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const reduce of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: reduce ? 'reduce' : 'no-preference' }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(800); await p.evaluate(() => document.querySelector('#creditsOn').click()); await p.waitForTimeout(900);       // the list sits in the Credits group, which is shut while credits are off
    const tag = reduce ? ' (reduced motion)' : '';
    await ev(p, 'focus'); await p.waitForTimeout(400); let s = await st(p); ok('the list opens, whole' + tag, !s.hidden && s.n > 3 && s.exp === 'true' && s.op > 0.99, JSON.stringify(s));
    await p.evaluate(() => document.querySelector('#credFontList li:nth-child(2)').click()); await p.waitForTimeout(40); s = await st(p);
    const want = await p.evaluate(() => document.querySelector('#credFontList li:nth-child(2)').textContent);
    ok('a pick sets the value at once' + tag, s.val === want, s.val);
    if (reduce) ok('the list closes at once' + tag, s.hidden && s.exp === 'false', JSON.stringify(s));
    else ok('the list is fading, not gone, 40ms after a pick', !s.hidden && s.op < 1 && s.exp === 'false', JSON.stringify(s));
    await p.waitForTimeout(300); ok('hidden once the fade ends' + tag, (await st(p)).hidden);
    if (!reduce) {
      await ev(p, 'focus'); await p.waitForTimeout(400); await ev(p, 'blur'); await p.waitForTimeout(40); await ev(p, 'focus'); await p.waitForTimeout(400); s = await st(p);
      ok('reopening mid-fade brings it back whole', !s.hidden && s.op > 0.99 && s.exp === 'true', JSON.stringify(s));
      await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = 'zzzzqq'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(20); s = await st(p);
      ok('no match: the list leaves at once', s.hidden && s.exp === 'false', JSON.stringify(s));
    }
    await p.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
