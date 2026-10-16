// PDF Editor: after Re-kilter and Re-size to Tabloid, no page card is left blank (checked on a real scanned score).
// Needs a large scanned score of your own, named in the PDF variable; without one it says so and checks nothing. The score is never part of the project.
// Run with the app served on port 8123:  PDF=/path/to/score.pdf NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-blank-pages.js
const { chromium } = require('playwright-core'), fs = require('fs'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const file = process.env.PDF && fs.existsSync(process.env.PDF) ? process.env.PDF : null;
(async () => {
  if (!file) { console.log('SKIP no PDF given (set PDF=path to a scanned score to run it)'); return; }
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(240000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n > 1 && S.thumbs.filter(Boolean).length === S.pdf.n); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
  const settle = () => p.evaluate(async () => { for (let i = 0; i < 4800 && PE.busy; i++) await sleep(25); for (let i = 0; i < 4800 && VTpending.size; i++) await sleep(25); await sleep(800); });
  const blank = () => p.evaluate(() => { const bad = []; document.querySelectorAll('#peGrid .page-card').forEach(c => { const cv = c.querySelector('canvas'), im = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < im.length && !n; i += 4) if (im[i] < 250) n = 1; if (!n && !PE.d.slots[+c.dataset.id].x) bad.push(+c.dataset.id + 1); }); return { bad, cards: document.querySelectorAll('#peGrid .page-card').length }; });
  await p.evaluate(() => peTool('skew')); await p.waitForTimeout(500); await p.evaluate(() => peSkewGo()); await settle();
  let r = await blank(); ok('After Re-kilter, no page is blank', !r.bad.length, r.bad.length + ' of ' + r.cards + (r.bad.length ? ': pages ' + r.bad.slice(0, 20).join(', ') : ''));
  await p.evaluate(() => peTool('resize')); await p.waitForTimeout(500); await p.evaluate(() => peSetSize({ w: 11, h: 17 }, false)); await settle();
  r = await blank(); ok('After Re-kilter and Tabloid, no page is blank', !r.bad.length, r.bad.length + ' of ' + r.cards + (r.bad.length ? ': pages ' + r.bad.slice(0, 20).join(', ') : ''));
  ok('No page errors', !errs.length, errs.join('; '));
  await b.close();
})();
