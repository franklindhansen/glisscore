'use strict';
/* ====================================================================
   System canvas: the stage splits into selector | preview. The selector shows the page of the current system
   with the video frame drawn on it; the playhead and the selector follow each other.
   ==================================================================== */
const DIV_W = 7;                                       // the divider's width
const SPLIT_PRESETS = { spSel: 0.7, spEq: 0.5, spPrev: 0.3, spOnly: 0 };          // the selector's share of the stage: wide, equal, narrow, hidden
/* the split is saved with the settings (the last one set comes back), and is never a History step */
let splitSaveT = 0;
const SPLIT = { get f() { const v = S.set && S.set.sysSplit; return Number.isFinite(v) ? v : 0.5; }, set f(v) { S.set.sysSplit = Math.round(v * 1000) / 1000; clearTimeout(splitSaveT); splitSaveT = setTimeout(saveSettings, 300); }, shown: false, stack: false, glide: 0, raf: 0 };
const splitOn = () => sysOn() && !!S.pdf && !$('.app').classList.contains('fs');

/* Lays out the selector, the divider, and the presets for the stage's size; the preview fits in what is left (pl: room on the left, pt: room above).
   Narrow stages stack the halves, selector above. */
function splitSync() {
  const wrap = $('#stageWrap'), on = splitOn(), cw = wrap.clientWidth, chh = wrap.clientHeight;
  const stack = cw < 600, show = on && SPLIT.f > 0.001, nav = $('.sys-nav'), need = stack ? 0 : Math.min(cw * 0.5, (SPLIT.navW || 0) + 2 * 10);          // the selector is never narrower than its own strip
  const free = !!SPLIT.moving;          // while the divider glides to or from Hide, the selector narrows or widens all the way, so nothing jumps when it appears or goes
  const sel = show ? (free ? Math.max(1, Math.round(clamp(SPLIT.f, 0, 0.9) * (stack ? chh : cw) * Math.max(1, need / Math.max(1, clamp(SPLIT.ref, 0.1, 0.9) * cw)))) : Math.max(Math.round(clamp(SPLIT.f, 0.1, 0.9) * (stack ? chh : cw)), Math.round(need))) : 0;
  const was = SPLIT.shown; SPLIT.shown = show; SPLIT.stack = stack;
  const pane = $('#sysSel'), div = $('#sysDiv'), cv = $('#selCv');
  const keep = !!(SPLIT.view && SPLIT.view.ghost);          // a selector that is closing by a glide stays until it has closed
  pane.hidden = div.hidden = !show && !keep; $('#sysPresets').hidden = !on;
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
  if (show) {          // the page strip and the zoom strip share the bottom row: at full size when the pane has room, tight (shorter label, closer buttons) when it does not, and the pane is never narrower than the tight pair
    const pn = $('#sysSel'), zm = $('#selZoom'), both = () => nav.scrollWidth + zm.offsetWidth + 6;
    pn.classList.remove('tight'); const full = both(); pn.classList.add('tight'); selPgText(); const tight = both();
    const fits = (stack ? cw : sel) >= full + 3 * 10; pn.classList.toggle('tight', !fits); selPgText();
    if (nav.scrollWidth > 20 && tight !== SPLIT.navW) { SPLIT.navW = tight; if (!stack && !free && sel < SPLIT.navW + 20) return splitSync(); }
  }
  Object.keys(SPLIT_PRESETS).forEach(id => $('#' + id).setAttribute('aria-pressed', on && Math.abs(SPLIT_PRESETS[id] - (show ? SPLIT.f : 0)) < 0.02 ? 'true' : 'false'));
  presetCurrent(show ? SPLIT.f : 0);
  szButtons();
  return { show, stack, pl, pt };
}
/* the preset strip shows the preset nearest the current split as one icon; the four choices unfold from it */
function presetCurrent(f) {
  const ids = Object.keys(SPLIT_PRESETS), id = ids.reduce((a, b) => Math.abs(SPLIT_PRESETS[b] - f) < Math.abs(SPLIT_PRESETS[a] - f) ? b : a), b = $('#' + id), cur = $('#spCur');
  cur.querySelector('svg').innerHTML = b.querySelector('svg').innerHTML;
  const n = b.getAttribute('aria-label'); cur.setAttribute('aria-label', 'View: ' + n); cur.title = 'View: ' + n;
}
function presetBind() {
  const box = $('#sysPresets'), cur = $('#spCur'); let t = 0, mouse = false;
  const open = on => { clearTimeout(t); box.classList.toggle('open', on); cur.setAttribute('aria-expanded', on ? 'true' : 'false'); };
  box.addEventListener('pointerenter', e => { mouse = e.pointerType === 'mouse'; if (mouse) open(true); });
  box.addEventListener('pointerleave', () => { if (box.classList.contains('open')) { clearTimeout(t); t = setTimeout(() => open(false), 150); } });
  const glyphs = () => [...box.querySelectorAll('#spFly button')];
  cur.addEventListener('click', e => {
    if (mouse && e.detail && box.classList.contains('open') && cur.matches(':hover')) return;
    const on = !box.classList.contains('open'); open(on);
    if (on && !e.detail) (glyphs().find(b => b.getAttribute('aria-pressed') === 'true') || glyphs()[0]).focus();          // opened from the keyboard: focus moves in, and the arrows step along
  });
  $('#spFly').addEventListener('keydown', e => { const k = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0, g = glyphs(), i = g.indexOf(document.activeElement); if (k && i >= 0) { e.preventDefault(); g[(i + k + g.length) % g.length].focus(); } });          // a tap or a key opens; a second one closes
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && box.classList.contains('open')) { e.preventDefault(); e.stopPropagation(); open(false); if (box.contains(document.activeElement)) cur.focus(); } }, true);          // Escape folds the choices wherever the focus is, also under the mouse
  box.addEventListener('focusout', e => { if (box.classList.contains('open') && !box.contains(e.relatedTarget)) open(false); });
  Object.keys(SPLIT_PRESETS).forEach(id => $('#' + id).addEventListener('click', e => { if (mouse && e.detail) return; open(false); cur.focus(); }));          // under the mouse the choices stay, so another can be tried at once; they fold on moving away
}
function splitSet(f) { SPLIT.f = f; layoutStage(); }
/* A View change is one motion. The new layout is made at once (and the picture drawn for it), then the preview and the selector travel from where they were to where they are by transform alone, on one ease and one time, the way full screen does: the preview and the selector's page scale and move, the strips and the divider move, and the selector's pane opens or closes by a clip. Nothing is laid out while it moves, so nothing can snap. A change made during one starts from where things are. */
const VIEW_STEPS = 24;
const viewBox = el => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; };
function viewStop() {
  const g = SPLIT.view; if (!g) return; SPLIT.view = null;
  g.anims.forEach(a => a.cancel());
  if (g.ghost) { const keep = SPLIT.shown; $('#sysSel').hidden = $('#sysDiv').hidden = !keep; }          // a selector that was going away goes now
}
/* how far the glide has come, 0 to 1 */
const viewAt = g => clamp((performance.now() - g.t0) / g.dur, 0, 1);
function viewGlide(to) {
  const from = SPLIT.f, pane = $('#sysSel'), div = $('#sysDiv'), nav = $('.sys-nav'), zoom = $('#selZoom'), scv = $('#selCv');
  const measure = () => ({ cv: viewBox(stageCanvas), scv: viewBox(scv), nav: viewBox(nav), zoom: viewBox(zoom), div: viewBox(div), pane: viewBox(pane) });
  const run = SPLIT.view, was = SPLIT.shown || !!(run && run.ghost);
  const A = measure(), visA = run ? (() => { const k = AE_EASE(viewAt(run)); return { w: run.vf.w + (run.vt.w - run.vf.w) * k, h: run.vf.h + (run.vt.h - run.vf.h) * k }; })() : { w: A.pane.w, h: A.pane.h };
  viewStop();
  SPLIT.f = to; layoutStage(); try { drawStage(); stageDirty = false; } catch (e) {}          // the picture is made for the layout it is moving into
  const now = SPLIT.shown, stack = SPLIT.stack, ghost = was && !now; if (ghost) pane.hidden = div.hidden = false;          // a selector that goes stays until it has closed
  const B = measure(), lay = B;          // where everything lies now, free of any transform
  const undo = () => { if (ghost) pane.hidden = div.hidden = true; };          // nothing to move: a selector that was to close closes at once
  if (!was && !now) return;
  if (B.cv.w < 2 || A.cv.w < 2) { undo(); return; }
  const off = r => stack ? { l: r.l, t: r.t - lay.pane.h, w: r.w, h: r.h } : { l: r.l - lay.pane.w, t: r.t, w: r.w, h: r.h };
  const F = was ? A : null, T = now ? B : null, mix = (a, b, p) => a + (b - a) * p, g = { anims: [], ghost, t0: performance.now(), dur: 240 + 260 * Math.min(1, Math.abs(to - from) / 0.7) };
  const ease = []; for (let i = 0; i <= VIEW_STEPS; i++) ease.push(AE_EASE(i / VIEW_STEPS));
  const frames = f => ease.map((p, i) => Object.assign({ offset: i / VIEW_STEPS }, f(p)));
  const rect = name => name === 'cv' ? { a: A.cv, b: B.cv } : { a: F ? F[name] : off(T[name]), b: T ? T[name] : off(F[name]) };          // the preview is always there; the selector's parts come from, or go to, just outside the pane
  const place = (name, how) => {          // how: 'box' scales and moves a picture, 'l' and 'r' only move a strip by its left or right edge
    const base = lay[name], { a, b } = rect(name); if (base.w < 1 && how === 'box') return null;
    return frames(p => {
      const l = mix(a.l, b.l, p), t = mix(a.t, b.t, p), w = mix(a.w, b.w, p), h = mix(a.h, b.h, p);
      if (how === 'box') return { transformOrigin: '0 0', transform: 'translate(' + (l - base.l) + 'px,' + (t - base.t) + 'px) scale(' + w / base.w + ',' + h / base.h + ')' };
      const x = how === 'r' ? l + w - (base.l + base.w) : l - base.l; return { transform: 'translate(' + x + 'px,' + (t - base.t) + 'px)' };
    });
  };
  const A0 = F ? { w: visA.w, h: visA.h } : stack ? { w: B.pane.w, h: 0 } : { w: 0, h: B.pane.h }, B0 = T ? { w: B.pane.w, h: B.pane.h } : stack ? { w: A.pane.w, h: 0 } : { w: 0, h: A.pane.h };
  g.vf = A0; g.vt = B0;
  const o = { duration: g.dur, easing: 'linear' }, add = (el, f, x) => { if (el && f) g.anims.push(el.animate(f, x || o)); };
  const cvf = place('cv', 'box'); add(stageCanvas, cvf); add($('#stageWaits'), cvf);
  if (was || now) {
    const sc = place('scv', 'box'); add(scv, sc); add($('#selWaits'), sc);
    add(nav, place('nav', 'l')); add(zoom, place('zoom', 'r')); add(div, place('div', 'l'));
    add(pane, frames(p => ({ clipPath: 'inset(0px ' + (lay.pane.w - mix(A0.w, B0.w, p)) + 'px ' + (lay.pane.h - mix(A0.h, B0.h, p)) + 'px 0px)' })));
  }
  if (!g.anims.length) { undo(); return; }
  SPLIT.view = g; g.anims[0].onfinish = () => { if (SPLIT.view === g) { viewStop(); stageDirty = true; } };
}
function splitGlide(to) {
  cancelAnimationFrame(SPLIT.raf); const from = SPLIT.f;
  if (reducedMotion() || from === to) { viewStop(); splitSet(to); return; }
  if (!stageCanvas.animate || SZ.z !== 1 || SZS.z !== 1) { viewStop(); splitGlideLive(to); return; }          // a zoomed picture has its own transform: it lays out as it moves
  SPLIT.glide = 0; SPLIT.moving = false; viewGlide(to);
}
/* the same glide made by laying out every frame (a zoomed picture, where transforms are already in use) */
function splitGlideLive(to) {
  const from = SPLIT.f;
  SPLIT.ref = to > 0 ? to : from;          // the share whose width the glide starts or ends at, so the selector's size is continuous with the one that rests there
  const t0 = performance.now(), dur = 240 + 260 * Math.min(1, Math.abs(to - from) / 0.7), g = SPLIT.glide = {};
  const step = now => { if (SPLIT.glide !== g) return; const k = clamp((now - t0) / dur, 0, 1); SPLIT.moving = (from === 0 || to === 0) && k < 1; splitSet(k < 1 ? from + (to - from) * AE_EASE(k) : to); if (k < 1) SPLIT.raf = requestAnimationFrame(step); };
  SPLIT.raf = requestAnimationFrame(step);
}
function splitStop() { cancelAnimationFrame(SPLIT.raf); SPLIT.glide = 0; SPLIT.moving = false; viewStop(); }
/* the System group's status line: the run with its bar */
function sysStatusUI() {
  const on = sysOn() && !!S.pdf, p = on ? SYS.prog : null;
  const pill = $('#sysFind'), was = pill.classList.contains('on'); pill.classList.toggle('on', !!p);
  if (p && !was) { const t = $('#sysFindT'); t.style.minWidth = ''; let w = 0; [tx('sys.finding.wait'), tx('sys.finding', { pct: 100 })].forEach(x => { t.textContent = x; w = Math.max(w, t.offsetWidth); }); t.style.minWidth = w + 'px'; }          // the pill keeps one width from "Processing…" to "Processing 100%", so it never shifts as the number grows
  if (p) { const pct = p.total ? Math.round(p.done / p.total * 100) : 0; $('#sysFindT').textContent = p.done > 0 ? tx('sys.finding', { pct }) : tx('sys.finding.wait'); const fill = $('#sysFindFill'); if (!was) { fill.style.transition = 'none'; fill.style.transform = 'scaleX(0)'; void fill.offsetWidth; fill.style.transition = ''; } fill.style.transform = 'scaleX(' + pct / 100 + ')'; const bar = $('#sysFindBar'); if (p.done > 0) sweepStop(bar); else sweepStart(bar); }          // before the first number the length is unknown: the shared sweep; after, the fill
  if (!p) sweepStop($('#sysFindBar'));
}
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
  presetBind();
}

