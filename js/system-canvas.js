'use strict';
/* ====================================================================
   System canvas: the stage splits into selector | preview. The selector shows the page of the current system
   with the video frame drawn on it; the playhead and the selector follow each other.
   ==================================================================== */
const DIV_W = 7;                                       // the divider's width
const SPLIT_PRESETS = { spSel: 0.7, spEq: 0.5, spPrev: 0.3, spOnly: 0 };          // the selector's share of the stage: wide, equal, narrow, hidden
const SPLIT = { f: 0.5, shown: false, stack: false, glide: 0, raf: 0 };          // view only: never saved, never a History step
const splitOn = () => sysOn() && !!S.pdf && !$('.app').classList.contains('fs');

/* Lays out the selector, the divider, and the presets for the stage's size; the preview fits in what is left (pl: room on the left, pt: room above).
   Narrow stages stack the halves, selector above. */
function splitSync() {
  const wrap = $('#stageWrap'), on = splitOn(), cw = wrap.clientWidth, chh = wrap.clientHeight;
  const stack = cw < 600, show = on && SPLIT.f > 0.001, sel = show ? Math.round(clamp(SPLIT.f, 0.1, 0.9) * (stack ? chh : cw)) : 0;
  const was = SPLIT.shown; SPLIT.shown = show; SPLIT.stack = stack;
  const pane = $('#sysSel'), div = $('#sysDiv'), cv = $('#selCv');
  pane.hidden = div.hidden = !show; $('#sysPresets').hidden = !on;
  wrap.classList.toggle('sys-split', on); wrap.classList.toggle('sys-stack', on && stack);
  div.setAttribute('aria-orientation', stack ? 'horizontal' : 'vertical');
  const pl = show && !stack ? sel + DIV_W : 0, pt = show && stack ? sel + DIV_W : 0;
  wrap.style.paddingLeft = pl ? pl + 'px' : ''; wrap.style.paddingTop = pt ? pt + 'px' : '';
  if (show) {
    const pw = stack ? cw : sel, ph = stack ? sel : chh;
    Object.assign(pane.style, { left: '0', top: '0', width: pw + 'px', height: ph + 'px' });
    Object.assign(div.style, stack ? { left: '0', right: '0', top: sel + 'px', bottom: '', width: '', height: DIV_W + 'px' } : { left: sel + 'px', right: '', top: '0', bottom: '0', width: DIV_W + 'px', height: '' });
    cv.style.width = pw + 'px'; cv.style.height = ph + 'px';
  } else if (was) { szReset(false, SZS); }
  Object.keys(SPLIT_PRESETS).forEach(id => $('#' + id).setAttribute('aria-pressed', on && Math.abs(SPLIT_PRESETS[id] - (show ? SPLIT.f : 0)) < 0.02 ? 'true' : 'false'));
  szButtons();
  return { show, stack, pl, pt };
}
function splitSet(f) { SPLIT.f = f; layoutStage(); }
/* the divider glides to a share the way a slider glides to its default: the same ease, and a longer way takes longer */
function splitGlide(to) {
  cancelAnimationFrame(SPLIT.raf); const from = SPLIT.f;
  if (reducedMotion() || from === to) { splitSet(to); return; }
  const t0 = performance.now(), dur = 240 + 260 * Math.min(1, Math.abs(to - from) / 0.7), g = SPLIT.glide = {};
  const step = now => { if (SPLIT.glide !== g) return; const k = clamp((now - t0) / dur, 0, 1); splitSet(k < 1 ? from + (to - from) * AE_EASE(k) : to); if (k < 1) SPLIT.raf = requestAnimationFrame(step); };
  SPLIT.raf = requestAnimationFrame(step);
}
function splitStop() { cancelAnimationFrame(SPLIT.raf); SPLIT.glide = 0; }
/* the System group's status line: the run with its bar and Stop, then the reason lines for tilted pages and two-page scans */
function sysStatusUI() {
  const note = $('#sysNote'); if (!note) return;
  const on = sysOn() && !!S.pdf, p = on ? SYS.prog : null, w = on && !p ? SYS.warn : null, tilt = w ? w.tilt.length : 0, wide = w ? w.wide : 0;
  $('#sysRun').hidden = !p; $('#sysTilt').hidden = !tilt; $('#sysWide').hidden = !wide; note.hidden = !(p || tilt || wide);
  if (p) { $('#sysRunT').textContent = tx('sys.finding', { done: p.done, total: p.total }); $('#sysBarFill').style.width = (p.total ? Math.round(p.done / p.total * 100) : 0) + '%'; }
  if (tilt) { $('#sysTiltT').textContent = tx(tilt === 1 ? 'sys.tilt.one' : 'sys.tilt.many', { n: tilt }); $('#sysLevel').disabled = SYS.leveling; }
  if (wide) $('#sysWide').innerHTML = tx('sys.wide');
}
function splitBind() {
  $('#sysStop').addEventListener('click', sysStopRun); $('#sysLevel').addEventListener('click', sysLevelPages);
  const div = $('#sysDiv'), wrap = $('#stageWrap'); let live = false, queued = 0;
  const at = e => { const r = wrap.getBoundingClientRect(), inset = 1; return SPLIT.stack ? (e.clientY - r.top - inset) / wrap.clientHeight : (e.clientX - r.left - inset) / wrap.clientWidth; };
  div.addEventListener('pointerdown', e => { if (e.button) return; splitStop(); live = true; div.setPointerCapture(e.pointerId); div.classList.add('drag'); e.preventDefault(); });
  div.addEventListener('pointermove', e => { if (!live) return; const f = clamp(at(e), 0.15, 0.85); cancelAnimationFrame(queued); queued = requestAnimationFrame(() => splitSet(f)); });
  const end = () => { live = false; div.classList.remove('drag'); };
  div.addEventListener('pointerup', end); div.addEventListener('pointercancel', end);
  div.addEventListener('dblclick', () => splitGlide(0.5));
  div.addEventListener('keydown', e => {
    const k = e.key, back = SPLIT.stack ? 'ArrowUp' : 'ArrowLeft', fwd = SPLIT.stack ? 'ArrowDown' : 'ArrowRight';
    if (k === back || k === fwd) { e.preventDefault(); splitStop(); splitSet(clamp(SPLIT.f + (k === fwd ? 0.05 : -0.05), 0.15, 0.85)); }
    else if (k === 'Enter') { e.preventDefault(); splitGlide(0.5); }
  });
  Object.keys(SPLIT_PRESETS).forEach(id => $('#' + id).addEventListener('click', () => splitGlide(SPLIT_PRESETS[id])));
}

