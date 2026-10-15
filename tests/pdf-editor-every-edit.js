// PDF Editor: every grid thumbnail shows the page with all its edits (clean, crop, level), whatever tool is open;
// the open tool's large view takes off only that tool's own edit.
// A made PDF: three pages of staves on cream paper, so a cleaned page is told by its white paper and a cropped page by where the music sits.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-every-edit.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf() {
  const doc = await PDFDocument.create(), W = 612, H = 792;
  for (let i = 0; i < 3; i++) {
    const pg = doc.addPage([W, H]); pg.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.94, 0.9, 0.78) });
    for (let y = 600; y > 200; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 150, y: y - k * 7 }, end: { x: 460, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) });
  }
  const f = path.join(os.tmpdir(), 'kf-every-edit-test.pdf'); fs.writeFileSync(f, await doc.save()); return f;
}
// a card's picture: the colour at a point given as a fraction of the card, and the share of dark pixels
const cardPx = ([id, fx, fy]) => { const cv = document.querySelector('#peGrid .page-card[data-id="' + id + '"] canvas'), d = cv.getContext('2d').getImageData(Math.round(fx * (cv.width - 1)), Math.round(fy * (cv.height - 1)), 1, 1).data; return [d[0], d[1], d[2]]; };
// the widest run of dark pixels in a row, as a share of the card's width: the music spans most of the card once the page is cropped to it
const darkRun = id => { const cv = document.querySelector('#peGrid .page-card[data-id="' + id + '"] canvas'), w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data; let best = 0;
  for (let y = 0; y < h; y++) { let a = -1, z = -1; for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 110) { if (a < 0) a = x; z = x; } if (a >= 0) best = Math.max(best, z - a + 1); } return best / w; };
// a large view's picture: the paper colour near its bottom middle and how much of its width the dark pixels span
const bigPx = sel => { const cv = document.querySelector(sel), w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data; let a = w, z = -1;
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4] < 110) { if (x < a) a = x; if (x > z) z = x; }
  const o = (Math.round(h * 0.97) * w + Math.round(w * 0.5)) * 4; return { paper: [d[o], d[o + 1], d[o + 2]], span: z < 0 ? 0 : (z - a + 1) / w }; };
const bigShown = async (p, sel) => { await p.evaluate(async () => { for (let i = 0; i < 400 && (document.querySelector('#peCropPg').classList.contains('loading') || document.querySelector('#peCropPg').classList.contains('busy') || PE.busy); i++) await sleep(25); await sleep(900); }); return p.evaluate(bigPx, sel); };
(async () => {
  const file = await makePdf(), b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  const settle = () => p.evaluate(async () => { for (let i = 0; i < 400 && (PE.busy || VTpending.size || PE.full.size && [...PE.full.values()].some(v => v && v.then)); i++) await sleep(25); await sleep(500); });
  const white = c => c[0] > 250 && c[1] > 250 && c[2] > 250;
  // slice 1: Crop's grid draws the page cleaned
  await p.evaluate(() => { PE.d.order.forEach(id => { PE.d.slots[id].bg = 1; }); peTool('crop'); }); await settle();
  const c1 = await p.evaluate(cardPx, [0, 0.35, 0.30]);
  ok('Crop: a cleaned page is drawn cleaned on the grid (white paper inside the frame)', c1 && white(c1), JSON.stringify(c1));
  // slice 2: a cropped page is cropped on the grid of every other tool
  await p.evaluate(() => { PE.d.order.forEach(id => { PE.d.slots[id].bg = 0; }); peTool('pages'); }); await settle();
  const before = await p.evaluate(darkRun, 0);
  await p.evaluate(() => { PE.d.slots[PE.d.order[0]].crop = [0.2, 0.2, 0.8, 0.8]; peRender(false); });
  for (const tool of ['pages', 'clean', 'skew', 'wm']) {
    await p.evaluate(t => { peTool(t); }, tool); await settle();
    const r = await p.evaluate(darkRun, 0); ok(tool + ': a cropped page is drawn cropped on the grid', r > before + 0.2, before.toFixed(2) + ' -> ' + r.toFixed(2));
  }
  // slice 3: Re-kilter's large view keeps the crop and the clean on both sides; only the leveling differs
  await p.evaluate(() => { const sl = PE.d.slots[PE.d.order[0]]; sl.bg = 1; sl.skew = 1; sl.crop = [0.2, 0.2, 0.8, 0.8]; peTool('skew'); peOneOpen(PE.d.order[0]); });
  const lv = await bigShown(p, '#peCropCv'), og = await p.evaluate(bigPx, '#peOneOrig');
  ok('Re-kilter large: the leveled side is cleaned and cropped', white(lv.paper) && lv.span > 0.7, JSON.stringify(lv));
  ok('Re-kilter large: the Original side keeps the clean and the crop', white(og.paper) && og.span > 0.7, JSON.stringify(og));
  // slice 4: Crop's large view shows the cleaned and leveled page whole, with the frame over it; Clean's keeps the crop and the leveling
  await p.evaluate(() => { peOneClose(); peTool('crop'); peOneOpen(PE.d.order[0]); });
  const cr = await bigShown(p, '#peCropCv');
  ok('Crop large: the page is cleaned and whole (the frame shows the crop)', white(cr.paper) && cr.span > 0.4 && cr.span < 0.6, JSON.stringify(cr));
  await p.evaluate(() => { peOneClose(); peTool('clean'); peOneOpen(PE.d.order[0]); });
  const cl = await bigShown(p, '#peCropCv'), clo = await p.evaluate(bigPx, '#peOneOrig');
  ok('Clean large: both sides keep the crop; the Original side is not cleaned', cl.span > 0.7 && clo.span > 0.7 && !white(clo.paper) && white(cl.paper), JSON.stringify({ cl, clo }));
  // slice 5: a setting changed in Clean's large view dims the whole view at once, on both sides, until the new picture is in
  await p.evaluate(() => { window.__clean = pdfCleanCanvas; pdfCleanCanvas = async (...a) => { await sleep(2500); return window.__clean(...a); }; });
  await p.click('label:has(input[name=peClSp][value="2"])'); await p.waitForTimeout(500);
  const dim = await p.evaluate(() => ({ busy: document.querySelector('#peCropPg').classList.contains('busy'), cleaned: +getComputedStyle(document.querySelector('#peCropCv')).opacity, orig: +getComputedStyle(document.querySelector('#peOneOrig')).opacity }));
  ok('Clean large: a setting change dims both sides at once', dim.busy && dim.cleaned < 0.8 && dim.orig < 0.8, JSON.stringify(dim));
  await p.evaluate(() => { pdfCleanCanvas = window.__clean; });
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
