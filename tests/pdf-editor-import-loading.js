// PDF Editor, importing a large PDF: new cards shimmer (no flat grey), the line says "Adding pages…", the new pages arrive ticked, at desktop and phone width.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-import-loading.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function mk(name, n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([612, 792]); const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await d.save()); return f; }
(async () => {
  const A = await mk('kf-load-a.pdf', 3), BIG = await mk('kf-load-big.pdf', 40);
  const b = await chromium.launch(); const errs = [];
  for (const [label, vp] of [['desktop', { width: 1300, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const p = await b.newPage({ viewport: vp }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html');
    await p.setInputFiles('#pdfIn', A); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(1500);
    await p.evaluate(() => openPdfEditor()); await p.waitForFunction(() => !$('#pdfDlg').hidden && PE.d); await p.evaluate(() => peTool('pages')); await p.waitForTimeout(500);
    await p.evaluate(() => { window.__hold = true; const real = renderPdfPage; renderPdfPage = async (...a) => { while (window.__hold) await new Promise(r => setTimeout(r, 50)); return real(...a); }; });          // hold the new thumbnails back
    await p.evaluate(() => document.querySelector('input[name=peAddKind][value=pdf]').click()); await p.selectOption('#peAddAt', 'end');
    await p.setInputFiles('#peAddIn', BIG); await p.waitForFunction(() => S.pdf.n === 43 && document.querySelectorAll('#peGrid .page-card').length === 43); await p.waitForTimeout(400);
    const s = await p.evaluate(() => { const cs = [...document.querySelectorAll('#peGrid .page-card')].slice(3); return { line: $('#peAddStatus').textContent, n: cs.length, shim: cs.filter(c => c.classList.contains('loading') && getComputedStyle(c.querySelector('.pe-sheen'), '::before').animationName === 'peSweep' && getComputedStyle(c.querySelector('.pe-sheen'), '::before').animationDuration === '2.6s').length, ticked: cs.filter(c => peTicked(+c.dataset.id)).length, overflow: document.documentElement.scrollWidth > innerWidth }; });
    await p.screenshot({ path: path.join(os.tmpdir(), 'kf-import-loading-' + label + '.png') });          // look at it: the numbers do not say how it reads
    ok(label + ': while loading, the line says Adding pages…', s.line === 'Adding pages…', s.line);
    ok(label + ': every new card shimmers at the slower speed (2.6s)', s.n === 40 && s.shim === 40, JSON.stringify(s));
    ok(label + ': the new pages are ticked', s.ticked === 40, JSON.stringify(s));
    ok(label + ': no page scroll sideways', !s.overflow);
    await p.evaluate(() => { window.__hold = false; }); await p.waitForFunction(() => !document.querySelector('#peGrid .page-card.loading') && !$('#peAddStatus').textContent);
    const e = await p.evaluate(() => ({ line: $('#peAddStatus').textContent, n: document.querySelectorAll('#peGrid .page-card.loading').length, ticked: [...document.querySelectorAll('#peGrid .page-card')].filter(c => peTicked(+c.dataset.id)).length }));
    ok(label + ': when the thumbnails arrive the shimmer and the line go, and the ticks stay', e.line === '' && e.n === 0 && e.ticked === 43, JSON.stringify(e));
    await p.close();
  }
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