/* ---------- the selector ---------- */
const SEL = { mark: { space: false, over: false, live: null }, key: null, sig: '', bmp: null, bmpIdx: -1, bmpH: 0, bmpGen: -1, want: '', paper: null, paperKey: '', geo: null };
/* the system the playhead is on: a credits card shows the nearest system instead */
function selCurrent(ahead) {
  const n = S.spreads.length; if (!n) return null;
  const fs = frameState(S.time), i = fs.spread + (ahead && fs.flip != null && fs.flip >= 0.5 ? 1 : 0), at = j => { const sp = S.spreads[j]; return sp && sp[1] >= 0 ? sp[1] : null; };
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

/* the page strip's label: "Page 13", or "p. 13" when the selector is too narrow for both strips at full size */
function selPgText() { if (SEL.key == null || !S.pdf) return; $('#selPg').textContent = ($('#sysSel').classList.contains('tight') ? 'p. ' : 'Page ') + pageNo(SEL.key); }
function selSync(force) {
  if (!SPLIT.shown || !S.pdf) return;
  const key = selCurrent(true), cv = $('#selCv'); if (key == null) return;          // the selector moves on at the middle of a turn, not after it ends
  const sig = [key, cv.clientWidth, cv.clientHeight, S.set.margin, S.set.letterbox, S.set.aspect, S.set.res, SYS.byPage.size, SYS.gen, SYS.rev, S.pdf.gen || 0].join();
  if (!force && sig === SEL.sig) return;
  if (sysPage(key) !== sysPage(SEL.key == null ? -1 : SEL.key) && SZS.z !== 1) szReset(false, SZS);          // a new page starts at Fit
  SEL.sig = sig; SEL.key = key; SEL.mark.live = null;
  const pages = selPages(), i = pages.findIndex(q => q.page === sysPage(key));
  const rec = SYS.byPage.get(sysPage(key)); document.querySelectorAll('input[name=selMode]').forEach(r => { r.checked = r.value === (rec && rec.full ? 'full' : 'systems'); r.disabled = !rec; }); { const sg = $('#selMode'); if (sg._place) sg._place(false); }
  selPgText(); $('#selPrev').disabled = i <= 0; $('#selNext').disabled = i < 0 || i >= pages.length - 1;
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
/* The page, plain: it fits the pane with a small margin, the same size for every page. Each Selection is outlined (the current one bright, the others faint) and numbered in reading order. */
function selPaint() {
  const cv = $('#selCv'), key = SEL.key; if (key == null || !S.pdf) return;
  const k = Math.min(3, 2 * Math.max(1, window.devicePixelRatio || 1)), w = Math.max(2, Math.round(cv.clientWidth * k)), h = Math.max(2, Math.round(cv.clientHeight * k));
  if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h;
  const g = cv.getContext('2d'), idx = sysPage(key), pa = S.pdf.aspect, { W, H } = outputSize(), box = sysFit(key, W, H).box;
  const m = 14 * k, wst = $('#stageWrap').style, fs = parseFloat(wst.getPropertyValue('--fs')) || 32, fm = parseFloat(wst.getPropertyValue('--fsm')) || 10;
  let u = Math.max(1, Math.min((w - 2 * m) / pa, h - 2 * m)), oy = (h - u) / 2;
  const row = ((fs + fm) + 6) * k;          // the strips along the bottom never cover the page: when the page would reach them it gives them a row of their own, as the preview does
  if (oy < row && h > row + 3 * m) { u = Math.max(1, Math.min((w - 2 * m) / pa, h - m - row)); oy = m + (h - m - row - u) / 2; }
  const ox = (w - u * pa) / 2, X = x => ox + x * u, Y = y => oy + y * u;
  SEL.geo = { u, ox, oy, idx, pa, w, h, box, k };
  selNeed(idx, Math.ceil(u / 200) * 200);
  g.clearRect(0, 0, w, h);
  const found = SYS.byPage.has(idx) && !sysBusy(), ready = found && SEL.bmp && SEL.bmpIdx === idx && SEL.bmpGen === (S.pdf.gen || 0);          // while systems are found the selector waits with the preview, and both come up together
  if (ready) { g.fillStyle = '#fff'; g.fillRect(X(0), Y(0), pa * u, u); g.drawImage(SEL.bmp, X(0), Y(0), pa * u, u); }
  else g.drawImage(selSoft(idx), X(0), Y(0), pa * u, u);          // not made or not found yet: the page's softened thumbnail, never a white sheet
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b5bdb', r = SYS.byPage.get(idx), list = r && found ? r.systems : [];
  if (list.length) selErasePaint(g, list);          // what was erased: a highlight inside each system's cut
  selMarkPaint(g, list, box, X, Y, accent);
  eraseChip();
  selWaitSync(idx, found, ready, X(0) / k, Y(0) / k, pa * u / k, u / k);
}
/* the page's thumbnail, softened, kept for the page shown */
function selSoft(idx) {
  const t = slotThumb(idx);
  if (!SEL.soft || SEL.soft.idx !== idx || SEL.soft.t !== t) SEL.soft = { idx, t, cv: softPage(t, 160, Math.round(160 / S.pdf.aspect)) };
  return SEL.soft.cv;
}
/* the same look as the preview: the sweep and, after a moment, a label until the page is made */
function selWaitSync(idx, found, ready, x, y, w, h) {
  const host = $('#selWaits'), n = pageNo(idx), r = SYS.byPage.get(idx), items = [], box = { id: idx, x, y, w, h };
  pgWaitHost(host, $('#selCv'));
  if (!found) { /* the pill over the stage says it; the softened page shows */ }
  else if (!ready) items.push(Object.assign(box, { text: tx('stage.rendering', { n }), short: tx('stage.rendering.short') }));
  pgWaitSet(host, items);
}
/* Marking, always on while System is: every system's four edges are handles. Each one wears its reading-order number on its top left
   corner, and the current one an × on its top right corner, on one line; both stay inside the pane on a page with no margin. While something is dragged the page is drawn as it
   will be (M.live), the moved one dashed and its neighbors already out of its way. */
function selBadge(x, y, bw) {
  const { k, w, h } = SEL.geo, r = 8 * k, hw = (bw || 2 * r) / 2;
  return [clamp(x, hw + 2, w - hw - 2), clamp(y, r + 2, h - r - 2), r];
}
function selMarkPaint(g, list, box, X, Y, accent) {
  const { u, pa, k } = SEL.geo, M = SEL.mark, lw = Math.max(1, k * 0.75), L = M.live;
  if (ERASE.on) { g.save(); g.strokeStyle = accent; g.globalAlpha = 0.4; g.lineWidth = lw; g.setLineDash([4 * k, 3 * k]); list.forEach(s => g.strokeRect(X(s.left * pa) + 0.5, Y(s.top) + 0.5, (s.right - s.left) * pa * u, (s.bottom - s.top) * u)); g.restore(); return; }          // while erasing, each Selection is a faint dashed outline: no fill, no number, no ×, and nothing to grab
  const show = L ? L.boxes.map((s, n) => ({ top: L.out[n][0], bottom: L.out[n][1], left: n === L.cur && L.lr ? L.lr[0] : s ? s.left : 0, right: n === L.cur && L.lr ? L.lr[1] : s ? s.right : 1, cur: n === L.cur, live: n === L.cur })) : list.map(s => ({ top: s.top, bottom: s.bottom, left: s.left, right: s.right, cur: s === box }));
  g.save(); g.strokeStyle = accent;
  show.forEach((s, n) => {
    const x = X(s.left * pa), y = Y(s.top), bw = (s.right - s.left) * pa * u, bh = (s.bottom - s.top) * u;
    if (s.live) { g.globalAlpha = 0.12; g.fillStyle = accent; g.fillRect(x, y, bw, bh); g.setLineDash([6 * k, 4 * k]); }
    g.globalAlpha = s.cur ? 0.95 : 0.4; g.lineWidth = s.cur ? lw * 1.5 : lw; g.strokeRect(x + 0.5, y + 0.5, bw, bh); g.setLineDash([]);
  });
  show.forEach((s, n) => {          // the numbers, over every outline
    const t = String(n + 1), fs = 10.5 * k; g.font = '600 ' + fs + 'px "Hanken Grotesk",system-ui,sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
    const tw = Math.max(16 * k, g.measureText(t).width + 9 * k), c = selBadge(X(s.left * pa), Y(s.top), tw), r = c[2];
    g.globalAlpha = 1; g.fillStyle = '#fff'; g.beginPath(); g.roundRect ? g.roundRect(c[0] - tw / 2, c[1] - r, tw, 2 * r, r) : g.rect(c[0] - tw / 2, c[1] - r, tw, 2 * r); g.fill();          // paper under a faint one, so the outline does not show through
    g.globalAlpha = s.cur ? 1 : 0.45; g.fillStyle = accent; g.fill(); g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillText(t, c[0], c[1] + k * 0.5);
  });
  g.textAlign = 'start'; g.textBaseline = 'alphabetic';
  g.restore();
  if (list.includes(box) && !L) { const c = selXPos(); g.save(); g.fillStyle = accent; g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.5, k * 1.25); g.lineCap = 'round'; const q = c[2] * 0.4; g.beginPath(); g.moveTo(c[0] - q, c[1] - q); g.lineTo(c[0] + q, c[1] + q); g.moveTo(c[0] + q, c[1] - q); g.lineTo(c[0] - q, c[1] + q); g.stroke(); g.restore(); }
}
/* where the × sits (canvas dots: x, y, radius): centered on the selected system's top right corner, kept inside the pane */
function selXPos() {
  const { u, ox, oy, pa, box } = SEL.geo;
  return selBadge(ox + box.right * pa * u, oy + box.top * u);
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
  document.querySelectorAll('input[name=selMode]').forEach(r => r.addEventListener('change', () => { if (r.checked && SEL.geo) sysSetFull(SEL.geo.idx, r.value === 'full'); const sg = $('#selMode'); if (sg._place) sg._place(true); }));
  $('#selPrev').addEventListener('click', () => step(-1)); $('#selNext').addEventListener('click', () => step(1));
}


/* ---------- marking by hand ---------- */
/* a pointer in page units (x across in page heights, y down in page fractions), with what a few screen pixels are in them */
function selPt(e) {
  const cv = $('#selCv'), geo = SEL.geo, b = cv.getBoundingClientRect(), sx = cv.width / b.width, px = (e.clientX - b.left) * sx, py = (e.clientY - b.top) * sx;
  return { x: (px - geo.ox) / geo.u, y: (py - geo.oy) / geo.u, px, py, tol: 6 * sx / geo.u };
}
/* what is under the pointer: the ×, a system's top, bottom, left, or right edge, the inside of a system, or empty page. The × and the number badges keep the corners: an edge is not offered under a badge. */
function selHit(e) {
  const geo = SEL.geo; if (!geo || SEL.key == null) return { t: 'new' };
  const p = selPt(e), r = SYS.byPage.get(geo.idx), list = r ? r.systems : [], { box } = geo, xc = selXPos();
  if (list.includes(box) && Math.hypot(p.px - xc[0], p.py - xc[1]) <= xc[2] + 3) return { t: 'del', box, p };
  let best = null, bd = Infinity;
  list.forEach(s => { if (p.x < -p.tol || p.x > geo.pa + p.tol) return; [['top', s.top], ['bottom', s.bottom]].forEach(([n, v]) => { const d = Math.abs(p.y - v) + ((n === 'bottom') === (p.y > v) ? p.tol * 0.01 : 0); if (d <= p.tol && d < bd) { bd = d; best = { t: n, box: s, p }; } }); });          // where two systems touch, the pointer's own side decides
  const badge = (cx, cy, hw) => Math.abs(p.px - cx) <= hw + 3 && Math.abs(p.py - cy) <= xc[2] + 3;          // the number badge (its width follows its text; one or two figures) and the ×, at the top corners
  list.forEach(s => {
    if (p.y < s.top - p.tol || p.y > s.bottom + p.tol) return;
    const nb = selBadge(geo.ox + s.left * geo.pa * geo.u, geo.oy + s.top * geo.u, 16 * geo.k), xb = selBadge(geo.ox + s.right * geo.pa * geo.u, geo.oy + s.top * geo.u);
    if (badge(nb[0], nb[1], 8 * geo.k + 4 * geo.k) || (s === box && badge(xb[0], xb[1], xb[2]))) return;
    [['left', s.left], ['right', s.right]].forEach(([n, v]) => { const d = Math.abs(p.x - v * geo.pa); if (d <= p.tol && d < bd) { bd = d; best = { t: n, box: s, p }; } });
  });
  if (best) return best;
  const inside = list.find(s => p.y >= s.top && p.y <= s.bottom && p.x >= s.left * geo.pa && p.x <= s.right * geo.pa); if (inside) return { t: 'move', box: inside, p };
  return { t: 'new', p };
}
const selList = () => { const r = SEL.geo && SYS.byPage.get(SEL.geo.idx); return r ? r.systems : []; };
/* a new system is made by pressing on blank page and dragging; a double-click on a system (or an edge of one) puts it back to what was found, by the shared double-click time and distance (DBL_MS, DBL_PX, DBL_TOUCH_PX in core.js) */
const SEL_CURSOR = { del: 'pointer', top: 'ns-resize', bottom: 'ns-resize', left: 'ew-resize', right: 'ew-resize', move: 'move', new: 'default' };
let selPaintQ = 0; const selPaintSoon = () => { cancelAnimationFrame(selPaintQ); selPaintQ = requestAnimationFrame(selPaint); };
function selMarkBind() {
  const pane = $('#sysSel'), cv = $('#selCv'), M = SEL.mark; let G = null;
  $('#spAgain').addEventListener('click', () => { if (SEL.geo && SEL.key != null) { M.live = null; sysRedetect(SEL.geo.idx); } });
  /* a zoomed page pans by dragging while Space is held over it (a plain drag on blank page marks a new system); Space then does not play */
  const spaceSet = on => { M.space = on; pane.classList.toggle('pan-ready', on); };
  pane.addEventListener('pointerenter', () => { M.over = true; }); pane.addEventListener('pointerleave', () => { M.over = false; });
  document.addEventListener('keyup', e => { if (e.code === 'Space' && M.space) spaceSet(false); }, true); window.addEventListener('blur', () => spaceSet(false));
  pane.addEventListener('pointerdown', e => {
    if (M.space) return;
    if (e.button !== 0 || e.target !== cv || !SEL.geo || SEL.key == null || sysBusy()) return;          // nothing is marked while systems are found
    if (ERASE.on) { eraseDown(e); return; }          // the eraser: systems are frozen, a drag brushes
    e.stopPropagation(); e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const h = selHit(e);
    G = Object.assign(h, { sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId, pg: SEL.geo.idx, base: selList().slice() });
  });
  cv.addEventListener('pointermove', e => {
    const geo = SEL.geo; if (!geo) return;
    if (ERASE.on) { eraseMove(e); return; }
    const p = selPt(e);
    if (!G) { cv.style.cursor = SEL_CURSOR[selHit(e).t] || ''; return; }
    if (!G.moved && Math.hypot(e.clientX - G.sx, e.clientY - G.sy) < 4) return; G.moved = true;
    const y = clamp(p.y, 0, 1), t = G.t, i = G.base.indexOf(G.box);
    if (t === 'new') M.live = sysPush(G.base, 'new', 0, clamp(G.p.y, 0, 1), y);
    else if (i >= 0 && (t === 'left' || t === 'right')) { const sd = sysSides(G.box, t, p.x / geo.pa); M.live = { boxes: G.base, out: G.base.map(q => [q.top, q.bottom]), cur: i, lr: sd }; }          // only this Selection's side moves; the others stay
    else if (i >= 0 && (t === 'top' || t === 'bottom')) M.live = sysPush(G.base, t, i, y);
    else if (i >= 0 && t === 'move') M.live = sysPush(G.base, 'move', i, y - G.p.y);
    selPaintSoon();
  });
  const end = async e => {
    if (!G || e.pointerId !== G.id) return; const g = G; G = null;
    const geo = SEL.geo, L = M.live; M.live = null;
    if (e.type === 'pointercancel' || !geo) { selPaintSoon(); return; }
    const t = g.t, idx = g.pg; if (idx !== geo.idx) { selPaintSoon(); return; }          // the page changed under the gesture
    if (t === 'del' && !g.moved) { sysRemove(idx, g.box); return; }
    if (g.moved && L && L.lr) { sysEdgeSet(idx, g.box, L.lr[0], L.lr[1]); selPaintSoon(); return; }
    const big = L && L.out[L.cur][1] - L.out[L.cur][0] >= SYS_MINH;
    if (g.moved && L) { if (big) await sysPlace(idx, L.boxes, L.out); selPaintSoon(); return; }
    if (t === 'new') { selPaintSoon(); return; }          // a click on blank page does nothing
    const now = performance.now(), tap = M.tap; M.tap = g.box ? { t: now, x: e.clientX, y: e.clientY, box: g.box, pg: idx } : null;
    if (tap && g.box && tap.box === g.box && tap.pg === idx && dblNear(now - tap.t, e.clientX - tap.x, e.clientY - tap.y, e.pointerType)) { M.tap = null; selClick(e); sysResetOne(idx, g.box).then(() => selPaintSoon()); return; }          // a double-click (or two quick taps) on a system or its edge: that one box goes back to what was found
    selClick(e);                                                  // a click on a system or its edge: the playhead goes there
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && SPLIT.shown && M.over && SZS.z > 1 && !(e.target.matches && e.target.matches('input, textarea, select, [contenteditable]'))) { e.preventDefault(); e.stopPropagation(); spaceSet(true); return; }
    if (!SPLIT.shown || (e.target.matches && e.target.matches('input, textarea, select, [contenteditable]'))) return;
    if (e.key === 'Escape' && M.live) { M.live = null; G = null; selPaintSoon(); e.stopPropagation(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !ERASE.on && SEL.geo && SEL.geo.box) { const r = SYS.byPage.get(SEL.geo.idx); if (r && r.systems.includes(SEL.geo.box)) { e.preventDefault(); e.stopPropagation(); sysRemove(SEL.geo.idx, SEL.geo.box); } }
  }, true);
}


