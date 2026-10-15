// PDF Editor: each greyed main button in Clean, Crop and Split says why on its tool's status line, and the line goes when the button is enabled.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-reasons.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function mk() { const d = await PDFDocument.create(); for (let i = 0; i < 3; i++) { const pg = d.addPage([612, 792]); for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 60, y: 600 - k * 8 }, end: { x: 550, y: 600 - k * 8 }, thickness: 1, color: rgb(0, 0, 0) }); } const f = path.join(os.tmpdir(), 'kf-reasons.pdf'); fs.writeFileSync(f, await d.save()); return f; }
(async () => {
  const A = await mk(), b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', A); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  const st = sel => p.evaluate(s => ({ t: $(s).textContent, err: $(s).classList.contains('err') }), sel);
  const dis = sel => p.evaluate(s => $(s).disabled, sel);
  const skipAll = async on => { await p.evaluate(on => { PE.skip = on ? new Set(PE.d.order) : new Set(); peState(); }, on); await p.waitForTimeout(150); };
  const tool = async n => { await p.evaluate(n => peTool(n), n); await p.waitForTimeout(700); };
  // Clean
  await tool('clean');
  let s = await st('#peCleanStatus');
  ok('Clean: Revert greyed out says nothing to revert', await dis('#peCleanClear') && !await dis('#peCleanGo') && /nothing to revert/i.test(s.t) && !s.err, JSON.stringify(s));
  await skipAll(true); s = await st('#peCleanStatus');
  ok('Clean: no page ticked says so', await dis('#peCleanGo') && /tick a page/i.test(s.t), JSON.stringify(s));
  await skipAll(false); s = await st('#peCleanStatus');
  ok('Clean: ticking a page takes the Clean reason away', !await dis('#peCleanGo') && !/tick a page/i.test(s.t), JSON.stringify(s));
  await p.evaluate(() => { PE.cl.bg = 0; PE.cl.sp = 0; peActs(); }); s = await st('#peCleanStatus');
  ok('Clean: neither Paper nor Specks chosen says so', await dis('#peCleanGo') && /paper or specks/i.test(s.t), JSON.stringify(s));
  await p.evaluate(() => { PE.cl.bg = 1; PE.cl.sp = 1; PE.d.order.forEach(id => { PE.d.slots[id].bg = 1; PE.d.slots[id].sp = 1; }); peActs(); }); s = await st('#peCleanStatus');
  ok('Clean: pages already cleaned this way says so', await dis('#peCleanGo') && /already/i.test(s.t), JSON.stringify(s));
  await p.evaluate(() => { PE.d.order.forEach(id => { PE.d.slots[id].bg = 0; PE.d.slots[id].sp = 0; }); peActs(); });
  // Crop
  await tool('crop'); await skipAll(true); s = await st('#peCropStatus');
  ok('Crop: no page ticked says so', await dis('#peCropAuto') && /tick a page/i.test(s.t), JSON.stringify(s));
  await skipAll(false); await p.evaluate(() => { PE.d.order.forEach(id => PE.raw.set(peRawKey(PE.d.slots[id]), [0.2, 0.2, 0.8, 0.5])); peActs(); }); s = await st('#peCropStatus');
  ok('Crop: ticking a page takes the Crop reason away', !await dis('#peCropAuto') && !/tick a page/i.test(s.t), JSON.stringify(s));
  ok('Crop: Revert greyed out says nothing to revert', await dis('#peCropClear') && /nothing to revert/i.test(s.t), JSON.stringify(s));
  await p.evaluate(() => { PE.d.order.forEach(id => { PE.d.slots[id].crop = peRound(peCropBox(id).box); }); peActs(); }); s = await st('#peCropStatus');
  ok('Crop: every ticked page already cropped says so', await dis('#peCropAuto') && /already cropped/i.test(s.t), JSON.stringify(s));
  await p.evaluate(() => { PE.d.order.forEach(id => { PE.d.slots[id].crop = null; }); peActs(); });
  // Split
  await tool('split'); await p.waitForTimeout(800); await p.evaluate(() => { PE.splitSel = new Set(); peActs(); }); s = await st('#peSplitStatus');
  ok('Split: no spread ticked says so', await dis('#peSplitGo') && /tick a/i.test(s.t), JSON.stringify(s));
  await p.evaluate(() => { PE.splitSel = new Set([PE.d.order[0]]); peActs(); }); s = await st('#peSplitStatus');
  ok('Split: ticking a page takes the reason away', !await dis('#peSplitGo') && s.t === '', JSON.stringify(s));
  await p.evaluate(() => { PE.splitSel = new Set(); peActs(); });
  await tool('clean'); s = await st('#peSplitStatus');
  ok('Switching tools clears the old line', s.t === '', JSON.stringify(s));
  // 320px
  await p.setViewportSize({ width: 320, height: 700 }); await p.waitForTimeout(300);
  await skipAll(true);
  const fit = await p.evaluate(() => { const band = $('#peBand'); return { over: band.scrollWidth > band.clientWidth + 1, sw: band.scrollWidth, cw: band.clientWidth, page: document.documentElement.scrollWidth > innerWidth }; });
  ok('At 320px the line fits without overflow', !fit.over && !fit.page, JSON.stringify(fit));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
