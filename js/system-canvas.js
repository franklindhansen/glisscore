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
function splitBind() {
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
const SEL = { key: null, sig: '', bmp: null, bmpIdx: -1, bmpH: 0, bmpGen: -1, want: '', paper: null, paperKey: '', geo: null };
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
  const sig = [key, cv.clientWidth, cv.clientHeight, S.set.margin, S.set.tbMargin, S.set.aspect, S.set.res, SYS.byPage.size, SYS.gen, S.pdf.gen || 0].join();
  if (!force && sig === SEL.sig) return;
  if (sysPage(key) !== sysPage(SEL.key == null ? -1 : SEL.key) && SZS.z !== 1) szReset(false, SZS);          // a new page starts at Fit
  SEL.sig = sig; SEL.key = key;
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
  const fw = W / f.s, fh = H / f.s, fx = (box.left + box.right) / 2 * pa - fw / 2, fy = (box.top + box.bottom) / 2 - fh / 2;          // the frame, in page heights
  const x0 = Math.min(0, fx), x1 = Math.max(pa, fx + fw), y0 = Math.min(0, fy), y1 = Math.max(1, fy + fh), m = 14 * k;
  const u = Math.max(1, Math.min((w - 2 * m) / (x1 - x0), (h - 2 * m) / (y1 - y0))), ox = (w - u * (x1 - x0)) / 2 - u * x0, oy = (h - u * (y1 - y0)) / 2 - u * y0;
  const X = x => ox + x * u, Y = y => oy + y * u;
  SEL.geo = { u, ox, oy, idx, pa, w, h };
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