/* ---------- the selector ---------- */
const SEL = { mark: { on: false, y0: null, pg: -1, hover: null, draft: null }, key: null, sig: '', bmp: null, bmpIdx: -1, bmpH: 0, bmpGen: -1, want: '', paper: null, paperKey: '', geo: null };
/* the system the playhead is on: a credits card shows the nearest system instead */
function selCurrent() {
  const n = S.spreads.length; if (!n) return null;
  const i = frameState(S.time).spread, at = j => { const sp = S.spreads[j]; return sp && sp[1] >= 0 ? sp[1] : null; };
  for (let d = 0; d < n; d++) { const k = at(i + d); if (k != null) return k; }
  for (let d = 1; d < n; d++) { const k = at(i - d); if (k != null) return k; }
  return null;
}
/* the pages in reading order, each with the first system on it */
function selPages() {
  const out = [], seen = new Set();
  S.spreads.forEach(sp => { if (sp[1] >= 0) { const p = sysPage(sp[1]); if (!seen.has(p)) { seen.add(p); out.push({ page: p, key: sp[1] }); } } });
  return out;
}
/* the time a system is in full view (a turn has finished): the start for the first, else just after the turn into it */
function selTimeOf(key) {
  const i = S.spreads.findIndex(sp => sp[1] === key); if (i < 0) return null;
  return i === 0 ? S.vStart : Math.min(vEnd(), S.turns[i - 1] - refOffset() + flipDur() + 0.001);
}
function selJump(key) { const t = selTimeOf(key); if (t != null) Transport.seek(t); }

