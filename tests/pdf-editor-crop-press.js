// Crop shows its result on press: after pressing Crop, each ticked page card is the cropped page, with no dimmed margin and no frame line over it.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-crop-press.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf() {
  const doc = await PDFDocument.create(), W = 612, H = 792;
  const staves = (pg, x0, x1, y0, y1) => { for (let y = y1; y > y0 + 40; y -= 74) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: x0, y: y - k * 7 }, end: { x: x1, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); };
  staves(doc.addPage([W, H]), 70, 542, 80, 700);
  staves(doc.addPage([W, H]), 150, 470, 200, 600);
  staves(doc.addPage([W, H]), 90, 520, 120, 680);
  const f = path.join(os.tmpdir(), 'kf-crop-press-test.pdf'); fs.writeFileSync(f, await doc.save()); return f;
}
// pixels of the dimmed margin (a bluish grey) and of the frame line (blue) on every card
const marks = () => [...document.querySelectorAll('#peGrid .page-card')].map(c => { const cv = c.querySelector('canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let dim = 0, blue = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 2] > 180 && d[i] < 120) blue++; else if (d[i + 2] - d[i] >= 6 && d[i] < 175) dim++; } return { dim, blue }; });
(async () => {
  const file = await makePdf(), b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  const read = () => p.evaluate(async () => { for (let i = 0; i < 400 && (PE.cropReading || PE.busy || peTargets().some(id => !PE.raw.has(peRawKey(PE.d.slots[id])))); i++) await sleep(25); await sleep(300); });
  const press = () => p.evaluate(async () => { document.querySelector('#peCropAuto').click(); for (let i = 0; i < 300 && (PE.busy || !PE.undo.length); i++) await sleep(25); await sleep(900); });
  await p.evaluate(() => peTool('crop')); await p.waitForTimeout(900); await read();

  // Each page
  await p.evaluate(() => { const sw = document.querySelector('#peCropSame'); if (sw.checked) sw.click(); }); await p.waitForTimeout(300); await read();
  const before = await p.evaluate(marks); await press();
  const after = await p.evaluate(marks), s = await p.evaluate(() => ({ crops: PE.d.slots.map(x => !!x.crop), go: document.querySelector('#peCropAuto').disabled }));
  ok('before the press every card shows its frame and the dimmed margin', before.every(m => m.dim > 300 && m.blue > 100), JSON.stringify(before));
  ok('Each page: after the press every ticked card is the cropped page, with no dimming and no frame line', s.crops.every(Boolean) && after.every(m => m.dim === 0 && m.blue === 0), JSON.stringify({ after, crops: s.crops }));
  ok('Each page: the Crop button is greyed out once every ticked page is cropped', s.go);

  // Same size
  await p.evaluate(() => { peUndo(); peTool('crop'); const sw = document.querySelector('#peCropSame'); if (!sw.checked) sw.click(); }); await p.waitForTimeout(900); await read();
  const b2 = await p.evaluate(marks); await press();
  const a2 = await p.evaluate(marks), s2 = await p.evaluate(() => ({ crops: PE.d.slots.map(x => !!x.crop), go: document.querySelector('#peCropAuto').disabled }));
  ok('Same size: after the press every ticked card is the cropped page, with no dimming and no frame line, and the button is greyed out', b2.every(m => m.dim > 300) && s2.crops.every(Boolean) && a2.every(m => m.dim === 0 && m.blue === 0) && s2.go, JSON.stringify({ b2, a2, s2 }));

  // Manual
  await p.evaluate(() => { peUndo(); peTool('crop'); }); await p.waitForTimeout(900); await read();
  await p.evaluate(() => document.querySelector('input[name=peCropMode][value=hand]').click()); await p.waitForTimeout(900);
  await p.evaluate(async () => { document.querySelector('#peOneBack').click(); await sleep(400); });
  const g3 = await p.evaluate(() => ({ go: document.querySelector('#peCropAuto').disabled, dims: [...document.querySelectorAll('#peGrid .page-card')].length }));
  ok('Manual: with nothing drawn and no page open, Crop is greyed out', g3.go, JSON.stringify(g3));
  await p.evaluate(async () => { peOneOpen(peTargets()[0]); await sleep(900); });
  const g4 = await p.evaluate(() => ({ off: document.querySelector('#peCropAuto').disabled, box: peBoxNow && peBoxNow.slice() })); ok('Manual: with a page open and nothing drawn, Crop is greyed out and the frame is the whole page', g4.off && g4.box && g4.box.join() === '0,0,1,1', JSON.stringify(g4));
  await p.evaluate(() => { peHandSet(PE.one, [0.1, 0.1, 0.9, 0.9]); peCropPaint([0.1, 0.1, 0.9, 0.9]); peActs(); });
  await press();
  const a3 = await p.evaluate(marks), s3 = await p.evaluate(() => ({ crops: PE.d.slots.map(x => !!x.crop), go: document.querySelector('#peCropAuto').disabled }));
  ok('Manual: after the press the open page is the cropped page, with no dimming and no frame line, no other page is cropped, and the button is greyed out', s3.crops.filter(Boolean).length === 1 && a3[0].dim === 0 && a3[0].blue === 0 && s3.go, JSON.stringify({ a3, s3 }));

  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
})();
