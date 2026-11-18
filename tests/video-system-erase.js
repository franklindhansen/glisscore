// Video, System layout: the eraser on the preview, on a clean digital page, a stained scan, and a cream page.
// Run with:  zsh tests/run-all.sh video-system-erase     (SHOTS=/some/folder also writes before and after pictures there)
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const fs = require('fs');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842, MARK = { x: 200, w: 46, dy: 36, h: 18 }, SYS_N = 3;          // a mark in the gap between the two staves of each system
function music(page, draw) {          // draw(kind, ...) is either pdf-lib's page or a canvas wrapper; coordinates are from the top left
  for (let k = 0; k < SYS_N; k++) {
    const y = 110 + k * 250;
    for (const off of [0, 62]) for (let j = 0; j < 5; j++) draw.line(50, y + off + j * 7, 545, y + off + j * 7, 0.7);
    [50, 300, 545].forEach(x => draw.line(x, y, x, y + 90, 0.9));
    for (let q = 0; q < 8; q++) draw.ell(70 + q * 60, y + (q % 5) * 7, 4, 3);
    draw.rect(MARK.x, y + MARK.dy, MARK.w, MARK.h);          // the rehearsal mark
    draw.rect(MARK.x + 8, y + MARK.dy + 4, 8, 10, true);
  }
}
const digital = async (paper) => {
  const doc = await PDFDocument.create(), page = doc.addPage([PW, PH]);
  if (paper) page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: rgb(...paper) });
  music(page, { line: (a, b, c, d, t) => page.drawLine({ start: { x: a, y: PH - b }, end: { x: c, y: PH - d }, thickness: t }), ell: (x, y, rx, ry) => page.drawEllipse({ x, y: PH - y, xScale: rx, yScale: ry }), rect: (x, y, w, h, hole) => page.drawRectangle({ x, y: PH - y - h, width: w, height: h, color: hole ? rgb(1, 1, 1) : rgb(0.05, 0.05, 0.05) }) });
  if (paper) { /* the hole is the paper too */ }
  return Buffer.from(await doc.save());
};
(async () => {
  const b = await chromium.launch(), g = await b.newPage();
  // a stained scan: tinted paper that darkens toward one side, grain, and a stain behind the first system's mark; staves and marks are pixels
  const png = await g.evaluate(({ PW, PH, MARK, SYS_N }) => {
    const S2 = 2, c = document.createElement('canvas'); c.width = PW * S2; c.height = PH * S2; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, c.width, c.height); gr.addColorStop(0, 'rgb(238,228,205)'); gr.addColorStop(1, 'rgb(218,203,172)'); x.fillStyle = gr; x.fillRect(0, 0, c.width, c.height);
    for (let k = 0; k < SYS_N; k++) { const cx = (MARK.x + MARK.w / 2) * S2, cy = (110 + k * 250 + MARK.dy + MARK.h / 2) * S2, rg = x.createRadialGradient(cx, cy, 20, cx, cy, 260); rg.addColorStop(0, 'rgba(150,110,50,.30)'); rg.addColorStop(1, 'rgba(150,110,50,0)'); x.fillStyle = rg; x.fillRect(cx - 260, cy - 260, 520, 520); }
    const id = x.getImageData(0, 0, c.width, c.height), d = id.data; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(id, 0, 0);
    x.strokeStyle = 'rgb(25,22,18)'; x.fillStyle = 'rgb(25,22,18)';
    const line = (a, b2, c2, d2, t) => { x.lineWidth = t * S2; x.beginPath(); x.moveTo(a * S2, b2 * S2); x.lineTo(c2 * S2, d2 * S2); x.stroke(); };
    for (let k = 0; k < SYS_N; k++) {
      const y = 110 + k * 250;
      for (const off of [0, 62]) for (let j = 0; j < 5; j++) line(50, y + off + j * 7, 545, y + off + j * 7, 0.9);
      [50, 300, 545].forEach(xx => line(xx, y, xx, y + 90, 1.1));
      for (let q = 0; q < 8; q++) { x.beginPath(); x.ellipse((70 + q * 60) * S2, (y + (q % 5) * 7) * S2, 4 * S2, 3 * S2, 0, 0, 7); x.fill(); }
      x.fillRect(MARK.x * S2, (y + MARK.dy) * S2, MARK.w * S2, MARK.h * S2);
    }
    return c.toDataURL('image/png').split(',')[1];
  }, { PW, PH, MARK, SYS_N });
  const scan = await (async () => { const doc = await PDFDocument.create(), page = doc.addPage([PW, PH]), img = await doc.embedPng(Buffer.from(png, 'base64')); page.drawImage(img, { x: 0, y: 0, width: PW, height: PH }); return Buffer.from(await doc.save()); })();
  const cases = [['digital', await digital(null)], ['scan', scan], ['cream', await digital([0.96, 0.92, 0.8])]];
  const SH = process.env.SHOTS; if (SH) fs.mkdirSync(SH, { recursive: true });
  for (const [name, bytes] of cases) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: name + '.pdf', mimeType: 'application/pdf', buffer: bytes });
    await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 1, null, { timeout: 60000 }); await p.waitForTimeout(800);
    await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
    await p.evaluate(() => { splitSet(0); selJump(sysKey(0, 1)); }); await p.waitForTimeout(1200);
    const T = name + ': ';
    // where the mark of system 1 is: page fractions, then its place on the sheet and on screen
    const M = { x0: MARK.x / PW, x1: (MARK.x + MARK.w) / PW, y0: (110 + 250 + MARK.dy) / PH, y1: (110 + 250 + MARK.dy + MARK.h) / PH };
    const stats = (key, dy = 0) => p.evaluate(async ({ key, M }) => {
      const lay = previewR.lay, cv = await sysSheet(key, lay.pw, lay.ph), f = sysFit(key, lay.pw, lay.ph), bx = f.box, x0 = Math.round((lay.pw - f.dw) / 2), y0 = Math.round((lay.ph - f.dh) / 2);
      const X = fx => x0 + (fx - bx.left) / (bx.right - bx.left) * f.dw, Y = fy => y0 + (fy - bx.top) / (bx.bottom - bx.top) * f.dh;
      const a = Math.round(X(M.x0)) + 1, c = Math.round(X(M.x1)) - 1, t = Math.round(Y(M.y0)) + 1, d = Math.round(Y(M.y1)) - 1, id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), px = (xx, yy) => { const i = (yy * cv.width + xx) * 4; return [id.data[i], id.data[i + 1], id.data[i + 2]]; };
      let lo = 255, hi = 0, sum = [0, 0, 0], n = 0, mx = 0; const inner = [];
      for (let yy = t; yy <= d; yy++) for (let xx = a; xx <= c; xx++) { const q = px(xx, yy), l = (q[0] + q[1] + q[2]) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); sum = sum.map((v, j) => v + q[j]); n++; inner.push(q); }
      const ring = [0, 0, 0]; let rn = 0; for (let yy = t - 14; yy <= d + 14; yy++) for (let xx = a - 14; xx <= c + 14; xx++) { if (xx >= a - 4 && xx <= c + 4 && yy >= t - 4 && yy <= d + 4) continue; const q = px(xx, yy); ring[0] += q[0]; ring[1] += q[1]; ring[2] += q[2]; rn++; }
      const rm = ring.map(v => v / rn), im = sum.map(v => v / n); inner.forEach(q => { mx = Math.max(mx, Math.abs(q[0] - rm[0]), Math.abs(q[1] - rm[1]), Math.abs(q[2] - rm[2])); });
      return { lo, hi, mean: im.map(v => +v.toFixed(1)), ring: rm.map(v => +v.toFixed(1)), max: mx, W: lay.pw, H: lay.ph, rect: [a, t, c, d] };
    }, { key, M: dy ? { x0: M.x0, x1: M.x1, y0: M.y0 + dy / PH, y1: M.y1 + dy / PH } : M });
    const sk = (pg, k) => pg + k * 100000, key1 = sk(0, 1), stats2 = key => stats(key, 250);
    const before = await stats(key1);
    ok(T + 'the mark is dark before erasing', before.lo < 60, JSON.stringify(before));
    // the screen point of a page point, on the preview
    const scr = ([fx, fy]) => p.evaluate(([fx, fy]) => { const T = eraseTarget(), lay = previewR.lay, b = stageCanvas.getBoundingClientRect(), f = sysFit(T.key, lay.pw, lay.ph), bx = f.box, x0 = Math.round((lay.pw - f.dw) / 2), y0 = Math.round((lay.ph - f.dh) / 2); return [b.left + (x0 + (fx - bx.left) / (bx.right - bx.left) * f.dw) / lay.pw * b.width, b.top + (y0 + (fy - bx.top) / (bx.bottom - bx.top) * f.dh) / lay.ph * b.height]; }, [fx, fy]);
    const shot = async (file) => { if (!SH) return; const a = await scr([M.x0, M.y0]), c = await scr([M.x1, M.y1]), cx = (a[0] + c[0]) / 2, cy = (a[1] + c[1]) / 2; await p.mouse.move(2, 2); await p.waitForTimeout(150); await p.screenshot({ path: SH + '/' + file, clip: { x: Math.max(0, cx - 180), y: Math.max(0, cy - 90), width: 360, height: 180 } }); };
    await p.mouse.move(2, 2); await p.waitForTimeout(300); await shot(name + '-before.png');
    // the button: first in the strip, then the shared separator, then the zoom buttons
    if (name === 'digital') {
      const strip = await p.evaluate(() => { const k = [...document.querySelector('#stageStrip').children].filter(e => !e.hidden).map(e => e.id || e.className); const b = document.querySelector('#szErase'); return { k, pressed: b.getAttribute('aria-pressed'), cls: document.querySelector('#stageStrip button').matches('#stageStrip button'), svg: !!b.querySelector('svg'), h: b.getBoundingClientRect().height, hz: document.querySelector('#szIn').getBoundingClientRect().height, w: b.getBoundingClientRect().width, wz: document.querySelector('#szIn').getBoundingClientRect().width, tip: b.title }; });
      ok('the eraser is first in the strip, then the separator, then Zoom out, In, Fit', strip.k.slice(0, 5).join() === 'szErase,szEraseDiv,szOut,szIn,szFit' || strip.k.slice(0, 5).join() === 'szErase,stage-div,szOut,szIn,szFit', strip.k.join());
      ok('it is the same size as the other strip buttons and has an icon', Math.abs(strip.h - strip.hz) < 0.6 && Math.abs(strip.w - strip.wz) < 0.6 && strip.svg, JSON.stringify(strip));
      ok('its tooltip is the wording', strip.tip === 'Erase marks (E)', strip.tip);
    }
    await p.click('#szErase'); await p.waitForTimeout(150);
    ok(T + 'the eraser holds a pressed look while on', await p.evaluate(() => { const b = document.querySelector('#szErase'); return b.getAttribute('aria-pressed') === 'true' && getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)'; }));
    // brush over the mark in rows: one stroke
    const A = await scr([M.x0, M.y0]), C = await scr([M.x1, M.y1]), h0 = await p.evaluate(() => S.history.length);
    await p.mouse.move(A[0] - 8, A[1] - 2); await p.mouse.down(); let dir = 1;
    for (let y = A[1] - 2; y <= C[1] + 6; y += 6) { const xa = dir > 0 ? A[0] - 8 : C[0] + 8, xb = dir > 0 ? C[0] + 8 : A[0] - 8; await p.mouse.move(xa, y, { steps: 2 }); await p.mouse.move(xb, y, { steps: 10 }); dir = -dir; }
    if (name === 'digital') ok('the ring follows the pointer while brushing', await p.evaluate(() => { const r = document.querySelector('#eraseRing'); return !r.hidden && Math.abs(r.getBoundingClientRect().width - 16) < 0.6; }));
    await p.mouse.up(); await p.waitForTimeout(700);
    const after = await stats(key1);
    if (name === 'digital') ok(T + 'a clean page: every dot where the mark was is pure white', after.lo === 255 && after.hi === 255 && after.ring.every(v => v === 255), JSON.stringify(after));
    else if (name === 'cream') ok(T + 'a cream page: the erased place is the paper\'s own color', after.max <= 2 && after.hi - after.lo <= 3, JSON.stringify(after));
    else ok(T + 'a stained scan: the erased place matches the paper around it', after.max <= 16 && Math.max(...after.mean.map((v, j) => Math.abs(v - after.ring[j]))) <= 8, JSON.stringify(after));
    ok(T + 'the stroke was one History step', await p.evaluate(() => S.history.length) === h0 + 1);
    await p.waitForTimeout(300); await shot(name + '-after.png');
    ok(T + 'the stroke belongs to system 1 only', await p.evaluate(() => { const l = SYS.byPage.get(0).systems; return !!(l[1].er && l[1].er.length === 1) && !(l[0].er || []).length && !(l[2].er || []).length; }));
    const other = await stats2(sk(0, 2)); ok(T + 'the same spot on the next system\'s sheet is not erased there (its own mark shows)', other.lo < 60, JSON.stringify(other));
    if (name !== 'digital') { ok('no page errors', errs.length === 0, errs.join(' | ')); await p.close(); continue; }
    // ---- the rest is checked once, on the digital page
    { const lab = await p.evaluate(() => mainStepLabel(S.history[S.history.length - 1], snap())); ok('the History step is named Erase', lab === 'Erase', lab); }
    // the preview itself shows it (the picture drawn), and the selector never does
    await p.evaluate(() => splitSet(0.5)); await p.waitForTimeout(900);
    { const v = await p.evaluate(async () => { selSync(true); for (let i = 0; i < 40 && !(SEL.bmp && SEL.bmpIdx === 0 && SEL.geo && SEL.geo.idx === 0); i++) { await new Promise(r => setTimeout(r, 100)); selPaint(); } selPaint(); const cv = document.querySelector('#selCv'), g = SEL.geo, x = cv.getContext('2d'), a = 200 / 595; let m = 255; const y0 = (110 + 250 + 40) / 842, y1 = (110 + 250 + 46) / 842, im = x.getImageData(Math.round(g.ox + (a + 0.06) * g.pa * g.u), Math.round(g.oy + y0 * g.u), 6, Math.max(2, Math.round((y1 - y0) * g.u))).data; for (let i = 0; i < im.length; i += 4) m = Math.min(m, im[i]); return [m, !!SEL.bmp, SEL.bmpIdx, g.idx, SEL.key, g.u]; }); ok('the selector shows the whole page, mark and all', v[0] < 80, JSON.stringify(v)); }
    await p.evaluate(() => splitSet(0)); await p.waitForTimeout(600);
    // undo and redo
    await p.click('#bUndo'); await p.waitForTimeout(700); let st = await stats(key1); ok('undo brings the mark back', st.lo < 60, JSON.stringify(st));
    await p.click('#bRedo'); await p.waitForTimeout(700); st = await stats(key1); ok('redo erases it again', st.lo === 255, JSON.stringify(st));
    // Detect again keeps it
    await p.evaluate(() => { splitSet(0.5); }); await p.waitForTimeout(500);
    await p.evaluate(() => selJump(sysKey(0, 1))); await p.waitForTimeout(500); await p.click('#spAgain'); await p.waitForTimeout(2200);
    ok('Detect again clears it', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 0));
    await p.click('#bUndo'); await p.waitForTimeout(800); ok('and undo brings the erasure back', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 1));
    await p.evaluate(() => splitSet(0)); await p.waitForTimeout(500);
    st = await stats(key1); ok('and the sheet shows it erased again after undo', st.lo === 255, JSON.stringify(st));
    // it follows the Selection when moved or resized
    await p.evaluate(async () => { const r = SYS.byPage.get(0), pp = sysPush(r.systems.slice(), 'move', 1, 0.004); await sysPlace(0, pp.boxes, pp.out); });
    ok('moving the Selection keeps its erasure', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 1));
    st = await stats(key1); ok('and the mark stays erased on the moved sheet', st.lo === 255, JSON.stringify(st));
    // saved with the project
    const list = await p.evaluate(() => sysToList()); const clean = await p.evaluate(l => sysListClean(l, 1), list);
    ok('it is saved with the page and read back', clean && clean[0].s[1].er && clean[0].s[1].er.length === 1 && clean[0].s[1].er[0].r > 0, JSON.stringify(list[0].s[1]).slice(0, 120));
    await p.evaluate(l => { sysFromList(sysListClean(l, 1)); }, list); await p.waitForTimeout(2500);
    st = await stats(key1); ok('after reopening, the mark is still erased', st.lo === 255, JSON.stringify(st));
    // the export draws what the preview draws: the sheet the exporter asks for is the one measured above (sysSheet), and the preview's own composition is the same picture
    ok('the export and the preview compose the same sheet', await p.evaluate(async () => { const lay = previewR.lay, a = await sysSheet(sysKey(0, 1), lay.pw, lay.ph), f = sysFit(sysKey(0, 1), lay.pw, lay.ph), c = sysCompose(sysKept(0), f, lay.pw, lay.ph), x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i]) return false; return true; }));
    // the brush is the same size on screen at every zoom, and Space-drag pans while erasing
    await p.evaluate(() => eraseSet(true)); const pc = await scr([M.x0, M.y0]); await p.evaluate(([x, y]) => szAt(3, x, y, false), pc); await p.waitForTimeout(300);
    const pt = await scr([M.x0 - 0.01, M.y0 + 0.01]); await p.mouse.move(pt[0], pt[1]); await p.waitForTimeout(100);
    ok('the ring is the same size when zoomed', await p.evaluate(() => Math.abs(document.querySelector('#eraseRing').getBoundingClientRect().width - 16) < 0.6));
    const hh0 = await p.evaluate(() => S.history.length); const z0 = await p.evaluate(() => [SZ.x, SZ.y]); await p.keyboard.down('Space'); await p.mouse.move(pt[0], pt[1]); await p.mouse.down(); await p.mouse.move(pt[0] + 30, pt[1] + 10, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Space'); await p.waitForTimeout(200);
    const z1 = await p.evaluate(() => [SZ.x, SZ.y]); const hh = await p.evaluate(() => S.history.length), hBefore = hh0;
    ok('Space-drag pans the zoomed preview and erases nothing', (Math.abs(z1[0] - z0[0]) > 10 || Math.abs(z1[1] - z0[1]) > 5) && hh === hBefore, JSON.stringify([z0, z1, hh, hBefore]));
    await p.evaluate(() => szReset(false)); await p.waitForTimeout(200);
    // Esc turns it off; E turns it on; a second click turns it off
    await p.keyboard.press('Escape'); await p.waitForTimeout(150); ok('Esc turns the eraser off', await p.evaluate(() => !ERASE.on && document.querySelector('#szErase').getAttribute('aria-pressed') === 'false'));
    await p.mouse.move(600, 300); await p.keyboard.press('e'); await p.waitForTimeout(150); ok('E turns it on', await p.evaluate(() => ERASE.on));
    await p.click('#szErase'); await p.waitForTimeout(150); ok('a second click turns it off', await p.evaluate(() => !ERASE.on));
    // touch erases too
    { const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await p.evaluate(() => eraseSet(true)); const q0 = await scr([0.1, (110 + 250 + 70) / PH * 0 + (110 + 250 + 10) / 842]), q1 = await scr([0.14, (110 + 250 + 10) / 842]); const h1 = await p.evaluate(() => S.history.length);
      const t = async (type, xy) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: xy ? [{ x: xy[0], y: xy[1], id: 1 }] : [] });
      await t('touchStart', q0); for (let i = 1; i <= 5; i++) await t('touchMove', [q0[0] + (q1[0] - q0[0]) * i / 5, q0[1] + (q1[1] - q0[1]) * i / 5]); await t('touchEnd'); await p.waitForTimeout(500);
      ok('touch erases with the same brush', await p.evaluate(() => S.history.length) === h1 + 1);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await p.evaluate(() => eraseSet(false)); }
    // deleting the Selection removes its erasure; a geometry change drops it
    ok('deleting the Selection takes its erasures with it', await p.evaluate(() => { const r = SYS.byPage.get(0), b = r.systems[1]; sysRemove(0, b); return !SYS.byPage.get(0).systems.includes(b) && SYS.byPage.get(0).systems.every(s => !(s.er || []).length); }));
    await p.click('#bUndo'); await p.waitForTimeout(500);
    ok('undo brings the Selection and its erasure back', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length >= 1));
    ok('a page geometry change drops the page\'s record, erasures with it', await p.evaluate(() => { S.pdf.slots[0].skew = 0.5; sysSync(); return !SYS.byPage.has(0); }));
    // greyed on a Full page, hidden outside System
    await p.evaluate(() => { S.pdf.slots[0].skew = 0; sysFresh(); }); await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
    await p.evaluate(() => sysSetFull(0, true)); await p.waitForTimeout(800);
    ok('on a Full page the eraser is greyed with its reason', await p.evaluate(() => { const b = document.querySelector('#szErase'); return b.disabled && b.title === 'Choose a system to erase on.'; }));
    await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=spread]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(800);
    ok('outside System the eraser is not shown', await p.evaluate(() => document.querySelector('#szErase').hidden && document.querySelector('#szEraseDiv').hidden));
    // the narrow, stacked layout
    await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(800);
    await p.setViewportSize({ width: 520, height: 900 }); await p.waitForTimeout(800);
    ok('narrow: the eraser is in the strip and fits', await p.evaluate(() => { const b = document.querySelector('#szErase').getBoundingClientRect(), s = document.querySelector('#stageStrip').getBoundingClientRect(); return !document.querySelector('#szErase').hidden && b.left >= s.left - 0.5 && b.right <= s.right + 0.5; }));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  }
  await b.close();
})();
