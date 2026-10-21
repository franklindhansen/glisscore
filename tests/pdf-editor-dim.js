// Dim: a box drawn on a page fades the music under it. No ticks and no switch; the box updates live as it is drawn; each edge moves only its own side; a round X at the center deletes it;
// Revert clears every page in one History step (greyed with a tooltip when there is nothing to revert); the count sits in the bar; a repeated page keeps its boxes, edited on its own;
// the boxes are in the recipe (History, settings list) and are drawn in the page pictures and the exported PDF, in any order with the other tools.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-dim.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(1200);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
  const order = await p.evaluate(() => [...document.querySelectorAll('#peRail .pe-tab')].map(b => b.dataset.tool));
  ok('Dim sits directly above Split spreads', order.indexOf('dim') > 0 && order[order.indexOf('dim') + 1] === 'split', order.join());
  await p.click('#peRail .pe-tab[data-tool=dim]'); await p.waitForTimeout(700);
  const st = () => p.evaluate(() => ({ n: PE.d.order.length, dims: PE.d.order.map(id => PE.d.slots[id].dim ? PE.d.slots[id].dim.length : 0), boxes: document.querySelectorAll('#peGrid .pe-dimbox').length, chips: document.querySelectorAll('#peGrid .page-card.lvl').length,
    count: document.querySelector('#peCount').textContent, revert: document.querySelector('#peDimClear').disabled, tip: document.querySelector('#peDimClear').title, status: document.querySelector('#peDimStatus').textContent, undo: PE.undo.length,
    all: getComputedStyle(document.querySelector('#peAll')).display, ticks: document.querySelectorAll('#peGrid.ticks').length, title: document.querySelector('#peViewDim h3').textContent, sub: document.querySelector('#peViewDim .pe-sub').textContent }));
  const s0 = await st();
  ok('before any box: nothing is dimmed, no chip, Revert greyed with a tooltip and no status line, no ticks or Select all', s0.boxes === 0 && s0.chips === 0 && s0.revert && s0.tip === 'Nothing to revert.' && s0.status === '' && s0.all === 'none' && !s0.ticks && /pages dimmed/.test(s0.count) && s0.count.startsWith('0 /'), JSON.stringify(s0));
  ok('the head says what Dim does', s0.title === 'Dim' && s0.sub === 'Visually softens music that repeats.', s0.sub);
  const rect = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }, sel);
  const c1 = await rect('#peGrid .page-card:nth-child(1) .pe-thumb');
  await p.mouse.move(c1.x + c1.w * .2, c1.y + c1.h * .25); await p.mouse.down(); await p.mouse.move(c1.x + c1.w * .6, c1.y + c1.h * .55, { steps: 6 });
  const live = await st(); ok('the box appears while the pointer is still down, and the page itself is not changed yet', live.boxes === 1 && live.dims[0] === 0 && live.undo === 0, JSON.stringify(live));
  await p.mouse.up(); await p.waitForTimeout(300); const s1 = await st();
  ok('letting go makes one History step, dims the page, and updates the chip, the count, and Revert', s1.dims[0] === 1 && s1.undo === 1 && s1.chips === 1 && s1.count.startsWith('1 /') && !s1.revert && s1.tip === '', JSON.stringify(s1));
  const bx = await rect('#peGrid .page-card:nth-child(1) .pe-dimbox'), xr = await rect('#peGrid .page-card:nth-child(1) .pe-dimx');
  ok('the X sits at the exact center of the box', Math.abs((xr.x + xr.w / 2) - (bx.x + bx.w / 2)) < 1.5 && Math.abs((xr.y + xr.h / 2) - (bx.y + bx.h / 2)) < 1.5, JSON.stringify([bx, xr]));
  // edges: select the box, then drag the west handle far past the east edge; it must stop at the minimum, not flip or collapse
  await p.mouse.click(bx.x + bx.w * .3, bx.y + bx.h * .3); await p.waitForTimeout(150);
  const hw = await rect('#peGrid .page-card:nth-child(1) .pe-dimbox .h.w'); await p.mouse.move(hw.x + hw.w / 2, hw.y + hw.h / 2); await p.mouse.down(); await p.mouse.move(bx.x + bx.w + 60, hw.y + hw.h / 2, { steps: 8 });
  const mid = await rect('#peGrid .page-card:nth-child(1) .pe-dimbox'); await p.mouse.up(); await p.waitForTimeout(200);
  ok('dragging one edge far past the other stops at the minimum size and keeps the right edge', mid.w >= 20 && mid.w < bx.w && Math.abs((mid.x + mid.w) - (bx.x + bx.w)) < 2, JSON.stringify([bx, mid]));
  const s2 = await st(); ok('the move was one more History step', s2.undo === 2, JSON.stringify(s2));
  // delete with the X
  const x2 = await rect('#peGrid .page-card:nth-child(1) .pe-dimx'); await p.mouse.click(x2.x + x2.w / 2, x2.y + x2.h / 2); await p.waitForTimeout(250); const s3 = await st();
  ok('the X deletes the box and the page is no longer dimmed', s3.boxes === 0 && s3.dims[0] === 0 && s3.chips === 0 && s3.revert, JSON.stringify(s3));
  await p.evaluate(() => peUndo()); await p.waitForTimeout(300); const s4 = await st();
  ok('Undo brings the box back', s4.dims[0] === 1 && s4.boxes === 1, JSON.stringify(s4));
  // a second page, then Revert
  const c2 = await rect('#peGrid .page-card:nth-child(2) .pe-thumb'); await p.mouse.move(c2.x + c2.w * .1, c2.y + c2.h * .6); await p.mouse.down(); await p.mouse.move(c2.x + c2.w * .8, c2.y + c2.h * .9, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(250);
  const u0 = (await st()).undo; await p.click('#peDimClear'); await p.waitForTimeout(300); const s5 = await st();
  ok('Revert clears every page in one History step', s5.dims.every(n => n === 0) && s5.undo === u0 + 1 && s5.revert && s5.chips === 0, JSON.stringify(s5));
  await p.evaluate(() => peUndo()); await p.waitForTimeout(300);
  // pictures: a box fades the ink under it, through turns and crops
  const px = await p.evaluate(async () => {
    const d = PE.d, id = d.order[0], sl = d.slots[id]; const keep = sl.dim; sl.dim = [[0.1, 0.1, 0.9, 0.9]];
    const dark = cv => { const x = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] < 100) n++; return n; };
    const a = await renderPdfPage(S.pdf.doc, sl.src, 300, 400, 0, null, slotGeo(sl)), b0 = await renderPdfPage(S.pdf.doc, sl.src, 300, 400, 0, null, slotGeo(sl, 'dim'));
    sl.crop = [0.3, 0.3, 0.7, 0.7]; sl.dim = [[0, 0, 0.5, 0.5]]; const c = await renderPdfPage(S.pdf.doc, sl.src, 300, 400, 0, null, slotGeo(sl)), c0 = await renderPdfPage(S.pdf.doc, sl.src, 300, 400, 0, null, slotGeo(sl, 'dim')); sl.crop = null; sl.dim = keep;
    const rt = (() => { const o = []; for (const rot of [0, 90, 180, 270]) for (const cr of [null, [0.1, 0.2, 0.8, 0.9]]) { const s = { rot, crop: cr }, f = [0.25, 0.3, 0.4, 0.5], back = dimToFile(s, dimToView(s, f)); o.push(back.every((v, i) => Math.abs(v - f[i]) < 1e-3)); } return o.every(Boolean); })();
    return { dimmed: dark(a), plain: dark(b0), cropDim: dark(c), cropPlain: dark(c0), rt };
  });
  ok('a dimmed page picture has less dark ink than the same page without the box', px.dimmed < px.plain * 0.6, JSON.stringify(px));
  ok('a box on a cropped page fades the part inside the crop', px.cropDim < px.cropPlain, JSON.stringify(px));
  ok('a box maps between the file and the picture the same way for every turn and crop', px.rt);
  // a cleaned page (and so an encrypted one, which is exported as a picture too) is faded after it is cleaned, so Clean never whitens the fade away
  const cl = await p.evaluate(async () => {
    const sl = PE.d.slots[PE.d.order[0]], keep = sl.dim; sl.dim = [[0.1, 0.1, 0.9, 0.9]]; const g = slotGeo(sl), dark = cv => { const x = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] < 100) n++; return n; };
    const a = await renderPdfPage(S.pdf.doc, sl.src, 300, 400, 0, null, Object.assign({}, g, { bg: 1, sp: 1 })), b0 = await renderPdfPage(S.pdf.doc, sl.src, 300, 400, 0, null, Object.assign({}, g, { bg: 1, sp: 1, dim: null })); sl.dim = keep; return { dimmed: dark(a), plain: dark(b0) };
  });
  ok('a cleaned page still shows its box faded', cl.plain > 0 && cl.dimmed < cl.plain * 0.6, JSON.stringify(cl));
  // any order: Dim, then Crop and Arrange, show the page dimmed; in Dim the picture under the live boxes is plain
  await p.evaluate(() => { PE.d.slots[PE.d.order[0]].dim = [[0.05, 0.05, 0.95, 0.95]]; peRender(false); });
  const ink = () => p.evaluate(() => { const cv = document.querySelector('#peGrid .page-card:nth-child(1) canvas'), x = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] < 100) n++; return n; });
  const inkIn = async tool => { await p.click('#peRail .pe-tab[data-tool=' + tool + ']'); await p.waitForTimeout(1500); const withDim = await ink(); await p.evaluate(() => { const sl = PE.d.slots[PE.d.order[0]]; sl._k = sl.dim; sl.dim = null; peRender(false); }); await p.waitForTimeout(1200); const plain = await ink(); await p.evaluate(() => { const sl = PE.d.slots[PE.d.order[0]]; sl.dim = sl._k; delete sl._k; peRender(false); }); await p.waitForTimeout(1000); return [withDim, plain]; };
  const [dimW, dimP] = await inkIn('dim'), [cropW, cropP] = await inkIn('crop'), [pagesW, pagesP] = await inkIn('pages');
  ok('after Dim, Crop and Arrange show the page dimmed; in Dim the picture under the boxes stays plain', cropW < cropP * 0.7 && pagesW < pagesP * 0.7 && Math.abs(dimW - dimP) < dimP * 0.05 + 5, JSON.stringify({ dimW, dimP, cropW, cropP, pagesW, pagesP }));
  // a repeated page keeps the boxes and is edited on its own (Arrange)
  const dup = await p.evaluate(() => { const id = PE.d.order[0]; peAct('dup', id); const d = PE.d, ni = d.order[1]; return { same: JSON.stringify(d.slots[ni].dim) === JSON.stringify(d.slots[id].dim), indep: d.slots[ni].dim !== d.slots[id].dim && d.slots[ni].dim[0] !== d.slots[id].dim[0] }; });
  ok('Repeat in Arrange copies the boxes, and the copy is its own list', dup.same && dup.indep, JSON.stringify(dup));
  await p.click('#peRail .pe-tab[data-tool=dim]'); await p.waitForTimeout(800);
  await p.evaluate(() => { document.querySelector('#peGrid .page-card:nth-child(1) [data-act=open]').click(); }); await p.waitForTimeout(1200);
  const L = await p.evaluate(() => ({ layer: !document.querySelector('#peDimLayer').hidden, boxes: document.querySelectorAll('#peDimLayer .pe-dimbox').length, zoom: !!document.querySelector('#peZmIn') }));
  ok('the large view shows the same boxes and has the zoom pill', L.layer && L.boxes === 1 && L.zoom, JSON.stringify(L));
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  // the owner's pass: boxes drawn in the large view show on the card, nothing flashes on letting go, the X keeps its size after a tool switch, and the Open button is reachable
  await p.evaluate(() => { PE.d.slots[PE.d.order[1]].dim = null; peRender(false); }); await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector('#peGrid .page-card:nth-child(2) [data-act=open]').click(); }); await p.waitForTimeout(1200);
  const sigA = await p.evaluate(() => PE.oneSig), lr = await rect('#peDimLayer');
  await p.mouse.move(lr.x + lr.w * .2, lr.y + lr.h * .2); await p.mouse.down(); await p.mouse.move(lr.x + lr.w * .6, lr.y + lr.h * .5, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const big = await p.evaluate(() => ({ sig: PE.oneSig, loading: document.querySelector('#peCropPg').classList.contains('loading'), n: PE.d.slots[PE.d.order[1]].dim ? PE.d.slots[PE.d.order[1]].dim.length : 0 }));
  ok('a box drawn in the large view is saved and letting go does not redraw the page', big.n === 1 && big.sig === sigA && !big.loading, JSON.stringify(big));
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  const back = await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card:nth-child(2)'); return { boxes: c.querySelectorAll('.pe-dimbox').length, chip: c.classList.contains('lvl') && getComputedStyle(c.querySelector('.pe-lvl')).opacity === '1', label: c.querySelector('.pe-lvl').textContent }; });
  ok('back on the grid the card shows the box and the Dimmed chip, without leaving Dim', back.boxes === 1 && back.chip && back.label === 'Dimmed', JSON.stringify(back));
  await p.click('#peRail .pe-tab[data-tool=crop]'); await p.waitForTimeout(900); await p.click('#peRail .pe-tab[data-tool=dim]'); await p.waitForTimeout(1200);
  const sz = await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card:nth-child(2)'), x = c.querySelector('.pe-dimx').getBoundingClientRect(), hh = c.querySelector('.pe-dimbox .h.se'), h = hh.getBoundingClientRect(), b = c.querySelector('.pe-dimbox').getBoundingClientRect(); return { x: x.width, h: hh.offsetWidth, box: Math.min(b.width, b.height), hr: h.right - b.right }; });
  ok('after another tool and back, the X and handles are sized for their box and the handles sit on its corners', sz.x >= Math.min(22, sz.box * .5) - 1 && sz.h >= Math.min(16, sz.box * .28) - 1 && Math.abs(sz.hr) <= sz.h, JSON.stringify(sz));
  const hov = await rect('#peGrid .page-card:nth-child(2)'); await p.mouse.move(hov.x + hov.w / 2, hov.y + hov.h / 2); await p.waitForTimeout(500);
  const top = await p.evaluate(() => { const b = document.querySelector('#peGrid .page-card:nth-child(2) [data-act=open]').getBoundingClientRect(), e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(e && e.closest('[data-act=open]')); });
  ok('the Open button sits above the drawing layer, so one press opens the page', top);
  // the recipe: signature, settings list, History label, and the exported PDF
  const rec = await p.evaluate(async () => {
    const r = PE.d, id = r.order[0], sig0 = recipeSig(r), keepDim = r.slots[id].dim; r.slots[id].dim = null; const sig1 = recipeSig(r); r.slots[id].dim = keepDim;
    const list = recipeToList(r), back = recipeFromList(list, S.pdf.n, r.wm), same = back && JSON.stringify(back.slots[0].dim) === JSON.stringify(keepDim);
    const blob = await buildPdfBlob(r, null), L = await loadPdfLib(), doc = await L.PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
    return { sigDiffers: sig0 !== sig1, listHas: list.some(e => e.d && e.d.length), same: !!same, pages: doc.getPageCount(), size: blob.size, step: peStepLabel({ slots: [{ src: 0 }], order: [0], wm: r.wm }, { slots: [{ src: 0, dim: [[0, 0, .5, .5]] }], order: [0], wm: r.wm }) };
  });
  ok('the recipe signature, the settings list, and the History label know about Dim, and the PDF still exports', rec.sigDiffers && rec.listHas && rec.same && rec.pages >= 2 && rec.size > 1000 && rec.step === 'Dim', JSON.stringify(rec));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
