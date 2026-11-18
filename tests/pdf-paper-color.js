// One paper color per page: Resize padding (the PDF Editor's cards, the video's page pictures, the exported PDF) and the back of the turning page (Single page and System) are the page's own paper,
// not white. A white score stays white; a page cleaned to white pads in white; the exported PDF's pages stay vector.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-paper-color.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const CREAM = [242, 232, 204], near = (a, b, tol = 14) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
(async () => {
  const doc = await PDFDocument.create();
  for (let n = 0; n < 3; n++) { const p = doc.addPage([595, 842]); p.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(CREAM[0] / 255, CREAM[1] / 255, CREAM[2] / 255) }); for (let k = 0; k < 3; k++) for (let j = 0; j < 5; j++) p.drawLine({ start: { x: 50, y: 700 - k * 220 - j * 7 }, end: { x: 545, y: 700 - k * 220 - j * 7 }, thickness: 0.8 }); }
  const cream = Buffer.from(await doc.save());
  const b = await chromium.launch(), errs = [];
  const open = async (file, buf) => {
    const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
    await p.setInputFiles('#pdfIn', buf ? { name: file, mimeType: 'application/pdf', buffer: buf } : FX + '/' + file); await p.waitForFunction(() => S.pdf && S.pdf.keep.length >= 2 && S.thumbs[0] && S.thumbs[1]); await p.waitForTimeout(800);
    return p;
  };
  // the pixel at the top left of a card's picture, and of a page picture the video draws
  const corner = (p, sel) => p.evaluate(sel => { const c = document.querySelector(sel); const d = c.getContext('2d').getImageData(2, 2, 1, 1).data; return [d[0], d[1], d[2]]; }, sel);
  const pageCorner = p => p.evaluate(async () => { const cv = await PageSource.render(0, 300, 520); const d = cv.getContext('2d').getImageData(2, 2, 1, 1).data; return [d[0], d[1], d[2]]; });
  for (const [label, file, buf, want] of [['cream', 'cream.pdf', cream, CREAM], ['white', 'score.pdf', null, [255, 255, 255]]]) {
    const p = await open(file, buf);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200); await p.evaluate(() => peTool('resize')); await p.waitForTimeout(500);
    await p.evaluate(() => rzPick({ w: 11, h: 17 })); await p.waitForTimeout(900);
    const pend = await corner(p, '#peGrid .page-card canvas'); ok(label + ': the choice previewed on a card pads in the paper color', near(pend, want), pend.join(','));
    await p.evaluate(() => peSetSize({ w: 11, h: 17 }, false)); await p.waitForTimeout(1800);
    const card = await corner(p, '#peGrid .page-card canvas'); ok(label + ': a resized card pads in the paper color', near(card, want), card.join(','));
    const pdf = await p.evaluate(async () => {
      const bl = await buildPdfBlob(PE.d), buf = new Uint8Array(await bl.arrayBuffer()), doc = await pdfjsLib.getDocument({ data: buf }).promise, pg = await doc.getPage(1), vp = pg.getViewport({ scale: 0.5 });
      const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; const x = cv.getContext('2d', { alpha: false }); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
      const ops = await pg.getOperatorList(), O = pdfjsLib.OPS, img = ops.fnArray.filter(f => f === O.paintImageXObject || f === O.paintInlineImageXObject).length;
      await pg.render({ canvasContext: x, viewport: vp }).promise; const d = x.getImageData(2, 2, 1, 1).data; return { px: [d[0], d[1], d[2]], img, ratio: +(vp.height / vp.width).toFixed(2) };
    });
    ok(label + ': the exported PDF pads in the paper color, 11 × 17', near(pdf.px, want) && Math.abs(pdf.ratio - 17 / 11) < 0.02, JSON.stringify(pdf));
    ok(label + ': and its pages are still vector', pdf.img === 0, 'images ' + pdf.img);
    await p.evaluate(() => $('#peDone').click()); await p.waitForTimeout(2200);
    const vid = await pageCorner(p); ok(label + ': the video\'s page picture pads in the paper color', near(vid, want), vid.join(','));
    if (label === 'cream') {
      await p.evaluate(() => { S.pdf.slots[0].bg = 1; S.pdf.slots[0].sp = 1; VT.clear(); }); await p.waitForTimeout(300);
      const cl = await p.evaluate(async () => { const cv = await PageSource.render(0, 300, 520); const d = cv.getContext('2d').getImageData(2, 2, 1, 1).data; return [d[0], d[1], d[2]]; });
      ok('cream cleaned: its padding is what the cleaned page reads as', cl.every(v => v > 230), cl.join(','));
    }
    await p.context().close();
  }
  // the back of the turning page
  const back = async (lay, invert) => {
    const p = await open('cream.pdf', cream);
    await p.setInputFiles('#audioIn', FX + '/stereo.wav'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(600);
    await p.evaluate(([l, inv]) => { const r = document.querySelector('input[name=pageLayout][value=' + l + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); S.set.invert = inv; stageDirty = true; }, [lay, invert]);
    if (lay === 'system') await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 3); await p.waitForTimeout(1500);
    await p.evaluate(() => { Transport.pause(); S.time = S.turns[0] - refOffset() + flipDur() * 0.55; fadeLookAt = S.time; stageDirty = true; drawStage(); }); await p.waitForTimeout(600);
    await p.evaluate(() => { stageDirty = true; drawStage(); });
    const r = await p.evaluate(() => { const c = document.querySelector('#stage'), W = c.width, H = c.height, t = document.createElement('canvas'); t.width = W; t.height = H; const x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, W, H).data, hits = [];
      for (let yy = Math.round(H * .2); yy < H * .8; yy += 8) for (let xx = 0; xx < W; xx += 4) { const i = (yy * W + xx) * 4; hits.push([d[i], d[i + 1], d[i + 2], xx]); } return hits; });
    await p.context().close(); return r;
  };
  for (const lay of ['single', 'system']) {
    const px = (await back(lay, false)).filter(q => q[0] > 120 && q[2] < 235);          // lit paper (not the black frame): cream has less blue than red, white has none of that
    const white = (await back(lay, false)).filter(q => q[0] > 90 && Math.abs(q[0] - q[2]) < 6).length;
    ok(lay + ', cream paper, mid-turn: the turning sheet is cream all over (no white sheet)', px.length > 200 && white < 40, 'cream ' + px.length + ', white ' + white);
  }
  const inv = await back('single', true); ok('Single page with Invert colors: the back follows Invert like the front (no light sheet)', inv.filter(q => q[0] > 180).length < inv.length * 0.03, 'light ' + inv.filter(q => q[0] > 180).length + ' of ' + inv.length);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
