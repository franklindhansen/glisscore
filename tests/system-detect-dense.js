// Systems: a dense page of solo staves where beams and slurs join into the staff lines. A beam across the middle lines makes one thick lump of them, a stray stroke above a staff
// breaks the five-line count, and a staff can be one solid lump; each must still be found as its own system.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/system-detect-dense.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842, d = 6.5;
function page(doc, n, beamed, stray, lump) {
  const pg = doc.addPage([PW, PH]), line = (x0, y0, x1, y1, t) => pg.drawLine({ start: { x: x0, y: PH - y0 }, end: { x: x1, y: PH - y1 }, thickness: t, color: rgb(0, 0, 0) });
  for (let k = 0; k < n; k++) {
    const y = 60 + k * 70;
    for (let j = 0; j < 5; j++) line(50, y + j * d, 545, y + j * d, 0.7);
    if (beamed.includes(k)) pg.drawRectangle({ x: 50, y: PH - (y + 3.1 * d), width: 495, height: 2.2 * d, color: rgb(0, 0, 0) });          // a long beam over the three middle lines
    if (stray.includes(k)) line(100, y - 9, 330, y - 9, 1);                                                                           // a stray stroke just above the staff
    if (lump.includes(k)) pg.drawRectangle({ x: 50, y: PH - (y + 4.2 * d), width: 495, height: 4.4 * d, color: rgb(0, 0, 0) });       // all five lines run together
    for (let q = 0; q < 8; q++) pg.drawEllipse({ x: 70 + q * 55, y: PH - (y + (q % 5) * d), xScale: 3.5, yScale: 2.6, color: rgb(0, 0, 0) });
  }
}
(async () => {
  const doc = await PDFDocument.create();
  page(doc, 10, [], [], []);                  // 0: plain, the reference
  page(doc, 10, [2, 5, 8], [], []);           // 1: three staves with a beam across their middle lines
  page(doc, 10, [], [3, 6], []);              // 2: a stray stroke above two staves
  page(doc, 10, [], [], [9]);                 // 3: the last staff a solid lump
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'dense.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const find = i => p.evaluate(async i => (await sysDetectPage(i)).systems.map(s => [s.top, s.bottom]), i);
  const names = ['a plain page', 'three beamed staves', 'a stray stroke above two staves', 'a solid lump for the last staff'];
  for (let i = 0; i < 4; i++) { const r = await find(i); ok(names[i] + ': ten systems, none overlapping', r.length === 10 && r.every((s, k) => !k || r[k - 1][1] <= s[0] + 0.0005), String(r.length)); }
  const r3 = await find(3); ok('the lump is the last system, at its place', r3.length === 10 && r3[9][0] < (60 + 9 * 70 + 8) / PH && r3[9][1] > (60 + 9 * 70 + 20) / PH, JSON.stringify(r3[9]));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
