// A finished entrance animation must not keep holding the element's end state: a held end overrides the hover, press, and drag transforms once the entrance is over, so a card
// lifts on hover and then snaps back down. The intro's two start cards must keep a hover lift, and no element but the logo's line may hold a finished animation.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/intro-hover.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.waitForTimeout(2200);
  const r = await p.evaluate(async () => {
    const out = { cards: [], held: [] };
    for (const id of ['#scScore', '#scAudio']) { const c = document.querySelector(id); c.style.transition = 'none'; c.style.transform = 'translateY(-4px)'; await new Promise(r => setTimeout(r, 120)); out.cards.push(getComputedStyle(c).transform); c.style.transform = ''; c.style.transition = ''; }
    document.querySelectorAll('*').forEach(e => { const cs = getComputedStyle(e); if (cs.animationName !== 'none' && /both|forwards/.test(cs.getPropertyValue('animation-fill-mode')) && !e.classList.contains('logo-line')) out.held.push(e.id || String(e.className)); });
    return out;
  });
  ok('a start card keeps its hover lift after the entrance is over', r.cards.every(t => t === 'matrix(1, 0, 0, 1, 0, -4)'), JSON.stringify(r.cards));
  ok('no element but the logo line holds a finished animation', r.held.length === 0, JSON.stringify(r.held));
  ok('no page errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