function selSync(force) {
  if (!SPLIT.shown || !S.pdf) return;
  const key = selCurrent(), cv = $('#selCv'); if (key == null) return;
  const sig = [key, cv.clientWidth, cv.clientHeight, S.set.margin, S.set.tbMargin, S.set.aspect, S.set.res, SYS.byPage.size, SYS.gen, SYS.rev, S.pdf.gen || 0].join();
  if (!force && sig === SEL.sig) return;
  if (sysPage(key) !== sysPage(SEL.key == null ? -1 : SEL.key) && SZS.z !== 1) szReset(false, SZS);          // a new page starts at Fit
  SEL.sig = sig; SEL.key = key; if (SEL.mark.y0 != null && SEL.mark.pg !== sysPage(key)) SEL.mark.y0 = SEL.mark.hover = SEL.mark.draft = null;
  const pages = selPages(), i = pages.findIndex(q => q.page === sysPage(key));
  $('#selPg').textContent = 'Page ' + pageNo(key); $('#selPrev').disabled = i <= 0; $('#selNext').disabled = i < 0 || i >= pages.length - 1;
  selPaint();
}
/* the whole page, drawn once at the size it needs and kept while the same page is shown */
function selNeed(idx, hpx) {
  const gen = S.pdf.gen || 0, want = gen + ':' + idx + '@' + hpx;
  if (SEL.bmpIdx === idx && SEL.bmpGen === gen && SEL.bmpH >= hpx) return;
  if (SEL.want === want) return; SEL.want = want;
  (async () => {
    const sl = S.pdf.slots[idx], page = await S.pdf.doc.getPage(sl.src + 1), rot = page.rotate || 0, v1 = page.getViewport({ scale: 1, rotation: rot });
    const vp = page.getViewport({ scale: S.pdf.aspect * hpx / v1.width, rotation: rot }), c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(vp.width)); c.height = Math.max(2, Math.round(vp.height));
    const x = c.getContext('2d', { alpha: false }); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, viewport: vp, background: '#ffffff' }).promise; try { page.cleanup(); } catch (e) {}
    if (SEL.want !== want) return;
    SEL.bmp = c; SEL.bmpIdx = idx; SEL.bmpH = hpx; SEL.bmpGen = gen; SEL.paper = null; SEL.want = ''; selPaint();
  })().catch(() => { if (SEL.want === want) SEL.want = ''; });
}
/* the paper of the selected system, as the sheet takes it from the same stretch of page */
function selPaper(box) {
  const b = SEL.bmp, k = [SEL.bmpIdx, SEL.bmpH, box.top, box.bottom, box.left, box.right].join();
  if (SEL.paper && SEL.paperKey === k) return SEL.paper;
  const sx = box.left * b.width, sy = box.top * b.height, sw = Math.max(2, (box.right - box.left) * b.width), sh = Math.max(2, (box.bottom - box.top) * b.height), q = Math.min(1, 300 / sw);
  const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(sw * q)); c.height = Math.max(2, Math.round(sh * q));
  c.getContext('2d').drawImage(b, sx, sy, sw, sh, 0, 0, c.width, c.height);
  SEL.paper = sysPaper(c); SEL.paperKey = k; return SEL.paper;
}
/* The page with the video drawn on it: inside the frame is exactly what the sheet shows (the selected system, paper everywhere else, including past the
   page's edge); outside it the page is dimmed, so the padding is visible. The world is the page and the frame together, fitted to the pane. */
