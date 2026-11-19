// Video, System layout: the eraser on the System selector (button, freeze, brushing, start rules, cut, ring, highlight, hover ×, History names, preview fade), on a clean digital page, a stained scan, and a cream page.
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
    await p.evaluate(() => { splitSet(0.5); selJump(sysKey(0, 1)); }); await p.waitForTimeout(1200);
    await p.evaluate(async () => { selSync(true); for (let i = 0; i < 60 && !(SEL.bmp && SEL.bmpIdx === 0 && SEL.geo && SEL.geo.idx === 0); i++) { await new Promise(r => setTimeout(r, 100)); selPaint(); } selPaint(); });
    const T = name + ': ';
    const M = { x0: MARK.x / PW, x1: (MARK.x + MARK.w) / PW, y0: (110 + 250 + MARK.dy) / PH, y1: (110 + 250 + MARK.dy + MARK.h) / PH };
    // the composed sheet of a system, measured over the mark: through sysSheet (what the export asks for), or through the preview's own held sheet (what it shows while a patch fades)
    const measure = (via, key, dy = 0) => p.evaluate(async ({ via, key, M }) => {
      const lay = previewR.lay; let cv; if (via === 'held') { const e = previewR.lbT.get(key); if (!e) return null; cv = e.cv; } else cv = await sysSheet(key, lay.pw, lay.ph);
      const f = sysFit(key, lay.pw, lay.ph), bx = f.box, x0 = Math.round((lay.pw - f.dw) / 2), y0 = Math.round((lay.ph - f.dh) / 2);
      const X = fx => x0 + (fx - bx.left) / (bx.right - bx.left) * f.dw, Y = fy => y0 + (fy - bx.top) / (bx.bottom - bx.top) * f.dh;
      const a = Math.round(X(M.x0)) + 1, c = Math.round(X(M.x1)) - 1, t = Math.round(Y(M.y0)) + 1, d = Math.round(Y(M.y1)) - 1, id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height), px = (xx, yy) => { const i = (yy * cv.width + xx) * 4; return [id.data[i], id.data[i + 1], id.data[i + 2]]; };
      let lo = 255, hi = 0, sum = [0, 0, 0], n = 0, mx = 0; const inner = [];
      for (let yy = t; yy <= d; yy++) for (let xx = a; xx <= c; xx++) { const q = px(xx, yy), l = (q[0] + q[1] + q[2]) / 3; lo = Math.min(lo, l); hi = Math.max(hi, l); sum = sum.map((v, j) => v + q[j]); n++; inner.push(q); }
      const ring = [0, 0, 0]; let rn = 0; for (let yy = t - 14; yy <= d + 14; yy++) for (let xx = a - 14; xx <= c + 14; xx++) { if (xx >= a - 4 && xx <= c + 4 && yy >= t - 4 && yy <= d + 4) continue; const q = px(xx, yy); ring[0] += q[0]; ring[1] += q[1]; ring[2] += q[2]; rn++; }
      const rm = ring.map(v => v / rn), im = sum.map(v => v / n); inner.forEach(q => { mx = Math.max(mx, Math.abs(q[0] - rm[0]), Math.abs(q[1] - rm[1]), Math.abs(q[2] - rm[2])); });
      return { lo, hi, mean: im.map(v => +v.toFixed(1)), ring: rm.map(v => +v.toFixed(1)), max: mx };
    }, { via, key, M: dy ? { x0: M.x0, x1: M.x1, y0: M.y0 + dy / PH, y1: M.y1 + dy / PH } : M });
    const stats = (key, dy) => measure('sheet', key, dy), sk = (pg, k) => pg + k * 100000, key1 = sk(0, 1);
    const before = await stats(key1);
    ok(T + 'the mark is dark before erasing', before.lo < 60, JSON.stringify(before));
    // a page point on the selector, in screen pixels
    const scr = ([fx, fy]) => p.evaluate(([fx, fy]) => { const cv = document.querySelector('#selCv'), b = cv.getBoundingClientRect(), g = SEL.geo; return [b.left + (g.ox + fx * g.pa * g.u) / cv.width * b.width, b.top + (g.oy + fy * g.u) / cv.height * b.height]; }, [fx, fy]);
    const shot = async (file) => { if (!SH) return; await p.mouse.move(2, 2); await p.waitForTimeout(200); await p.screenshot({ path: SH + '/' + file, clip: { x: 0, y: 0, width: 660, height: 900 } }); };
    await p.mouse.move(2, 2); await p.waitForTimeout(300); await shot(name + '-before.png');
    if (name === 'digital') {
      // the button: last in the selector's left bar, after Detect again and a shared separator; gone from the preview's strip
      const bar = await p.evaluate(() => { const nav = document.querySelector('.sys-nav'), k = [...nav.children].map(e => e.id || e.className.split(' ')[0]), b = document.querySelector('#szErase'), z = document.querySelector('#spAgain'), r = b.getBoundingClientRect(), rz = z.getBoundingClientRect(); return { k, inNav: nav.contains(b), pressed: b.getAttribute('aria-pressed'), svg: !!b.querySelector('svg'), dh: Math.abs(r.height - rz.height), dw: Math.abs(r.width - rz.width), tip: b.title, strip: !!document.querySelector('#stageStrip #szErase, #szEraseDiv'), ring: document.querySelector('#eraseRing').parentElement.id }; });
      ok('the eraser ends the selector\'s left bar: Detect again, a separator, then the eraser', bar.inNav && bar.k.slice(-3).join() === 'spAgain,stage-div,szErase', bar.k.join());
      ok('it is the same size as the other bar buttons and has an icon', bar.dh < 0.6 && bar.dw < 0.6 && bar.svg, JSON.stringify(bar));
      ok('its tooltip is the wording', bar.tip === 'Erase marks (E)', bar.tip);
      ok('the preview\'s strip has no eraser and no separator for it, and the ring lives on the selector', !bar.strip && bar.ring === 'sysSel', JSON.stringify(bar));
      ok('the new tokens are as listed', await p.evaluate(() => { const c = getComputedStyle(document.documentElement), v = n => c.getPropertyValue(n).trim().replace(/\s+/g, ' '); return v('--erase') === '#0f93b0' && v('--erase-fade') === '380ms' && v('--erase-x') === '16px' && /46%/.test(v('--erase-live')) && /32%/.test(v('--erase-mark')) && /17%/.test(v('--erase-rest')) && /80%/.test(v('--erase-edge')) && /--glass-edge|rgba?\(255/.test(v('--erase-x-shadow')); }));
    }
    // turning it on: no zoom, no pan, no popup
    const z0 = await p.evaluate(() => [SZS.z, SZS.x, SZS.y, SZ.z]); const dlg0 = await p.evaluate(() => document.querySelectorAll('dialog[open], [role=dialog]:not([hidden])').length);
    await p.click('#szErase'); await p.waitForTimeout(250);
    ok(T + 'the eraser holds the shared pressed look while on', await p.evaluate(() => { const b = document.querySelector('#szErase'); return b.getAttribute('aria-pressed') === 'true' && getComputedStyle(b).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(b).backgroundColor === getComputedStyle(document.querySelector('#selZIn').parentElement.querySelector('button[aria-pressed]') || b).backgroundColor; }));
    ok(T + 'turning it on changes no zoom or pan and opens nothing', JSON.stringify(await p.evaluate(() => [SZS.z, SZS.x, SZS.y, SZ.z])) === JSON.stringify(z0) && await p.evaluate(() => document.querySelectorAll('dialog[open], [role=dialog]:not([hidden])').length) === dlg0);
    const A = await scr([M.x0, M.y0]), C = await scr([M.x1, M.y1]), h0 = await p.evaluate(() => S.history.length), bare = () => p.evaluate(() => JSON.stringify(SYS.byPage.get(0).systems.map(s => [s.top, s.bottom, s.left, s.right])));
    const boxes0 = await bare();
    // brush over the mark in rows: one stroke
    await p.mouse.move(A[0] - 8, A[1] - 2); await p.mouse.down(); let dir = 1;
    for (let y = A[1] - 2; y <= C[1] + 6; y += 6) { const xa = dir > 0 ? A[0] - 8 : C[0] + 8, xb = dir > 0 ? C[0] + 8 : A[0] - 8; await p.mouse.move(xa, y, { steps: 2 }); await p.mouse.move(xb, y, { steps: 10 }); dir = -dir; }
    const mid = await p.evaluate(() => ({ er: (SYS.byPage.get(0).systems[1].er || []).length, hist: S.history.length, held: previewR.lbT.size, fades: SYS_ERF.list.length, ring: (() => { const r = document.querySelector('#eraseRing'); return { hidden: r.hidden, w: r.getBoundingClientRect().width }; })() }));
    ok(T + 'nothing changes on the preview while drawing (no stroke saved, no sheet held, no fade)', mid.er === 0 && mid.hist === h0 && mid.held === 0 && mid.fades === 0, JSON.stringify(mid));
    ok(T + 'the sheet the preview and export compose is still untouched while drawing', (await stats(key1)).lo < 60);
    if (name === 'digital') {
      ok('the ring follows the pointer at --brush size while brushing', !mid.ring.hidden && Math.abs(mid.ring.w - 16) < 0.6, JSON.stringify(mid.ring));
      const px = ([fx, fy]) => p.evaluate(([fx, fy]) => { const cv = document.querySelector('#selCv'), g = SEL.geo, d = cv.getContext('2d').getImageData(Math.round(g.ox + fx * g.pa * g.u), Math.round(g.oy + fy * g.u), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
      const st = await p.evaluate(() => SEL.geo.pa), at = [M.x0 - 4 / 800 / st * 0 - 0.004, (M.y0 + M.y1) / 2];          // just left of the mark, on bare paper, inside the brush
      const live = await px(at); const tealish = c => c[0] < c[1] && c[1] <= c[2] + 40;
      await p.mouse.up(); await p.waitForTimeout(500);
      const setOn = await px(at); await p.evaluate(() => eraseSet(false)); await p.waitForTimeout(300); const rest = await px(at); await p.evaluate(() => eraseSet(true));
      ok('the highlight is --erase-live while drawing, --erase-mark once set, --erase-rest with the eraser off (one hue, three strengths)', live[0] < setOn[0] && setOn[0] < rest[0] && rest[0] < 250 && Math.abs(live[0] - 145) < 14 && Math.abs(setOn[0] - 178) < 14 && Math.abs(rest[0] - 214) < 14 && tealish(live), JSON.stringify([live, setOn, rest]));
    } else await p.mouse.up();
    await p.waitForTimeout(700);
    const after = await stats(key1);
    if (name === 'digital') ok(T + 'a clean page: every dot where the mark was is pure white', after.lo === 255 && after.hi === 255 && after.ring.every(v => v === 255), JSON.stringify(after));
    else if (name === 'cream') ok(T + 'a cream page: the erased place is the paper\'s own color', after.max <= 2 && after.hi - after.lo <= 3, JSON.stringify(after));
    else ok(T + 'a stained scan: the erased place matches the paper around it', after.max <= 16 && Math.max(...after.mean.map((v, j) => Math.abs(v - after.ring[j]))) <= 8, JSON.stringify(after));
    ok(T + 'the stroke was one History step and the systems never moved', await p.evaluate(() => S.history.length) === h0 + 1 && await bare() === boxes0);
    await shot(name + '-after.png');
    ok(T + 'the stroke belongs to system 1 only', await p.evaluate(() => { const l = SYS.byPage.get(0).systems; return !!(l[1].er && l[1].er.length === 1) && !(l[0].er || []).length && !(l[2].er || []).length; }));
    const other = await stats(sk(0, 2), 250); ok(T + 'the same spot on the next system\'s sheet is not erased there (its own mark shows)', other.lo < 60, JSON.stringify(other));
    if (name !== 'digital') { ok('no page errors', errs.length === 0, errs.join(' | ')); await p.close(); continue; }

    // ---- the rest is checked once, on the digital page
    { const lab = await p.evaluate(() => mainStepLabel(S.history[S.history.length - 1], snap())); ok('the History step is named Erase', lab === 'Erase', lab); }
    // the preview fades only that patch in on lift (and the stroke is not held on the preview before that)
    await p.click('#bUndo'); await p.waitForTimeout(900);
    const sample = (ms) => p.evaluate(async ({ ms, M, key }) => { const out = [], t0 = performance.now(); while (performance.now() - t0 < ms) { await new Promise(r => requestAnimationFrame(r)); const e = previewR.lbT.get(key); let lo = null; if (e) { const lay = previewR.lay, f = sysFit(key, lay.pw, lay.ph), bx = f.box, x0 = Math.round((lay.pw - f.dw) / 2), y0 = Math.round((lay.ph - f.dh) / 2), a = Math.round(x0 + (M.x0 - bx.left) / (bx.right - bx.left) * f.dw) + 1, c = Math.round(x0 + (M.x1 - bx.left) / (bx.right - bx.left) * f.dw) - 1, t = Math.round(y0 + (M.y0 - bx.top) / (bx.bottom - bx.top) * f.dh) + 1, d = Math.round(y0 + (M.y1 - bx.top) / (bx.bottom - bx.top) * f.dh) - 1, id = e.cv.getContext('2d').getImageData(a, t, c - a, d - t).data; lo = 255; for (let i = 0; i < id.length; i += 4) lo = Math.min(lo, (id[i] + id[i + 1] + id[i + 2]) / 3); } out.push([Math.round(performance.now() - t0), lo]); } return out; }, { ms, M, key: key1 });
    const redraw = async () => { await p.mouse.move(A[0] - 8, A[1] - 2); await p.mouse.down(); let d = 1; for (let y = A[1] - 2; y <= C[1] + 6; y += 6) { const xa = d > 0 ? A[0] - 8 : C[0] + 8, xb = d > 0 ? C[0] + 8 : A[0] - 8; await p.mouse.move(xa, y, { steps: 2 }); await p.mouse.move(xb, y, { steps: 6 }); d = -d; } };
    await redraw(); const rec = sample(900); await p.mouse.up(); const fin = await rec; const vals = fin.map(q => q[1]).filter(v => v != null);
    ok('on lift the new patch fades in on the preview over time, not at once', vals.some(v => v > 30 && v < 245) && vals.length > 3 && Math.max(...vals) >= 250, JSON.stringify(fin.filter((q, i) => i % 4 === 0)));
    await p.waitForTimeout(500); ok('and the held sheet is dropped for the sharp one afterwards', await p.evaluate(() => previewR.lbT.size === 0 && SYS_ERF.list.length === 0));
    // hover ×: only with the eraser on; at the stroke's middle; glass chip; click removes as one step
    const er1 = await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1], t = b.er[0], n = t.p.length >> 1; return { n, p: [t.p[2 * (n >> 1)], t.p[2 * (n >> 1) + 1]] }; });
    const hv = await scr(er1.p); await p.mouse.move(2, 2); await p.mouse.move(hv[0], hv[1], { steps: 4 }); await p.waitForTimeout(300);
    const chip = await p.evaluate(() => { const x = document.querySelector('#eraseX'), c = x.querySelector('.erase-x-chip'), r = x.getBoundingClientRect(), rc = c.getBoundingClientRect(), s = getComputedStyle(c); return { hidden: x.hidden, w: r.width, h: r.height, cw: rc.width, ch: rc.height, cx: rc.left + rc.width / 2, cy: rc.top + rc.height / 2, shadow: s.boxShadow, tip: x.title, aria: x.getAttribute('aria-label'), glass: s.backdropFilter || s.webkitBackdropFilter, ink: getComputedStyle(x).color, svgw: x.querySelector('svg').getBoundingClientRect().width }; });
    ok('hovering a settled stroke with the eraser on shows the × (24px hit area, 16px chip, 8px mark) with its tooltip and aria label', !chip.hidden && Math.abs(chip.w - 24) < 0.6 && Math.abs(chip.cw - 16) < 0.6 && Math.abs(chip.svgw - 8) < 0.6 && chip.tip === 'Remove this erasure' && chip.aria === 'Remove erasure', JSON.stringify(chip));
    ok('the × is in the middle of its stroke, inside the system', Math.hypot(chip.cx - hv[0], chip.cy - hv[1]) < 14);
    ok('the chip is glass (blur, the glass edge in light), and the stroke brightens to --erase-edge', /blur/.test(chip.glass) && /inset/.test(chip.shadow) && await p.evaluate(() => ERASE.hot && ERASE.hot.stroke === SYS.byPage.get(0).systems[1].er[0]));
    await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(150); const dk = await p.evaluate(() => { const c = document.querySelector('#eraseX .erase-x-chip'), s = getComputedStyle(c); return { shadow: s.boxShadow, chip: getComputedStyle(document.documentElement).getPropertyValue('--chip-shadow').trim() }; });
    ok('in dark the chip has no glass edge ring (the chip shadow alone)', !/inset/.test(dk.shadow) && /rgba?\(0, 0, 0, 0?\.28\)/.test(dk.shadow), dk.shadow);
    if (SH) { await p.waitForTimeout(150); await p.screenshot({ path: SH + '/digital-dark-x.png', clip: { x: 0, y: 0, width: 660, height: 900 } }); }
    await p.emulateMedia({ colorScheme: null }); await p.waitForTimeout(150);
    const h1 = await p.evaluate(() => S.history.length);
    await p.mouse.move(chip.cx, chip.cy); await p.waitForTimeout(150); ok('over the × the mark turns --danger', await p.evaluate(() => { const probe = document.createElement('i'); probe.style.color = 'var(--danger)'; document.body.append(probe); const d = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(document.querySelector('#eraseX .erase-x-chip')).color === d; }));
    const rem = sample(900); await p.mouse.click(chip.cx, chip.cy); const remv = (await rem).map(q => q[1]).filter(v => v != null);
    ok('clicking the × removes that stroke as one History step named Remove erasure', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 0 && S.history.length) === h1 + 1 && await p.evaluate(() => mainStepLabel(S.history[S.history.length - 1], snap())) === 'Remove erasure');
    ok('the removed patch fades out on the preview (the mark comes back over time)', remv.some(v => v > 30 && v < 245) || (remv.length > 2 && remv[0] >= 250), JSON.stringify(remv.filter((q, i) => i % 4 === 0)));
    await p.waitForTimeout(500); const st = await stats(key1); ok('and the sheet has its mark back', st.lo < 60, JSON.stringify(st));
    const undo = sample(900); await p.click('#bUndo'); const uv = (await undo).map(q => q[1]).filter(v => v != null); await p.waitForTimeout(500);
    ok('Undo brings the stroke back, fading in', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 1) && (uv.some(v => v > 30 && v < 245) || uv.length > 2), JSON.stringify(uv.filter((q, i) => i % 4 === 0)));
    await p.click('#bRedo'); await p.waitForTimeout(900); ok('Redo removes it again', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 0)); await p.click('#bUndo'); await p.waitForTimeout(900);
    // with the eraser off the × is absent, and a hover grabs an edge
    await p.evaluate(() => eraseSet(false)); await p.mouse.move(2, 2); await p.mouse.move(hv[0], hv[1], { steps: 4 }); await p.waitForTimeout(300);
    ok('with the eraser off there is no ×', await p.evaluate(() => document.querySelector('#eraseX').hidden));
    await p.evaluate(() => eraseSet(true));
    // reduced motion: instant
    await p.emulateMedia({ reducedMotion: 'reduce' }); await redo_stroke(); async function redo_stroke() { await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1]; sysErase(0, b, { r: 0.01, p: [0.3, 0.52, 0.31, 0.52] }); }); }
    ok('under reduced motion a new stroke does not fade', await p.evaluate(() => SYS_ERF.list.length === 0 && previewR.lbT.size === 0)); await p.emulateMedia({ reducedMotion: null }); await p.click('#bUndo'); await p.waitForTimeout(600);
    // the start rules: a gap or off the page makes no stroke; the ring is muted there
    await p.evaluate(async () => { await sysCommit(0, [{ top: 0.1, bottom: 0.25, left: 0.1, right: 0.9 }, { top: 0.4, bottom: 0.55, left: 0.1, right: 0.9 }, { top: 0.7, bottom: 0.85, left: 0.1, right: 0.9 }]); }); await p.waitForTimeout(900);
    await p.evaluate(() => { selJump(sysKey(0, 1)); }); await p.waitForTimeout(900);
    const gap = await scr([0.5, 0.32]), off = await scr([-0.03, 0.47]), ins = await scr([0.5, 0.47]), hg = await p.evaluate(() => S.history.length);
    await p.mouse.move(gap[0], gap[1]); await p.waitForTimeout(80); const ringGap = await p.evaluate(() => document.querySelector('#eraseRing').classList.contains('no'));
    await p.mouse.down(); await p.mouse.move(gap[0] + 20, gap[1] + 4, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
    ok('a drag that starts in a gap makes no stroke and no History step, and the ring is muted there', ringGap && await p.evaluate(() => S.history.length) === hg && await p.evaluate(() => SYS.byPage.get(0).systems.every(s => !(s.er || []).length)));
    await p.mouse.move(off[0], off[1]); await p.waitForTimeout(80); const ringOff = await p.evaluate(() => document.querySelector('#eraseRing').classList.contains('no'));
    await p.mouse.down(); await p.mouse.move(off[0] + 30, off[1], { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(200);
    ok('and one that starts off the page makes none either', ringOff && await p.evaluate(() => S.history.length) === hg && await p.evaluate(() => SYS.byPage.get(0).systems.every(s => !(s.er || []).length)));
    await p.mouse.move(ins[0], ins[1]); await p.waitForTimeout(80); ok('inside a system the ring is the normal one, 16px', await p.evaluate(() => { const r = document.querySelector('#eraseRing'); return !r.classList.contains('no') && !r.hidden && Math.abs(r.getBoundingClientRect().width - 16) < 0.6; }));
    // the cut: leave the system and come back; only points inside are kept, one stroke, one step
    const top1 = await scr([0.5, 0.4]), out = await scr([0.5, 0.31]);
    await p.mouse.move(ins[0], ins[1]); await p.mouse.down(); await p.mouse.move(ins[0] + 40, ins[1], { steps: 5 }); await p.mouse.move(ins[0] + 40, out[1], { steps: 8 }); await p.mouse.move(ins[0] + 80, out[1], { steps: 5 }); await p.mouse.move(ins[0] + 80, ins[1] + 6, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(300);
    const cut = await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1], er = b.er || [], t = er[0], ok = !!t && t.p.every((v, i) => i % 2 ? v >= b.top - 1e-6 && v <= b.bottom + 1e-6 : v >= b.left - 1e-6 && v <= b.right + 1e-6); let xs = t ? t.p.filter((v, i) => i % 2 === 0) : []; return { n: er.length, ok, minx: Math.min(...xs), maxx: Math.max(...xs), hist: S.history.length }; });
    ok('a stroke that leaves its system and returns is one stroke, kept only inside the cut, and reaches both sides of the excursion', cut.n === 1 && cut.ok && cut.maxx - cut.minx > 0.05 && cut.hist === hg + 1, JSON.stringify(cut));
    // legacy stroke with points outside the cut: it loads, and the highlight is drawn only inside the cut
    await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1]; b.er = [{ r: 0.012, p: [0.5, 0.3, 0.5, 0.47, 0.5, 0.6] }]; SYS.rev++; selPaint(); });
    { const o = await p.evaluate(() => { const g = SEL.geo, cv = document.querySelector('#selCv'), c = cv.getContext('2d'), at = y => { const d = c.getImageData(Math.round(g.ox + 0.5 * g.pa * g.u), Math.round(g.oy + y * g.u), 1, 1).data; return [d[0], d[1], d[2]]; }; return { inside: at(0.47), above: at(0.33), below: at(0.58) }; });
      ok('the highlight is drawn only inside the owning cut (a stroke saved in the older shape still opens)', o.inside[0] < 240 && o.above.every(v => v === 255) && o.below.every(v => v === 255), JSON.stringify(o)); }
    await p.evaluate(() => { SYS.byPage.get(0).systems[1].er = [{ r: 0.012, p: [0.2, 0.42, 0.3, 0.42, 0.4, 0.5, 0.6, 0.5, 0.8, 0.5] }]; SYS.rev++; });
    // shrinking the system drops the points outside the new cut, in one step; Undo brings them back; extending shows nothing
    const sh0 = await p.evaluate(() => S.history.length);
    await p.evaluate(() => { const r = SYS.byPage.get(0), b = r.systems[1]; sysEdgeSet(0, b, 0.45, b.right); }); await p.waitForTimeout(200);
    const shr = await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1], t = (b.er || [])[0]; return { n: t ? t.p.length : 0, minx: t ? Math.min(...t.p.filter((v, i) => i % 2 === 0)) : 1, hist: S.history.length }; });
    ok('shrinking a system drops the stroke points outside its new cut for good, as one History step', shr.n === 4 && shr.minx >= 0.45 - 1e-6 && shr.hist === sh0 + 1, JSON.stringify(shr));
    await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1]; sysEdgeSet(0, b, 0.1, b.right); }); ok('extending it again reveals nothing', await p.evaluate(() => SYS.byPage.get(0).systems[1].er[0].p.length) === 4);
    await p.click('#bUndo'); await p.click('#bUndo'); await p.waitForTimeout(400); ok('Undo brings the dropped points back', await p.evaluate(() => SYS.byPage.get(0).systems[1].er[0].p.length) === 10);
    // moving still carries the strokes; deleting the system clears them
    await p.evaluate(async () => { const r = SYS.byPage.get(0), pp = sysPush(r.systems.slice(), 'move', 1, 0.004); await sysPlace(0, pp.boxes, pp.out); });
    ok('moving the Selection keeps its erasure', await p.evaluate(() => (SYS.byPage.get(0).systems[1].er || []).length === 1));
    // the Selections are frozen while erasing: an edge drag, the Delete key, and a double-click change no system
    const bx = await bare(), ed = await scr([0.5, 0.4]), hz = await p.evaluate(() => S.history.length);
    await p.mouse.move(ed[0], ed[1]); await p.mouse.down(); await p.mouse.move(ed[0], ed[1] - 25, { steps: 5 }); await p.mouse.up(); await p.keyboard.press('Delete'); await p.mouse.dblclick(ed[0] + 10, ed[1] + 10); await p.waitForTimeout(300);
    ok('while the eraser is on a drag never moves, resizes, or deletes a system, and the Delete key and a double-click do nothing to one', await bare() === bx && await p.evaluate(() => SYS.byPage.get(0).systems.length) === 3);
    await p.evaluate(() => { SYS.byPage.get(0).systems[1].er = []; });
    // Esc, E, and a second click
    await p.keyboard.press('Escape'); await p.waitForTimeout(150); ok('Esc turns the eraser off', await p.evaluate(() => !ERASE.on && document.querySelector('#szErase').getAttribute('aria-pressed') === 'false'));
    await p.mouse.move(600, 300); await p.keyboard.press('e'); await p.waitForTimeout(150); ok('E turns it on', await p.evaluate(() => ERASE.on));
    await p.click('#szErase'); await p.waitForTimeout(150); ok('a second click turns it off', await p.evaluate(() => !ERASE.on));
    ok('with it off the Selections are normal again: a drag on an edge resizes one', await (async () => { const e = await scr([0.5, 0.4]), n0 = await bare(); await p.mouse.move(e[0], e[1]); await p.mouse.down(); await p.mouse.move(e[0], e[1] - 12, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(700); return (await bare()) !== n0; })());
    await p.click('#bUndo'); await p.waitForTimeout(500);
    // ring size at zoom, Space-drag pan while erasing, no auto zoom
    await p.evaluate(() => { SYS.byPage.get(0).systems[1].er = []; eraseSet(true); });
    { const c = await scr([0.5, 0.47]); await p.evaluate(([x, y]) => szAt(3, x, y, false, SZS), c); await p.waitForTimeout(400); const c2 = await scr([0.5, 0.47]); await p.mouse.move(c2[0], c2[1]); await p.waitForTimeout(100);
      ok('the ring is the same size when the selector is zoomed', await p.evaluate(() => Math.abs(document.querySelector('#eraseRing').getBoundingClientRect().width - 16) < 0.6));
      const hh = await p.evaluate(() => S.history.length), zz = await p.evaluate(() => [SZS.x, SZS.y]); await p.keyboard.down('Space'); await p.mouse.move(c2[0], c2[1]); await p.mouse.down(); await p.mouse.move(c2[0] + 30, c2[1] + 10, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Space'); await p.waitForTimeout(200);
      const z1 = await p.evaluate(() => [SZS.x, SZS.y]); ok('Space-drag pans the zoomed selector and erases nothing', (Math.abs(z1[0] - zz[0]) > 10 || Math.abs(z1[1] - zz[1]) > 5) && await p.evaluate(() => S.history.length) === hh, JSON.stringify([zz, z1]));
      const rz = await p.evaluate(() => SZS.z); await p.evaluate(() => { szReset(false, SZS); }); }
    // touch: a drag brushes; a tap on a settled stroke shows its ×
    { const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      const ty = await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1]; return (b.top + b.bottom) / 2; }), q0 = await scr([0.3, ty]), q1 = await scr([0.4, ty]), t = async (type, xy) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: xy ? [{ x: xy[0], y: xy[1], id: 1 }] : [] }), t1 = await p.evaluate(() => S.history.length);
      await t('touchStart', q0); for (let i = 1; i <= 5; i++) await t('touchMove', [q0[0] + (q1[0] - q0[0]) * i / 5, q0[1] + (q1[1] - q0[1]) * i / 5]); await t('touchEnd'); await p.waitForTimeout(500);
      { const d = await p.evaluate(() => ({ h: S.history.length, er: SYS.byPage.get(0).systems.map(b => [b.top, b.bottom, (b.er || []).length]), lab: mainStepLabel(S.history[S.history.length - 1], snap()), sel: SEL.geo.idx, on: ERASE.on })); ok('touch brushes with the same brush', d.h === t1 + 1 && d.lab === 'Erase' && d.er.some(x => x[2] === 1), JSON.stringify([d, t1, ty, q0, q1])); }
      const tm = await scr([0.35, ty]); await t('touchStart', tm); await t('touchEnd'); await p.waitForTimeout(300);
      { const tp = await p.evaluate(() => ({ shown: !document.querySelector('#eraseX').hidden, hist: S.history.length, hot: !!ERASE.hot, on: ERASE.on, er: SYS.byPage.get(0).systems.map(b => (b.er || []).length) })); ok('a tap on a settled stroke shows its × and makes no new stroke', tp.shown && tp.hist === t1 + 1, JSON.stringify([tp, t1])); }
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); }
    await p.evaluate(() => eraseSet(false));
    // the preview has no eraser code path: no ring there, a drag pans it, and nothing is erased from it
    await p.evaluate(() => eraseSet(true)); { const cr = await p.evaluate(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await p.evaluate(([x, y]) => szAt(2.5, x, y, false), cr); await p.waitForTimeout(400);
      const hp = await p.evaluate(() => S.history.length), s0 = await p.evaluate(() => [SZ.x, SZ.y]); await p.mouse.move(cr[0], cr[1]); await p.waitForTimeout(80);
      const noRing = await p.evaluate(() => document.querySelector('#stageWrap > .erase-ring') === null && document.querySelector('#eraseRing').hidden !== false || document.querySelector('#eraseRing').hidden);
      await p.mouse.down(); await p.mouse.move(cr[0] + 40, cr[1] + 20, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(200); const s1 = await p.evaluate(() => [SZ.x, SZ.y]);
      ok('on the preview there is no ring or brush, and a drag pans it even with the eraser on', noRing && (Math.abs(s1[0] - s0[0]) > 10 || Math.abs(s1[1] - s0[1]) > 5) && await p.evaluate(() => S.history.length) === hp, JSON.stringify([s0, s1]));
      await p.evaluate(() => szReset(false)); }
    await p.evaluate(() => eraseSet(false));
    // Detect again clears them (and Undo brings them back); the strokes survive a save and reload; the older shape loads
    await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1]; b.er = [{ r: 0.012, p: [0.3, 0.45, 0.4, 0.45] }]; });
    const list = await p.evaluate(() => sysToList()), clean = await p.evaluate(l => sysListClean(l, 1), list);
    ok('strokes are saved with the page and read back', clean && clean[0].s[1].er && clean[0].s[1].er.length === 1 && clean[0].s[1].er[0].r > 0, JSON.stringify(list[0].s[1]).slice(0, 120));
    ok('a project saved with strokes in the older shape (points past the cut) opens', await p.evaluate(() => { const l = sysToList(); l[0].s[1][5] = [[0.012, 0.5, 0.2, 0.5, 0.9]]; const c = sysListClean(l, 1); return !!c && c[0].s[1].er.length === 1 && c[0].s[1].er[0].p.length === 4; }));
    await p.evaluate(() => { splitSet(0.5); }); await p.waitForTimeout(400); await p.click('#spAgain'); await p.waitForTimeout(2500);
    ok('Detect again clears them', await p.evaluate(() => SYS.byPage.get(0).systems.every(s => !(s.er || []).length)));
    // deleting a system takes its strokes; the export composes the erasure
    await p.evaluate(() => { const b = SYS.byPage.get(0).systems[1]; b.er = [{ r: 0.012, p: [0.3, 0.45, 0.4, 0.45] }]; });
    ok('deleting the Selection takes its erasures with it', await p.evaluate(() => { const r = SYS.byPage.get(0), b = r.systems[1]; sysRemove(0, b); return !SYS.byPage.get(0).systems.includes(b) && SYS.byPage.get(0).systems.every(s => !(s.er || []).length); }));
    await p.click('#bUndo'); await p.waitForTimeout(500);
    // greyed with its reason on a Full page; a page with no systems
    await p.evaluate(() => sysSetFull(0, true)); await p.waitForTimeout(800);
    ok('on a Full page the eraser is greyed with its reason as the tooltip', await p.evaluate(() => { const b = document.querySelector('#szErase'); return b.disabled && b.title === 'Choose a system to erase on.'; }));
    await p.evaluate(() => sysSetFull(0, false)); await p.waitForTimeout(600);
    // the narrow, stacked layout and the guard
    await p.setViewportSize({ width: 520, height: 900 }); await p.waitForTimeout(900);
    ok('narrow: the eraser fits in the selector\'s bar', await p.evaluate(() => { const b = document.querySelector('#szErase').getBoundingClientRect(), s = document.querySelector('.sys-nav').getBoundingClientRect(); return b.width > 0 && b.left >= s.left - 0.5 && b.right <= s.right + 0.5; }));
    ok('the dev guard reports nothing about the bar or its eraser button', await p.evaluate(() => typeof uiGuard === 'undefined' ? true : !uiGuard.scan().some(x => /szErase|spAgain|sys-nav|eraseX/.test(x.join(' ')))));
    ok('no page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  }
  await b.close();
})();
