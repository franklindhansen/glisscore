// Status lines in the PDF Editor: they clear when the editor opens and when another PDF loads.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-status.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function mk(name, n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([612, 792]); const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await d.save()); return f; }
(async () => {
  const A = await mk('kf-status-a.pdf', 4), B = await mk('kf-status-b.pdf', 4);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html');
  const load = async f => { await p.setInputFiles('#pdfIn', f); await p.waitForTimeout(1500); };
  const lines = () => p.evaluate(() => [...document.querySelectorAll('#peBand .pe-status')].map(e => e.textContent).filter(Boolean));
  await load(A); await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  await p.evaluate(() => peSay('#peAddStatus', 'Could not add pages.'));
  await p.evaluate(() => closePdfEditor()); await p.waitForTimeout(500);
  await load(B);
  ok('A message does not survive loading a second PDF', (await lines()).length === 0, (await lines()).join(' | '));
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  await p.evaluate(() => peSay('#peAddStatus', 'Could not add pages.')); await p.evaluate(() => closePdfEditor()); await p.waitForTimeout(500);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  ok('A message does not survive reopening the editor', (await lines()).length === 0, (await lines()).join(' | '));
  await p.evaluate(() => { S.pdf.locked = true; peState(); });
  const ex = await p.evaluate(() => ({ dis: $('#peExport').disabled, title: $('#peExport').title, line: $('#peCount').textContent, cls: $('#peCount').className }));
  ok('Export is greyed out and its reason shows on the bar line', ex.dis && /locked PDF/.test(ex.line) && /warn/.test(ex.cls), JSON.stringify(ex));
  ok('The reason is not tooltip-only', ex.title === '', ex.title);
  await p.evaluate(() => { S.pdf.locked = false; peState(); });
  ok('The bar line goes back to the count when Export is available', await p.evaluate(() => /\/ \d+/.test($('#peCount').textContent) && !$('#peCount').classList.contains('warn')));
  await p.evaluate(() => peSay('#peAddStatus', 'Could not add pages.', true));
  const er = await p.evaluate(() => { const e = $('#peAddStatus'), bad = getComputedStyle(document.documentElement).getPropertyValue('--bad').trim(); const probe = document.createElement('i'); probe.style.color = bad; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return { err: e.classList.contains('err'), color: getComputedStyle(e).color, want }; });
  ok('An error line is red (the site\'s --bad)', er.err && er.color === er.want, JSON.stringify(er));
  await p.setViewportSize({ width: 320, height: 700 }); await p.waitForTimeout(300);
  await p.evaluate(() => { S.pdf.locked = true; peState(); });
  const fit = await p.evaluate(() => { const c = $('#peCount'), bar = $('#peBar'); return { over: bar.scrollWidth > bar.clientWidth + 1, page: document.documentElement.scrollWidth > innerWidth, h: bar.offsetHeight }; });
  ok('At 320px the bar line fits without overflow', !fit.over && !fit.page, JSON.stringify(fit));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
