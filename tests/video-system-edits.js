// Video, System layout: edits to a page and saved settings keep or drop its marks.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-edits.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function staffPage(doc, n) {
  const page = doc.addPage([PW, PH]);
  for (let k = 0; k < n; k++) {
    const y = 110 + k * 250;
    for (const off of [0, 62]) for (let j = 0; j < 5; j++) page.drawLine({ start: { x: 50, y: PH - (y + off + j * 7) }, end: { x: 545, y: PH - (y + off + j * 7) }, thickness: 0.7 });
    [50, 300, 545].forEach(x => page.drawLine({ start: { x, y: PH - y }, end: { x, y: PH - (y + 62 + 28) }, thickness: 0.9 }));
    for (let q = 0; q < 8; q++) page.drawEllipse({ x: 70 + q * 60, y: PH - (y + (q % 5) * 7), xScale: 4, yScale: 3 });
  }
  for (let q = 0; q < 12; q++) page.drawEllipse({ x: 150 + q * 25, y: PH - 55, xScale: 6, yScale: 8 });          // a title the finder skips
}
function tiltPage(doc) {          // two systems, the whole page turned 1.5 degrees
  const page = doc.addPage([PW, PH]), a = 1.5 * Math.PI / 180, R = (x, y) => ({ x: 297 + (x - 297) * Math.cos(a) - (y - 421) * Math.sin(a), y: 421 + (x - 297) * Math.sin(a) + (y - 421) * Math.cos(a) });
  for (let k = 0; k < 2; k++) {
    const y = 150 + k * 300;
    for (const off of [0, 62]) for (let j = 0; j < 5; j++) page.drawLine({ start: R(50, PH - (y + off + j * 7)), end: R(545, PH - (y + off + j * 7)), thickness: 0.7 });
    [50, 300, 545].forEach(x => page.drawLine({ start: R(x, PH - y), end: R(x, PH - (y + 90)), thickness: 0.9 }));
    for (let q = 0; q < 8; q++) page.drawEllipse({ ...R(70 + q * 60, PH - (y + (q % 5) * 7)), xScale: 4, yScale: 3 });
  }
}
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); staffPage(doc, 2);
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 3, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
  const n = i => p.evaluate(i => (SYS.byPage.get(i) || { systems: [] }).systems.length, i);
  const hand = () => p.evaluate(() => [...SYS.hand].sort());
  const toastText = () => p.evaluate(() => document.querySelector('#toast').textContent);
  // hand-mark pages 0 and 1: a system removed from each
  await p.evaluate(() => { [0, 1].forEach(i => sysRemove(i, SYS.byPage.get(i).systems[0])); });
  ok('pages 0 and 1 are marked by hand', JSON.stringify(await hand()) === '[0,1]' && await n(0) === 2 && await n(1) === 1);
  // crop page 0 only
  const edit = f => p.evaluate(f => { const r = recipeOf(); f(r); pushHistory(); setRecipe(r); rebuildSpreads(false); }, f);
  await p.evaluate(() => { const r = recipeOf(); r.slots[0].crop = [0.02, 0.02, 0.98, 0.98]; pushHistory(); setRecipe(r); rebuildSpreads(false); });
  await p.waitForTimeout(2500);
  ok('a cropped page is found again', await n(0) === 3, String(await n(0)));
  ok('its hand marks are dropped', JSON.stringify(await hand()) === '[1]');
  ok('the toast names the page', /page 1\b/.test(await toastText()), await toastText());
  ok('an untouched page keeps its marks', await n(1) === 1);
  // undo brings the marks back
  await p.click('#bUndo'); await p.waitForTimeout(1500);
  ok('undo restores the marks', await n(0) === 2 && JSON.stringify(await hand()) === '[0,1]', JSON.stringify([await n(0), await hand()]));
  // leveling (a skew) also re-detects; an inactive page is skipped
  await p.evaluate(() => { const r = recipeOf(); r.slots[1].skew = 0.5; r.slots[2].x = true; r.slots[2].crop = [0, 0, 1, 0.9]; pushHistory(); setRecipe(r); rebuildSpreads(false); });
  await p.waitForTimeout(2500);
  ok('a leveled page is found again', await n(1) === 2 && JSON.stringify(await hand()) === '[0]', JSON.stringify([await n(1), await hand()]));
  ok('the toast names the leveled page', /page 2\b/.test(await toastText()), await toastText());
  ok('an inactive page is not found', !(await p.evaluate(() => SYS.byPage.has(2))));
  await p.click('#bUndo'); await p.waitForTimeout(1500);
  // a repeated page gets its own systems
  await p.evaluate(() => { const r = recipeOf(); const s = Object.assign({}, r.slots[0], { c: true, crop: null, dim: null }); r.slots.push(s); r.order.splice(1, 0, r.slots.length - 1); pushHistory(); setRecipe(r); rebuildSpreads(false); });
  await p.waitForTimeout(2500);
  ok('a repeated page has its own systems', await p.evaluate(() => { const id = S.pdf.slots.length - 1, r = SYS.byPage.get(id); return !!r && r.systems.length > 0 && r !== SYS.byPage.get(0); }));
  await p.click('#bUndo'); await p.waitForTimeout(1000);
  // export and import
  const text = await p.evaluate(() => buildExport('all'));
  ok("the file carries the marks", /"systems":\[/.test(text) && JSON.parse(text).systems.length === 2, text.slice(text.indexOf('"systems"'), text.indexOf('"systems"') + 120));
  await p.evaluate(() => { SYS.hand.forEach(i => { SYS.byPage.delete(i); }); SYS.hand.clear(); SYS.rev++; });
  await p.evaluate(t => importSettings(new File([t], 's.txt')), text); await p.waitForTimeout(2500);
  ok('import brings the marks back', JSON.stringify(await hand()) === '[0,1]' && await n(0) === 2 && await n(1) === 1, JSON.stringify([await hand(), await n(0), await n(1)]));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