function selPaint() {
  const cv = $('#selCv'), key = SEL.key; if (key == null || !S.pdf) return;
  const k = Math.min(3, 2 * Math.max(1, window.devicePixelRatio || 1)), w = Math.max(2, Math.round(cv.clientWidth * k)), h = Math.max(2, Math.round(cv.clientHeight * k));
  if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
  const g = cv.getContext('2d'), idx = sysPage(key), pa = S.pdf.aspect, { W, H } = outputSize(), f = sysFit(key, W, H), box = f.box;
  const fw = W / f.s, fh = H / f.s, fx = (box.left + box.right) / 2 * pa + f.ox - fw / 2, fy = (box.top + box.bottom) / 2 + f.oy - fh / 2;          // the frame, in page heights
  const x0 = Math.min(0, fx), x1 = Math.max(pa, fx + fw), y0 = Math.min(0, fy), y1 = Math.max(1, fy + fh), m = 14 * k;
  const u = Math.max(1, Math.min((w - 2 * m) / (x1 - x0), (h - 2 * m) / (y1 - y0))), ox = (w - u * (x1 - x0)) / 2 - u * x0, oy = (h - u * (y1 - y0)) / 2 - u * y0;
  const X = x => ox + x * u, Y = y => oy + y * u;
  SEL.geo = { u, ox, oy, idx, pa, w, h, fx, fy, fw, fh, box, W, H, k };
  selNeed(idx, Math.ceil(u / 200) * 200);
  g.clearRect(0, 0, w, h);
  const ready = SEL.bmp && SEL.bmpIdx === idx && SEL.bmpGen === (S.pdf.gen || 0);
  g.fillStyle = '#fff'; g.fillRect(X(0), Y(0), pa * u, u);
  if (ready) g.drawImage(SEL.bmp, X(0), Y(0), pa * u, u);
  g.fillStyle = 'rgba(8,10,16,.5)'; g.fillRect(X(0), Y(0), pa * u, u);
  const paper = ready ? selPaper(box) : [255, 255, 255];
  g.fillStyle = 'rgb(' + paper.join(',') + ')'; g.fillRect(X(fx), Y(fy), fw * u, fh * u);
  const bx = X(box.left * pa), by = Y(box.top), bw = (box.right - box.left) * pa * u, bh = (box.bottom - box.top) * u;
  if (ready) g.drawImage(SEL.bmp, box.left * SEL.bmp.width, box.top * SEL.bmp.height, (box.right - box.left) * SEL.bmp.width, (box.bottom - box.top) * SEL.bmp.height, bx, by, bw, bh);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b5bdb', r = SYS.byPage.get(idx), list = r ? r.systems : [];
  g.save(); g.beginPath(); g.rect(0, 0, w, h); g.rect(X(fx), Y(fy), fw * u, fh * u); g.clip('evenodd');          // the other systems are outlined outside the frame only: inside it they are masked, as in the video
  g.lineWidth = Math.max(1, k * 0.75); g.strokeStyle = accent; g.globalAlpha = 0.55;
  list.forEach(s => { if (s !== box) g.strokeRect(X(s.left * pa) + 0.5, Y(s.top) + 0.5, (s.right - s.left) * pa * u, (s.bottom - s.top) * u); });
  g.restore(); g.strokeStyle = accent; g.lineWidth = Math.max(1.5, k * 1.25); g.strokeRect(X(fx), Y(fy), fw * u, fh * u);
  if (SEL.mark.on) selMarkPaint(g, list, box, X, Y, accent);
}
/* Marking: every system's top and bottom are handles (the left and right edges never are), the selected one has an × on its corner, and the pending or dragged mark is dashed */
function selMarkPaint(g, list, box, X, Y, accent) {
  const { u, pa, k } = SEL.geo, M = SEL.mark, lw = Math.max(1, k * 0.75);
  g.save(); g.strokeStyle = accent; g.lineWidth = lw;
  list.forEach(s => { g.globalAlpha = s === box ? 0.95 : 0.4; g.strokeRect(X(s.left * pa) + 0.5, Y(s.top) + 0.5, (s.right - s.left) * pa * u, (s.bottom - s.top) * u); });
  g.globalAlpha = 1; g.setLineDash([6 * k, 4 * k]); g.lineWidth = lw * 1.6;
  const d = M.draft || (M.y0 != null && M.hover != null ? [M.y0, M.hover] : null);
  if (d) { const t = Math.min(d[0], d[1]), b = Math.max(d[0], d[1]); g.fillStyle = accent; g.globalAlpha = 0.14; g.fillRect(X(0), Y(t), pa * u, (b - t) * u); g.globalAlpha = 1; g.strokeRect(X(0) + 0.5, Y(t) + 0.5, pa * u, (b - t) * u); }
  else if (M.y0 != null) { g.beginPath(); g.moveTo(X(0), Y(M.y0)); g.lineTo(X(pa), Y(M.y0)); g.stroke(); }
  g.restore();
  if (list.includes(box) && !SEL.mark.draft) { const c = selXPos(); g.save(); g.fillStyle = accent; g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, k * 1.25); g.lineCap = 'round'; const q = c[2] * 0.4; g.beginPath(); g.moveTo(c[0] - q, c[1] - q); g.lineTo(c[0] + q, c[1] + q); g.moveTo(c[0] + q, c[1] - q); g.lineTo(c[0] - q, c[1] + q); g.stroke(); g.restore(); }
}
/* where the × sits (canvas dots: x, y, radius): on the selected system's top right corner, kept inside the pane */
function selXPos() {
  const { u, ox, oy, pa, box, k, w } = SEL.geo, r = 8 * k;
  return [Math.min(w - r - 2, ox + box.right * pa * u), Math.max(r + 2, oy + box.top * u), r];
}
/* a click on a system (not the end of a pan) moves the playhead to it */
function selClick(e) {
  const cv = $('#selCv'), geo = SEL.geo, idx = geo && geo.idx; if (!geo || SEL.key == null) return;
  const b = cv.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width * cv.width - geo.ox) / geo.u, y = ((e.clientY - b.top) / b.height * cv.height - geo.oy) / geo.u;
  const r = SYS.byPage.get(idx), list = r ? r.systems : []; if (x < 0 || x > geo.pa) return;
  let best = -1, bd = 0.015;
  list.forEach((s, n) => { const d = y < s.top ? s.top - y : y > s.bottom ? y - s.bottom : 0; if (d < bd || (d === 0 && best < 0)) { bd = d; best = n; } });
  if (best >= 0 && sysKey(idx, best) !== SEL.key) selJump(sysKey(idx, best));
}
function selBind() {
  const wrap = $('#stageWrap'); let down = null;
  wrap.addEventListener('pointerdown', e => { down = e.button === 0 && e.target.closest('#sysSel') && !e.target.closest('.sys-nav') ? [e.clientX, e.clientY] : null; });
  wrap.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) selClick(e); down = null; });          // a pan that captured the pointer still ends here
  wrap.addEventListener('pointercancel', () => { down = null; });
  const step = d => { const pages = selPages(), i = pages.findIndex(q => q.page === sysPage(SEL.key)), to = pages[i + d]; if (to) selJump(to.key); };
  $('#selPrev').addEventListener('click', () => step(-1)); $('#selNext').addEventListener('click', () => step(1));
}


