// Video: the page transition that was called Flip is called Turn everywhere a user can see it (the choice, the group's summary, How it works), while the saved value stays
// `flip`, so a settings file made before the rename still loads as Turn.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-turn-wording.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(800);
  const labels = await p.evaluate(() => [...document.querySelectorAll('input[name=transition]')].map(r => r.value + '=' + r.nextElementSibling.textContent));
  ok('the choice reads Turn, Slide, Cut', labels.join() === 'flip=Turn,slide=Slide,cut=Cut', labels.join());
  const sums = await p.evaluate(() => groupSummary('transition'));
  ok('the summary opens with Turn and never says Flip', sums.every(t => t.startsWith('Turn · ') && !/flip/i.test(t)), JSON.stringify(sums));
  const text = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => !e.children.length && !['SCRIPT', 'STYLE'].includes(e.tagName)).map(e => e.textContent).join(' '));
  ok('no visible text says Flip', !/\bflip/i.test(text));
  const old = JSON.stringify({ glisscore: 1, settings: { transition: 'flip', flipDur: 1.5 } });
  await p.evaluate(async old => { S.set.transition = 'slide'; await importSettings(new File([old], 's.json')); }, old);
  const got = await p.evaluate(() => ({ t: S.set.transition, c: document.querySelector('input[name=transition]:checked').nextElementSibling.textContent, d: S.set.flipDur }));
  ok('a settings file with transition "flip" loads as Turn', got.t === 'flip' && got.c === 'Turn' && got.d === 1.5, JSON.stringify(got));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
