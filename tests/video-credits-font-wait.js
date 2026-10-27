// Looking up a credits font shows a thin bar along the font box, not a line of text: nothing around the box moves, and the box carries on as before.
// The Google lookup is stood in for here, so the check needs no internet.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-credits-font-wait.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures', K = '__keyframes';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#creditsOn').click()); await p.waitForTimeout(2000);          // the Credits group glides open first; measure once it has
  await p.evaluate(() => { window.__release = null; window.resolveGoogleFont = raw => new Promise(res => { window.__release = v => res(v); }); });
  const look = () => p.evaluate(() => { const bx = document.querySelector('#credFontBox'), bar = bx.querySelector('.combo-bar'), next = document.querySelector('#creditsAtField'); return { busy: bx.classList.contains('busy'), bar: bar ? +getComputedStyle(bar).opacity : -1, text: document.querySelector('#credFontMsg').textContent, next: Math.round((next.getBoundingClientRect().top - document.querySelector('#credFont').getBoundingClientRect().top) * 10) / 10,          // how far the next field sits below the font box (the panel itself may scroll)
 field: document.querySelector('#credFontField').getBoundingClientRect().height }; });
  const idle = await look();
  ok('at rest the bar is hidden and there is no message', !idle.busy && idle.bar === 0 && idle.text === '', JSON.stringify(idle));
  await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = 'Lora'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(1000);
  const wait = await look();
  if (process.env.SHOTS) { await p.locator('#credFontField').scrollIntoViewIfNeeded(); for (const n of [1, 2, 3]) { await p.waitForTimeout(300); await p.screenshot({ path: process.env.SHOTS + '/font-wait' + n + '.png', clip: await p.locator('#credFontField').boundingBox().then(r => ({ x: r.x - 20, y: r.y - 10, width: r.width + 40, height: r.height + 20 })) }); } }
  ok('while the font is looked up the bar shows and no text appears', wait.busy && wait.bar > 0.9 && wait.text === '', JSON.stringify(wait));
  const sw = await p.evaluate(async () => { const bx = document.querySelector('#credFontBox').getBoundingClientRect(), b = document.querySelector('#credFontBox .combo-bar b'); let lo = 1e9, hi = -1e9; for (let i = 0; i < 40; i++) { const r = b.getBoundingClientRect(); lo = Math.min(lo, r.left); hi = Math.max(hi, r.right); await new Promise(r => setTimeout(r, 50)); } return { lo: Math.round(lo - bx.left), hi: Math.round(hi - bx.right) }; });
  ok('the bar runs the whole length of the box, from its first edge to its last', sw.lo <= 0 && sw.hi >= 0, JSON.stringify(sw));
  ok('and nothing below the box moves', wait.next === idle.next && wait.field === idle.field, JSON.stringify({ idle, wait }));
  await p.evaluate(() => window.__release('Lora')); await p.waitForTimeout(600);
  const done = await look();
  ok('when it is found the bar goes and the font is set', !done.busy && done.bar === 0 && done.text === '' && done.next === idle.next, JSON.stringify(done));
  await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = 'Zzqx Notafont'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(1000);
  await p.evaluate(() => window.__release(null)); await p.waitForTimeout(600);
  const bad = await look();
  ok('a font that is not found drops the bar and says so', !bad.busy && /Couldn.t find/.test(bad.text), JSON.stringify(bad));
  await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(900);
  const clear = await look();
  ok('clearing the box clears the message and the bar', !clear.busy && clear.text === '', JSON.stringify(clear));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