/* ---------- the eraser: brushing marks off one system's sheet, on the selector ---------- */
/* Turned on from the selector's bar (or E), a drag on a system makes a stroke that belongs to that system: the marks under it go from the video, filled with the paper around them (`sysEraseDraw` in js/systems.js). The selector shows the stroke as a highlight (strong while drawing, set once lifted, fainter with the eraser off) drawn inside the system's cut only; the video preview fades the patch in or out (`sysErFade`) and never shows the highlight. The brush is a small round tip, the same size on screen at every zoom (--brush), with a ring showing it. While it is on, the systems are frozen (no drag draws, moves, resizes, or deletes one). Space-drag pans, the wheel and a pinch zoom, and Esc or a second press turns it off. */
const ERASE = { on: false, G: null, hot: null, hideT: 0 };
/* the page the selector shows, when it has systems to brush (null while a turn runs, on the credits card, on a Full page, while systems are found, or with the selector hidden) */
function eraseTarget() {
  if (!S.pdf || !sysOn() || !SPLIT.shown || sysBusy() || !SEL.geo || SEL.key == null || !S.spreads.length) return null;
  const fs = frameState(S.time), sp = S.spreads[fs.spread]; if (!sp || sp[1] < 0) return null;          // the selector shows a page whatever the turn is doing, so a paused playhead partway through a turn can still erase
  const idx = SEL.geo.idx, r = SYS.byPage.get(idx); if (!r || r.full || !r.systems.length) return null;
  return { idx, list: r.systems };
}
function eraseSet(on) {
  on = !!on && !!eraseTarget(); if (ERASE.on === on) return;
  if (!on) { eraseCancel(); eraseHot(null); $('#eraseRing').hidden = true; }
  ERASE.on = on; SEL.mark.live = null; $('#szErase').setAttribute('aria-pressed', on ? 'true' : 'false'); $('#sysSel').classList.toggle('erasing', on); selPaintSoon();
}
/* greyed (with its reason as the tooltip) where there is no system to brush */
function eraseSync() {
  const b = $('#szErase'); if (!b) return; const show = sysOn() && !!S.pdf, t = show ? eraseTarget() : null;
  b.disabled = show && !t; const tip = !show ? '' : t ? tx('sys.erase') : tx('sys.erase.why'); if (b.title !== tip) b.title = tip;
  if (ERASE.G && (!t || t.idx !== ERASE.G.idx)) eraseCancel();
  if (ERASE.on && !t) eraseSet(false);
}
/* a pointer as a point on the page (x across and y down as fractions of the page), and the brush's radius in page heights: --brush at screen size, so it does not change with the selector's zoom */
function erasePt(e) {
  const geo = SEL.geo, p = selPt(e), sx = $('#selCv').width / $('#selCv').getBoundingClientRect().width;
  return { x: p.x / geo.pa, y: p.y, px: p.px, py: p.py, sx, r: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--brush') || '16') / 2 * sx / geo.u };
}
const eraseBoxAt = (t, x, y) => t.list.find(b => sysInCut(b, x, y));
/* the settled stroke under the pointer on a system: { box, stroke } (the newest first) */
function eraseHit(e) {
  const t = eraseTarget(); if (!t || !SEL.geo) return null; const geo = SEL.geo, p = erasePt(e), box = eraseBoxAt(t, p.x, p.y); if (!box || !box.er) return null;
  const px = p.x * geo.pa, tol = 3 * p.sx / geo.u, d2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, k = l ? clamp(((px - ax) * dx + (p.y - ay) * dy) / l, 0, 1) : 0, X = ax + k * dx - px, Y = ay + k * dy - p.y; return Math.hypot(X, Y); };
  for (let n = box.er.length - 1; n >= 0; n--) {
    const t2 = box.er[n], q = t2.p.length >> 1, lim = t2.r + tol; let near = false;
    for (let i = 0; i < q && !near; i++) { const ax = t2.p[2 * i] * geo.pa, ay = t2.p[2 * i + 1]; if (i ? d2(t2.p[2 * i - 2] * geo.pa, t2.p[2 * i - 1], ax, ay) <= lim : Math.hypot(ax - px, ay - p.y) <= lim) near = true; }
    if (near) return { box, stroke: t2 };
  }
  return null;
}
/* the × in the middle of the hovered stroke (the middle of the points inside the cut), or gone */
function eraseHot(h) {
  clearTimeout(ERASE.hideT); ERASE.hideT = 0; const same = (!h && !ERASE.hot) || (h && ERASE.hot && h.stroke === ERASE.hot.stroke);
  ERASE.hot = h; eraseChip(); if (!same) selPaintSoon();
}
function eraseChip() {
  const x = $('#eraseX'), H = ERASE.hot, geo = SEL.geo;
  if (!ERASE.on || ERASE.G || !H || !geo || !selList().includes(H.box) || !(H.box.er || []).includes(H.stroke)) { x.hidden = true; if (H && !ERASE.G) ERASE.hot = null; return; }
  const pts = []; for (let i = 0; i < H.stroke.p.length; i += 2) if (sysInCut(H.box, H.stroke.p[i], H.stroke.p[i + 1])) pts.push(H.stroke.p[i], H.stroke.p[i + 1]);
  const m = pts.length ? (pts.length >> 2) << 1 : 0, ax = pts.length ? pts[m] : H.stroke.p[0], ay = pts.length ? pts[m + 1] : H.stroke.p[1];
  const cv = $('#selCv'), b = cv.getBoundingClientRect(), pr = $('#sysSel').getBoundingClientRect(), cx = geo.ox + ax * geo.pa * geo.u, cy = geo.oy + ay * geo.u;
  x.hidden = false; x.style.transform = 'translate(' + (b.left - pr.left + cx / cv.width * b.width).toFixed(1) + 'px,' + (b.top - pr.top + cy / cv.height * b.height).toFixed(1) + 'px)';
}
function eraseCancel() { if (!ERASE.G) return; ERASE.G = null; selPaintSoon(); }
function eraseMore(e) {
  const G = ERASE.G, geo = SEL.geo; if (!G || !geo || G.idx !== geo.idx) return;
  if (G.pend) { if (Math.hypot(e.clientX - G.start[0], e.clientY - G.start[1]) < 4) return; G.pend = null; eraseMore({ clientX: G.start[0], clientY: G.start[1] }); }
  const p = erasePt(e); if (!sysInCut(G.box, p.x, p.y)) return;          // only points inside the system's cut are kept; the stroke carries on when the pointer comes back in
  if (G.last && Math.hypot(p.px - G.last[0], p.py - G.last[1]) < 2.5 * p.sx) return;          // a new point only once the pointer has moved a little
  G.last = [p.px, p.py]; G.s.p.push(+p.x.toFixed(5), +p.y.toFixed(5)); selPaintSoon();
}
function eraseDown(e) {
  const t = eraseTarget(); if (!t) return; if (ERASE.G) { eraseCancel(); return; }          // a second finger: not a stroke
  e.stopPropagation(); e.preventDefault();
  const p = erasePt(e), box = eraseBoxAt(t, p.x, p.y); if (!box) return;          // a start in a gap or off the page makes no mark
  if (Transport.playing) Transport.pause();          // the selector follows the playhead, so a stroke holds it still
  const hit = e.pointerType !== 'mouse' ? eraseHit(e) : null; eraseHot(null);
  ERASE.G = { idx: t.idx, box, id: e.pointerId, s: { r: +p.r.toFixed(5), p: [] }, last: null, start: [e.clientX, e.clientY], pend: hit ? hit.stroke : null };          // a touch on a settled stroke shows its × (a drag from it still brushes)
  try { $('#selCv').setPointerCapture(e.pointerId); } catch (er) {}
  if (!ERASE.G.pend) eraseMore(e);
}
function eraseEnd(e) {
  const G = ERASE.G; if (!G || e.pointerId !== G.id) return; ERASE.G = null; const geo = SEL.geo;
  if (e.type !== 'pointercancel' && geo && G.idx === geo.idx && selList().includes(G.box)) {
    if (G.pend) { eraseHot({ box: G.box, stroke: G.pend }); ERASE.tapT = performance.now(); }          // the × now sits under the finger: the click that follows this tap is not a press on it
    else if (G.s.p.length) sysErase(G.idx, G.box, G.s);
  }
  selPaintSoon();
}
/* the ring at the pointer (muted where a stroke could not start), and the × for the stroke under a mouse */
function eraseMove(e) {
  const pane = $('#sysSel'), ring = $('#eraseRing'), M = SEL.mark;
  if (ERASE.G && e.pointerId === ERASE.G.id) eraseMore(e);
  const pr = pane.getBoundingClientRect(); ring.hidden = M.space; ring.style.transform = 'translate(' + (e.clientX - pr.left - pane.clientLeft) + 'px,' + (e.clientY - pr.top - pane.clientTop) + 'px)';
  const t = eraseTarget(), p = SEL.geo && t ? erasePt(e) : null; ring.classList.toggle('no', !ERASE.G && !(p && eraseBoxAt(t, p.x, p.y)));
  if (ERASE.G || e.pointerType !== 'mouse') return;
  const h = eraseHit(e); if (h) eraseHot(h); else if (ERASE.hot && !ERASE.hideT) ERASE.hideT = setTimeout(() => { ERASE.hideT = 0; eraseHot(null); }, 220);
}
/* the highlight: every stroke of the page's systems, inside its own cut, never in the video */
function selErasePaint(g, list) {
  const { u, ox, oy, pa } = SEL.geo, cs = getComputedStyle(document.documentElement), col = n => cs.getPropertyValue(n).trim();
  const live = col('--erase-live'), set = col(ERASE.on ? '--erase-mark' : '--erase-rest'), edge = col('--erase-edge'), G = ERASE.G, hot = ERASE.hot && ERASE.hot.stroke;
  list.forEach(b => {
    const all = (b.er || []).concat(G && G.box === b && G.s.p.length ? [G.s] : []); if (!all.length) return;
    g.save(); g.beginPath(); g.rect(ox + b.left * pa * u, oy + b.top * u, (b.right - b.left) * pa * u, (b.bottom - b.top) * u); g.clip();
    g.lineCap = g.lineJoin = 'round';
    all.forEach(t => {
      g.strokeStyle = G && t === G.s ? live : t === hot ? edge : set; g.lineWidth = 2 * t.r * u; g.beginPath();
      for (let i = 0; i < t.p.length; i += 2) { const X = ox + t.p[i] * pa * u, Y = oy + t.p[i + 1] * u; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
      if (t.p.length === 2) g.lineTo(ox + t.p[0] * pa * u + 0.01, oy + t.p[1] * u);          // a single point is a dot
      g.stroke();
    });
    g.restore();
  });
}
function eraseBind() {
  const cv = $('#selCv'), pane = $('#sysSel'), ring = $('#eraseRing'), x = $('#eraseX'), btn = $('#szErase');
  btn.addEventListener('click', () => eraseSet(!ERASE.on));
  cv.addEventListener('pointerleave', e => { ring.hidden = true; if (e.pointerType === 'mouse' && ERASE.hot && !ERASE.hideT && !x.matches(':hover')) ERASE.hideT = setTimeout(() => { ERASE.hideT = 0; eraseHot(null); }, 220); });
  x.addEventListener('pointerenter', () => { clearTimeout(ERASE.hideT); ERASE.hideT = 0; });
  x.addEventListener('pointerleave', () => { if (ERASE.hot && !ERASE.hideT) ERASE.hideT = setTimeout(() => { ERASE.hideT = 0; eraseHot(null); }, 220); });
  ['pointerdown', 'pointerup'].forEach(n => x.addEventListener(n, e => e.stopPropagation()));          // a press on the × is not a click on the page under it
  x.addEventListener('click', () => { if (performance.now() - (ERASE.tapT || -1e9) < 500) return; const H = ERASE.hot, geo = SEL.geo; eraseHot(null); if (H && geo) sysEraseRemove(geo.idx, H.box, H.stroke); });
  cv.addEventListener('pointerup', eraseEnd); cv.addEventListener('pointercancel', eraseEnd);
  document.addEventListener('keydown', e => { if (ERASE.on && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); eraseSet(false); } }, true);          // Esc turns it off
  x.title = tx('sys.erase.x'); x.setAttribute('aria-label', tx('sys.erase.x.aria'));
}
