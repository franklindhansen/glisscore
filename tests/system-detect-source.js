// Systems: a page is measured through its slot's source page, so a reordered or repeated page is measured as the page it shows.
// Page 0 holds three systems and page 1 holds one; the slots are then swapped, and one is made a repeat.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/system-detect-source.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function drawPage(doc, ys) {
  const page = doc.addPage([PW, PH]), line = (x0, y0, x1, y1, t) => page.drawLine({ start: { x: x0, y: PH - y0 }, end: { x: x1, y: PH - y1 }, thickness: t, color: rgb(0, 0, 0) });
  ys.forEach(y => {
    [0, 62].forEach(off => { for (let k = 0; k < 5; k++) line(50, y + off + k * 7, 545, y + off + k * 7, 0.7); });
    [50, 297, 545].forEach(x => [0, 62].forEach(off => line(x, y + off, x, y + off + 28, 0.8))); line(50, y, 50, y + 90, 0.9);
    [0, 62].forEach(off => { for (let k = 0; k < 8; k++) page.drawEllipse({ x: 70 + k * 60, y: PH - (y + off + (k % 5) * 7), xScale: 4, yScale: 3, color: rgb(0, 0, 0) }); });
  });
}
(async () => {
  const doc = await PDFDocument.create();
  drawPage(doc, [130, 360, 590]);          // 0: three systems
  drawPage(doc, [300]);                    // 1: one system
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'two.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 2, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const counts = () => p.evaluate(async () => { SYS.stop(); SYS.byPage.clear(); S.pdf.gen++; await sysDetectAll(); return [0, 1].map(i => SYS.byPage.get(i).systems.length); });
  ok('in order: the slots read their own pages', JSON.stringify(await counts()) === '[3,1]');
  await p.evaluate(() => { S.pdf.slots[0].src = 1; S.pdf.slots[1].src = 0; });
  ok('swapped: each slot is measured as the page it shows', JSON.stringify(await counts()) === '[1,3]', JSON.stringify(await counts()));
  await p.evaluate(() => { S.pdf.slots[0].src = 0; S.pdf.slots[1].src = 0; });
  ok('a repeated page: both slots find its three systems', JSON.stringify(await counts()) === '[3,3]', JSON.stringify(await counts()));
  // the sheet is cut with the same boxes: slot 0 shows page 1's one system, so its sheet is built from that one box
  await p.evaluate(() => { S.pdf.slots[0].src = 1; S.pdf.slots[1].src = 0; });
  await counts();
  const sheet = await p.evaluate(async () => { const f = sysFit(0, 1280, 720), r = SYS.byPage.get(0); return { n: r.systems.length, top: f.box.top, bottom: f.box.bottom, src: S.pdf.slots[0].src }; });
  ok('the box drawn for slot 0 is the one found on its source page', sheet.n === 1 && sheet.src === 1 && sheet.top > 0.25 && sheet.bottom < 0.5, JSON.stringify(sheet));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