/* ---------- marking by hand ---------- */
/* a pointer in page units (x across in page heights, y down in page fractions), with what a few screen pixels are in them */
function selPt(e) {
  const cv = $('#selCv'), geo = SEL.geo, b = cv.getBoundingClientRect(), sx = cv.width / b.width, px = (e.clientX - b.left) * sx, py = (e.clientY - b.top) * sx;
  return { x: (px - geo.ox) / geo.u, y: (py - geo.oy) / geo.u, px, py, tol: 6 * sx / geo.u };
}
/* what is under the pointer: the ×, a system's top or bottom edge, a frame guide edge, the inside of a system, or empty page */
function selHit(e) {
  const geo = SEL.geo; if (!geo || SEL.key == null) return { t: 'new' };
  const p = selPt(e), r = SYS.byPage.get(geo.idx), list = r ? r.systems : [], { fx, fy, fw, fh, box } = geo, xc = selXPos();
  if (list.includes(box) && Math.hypot(p.px - xc[0], p.py - xc[1]) <= xc[2] + 3) return { t: 'del', box, p };
  if (SEL.mark.y0 != null) return { t: 'second', p };
  let best = null, bd = p.tol;
  list.forEach(s => { if (p.x < -p.tol || p.x > geo.pa + p.tol) return; [['top', s.top], ['bottom', s.bottom]].forEach(([n, v]) => { const d = Math.abs(p.y - v); if (d <= bd) { bd = d; best = { t: n, box: s, p }; } }); });
  if (best) return best;
  if (box && p.y >= fy - p.tol && p.y <= fy + fh + p.tol && p.x >= fx - p.tol && p.x <= fx + fw + p.tol) {
    const d = { fl: Math.abs(p.x - fx), fr: Math.abs(p.x - fx - fw), ft: Math.abs(p.y - fy), fb: Math.abs(p.y - fy - fh) }, n = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
    if (d[n] <= p.tol) return { t: n, box, p };
  }
  const inside = list.find(s => p.y >= s.top && p.y <= s.bottom && p.x >= s.left * geo.pa && p.x <= s.right * geo.pa); if (inside) return { t: 'move', box: inside, p };
  return { t: 'new', p };
}
const SEL_CURSOR = { del: 'pointer', top: 'ns-resize', bottom: 'ns-resize', fl: 'ew-resize', fr: 'ew-resize', ft: 'ns-resize', fb: 'ns-resize', move: 'move', new: 'crosshair', second: 'crosshair' };
let selPaintQ = 0; const selPaintSoon = () => { cancelAnimationFrame(selPaintQ); selPaintQ = requestAnimationFrame(selPaint); };
function selMarkMode(on) {
  SEL.mark.on = on; SEL.mark.y0 = SEL.mark.hover = SEL.mark.draft = null; $('#spMark').setAttribute('aria-pressed', on ? 'true' : 'false'); $('#sysSel').classList.toggle('marking', on);
  $('#selCv').style.cursor = ''; if (SPLIT.shown) selPaintSoon();
}
function selMarkBind() {
  const pane = $('#sysSel'), cv = $('#selCv'), M = SEL.mark; let G = null;
  $('#spMark').addEventListener('click', () => selMarkMode(!M.on));
  $('#spAgain').addEventListener('click', () => { if (SEL.geo && SEL.key != null) { M.y0 = M.draft = null; sysRedetect(SEL.geo.idx); } });
  pane.addEventListener('pointerdown', e => {
    if (!M.on || e.button !== 0 || e.target !== cv || !SEL.geo || SEL.key == null) return;
    e.stopPropagation(); e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const h = selHit(e); G = Object.assign(h, { sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId, pg: SEL.geo.idx, ox: h.box && h.box.ox || 0, oy: h.box && h.box.oy || 0, started: false });
  });
  cv.addEventListener('pointermove', e => {
    if (!M.on || !SEL.geo) return;
    const p = selPt(e);
    if (!G) { cv.style.cursor = SEL_CURSOR[selHit(e).t] || ''; if (M.y0 != null) { M.hover = clamp(p.y, 0, 1); selPaintSoon(); } return; }
    if (!G.moved && Math.hypot(e.clientX - G.sx, e.clientY - G.sy) < 4) return; G.moved = true;
    const y = clamp(p.y, 0, 1), t = G.t, geo = SEL.geo;
    if (t === 'new') M.draft = [G.p.y, y];
    else if (t === 'top') M.draft = [y, G.box.bottom];
    else if (t === 'bottom') M.draft = [G.box.top, y];
    else if (t === 'move') { const dy = clamp(y - G.p.y, -G.box.top, 1 - G.box.bottom); M.draft = [G.box.top + dy, G.box.bottom + dy]; }
    else if (t === 'second') M.hover = y;
    else if (t[0] === 'f' && SYS.byPage.get(geo.idx) && SYS.byPage.get(geo.idx).systems.includes(G.box)) {                                      // a frame guide edge: the frame's padding around the system on that side
      if (!G.started) { G.started = true; pushHistory(); sysHandRec(geo.idx); }
      const [nx, ny] = sysPad(geo.idx, G.box, G.ox + (t === 'fl' || t === 'fr' ? p.x - G.p.x : 0), G.oy + (t === 'ft' || t === 'fb' ? p.y - G.p.y : 0), geo.W, geo.H);
      if (nx) G.box.ox = nx; else delete G.box.ox; if (ny) G.box.oy = ny; else delete G.box.oy;
    }
    selPaintSoon();
  });
  const end = async e => {
    if (!G || e.pointerId !== G.id) return; const g = G; G = null;
    const geo = SEL.geo, d = M.draft; M.draft = null;
    if (e.type === 'pointercancel' || !geo) { selPaintSoon(); return; }
    const t = g.t, idx = g.pg; if (idx !== geo.idx) { selPaintSoon(); return; }          // the page changed under the gesture
    if (t[0] === 'f') { if (g.started) { SYS.rev++; stageDirty = true; } selPaintSoon(); return; }
    if (t === 'del' && !g.moved) { M.y0 = M.hover = null; sysRemove(idx, g.box); return; }
    if (t === 'second') { const y0 = M.y0; M.y0 = M.hover = null; selPaintSoon(); sysMark(idx, y0, clamp(selPt(e).y, 0, 1)); return; }
    if (g.moved && d) { if (t === 'new') M.y0 = null; await sysMark(idx, d[0], d[1], t === 'new' ? null : g.box); selPaintSoon(); return; }
    if (t === 'new') { M.y0 = clamp(g.p.y, 0, 1); M.hover = M.y0; M.pg = idx; selPaintSoon(); return; }          // the first click of a click-click mark
    selClick(e);                                                  // a click on a system or its edge: the playhead goes there
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('dblclick', e => {
    if (!M.on || !SEL.geo) return; const h = selHit(e), geo = SEL.geo, b = h.box; if (!b || h.t[0] !== 'f' || !(SYS.byPage.get(geo.idx) || { systems: [] }).systems.includes(b) || !(h.t === 'fl' || h.t === 'fr' ? b.ox : b.oy)) return;
    pushHistory(); if (h.t === 'fl' || h.t === 'fr') delete b.ox; else delete b.oy;
    sysHandRec(geo.idx); SYS.rev++; stageDirty = true; selPaintSoon();
  });
  document.addEventListener('keydown', e => {
    if (!M.on || !SPLIT.shown || (e.target.matches && e.target.matches('input, textarea, select, [contenteditable]'))) return;
    if (e.key === 'Escape' && (M.y0 != null || M.draft)) { M.y0 = M.draft = M.hover = null; selPaintSoon(); e.stopPropagation(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && SEL.geo && SEL.geo.box) { const r = SYS.byPage.get(SEL.geo.idx); if (r && r.systems.includes(SEL.geo.box)) { e.preventDefault(); e.stopPropagation(); sysRemove(SEL.geo.idx, SEL.geo.box); } }
  }, true);
}
