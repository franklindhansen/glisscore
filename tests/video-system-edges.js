// Video, System layout: dragging a Selection's left and right edges, and the zoomed preview's clip.
// Run with:  zsh tests/run-all.sh video-system-edges
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
}
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2);
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 2, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
  const boxes = (i = 0) => p.evaluate(i => (SYS.byPage.get(i) || { systems: [] }).systems.map(s => [s.top, s.bottom, s.left, s.right].map(v => +v.toFixed(4))), i);
  const steps = () => p.evaluate(() => S.history.length);
  const at = (y, x) => p.evaluate(([y, x]) => { const cv = document.querySelector('#selCv'), g = SEL.geo, r = cv.getBoundingClientRect(), k = r.width / cv.width; return [r.left + (g.ox + x * g.pa * g.u) * k, r.top + (g.oy + y * g.u) * k]; }, [y, x]);
  const drag = async (a, b2) => { await p.mouse.move(...a); await p.mouse.down(); await p.mouse.move(...b2, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(500); };
  const cursorAt = async pt => { await p.mouse.move(...pt); await p.waitForTimeout(80); return p.evaluate(() => document.querySelector('#selCv').style.cursor); };
  const f = await boxes(); const mid = i => (f[i][0] + f[i][1]) / 2; let h0 = await steps(), s;
  ok('three systems are found, the first current', f.length === 3 && await p.evaluate(() => SEL.geo.box === SYS.byPage.get(0).systems[0]));
  // the cursor on a left or right edge is the sideways one; the inside is the move one
  ok('the left edge shows the sideways cursor', await cursorAt(await at(mid(1), f[1][2])) === 'ew-resize');
  ok('the right edge shows the sideways cursor', await cursorAt(await at(mid(1), f[1][3])) === 'ew-resize');
  ok('the inside shows the move cursor', await cursorAt(await at(mid(1), 0.5)) === 'move');
  ok('the top edge keeps its cursor', await cursorAt(await at(f[1][0], 0.5)) === 'ns-resize');
  // widening the left edge of the first system
  await drag(await at(mid(0), f[0][2]), await at(mid(0), f[0][2] - 0.05)); s = await boxes();
  ok('dragging the left edge out widens that Selection', s[0][2] < f[0][2] - 0.04 && Math.abs(s[0][3] - f[0][3]) < 1e-3 && s[0][0] === f[0][0] && s[0][1] === f[0][1], JSON.stringify([f[0], s[0]]));
  ok('the other Selections stay', JSON.stringify(s.slice(1)) === JSON.stringify(f.slice(1)));
  ok('it is one History step', await steps() === h0 + 1);
  await p.click('#bUndo'); await p.waitForTimeout(500); ok('undo puts the edge back', JSON.stringify(await boxes()) === JSON.stringify(f), JSON.stringify(await boxes()));
  await p.click('#bRedo'); await p.waitForTimeout(500); s = await boxes(); ok('redo brings the edge back', s[0][2] < f[0][2] - 0.04);
  // the right edge
  const w = s[0][3]; await drag(await at(mid(0), w), await at(mid(0), w + 0.04)); s = await boxes();
  ok('dragging the right edge out widens that Selection', s[0][3] > w + 0.03, JSON.stringify(s[0]));
  ok('it is another single step', await steps() === h0 + 2);
  await drag(await at(mid(0), s[0][3]), await at(mid(0), 0.2)); s = await boxes();
  ok('tightening the right edge works too', s[0][3] < 0.25 && s[0][3] > s[0][2], JSON.stringify(s[0]));
  // clamps: the page, and a minimum width of 5% of the page
  await drag(await at(mid(0), s[0][2]), await at(mid(0), -0.2)); s = await boxes(); ok('an edge stops at the page edge', s[0][2] === 0, JSON.stringify(s[0]));
  await drag(await at(mid(0), s[0][3]), await at(mid(0), -0.3)); s = await boxes(); ok('a Selection keeps a minimum width of 5% of the page', Math.abs(s[0][3] - s[0][2] - 0.05) < 1e-3, JSON.stringify(s[0]));
  await drag(await at(mid(0), s[0][3]), await at(mid(0), 1.4)); s = await boxes(); ok('the right edge stops at the page edge', s[0][3] === 1, JSON.stringify(s[0]));
  // each system's edges are its own
  ok('the other systems still have the found sides', JSON.stringify(s.slice(1)) === JSON.stringify(f.slice(1)));
  // the corners: the number badge and the x keep priority over an edge
  const hit = async (y, x, dx = 0, dy = 0) => { const pt = await at(y, x); return p.evaluate(([a, c]) => { const r = document.querySelector('#selCv').getBoundingClientRect(); return selHit({ clientX: a, clientY: c }).t; }, [pt[0] + dx, pt[1] + dy]); };
  ok('on the number badge at the top left corner an edge is not offered', ['top', 'move', 'new'].includes(await hit(f[1][0], f[1][2], 0, 3)), await hit(f[1][0], f[1][2], 0, 3));
  ok('below the badge the left edge is offered', await hit(mid(1), f[1][2]) === 'left');
  ok('the x on the current Selection keeps its corner', await hit(s[0][0], s[0][3]) === 'del');
  // double-click: that Selection returns to what was found, sides included
  h0 = await steps(); const sp = await at(mid(0), 0.5), dbl = async pt => { await p.mouse.move(...pt); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(60); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(800); };
  await dbl(sp); s = await boxes(); ok('a double-click returns the hand-set sides to what was found', JSON.stringify(s[0]) === JSON.stringify(f[0]), JSON.stringify([f[0], s[0]]));
  ok('as one step', await steps() === h0 + 1);
  ok('and the Selection is no longer marked as set by hand', await p.evaluate(() => !SYS.byPage.get(0).systems[0].hx));
  // Detect again finds the page again: the hand-set side goes
  await drag(await at(mid(1), f[1][2]), await at(mid(1), f[1][2] - 0.04)); const e1 = (await boxes())[1];
  await p.evaluate(() => selJump(sysKey(0, 1))); await p.click('#spAgain'); await p.waitForTimeout(1800); s = await boxes();
  ok('Detect again resets the hand-set side', e1[2] < f[1][2] - 0.03 && Math.abs(s[1][2] - f[1][2]) < 1e-3 && s.length === 3, JSON.stringify([e1, s[1], f[1]]));
  await p.click('#bUndo'); await p.waitForTimeout(600); s = await boxes(); ok('and undo brings the hand-set side back', Math.abs(s[1][2] - e1[2]) < 1e-3, JSON.stringify(s[1]));
  await p.click('#bRedo'); await p.waitForTimeout(600); await drag(await at(mid(1), f[1][2]), await at(mid(1), f[1][2] - 0.04));
  // saved with the project
  const list = await p.evaluate(() => sysToList()); ok('the hand-set side is saved with the page', list[0].s[1].length >= 5 && list[0].s[1][4] === 1, JSON.stringify(list[0].s[1]));
  ok('and read back', await p.evaluate(l => { const c = sysListClean(l, 2); return c[0].s[1].hx === true; }, list));
  // a hand-widened system shrinks alone; the other sheets keep the score's size
  const fit = () => p.evaluate(() => { const { W, H } = outputSize(); return [0, 1, 2].map(k => sysFit(sysKey(0, k), W, H).s); });
  await p.evaluate(() => { const r = SYS.byPage.get(0); r.systems.forEach(s => { delete s.hx; s.left = 0.1; s.right = 0.9; }); SYS.rev++; });
  const base = await fit();
  await p.evaluate(() => { const r = SYS.byPage.get(0); Object.assign(r.systems[1], { left: 0, right: 1, hx: true }); SYS.rev++; });
  const wide = await fit();
  ok('a hand-widened system shrinks alone', wide[1] < base[1] * 0.9, JSON.stringify([base, wide]));
  ok('the other sheets keep the score\'s size', Math.abs(wide[0] - base[0]) < 1e-6 && Math.abs(wide[2] - base[2]) < 1e-6, JSON.stringify([base, wide]));
  ok('each sheet is centered on its own Selection', await p.evaluate(async () => { const { W, H } = outputSize(), f = sysFit(sysKey(0, 1), W, H), cv = await sysSheet(sysKey(0, 1), W, H); return cv.width === W && Math.abs((W - f.dw) / 2 - Math.round((W - f.dw) / 2)) < 1; }));
  // the zoomed preview is clipped to its own half at several zooms
  await p.evaluate(() => splitSet(0.5)); await p.waitForTimeout(400);
  for (const z of [1.6, 2.56, 4]) {
    const r = await p.evaluate(async z => {
      szReset(false); szAt(z, null, null, false); await new Promise(r => setTimeout(r, 150));
      const cv = document.querySelector('#stage'), wrap = document.querySelector('#stageWrap'), clip = getComputedStyle(cv).clipPath, m = clip.match(/inset\(([^)]*)\)/), v = m ? m[1].split(/\s+/).map(parseFloat) : null;
      const bb = cv.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), pl = parseFloat(wrap.style.paddingLeft) || 0, pt = parseFloat(wrap.style.paddingTop) || 0;
      if (!v) return { clip };
      const k = SZ.z, [T, R, B, L] = v.length === 1 ? [v[0], v[0], v[0], v[0]] : v.length === 2 ? [v[0], v[1], v[0], v[1]] : v.length === 3 ? [v[0], v[1], v[2], v[1]] : v, left = bb.left + L * k, top = bb.top + T * k, right = bb.right - R * k, bottom = bb.bottom - B * k;          // the visible part of the picture, on screen
      return { left: left - (wr.left + 1 + pl), top: top - (wr.top + 1 + pt), right: (wr.right - 1) - right, bottom: (wr.bottom - 1) - bottom, clip };
    }, z);
    ok('zoom ' + z + ': nothing of the preview shows left of or above its own half', r.left !== undefined && r.left > -1.5 && r.top > -1.5, JSON.stringify(r));
    ok('zoom ' + z + ': nothing shows past the stage', r.right > -1.5 && r.bottom > -1.5, JSON.stringify(r));
  }
  ok('the selector stays inside its own half when zoomed', await p.evaluate(() => { szReset(false, SZS); szAt(3, null, null, false, SZS); const pane = document.querySelector('#sysSel'); return getComputedStyle(pane).overflow === 'hidden'; }));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
