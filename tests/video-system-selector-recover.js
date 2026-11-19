// Video, System layout: the selector never stays grey after a page fails to draw, and the time readout follows the playhead when the layout changes.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-selector-recover.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function staffPage(doc, n) { const page = doc.addPage([PW, PH]); for (let k = 0; k < n; k++) { const y = 110 + k * 250; for (const off of [0, 62]) for (let j = 0; j < 5; j++) page.drawLine({ start: { x: 50, y: PH - (y + off + j * 7) }, end: { x: 545, y: PH - (y + off + j * 7) }, thickness: 0.7 }); } }
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); staffPage(doc, 1); staffPage(doc, 3);
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null); await p.waitForTimeout(800);
  await p.evaluate(() => { Transport.seek(S.vStart + 3); });
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4); await p.waitForTimeout(1200);
  const rd = await p.evaluate(() => ({ now: $('#tNow').textContent, want: fmt(S.time - S.vStart) }));
  ok('after a layout change the time readout matches the playhead', rd.now === rd.want, JSON.stringify(rd));
  // a page that fails to draw once: the selector must still show it afterward
  const r = await p.evaluate(async () => {
    const last = S.spreads.length - 1, tgt = S.spreads[last][1], doc0 = S.pdf.doc, real = doc0.getPage.bind(doc0); let fail = true;
    doc0.getPage = n => fail ? (fail = false, Promise.reject(new Error('forced'))) : real(n);
    SEL.bmp = null; SEL.bmpIdx = -1; SEL.want = ''; SEL.sig = '';
    Transport.seek(vEnd()); drawStage(); await new Promise(r => setTimeout(r, 1500));
    const a = { key: SEL.key, bmpIdx: SEL.bmpIdx, page: sysPage(SEL.key) }; doc0.getPage = real;
    Transport.seek(S.vStart); drawStage(); await new Promise(r => setTimeout(r, 1500));
    return Object.assign(a, { startIdx: SEL.bmpIdx, startPage: sysPage(SEL.key) });
  });
  ok('the selector draws the page even after one draw failed', r.bmpIdx === r.page, JSON.stringify(r));
  ok('and the first page after going back to the start', r.startIdx === r.startPage, JSON.stringify(r));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
