// PDF Editor: Manual in Crop while the pages are still being read. The frame and its handles are there to drag, each page keeps its own frame when you step with the arrows,
// Apply to selected copies the open page's frame to the ticked pages, and Crop applies the frames you drew at once, without waiting for the read.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-crop-manual-wait.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const near = (a, b, e = 0.02) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= e);
(async () => {
  const d = await PDFDocument.create(); for (let i = 0; i < 4; i++) { const pg = d.addPage([612, 792]); for (let y = 700; y > 160; y -= 74) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 90 + i * 20, y: y - k * 7 }, end: { x: 520 - i * 20, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const file = path.join(os.tmpdir(), 'kf-manual-wait.pdf'); fs.writeFileSync(file, await d.save());
  const b = await chromium.launch(); const errs = [];
  async function fresh(clearAspects) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 4); await p.waitForTimeout(800);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
    await p.evaluate(clear => { if (clear) PE.asp = new Map(); window.__gate = new Promise(r => { window.__open = r; }); const raw = peRawBox; peRawBox = async sl => { await window.__gate; return raw(sl); }; }, clearAspects);          // nothing is read until the gate opens
    await p.evaluate(() => peTool('crop')); await p.waitForTimeout(900);
    return p;
  }
  // the frame on the open page, as fractions of the page: [left, top, right, bottom]; null when it is not shown
  const frame = p => p.evaluate(() => { const e = $('#peCropBox'), pg = $('#peCropPg').getBoundingClientRect(), r = e.getBoundingClientRect(); if (e.hidden || r.width < 5) return null; return [(r.x - pg.x) / pg.width, (r.y - pg.y) / pg.height, (r.right - pg.x) / pg.width, (r.bottom - pg.y) / pg.height].map(v => +v.toFixed(3)); });
  const page = p => p.evaluate(() => $('#peCropName').textContent);
  const drag = async (p, dx, dy, h = 'se') => { const c = await p.evaluate(h => { const r = document.querySelector('#peCropBox [data-h="' + h + '"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, h); await p.mouse.move(c[0], c[1]); await p.mouse.down(); await p.mouse.move(c[0] + dx, c[1] + dy, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250); };
  const hand = p => p.evaluate(() => { document.querySelector('input[name=peCropMode][value=hand]').click(); }).then(() => p.waitForTimeout(600));
  const settle = p => p.evaluate(async () => { window.__open(); for (let i = 0; i < 400 && (PE.cropReading || PE.busy); i++) await sleep(25); await sleep(500); });
  const crops = p => p.evaluate(() => PE.d.order.map(id => PE.d.slots[id].crop && PE.d.slots[id].crop.map(v => +v.toFixed(3))));
  const same = (p, on) => p.evaluate(on => { const s = document.querySelector('#peCropSame'); if (s.checked !== on) s.click(); }, on).then(() => p.waitForTimeout(400));

  // 1. Each page has its own frame, kept when stepping with the button and the arrow keys
  { const p = await fresh(); await hand(p);
    const a0 = await frame(p); ok('Own frames: page 1 shows a frame to drag', !!a0 && (await page(p)) === 'Page 1 of 4', JSON.stringify(a0));
    await drag(p, -70, -90); const a1 = await frame(p); ok('Own frames: dragging page 1 changes its frame', a1 && a0 && a1[2] < a0[2] - 0.1, JSON.stringify({ a0, a1 }));
    await p.click('#peCropNext'); await p.waitForTimeout(500); const b0 = await frame(p);
    ok('Own frames: stepping to page 2 with the button shows page 2 and a frame of its own (not page 1\'s)', (await page(p)) === 'Page 2 of 4' && b0 && !near(b0, a1, 0.05), JSON.stringify({ b0, a1 }));
    await drag(p, 60, 60, 'nw'); const b1 = await frame(p); ok('Own frames: page 2 can be dragged on its own', b1 && b1[0] > b0[0] + 0.05, JSON.stringify({ b0, b1 }));
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(500); const a2 = await frame(p);
    ok('Own frames: ArrowLeft goes back to page 1 and its dragged frame is still there', (await page(p)) === 'Page 1 of 4' && near(a2, a1, 0.02), JSON.stringify({ a2, a1 }));
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500); const b2 = await frame(p);
    ok('Own frames: ArrowRight returns to page 2 and its frame is still there', (await page(p)) === 'Page 2 of 4' && near(b2, b1, 0.02), JSON.stringify({ b2, b1 }));
    await p.click('#peCropNext'); await p.click('#peCropNext'); await p.waitForTimeout(400); const end = await p.evaluate(() => ({ next: $('#peCropNext').disabled, name: $('#peCropName').textContent }));
    ok('Own frames: the arrow buttons stop at the last page', end.next && end.name === 'Page 4 of 4', JSON.stringify(end));
    const go = await p.evaluate(() => ({ off: $('#peCropAuto').disabled, text: $('#peCropAuto').textContent, pad: $('#peCropPad').disabled })); ok('Own frames: Crop stays free while stepping during the read', !go.off && go.text === 'Crop', JSON.stringify(go));
    await settle(p); const cr = await crops(p);
    ok('Own frames: pages 1 and 2 keep their dragged frames after the read ends (Crop not pressed yet)', cr.every(c => c === null), JSON.stringify(cr));
    await p.click('#peCropPrev'); await p.click('#peCropPrev'); await p.click('#peCropPrev'); await p.waitForTimeout(500); const a3 = await frame(p); ok('Own frames: after the read, page 1 still shows its dragged frame', near(a3, a1, 0.02), JSON.stringify({ a3, a1 }));
    await p.evaluate(() => document.querySelector('#peCropAuto').click()); await p.waitForTimeout(1500); const cr2 = await crops(p);
    ok('Own frames: Crop gives page 1 and page 2 their own dragged frames', near(cr2[0], a1, 0.03) && near(cr2[1], b1, 0.03) && !near(cr2[0], cr2[1], 0.03), JSON.stringify({ cr2, a1, b1 }));
    ok('Own frames: pages not drawn on are left alone', cr2[2] === null && cr2[3] === null, JSON.stringify(cr2)); await p.close(); }

  // 2. Apply to selected copies the open page's frame to the ticked pages while the read is still going
  { const p = await fresh(); await hand(p); await drag(p, -80, -80); const a1 = await frame(p);
    const off = await p.evaluate(() => $('#peCropApply').disabled); await p.evaluate(() => { PE.skip.delete(PE.d.order[1]); PE.skip.delete(PE.d.order[2]); peState(); peActs(); }); await p.waitForTimeout(300);
    const on = await p.evaluate(() => $('#peCropApply').disabled); await p.click('#peCropApply'); await p.waitForTimeout(900); const cr = await crops(p);
    ok('Apply to selected: greyed out until a page is ticked, then crops the open page and the ticked pages with its frame, and no other', off && !on && near(cr[0], a1, 0.03) && near(cr[1], a1, 0.03) && near(cr[2], a1, 0.03) && cr[3] === null, JSON.stringify({ off, on, cr, a1 }));
    await p.click('#peCropNext'); await p.waitForTimeout(700); const b0 = await frame(p); ok('Apply to selected: page 2 shows the copied frame', (await page(p)) === 'Page 2 of 4' && near(b0, a1, 0.02), JSON.stringify({ b0, a1 }));
    await p.evaluate(() => document.querySelector('#peCropAuto').click()); await p.waitForTimeout(900); const cr2 = await crops(p);
    ok('Crop in Manual crops the open page too and leaves the rest', near(cr2[1], a1, 0.03) && cr2[3] === null, JSON.stringify({ cr2, a1 })); await p.close(); }

  // 3. Crop pressed in Manual while the read is still going and only page 1 was given a frame: it crops that page at once and no other
  { const p = await fresh(); await hand(p); await drag(p, -70, -90); const a1 = await frame(p);
    await p.evaluate(() => document.querySelector('#peCropAuto').click()); await p.waitForTimeout(700);
    const w = await p.evaluate(() => ({ text: $('#peCropAuto').textContent, loading: $('#peCropAuto').classList.contains('loading') })); const cr = await crops(p);
    ok('Crop with one framed page, read still going: no waiting, and only that page is cropped', !w.loading && w.text === 'Crop' && near(cr[0], a1, 0.03) && cr.slice(1).every(c => c === null), JSON.stringify({ w, cr, a1 })); await p.close(); }
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
