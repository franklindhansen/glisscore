// Video, System layout: marking systems by hand in the selector.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-marks.js
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
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); tiltPage(doc);
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 3, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
  const sys = (i = 0) => p.evaluate(i => (SYS.byPage.get(i) || { systems: [] }).systems.map(s => [+s.top.toFixed(3), +s.bottom.toFixed(3)]), i);
  const steps = () => p.evaluate(() => S.history.length);
  // page coordinates (y as a page fraction, x as a fraction of the width) to a screen point
  const at = (y, x = 0.5) => p.evaluate(([y, x]) => { const cv = document.querySelector('#selCv'), g = SEL.geo, r = cv.getBoundingClientRect(), k = r.width / cv.width; return [r.left + (g.ox + x * g.pa * g.u) * k, r.top + (g.oy + y * g.u) * k]; }, [y, x]);
  const drag = async (a, b2) => { await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(500); };
  const click = async pt => { await p.mouse.move(...pt); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(150); };
  const before = await sys(), h0 = await steps();
  ok('three systems are found first', before.length === 3, JSON.stringify(before));
  ok('marking is on without a button', await p.evaluate(() => !document.querySelector('#spMark')));
  await drag(await at(0.03), await at(0.085));
  let s = await sys();
  ok('press-drag marks a region the finder skipped', s.length === 4 && s[0][0] < 0.04 && s[0][1] > 0.07, JSON.stringify(s));
  ok('it is one History step', await steps() === h0 + 1);
  await p.click('#bUndo'); await p.waitForTimeout(500);
  ok('undo takes the mark away', JSON.stringify(await sys()) === JSON.stringify(before), JSON.stringify(await sys()));
  await p.click('#bRedo'); await p.waitForTimeout(500);
  ok('redo brings it back', (await sys()).length === 4);
  // click-click over the second and third system replaces both
  const q = await sys();
  await click(await at(q[2][0] - 0.03)); await p.mouse.move(...(await at(q[3][1] + 0.03)), { steps: 3 }); await click(await at(q[3][1] + 0.03));
  s = await sys();
  ok('click-click marks the same way, replacing what it overlaps', s.length === 3 && s[2][0] < q[2][0] && s[2][1] > q[3][1], JSON.stringify(s));
  ok('and is one step', await steps() === h0 + 2);
  await p.click('#bUndo'); await p.click('#bUndo'); await p.waitForTimeout(500);
  ok('two undos restore the found systems', JSON.stringify(await sys()) === JSON.stringify(before), JSON.stringify(await sys()));
  if (process.env.SHOTS) { await click(await at(0.3)); await p.mouse.move(...(await at(0.37))); await p.waitForTimeout(200); await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/marks.png' }); await p.keyboard.press('Escape'); }
  // resize by the bottom edge
  const t = await sys(); await drag(await at(t[0][1]), await at(t[0][1] + 0.03));
  s = await sys(); ok('a bottom edge drag resizes', s.length === 3 && s[0][1] > t[0][1] + 0.02 && Math.abs(s[0][0] - t[0][0]) < 0.003, JSON.stringify([t[0], s[0]]));
  // move by dragging inside
  const m0 = (await sys())[2], mid = (m0[0] + m0[1]) / 2; await drag(await at(mid), await at(mid - 0.03));
  s = await sys(); ok('dragging inside moves the system', Math.abs(s[2][0] - (m0[0] - 0.03)) < 0.006 && Math.abs((s[2][1] - s[2][0]) - (m0[1] - m0[0])) < 0.003, JSON.stringify([m0, s[2]]));
  ok('the left and right are measured from its ink', await p.evaluate(() => { const s = SYS.byPage.get(0).systems[0]; return s.left > 0.05 && s.right < 0.98 && s.right - s.left > 0.5; }));
  // delete by key
  const n = (await sys()).length; await p.keyboard.press('Delete'); await p.waitForTimeout(500);
  ok('Delete removes the selected system', (await sys()).length === n - 1);
  await p.click('#bUndo'); await p.waitForTimeout(400);
  ok('and undo restores it', (await sys()).length === n);
  // Detect this page again
  const h1 = await steps(); await p.click('#spAgain'); await p.waitForTimeout(1500);
  s = await sys(); ok('Detect this page again returns to three systems', s.length === 3 && s[0][0] > 0.1, JSON.stringify(s));
  ok('it is one step', await steps() === h1 + 1);
  ok('only the shown page changed', (await sys(1)).length === 2);
  // a tilted page: a mark measures its ink the way the finder did, and the scan is kept between marks
  await p.evaluate(() => selJump(sysKey(2, 0))); await p.waitForTimeout(600);
  const tb = await p.evaluate(() => { const r = SYS.byPage.get(2); return { tilt: r.tilt, n: r.systems.length, s: r.systems[0] }; });
  ok('the tilted page has its tilt and two systems', Math.abs(tb.tilt) > 0.5 && tb.n === 2, JSON.stringify(tb));
  await p.evaluate(() => { window.__scans = 0; const o = peScan; peScan = (...a) => { window.__scans++; return o(...a); }; });
  const m1 = await p.evaluate(async tb => { const b = await sysMark(2, tb.s.top, tb.s.bottom, SYS.byPage.get(2).systems[0]); return b; }, tb);
  ok('a mark on a tilted page lands on the same ink edges as the finder', m1 && Math.abs(m1.left - tb.s.left) < 0.012 && Math.abs(m1.right - tb.s.right) < 0.012, JSON.stringify([m1, tb.s]));
  await p.evaluate(async tb => { await sysMark(2, tb.s.top, tb.s.bottom + 0.01, SYS.byPage.get(2).systems[0]); }, tb);
  ok('the page is scanned once for several marks', await p.evaluate(() => window.__scans === 1), String(await p.evaluate(() => window.__scans)));
  const sharp = await p.evaluate(async () => {          // the tallest row of ink: staff lines are sharpest when the page is level
    const peak = sc => { let m = 0; for (let y = 0; y < sc.h; y++) { let n = 0; for (let x = 0, i = y * sc.w; x < sc.w; x++, i++) n += sc.ink[i]; if (n > m) m = n; } return m; };
    const lv = await sysLevel(2), raw = await peScan(S.pdf.slots[2].src, SYS_W, null, 0.85, false); return [peak(lv), peak(raw)];
  });
  ok('the kept scan is levelled by the page tilt', sharp[0] > sharp[1] * 1.3, JSON.stringify(sharp));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
