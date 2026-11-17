// PDF Editor: the page-size slider sets the grid's own columns, not a variable the cards inherit (that made it stutter with many pages).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-zoom-cost.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
  const r = await p.evaluate(() => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'), g = $('#peGrid'), w = () => g.querySelector('.page-card').getBoundingClientRect().width; zs.value = -40; zs.dispatchEvent(new Event('input', { bubbles: true })); const a = w(); zs.value = 40; zs.dispatchEvent(new Event('input', { bubbles: true })); const c = w(); return { a, c, cols: g.style.gridTemplateColumns, v: g.style.getPropertyValue('--pe-th') }; });
  ok('the slider widens the cards', r.c > r.a * 1.5, JSON.stringify(r));
  ok('it sets the grid\'s columns and no inherited variable', /minmax/.test(r.cols) && r.v === '', JSON.stringify(r));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
