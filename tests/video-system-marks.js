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
  const before = await sys(), h0 = await steps(); let s;
  ok('three systems are found first', before.length === 3, JSON.stringify(before));
  ok('marking is on without a button', await p.evaluate(() => !document.querySelector('#spMark')));
  // a new system is made by one press and drag on blank page; a click on blank page does nothing
  const same = async (name) => ok(name, JSON.stringify(await sys()) === JSON.stringify(before) && await steps() === h0, JSON.stringify(await sys()));
  await click(await at(0.03)); await same('a single click on blank page does nothing');
  await click(await at(0.03)); await p.waitForTimeout(600); await click(await at(0.09)); await same('two clicks apart do nothing');
  ok('blank page shows the plain pointer, not a crosshair', await p.evaluate(() => document.querySelector('#selCv').style.cursor !== 'crosshair'));
  await drag(await at(0.03), await at(0.085));
  s = await sys();
  ok('a press and drag on blank page marks a region the finder skipped, with no double-click', s.length === 4 && s[0][0] < 0.04 && s[0][1] > 0.07, JSON.stringify(s));
  ok('it is one History step', await steps() === h0 + 1);
  ok('the new Selection takes the page\'s usual left and right', await p.evaluate(() => { const l = SYS.byPage.get(0).systems, n = l[0], o = l[1]; return Math.abs(n.left - o.left) < 0.02 && Math.abs(n.right - o.right) < 0.02 && !n.hx; }));
  await p.click('#bUndo'); await p.waitForTimeout(500);
  ok('undo takes the mark away', JSON.stringify(await sys()) === JSON.stringify(before), JSON.stringify(await sys()));
  await p.click('#bRedo'); await p.waitForTimeout(500);
  ok('redo brings it back', (await sys()).length === 4);
  // a press and drag over the second and third system replaces neither but pushes them
  const q = await sys();
  await drag(await at(q[2][0] - 0.03), await at(q[3][1] + 0.03));
  s = await sys();
  ok('a drag from blank page over systems pushes what it overlaps and removes nothing', s.length === q.length + 1 && s.every((r, i) => r[1] - r[0] >= 0.014 && (!i || r[0] >= s[i - 1][1] - 1e-6)) && s[s.length - 1][1] <= 1.0001 && s.some(r => r[0] < q[2][0] && r[1] > q[3][1] - 0.001), JSON.stringify(s));
  ok('and is one step', await steps() === h0 + 2);
  await p.click('#bUndo'); await p.click('#bUndo'); await p.waitForTimeout(500);
  ok('two undos restore the found systems', JSON.stringify(await sys()) === JSON.stringify(before), JSON.stringify(await sys()));
  // touch: a plain drag on blank page marks the same way
  { const cdp = await p.context().newCDPSession(p), pt = ([x, y]) => [{ x, y, id: 1 }]; await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const t = async (type, xy) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: xy ? pt(xy) : [] });
    const a0 = await at(0.03), a1 = await at(0.085); await t('touchStart', a0);
    for (let i = 1; i <= 6; i++) await t('touchMove', [a0[0] + (a1[0] - a0[0]) * i / 6, a0[1] + (a1[1] - a0[1]) * i / 6]); await t('touchEnd'); await p.waitForTimeout(600);
    s = await sys(); ok('touch: a plain drag on blank page marks a system', s.length === 4 && s[0][0] < 0.04 && s[0][1] > 0.07, JSON.stringify(s));
    ok('a double tap allows a finger-sized gap, a double-click does not', await p.evaluate(() => dblNear(100, 20, 0, 'touch') && !dblNear(100, 20, 0, 'mouse') && dblNear(100, 4, 0, 'mouse') && !dblNear(500, 0, 0, 'touch')));
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await p.waitForTimeout(300); await p.click('#bUndo'); await p.waitForTimeout(600); ok('touch: undo takes the touch mark away', JSON.stringify(await sys()) === JSON.stringify(before), JSON.stringify(await sys())); }
  if (process.env.SHOTS) { await p.mouse.move(...(await at(0.37))); await p.waitForTimeout(200); await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/marks.png' }); await p.keyboard.press('Escape'); }
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
  // double-click a Selection: that one box returns to what was found, as one step; a neighbor in the way gives way; a hand-drawn box with nothing found under it does nothing
  await p.evaluate(() => selJump(sysKey(1, 0))); await p.waitForTimeout(600);
  const box1 = () => p.evaluate(() => SYS.byPage.get(1).systems.map(s => [s.top, s.bottom, s.left, s.right].map(v => +v.toFixed(4))));
  const dbl = async pt => { await p.mouse.move(...pt); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(60); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(700); };
  const f0 = await box1(); let hd = await steps();
  await dbl(await at((f0[0][0] + f0[0][1]) / 2));
  ok('double-clicking a Selection that is at its default does nothing', JSON.stringify(await box1()) === JSON.stringify(f0) && await steps() === hd, JSON.stringify([f0, await box1()]));
  await drag(await at(f0[0][1]), await at(f0[0][1] + 0.05)); const r1 = await box1();         // the first system is made taller by hand, which pushes the second down
  ok('a hand resize changes the box', r1[0][1] > f0[0][1] + 0.03, JSON.stringify([f0[0], r1[0]]));
  hd = await steps(); await dbl(await at((r1[0][0] + r1[0][1]) / 2));
  const r2 = await box1();
  ok('double-click resets that one box to what was found, as one step', r2[0].every((v, j) => Math.abs(v - f0[0][j]) < 0.002) && await steps() === hd + 1, JSON.stringify([f0[0], r2[0]]));
  ok('the other Selection on the page is left where it was', JSON.stringify(r2[1]) === JSON.stringify(r1[1]), JSON.stringify([r1[1], r2[1]]));
  await p.click('#bUndo'); await p.waitForTimeout(500);
  ok('undo puts the box back where the hand left it', JSON.stringify(await box1()) === JSON.stringify(r1), JSON.stringify(await box1()));
  await p.click('#bRedo'); await p.waitForTimeout(500);
  // a neighbor in the way: the second system is moved up over the first one's default, then the first is reset
  const turnBefore = await p.evaluate(() => S.spreads.map(sp => sp.b ? 1 : 0).length);
  await p.evaluate(async () => { const r = SYS.byPage.get(1), a = r.systems[0], c = r.systems[1], p = sysPush(r.systems.slice(), 'move', 1, -(c.top - (a.top + 0.05))); await sysPlace(1, p.boxes, p.out); });
  const r3 = await box1(); hd = await steps();
  await p.evaluate(async () => { const r = SYS.byPage.get(1); window.__ok = await sysResetOne(1, r.systems[0]); });
  const r4 = await box1();
  ok('a neighbor in the way gives way and nothing is removed', await p.evaluate(() => window.__ok === true) && r4.length === 2 && r4[1][0] >= r4[0][1] - 1e-6 && r4[0][0] === f0[0][0] && r4[0][1] === f0[0][1] && await steps() === hd + 1, JSON.stringify([r3, r4]));
  // a hand-drawn box over nothing found does nothing
  const none = await p.evaluate(async () => { const r = SYS.byPage.get(1); await sysMark(1, 0.01, 0.05); const q = r.systems.find(s => s.bottom <= 0.06); const h = S.history.length; const ok = q ? await sysResetOne(1, q) : 'no box'; return { ok, steps: S.history.length - h, has: !!q }; });
  ok('a hand-drawn box with no found system under it does nothing', none.has && none.ok === false && none.steps === 0, JSON.stringify(none));
  // saved work with no record of what was found: the page is measured again, and nothing else on it is replaced
  const saved = await p.evaluate(async f0 => {
    const r = SYS.byPage.get(1); delete r.auto; SYS.hand.add(1); r.systems = f0.map(b => ({ top: b[0], bottom: b[1], left: b[2], right: b[3] })); r.systems[r.systems.length - 1].bottom = Math.min(1, r.systems[r.systems.length - 1].bottom + 0.02);
    const last = r.systems[r.systems.length - 1], n = r.systems.length, sc = window.peScan; let scans = 0; window.peScan = (...a) => { scans++; return sc(...a); };
    const ok = await sysResetOne(1, last); window.peScan = sc; return { ok, scans, n: SYS.byPage.get(1).systems.length, same: SYS.byPage.get(1) === r, kept: !!r.auto };
  }, f0);
  ok('with no record of what was found, one page is measured once and kept', saved.ok === true && saved.scans === 1 && saved.same && saved.kept, JSON.stringify(saved));
  // a tilted page: a mark measures its ink the way the finder did, and the scan is kept between marks
  await p.evaluate(() => selJump(sysKey(2, 0))); await p.waitForTimeout(600);
  const tb = await p.evaluate(() => { const r = SYS.byPage.get(2); return { tilt: r.tilt, n: r.systems.length, s: r.systems[0] }; });
  ok('the tilted page has its tilt and two systems', Math.abs(tb.tilt) > 0.5 && tb.n === 2, JSON.stringify(tb));
  await p.evaluate(() => { window.__scans = 0; const o = peScan; peScan = (...a) => { window.__scans++; return o(...a); }; });
  const nudge = (dy) => p.evaluate(async dy => { const r = SYS.byPage.get(2), a = r.systems[0], pp = sysPush(r.systems.slice(), 'move', 0, dy); await sysPlace(2, pp.boxes, pp.out); return SYS.byPage.get(2).systems.find(s => s === a); }, dy);
  const m1 = await nudge(0.01);
  ok('a Selection moved on a tilted page lands on the same ink edges as the finder', m1 && Math.abs(m1.left - tb.s.left) < 0.012 && Math.abs(m1.right - tb.s.right) < 0.012, JSON.stringify([m1, tb.s]));
  await nudge(0.01);
  ok('moves on a page whose staves are kept scan nothing', await p.evaluate(() => window.__scans === 0), String(await p.evaluate(() => window.__scans)));
  await p.evaluate(() => { delete SYS.byPage.get(2).stv; window.__scans = 0; });          // a page restored from saved work has no kept staves: it is measured once
  await nudge(0.01); await nudge(0.01);
  ok('a page with no kept staves is measured once for several moves', await p.evaluate(() => window.__scans === 1 && !!SYS.byPage.get(2).stv), String(await p.evaluate(() => window.__scans)));
  const sharp = await p.evaluate(async () => {          // the tallest row of ink: staff lines are sharpest when the page is level
    const peak = sc => { let m = 0; for (let y = 0; y < sc.h; y++) { let n = 0; for (let x = 0, i = y * sc.w; x < sc.w; x++, i++) n += sc.ink[i]; if (n > m) m = n; } return m; };
    const lv = await sysLevel(2), raw = await peScan(S.pdf.slots[2].src, SYS_W, null, 0.85, false); return [peak(lv), peak(raw)];
  });
  ok('the kept scan is levelled by the page tilt', sharp[0] > sharp[1] * 1.3, JSON.stringify(sharp));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
