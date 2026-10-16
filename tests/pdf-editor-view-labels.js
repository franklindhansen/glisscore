// PDF Editor, the large view: the Original / Cleaned labels stay in view when the page is zoomed and moved, the line's knob stays on the page and level with the window,
// the zoom pill says Fit, a changed choice sweeps in a new picture (and dims the old one at once), Re-kilter says so when the page has not been leveled, the page follows the window when it is resized.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-view-labels.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) { const pg = doc.addPage([612, 792]); for (let y = 700; y > 100; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 80, y: y - k * 7 }, end: { x: 530, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), 'kf-view-labels.pdf'); fs.writeFileSync(f, await doc.save()); return f;
}
(async () => {
  const file = await makePdf(), b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  await p.evaluate(() => { openPdfEditor(); }); await p.waitForTimeout(500);
  await p.evaluate(() => { peTool('clean'); }); await p.waitForTimeout(800);
  await p.evaluate(() => { PE.one = PE.d.order[0]; peState(); });
  await p.waitForFunction(() => !document.querySelector('#peCropPg').classList.contains('loading')); await p.waitForTimeout(900);
  const view = () => p.evaluate(() => {
    const st = document.querySelector('#peCropStage').getBoundingClientRect(), pg = document.querySelector('#peCropPg').getBoundingClientRect(), kn = document.querySelector('#peWipe').getBoundingClientRect(), r = id => { const e = document.querySelector(id), b = e.getBoundingClientRect(); return { on: e.classList.contains('on'), l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    return { st: { l: st.left, r: st.right, t: st.top, b: st.bottom }, pg: { l: pg.left, r: pg.right, t: pg.top, b: pg.bottom }, kn: { x: kn.left + kn.width / 2 }, a: r('#peSideA'), bb: r('#peSideB'), ky: parseFloat(document.querySelector('#peCropPg').style.getPropertyValue('--ky')) };
  });
  const inside = (s, v) => s.l >= v.st.l - 1 && s.r <= v.st.r + 1 && s.t >= v.st.t - 1 && s.b <= v.st.b + 1;
  let v = await view();
  ok('Fit says Fit', await p.evaluate(() => document.querySelector('#peZmFit').textContent.trim()) === 'Fit');
  ok('Both labels are shown inside the window beside the line', v.a.on && v.bb.on && inside(v.a, v) && inside(v.bb, v), JSON.stringify(v));
  // zoom in at a corner and move the page: the labels stay in the window
  await p.evaluate(() => { peZoomAt(3.5, document.querySelector('#peCropStage').getBoundingClientRect().left + 5, document.querySelector('#peCropStage').getBoundingClientRect().top + 5, false); }); await p.waitForTimeout(200);
  v = await view(); ok('Zoomed to the page corner, the labels that have room are in the window', (v.a.on ? inside(v.a, v) : true) && (v.bb.on ? inside(v.bb, v) : true) && (v.a.on || v.bb.on), JSON.stringify(v));
  for (const [dx, dy] of [[-4000, 0], [4000, 0], [0, -4000], [0, 4000]]) {
    await p.evaluate(([x, y]) => { PE.zm.x = x; PE.zm.y = y; peZoomClamp(); peZoomApply(false); }, [dx, dy]); await p.waitForTimeout(80); v = await view();
    ok('Moved to the edge (' + dx + ',' + dy + '), the label of the side in view is in the window', (v.a.on || v.bb.on) && (!v.a.on || inside(v.a, v)) && (!v.bb.on || inside(v.bb, v)), JSON.stringify({ a: v.a, bb: v.bb }));
    ok('The knob stays on the page and in the window', v.kn.x >= v.pg.l - 1 && v.kn.x <= v.pg.r + 1 || v.kn.x < v.st.l || v.kn.x > v.st.r);
  }
  await p.click('#peZmFit'); await p.waitForTimeout(500); v = await view();
  ok('Fit brings both labels back at the page\'s top corners', v.a.on && v.bb.on && Math.abs(v.a.l - v.pg.l - 8) < 4 && Math.abs(v.bb.r - v.pg.r + 8) < 4, JSON.stringify(v));
  // the line cannot be dragged so far that the knob leaves the page
  await p.evaluate(() => peWipeSet(0)); let w1 = await p.evaluate(() => PE.wipe), pw = await p.evaluate(() => document.querySelector('#peCropPg').offsetWidth);
  ok('The line stops where the knob still fits on the page', w1 * pw >= 13, 'x=' + (w1 * pw).toFixed(1));
  // small window: the page still fits
  await p.setViewportSize({ width: 700, height: 560 }); await p.waitForTimeout(60);
  const fit = await p.evaluate(() => { const st = document.querySelector('#peCropStage'), pg = document.querySelector('#peCropPg'); return { w: pg.offsetWidth, h: pg.offsetHeight, sw: st.clientWidth, sh: st.clientHeight }; });
  ok('When the window gets smaller the page shrinks with it at once', fit.w <= fit.sw && fit.h <= fit.sh, JSON.stringify(fit));
  await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(400);
  // changing a choice: dims at once, sweeps in
  await p.evaluate(() => peWipeSet(0.5));
  await p.click('#peWin label:has-text("Strong")'); await p.waitForTimeout(40);
  const mid = await p.evaluate(() => ({ busy: document.querySelector('#peCropPg').classList.contains('busy'), reveal: !!document.querySelector('.pe-reveal') }));
  ok('A changed choice dims the page at once', mid.busy || mid.reveal, JSON.stringify(mid));
  let saw = mid.reveal; for (let i = 0; i < 25 && !saw; i++) { await p.waitForTimeout(40); saw = await p.evaluate(() => !!document.querySelector('.pe-reveal')); }
  ok('The new picture sweeps in', saw);
  await p.waitForTimeout(900);
  const end = await p.evaluate(() => ({ reveal: !!document.querySelector('.pe-reveal'), edge: !!document.querySelector('.pe-edge'), busy: document.querySelector('#peCropPg').classList.contains('busy'), id: document.querySelectorAll('#peCropCv').length }));
  ok('Afterwards nothing is left over and the page has its one picture', !end.reveal && !end.edge && !end.busy && end.id === 1, JSON.stringify(end));
  // Re-kilter that has not run
  await p.evaluate(() => { PE.one = null; peState(); peTool('skew'); }); await p.waitForTimeout(500);
  await p.evaluate(() => { PE.one = PE.d.order[0]; peState(); }); await p.waitForFunction(() => !document.querySelector('#peCropPg').classList.contains('loading')); await p.waitForTimeout(500);
  const h = await p.evaluate(() => { const e = document.querySelector('#peOneHint'); return { on: e.classList.contains('on'), t: e.textContent, o: getComputedStyle(e).opacity }; });
  ok('A page that has not been leveled says so in the large view', h.on && /Re-kilter/.test(h.t) && +h.o > 0.9, JSON.stringify(h));
  await p.evaluate(() => { PE.one = null; peState(); peTool('clean'); }); await p.waitForTimeout(300);
  await p.evaluate(() => { PE.one = PE.d.order[0]; peState(); }); await p.waitForTimeout(900);
  ok('Clean has no such line', await p.evaluate(() => !document.querySelector('#peOneHint').classList.contains('on')));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
