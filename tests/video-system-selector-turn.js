// Video, System layout: the selector moves to the next page at the middle of the turn, not after the turn ends.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-selector-turn.js
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
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4); await p.waitForTimeout(1200);
  // the last system of page 1 is spread 2 (3 systems), its turn goes to page 2
  const r = await p.evaluate(() => {
    const i = S.spreads.findIndex((sp, j) => S.spreads[j + 1] && sysPage(sp[1]) !== sysPage(S.spreads[j + 1][1])), D = flipDur(), t0 = S.turns[i] - refOffset(), at = f => { S.time = t0 + D * f; drawStage(); return SEL.key; };
    const out = { from: S.spreads[i][1], to: S.spreads[i + 1][1], before: at(0.3), after: at(0.7), end: at(1.01) }; S.time = 0; drawStage(); return out;
  });
  ok('before the middle of the turn the selector still shows the old page', r.before === r.from, JSON.stringify(r));
  ok('after the middle it shows the next page', r.after === r.to, JSON.stringify(r));
  ok('it stays on the next page when the turn ends', r.end === r.to, JSON.stringify(r));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
