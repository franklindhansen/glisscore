// PDF Editor, the large view and its neighbors: a double-click opens it from Re-kilter, Crop and Clean without changing a page's tick; the page box has the page's own shape at once;
// the back arrow sits at the top left; the page zooms (buttons, double-click, Ctrl+wheel), moves when larger than the window and fits again; another PDF starts with nothing remembered from the last one;
// Crop says so when the margin has no room; the number under a card slides sideways with its card.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-view.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf(name, x0, x1, n = 3, top = 700, bot = 100) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) { const pg = doc.addPage([612, 792]); for (let y = top; y > bot; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: x0, y: y - k * 7 }, end: { x: x1, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await doc.save()); return f;
}
(async () => {
  const A = await makePdf('kf-view-a.pdf', 80, 530), B = await makePdf('kf-view-b.pdf', 0, 612, 3, 800, -40), C = await makePdf('kf-view-c.pdf', 200, 400);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', A); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  // double-click
  for (const tool of ['clean', 'skew', 'crop']) {
    await p.evaluate(t => { PE.one = null; peTool(t); }, tool); await p.waitForTimeout(900);
    const before = await p.evaluate(() => PE.d.order.map(id => PE.skip.has(id) ? 0 : 1).join());
    await p.dblclick('#peGrid .page-card:nth-child(2) .pe-thumb', { position: { x: 40, y: 80 } }); await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({ one: PE.one, ticks: PE.d.order.map(id => PE.skip.has(id) ? 0 : 1).join(), shown: document.querySelector('#peWin').classList.contains('one') }));
    ok('Double-click opens the large view in ' + tool + ' and leaves the ticks as they were', r.shown && r.one != null && r.ticks === before, JSON.stringify({ before, r }));
    await p.evaluate(() => peOneClose());
  }
  await p.evaluate(() => { PE.one = null; peTool('pages'); }); await p.waitForTimeout(700);
  await p.dblclick('#peGrid .page-card:nth-child(2) .pe-thumb', { position: { x: 40, y: 80 } }); await p.waitForTimeout(300);
  const pg = await p.evaluate(() => ({ one: PE.one, ticks: PE.d.order.map(id => PE.d.slots[id].x ? 0 : 1).join() }));
  ok('In Arrange a double-click does not open the large view (and two clicks leave the page as it was)', pg.one == null && pg.ticks === '1,1,1', JSON.stringify(pg));
  // large view
  await p.evaluate(() => { peTool('clean'); }); await p.waitForTimeout(900);
  const shape = await p.evaluate(() => { PE.one = PE.d.order[0]; peState(); const g = document.querySelector('#peCropPg'); return { w: g.offsetWidth, h: g.offsetHeight, loading: g.classList.contains('loading') }; });
  ok('The page box has the page\'s own shape the moment the view opens, while it loads', Math.abs(shape.w / shape.h - 612 / 792) < 0.02 && shape.loading, JSON.stringify(shape));
  await p.waitForFunction(() => !document.querySelector('#peCropPg').classList.contains('loading')); await p.waitForTimeout(300);
  const back = await p.evaluate(() => { const b = document.querySelector('#peOneBack').getBoundingClientRect(), s = document.querySelector('#peCropStage').getBoundingClientRect(), n = document.querySelector('.pe-nav').contains(document.querySelector('#peOneBack')); return { dx: Math.round(b.left - s.left), dy: Math.round(b.top - s.top), n, label: document.querySelector('#peOneBack').getAttribute('aria-label') }; });
  ok('The back arrow is at the stage\'s top left and no longer in the bottom bar', back.dx < 24 && back.dy < 24 && !back.n && back.label === 'Back to all pages', JSON.stringify(back));
  const zs = async () => p.evaluate(() => ({ z: PE.zm.z, x: Math.round(PE.zm.x), y: Math.round(PE.zm.y), tf: document.querySelector('#peCropPg').style.transform }));
  await p.click('#peZmIn'); await p.waitForTimeout(500); const z1 = await zs();
  ok('Zoom in enlarges the page', z1.z > 1.5 && /scale/.test(z1.tf), JSON.stringify(z1));
  await p.click('#peZmFit'); await p.waitForTimeout(500); const z2 = await zs();
  ok('Fit puts it back', z2.z === 1 && z2.tf === '', JSON.stringify(z2));
  const box = await p.locator('#peCropPg').boundingBox();
  await p.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height * 0.3); await p.waitForTimeout(500); const z3 = await zs();
  ok('Double-click on the page zooms in at the pointer, again zooms out', z3.z > 2, JSON.stringify(z3));
  await p.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width * 0.8 + 60, box.y + box.height / 2 + 40, { steps: 6 }); await p.mouse.up(); const z4 = await zs();
  ok('A zoomed page moves with a drag', z4.x !== z3.x || z4.y !== z3.y, JSON.stringify({ z3, z4 }));
  await p.keyboard.press('0'); await p.waitForTimeout(500); const z5 = await zs();
  ok('0 fits the page', z5.z === 1, JSON.stringify(z5));
  await p.keyboard.press('+'); await p.waitForTimeout(500); await p.evaluate(() => peOneStep(1)); await p.waitForTimeout(500); const z6 = await zs();
  ok('Another page opens at the fit size', z6.z === 1, JSON.stringify(z6));
  await p.click('#peOneBack'); await p.waitForTimeout(400);
  ok('The back arrow returns to the pages', await p.evaluate(() => PE.one == null && !document.querySelector('#peWin').classList.contains('one')));
  // the number slides sideways, the way its card moves
  await p.evaluate(() => { peTool('pages'); }); await p.waitForTimeout(800);
  const before = await p.evaluate(() => { const o = PE.d.order.slice(); PE.d.order = [o[1], o[0], o[2]]; peRender(true); return o; });
  const slides = await p.evaluate(() => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('pe-strip')).map(a => ({ id: +a.effect.target.closest('.page-card').dataset.id, ms: a.effect.getTiming().duration, first: a.effect.getKeyframes()[0].transform })));
  ok('The number under a card slides sideways with it, in about 340ms', slides.length >= 2 && slides.every(s => s.ms <= 360), JSON.stringify(slides));
  const startOf = id => { const m = /\((-?[\d.]+)/.exec((slides.find(s => s.id === id) || {}).first || ''); return m ? +m[1] : NaN; };          // the strip's first position: -50% (its number comes in from the left) or 0px
  ok('A number slides the way its card moved: a card that moves right sends its number right', startOf(before[0]) < 0 && startOf(before[1]) === 0, JSON.stringify({ before, slides }));
  // Crop: no room for margin
  await p.evaluate(() => { PE.d.order = [0, 1, 2]; peTool('crop'); }); await p.waitForTimeout(900);
  await p.evaluate(async () => { for (let i = 0; i < 400 && (PE.cropReading || peTargets().some(id => !PE.raw.has(peRawKey(PE.d.slots[id])))); i++) await sleep(25); await sleep(250); });
  const n1 = await p.evaluate(() => ({ hidden: !document.querySelector('#peCropSub').classList.contains('warn'), pad: document.querySelector('#peCropPad').value, text: document.querySelector('#peCropSub').textContent }));
  ok('A margin that still has room gives no note', n1.hidden, JSON.stringify(n1));
  await p.evaluate(() => { const e = document.querySelector('#peCropPad'); e.value = 8; e.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  const n2 = await p.evaluate(() => ({ hidden: !document.querySelector('#peCropSub').classList.contains('warn'), box: peCropBox(PE.d.order[0]).box }));
  ok('When the frame cannot grow any more the note says so', n2.hidden === !(n2.box[0] < 0.002 && n2.box[2] > 0.998 && n2.box[1] < 0.002 && n2.box[3] > 0.998), JSON.stringify(n2));
  // another PDF
  const a1 = await p.evaluate(async () => { const sc = await peScan(0, 200, null); return { gen: S.pdf.gen, ink: sc.n, asp: PE.asp ? PE.asp.size : 0 }; });
  await p.evaluate(() => closePdfEditor(false));
  await p.setInputFiles('#pdfIn', B); await p.waitForFunction(() => S.pdf && S.pdf.name === 'kf-view-b'); await p.waitForTimeout(800);
  const b1 = await p.evaluate(async () => { const left = { vt: VT.size, pea: PEA.cache.size, asp: PE.asp ? PE.asp.size : 0 }; const sc = await peScan(0, 200, null); openPdfEditor(); return { gen: S.pdf.gen, ink: sc.n, left, cl: PE.cl, slots: PE.d.slots.map(s => [s.bg, s.sp, s.skew, !!s.crop].join()).join('|'), mode: PE.mode, one: PE.one }; });
  ok('Another PDF starts with nothing from the last one: its own number, nothing remembered, its own scan, default choices', b1.gen !== a1.gen && b1.left.vt === 0 && b1.left.pea === 0 && b1.left.asp === 0 && b1.ink !== a1.ink && b1.cl.bg === 1 && b1.cl.sp === 1 && /^0,0,0,false/.test(b1.slots) && b1.mode === 'pages', JSON.stringify({ a1, b1 }));
  await p.evaluate(() => { peTool('crop'); }); await p.waitForTimeout(900);
  await p.evaluate(async () => { for (let i = 0; i < 400 && (PE.cropReading || peTargets().some(id => !PE.raw.has(peRawKey(PE.d.slots[id])))); i++) await sleep(25); await sleep(250); const e = document.querySelector('#peCropPad'); e.value = 4; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(400);
  const n3 = await p.evaluate(() => ({ hidden: !document.querySelector('#peCropSub').classList.contains('warn'), text: document.querySelector('#peCropSub').textContent, box: peCropBox(PE.d.order[0]).box.map(v => +v.toFixed(3)) }));
  ok('Music that fills the page: the note takes the subtitle line and says the margin has no room', !n3.hidden && /no room to add margin/i.test(n3.text) , JSON.stringify(n3));
  // a big move: 60 pages, every order reversed, timed from the start of the render (the numbers and cards start together)
  await p.evaluate(() => closePdfEditor(false));
  const D = await makePdf('kf-view-d.pdf', 80, 530, 60);
  await p.setInputFiles('#pdfIn', D); await p.waitForFunction(() => S.pdf && S.pdf.name === 'kf-view-d'); await p.waitForTimeout(800);
  await p.evaluate(() => { openPdfEditor(); peTool('pages'); }); await p.waitForFunction(() => document.querySelectorAll('#peGrid .page-card').length === 60); await p.waitForTimeout(900);
  const big = await p.evaluate(() => { PE.d.order = PE.d.order.slice().reverse(); const t0 = performance.now(); peRender(true); const ms = performance.now() - t0; return { ms: Math.round(ms), slid: document.querySelectorAll('#peGrid .pe-strip').length }; });
  ok('A move of 60 pages starts its number slides within 100ms', big.ms < 100 && big.slid >= 50, JSON.stringify(big));
  // swapping the first card with the one a row below it moves them up and down in the same column: down sends the number right, up sends it left
  const vert = await p.evaluate(() => {
    const o = PE.d.order.slice(), kids = Array.from(document.querySelector('#peGrid').children), cols = kids.filter(c => c.offsetTop === kids[0].offsetTop).length;
    [PE.d.order[0], PE.d.order[cols]] = [o[cols], o[0]]; peRender(true);
    const first = id => { const a = document.getAnimations().find(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('pe-strip') && +a.effect.target.closest('.page-card').dataset.id === id); const m = a && /\((-?[\d.]+)/.exec(a.effect.getKeyframes()[0].transform); return m ? +m[1] : NaN; };
    return { cols, down: first(o[0]), up: first(o[cols]) };
  });
  ok('A card that moves down a row sends its number right, and one that moves up a row sends it left', vert.cols >= 2 && vert.down === -50 && vert.up === 0, JSON.stringify(vert));
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
