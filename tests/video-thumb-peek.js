// Hovering (or tabbing to) Save current frame shows a small picture of the frame it would save, above the button, and it goes when the pointer leaves.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-thumb-peek.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures', K = '__keyframes';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.evaluate(() => { document.querySelector('.adv').open = true; });
  const shown = () => p.evaluate(() => { const e = document.querySelector('.thumb-peek'); return !!e && e.classList.contains('show') && getComputedStyle(e).visibility === 'visible'; });
  await p.hover('#btnThumb', { force: true }).catch(() => {}); await p.waitForTimeout(700);
  ok('with no score open there is no preview', !(await shown()));
  await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K); await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelector('.adv').open = true; }); await p.waitForTimeout(500);
  await p.hover('#btnThumb'); await p.waitForFunction(() => { const e = document.querySelector('.thumb-peek'); return e && e.classList.contains('show'); }, null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400);
  ok('hovering the button shows the preview', await shown());
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/thumb-peek.png' });          // SHOTS=folder saves a picture to look at
  const g = await p.evaluate(() => {
    const e = document.querySelector('.thumb-peek'), c = e.firstChild, r = e.getBoundingClientRect(), br = document.querySelector('#btnThumb').getBoundingClientRect(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    const cr = c.getBoundingClientRect();
    return { gap: br.top - r.bottom, aboveButton: r.bottom <= br.top, inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0, ratio: cr.width / cr.height, colors: seen.size, centered: Math.abs((r.left + r.width / 2) - (br.left + br.width / 2)) < 2 };
  });
  ok('it sits just above the button, inside the window', g.aboveButton && g.inView && g.gap > 2 && g.gap < 20, JSON.stringify(g));
  ok('it is 16:9 and shows a real picture of the page, not a blank', Math.abs(g.ratio - 16 / 9) < 0.02 && g.colors > 3, JSON.stringify(g));
  await p.mouse.move(5, 5); await p.waitForTimeout(500);
  ok('moving away hides it', !(await shown()));
  await p.focus('#btnThumb'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.waitForTimeout(900);
  ok('tabbing to the button shows it too', await shown());
  await p.keyboard.press('Tab'); await p.waitForTimeout(500);
  ok('tabbing away hides it', !(await shown()));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
