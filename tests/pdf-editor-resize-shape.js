// Re-size page shape: "Same shape on all" (the default) fits every page into the document's own shape, as before;
// "Keep each page's shape" lets a landscape page stay landscape. Neither raises a popup or a message about mixed shapes.
// The check makes a mixed-shape PDF (portrait, landscape, portrait), picks Tabloid, presses Re-size, exports, and reads the saved page sizes.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-resize-shape.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const mk = await PDFDocument.create(); [[612, 792], [792, 612], [612, 792]].forEach(s => mk.addPage(s).drawRectangle({ x: 40, y: 40, width: 100, height: 60 }));
  const pdf = Buffer.from(await mk.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000);
  const errs = [], dialogs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); }); p.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  const sizesAfter = async shape => {
    await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', { name: 'mixed.pdf', mimeType: 'application/pdf', buffer: pdf }); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(1200);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800); await p.click('#peRail .pe-tab[data-tool=resize]'); await p.waitForTimeout(700);
    await p.click('.rz-opt[data-k=tabloid]'); await p.waitForTimeout(300);
    if (shape) { await p.click('.rz-shape[data-k=' + shape + ']'); await p.waitForTimeout(300); }
    await p.click('#peRzGo'); await p.waitForTimeout(1200);
    const seen = await p.evaluate(() => ({ sheets: [...document.querySelectorAll('dialog[open], .sheet:not([hidden])')].filter(e => e.offsetParent).map(e => e.id), toast: document.querySelector('#toast').textContent, status: [...document.querySelectorAll('#peViewResize .pe-status, #peViewResize [role=status]')].map(e => e.textContent).join('|') }));
    const bytes = await p.evaluate(async () => { let out = null; window.saveFile = async blob => { out = Array.from(new Uint8Array(await blob.arrayBuffer())); }; document.querySelector('#peExport').click(); for (let i = 0; i < 200 && !out; i++) await new Promise(r => setTimeout(r, 100)); return out || document.querySelector("#toast").textContent; });
    if (!Array.isArray(bytes)) throw new Error("no file: " + bytes); const doc = await PDFDocument.load(Uint8Array.from(bytes));
    return { sizes: doc.getPages().map(g => g.getSize()).map(s => [Math.round(s.width), Math.round(s.height)]), seen };
  };
  const quiet = s => !/shape|landscape|portrait|differ|mixed/i.test(s.seen.toast + s.seen.status) && s.seen.sheets.length === 0;
  const same = await sizesAfter(null), want = JSON.stringify([[792, 1224], [792, 1224], [792, 1224]]);
  ok('the default is Same shape on all: every page ends up tabloid portrait, as before', JSON.stringify(same.sizes) === want, JSON.stringify(same.sizes));
  ok('Same shape on all shows no popup or shape message for mixed pages', quiet(same), JSON.stringify(same.seen));
  const each = await sizesAfter('each');
  ok("Keep each page's shape: the landscape page stays landscape, portrait pages stay portrait", JSON.stringify(each.sizes) === JSON.stringify([[792, 1224], [1224, 792], [792, 1224]]), JSON.stringify(each.sizes));
  ok("Keep each page's shape shows no popup or shape message", quiet(each), JSON.stringify(each.seen));
  const again = await sizesAfter('same');
  ok('choosing Same shape on all by hand gives the default output', JSON.stringify(again.sizes) === want, JSON.stringify(again.sizes));
  ok('no browser dialogs and no page errors', dialogs.length === 0 && errs.length === 0, dialogs.concat(errs).join(' | ')); await b.close();
})();
