// PDF Editor: one loading design. A wait shows a thin bar on the tool's status line with "Processing N%" ("Processing…" first);
// while Crop reads the pages its margin slider and Crop button are greyed and Manual stays usable; no "Preparing" or "Finding the music" is left.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-loading.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const d = await PDFDocument.create(); for (let i = 0; i < 4; i++) { const pg = d.addPage([612, 792]); for (let y = 700; y > 160; y -= 74) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 90 + i * 20, y: y - k * 7 }, end: { x: 520 - i * 20, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }          // music, so Crop has something to find
  const file = path.join(os.tmpdir(), 'kf-loading.pdf'); fs.writeFileSync(file, await d.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 4); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  // hold the work: the first page goes through, the rest wait until the gate opens
  await p.evaluate(() => { window.__gate = new Promise(r => { window.__open = r; }); const raw = peRawBox, scan = peScan; let a = 0, c = 0; peRawBox = async sl => { if (a++ >= 1) await window.__gate; return raw(sl); }; peScan = async (...x) => { if (c++ >= 1) await window.__gate; return scan(...x); }; });
  const go = () => p.evaluate(() => ({ text: $('#peCropAuto').textContent, loading: $('#peCropAuto').classList.contains('loading'), fill: $('#peCropAuto').style.getPropertyValue('--p'), off: $('#peCropAuto').disabled, pad: $('#peCropPad').disabled, line: $('#peCropStatus').textContent, bar: !!document.querySelector('#peBand .pe-status i') }));
  // Crop's read, in Auto: the Crop button carries the work
  await p.evaluate(() => peTool('crop')); await p.waitForTimeout(900);
  const rd = await go();
  ok('Crop read: the Crop button reads "Processing N%"', /^Processing \d+%$/.test(rd.text), JSON.stringify(rd));
  ok('Crop read: the button fills to that percent, like every pressed button', rd.loading && rd.fill === rd.text.match(/\d+%/)[0], JSON.stringify(rd));
  ok('Crop read: the Crop button and the margin slider are greyed, and the status line adds no bar', rd.off && rd.pad && !rd.bar && !/Processing/.test(rd.line), JSON.stringify(rd));
  // Manual does not wait: the Crop button is free and plain, and the reading comes back on the button in Auto
  await p.evaluate(() => { document.querySelector('input[name=peCropMode][value=hand]').click(); }); await p.waitForTimeout(500);
  const hd = await go(); ok('Manual during the read: the Crop button is plain and not greyed by the read', hd.text === 'Crop' && !hd.loading && !hd.off, JSON.stringify(hd));
  await p.evaluate(() => { document.querySelector('input[name=peCropMode][value=auto]').click(); }); await p.waitForTimeout(500);
  const bk = await go(); ok('Back in Auto during the read: the button shows the work again', /^Processing/.test(bk.text) && bk.off && bk.pad, JSON.stringify(bk));
  // Manual during the read: the frame and its handles are there to drag at once, a drag is kept, and Crop applies it without waiting for the pages to be read
  await p.evaluate(() => { document.querySelector('input[name=peCropMode][value=hand]').click(); }); await p.waitForTimeout(600);
  const fr = () => p.evaluate(() => { const e = $('#peCropBox'), r = e.getBoundingClientRect(), pg = $('#peCropPg').getBoundingClientRect(); return { shown: !e.hidden && r.width > 20 && r.height > 20, handles: e.querySelectorAll('[data-h]').length, x: r.x, y: r.y, w: r.width, h: r.height, pg: { x: pg.x, y: pg.y, w: pg.width, h: pg.height } }; });
  const f0 = await fr(); ok('Manual during the read: the frame and its handles are shown', f0.shown && f0.handles >= 8, JSON.stringify(f0));
  const hSE = await p.evaluate(() => { const r = document.querySelector('#peCropBox [data-h="se"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.mouse.move(hSE[0], hSE[1]); await p.mouse.down(); await p.mouse.move(hSE[0] - 70, hSE[1] - 90, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const f1 = await fr(); ok('Manual during the read: dragging a handle resizes the frame', f1.w < f0.w - 40 && f1.h < f0.h - 40, JSON.stringify({ f0: [f0.w, f0.h], f1: [f1.w, f1.h] }));
  const go1 = await p.evaluate(() => ({ off: $('#peCropAuto').disabled, text: $('#peCropAuto').textContent })); ok('Manual during the read: Crop is free to press', !go1.off && go1.text === 'Crop', JSON.stringify(go1));
  await p.evaluate(() => document.querySelector('#peCropAuto').click()); await p.waitForTimeout(900);
  const mn = await p.evaluate(() => ({ crops: PE.d.slots.filter(x => x.crop).length, reading: PE.cropReading, c: PE.d.slots[PE.one] && PE.d.slots[PE.one].crop })); ok('Manual during the read: Crop applies the dragged frame at once, while the read is still going', mn.crops > 0 && mn.reading, JSON.stringify(mn));
  await p.evaluate(() => window.__open()); await p.evaluate(async () => { for (let i = 0; i < 400 && (PE.cropReading || PE.busy); i++) await sleep(25); await sleep(400); });
  const after = await go();
  ok('Crop read done: the button is plain "Crop" again (greyed only because the pages are cropped) and the slider is free', after.text === 'Crop' && !after.loading && after.line === 'Already cropped.' && !after.pad, JSON.stringify(after));
  // Re-kilter's first moment
  await p.evaluate(() => { window.__gate = new Promise(r => { window.__open = r; }); const prev = peScan; peScan = async (...x) => { await window.__gate; return prev(...x); }; });
  await p.evaluate(() => peTool('skew')); await p.waitForTimeout(400); await p.evaluate(() => { peSkewGo(); }); await p.waitForTimeout(300);
  const btn = await p.evaluate(() => ({ text: $('#peSkewGo').textContent, html: $('#peSkewGo').innerHTML }));
  ok('Re-kilter first moment: the button reads "Processing…" in one piece', /^Processing(…|\.\.\.)$/.test(btn.text) && /^<span>Processing<span class="dots">/.test(btn.html), JSON.stringify(btn));
  ok('No "Preparing" or "Finding the music" anywhere in the tool band', await p.evaluate(() => !/Preparing|Finding the music/.test($('#peBand').textContent)));
  await p.evaluate(() => window.__open()); await p.waitForTimeout(500);
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
