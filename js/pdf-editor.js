'use strict';
/* ====================================================================
   PDF Editor
   Like the Audio Editor it works on a draft: Undo, Redo and Reset belong to the draft, Done applies it to the video in one step
   (the main Undo can take it back), and Cancel throws it away. The pages are the recipe described above.
   ==================================================================== */
const PE = { d: null, undo: [], redo: [], drag: null, pending: null, hold: 0, focusId: null, mode: 'pages' };
const peSnap = () => peCopy(PE.d);
const peIncluded = () => PE.d.order.filter(id => !PE.d.slots[id].x).length;
const peBaseN = () => PE.addBase ? PE.addBase.n : S.pdf.n;
const peIsIdentity = () => recipeSig(PE.d) === recipeSig(identityRecipe(peBaseN()));
function pePush() { PE.undo.push(peSnap()); if (PE.undo.length > 80) PE.undo.shift(); PE.redo = []; }
const PE_HIST = histPanel({ btn: 'peHistBtn', pop: 'peHist', list: 'peHistList', foot: 'peHistFoot', sum: 'peHistSum', sub: 'peHistSub', no: 'peHistNo', go: 'peHistGo', first: 'Opened',
  states: () => PE.undo.concat([PE.d], PE.redo.slice().reverse()), cur: () => PE.undo.length, label: peStepLabel, can: () => !!(PE.d && (PE.undo.length || PE.redo.length)),
  apply: t => { const st = PE.undo.concat([PE.d], PE.redo.slice().reverse()); PE.undo = st.slice(0, t); PE.redo = st.slice(t + 1).reverse(); PE.d = st[t]; peRender(true); } });
function peUndo() { const s = PE.undo.pop(); if (!s) return; PE.redo.push(peSnap()); PE.d = s; PE.rzPend = undefined; PE.rzShape = undefined; PE.wmSel = null; peRender(true); }
function peRedo() { const s = PE.redo.pop(); if (!s) return; PE.undo.push(peSnap()); PE.d = s; PE.rzPend = undefined; PE.rzShape = undefined; peRender(true); }
function peReset() { if (peIsIdentity()) return; pePush(); PE.d = identityRecipe(peBaseN()); peRender(true); }
/* a playful line takes the place of an editor's usual instructions, then is typed over by them and they stay */
function edLead(which, quip, once, hold) {
  hold = hold || 4800;
  const el = $('#' + which + 'Lead'), key = 'glisscore.quip.' + which, tok = el._tok = (el._tok || 0) + 1;
  const normal = el.dataset.normal || (el.dataset.normal = el.textContent);
  el.textContent = normal; el.style.minHeight = ''; el.classList.remove('quip');
  if (once) { try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) {} }
  el.style.minHeight = el.offsetHeight + 'px';           // the line never changes the dialog's size while it is being typed
  el.textContent = quip; el.classList.add('quip');
  const done = () => { if (el._tok === tok) { el.textContent = normal; el.classList.remove('quip'); el.style.minHeight = ''; } };
  if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    setTimeout(() => {
      if (el._tok !== tok) return;
      let n = quip.length, m = 0, typing = false;
      const step = () => {
        if (el._tok !== tok) return;
        if (!typing) { n -= 2; el.textContent = quip.slice(0, Math.max(0, n)); if (n <= 0) { typing = true; el.classList.remove('quip'); } setTimeout(step, 16); }
        else { m += 2; el.textContent = normal.slice(0, m); if (m >= normal.length) { done(); return; } setTimeout(step, 14); }
      };
      step();
    }, hold);
  } else setTimeout(done, hold);
}
function openPdfEditor() {
  if (!S.pdf) return;
  peClearStatus();
  PE.d = recipeOf(); PE.wmSel = null; PE.wipeShown = false; PE.undo = []; PE.redo = []; PE.drag = null; PE.pending = null; PE.mode = 'pages'; PE.view = 'pages'; PE.skewSeen = new Map(); PE.one = null; PE.oneSig = ''; PE.orig = true; PE.rzCustom = false; PE.rzPend = undefined; PE.chromed = false; PE.skip = new Set(); PE.splitSel = null; PE.cropMode = 'auto'; PE.hand = new Map(); PE.manTicks = false; PE.manSkip = null; PE.autoSkip = null; PE.handLast = null; PE.busy = false; PE.raw = new Map(); PE.full = new Map(); PE.cl = { bg: 1, sp: 1 }; PE.rawOne = null; PE.posWas = new Map(); PE.zm = { z: 1, x: 0, y: 0 }; PE.zmFor = null; peWipeSet(0.5);
  [['peClBg', 1], ['peClSp', 1]].forEach(([n, v]) => document.querySelectorAll('input[name=' + n + ']').forEach(r => { r.checked = +r.value === v; }));
  document.querySelectorAll('input[name=peCropMode]').forEach(r => { r.checked = r.value === 'auto'; });
  document.querySelectorAll('#peBand .pe-tv').forEach(v => { v.hidden = v.dataset.tool !== 'pages'; v.classList.remove('sliding'); });
  sheetShow($('#pdfDlg')); peRender(false); peTopFit(); $('#peDone').focus({ preventScroll: true });
  if (!PE.fitBound) { PE.fitBound = true; let t = 0; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (PE.d) { peTopFit(); peRailSel(false); } }, 120); }); window.addEventListener('resize', () => { if (PE.d && PE.one != null) peOneFit(); }); }
  edIntro('pe');
}
/* Resize is a tool too: pick a size and the whole document changes at once (pages are scaled up as far as they fit, never cut off). */
const peAspect = () => PE.d ? recipeAspect(PE.d) : S.pdf.aspect0;
function rzCurrent() { const z = PE.d && PE.d.size ? sizeDims(PE.d.size, S.pdf.aspect0) : [S.pdf.pw / 72, S.pdf.ph / 72]; return z; }
const rzShown = () => PE.rzPend !== undefined ? PE.rzPend : PE.d.size;          // the size picked but not yet applied, else the one the document has
const rzEach = () => PE.rzShape !== undefined ? PE.rzShape : !!PE.d.each;          // the shape choice picked but not yet applied, else the one the document has
const rzSame = (a, b) => (!a && !b) || !!(a && b && a.w === b.w && a.h === b.h);
function rzRefresh() {
  const grid = $('#peRzGrid'); if (!grid || !PE.d) return;
  const sh = rzShown(), cur = sh ? sizeDims(sh, S.pdf.aspect0) : [S.pdf.pw / 72, S.pdf.ph / 72], orig = !sh;
  const nat0 = rzNum(S.pdf.pw / 72) + ' × ' + rzNum(S.pdf.ph / 72);                  // the page as it came; an arrow then points to the size you have chosen
  $('#peRzFrom').textContent = nat0; $('#peRzTo').classList.toggle('on', !orig); if (!orig) swapText($('#peRzNew'), rzNum(cur[0]) + ' × ' + rzNum(cur[1]), true);
  const sel = orig ? 'orig' : (RZ_PRESETS.find(q => Math.abs(Math.min(q.w, q.h) - Math.min(sh.w, sh.h)) < 0.005 && Math.abs(Math.max(q.w, q.h) - Math.max(sh.w, sh.h)) < 0.005) || { k: 'custom' }).k;
  if (!grid.children.length) {
    const opt = (k, n, sub) => '<button type="button" class="rz-opt" data-k="' + k + '" aria-pressed="false"><span class="rz-tick" aria-hidden="true">' + checkIcon + '</span><b>' + n + '</b><small>' + sub + '</small></button>';
    grid.innerHTML = opt('orig', 'Original', '') + RZ_PRESETS.map(q => opt(q.k, q.n, rzNum(q.w) + ' × ' + rzNum(q.h))).join('') + opt('custom', 'Custom', '');
  }
  const nat = rzNum(S.pdf.pw / 72) + ' × ' + rzNum(S.pdf.ph / 72); grid.querySelector('[data-k=orig] small').textContent = nat;
  grid.querySelectorAll('.rz-opt').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === sel)));
  const shape = $('#peRzShape'), each = rzEach();
  if (!shape.children.length) shape.innerHTML = [['same', 'Same shape on all'], ['each', "Keep each page's shape"]].map(([k, n]) => '<button type="button" class="rz-opt rz-shape" data-k="' + k + '" aria-pressed="false"><span class="rz-tick" aria-hidden="true">' + checkIcon + '</span><b>' + n + '</b></button>').join('');
  shape.querySelectorAll('.rz-shape').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.k === 'each') === each)));
  $('#peRzCustom').classList.toggle('shown', sel === 'custom' || PE.rzCustom);
  if (sh && document.activeElement !== $('#peRzW') && document.activeElement !== $('#peRzH')) { $('#peRzW').value = rzNum(sh.w); $('#peRzH').value = rzNum(sh.h); }
}
function rzPick(size) { if (!PE.d || PE.busy) return; PE.rzPend = rzSame(size, PE.d.size) ? undefined : size; rzRefresh(); peActs(); }          // choosing only previews the choice; the Re-size button applies it
function rzPickShape(each) { if (!PE.d || PE.busy) return; PE.rzShape = each === !!PE.d.each ? undefined : each; rzRefresh(); peActs(); }
function peSetSize(size, each) {
  const d = PE.d; if (!d) return; PE.rzPend = undefined; PE.rzShape = undefined;
  if (rzSame(size, d.size) && each === !!d.each) { rzRefresh(); peActs(); return; }
  const before = rzCurrent(); pePush(); d.size = size; d.each = each; PE.rustle = true; peRender(true);
  const after = rzCurrent(); if (after[0] * after[1] > before[0] * before[1] * 1.01) edSay('pe', 'big');
}
function peRustle(grid) {                          // a quick wave runs down the pages so you can see the change land
  if (reducedMotion() || !grid.animate) return;
  Array.from(grid.children).forEach((c, i) => c.animate([{ opacity: 0.35, transform: 'translateY(-14px) scale(.9)' }, { opacity: 1, transform: 'translateY(3px) scale(1.02)', offset: .62 }, { opacity: 1, transform: 'none' }], { duration: 600, delay: i * 38, easing: EASE_OUT, fill: 'backwards' }));
}
/* the tool list: one tool at a time, each with its own window head (title, what it does, its buttons) and options above the pages */
const PE_TICK = new Set(['wm', 'split', 'clean', 'skew', 'crop']);          // in these the round tick means "this page gets the tool"
const peOrder = () => { const o = railOrder('#peRail [data-tool]'); return o.length ? o : ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm']; };
const peTickMode = () => PE_TICK.has(PE.mode);
const peWmSel = id => PE.d.wm.on ? !PE.d.slots[id].nw : !PE.wmSel || PE.wmSel.has(id);          // the watermark's tick: where it is on, the page has it; before it is added, the page will get it
const peTicked = id => { const sl = PE.d.slots[id]; return !sl.x && (PE.mode === 'wm' ? peWmSel(id) : PE.mode === 'split' ? !!(PE.splitSel && PE.splitSel.has(id)) : !PE.skip.has(id)); };
const peTargets = () => PE.d.order.filter(id => !PE.d.slots[id].x && (PE.mode === 'dim' || (PE.mode === 'crop' && peHandMode()) || !PE.skip.has(id)));          // Dim has no ticks, and neither has Manual: any page can be opened and drawn on
const peN = (n, one, many) => n + ' ' + (n === 1 ? one || 'page' : many || 'pages');
/* a spread is a page wider than tall (by the part a crop keeps); known once its shape has been read (null until then). Halves of a split page never are */
const peSpread = sl => { if (sl.half) return false; const a = PE.asp && PE.asp.get(sl.src); if (a == null) return null; const c = sl.crop, r = c ? (c[2] - c[0]) / (c[3] - c[1]) : 1, q = ((sl.rot || 0) % 180 ? 1 / a : a) * ((sl.rot || 0) % 180 ? 1 / r : r); return q > 1.15; };
const peSplitIds = () => PE.d.order.filter(id => !PE.d.slots[id].x && !PE.d.slots[id].half && PE.splitSel && PE.splitSel.has(id));
async function peSpreadScan() {
  const d = PE.d;
  for (const id of d.order) { const sl = d.slots[id]; if (PE.asp && PE.asp.has(sl.src)) continue; try { await peAspectOf(sl); } catch (e) {} if (PE.d !== d) return; }
  if (!PE.splitSel) PE.splitSel = new Set(d.order.filter(id => !d.slots[id].x && peSpread(d.slots[id])));          // the spreads it found start ticked
  if (PE.mode === 'split') peState();
}
function peTool(name) {
  if (name === PE.mode || PE.drag) return;
  const redraw = PE.mode === 'crop' || name === 'crop' || PE.mode === 'dim' || name === 'dim' || PE.one != null, dir = peOrder().indexOf(name) > peOrder().indexOf(PE.mode) ? 1 : -1;          // only Crop draws the cards differently, so every other switch keeps them as they are
  const snap = redraw ? peBodySnap() : null;          // a copy is only needed when the pictures change; a still grid needs no second image
  peClearStatus();
  PE.mode = name; peCropTicks(); PE.one = null; PE.oneAuto = false; PE.rzPend = undefined; PE.rzShape = undefined; if (name === 'resize') PE.rzCustom = false;
  if (redraw) peRender(false); else peState();
  peBodySlide(snap, dir);
  if (name === 'split') peSpreadScan();
}
/* the window follows the tool: its head and the pages below slide together, like the Audio Editor's tool windows */
function peChrome() {
  const m = PE.mode, win = $('#peWin');
  win.dataset.mode = m; peOneRefresh();
  if (PE.view !== m) { peSlide(PE.view, m); PE.view = m; }
  if (m === 'pages') peAddFill();
  document.querySelectorAll('#peRail .pe-tab').forEach(b => { const on = b.dataset.tool === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  peRailSel(PE.chromed); PE.chromed = true;
  if (m === 'split') peSplitNote();
  peActs();
}
const PE_EASE = 'linear(0, 0.0197, 0.0689, 0.1357, 0.2118, 0.2913, 0.3703, 0.4462, 0.5172, 0.5827, 0.6420, 0.6953, 0.7427, 0.7846, 0.8213, 0.8533, 0.8810, 0.9050, 0.9257, 0.9435, 0.9587, 0.9716, 0.9827, 0.9920, 1)', PE_MS = 250, PE_LIFT = 10, peDist = () => PE_LIFT;          // a tool switch is a crossfade with a small lift in the direction you are moving, not a slide the height of the window
const PE_DELAY = 40, PE_OUT = .56;          // the new view starts 40ms in; the old one is gone by 140ms (56% of 250ms)
// a view that is already moving starts its next move from where it is on screen, so a fast reversal never jumps
const peLive = el => el._slide ? { o: getComputedStyle(el).opacity, t: getComputedStyle(el).transform } : null;
function peSlide(prev, name) {
  const body = $('#peBand'), views = Array.from(body.querySelectorAll('.pe-tv')), cur = views.find(v => v.dataset.tool === name), old = views.find(v => v.dataset.tool === prev);
  const h0 = body.offsetHeight, lo = peLive(old), lc = peLive(cur);
  views.forEach(v => { (v._slide || []).forEach(a => a.cancel()); v._slide = null; v.classList.remove('sliding'); v.hidden = v !== cur; v.inert = v !== cur; });
  (body._slide || []).forEach(a => a.cancel()); body._slide = null; body.classList.remove('sliding');
  peTopFit(name);
  if (!old || old === cur || !PE.chromed || reducedMotion()) return;
  const dir = peOrder().indexOf(name) > peOrder().indexOf(prev) ? 1 : -1, h1 = body.offsetHeight, dist = PE_LIFT;
  old.hidden = false; old.classList.add('sliding'); body.classList.add('sliding');
  const a1 = old.animate([{ transform: lo ? lo.t : 'none', opacity: lo ? lo.o : 1, offset: 0 }, { transform: 'translateY(' + (-dir * dist) + 'px)', opacity: 0, offset: PE_OUT }, { transform: 'translateY(' + (-dir * dist) + 'px)', opacity: 0, offset: 1 }], { duration: PE_MS, easing: PE_EASE, fill: 'forwards' });
  const a2 = cur.animate([{ transform: lc ? lc.t : 'translateY(' + (dir * dist) + 'px)', opacity: lc ? lc.o : 0 }, { transform: 'none', opacity: 1 }], { duration: PE_MS, delay: PE_DELAY, easing: PE_EASE, fill: 'backwards' });
  const a3 = Math.abs(h1 - h0) > 1 ? body.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: PE_MS, easing: PE_EASE }) : null;
  { const rule = $('#peRule'), win = $('#peWin'); win.querySelectorAll('.pe-rule.pe-snap').forEach(n => n.remove()); if (rule) {          // the divider travels with the head and the pages: the old line leaves with the old head, a new one comes in with the new
    const ghost = rule.cloneNode(); ghost.removeAttribute('id'); ghost.classList.add('pe-snap'); ghost.style.top = rule.offsetTop + 'px'; win.appendChild(ghost);
    const g = ghost.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(' + (-dir * dist) + 'px)', opacity: 0, offset: .7 }, { transform: 'translateY(' + (-dir * dist) + 'px)', opacity: 0 }], { duration: PE_MS, easing: PE_EASE });
    const r = rule.animate([{ transform: 'translateY(' + (dir * dist) + 'px)', opacity: 0 }, { transform: 'translateY(' + (dir * dist) + 'px)', opacity: 0, offset: .3 }, { transform: 'none', opacity: 1 }], { duration: PE_MS, easing: PE_EASE });
    g.onfinish = g.oncancel = () => ghost.remove(); }
  }
  old._slide = [a1]; cur._slide = [a2]; body._slide = a3 ? [a3] : null;
  a2.onfinish = () => { a1.cancel(); if (a3) a3.cancel(); old._slide = cur._slide = body._slide = null; old.classList.remove('sliding'); old.hidden = true; body.classList.remove('sliding'); };
}
/* the pages slide with the head: a still copy of what was showing leaves, the new view comes in from the same side as the new head */
function peBodySnap() {
  const win = $('#peWin'), src = win.classList.contains('one') ? $('#peCropView') : $('#peWrap');
  if (!PE.chromed || reducedMotion() || !src.offsetHeight) return null;
  const el = src.cloneNode(true), r = src.getBoundingClientRect(), from = src.querySelectorAll('canvas'), to = el.querySelectorAll('canvas');
  el.removeAttribute('id'); el.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  from.forEach((c, i) => { const q = c.getBoundingClientRect(); if (q.bottom < r.top || q.top > r.bottom || !c.width) return; try { to[i].getContext('2d').drawImage(c, 0, 0); } catch (e) {} });
  el.classList.add('pe-snap'); el.style.display = getComputedStyle(src).display; el.setAttribute('aria-hidden', 'true'); el.inert = true;
  return { el, top: src.scrollTop };
}
function peBodySlide(snap, dir) {
  const body = $('#peWin .pe-body');
  body.querySelectorAll('.pe-snap').forEach(n => n.remove()); (body._slide || []).forEach(a => a.cancel()); body._slide = null;
  if (!snap) return;
  body.appendChild(snap.el); snap.el.scrollTop = snap.top; body.classList.add('sliding');
  const a1 = snap.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PE_MS, easing: PE_EASE, fill: 'forwards' });          // the new pages are already fully visible beneath, so the dissolve never dips and the two images never separate
  body._slide = [a1];
  a1.onfinish = a1.oncancel = () => { snap.el.remove(); if (!body._slide || body._slide[0] === a1) body.classList.remove('sliding'); };          // a cancelled dissolve reports late, after the next one has begun: it must not take that one's clip away
}
/* the tools that fix and arrange share one short head; Re-size and Watermark, which hold more, share one taller head. Moving between the two glides the head's height and the pages follow */
const PE_TALL = new Set(['resize', 'wm']);
function peTopFit(tool) {
  const band = $('#peBand'); if (!band || $('#pdfDlg').hidden) return;
  const hs = { low: 0, tall: 0 };
  band.querySelectorAll('.pe-tv').forEach(v => { const was = v.hidden, hid = Array.from(v.querySelectorAll('.pe-notice[hidden]')); v.hidden = false; hid.forEach(n => { n.hidden = false; }); v.classList.add('measure'); const g = PE_TALL.has(v.dataset.tool) ? 'tall' : 'low'; hs[g] = Math.max(hs[g], v.offsetHeight); v.classList.remove('measure'); hid.forEach(n => { n.hidden = true; }); v.hidden = was; });          // a note that only shows sometimes still has its room
  PE.bandH = hs; const h = hs[PE_TALL.has(tool || PE.view || PE.mode) ? 'tall' : 'low'];
  band.style.height = h && h <= Math.max(200, $('#peWin').offsetHeight * 0.42) ? h + 'px' : '';
}
/* Split spreads says plainly what it found */
function peSplitNote() {
  const d = PE.d, n = $('#peSplitNote'), msg = $('#peSplitMsg'); if (!PE.splitSel) { n.className = 'pe-notice'; msg.textContent = 'Looking for spreads…'; return; }
  const found = d.order.filter(id => !d.slots[id].x && peSpread(d.slots[id])).length, halves = d.order.some(id => d.slots[id].half);
  n.className = 'pe-notice' + (found || halves ? '' : ' warn');
  const t = found ? 'Found ' + peN(found, 'spread', 'spreads') + ' and ticked ' + (found === 1 ? 'it' : 'them') + '. Tick any other page to split it too.' : halves ? 'All spreads are split. Tick a page to split it too.' : 'No spreads found. Tick the pages you want to split.';
  if (msg.textContent !== t) swapText(msg, t, true);
}
/* a greyed main button says why on its tool's status line; the line goes when the button is enabled (a message the tool set itself is left alone) */
/* a reason goes on the status line only when the user can fix it and nothing else on screen says it; these belong on the greyed button's tooltip, whichever call sends them */
const PE_WHY_TIP = new Set(['pe.why.cleaned', 'pe.why.cropped', 'pe.why.spread', 'pe.why.level', 'pe.why.resize', 'pe.why.revert']);
function peTip(sel, key) {          // a greyed button's tooltip: set from a reason, cleared when the reason goes
  const b = typeof sel === 'string' ? $(sel) : sel; if (!b) return;
  if (key) { b.title = tx(key); b.dataset.tipWhy = '1'; } else if (b.dataset.tipWhy) { b.title = ''; delete b.dataset.tipWhy; }
}
function peWhy(sel, key, tipKey) {
  const el = $(sel); if (!el || PE.busy) return; const btn = el.parentElement.querySelector('.btn.primary'), tk = tipKey || (PE_WHY_TIP.has(key) ? key : '');
  if (btn) peTip(btn, tk);
  if (PE_WHY_TIP.has(key)) key = '';
  const w = PE.why || (PE.why = {}), t = key ? tx(key) : '';
  if (t && (!el.textContent || el.textContent === w[sel])) { peSay(sel, t); w[sel] = t; } else if (!t && w[sel] && el.textContent === w[sel]) { peSay(sel, ''); w[sel] = ''; }
}
/* each tool's buttons say what they do; they are greyed out when there is nothing to do */
function peActs() {
  const d = PE.d, busy = !!PE.busy, set = (sel, off) => { $(sel).disabled = busy || !!off; };
  const tilted = id => { const s = d.slots[id]; return s.skew || s.vskew || s.warp; };
  if (PE.mode === 'clean') {
    const t = peTargets(), cl = PE.cl, none = !t.length, bare = !cl.bg && !cl.sp, same = t.every(id => (d.slots[id].bg || 0) === cl.bg && (d.slots[id].sp || 0) === cl.sp), nothing = !t.some(id => peCleaned(d.slots[id]));
    set('#peCleanGo', none || bare || same); set('#peCleanClear', nothing);
    peWhy('#peCleanStatus', none ? 'pe.why.page' : bare ? 'pe.why.choose' : same ? 'pe.why.cleaned' : '');
  }
  else if (PE.mode === 'skew') {
    const t = peTargets(), tried = !!t.length && t.every(id => PE.skewSeen.get(id) === peSkewKey(d.slots[id])), line = $('#peSkewStatus');
    set('#peSkewGo', !t.length || tried); set('#peSkewClear', !t.some(tilted));
    peWhy('#peSkewStatus', !t.length ? 'pe.why.page' : '', tried ? 'pe.why.level' : '');
    if (!busy && !tried && line.textContent === tx('pe.skew.none')) peSay('#peSkewStatus', '');          // the result line goes when the pages change
  }
  else if (PE.mode === 'dim') { const nothing = !d.order.some(id => dimKey(d.slots[id])); set('#peDimClear', nothing); }
  else if (PE.mode === 'split') { const none = !peSplitIds().length; set('#peSplitGo', none); peWhy('#peSplitStatus', none ? 'pe.why.spread' : ''); }
  else if (PE.mode === 'resize') { const off = !((PE.rzPend !== undefined && !rzSame(PE.rzPend, d.size)) || (PE.rzShape !== undefined && rzShown())); set('#peRzGo', off); peTip('#peRzGo', off ? 'pe.why.resize' : ''); }
  else if (PE.mode === 'wm') { const on = !!d.wm.on; $('#peWmAdd').hidden = on; $('#peWmRemove').hidden = !on; set('#peWmAdd', !d.order.some(id => !d.slots[id].x && peWmSel(id))); set('#peWmRemove'); }
  else if (PE.mode === 'crop') { const hand = peHandMode(), ids = peCropIds(), u = new Map(), mm = hand ? peManualBoxes() : null, qs = hand ? [] : ids.map(id => peCropBox(id, u)), done = hand ? mm.size > 0 && [...mm].every(([id, b]) => String(peRound(b)) === String(d.slots[id].crop || '')) : ids.length && qs.every((q, i) => q && (!q.box || String(peRound(q.box)) === String(d.slots[ids[i]].crop || ''))); peCropNote(qs); const none = hand ? !mm.size : !ids.length, nothing = !ids.some(id => d.slots[id].crop && !d.slots[id].half), src = hand ? peApplySrc() : null, apply = hand && src != null && peApplyTo(src).length > 0; set('#peCropAuto', none || done || PE.cropShown); set('#peCropClear', nothing); set('#peCropApply', !apply); $('#peCropPad').disabled = busy || !!PE.cropShown; peWhy('#peCropStatus', hand ? (apply ? '' : src == null ? 'pe.why.draw' : 'pe.why.apply') : none ? 'pe.why.page' : '', done && !none && !(hand && !mm.size) ? 'pe.why.cropped' : ''); }
  else if (PE.mode === 'pages') { const locked = !!pdfWhy(); set('#peAddGo', locked); $('#peAddAt').disabled = busy || locked; }
  document.querySelectorAll('.pe-acts [id^="pe"][id$="Clear"]').forEach(b => peTip(b, b.disabled ? 'pe.why.revert' : ''));          // every tool's greyed Revert says so in a tooltip (a plain state, not something to fix)
}
const peIsIdentityOrder = () => { const d = PE.d; return d.order.every((id, i) => id === i && !d.slots[id].x && !d.slots[id].rot && !d.slots[id].c && !d.slots[id].half); };
function peRailSel(animate) {
  const sel = $('#peRailSel'), root = $('#peRailIn'), btn = document.querySelector('#peRail .pe-tab.on'); if (!sel || !btn || !btn.offsetWidth) { if (sel) sel.style.opacity = '0'; return; }
  let x = 0, y = 0, n = btn; while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  if (!animate || reducedMotion() || sel.style.opacity !== '1') sel.style.transition = 'none';
  sel.style.width = btn.offsetWidth + 'px'; sel.style.height = btn.offsetHeight + 'px'; sel.style.transform = 'translate(' + x + 'px,' + y + 'px)'; sel.style.opacity = '1';
  if (sel.style.transition === 'none') { void sel.offsetWidth; sel.style.transition = ''; }
  const rail = $('#peRail'); if (rail.scrollWidth > rail.clientWidth + 1) rail.scrollTo({ left: x - (rail.clientWidth - btn.offsetWidth) / 2, behavior: animate && !reducedMotion() ? 'smooth' : 'auto' });          // phones: the chosen tool slides into view
}
/* ---- Add pages: the new pages are joined onto the end of a copy of the PDF kept in memory, and placed where you ask ---- */
/* why Add pages and Export are unavailable for this PDF, or '' when they are available */
const pdfWhy = () => S.pdf.locked ? 'Not available for a locked PDF.' : S.pdf.restricted ? 'Not available for a restricted PDF.' : '';
function peAddFill() {
  const sel = $('#peAddAt'), d = PE.d, keep = d.order.filter(id => !d.slots[id].x), prev = sel.value, locked = !!pdfWhy();
  sel.innerHTML = '<option value="start">Start</option>' + keep.slice(0, -1).map((id, i) => '<option value="' + id + '">After p. ' + (i + 1) + '</option>').join('') + '<option value="end">End</option>';
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'end';
  if (locked) peSay('#peAddStatus', pdfWhy());
}
/* the reason line names the cause: a locked file, a file that cannot be read, or the device running out of memory */
function peAddWhy(e, which) {
  const m = String(e && e.message || e || '');
  if (/encrypt/i.test(m)) return which + ' PDF is locked.';
  if (e instanceof RangeError || /memory|allocation/i.test(m)) return 'Not enough memory to add pages. Try a smaller PDF.';
  if (/pars|invalid|header|trailer|xref|object|stream/i.test(m)) return which === 'That' ? 'That file is not a readable PDF.' : 'This PDF could not be read to add pages.';
  return 'Could not add pages.';
}
async function peAdd(kind, file) {
  const d = PE.d, L = await loadPdfLib().catch(() => null); if (!L) { peSay('#peAddStatus', 'Could not load the PDF tools. Reload the page and try again.', true); return; }
  peLock(true); peSay('#peAddStatus', kind === 'pdf' ? 'Adding pages…' : ''); PE.adding = kind === 'pdf'; peProg('#peAddGo', 0);
  try {
    const { PDFDocument } = L, base = await PDFDocument.load(new Uint8Array(await S.pdf.file.arrayBuffer()), { ignoreEncryption: true }), n0 = S.pdf.n; let added = 0; peProg('#peAddGo', 25);
    const at = $('#peAddAt').value, i0 = at === 'end' ? d.order.length : at === 'start' ? 0 : d.order.indexOf(+at) + 1, nb = d.order[i0 - 1] ?? d.order[0], nbSl = d.slots[nb], nbSrc = nbSl && nbSl.src < n0 ? nbSl.src : 0;          // a blank page is made like the page before it
    if (kind === 'blank') { const ref = base.getPage(nbSrc), vb = pdfVisibleBox(ref), side = ((ref.getRotation().angle || 0) % 180) !== 0; base.addPage(side ? [vb.height, vb.width] : [vb.width, vb.height]); added = 1; }
    else { let other; try { other = await PDFDocument.load(new Uint8Array(await file.arrayBuffer())); } catch (e) { peSay('#peAddStatus', peAddWhy(e, 'That'), true); return; } const pgs = await base.copyPages(other, other.getPageIndices()); pgs.forEach(p => base.addPage(p)); added = pgs.length; }
    peProg('#peAddGo', 50); const bytes = await base.save(); peProg('#peAddGo', 75); const nf = new File([bytes], S.pdf.file.name, { type: 'application/pdf' }), lib = await getPdfjs(), doc = await lib.getDocument({ data: bytes.slice() }).promise;
    if (!PE.d || PE.d !== d) { try { doc.destroy(); } catch (e) {} return; }
    if (!PE.addBase) PE.addBase = { file: S.pdf.file, doc: S.pdf.doc, n: S.pdf.n, thumbs: S.thumbs.slice(), gen: S.pdf.gen || 0 };
    S.pdf.file = nf; S.pdf.doc = doc; S.pdf.n = n0 + added; S.pdf.gen = (S.pdf.gen || 0) + 1; VT.clear(); VTpending.clear(); PEA.cache.clear(); PE.asp = null;
    while (S.thumbs.length < S.pdf.n) S.thumbs.push(null); makeThumbs(loadToken);
    pePush();
    const like = kind === 'blank' && nbSl ? nbSl : null;          // the blank page takes the neighbor's turn and crop, so it ends up the same size on the page as the pages around it
    for (let i = 0; i < added; i++) { const ni = d.slots.length; d.slots.push({ src: n0 + i, rot: like ? like.rot || 0 : 0, x: false, c: false, nw: false, crop: like && like.crop ? like.crop.slice() : null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' }); d.order.splice(i0 + i, 0, ni); }
    PE.focusId = d.order[i0]; PE.rustle = true; peRender(true); peAddFill(); peProg('#peAddGo', 100); await new Promise(r => setTimeout(r, 260));          // the first new page is brought into view
  } catch (e) { console.error(e); peSay('#peAddStatus', peAddWhy(e, 'This'), true); }
  finally { peProg('#peAddGo', null); peLock(false); if (PE.adding && !document.querySelector('#peGrid .page-card.loading')) { PE.adding = false; if ($('#peAddStatus').textContent === 'Adding pages…') peSay('#peAddStatus', ''); } else if (PE.adding && $('#peAddStatus').textContent !== 'Adding pages…') PE.adding = false; }
}
/* leaving the editor without Done puts the original file back; with Done the joined copy stays */
function peAddSettle(keep) {
  const b = PE.addBase; if (!b) return; PE.addBase = null;
  if (keep) { try { b.doc.destroy(); } catch (e) {} return; }
  try { S.pdf.doc.destroy(); } catch (e) {} S.pdf.file = b.file; S.pdf.doc = b.doc; S.pdf.n = b.n; S.pdf.gen = (b.gen || 0) + 1; S.thumbs = b.thumbs; VT.clear(); VTpending.clear(); PEA.cache.clear();
}
/* ---- Crop margins, Split spreads, Straighten: they look at the pages (on this device) and set each page's crop or tilt ---- */
let peRunId = 0;
const peSay = (sel, t, err) => { const el = $(sel); if (el) { el.textContent = t; el.classList.toggle('err', !!(t && err)); } };
function peClearStatus() { document.querySelectorAll('#peBand .pe-status').forEach(e => { e.textContent = ''; e.classList.remove('err'); }); }
const peLock = on => { PE.busy = on; document.querySelectorAll('#peBand .btn, #peBar .btn, #peAddAt').forEach(b => { b.disabled = on; }); if (!on && PE.d) peState(); };
/* a tool's own button shows the work: "Processing 42%" and fills as it goes, like the Audio Editor's buttons; it settles back to its name when done. The same look is used for Crop's reading of the pages, since nothing can be cropped before it ends */
function peProg(sel, pc) {
  const b = $(sel); if (!b) return;   if (pc == null) { if (!b.classList.contains('loading')) return; b.classList.remove('loading'); b.style.removeProperty('--p'); b.textContent = b.dataset.t; return; }
  if (!b.classList.contains('loading')) { b.dataset.t = b.textContent; btnHold(b, [b.dataset.t, 'Processing…', 'Processing 100%']); b.classList.add('loading'); }
  b.style.setProperty('--p', pc + '%'); if (pc === 0) b.innerHTML = dotsHTML('Processing…'); else b.textContent = 'Processing ' + pc + '%';          // before the first page is done there is no percent to say
}
async function peEach(ids, btn, fn) {
  const me = ++peRunId; peLock(true); peProg(btn, 0);
  try { for (let i = 0; i < ids.length; i++) { if (me !== peRunId || !PE.d) return false; await fn(ids[i], i); peProg(btn, Math.round((i + 1) / ids.length * 100)); if (i % 2 === 1) await yieldNow(); } await new Promise(r => setTimeout(r, 260)); return me === peRunId && !!PE.d; }          // the bar stays full for a beat so it is seen even on a short run
  finally { if (me === peRunId) { peProg(btn, null); peLock(false); } }
}
const peScanOf = sl => peScan(sl.src, 760, sl.skew || sl.vskew || sl.warp ? { crop: null, skew: sl.skew, vskew: sl.vskew, warp: sl.warp } : null);
const peRound = a => a.map(v => Math.round(v * 10000) / 10000);
/* ---- Crop: the frame each ticked page will get is drawn on the pages themselves, so you see what goes before you press Crop.
   Each page fits its own music, Same size gives every page one frame that covers them all, Manual lets you drag the frame on one page.
   A page with no music on it takes the shared frame, so it never sticks out ---- */
const peCropIds = () => peTargets();
const peHandMode = () => PE.cropMode === 'hand';
const peOneMode = () => PE.mode === 'crop' || PE.mode === 'skew' || PE.mode === 'clean' || PE.mode === 'dim';
PE.one = null; PE.oneSig = ''; PE.orig = true; PE.cropShowRun = 0; PE.cropScans = new Map(); PE.full = new Map();
async function peCropScan(sl) {                                  // a small memory of the scans, so moving the margin slider stays quick
  const key = sl.src + '|' + (sl.skew || 0) + '|' + (sl.vskew || 0) + '|' + (sl.warp || 0) + '|' + (S.pdf.gen || 0);
  let sc = PE.cropScans.get(key); if (!sc) { sc = await peScanOf(sl); PE.cropScans.set(key, sc); if (PE.cropScans.size > 30) PE.cropScans.delete(PE.cropScans.keys().next().value); }
  return sc;
}
const peUnion = bs => bs.length ? [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))] : null;
/* each page's music box is measured once (with no margin) and remembered, so the margin slider is only arithmetic and moves every frame at once */
PE.raw = new Map();
const peRawKey = sl => [sl.src, sl.skew || 0, sl.vskew || 0, sl.warp || 0, S.pdf.gen || 0, sl.half && sl.crop ? sl.crop.join(',') : ''].join('|');
async function peRawBox(sl) {
  const key = peRawKey(sl); if (PE.raw.has(key)) return PE.raw.get(key);
  let b = null; try { await peAspectOf(sl); b = peInkBox(await peCropScan(sl), 0, sl.half ? sl.crop : null); } catch (e) {} PE.raw.set(key, b); return b;
}
const pePadBox = (b, pad, R) => b && [clamp(b[0] - pad, R[0], 1), clamp(b[1] - pad, R[1], 1), clamp(b[2] + pad, 0, R[2]), clamp(b[3] + pad, 0, R[3])];
/* the shared frame: one that covers the music of every ticked page of the same shape as `like` (a spread among single pages has its own; halves of a split page keep theirs).
   Undefined while pages are still being read */
const peShape = sl => { const a = PE.asp && PE.asp.get(sl.src); return a ? Math.round(Math.log(a) * 16) : 0; };          // pages within ~6% of each other's shape count as the same
function peShared(pad, like) {
  const d = PE.d, have = [], sh = like ? peShape(like) : null;
  for (const id of peTargets()) { const sl = d.slots[id]; if (sl.half || (like && peShape(sl) !== sh)) continue; const key = peRawKey(sl); if (!PE.raw.has(key)) return undefined; const b = PE.raw.get(key); if (b) have.push(pePadBox(b, pad, [0, 0, 1, 1])); }
  return peUnion(have);
}
/* the frame a page will get, from what has been read so far (null until its music box is known). `shared` marks a page with no music of its own */
function peCropBox(id, memo) {
  if (peHandMode()) { const hb = PE.hand.get(id); return hb ? { box: hb } : null; }          // Manual: only the pages you drew on have a frame
  return peAutoBox(id, memo);
}
/* the frame Auto works out for a page */
function peAutoBox(id, memo) {
  const d = PE.d, sl = d.slots[id], pad = +$('#peCropPad').value / 100, all = $('#peCropSame').checked;
  const key = peRawKey(sl); if (!PE.raw.has(key)) return null;
  const mine = pePadBox(PE.raw.get(key), pad, sl.half ? sl.crop : [0, 0, 1, 1]);
  if (sl.half || (mine && !all)) return { box: mine };
  const sh = peShape(sl); let u; if (memo && memo.has(sh)) u = memo.get(sh); else { u = peShared(pad, sl); if (memo) memo.set(sh, u); } if (u === undefined) return null;
  return { box: u || mine, shared: !mine && !!u };
}
/* a page whose frame Crop shows: ticked in Auto, any page in Manual */
const peCropOn = id => !PE.d.slots[id].x && (peHandMode() || !PE.skip.has(id));
const peHandSet = (id, b) => { PE.handLast = id; PE.hand.set(id, b); };
/* Manual's frames: the pages you drew on (a page you only opened keeps what it has) */
function peManualBoxes() {
  const d = PE.d, m = new Map(); d.order.forEach(id => { if (!d.slots[id].x && PE.hand.has(id)) m.set(id, PE.hand.get(id)); });
  return m;
}
/* Manual keeps its own ticks, starting with none: they only choose where Apply to selected copies a frame. Auto's ticks wait until you come back */
function peCropTicks() {
  const want = PE.mode === 'crop' && peHandMode(); if (want === !!PE.manTicks) return;
  if (want) { PE.autoSkip = PE.skip; PE.skip = PE.manSkip || new Set(PE.d.order); } else { PE.manSkip = PE.skip; PE.skip = PE.autoSkip; }
  PE.manTicks = want;
}
/* the page whose frame Apply to selected copies: the open page, or in the grid the page you drew on last */
const peSrcBox = id => PE.hand.get(id) || (id === PE.one && !PE.d.slots[id].half && PE.d.slots[id].crop) || null;          // the frame you drew, or the crop the open page already has
const peApplySrc = () => { const d = PE.d, id = PE.one != null ? PE.one : PE.handLast; return id != null && d.slots[id] && !d.slots[id].x && peSrcBox(id) ? id : null; };
const peApplyTo = src => PE.d.order.filter(id => id !== src && !PE.d.slots[id].x && !PE.d.slots[id].half && !PE.skip.has(id));
/* crops that page and the ticked pages with its frame */
function peCropApply() {
  const d = PE.d, src = peApplySrc(); if (src == null) return;
  const b = peSrcBox(src), to = peApplyTo(src); if (!b || !to.length) return;
  pePush(); [src].concat(to).forEach(id => { d.slots[id].crop = peRound(b); });          // only the crop is set, so Undo reverses it all
  PE.rustle = true; peRender(true); peSay('#peCropStatus', '');
}
/* while Crop is open and the pages are read for their frames, the Crop button says so ("Processing 40%", filling as it goes) and it and the margin slider are greyed in Auto; the Crop button is only ever busy once you press it */
function peCropReadSay(pc) {
  const show = pc != null && !peHandMode(), was = !!PE.cropShown; PE.cropShown = show; peProg('#peCropAuto', show ? pc : null);
  if (show !== was && PE.d) peActs();          // the margin slider and the Crop button are greyed for as long as the button shows the work; Manual does not wait for it
}
/* the pages are read one after another while Crop is open; each card gets its frame as soon as it is known */
async function peCropRead() {
  if (PE.cropReading) return; PE.cropReading = true; let did = 0, shown = false, pc = 0;          // the line only shows the reading when it takes a moment (400ms), so a quick read is not a flicker
  const tm = setTimeout(() => { if (PE.cropReading && PE.mode === 'crop' && !PE.busy) { shown = PE.cropOn = true; peCropReadSay(pc); } }, 400);
  try {
    for (;;) {
      const d = PE.d; if (!d || PE.mode !== 'crop') return;          // the draft as it is now: an undo swaps it while pages are being read
      const ids = peTargets(), left = ids.filter(i => !PE.raw.has(peRawKey(d.slots[i]))); if (!left.length) break;
      pc = PE.cropPc = Math.round((ids.length - left.length) / ids.length * 100); if (shown && !PE.busy) peCropReadSay(pc);
      const nx = PE.one != null && left.includes(PE.one) ? PE.one : left[0];          // the page open in the large view is read first, so its frame is there to drag
      await peRawBox(d.slots[nx]); did++; if (!PE.d || PE.mode !== 'crop') return;
      const c = $('#peGrid').querySelector('.page-card[data-id="' + nx + '"]'), s2 = PE.d.slots[nx]; if (c && s2) peDrawCard(c, s2); if (nx === PE.one) peOneFrame();
      if (did % 2 === 0) await yieldNow();
    }
    if (did) { if (!PE.busy && shown) { peCropReadSay(100); await new Promise(r => setTimeout(r, 260)); if (!PE.d || PE.mode !== 'crop') return; peCropReadSay(null); } peCropPaintAll(); peActs(); if (PE.one != null) peOneFrame(); }
  } finally { clearTimeout(tm); PE.cropReading = false; PE.cropOn = false; peCropReadSay(null); }
}
/* every card drawn again with its frame, and the tag on the pages that take the shared frame */
function peCropPaintAll() {
  const d = PE.d, u = new Map();
  document.querySelectorAll('#peGrid .page-card').forEach(c => {
    const id = +c.dataset.id, sl = d.slots[id]; if (!sl) return; const on = peCropOn(id), q = on ? peCropBox(id, u) : null;
    peDrawCard(c, sl, q); c.classList.toggle('shared', !!(q && q.shared));
  });
}
/* a page's whole picture (leveled, not cropped) at thumbnail size, for the cards in Crop; two are drawn at a time */
const peLimit = (() => { let n = 0; const q = [], next = () => { if (n >= 2 || !q.length) return; n++; const j = q.shift(); j[0]().then(j[1], j[2]).finally(() => { n--; next(); }); }; return fn => new Promise((res, rej) => { q.push([fn, res, rej]); next(); }); })();
function peFullThumb(sl) {
  const key = [sl.src, sl.skew || 0, sl.vskew || 0, sl.warp || 0, sl.bg || 0, sl.sp || 0, dimKey(sl), S.pdf.gen || 0].join('|'), hit = PE.full.get(key); if (hit) return hit.width ? hit : null;
  const doc = S.pdf.doc, geo = slotGeo(sl, 'crop');
  PE.full.set(key, peLimit(async () => { if (!PE.d || S.pdf.doc !== doc) throw 0; const a = await peAspectOf({ src: sl.src, rot: 0 }); return renderPdfPage(doc, sl.src, Math.max(20, Math.round(240 * a)), 240, 0, null, geo); }).then(cv => {
    PE.full.set(key, cv); if (PE.full.size > 120) PE.full.delete(PE.full.keys().next().value);
    const d = PE.d; if (d && PE.mode === 'crop') document.querySelectorAll('#peGrid .page-card').forEach(c => { const s2 = d.slots[+c.dataset.id]; if (s2 && s2.src === sl.src) { const id = +c.dataset.id; peDrawCard(c, s2, peCropOn(id) ? peCropBox(id) : null); } });
  }, () => PE.full.delete(key)));
  return null;
}
async function peCropGo() {
  const d = PE.d;
  if (peHandMode()) {          // Manual crops the pages you drew on, and the open page, each with its own frame
    const mm = peManualBoxes(); if (!mm.size) return;
    pePush(); mm.forEach((b, id) => { PE.hand.set(id, b.slice()); d.slots[id].crop = peRound(b); });
    PE.rustle = true; peRender(true); peSay('#peCropStatus', ''); return;
  }
  const ids = peTargets(); if (!ids.length) return;
  const need = ids;
  const ok = need.length ? await peEach(need, '#peCropAuto', id => peRawBox(d.slots[id])) : true;
  if (!ok) return;
  const boxes = ids.map(id => [id, (peCropBox(id) || {}).box]).filter(q => q[1]);          // all worked out before any page changes
  if (!boxes.length) { peSay('#peCropStatus', tx('pe.crop.none')); return; }
  pePush(); boxes.forEach(q => { d.slots[q[0]].crop = peRound(q[1]); });
  PE.rustle = true; peRender(true); peSay('#peCropStatus', '');
}
function peCropClear() {
  const d = PE.d, ids = peTargets().filter(id => d.slots[id].crop && !d.slots[id].half); if (!ids.length) return;
  pePush(); ids.forEach(id => { d.slots[id].crop = null; }); PE.hand.clear(); PE.rustle = true; peRender(true); peSay('#peCropStatus', '');
}
/* Margin adds room around the music but never past the page edge: when the frame already reaches every edge there is nothing left to add, and the note says so */
function peCropNote(qs) {
  const sub = $('#peCropSub'), pad = +$('#peCropPad').value, full = !peHandMode() && pad > 0 && qs.length > 0 && qs.every(q => q && q.box && q.box[0] < 0.002 && q.box[1] < 0.002 && q.box[2] > 0.998 && q.box[3] > 0.998);
  const t = full ? tx('pe.crop.full') : peCropSubText(sub); if (sub.classList.contains('warn') !== full || sub.textContent !== t) { sub.classList.toggle('warn', full); swapText(sub, t, true); }          // the note takes the subtitle's own line, so nothing moves
}
/* the subtitle's usual line: Auto's own, or Manual's, and the note that page 1 sets the video's page shape */
function peCropSubText(sub) {
  const d = PE.d, first = d.order.find(id => !d.slots[id].x); sub.dataset.auto = sub.dataset.auto || sub.dataset.normal;
  return (peHandMode() ? tx('pe.crop.manual') : sub.dataset.auto) + (first != null && d.slots[first].crop && !d.size ? ' ' + tx('pe.crop.page1') : '');
}
/* called whenever the window is drawn while Crop is open */
function peCropRefresh() {
  const hand = peHandMode(); $('#peCropPadF').classList.toggle('dim', hand); $('#peCropSameF').hidden = hand; $('#peCropApply').hidden = !hand;
  peCropPaintAll(); peCropRead();
}
/* ---- one page, large: opened from a page's corner button in Re-kilter and Crop. Crop shows the frame (yours to drag in Manual);
   Re-kilter shows the leveled page with the original beside it, split by a line you can drag ---- */
let peBoxNow = null;
function peCropPaint(b) {
  const el = $('#peCropBox'); peBoxNow = b; if (!b) { el.hidden = true; return; }
  const was = !el.hidden && !el.classList.contains('dragging') && !reducedMotion() && el.animate ? el.getBoundingClientRect() : null;
  el.hidden = false; el.style.left = b[0] * 100 + '%'; el.style.top = b[1] * 100 + '%'; el.style.width = (b[2] - b[0]) * 100 + '%'; el.style.height = (b[3] - b[1]) * 100 + '%';
  if (was && was.width > 1) { const now = el.getBoundingClientRect(); if (now.width > 1 && (Math.abs(was.left - now.left) > .5 || Math.abs(was.top - now.top) > .5 || Math.abs(was.width - now.width) > .5 || Math.abs(was.height - now.height) > .5)) el.animate([{ transform: 'translate(' + (was.left - now.left) + 'px,' + (was.top - now.top) + 'px) scale(' + was.width / now.width + ',' + was.height / now.height + ')' }, { transform: 'none' }], { duration: 300, easing: EASE_OUT }); }          // the frame glides to its new place by transform: its layout is already there
}
function peOneFrame() {
  if (PE.one == null || PE.mode !== 'crop') { peCropPaint(null); return; }
  const q = peCropBox(PE.one), sl = PE.d.slots[PE.one], id = PE.one, d = PE.d;
  if (peHandMode() && !(PE.asp && PE.asp.has(sl.src))) peAspectOf(sl).then(() => { if (PE.d === d && PE.one === id) peOneFrame(); }, () => {});          // the page's shape is needed to know which shared frame it takes; it is found at once, not with the reading
  peCropPaint(q && q.box ? q.box : peHandMode() ? (sl.crop || PE_FULL) : null);          // Manual always has a frame to drag, and never starts from what Auto would find: it starts from the page's own crop, or the whole page, so nothing changes until you move it
}
const PE_FULL = [0, 0, 1, 1];
const peTilted = sl => !!(sl.skew || sl.vskew || sl.warp);
const peCleaned = sl => !!(sl.bg || sl.sp);
PE.cl = { bg: 1, sp: 1 };          // what the Clean button will apply: the paper (1 white, 2 the page's own color) and the specks (1 light, 2 strong); 0 leaves it alone
/* the page in the large view: its box takes the page's own shape the moment it is opened, and fades the picture in when it is ready, so what you wait on always has the right shape.
   Clean draws the page once, large enough to see specks, and cleans a copy each time a choice changes (the original stays on #peOneOrig). */
const PE_ONE_PX = 2800;
const peOneAsp = (sl, asp) => { const c = PE.mode !== 'crop' && sl.crop; return c ? asp * (c[2] - c[0]) / (c[3] - c[1]) : asp; };
/* the page's box in the large view: as large as the window allows (it follows the window as it changes size) */
const PE_ONE_EASE = EASE_GLIDE, PE_ONE_MS = 320;          // the large view moves on one ease and length: it opens, and the page's box changes shape, the old picture leaves and the new one arrives
function peOneFit(asp, glide) {
  const st = $('#peCropStage'), pg = $('#peCropPg'); if (asp) PE.oneAsp = asp; asp = PE.oneAsp; if (!asp || !st.clientWidth) return null;
  const W = Math.max(60, st.clientWidth - 40), H = Math.max(60, st.clientHeight - 40), w = Math.min(W, Math.round(H * asp)), h = Math.round(w / asp);
  const z = (PE.zm && PE.zm.z) || 1, mx = new DOMMatrix(getComputedStyle(pg).transform), w0 = pg.offsetWidth * mx.a / z, h0 = pg.offsetHeight * mx.d / z;          // the size on screen now, partway through a glide too (the box's own scale, not the view's)
  pg.getAnimations().forEach(a => { if (a.id === 'peFit') a.cancel(); });
  pg.style.width = w + 'px'; pg.style.height = h + 'px';          // the layout has its new size at once; the glide is a scale (transform), from the old size on screen to the new one
  if (glide && w0 && (Math.abs(w0 - w) > 1 || Math.abs(h0 - h) > 1) && pg.animate && !reducedMotion()) {
    const sx = w0 / w, sy = h0 / h, o = { duration: PE_ONE_MS, easing: PE_ONE_EASE }, a = pg.animate([{ transform: 'scale(' + sx + ',' + sy + ')' }, { transform: 'scale(1,1)' }], Object.assign({ composite: 'add' }, o)); a.id = 'peFit';          // 'add': on top of the zoom
    const g = pg.querySelector('.pe-ghost'); if (g) { const kf = []; for (let i = 0; i <= 10; i++) { const u = i / 10; kf.push({ offset: u, transform: 'translate(-50%,-50%) scale(' + 1 / (sx + (1 - sx) * u) + ',' + 1 / (sy + (1 - sy) * u) + ')' }); } g.animate(kf, o); }          // the leaving picture keeps its own shape and size while the box under it scales
  }
  peZoomClamp(); peZoomApply(false); return [w, h];
}
/* the picture on show when another page is asked for leaves as it was (not stretched into the next page's shape) and fades out while the box changes shape; the canvas that will carry the next one starts empty */
function peOneGhost() {
  const pg = $('#peCropPg'), old = $('#peCropCv'); if (!old || !old.width) return;
  const nu = document.createElement('canvas'); nu.id = 'peCropCv'; pg.insertBefore(nu, old);
  if (!PE.shownKey || pg.classList.contains('loading') || !pg.animate || reducedMotion()) { old.remove(); return; }          // nothing worth showing leaving
  { const z = (PE.zm && PE.zm.z) || 1, mx = new DOMMatrix(getComputedStyle(pg).transform); old.id = ''; old.className = 'pe-ghost'; old.setAttribute('aria-hidden', 'true'); old.style.cssText = 'width:' + pg.offsetWidth * mx.a / z + 'px;height:' + pg.offsetHeight * mx.d / z + 'px'; }
  old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PE_ONE_MS, easing: PE_ONE_EASE }).finished.then(() => old.remove(), () => old.remove());
}
/* a new picture that arrives while the page is already shown sweeps across it from the left, so the moment a button took effect is easy to see */
function peSweepEnd() { const l = $('#peCropPg').querySelectorAll('.pe-reveal,.pe-edge'); l.forEach(e => e.remove()); }
function peSweep(cv, orig, run) {
  const pg = $('#peCropPg'), main = $('#peCropCv'); peSweepEnd(); if (orig) { const o = $('#peOneOrig'); o.width = orig.width; o.height = orig.height; o.getContext('2d').drawImage(orig, 0, 0); }
  if (!pg.animate || reducedMotion()) { cv.id = 'peCropCv'; main.replaceWith(cv); return; }
  const layer = document.createElement('div'), edge = document.createElement('i'), ease = EASE_GLIDE, t = 520; layer.className = 'pe-reveal'; edge.className = 'pe-edge'; layer.appendChild(cv);
  const ref = $('#peOneOrig'); pg.insertBefore(layer, ref); pg.insertBefore(edge, ref);
  layer.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: t, easing: ease, fill: 'forwards' });
  edge.animate([{ transform: 'translateX(-100%)', opacity: 1 }, { opacity: 1, offset: .8 }, { transform: 'none', opacity: 0 }], { duration: t, easing: ease, fill: 'forwards' }).finished.then(() => {
    if (run !== PE.cropShowRun || !layer.isConnected) return; cv.id = 'peCropCv'; main.replaceWith(cv); layer.remove(); edge.remove();
  }, () => {});
}
/* the line between the original and the changed page glides in from the left edge as the page comes up, one motion with the loading shimmer */
function peWipeIn() {
  const to = PE.wipeTo || 0.5, from = 0, t0 = performance.now(), dur = reducedMotion() || PE.wipeShown ? 0 : 640; PE.wipeShown = true; if (!dur) { peWipeSet(to, false, true); return; }          // the line glides in the first time a large view opens; after that it is simply there
  const me = PE.wipeRun = (PE.wipeRun || 0) + 1, ease = x => 1 - Math.pow(1 - x, 3);
  const step = now => { if (me !== PE.wipeRun || PE.one == null) return; const x = Math.min(1, (now - t0) / dur); peWipeSet(from + (to - from) * ease(x), false, true); if (x < 1) requestAnimationFrame(step); else PE.wipe = to; };
  PE.wipe = to; peWipeSet(from, true, true); requestAnimationFrame(step);
}
async function peOneShow() {
  const d = PE.d, id = PE.one, sl = d.slots[id], me = ++PE.cropShowRun, pg = $('#peCropPg');
  const known = PE.asp && PE.asp.get(sl.src), pageKey = [id, sl.src, sl.skew || 0, sl.vskew || 0, sl.warp || 0, sl.bg || 0, sl.sp || 0, PE.mode === 'dim' ? '' : dimKey(sl), PE.mode !== 'crop' && sl.crop ? sl.crop.join(',') : '', S.pdf.gen || 0, PE.mode].join('|'), fresh = PE.shownKey !== pageKey;
  if (fresh) { peOneGhost(); peSweepEnd(); }
  peOneFit(peOneAsp(sl, known || S.pdf.aspect), fresh && !!PE.shownKey); if (fresh) { pg.classList.add('loading'); PE.wipeRun = (PE.wipeRun || 0) + 1; } else pg.classList.add('busy');
  const asp = await peAspectOf({ src: sl.src, rot: 0 }); if (me !== PE.cropShowRun || !PE.d) return;
  const [w, h] = peOneFit(peOneAsp(sl, asp), true) || [pg.offsetWidth, pg.offsetHeight], tilt = peTilted(sl), geo = slotGeo(sl, PE.mode === 'skew' ? null : PE.mode), k = Math.max(2, PE_ONE_PX / Math.max(w, h)), W2 = Math.round(w * k), H2 = Math.round(h * k);
  const put = (c, from) => { c.width = from.width; c.height = from.height; c.getContext('2d').drawImage(from, 0, 0); };
  let cv, o = null;
  if (PE.mode === 'clean') {
    const key = [sl.src, sl.skew || 0, sl.vskew || 0, sl.warp || 0, dimKey(sl), PE.mode !== 'crop' && sl.crop ? sl.crop.join(',') : '', S.pdf.gen || 0, W2].join('|');
    if (!PE.rawOne || PE.rawOne.key !== key) { const raw = await renderPdfPage(S.pdf.doc, sl.src, W2, H2, 0, null, geo); if (me !== PE.cropShowRun || !PE.d) return; put($('#peOneOrig'), raw); PE.rawOne = { key }; }
    const r = $('#peOneOrig'); cv = document.createElement('canvas'); cv.width = r.width; cv.height = r.height; cv.getContext('2d').drawImage(r, 0, 0);
    await pdfCleanCanvas(cv, PE.cl.bg, PE.cl.sp, [0, 0, cv.width, cv.height]);
  } else {
    cv = await renderPdfPage(S.pdf.doc, sl.src, W2, H2, 0, null, geo); o = PE.mode === 'skew' && tilt ? await renderPdfPage(S.pdf.doc, sl.src, W2, H2, 0, null, slotGeo(sl, 'skew')) : null;
  }
  if (me !== PE.cropShowRun || !PE.d) return;
  if (fresh && pg.getAnimations) { await Promise.all(pg.getAnimations().map(x => x.finished.catch(() => {}))); if (me !== PE.cropShowRun || !PE.d) return; }          // the box has reached the page's shape before its picture shows, so the picture is never squeezed into a shape on the way
  if (fresh) { put($('#peCropCv'), cv); if (o) put($('#peOneOrig'), o); } else peSweep(cv, o, me);
  PE.shownKey = pageKey; pg.classList.remove('loading', 'busy'); if (fresh) peWipeIn();
}
/* ---- zoom in the large view: buttons, + − 0, the wheel with Ctrl (or a pinch), two fingers, a double-click, and a drag to move the page once it is larger than the window ---- */
const PE_ZMAX = 4;
function peZoomClamp() {
  const z = PE.zm, st = $('#peCropStage'), pg = $('#peCropPg'), mx = Math.max(0, (pg.offsetWidth * z.z - st.clientWidth) / 2 + 60), my = Math.max(0, (pg.offsetHeight * z.z - st.clientHeight) / 2 + 60);
  z.x = clamp(z.x, -mx, mx); z.y = clamp(z.y, -my, my); if (z.z <= 1.001) { z.z = 1; z.x = 0; z.y = 0; }
}
function peZoomApply(smooth) {
  const z = PE.zm, pg = $('#peCropPg'); pg.style.transition = smooth && !reducedMotion() ? 'transform .34s cubic-bezier(.22,1,.36,1)' : 'none'; pg.style.setProperty('--z', z.z);
  pg.style.transform = z.z === 1 ? '' : 'translate(' + z.x.toFixed(1) + 'px,' + z.y.toFixed(1) + 'px) scale(' + z.z.toFixed(3) + ')'; pg.classList.toggle('zoomed', z.z > 1); $('#peCropStage').classList.toggle('zoomed', z.z > 1);
  $('#peZmOut').disabled = z.z <= 1; $('#peZmIn').disabled = z.z >= PE_ZMAX; $('#peZmFit').disabled = z.z <= 1; peWipeSet(PE.wipe || 0.5, smooth, true);
}
function peZoomAt(nz, cx, cy, smooth) {          // the point under (cx, cy) stays where it is
  const z = PE.zm, r = $('#peCropStage').getBoundingClientRect(); nz = clamp(nz, 1, PE_ZMAX);
  if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
  const ox = cx - (r.left + r.width / 2), oy = cy - (r.top + r.height / 2), px = (ox - z.x) / z.z, py = (oy - z.y) / z.z;
  z.x = ox - nz * px; z.y = oy - nz * py; z.z = nz; peZoomClamp(); peZoomApply(smooth);
}
function peZoomReset(smooth) { PE.zm = { z: 1, x: 0, y: 0 }; peZoomApply(smooth); }
function peZoomBind() {
  const st = $('#peCropStage'), ptr = new Map(); let pan = null, pinch = null;
  $('#peZmIn').addEventListener('click', () => peZoomAt(PE.zm.z * 1.6, null, null, true)); $('#peZmOut').addEventListener('click', () => peZoomAt(PE.zm.z / 1.6, null, null, true)); $('#peZmFit').addEventListener('click', () => peZoomReset(true));
  st.addEventListener('wheel', e => {
    if (PE.one == null) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); peZoomAt(PE.zm.z * Math.exp(-e.deltaY * 0.012), e.clientX, e.clientY, false); }
    else if (PE.zm.z > 1) { e.preventDefault(); PE.zm.x -= e.deltaX; PE.zm.y -= e.deltaY; peZoomClamp(); peZoomApply(false); }
  }, { passive: false });
  let gz = 1; st.addEventListener('gesturestart', e => { e.preventDefault(); gz = PE.zm.z; }); st.addEventListener('gesturechange', e => { e.preventDefault(); peZoomAt(gz * e.scale, e.clientX, e.clientY, false); });          // Safari's pinch
  st.addEventListener('dblclick', e => {
    if (PE.one == null || e.target.closest('#peWipe, .pe-glass, .pe-crop-box .h, #peDimLayer') || (PE.mode === 'crop' && peHandMode() && e.target.closest('#peCropBox'))) return;
    PE.zm.z > 1 ? peZoomReset(true) : peZoomAt(2.5, e.clientX, e.clientY, true);
  });
  st.addEventListener('pointerdown', e => {
    if (PE.one == null || e.target.closest('#peWipe, .pe-glass, #peCropBox [data-h], #peDimLayer')) return; ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: PE.zm.z }; pan = null; st.setPointerCapture(e.pointerId); }
    else if (PE.zm.z > 1 && e.button === 0) { pan = { x: e.clientX, y: e.clientY, ox: PE.zm.x, oy: PE.zm.y }; st.setPointerCapture(e.pointerId); st.classList.add('panning'); }
  });
  st.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptr.size >= 2) { const [a, b] = [...ptr.values()]; peZoomAt(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, false); }
    else if (pan) { PE.zm.x = pan.ox + e.clientX - pan.x; PE.zm.y = pan.oy + e.clientY - pan.y; peZoomClamp(); peZoomApply(false); }
  });
  const up = e => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; if (!ptr.size) { pan = null; st.classList.remove('panning'); } };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
}
function peOneRefresh() {
  const d = PE.d, ids = peTargets(), win = $('#peWin');
  if (PE.one != null && (!peOneMode() || !ids.length)) PE.one = null;
  if (PE.one != null && !ids.includes(PE.one)) PE.one = ids[0];
  const on = PE.one != null; win.classList.toggle('one', on); win.classList.toggle('hand', on && PE.mode === 'crop' && peHandMode());
  if (!on) { dimLarge(); win.classList.remove('wipe'); peSweepEnd(); PE.oneSig = ''; PE.zmFor = null; PE.shownKey = null; if (PE.zm && PE.zm.z !== 1) peZoomReset(false); return; }
  if (PE.zmFor !== PE.one) { PE.zmFor = PE.one; if (PE.zm.z !== 1) peZoomReset(false); }
  const sl = d.slots[PE.one], pos = ids.indexOf(PE.one) + 1, tilt = peTilted(sl), cmp = $('#peOneCmp');
  $('#peCropName').textContent = 'Page ' + pos + ' of ' + ids.length; $('#peCropPrev').disabled = pos <= 1; $('#peCropNext').disabled = pos >= ids.length;
  const cl = PE.mode === 'clean', can = cl ? !!(PE.cl.bg || PE.cl.sp) : tilt;
  cmp.disabled = !can; cmp.setAttribute('aria-pressed', String(can && PE.orig)); cmp.title = can ? '' : cl ? 'Nothing is chosen to clean' : 'This page has not been leveled';
  const showCmp = (PE.mode === 'skew' && tilt || cl && can), crop = PE.mode === 'crop';
  win.classList.toggle('wipe', showCmp && PE.orig); $('#peSideA').textContent = tx('pe.view.orig'); $('#peSideB').textContent = tx(cl ? 'pe.view.cleaned' : 'pe.view.leveled');
  PE.sides = { a: showCmp && PE.orig, b: showCmp };          // beside the line both say what is shown; with the original switched off, one label names the page you see
  const hint = crop ? '' : cl && !can ? tx('pe.view.noclean') : PE.mode === 'skew' && !tilt ? (PE.skewSeen.get(PE.one) === peSkewKey(sl) ? tx('pe.skew.none').replace(/\.$/, '') : tx('pe.view.notleveled')) : '', hb = $('#peOneHint');
  if (hint) hb.firstChild.textContent = hint; hb.classList.toggle('on', !!hint);
  const sig = [PE.mode, PE.one, sl.src, sl.skew || 0, sl.vskew || 0, sl.warp || 0, sl.bg || 0, sl.sp || 0, PE.mode === 'dim' ? '' : dimKey(sl), PE.mode !== 'crop' && sl.crop ? sl.crop.join(',') : '', S.pdf.gen || 0, cl ? PE.cl.bg + '' + PE.cl.sp : ''].join('|');
  if (sig !== PE.oneSig) { PE.oneSig = sig; peOneShow(); }
  peSideLayout(); peOneFrame(); dimLarge();
}
function peOneOpen(id) {
  PE.oneAuto = false;
  if (!peOneMode() || PE.busy || !peTargets().includes(id)) return;
  PE.one = id; PE.oneFrom = id; peState(); $('#peOneBack').focus({ preventScroll: true });
  const v = $('#peCropView'); if (v.animate && !reducedMotion()) v.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: PE_ONE_MS, easing: PE_ONE_EASE });
}
function peOneClose() {
  if (PE.one == null) return; const id = PE.one; PE.one = null; PE.oneAuto = false; peState();
  const c = $('#peGrid').querySelector('.page-card[data-id="' + id + '"]'), w = $('#peWrap'); if (c) { c.scrollIntoView({ block: 'nearest' }); c.focus({ preventScroll: true }); }
  if (w.animate && !reducedMotion()) w.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PE_ONE_MS, easing: PE_ONE_EASE });
}
function peOneStep(dir) {
  const ids = peTargets(), j = ids.indexOf(PE.one) + dir; if (PE.one == null || j < 0 || j >= ids.length) return;
  PE.one = ids[j]; peOneRefresh();
}
function peWipeSet(v, smooth, glide) {          // glide: the line is being moved by the opening glide, so where it will rest (PE.wipeTo) is left as it was
  const pg = $('#peCropPg'), m = clamp((15 / ((PE.zm && PE.zm.z) || 1)) / Math.max(1, pg.offsetWidth), 0.01, 0.2);          // the line's knob always stays on the page
  v = clamp(v, m, 1 - m); PE.wipe = v; if (!glide) PE.wipeTo = v; pg.style.setProperty('--wp', v); $('#peWipe').setAttribute('aria-valuenow', String(Math.round(v * 100))); peSideLayout(smooth);
}
/* The Original / Cleaned labels and the line's knob follow what is in view, not the page's corners: zoomed or moved, each label stays at the edge of its side
   (a side with no room fades out, because then the other one is all you see), and the knob stays level with the middle of the window */
const PE_SIDE_W = {};
function peSideLayout(smooth) {
  if (PE.one == null) return;
  const st = $('#peCropStage'), pg = $('#peCropPg'), z = PE.zm || { z: 1, x: 0, y: 0 }, sw = st.clientWidth, sh = st.clientHeight, pw = pg.offsetWidth, ph = pg.offsetHeight; if (!pw) return;
  const L = sw / 2 + z.x - pw * z.z / 2, T = sh / 2 + z.y - ph * z.z / 2, R = L + pw * z.z, B = T + ph * z.z, vl = Math.max(L, 0), vr = Math.min(R, sw), vt = Math.max(T, 0), vb = Math.min(B, sh);
  pg.style.setProperty('--ky', clamp(((vt + vb) / 2 - T) / z.z, 14, Math.max(14, ph - 14)) + 'px'); pg.style.setProperty('--kt', smooth && !reducedMotion() ? '.34s' : '0s');
  const sd = PE.sides || { a: false, b: false }, line = clamp(L + (PE.wipe || 0.5) * pw * z.z, vl, vr), y = Math.max(vt, 0) + 8;
  const put = (el, on, x) => { const t = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; if (el.style.transform !== t) { el.style.transition = smooth && !reducedMotion() ? 'opacity .25s var(--ease-ui),transform .34s cubic-bezier(.22,1,.36,1)' : 'opacity .25s var(--ease-ui)'; el.style.transform = t; } el.classList.toggle('on', on); };
  const a = $('#peSideA'), b = $('#peSideB'), wa = PE_SIDE_W[a.textContent] || (PE_SIDE_W[a.textContent] = a.offsetWidth), wb = PE_SIDE_W[b.textContent] || (PE_SIDE_W[b.textContent] = b.offsetWidth);
  const wipe = $('#peWin').classList.contains('wipe'), ax = Math.max(vl + 8, y < 52 ? 56 : 0), okA = sd.a && (!wipe || line - ax >= wa + 10), bx = vr - 8 - wb, okB = sd.b && (!wipe || bx - line >= 10);
  put(a, okA, ax); put(b, okB, bx);
}
/* when a page is leveled (or put back) its music moves a little on the page: a crop it already has is moved by the same amount and keeps its size */
async function peFollow(sl, to) {
  if (!sl.crop || sl.half) return null;
  const a = await peRawBox(sl), b = await peRawBox(Object.assign({}, sl, to)); if (!a || !b) return null;
  const c = sl.crop, w = c[2] - c[0], h = c[3] - c[1], x = clamp(c[0] + (b[0] + b[2] - a[0] - a[2]) / 2, 0, 1 - w), y = clamp(c[1] + (b[1] + b[3] - a[1] - a[3]) / 2, 0, 1 - h);
  return peRound([x, y, x + w, y + h]);
}
/* Manual: drag the frame or its handles; the first drag starts from the frame that was found */
const PE_MIN = 0.06;
function peCropBind() {
  const box = $('#peCropBox'); let drag = null;
  box.addEventListener('pointerdown', e => {
    const h = e.target.dataset.h; if (!h || !peHandMode() || !peBoxNow) return; e.preventDefault(); box.setPointerCapture(e.pointerId);
    const sl = PE.d.slots[PE.one], lim = sl.half && sl.crop ? sl.crop : [0, 0, 1, 1];
    drag = { h, x: e.clientX, y: e.clientY, c: peBoxNow.slice(), r: $('#peCropPg').getBoundingClientRect(), lim }; box.classList.add('dragging');
  });
  box.addEventListener('pointermove', e => {
    if (!drag) return; const dx = (e.clientX - drag.x) / drag.r.width, dy = (e.clientY - drag.y) / drag.r.height, c = drag.c.slice(), h = drag.h, L = drag.lim;
    if (h === 'move') { const w = c[2] - c[0], hh = c[3] - c[1], x = clamp(c[0] + dx, L[0], L[2] - w), y = clamp(c[1] + dy, L[1], L[3] - hh); c[0] = x; c[2] = x + w; c[1] = y; c[3] = y + hh; }
    else { if (h.includes('w')) c[0] = clamp(c[0] + dx, L[0], c[2] - PE_MIN); if (h.includes('e')) c[2] = clamp(c[2] + dx, c[0] + PE_MIN, L[2]); if (h.includes('n')) c[1] = clamp(c[1] + dy, L[1], c[3] - PE_MIN); if (h.includes('s')) c[3] = clamp(c[3] + dy, c[1] + PE_MIN, L[3]); }
    peHandSet(PE.one, c); peCropPaint(c);
  });
  const end = () => { if (drag) peCropPaintAll(); drag = null; box.classList.remove('dragging'); peActs(); }; box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  document.querySelectorAll('input[name=peCropMode]').forEach(r => r.addEventListener('change', e => { PE.cropMode = e.target.value; peCropTicks(); if (peHandMode() && PE.one == null) { const t = peTargets(); if (t.length) { PE.one = t[0]; PE.oneAuto = true; } } else if (!peHandMode() && PE.oneAuto && PE.one != null) PE.one = null; if (!peHandMode()) PE.oneAuto = false; peState(); if (PE.cropReading && PE.cropOn) peCropReadSay(PE.cropPc); }));          // Manual opens one page to draw on; Auto takes you back to all the pages, unless you opened that page yourself
  $('#peDimClear').addEventListener('click', peDimClear);
  $('#peCropAuto').addEventListener('click', peCropGo); $('#peCropClear').addEventListener('click', peCropClear);
  $('#peCropPad').addEventListener('input', e => { $('#peCropPadVal').textContent = e.target.value + '%'; paintRange(e.target); peCropPaintAll(); peOneFrame(); peActs(); });
  $('#peCropApply').addEventListener('click', peCropApply); $('#peCropSame').addEventListener('change', () => { peCropPaintAll(); peOneFrame(); peActs(); }); $('#peCropPrev').addEventListener('click', () => peOneStep(-1)); $('#peCropNext').addEventListener('click', () => peOneStep(1));
  $('#peOneBack').addEventListener('click', peOneClose); $('#peOneCmp').addEventListener('click', () => { PE.orig = !PE.orig; peOneRefresh(); });
  { const wp = $('#peWipe'); let on = false;          // the line between the original and the leveled page
    wp.addEventListener('pointerdown', e => { e.preventDefault(); PE.wipeRun = (PE.wipeRun || 0) + 1; wp.setPointerCapture(e.pointerId); on = true; });
    wp.addEventListener('pointermove', e => { if (!on) return; const r = $('#peCropPg').getBoundingClientRect(); peWipeSet((e.clientX - r.left) / r.width); });
    const up = () => { on = false; }; wp.addEventListener('pointerup', up); wp.addEventListener('pointercancel', up);
    wp.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); e.stopPropagation(); peWipeSet((PE.wipe || 0.5) + (e.key === 'ArrowLeft' ? -0.05 : 0.05)); }); }
  /* Add pages: choose, place, add */
  const kind = () => (document.querySelector('input[name=peAddKind]:checked') || {}).value || 'blank';
  document.querySelectorAll('input[name=peAddKind]').forEach(r => r.addEventListener('change', () => swapText($('#peAddGo'), kind() === 'pdf' ? 'Choose PDF…' : 'Add page', true)));
  $('#peAddGo').addEventListener('click', () => { if (kind() === 'pdf') $('#peAddIn').click(); else peAdd('blank'); });
  $('#peAddIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) peAdd('pdf', f); });
  peCleanBind(); peZoomBind(); $('#peSplitGo').addEventListener('click', peSplitGo); $('#peSkewGo').addEventListener('click', peSkewGo); $('#peSkewClear').addEventListener('click', peSkewClear);
}
/* which pages look like two pages side by side (wider than tall); a cropped page counts by the part that is kept */
async function peAspectOf(sl) {
  PE.asp = PE.asp || new Map(); let a = PE.asp.get(sl.src);
  if (a == null) { const pg = await S.pdf.doc.getPage(sl.src + 1), v = pg.getViewport({ scale: 1, rotation: pg.rotate || 0 }); a = v.width / v.height; PE.asp.set(sl.src, a); }
  return (sl.rot || 0) % 180 ? 1 / a : a;
}
/* ---- Split spreads: spreads found on their own are ticked; any other page can be ticked too ---- */
async function peSplitGo() {
  const d = PE.d, ids = peSplitIds(); if (!ids.length) return;
  const res = new Map();
  const ok = await peEach(ids, '#peSplitGo', async id => {
    const sl = d.slots[id], c = sl.crop || [0, 0, 1, 1], g = peGutter(await peScanOf(sl), c);
    res.set(id, [peRound([c[0], c[1], g, c[3]]), peRound([g, c[1], c[2], c[3]])]);
  });
  if (!ok) return;
  pePush();
  ids.forEach(id => { const sl = d.slots[id], [L, R] = res.get(id), ni = d.slots.length; d.slots.push({ src: sl.src, rot: sl.rot || 0, x: false, c: false, nw: !!sl.nw, crop: R, dim: dimKey(sl) ? sl.dim.map(b => b.slice()) : null, skew: sl.skew || 0, vskew: sl.vskew || 0, warp: sl.warp || 0, bg: sl.bg || 0, sp: sl.sp || 0, half: 'R' }); sl.crop = L; sl.half = 'L'; d.order.splice(d.order.indexOf(id) + 1, 0, ni); PE.splitSel.delete(id); });
  PE.rustle = true; peRender(true); peSay('#peSplitStatus', '');
}
/* ---- Clean: the choices are written onto the ticked pages; the pages are drawn cleaned from then on, and the export draws them cleaned from the original scan ---- */
function peCleanGo() {
  const d = PE.d, ids = peTargets(), cl = PE.cl; if (!ids.length || (!cl.bg && !cl.sp)) return;
  pePush(); ids.forEach(id => { d.slots[id].bg = cl.bg; d.slots[id].sp = cl.sp; }); PE.rustle = true; peRender(true); peSay('#peCleanStatus', tx('pe.clean.done', { pages: peN(ids.length), n: ids.length }));
}
function peCleanClear() {
  const d = PE.d, ids = peTargets().filter(id => peCleaned(d.slots[id])); if (!ids.length) return;
  pePush(); ids.forEach(id => { d.slots[id].bg = 0; d.slots[id].sp = 0; }); PE.rustle = true; peRender(true); peSay('#peCleanStatus', tx('pe.clean.revert'));
}
function peCleanBind() {
  [['peClBg', 'bg'], ['peClSp', 'sp']].forEach(([name, key]) => document.querySelectorAll('input[name=' + name + ']').forEach(r => {
    r.closest('label').addEventListener('pointerdown', () => { r._was = r.checked; });          // pressing the chosen one again takes the choice away
    r.addEventListener('click', () => { if (r._was) { r.checked = false; PE.cl[key] = 0; } else PE.cl[key] = +r.value; r._was = false; peActs(); if (PE.one != null) peOneRefresh(); });
    r.addEventListener('keydown', e => { if (e.key === ' ' && r.checked) { e.preventDefault(); r.checked = false; PE.cl[key] = 0; peActs(); if (PE.one != null) peOneRefresh(); } });
  }));
  $('#peCleanGo').addEventListener('click', peCleanGo); $('#peCleanClear').addEventListener('click', peCleanClear);
}
/* ---- Re-kilter: levels the turn, the slant and the bend of each ticked page ---- */
/* Re-kilter remembers the pages it has looked at (leveled, or found level) as they stand now, so its button greys out when there is nothing left for it to do */
const peSkewKey = sl => sl.src + '|' + (sl.skew || 0) + '|' + (sl.vskew || 0) + '|' + (sl.warp || 0) + '|' + (S.pdf.gen || 0);
PE.skewSeen = new Map();
async function peSkewGo() {
  const d = PE.d, ids = peTargets(); if (!ids.length) return;
  const res = new Map();
  const ok = await peEach(ids, '#peSkewGo', async id => { const sc = await peScan(d.slots[id].src, 760, null), reg = peInkBox(sc, 0.01), f = peFit(sc, reg), lvl = f.gain < 0.02 || (Math.abs(f.a) < 0.15 && Math.abs(f.k) < 0.004), a = lvl ? 0 : f.a, k = lvl ? 0 : (Math.abs(f.k) < 0.004 ? 0 : f.k), l = peLean(sc, a, reg), v = Math.abs(a - l.deg) < 0.1 ? 0 : -(l.deg - a), sl = d.slots[id], same = sl.skew === -a && sl.vskew === v && sl.warp === k; res.set(id, [-a, v, k, same ? null : await peFollow(sl, { skew: -a, vskew: v, warp: k })]); });
  if (!ok) return;
  if (!ids.some(id => { const [v, lv, wk, crop] = res.get(id), sl = d.slots[id]; return v !== (sl.skew || 0) || lv !== (sl.vskew || 0) || wk !== (sl.warp || 0) || (crop && String(crop) !== String(sl.crop || '')); })) { ids.forEach(id => PE.skewSeen.set(id, peSkewKey(d.slots[id]))); peSay('#peSkewStatus', tx('pe.skew.none')); peActs(); return; }          // nothing to level, so no step is added
  pePush(); let n = 0; ids.forEach(id => { const [v, lv, wk, crop] = res.get(id), sl = d.slots[id]; sl.skew = v; sl.vskew = lv; sl.warp = wk; if (crop) sl.crop = crop; if (v || lv || wk) n++; });
  ids.forEach(id => PE.skewSeen.set(id, peSkewKey(d.slots[id]))); PE.rustle = true; peRender(true); peSay('#peSkewStatus', n ? tx(n === 1 ? 'pe.skew.one' : 'pe.skew.many', { n }) : tx('pe.skew.none'));
}
async function peSkewClear() {
  const d = PE.d, ids = peTargets().filter(id => peTilted(d.slots[id])), flat = { skew: 0, vskew: 0, warp: 0 }, res = new Map(); if (!ids.length) return;
  if (ids.some(id => d.slots[id].crop && !d.slots[id].half) && !await peEach(ids, '#peSkewClear', async id => { res.set(id, await peFollow(d.slots[id], flat)); })) return;
  pePush(); ids.forEach(id => { const sl = d.slots[id]; Object.assign(sl, flat); if (res.get(id)) sl.crop = res.get(id); }); PE.rustle = true; peRender(true); peSay('#peSkewStatus', tx('pe.skew.revert'));
}
/* Watermark: tick the pages that get it, then press Watermark. Once it is on, the ticks and the settings change the pages at once. Changing a setting before it is added adds it to the ticked pages */
function peWmSet(on) {
  const d = PE.d, w = d.wm, sel = PE.wmSel; w.on = !!on; d.order.forEach(id => { d.slots[id].nw = on ? !!sel && !sel.has(id) : false; }); if (!on) PE.wmSel = null;
  if (on) { PE.wmSel = null; if (!(w.text || '').trim()) w.text = WM_DEFAULT.text; }
}
function peWmTouch() {
  if (PE.d.wm.on) { peRepaint(); peState(); return; }
  if (!PE.d.order.some(id => !PE.d.slots[id].x && peWmSel(id))) { peState(); return; }          // no page ticked: nothing to add it to
  peWmSet(true); peRender(false); edSay('pe', 'wm');
}
function closePdfEditor(keep) { if (PE.exporting) PE.expStop = true; PE_HIST.open(false); peAddSettle(!!keep); edLeadStop('pe'); peDragEnd(true); sheetHide($('#pdfDlg')); PE.d = null; }
function peApply() {
  const d = PE.d; if (d.wm.on && !d.order.some(id => !d.slots[id].x && !d.slots[id].nw)) peWmSet(false);          // a watermark on no pages is no watermark
  closePdfEditor(true);
  if (!S.pdf || recipeSig(d) === recipeSig(recipeOf())) return;
  const was = Transport.playing, at = Transport.now();          // if the video was playing, it carries on from the same moment
  Transport.pause();
  pushHistory(); const base = S.history.length;                  // one step in the main Undo: the pages, and the turns as they were
  setRecipe(d); S.time = was ? clamp(at, S.vStart, vEnd()) : S.vStart; rebuildSpreads(false);
  if (S.history.length > base) S.history.length = base;
  setChips(); updateTimeUI(true); TL.staticDirty = true; stageDirty = true;
  toast(tx('pdf.invideo', { pages: peN(S.pdf.keep.length), spreads: spreadsText() }));
  if (was) Transport.play();
}
const peSvg = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/></svg>',
  rot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
  dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  wm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/><path d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"/><path d="M5 22h14"/></svg>'
};
/* the cards still waiting share one sweep: each card's band is the grid's band as seen from where the card sits, and every card starts on the same clock */
const PE_SWEEP_MS = 2600;
function peLoadOn(card) {
  card.classList.add('loading'); card.classList.remove('sheen-out');
  card.querySelector('.pe-sheen').style.setProperty('--sd', ((document.timeline.currentTime % PE_SWEEP_MS) - PE_SWEEP_MS) + 'ms');
}
function peSheenSync() {
  const grid = $('#peGrid'); if (!grid || !grid.clientWidth) return;
  const gw = grid.clientWidth, band = clamp(Math.round(gw * 0.2), 120, 320), left = el => { let x = 0; for (let n = el; n && n !== grid; n = n.offsetParent) x += n.offsetLeft; return x; };
  grid.querySelectorAll('.page-card.loading .pe-sheen').forEach(sh => { const x = left(sh); sh.style.setProperty('--sb', band + 'px'); sh.style.setProperty('--s0', (-band - x) + 'px'); sh.style.setProperty('--s1', (gw - x) + 'px'); });
}
function peThumbReady(src) {
  if (!PE.d || $('#pdfDlg').hidden) return;
  document.querySelectorAll('#peGrid .page-card').forEach(c => { if (+c.dataset.src === src) { const sl = PE.d.slots[+c.dataset.id]; if (sl) peDrawCard(c, sl); if (c.classList.contains('loading')) { c.classList.add('sheen-out'); c.classList.remove('loading'); setTimeout(() => c.classList.remove('sheen-out'), 450); } } });
  if (PE.adding && !PE.busy && !document.querySelector('#peGrid .page-card.loading')) { PE.adding = false; if ($('#peAddStatus').textContent === 'Adding pages…') peSay('#peAddStatus', ''); }          // the line goes once the last new picture is in
}
/* a card's picture comes from the page's thumbnail, turned to match; drawn at twice its size on screen so it stays crisp */
const PE_CH = 280;
const peCardSize = sl => { const w = Math.round(PE_CH * peAspect()); return (sl.rot || 0) % 180 ? [PE_CH, w] : [w, PE_CH]; };          // a page turned a quarter takes its own wide shape
function peDrawCard(card, sl, frame) {
  const cv = card.querySelector('canvas'), rot = sl.rot || 0, side = rot % 180 !== 0, sz = peCardSize(sl);
  cv.style.aspectRatio = sz[0] + ' / ' + sz[1];          // the card keeps its shape while its picture is freed
  if (card._far) { if (cv.width !== 1 || cv.height !== 1) { cv.width = 1; cv.height = 1; } return; }          // far off screen: a long score keeps pictures only for the cards near the view
  if (cv.width !== sz[0] || cv.height !== sz[1]) { cv.width = sz[0]; cv.height = sz[1]; }
  const x = cv.getContext('2d'), w = cv.width, h = cv.height;
  if (PE.mode === 'crop' && !sl.x && !(sl.crop && !sl.half)) {          // in Crop: an uncropped page shows whole, with the frame it will get and the rest dimmed; a cropped page shows its result
    const t = peFullThumb(sl), id = +card.dataset.id; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); if (!t) return; x.imageSmoothingQuality = 'high';
    if (frame === undefined) frame = peCropOn(id) ? peCropBox(id) : null;
    const k = Math.min(w / (side ? t.height : t.width), h / (side ? t.width : t.height)), tw = t.width * k, th = t.height * k, b = frame && frame.box;
    x.save(); x.translate(w / 2, h / 2); x.rotate(rot * Math.PI / 180); x.drawImage(t, -tw / 2, -th / 2, tw, th);
    if (b) { const fx = -tw / 2 + b[0] * tw, fy = -th / 2 + b[1] * th, fw = (b[2] - b[0]) * tw, fh = (b[3] - b[1]) * th;
      x.fillStyle = 'rgba(10,14,30,.42)'; x.fillRect(-tw / 2, -th / 2, tw, fy + th / 2); x.fillRect(-tw / 2, fy + fh, tw, th / 2 - fy - fh); x.fillRect(-tw / 2, fy, fx + tw / 2, fh); x.fillRect(fx + fw, fy, tw / 2 - fx - fw, fh);
      x.strokeStyle = PE.accent || '#2f6df6'; x.lineWidth = 3; if (frame.shared) x.setLineDash([9, 6]); x.strokeRect(fx, fy, fw, fh); }          // a dashed frame is borrowed: the page has no music of its own
    x.restore(); return;
  }
  const t = slotBase(PE.mode === 'dim' && dimKey(sl) ? Object.assign({}, sl, { dim: null }) : sl, peAspect());          // in Dim the boxes are live on top, so the picture under them is drawn without the dimming
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); if (!t) return; x.imageSmoothingQuality = 'high';
  const W = side ? h : w, H = side ? w : h, ta = t.width / t.height, fw = Math.min(W, H * ta), fh = fw / ta;                // the picture is fitted into the card, whatever shape the page was drawn at
  x.save(); x.translate(w / 2, h / 2); x.rotate(rot * Math.PI / 180); x.drawImage(t, -fw / 2, -fh / 2, fw, fh); x.restore();
  const wm = PE.d && PE.d.wm;
  if (wm && wm.on && !sl.nw) drawWatermark(x, wm, 0, 0, w, h);
}
const peRepaint = () => document.querySelectorAll('#peGrid .page-card').forEach(c => { const sl = PE.d.slots[+c.dataset.id]; if (sl) peDrawCard(c, sl); });
function peCard(id, sl) {
  const [w, ch] = peCardSize(sl), el = document.createElement('div');
  el.className = 'page-card'; el.dataset.id = id; el.dataset.src = sl.src; el.tabIndex = 0; el.setAttribute('role', 'listitem');
  el.innerHTML = '<span class="pe-thumb"><canvas width="' + w + '" height="' + ch + '"></canvas><i class="pe-sheen" aria-hidden="true"></i><span class="tick" aria-hidden="true">' + checkIcon + '</span><span class="pe-hid" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.6"/><path d="M6.6 6.6C3.6 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 0 1-4.2-4.2"/><path d="m2 2 20 20"/></svg></span><span class="pe-lvl" aria-hidden="true">Leveled</span>'
    + '<span class="pe-tools"><button type="button" data-act="open" aria-label="Open page" title="Open page">' + peSvg.open + '</button><button type="button" data-act="rot" aria-label="Rotate page" title="Rotate (R)">' + peSvg.rot + '</button><button type="button" data-act="dup" aria-label="Repeat page" title="Repeat (D)">' + peSvg.dup + '</button>'
    + (sl.c ? '<button type="button" data-act="del" aria-label="Remove this repeat" title="Remove repeat">' + peSvg.del + '</button>' : '') + '</span></span>'
    + '<span class="pe-foot"><span class="pe-pos"></span><span class="num">p. ' + (sl.src + 1) + (sl.c ? ' · repeat' : '') + '</span></span>';
  el._far = PE.nearN >= 24; PE.nearN++;          // the first screenful is drawn at once; the rest wait until the view comes near (peFarWatch)
  peDrawCard(el, sl); if (!S.thumbs[sl.src]) peLoadOn(el); if (PE.mode === 'dim') dimMount(el.querySelector('.pe-thumb'), id); return el;          // no picture yet: the card shimmers until its thumbnail arrives
}
/* the cards are built from the draft; when `anim` is set, cards that moved glide to their new places and new ones rise in (FLIP) */
/* a card draws its picture only while it is within a screen or so of the view; scrolling away frees the picture (the canvas shrinks to a pixel, the shape stays), so a 200-page score never holds 200 full pictures */
function peFarWatch() {
  if (PE.io) PE.io.disconnect();
  if (!window.IntersectionObserver) { document.querySelectorAll('#peGrid .page-card').forEach(c => { c._far = false; }); peRepaint(); return; }
  PE.io = new IntersectionObserver(es => es.forEach(e => { const c = e.target, far = !e.isIntersecting; if (c._far === far) return; c._far = far; const sl = PE.d && PE.d.slots[+c.dataset.id]; if (sl) peDrawCard(c, sl); }), { root: $('#peWrap'), rootMargin: '700px 0px' });
  document.querySelectorAll('#peGrid .page-card').forEach(c => PE.io.observe(c));
}
function peRender(anim) {
  const grid = $('#peGrid'), d = PE.d, old = new Map();
  const oldI = new Map(); let oi = 0;
  if (anim) Array.from(grid.children).forEach(c => { old.set(+c.dataset.id, c.getBoundingClientRect()); oldI.set(+c.dataset.id, oi++); });
  PE.nearN = 0; const frag = document.createDocumentFragment(); d.order.forEach(id => frag.appendChild(peCard(id, d.slots[id])));
  grid.textContent = ''; grid.appendChild(frag); peFarWatch();
  PE.dir = new Map();          // which way each card moved, so its number slides the same way
  if (anim) { let ni = 0; Array.from(grid.children).forEach(c => { const id = +c.dataset.id, was = old.get(id); if (was) { const now = c.getBoundingClientRect(); PE.dir.set(id, peNumDir(now.left - was.left, now.top - was.top, oldI.get(id), ni)); } ni++; }); }
  PE.roll = !!anim; peState(); peSheenSync();
  if (anim && !reducedMotion()) {
    Array.from(grid.children).forEach(c => {
      const was = old.get(+c.dataset.id), now = c.getBoundingClientRect();
      if (!was) c.animate([{ opacity: 0, transform: 'scale(.82)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE_OUT });
      else if (Math.abs(was.left - now.left) > 1 || Math.abs(was.top - now.top) > 1) c.animate([{ transform: 'translate(' + (was.left - now.left) + 'px,' + (was.top - now.top) + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
    });
  }
  if (PE.rustle) { PE.rustle = false; peRustle(grid); }
  if (PE.focusId != null) { const f = grid.querySelector('.page-card[data-id="' + PE.focusId + '"]'); if (f) f.focus({ preventScroll: false }); PE.focusId = null; }
}
/* everything that is only a state (ticks, numbers, counts, buttons) is set on the cards already there, so ticking a page never rebuilds the grid */
/* the number under a card rolls to its new place (old one out, new one in) in step with the card's glide; the "p. 3" tag eases in or out when it starts or stops matching */
PE.posWas = new Map(); PE.roll = false; PE.dir = new Map();
// which way a card's number slides: along the card's own sideways move when that move is clearly sideways,
// otherwise by its place in reading order (later place = right, earlier place = left)
function peNumDir(dx, dy, fromI, toI) {
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4) return dx > 0 ? 1 : -1;
  return toI > fromI ? 1 : -1;
}
/* a sliding number: the old digit slides out and the new one slides in behind it, the way its card is moving (a card that moves right sends its number right).
   The two digits sit side by side in a strip two digits wide, and the pill clips it, so the pill keeps its colour and round ends. About 340ms on the card's curve,
   with a small detent at the end, so the digit clicks into place rather than stopping dead. */
function peNumSlideEnd(p, text) {
  if (p._slide) p._slide.cancel(); p._slide = null;
  p.classList.remove('slide'); p.style.removeProperty('--slide-w'); p.textContent = text;
}
function peNumSlide(p, from, to, delay, dir, w) {
  const cell = t => { const s = document.createElement('span'); s.className = 'pe-cell'; s.textContent = t; return s; };
  const strip = document.createElement('span'); strip.className = 'pe-strip';
  strip.append(...(dir > 0 ? [cell(to), cell(from)] : [cell(from), cell(to)]));          // a card moving right sends its number right, so the new digit comes in from the left
  p.textContent = ''; p.style.setProperty('--slide-w', w + 'px'); p.classList.add('slide'); p.append(strip);
  const ease = 'cubic-bezier(.32,.72,0,1)';          // the card's own curve, so the digit travels with the card
  const keys = dir > 0 ? ['translateX(-50%)', 'translateX(1px)', 'translateX(0)'] : ['translateX(0)', 'translateX(calc(-50% - 1px))', 'translateX(-50%)'];
  const S = strip.animate(keys.map((transform, i) => ({ transform, offset: [0, .84, 1][i], easing: i ? 'ease-out' : ease })), { duration: 340, delay, fill: 'both' });
  p._slide = S; S.onfinish = () => peNumSlideEnd(p, String(to));
}
function peRoll(p, nm, was, pos, same, delay = 0, dir = -1, w = 0) {
  if (pos !== was.pos) {
    if (p._slide) peNumSlideEnd(p, String(was.pos));          // a slide still running lands first, so a quick second move starts from the number on the card
    if (pos && was.pos) peNumSlide(p, was.pos, pos, delay, dir, w);
    else if (pos) p.animate([{ opacity: 0, transform: 'scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay, easing: EASE_OUT, fill: 'backwards' });
  }
  if (same !== was.same) nm.animate(same ? [{ opacity: 1, maxWidth: '80px' }, { opacity: 0, maxWidth: '0px' }] : [{ opacity: 0, maxWidth: '0px' }, { opacity: 1, maxWidth: '80px' }], { duration: 560, easing: 'cubic-bezier(.45,.05,.2,1)' });
}
function peState() {
  const roll = PE.roll && !reducedMotion(); PE.roll = false;
  const d = PE.d, grid = $('#peGrid'), m = PE.mode, tm = peTickMode(), w = d.wm; let pos = 0, pool = 0, on = 0;
  const rolls = [];          // the numbers that change, in reading order (left to right, top to bottom), so the flips run that way too
  grid.classList.toggle('ticks', m === 'pages' || tm); grid.classList.toggle('arrange', m === 'pages'); grid.classList.toggle('opens', peOneMode());
  if (m !== 'crop') grid.querySelectorAll('.shared').forEach(c => c.classList.remove('shared')); else PE.accent = getComputedStyle(grid).getPropertyValue('--accent').trim();
  Array.from(grid.children).forEach(c => {
    const sl = d.slots[+c.dataset.id]; if (!sl) return; if (!sl.x) pos++;
    const na = tm && (sl.x || (m === 'split' && !!sl.half)), yes = m === 'pages' || !tm ? !sl.x : !na && peTicked(+c.dataset.id);
    if (m === 'pages' || (tm && !na)) { pool++; if (yes) on++; }
    c.classList.toggle('off', !yes); c.classList.toggle('na', na); c.classList.toggle('cropped', m === 'crop' && !!sl.crop && !sl.half); c.classList.toggle('hid', !!sl.x); c.classList.toggle('lvl', m === 'dim' ? !!dimKey(sl) : m === 'clean' ? peCleaned(sl) : !!(sl.skew || sl.vskew || sl.warp)); { const lv = c.querySelector('.pe-lvl'); lv.textContent = m === 'crop' ? (c.classList.contains('cropped') ? 'Cropped' : 'Shared') : m === 'dim' ? 'Dimmed' : m === 'clean' ? 'Cleaned' : 'Leveled'; if (m === 'crop' && !c.classList.contains('cropped')) lv.title = 'No music on this page, so it takes the same frame as the other pages'; else lv.removeAttribute('title'); } c.setAttribute('aria-pressed', String(yes));
    if (na) c.setAttribute('aria-disabled', 'true'); else c.removeAttribute('aria-disabled');
    const p = c.querySelector('.pe-pos'), nm = c.querySelector('.num'), same = !sl.c && !sl.x && sl.src + 1 === pos, was = PE.posWas.get(+c.dataset.id), np = sl.x ? 0 : pos;
    if (!p._slide && !(roll && was && np !== was.pos)) p.textContent = np || '';          // a number that is about to slide keeps its old digit until its turn
    nm.classList.toggle('same', same); PE.posWas.set(+c.dataset.id, { pos: np, same });
    if (roll && was) rolls.push([p, nm, was, np, same, PE.dir.get(+c.dataset.id)]);
    c.setAttribute('aria-label', 'Page ' + (sl.src + 1) + (sl.c ? ' (repeat)' : '') + (sl.x ? ', left out' : ', position ' + pos) + (tm && !na ? (yes ? ', selected' : ', not selected') : ''));
  });
  const padW = 12;   // the pill's padding is 6px on each side (style.css, .pe-pos); keep in step with it
  const oldW = new Map(rolls.map(r => [r[0], r[0].offsetWidth]));          // one layout: every pill's current width
  const texts = [...new Set(rolls.map(r => String(r[3])))];
  const probes = texts.map(t => { const s = document.createElement('span'); s.className = 'pe-pos pe-measure'; s.textContent = t; grid.append(s); return s; });
  const newW = new Map(texts.map((t, i) => [t, probes[i].offsetWidth]));     // one more layout, after every probe is in
  probes.forEach(s => s.remove());
  const moving = rolls.filter(r => r[3] !== r[2].pos), at = new Map(moving.map((r, i) => [r[0], i]));          // only the numbers that really change take a turn
  const gap = Math.min(80, 600 / Math.max(1, moving.length - 1));          // 80ms apart for a few numbers; for many, the last one starts by 600ms
  rolls.forEach(([p, nm, was, np, same, dir]) => peRoll(p, nm, was, np, same, (at.get(p) || 0) * gap, dir || -1, Math.max(oldW.get(p), newW.get(String(np)) + padW)));          // one number at a time, in reading order (left to right, top to bottom), so the eye can follow each one
  PE.dir = new Map();          // used once, so a later move without a set direction never reuses this one
  const cnt = $('#peCount'); cnt.classList.remove('warn');
  if (pdfWhy()) { swapText(cnt, pdfWhy(), true); cnt.classList.add('warn'); }
  else swapText(cnt, m === 'dim' ? d.order.filter(id => dimKey(d.slots[id])).length + ' / ' + d.order.filter(id => !d.slots[id].x).length + ' pages dimmed' : m === 'pages' ? on + ' / ' + pool + ' pages active' : on + ' / ' + pool + ' selected', true);
  $('#peAll').hidden = $('#peNone').hidden = m === 'dim'; $('#peAll').disabled = !!PE.busy || on === pool; $('#peNone').disabled = !!PE.busy || (m === 'pages' ? on <= 1 : on === 0);
  peChrome(); rzRefresh();
  if (document.activeElement !== $('#peWmText')) $('#peWmText').value = w.text;
  $('#peWmB').setAttribute('aria-pressed', String(w.b !== false)); $('#peWmI').setAttribute('aria-pressed', String(!!w.i));
  const preset = w.angle === 45 ? '45' : w.angle === 0 ? '0' : 'custom';
  document.querySelectorAll('input[name=peWmAngle]').forEach(r => { r.checked = r.value === preset; }); document.querySelectorAll('input[name=peWmMode]').forEach(r => { r.checked = r.value === w.mode; });
  $('.pe-deg').classList.toggle('shown', preset === 'custom'); if (document.activeElement !== $('#peWmDeg')) $('#peWmDeg').value = w.angle;
  $('#peWmOpacity').value = w.opacity; $('#peWmOpacityVal').textContent = w.opacity + '%'; paintRange($('#peWmOpacity'));
  { const eb = $('#peExport'); eb.disabled = !!pdfWhy(); eb.removeAttribute('title'); }
  $('#peUndo').disabled = !PE.undo.length; $('#peRedo').disabled = !PE.redo.length; $('#peReset').disabled = peIsIdentity(); PE_HIST.refresh();
  if (m === 'crop') peCropRefresh();
}
const pePop = card => { const tk = card && card.querySelector('.tick'); if (tk && tk.animate && !reducedMotion()) tk.animate([{ transform: 'scale(.6)' }, { transform: 'scale(1.18)', offset: .55 }, { transform: 'none' }], { duration: 440, easing: EASE_OUT }); };
/* a turned page swings into its new shape while the cards around it, its picture and the number under it glide to their new places (FLIP) */
const peBoxes = () => new Map(Array.from($('#peGrid').children).map(c => [c, c.getBoundingClientRect()]));
/* the turn's ease, the same curve as the other page moves, sampled so the turn can be written as keyframes */
const peBez = (x1, y1, x2, y2) => t => { const f = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s; let lo = 0, hi = 1, s = t; for (let i = 0; i < 24; i++) { if (f(x1, x2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; } return f(y1, y2, s); };
const PE_TURN_EASE = peBez(.22, 1, .36, 1), PE_TURN_MS = 250, PE_TURN_N = 16;          // the ease-out of the tool moves: it lands firmly, so the page snaps rather than settles
/* a turned page swings upright inside its own room in 250ms: the room (the thumb) and the bar stay put, the cards that moved glide (FLIP) on the same clock, and the picture shrinks only as far as its corners need to stay in the room */
function peGlide(was, cv, ow) {
  if (reducedMotion()) return;
  const o = { duration: PE_TURN_MS, easing: 'cubic-bezier(.22,1,.36,1)' };
  was.forEach((b, c) => {
    if (!c.isConnected) return;
    const n = c.getBoundingClientRect(), dx = b.left - n.left, dy = b.top - n.top;
    if (Math.abs(dx) > .5 || Math.abs(dy) > .5) c.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], o);
  });
  if (!cv.animate) return;
  const w = cv.offsetWidth, h = cv.offsetHeight, room = cv.parentElement, W = room.clientWidth, H = room.clientHeight;          // layout sizes: a transform never changes them
  if (!w || !h || !H) return;
  const s0 = ow / h, frames = [];          // the new picture starts turned back and sized as the old one (its width is ow, its height the old height)
  for (let i = 0; i <= PE_TURN_N; i++) {
    const e = PE_TURN_EASE(i / PE_TURN_N), th = -90 * (1 - e), r = th * Math.PI / 180, c = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
    const bw = w * c + h * sn, bh = w * sn + h * c, k = Math.min(s0 + (1 - s0) * e, W / bw, H / bh);
    frames.push({ transform: 'rotate(' + th + 'deg) scale(' + k + ')', offset: i / PE_TURN_N });
  }
  cv.animate(frames, { duration: PE_TURN_MS, easing: 'linear' });
}
function peAct(act, id) {
  const d = PE.d, sl = d.slots[id], card = $('#peGrid').querySelector('.page-card[data-id="' + id + '"]'); if (!sl) return;
  if (act === 'toggle') {
    if (PE.mode === 'pages') {
      if (!sl.x && peIncluded() === 1) { const c = $('#peCount'); swapText(c, 'Keep at least one page.', true); c.classList.add('warn'); return; }
      pePush(); sl.x = !sl.x; if (sl.x) edSay('pe', 'skip');
    } else if (peTickMode()) {
      if (sl.x || (PE.mode === 'split' && sl.half)) return;
      if (PE.mode === 'wm') { if (d.wm.on) { pePush(); sl.nw = !sl.nw; if (card) peDrawCard(card, sl); } else { const z = PE.wmSel = PE.wmSel || new Set(d.order.filter(i => !d.slots[i].x)); if (z.has(id)) z.delete(id); else z.add(id); } }
      else if (PE.mode === 'split') { const z = PE.splitSel = PE.splitSel || new Set(); if (z.has(id)) z.delete(id); else z.add(id); } else if (PE.skip.has(id)) PE.skip.delete(id); else PE.skip.add(id);
    } else return;
    peState(); pePop(card); return;
  }
  if (act === 'open') { peOneOpen(id); return; }
  if (PE.mode !== 'pages') return;
  if (act === 'rot') {
    pePush(); sl.rot = ((sl.rot || 0) + 90) % 360; edSay('pe', 'rot'); if (!card) { peRender(false); return; }
    const was = peBoxes(), cv = card.querySelector('canvas'), ow = cv.getBoundingClientRect().width;
    peDrawCard(card, sl); peState(); peGlide(was, cv, ow);
    return;
  }
  if (act === 'dup') { pePush(); const ni = d.slots.length; d.slots.push({ src: sl.src, rot: sl.rot || 0, x: false, c: true, crop: sl.crop ? sl.crop.slice() : null, dim: dimKey(sl) ? sl.dim.map(b => b.slice()) : null, skew: sl.skew || 0, vskew: sl.vskew || 0, warp: sl.warp || 0, bg: sl.bg || 0, sp: sl.sp || 0, half: sl.half || '' }); d.order.splice(d.order.indexOf(id) + 1, 0, ni); PE.focusId = ni; edSay('pe', 'dup'); }
  else if (act === 'del') { if (!sl.c) return; pePush(); d.order.splice(d.order.indexOf(id), 1); PE.focusId = d.order[Math.max(0, d.order.indexOf(id))] ?? null; edSay('pe', 'del'); }
  else return;
  peRender(true);
}
function peMoveBy(id, dir) {
  const d = PE.d, i = d.order.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= d.order.length) return;
  pePush(); d.order.splice(i, 1); d.order.splice(j, 0, id); PE.focusId = id; peRender(true);
  $('#peLive').textContent = 'Moved to place ' + (j + 1) + ' of ' + d.order.length;
}
/* ---- drag to reorder ----
   Only the page you hold moves, and only a thin line shows where it will land. The other pages stay perfectly still while you drag
   (nothing else is animated or redrawn), then the held page glides into its place when you let go. Card positions are measured once, up front. */
function peDragStart(card, x, y) {
  const grid = $('#peGrid'), wrap = $('#peWrap'), r = card.getBoundingClientRect(), cards = Array.from(grid.children);
  const rects = cards.map(c => ({ x: c.offsetLeft, y: c.offsetTop, w: c.offsetWidth, h: c.offsetHeight })), from = cards.indexOf(card), gr = grid.getBoundingClientRect();
  const ghost = card.cloneNode(true); ghost.classList.add('pe-ghost'); ghost.removeAttribute('tabindex');
  const gc = ghost.querySelector('canvas'); gc.getContext('2d').drawImage(card.querySelector('canvas'), 0, 0);
  Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', transformOrigin: (x - r.left) + 'px ' + (y - r.top) + 'px', scale: '.8', opacity: '.92' });          // a little smaller, so the line stays in view beside it
  const line = document.createElement('i'); line.className = 'pe-drop'; line.setAttribute('aria-hidden', 'true'); grid.appendChild(line);
  $('#pdfDlg .dlg').appendChild(ghost);
  card.classList.add('pe-hole'); grid.classList.add('pe-dragging');
  PE.drag = { id: +card.dataset.id, card, ghost, line, cards, rects, from, to: from, gap: from, side: 'before', ox: x - r.left, oy: y - r.top, w: r.width, h: r.height, l0: r.left, t0: r.top, gl: gr.left, gt: gr.top, s0: wrap.scrollTop, before: peSnap(), x, y };
  PE.pending = null; clearTimeout(PE.hold);
  peDragMove(x, y);
  PE.drag.raf = requestAnimationFrame(function loop() { if (!PE.drag) return; peDragFrame(); PE.drag.raf = requestAnimationFrame(loop); });
}
/* every pointer event only moves the lifted page (one transform on its own layer), so it follows the pointer with no delay */
function peDragMove(x, y) {
  const dr = PE.drag; dr.x = x; dr.y = y;
  dr.ghost.style.transform = 'translate3d(' + (x - dr.ox - dr.l0) + 'px,' + (y - dr.oy - dr.t0) + 'px,0)';
}
/* the line sits in the gap before a page (or after the last one in a row); nothing shows when the page would stay where it is */
function peDragLine(dr, i, side) {
  const q = dr.rects[i], gap = side === 'before' ? i : i + 1, to = gap > dr.from ? gap - 1 : gap;
  dr.to = to; dr.gap = gap; dr.side = side;
  if (to === dr.from) { dr.line.style.opacity = '0'; return; }
  dr.line.style.height = q.h + 'px'; dr.line.style.transform = 'translate3d(' + ((side === 'before' ? q.x - 6 : q.x + q.w + 6) - 1.5) + 'px,' + q.y + 'px,0)'; dr.line.style.opacity = '1';
}
/* once per screen frame: scroll when near an edge, then find the gap the pointer is closest to */
function peDragFrame() {
  const dr = PE.drag, wrap = $('#peWrap'), wr = wrap.getBoundingClientRect(), edge = 56;
  const v = dr.y < wr.top + edge ? -(1 - Math.max(0, dr.y - wr.top) / edge) : dr.y > wr.bottom - edge ? 1 - Math.max(0, wr.bottom - dr.y) / edge : 0;      // faster the nearer the edge
  if (v) wrap.scrollTop += v * 14;
  const px = dr.x - dr.gl, py = dr.y - dr.gt + (wrap.scrollTop - dr.s0);
  let best = 0, bd = 1e18;
  for (let k = 0; k < dr.rects.length; k++) { const q = dr.rects[k], d = (px - q.x - q.w / 2) ** 2 + ((py - q.y - q.h / 2) * 1.6) ** 2; if (d < bd) { bd = d; best = k; } }
  const q = dr.rects[best], side = px < q.x + q.w / 2 ? 'before' : 'after';
  if (best !== dr.bi || side !== dr.side2) { dr.bi = best; dr.side2 = side; peDragLine(dr, best, side); }
}
function peDragEnd(cancel) {
  const dr = PE.drag; clearTimeout(PE.hold); PE.pending = null; if (!dr) return; PE.drag = null; cancelAnimationFrame(dr.raf);
  PE.justDragged = true; setTimeout(() => { PE.justDragged = false; }, 80);          // the click that follows letting go (even on the same spot) is not a tap on the page
  const grid = $('#peGrid'), wrap = $('#peWrap'), g = dr.ghost, calm = !g.animate || reducedMotion(), changed = !cancel && dr.to !== dr.from;
  dr.line.remove(); grid.classList.remove('pe-dragging');
  if (cancel) {
    const done = () => { g.remove(); dr.card.classList.remove('pe-hole'); if (PE.d) peRender(false); };
    if (calm) done(); else { const a = g.animate([{ opacity: 1 }, { opacity: 0, scale: '.94' }], { duration: 160, easing: 'ease-out', fill: 'forwards' }); a.onfinish = a.oncancel = done; }
    return;
  }
  /* the cards are re-ordered for real now, and the held page glides down into its own place */
  if (changed) {
    const order = dr.cards.filter(c => c !== dr.card); order.splice(dr.to, 0, dr.card);
    const ids = order.map(c => +c.dataset.id);
    PE.undo.push(dr.before); PE.redo = []; PE.d.order = ids;
    $('#peLive').textContent = 'Moved to place ' + (dr.to + 1) + ' of ' + ids.length; edSay('pe', 'move');
    const was = calm ? null : peBoxes();          // where every card was, so the ones it passed can slide over to their new places
    const oldIdx = new Map(Array.from(grid.children).map((c, i) => [c, i]));
    order.forEach(c => grid.appendChild(c));
    PE.dir = new Map();          // the held page included: its number slides the way it travelled
    if (was) { let ni = 0; order.forEach(c => { const b = was.get(c); if (b) { const now = c.getBoundingClientRect(); PE.dir.set(+c.dataset.id, peNumDir(now.left - b.left, now.top - b.top, oldIdx.get(c), ni)); } ni++; }); }
    if (was) was.forEach((b, c) => {
      if (c === dr.card) return;
      const a = c.getBoundingClientRect(), x = b.left - a.left, y = b.top - a.top;
      if (x || y) c.animate([{ transform: 'translate3d(' + x + 'px,' + y + 'px,0)' }, { transform: 'translate3d(0,0,0)' }], { duration: PE_TURN_MS, easing: 'cubic-bezier(.22,1,.36,1)' });          // the same clock and curve as the held page's landing
    });
  }
  if (changed && PE.d) { PE.roll = true; peState(); }          // the numbers flip as the page lands, not after it
  const nx = dr.card.offsetLeft, ny = dr.card.offsetTop;                    // where the held page's place now is (one layout read)
  const settle = () => {
    dr.card.classList.remove('pe-hole'); g.remove();
    dr.card.focus({ preventScroll: true });
  };
  if (calm) { settle(); return; }
  const dx = nx - dr.rects[dr.from].x, dy = ny - dr.rects[dr.from].y - (wrap.scrollTop - dr.s0), at = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
  // lands with the others, then gives a small press (scale .985) before it rests: the drop is felt, not just stopped
  const a = g.animate([
    { transform: g.style.transform, scale: '.8', easing: 'cubic-bezier(.22,1,.36,1)' },
    { transform: at, scale: '1', offset: .66, easing: 'ease-out' },
    { transform: at, scale: '.985', offset: .82, easing: 'ease-out' },
    { transform: at, scale: '1' }
  ], { duration: 300, fill: 'forwards' });
  a.onfinish = a.oncancel = settle;
}
/* ---- Export PDF: the draft as a new PDF file (pages in your order, rotated, repeated, left out, watermarked) ---- */
let pdfLibLoading = null;
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  return pdfLibLoading || (pdfLibLoading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/pdf-lib.min.js';
    s.onload = () => window.PDFLib ? res(window.PDFLib) : rej(new Error('PDF tools did not start')); s.onerror = () => { pdfLibLoading = null; rej(new Error('offline')); }; document.head.appendChild(s);
  }));
}
/* the part of a page a viewer actually shows: the crop box where there is one (scans often carry a larger media box with scanner bed around the paper), kept inside the media box */
function pdfVisibleBox(page) {
  const m = page.getMediaBox(), c = page.getCropBox(), x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y), x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
  return x1 - x0 > 1 && y1 - y0 > 1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: m.x, y: m.y, width: m.width, height: m.height };
}
/* a page's rotation and visible box as pdf.js reports them, shaped like the pdf-lib page calls Export makes */
async function pdfjsPageBoxes(doc, idx) {
  const pg = await doc.getPage(idx + 1), v = pg.view, b = { x: v[0], y: v[1], width: v[2] - v[0], height: v[3] - v[1] }; pg.cleanup && pg.cleanup();
  return { getRotation: () => ({ angle: pg.rotate || 0 }), getMediaBox: () => b, getCropBox: () => b };
}
async function buildPdfBlob(r, ui) {
  const L = await loadPdfLib(), { PDFDocument, StandardFonts, degrees, rgb } = L;
  const enc = !!S.pdf.enc;          // encrypted content cannot be copied by pdf-lib, so every page is drawn from pdf.js (which has the password) and saved as a picture
  const srcDoc = enc ? null : await PDFDocument.load(new Uint8Array(await S.pdf.file.arrayBuffer()), { ignoreEncryption: true });
  const out = await PDFDocument.create(), wm = r.wm, font = await out.embedFont(wm.b === false ? (wm.i ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica) : (wm.i ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold)), text = (wm.text || '').trim();
  const keep = recipeKeep(r); ui && ui('Processing');
  for (let ki = 0; ki < keep.length; ki++) {
    const id = keep[ki]; ui && ui('Processing', ki / keep.length); await tick();
    const sl = r.slots[id]; let pg, R0, dimGeo = null;          // dimGeo: where a vector page shows its Dim boxes (a page drawn as a picture already has them in it)
    if (sl.warp || sl.bg || sl.sp || enc) {             // a page that needed bending flat, or cleaned, is drawn once from the original scan and saved as a high-quality JPEG (a page that needed bending flat: 200 dpi; a cleaned page: the scan's own resolution, up to 300 dpi)
      const srcPage = enc ? await pdfjsPageBoxes(S.pdf.doc, sl.src) : srcDoc.getPage(sl.src), intrR = ((srcPage.getRotation().angle || 0) % 360 + 360) % 360, rot = ((sl.rot || 0) % 360 + 360) % 360, cr = sl.crop || [0, 0, 1, 1], mb = pdfVisibleBox(srcPage);
      const Ws = intrR % 180 ? mb.height : mb.width, Hs = intrR % 180 ? mb.width : mb.height, cw = (cr[2] - cr[0]) * Ws, chh = (cr[3] - cr[1]) * Hs, vw0 = rot % 180 ? chh : cw, vh0 = rot % 180 ? cw : chh;
      const fit = r.size ? sizeDims(r.size, r.each ? vw0 / vh0 : S.pdf.aspect0 * (cr[2] - cr[0]) / (cr[3] - cr[1])) : null, tw0 = fit ? fit[0] * 72 : vw0, th0 = fit ? fit[1] * 72 : vh0, sc = fit ? Math.min(tw0 / vw0, th0 / vh0) : 1, f = sl.bg || sl.sp || (enc && !sl.warp) ? Math.min(300 / 72, (await pdfNativeScale(S.pdf.doc, sl.src)) || 300 / 72, 4200 / Math.max(vw0, vh0)) : Math.min(200 / 72, 3600 / Math.max(vw0, vh0));
      const cv = await renderPdfPage(S.pdf.doc, sl.src, Math.round(vw0 * f), Math.round(vh0 * f), rot, null, slotGeo(sl));
      const jpg = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92)), img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      pg = out.addPage([tw0, th0]); R0 = 0; pg.drawImage(img, { x: tw0 / 2 - vw0 * sc / 2, y: th0 / 2 - vh0 * sc / 2, width: vw0 * sc, height: vh0 * sc });
    } else if (r.size || sl.crop || sl.skew || sl.vskew) {             // resized, cropped or straightened: each page is placed on a new page and cut to its crop (still vector, nothing re-drawn as a picture)
      const srcPage = srcDoc.getPage(sl.src), vb = pdfVisibleBox(srcPage), emb = await out.embedPage(srcPage, { left: vb.x, bottom: vb.y, right: vb.x + vb.width, top: vb.y + vb.height }), { pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath, concatTransformationMatrix } = L;
      const intrR = ((srcPage.getRotation().angle || 0) % 360 + 360) % 360, rot = ((sl.rot || 0) % 360 + 360) % 360, cr = sl.crop || [0, 0, 1, 1], W0 = emb.width, H0 = emb.height;
      const K = intrR === 0 ? new DOMMatrix([1, 0, 0, -1, 0, H0]) : intrR === 90 ? new DOMMatrix([0, 1, 1, 0, 0, 0]) : intrR === 180 ? new DOMMatrix([-1, 0, 0, 1, W0, 0]) : new DOMMatrix([0, -1, -1, 0, H0, W0]);          // the page's own coordinates to the picture the viewer shows (y down)
      const Ws = intrR % 180 ? H0 : W0, Hs = intrR % 180 ? W0 : H0, cw = (cr[2] - cr[0]) * Ws, chh = (cr[3] - cr[1]) * Hs, vw0 = rot % 180 ? chh : cw, vh0 = rot % 180 ? cw : chh;
      const fit = r.size ? sizeDims(r.size, r.each ? vw0 / vh0 : S.pdf.aspect0 * (cr[2] - cr[0]) / (cr[3] - cr[1])) : null, tw0 = fit ? fit[0] * 72 : vw0, th0 = fit ? fit[1] * 72 : vh0, sc = fit ? Math.min(tw0 / vw0, th0 / vh0) : 1;
      const m = new DOMMatrix(); m.translateSelf(tw0 / 2, th0 / 2); m.scaleSelf(sc); m.rotateSelf(rot); m.translateSelf(-(cr[0] + cr[2]) / 2 * Ws, -(cr[1] + cr[3]) / 2 * Hs);
      m.translateSelf(Ws / 2, Hs / 2); m.multiplySelf(skewMat(sl.skew, sl.vskew)); m.translateSelf(-Ws / 2, -Hs / 2);
      const T = new DOMMatrix([1, 0, 0, -1, 0, th0]).multiply(m).multiply(K), hw = vw0 * sc / 2, hh = vh0 * sc / 2, ox = tw0 / 2, oy = th0 / 2;
      pg = out.addPage([tw0, th0]); R0 = 0; dimGeo = { rot, cr, a: [ox - hw, oy - hh, hw * 2, hh * 2] };
      pg.pushOperators(pushGraphicsState(), moveTo(ox - hw, oy - hh), lineTo(ox + hw, oy - hh), lineTo(ox + hw, oy + hh), lineTo(ox - hw, oy + hh), closePath(), clip(), endPath(), concatTransformationMatrix(T.a, T.b, T.c, T.d, T.e, T.f));
      pg.drawPage(emb, { x: 0, y: 0, xScale: 1, yScale: 1 });
      pg.pushOperators(popGraphicsState());
    } else {
      [pg] = await out.copyPages(srcDoc, [sl.src]);
      R0 = ((pg.getRotation().angle || 0) + (sl.rot || 0)) % 360; pg.setRotation(degrees(R0)); out.addPage(pg); dimGeo = { rot: sl.rot || 0, cr: null, a: null };
    }
    if (dimGeo && dimKey(sl)) {
      const { width: W, height: H } = pg.getSize(), swap = R0 % 180 !== 0, Wv = swap ? H : W, Hv = swap ? W : H, a = dimGeo.a || [0, 0, Wv, Hv];
      const at = (xv, y) => { const yv = Hv - y; return R0 === 0 ? [xv, yv] : R0 === 90 ? [W - yv, xv] : R0 === 180 ? [W - xv, H - yv] : [yv, H - xv]; };          // a seen position (y down) to the page's own coordinates
      sl.dim.forEach(b => { const q = dimRect(b, dimGeo.rot, dimGeo.cr, a[0], a[1], a[2], a[3]), A = at(q[0], q[1]), B = at(q[0] + q[2], q[1] + q[3]);
        pg.drawRectangle({ x: Math.min(A[0], B[0]), y: Math.min(A[1], B[1]), width: Math.abs(A[0] - B[0]), height: Math.abs(A[1] - B[1]), color: rgb(1, 1, 1), opacity: DIM_ALPHA, borderWidth: 0 }); });
    }
    if (wm.on && text && !sl.nw) {
      const { width: W, height: H } = pg.getSize(), swap = R0 % 180 !== 0, Wv = swap ? H : W, Hv = swap ? W : H;      // the page as it is seen
      const lay = wmLayout(Wv, Hv, wm, s => font.widthOfTextAtSize(text, s));
      const beta = (wm.angle + R0) * Math.PI / 180, tw = font.widthOfTextAtSize(text, lay.size);
      lay.items.forEach(it => {
        const xv = it.x, yv = Hv - it.y;                                                  // seen position, y up
        let cx, cy; if (R0 === 0) { cx = xv; cy = yv; } else if (R0 === 90) { cx = W - yv; cy = xv; } else if (R0 === 180) { cx = W - xv; cy = H - yv; } else { cx = yv; cy = H - xv; }
        const dx = Math.cos(beta), dy = Math.sin(beta), nx = -Math.sin(beta), ny = Math.cos(beta), up = lay.size * 0.35;
        pg.drawText(text, { x: cx - dx * tw / 2 - nx * up, y: cy - dy * tw / 2 - ny * up, size: lay.size, font, rotate: degrees(beta * 180 / Math.PI), opacity: clamp(wm.opacity, 5, 60) / 100, color: rgb(0, 0, 0) });
      });
    }
  }
  ui && ui('Processing', 1);
  return new Blob([await out.save()], { type: 'application/pdf' });
}
/* how many pixels a scanned page holds across one point of its width (0 when the page holds no picture), so a cleaned page is never drawn finer than the scan it came from */
async function pdfNativeScale(doc, idx) {
  try {
    const page = await doc.getPage(idx + 1), ops = await page.getOperatorList(), O = window.pdfjsLib.OPS, v = page.getViewport({ scale: 1, rotation: 0 }); let best = 0;
    for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === O.paintImageXObject || ops.fnArray[i] === O.paintImageXObjectRepeat) {
      const img = await Promise.race([new Promise(res => page.objs.get(ops.argsArray[i][0], res)), sleep(2500).then(() => null)]); if (img && img.width) best = Math.max(best, img.width / v.width);
    }
    try { page.cleanup(); } catch (e) {} return best;
  } catch (e) { return 0; }
}
/* Export works from a copy of the page edits as they are now: edits made while it runs do not reach it (the same as the audio export). The button fills as it goes, Stop ends it, and closing the editor asks first. */
async function peExportPdf() {
  const btn = $('#peExport'), r = PE.d && peCopy(PE.d); if (!r || !S.pdf || !S.pdf.file || PE.exporting) return;
  const lb = btn.querySelector('span'), label = lb.textContent, stop = $('#peExpStop'); let last = '';
  PE.exporting = true; PE.expStop = false; stop.hidden = false; btn.disabled = true;
  const ui = (text, f) => {
    if (PE.expStop) throw new Error('export stopped');
    const t = f == null ? text + '…' : text + ' ' + Math.min(100, Math.floor(f * 100)) + '%'; if (t === last) return; last = t;
    btn.classList.add('exporting'); btn.style.setProperty('--p', f == null ? 0 : Math.min(1, f).toFixed(3)); if (f == null) lb.innerHTML = dotsHTML(t); else lb.textContent = t;
  };
  try {
    const blob = await buildPdfBlob(r, ui);
    const name = (S.pdf.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Score') + ' - Edited.pdf';
    await saveFile(blob, name); toast(tx('pe.saved', { n: recipeKeep(r).length, mb: (blob.size / 1048576).toFixed(1) }));
  } catch (e) { if (PE.expStop) toast(tx('pe.expstop')); else { console.error(e); toast(e && e.message === 'offline' ? tx('pe.offline') : tx('pe.savefail'), 5000); } }
  finally { PE.exporting = false; PE.expStop = false; stop.hidden = true; btn.classList.remove('exporting'); btn.style.removeProperty('--p'); lb.textContent = label; if (PE.d) { const eb = $('#peExport'); eb.disabled = !!pdfWhy(); } else btn.disabled = false; }
}
const peLeave = () => PE.exporting ? askWarn('Close the editor?', 'Your PDF is still being exported. Closing the editor now stops the export and nothing is saved.', 'Stop export and close', 'Keep exporting') : Promise.resolve(true);
/* ---- Dim: the user draws boxes on a page; the music under a box is drawn faded in the grid, the large view, the video, and the exported PDF ----
   A box is kept in the file's own page (see dimKey), so it follows the page when it is turned, cropped, or levelled. While one is drawn or dragged the layer holds the numbers (as fractions of the picture the user sees); the page's recipe changes once, when the pointer lets go. */
const DIM_MIN = 28, DIM_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'], dimX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
/* a box in the file's page to the picture the user sees ([x0, y0, x1, y1]), and back */
function dimToView(sl, b) { const q = dimRect(b, sl.rot, sl.crop, 0, 0, 1, 1); return [q[0], q[1], q[0] + q[2], q[1] + q[3]]; }
function dimToFile(sl, v) {
  const rot = ((sl.rot || 0) % 360 + 360) % 360, cr = sl.crop || [0, 0, 1, 1], un = (x, y) => rot === 90 ? [y, 1 - x] : rot === 180 ? [1 - x, 1 - y] : rot === 270 ? [1 - y, x] : [x, y];
  const A = un(v[0], v[1]), B = un(v[2], v[3]), cw = cr[2] - cr[0], ch = cr[3] - cr[1], r4 = n => Math.round(n * 10000) / 10000;
  return [r4(cr[0] + Math.min(A[0], B[0]) * cw), r4(cr[1] + Math.min(A[1], B[1]) * ch), r4(cr[0] + Math.max(A[0], B[0]) * cw), r4(cr[1] + Math.max(A[1], B[1]) * ch)];
}
function dimBoxEl(layer, v) {
  const el = document.createElement('div'); el.className = 'pe-crop-box pe-dimbox';
  el.innerHTML = '<i data-h="move"></i>' + DIM_HANDLES.map(h => '<i class="h ' + h + '" data-h="' + h + '"></i>').join('') + '<button type="button" class="pe-dimx" aria-label="Delete box" title="Delete box">' + dimX + '</button>';
  const x = el.querySelector('.pe-dimx'); x.addEventListener('pointerdown', e => e.stopPropagation()); x.addEventListener('click', e => { e.stopPropagation(); el.remove(); dimCommit(layer); });
  layer.appendChild(el); dimSet(layer, el, v); return el;
}
function dimSet(layer, el, v) {
  el._v = v; const W = layer.clientWidth || 1, H = layer.clientHeight || 1, px = Math.min((v[2] - v[0]) * W, (v[3] - v[1]) * H);
  el.style.left = v[0] * 100 + '%'; el.style.top = v[1] * 100 + '%'; el.style.width = (v[2] - v[0]) * 100 + '%'; el.style.height = (v[3] - v[1]) * 100 + '%';
  el.style.setProperty('--dz', clamp(px * .5, 6, 22) + 'px'); el.style.setProperty('--hs', clamp(px * .28, 5, 22) + 'px'); el.style.setProperty('--hl', clamp(px * .45, 10, 28) + 'px');
}
/* put the page's boxes on a host (a card's picture, or the large view's page) and let the pointer draw, move, and resize them */
function dimMount(host, id) {
  const sl = PE.d.slots[id], layer = host.querySelector('.pe-dim-layer') || host.appendChild(Object.assign(document.createElement('div'), { className: 'pe-dim-layer' }));
  layer.hidden = false; layer.textContent = ''; layer._id = id; layer._bound || dimBind(layer);
  (sl.dim || []).forEach(b => dimBoxEl(layer, dimToView(sl, b)));
}
function dimLarge() {
  const layer = $('#peDimLayer'), on = PE.mode === 'dim' && PE.one != null;
  if (!on) { layer.hidden = true; layer.textContent = ''; return; }
  if (layer._id !== PE.one || layer.hidden) dimMount($('#peCropPg'), PE.one);
}
function dimCommit(layer) {
  const d = PE.d, sl = d.slots[layer._id]; if (!sl) return;
  const list = Array.from(layer.querySelectorAll('.pe-dimbox')).map(el => dimToFile(sl, el._v)).filter(b => b[2] - b[0] >= 0.005 && b[3] - b[1] >= 0.005);
  if (JSON.stringify(list) === JSON.stringify(sl.dim || [])) return;
  pePush(); sl.dim = list.length ? list : null; peState(); peActs();          // one History step per box drawn, moved, or deleted
  document.querySelectorAll('#pdfDlg .pe-dim-layer').forEach(l => { if (l !== layer && l._id === layer._id) dimMount(l.parentNode, l._id); });          // the card and the large view show the same boxes
}
function dimBind(layer) {
  layer._bound = true; let drag = null;
  if (window.ResizeObserver) new ResizeObserver(() => layer.querySelectorAll('.pe-dimbox').forEach(el => dimSet(layer, el, el._v))).observe(layer);          // a layer built while hidden has no size yet: the X and handles are sized once it has one
  const pt = e => { const r = layer.getBoundingClientRect(); return [clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1), clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1)]; };
  const mins = () => [Math.max(0.005, DIM_MIN / Math.max(1, layer.clientWidth)), Math.max(0.005, DIM_MIN / Math.max(1, layer.clientHeight))];
  const select = el => layer.querySelectorAll('.pe-dimbox').forEach(b => b.classList.toggle('sel', b === el));
  layer.addEventListener('pointerdown', e => {
    if (e.button !== 0 || drag || PE.busy) return;
    const el = e.target.closest('.pe-dimbox'), h = e.target.closest('[data-h]'), [x, y] = pt(e);
    if (el) { const hh = h && el.classList.contains('sel') ? h.dataset.h : 'move'; select(el); drag = { el, hh, x, y, o: el._v.slice(), pid: e.pointerId }; }
    else { select(null); drag = { el: null, x, y, pid: e.pointerId, draw: true }; }
    e.preventDefault(); e.stopPropagation(); try { layer.setPointerCapture(e.pointerId); } catch (_) {}
  });
  layer.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const [x, y] = pt(e), [mw, mh] = mins();
    if (drag.draw) {          // a box exists once it reaches the minimum; before that nothing is dimmed
      const v = [Math.min(drag.x, x), Math.min(drag.y, y), Math.max(drag.x, x), Math.max(drag.y, y)];
      if (v[2] - v[0] >= mw && v[3] - v[1] >= mh) { if (!drag.el) { drag.el = dimBoxEl(layer, v); select(drag.el); } else dimSet(layer, drag.el, v); drag.moved = true; }
      else if (drag.el) { drag.el.remove(); drag.el = null; }
      return;
    }
    const o = drag.o, dx = x - drag.x, dy = y - drag.y; let [l, t, r, b] = o;
    if (drag.hh === 'move') { const w = o[2] - o[0], hgt = o[3] - o[1]; l = clamp(o[0] + dx, 0, 1 - w); t = clamp(o[1] + dy, 0, 1 - hgt); r = l + w; b = t + hgt; }
    else {          // an edge moves only its own side and stops at the minimum, so a box never collapses, flips, or jumps
      if (drag.hh.includes('w')) l = clamp(o[0] + dx, 0, r - mw);
      if (drag.hh.includes('e')) r = clamp(o[2] + dx, l + mw, 1);
      if (drag.hh.includes('n')) t = clamp(o[1] + dy, 0, b - mh);
      if (drag.hh.includes('s')) b = clamp(o[3] + dy, t + mh, 1);
    }
    drag.moved = true; dimSet(layer, drag.el, [l, t, r, b]);
  });
  const end = e => {
    if (!drag || (e.type !== 'lostpointercapture' && e.pointerId !== drag.pid)) return;
    try { layer.releasePointerCapture(drag.pid); } catch (_) {}
    const d = drag; drag = null; if (d.moved) dimCommit(layer);
  };
  layer.addEventListener('pointerup', end); layer.addEventListener('pointercancel', end); layer.addEventListener('lostpointercapture', end);
}
function dimSelectedDelete() { const el = document.querySelector('#pdfDlg .pe-dimbox.sel'); if (!el) return false; const layer = el.parentNode; el.remove(); dimCommit(layer); return true; }
function peDimClear() {
  const d = PE.d, ids = d.order.filter(id => dimKey(d.slots[id])); if (!ids.length) return;
  pePush(); ids.forEach(id => { d.slots[id].dim = null; }); document.querySelectorAll('#pdfDlg .pe-dim-layer').forEach(l => { l.textContent = ''; }); peState(); peActs(); peSay('#peDimStatus', '');
}
function peBind() {
  const grid = $('#peGrid');
  if (window.ResizeObserver) new ResizeObserver(peSheenSync).observe(grid);          // the cards' bands follow where the cards sit when the window or the number of columns changes
  grid.addEventListener('click', e => {
    if (PE.justDragged) return;
    const card = e.target.closest('.page-card'); if (!card) return;
    const tool = e.target.closest('[data-act]'); peAct(tool ? tool.dataset.act : 'toggle', +card.dataset.id);
  });
  grid.addEventListener('dblclick', e => {          // a quick double-click opens the large view where the corner button does; its two clicks have ticked and unticked the page, so the tick is as it was
    const card = e.target.closest('.page-card'); if (!card || e.target.closest('[data-act]') || !peOneMode()) return; peOneOpen(+card.dataset.id);
  });
  grid.addEventListener('pointerdown', e => {
    const card = e.target.closest('.page-card'); if (!card || e.button !== 0 || e.target.closest('[data-act]') || PE.mode !== 'pages') return;          // pages are reordered in Arrange; elsewhere a tap only ticks
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    PE.pending = { card, x: e.clientX, y: e.clientY, touch };
    if (touch) { clearTimeout(PE.hold); PE.hold = setTimeout(() => { if (PE.pending) peDragStart(PE.pending.card, PE.pending.x, PE.pending.y); }, 240); }
  });
  window.addEventListener('pointermove', e => {
    if (PE.drag) { peDragMove(e.clientX, e.clientY); return; }
    const p = PE.pending; if (!p) return; const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.touch) { if (dist > 10) { clearTimeout(PE.hold); PE.pending = null; } else { p.x = e.clientX; p.y = e.clientY; } }
    else if (dist > 4) peDragStart(p.card, e.clientX, e.clientY);
  });
  const up = () => { if (PE.drag) peDragEnd(false); else { clearTimeout(PE.hold); PE.pending = null; } };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', () => peDragEnd(true));
  window.addEventListener('touchmove', e => { if (PE.drag) e.preventDefault(); }, { passive: false });
  PE_HIST.bind(); MAIN_HIST.bind(); $('#peUndo').addEventListener('click', peUndo); $('#peRedo').addEventListener('click', peRedo); $('#peReset').addEventListener('click', peReset);
  /* Select all / Deselect all work on whichever tick is showing: pages used in the video, pages that get the tool, or pages that get the watermark (a video always keeps its first page) */
  const peSelAll = yes => {
    const d = PE.d, m = PE.mode, live = d.order.filter(id => !d.slots[id].x && !(m === 'split' && d.slots[id].half));
    if (m === 'pages') { pePush(); if (yes) d.order.forEach(id => { d.slots[id].x = false; }); else { const keep = d.order.find(id => !d.slots[id].x); d.order.forEach(id => { d.slots[id].x = id !== keep; }); } }
    else if (m === 'wm') { if (d.wm.on) { pePush(); live.forEach(id => { d.slots[id].nw = !yes; }); } else PE.wmSel = yes ? null : new Set(); peRepaint(); }
    else if (m === 'split') { PE.splitSel = PE.splitSel || new Set(); live.forEach(id => { if (yes) PE.splitSel.add(id); else PE.splitSel.delete(id); }); }
    else live.forEach(id => { if (yes) PE.skip.delete(id); else PE.skip.add(id); });
    peState();
  };
  $('#peAll').addEventListener('click', () => peSelAll(true)); $('#peNone').addEventListener('click', () => peSelAll(false));
  const wmPush = () => { if (!PE.wmQuiet) pePush(); PE.wmQuiet = true; clearTimeout(PE.wmT); PE.wmT = setTimeout(() => { PE.wmQuiet = false; }, 900); };       // one undo step per burst of typing or dragging
  peCropBind(); $('#peRail').addEventListener('click', e => { const b = e.target.closest('.pe-tab'); if (b) peTool(b.dataset.tool); });
  $('#peRzGrid').addEventListener('click', e => {
    const b = e.target.closest('.rz-opt'); if (!b) return; const k = b.dataset.k;
    if (k === 'orig') { PE.rzCustom = false; rzPick(null); }
    else if (k === 'custom') { PE.rzCustom = true; $('#peRzCustom').classList.add('shown'); if (!PE.d.size) { const c = rzCurrent(); $('#peRzW').value = rzNum(Math.min(c[0], c[1])); $('#peRzH').value = rzNum(Math.max(c[0], c[1])); } $('#peRzW').focus(); rzRefresh(); }
    else { PE.rzCustom = false; const q = RZ_PRESETS.find(x => x.k === k); rzPick({ w: q.w, h: q.h }); }
  });
  const rzApply = () => { const w = parseFloat($('#peRzW').value), h = parseFloat($('#peRzH').value); if (w >= 2 && w <= 60 && h >= 2 && h <= 60) rzPick({ w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 }); else { PE.rzPend = undefined; peActs(); } };
  $('#peRzShape').addEventListener('click', e => { const b = e.target.closest('.rz-shape'); if (b) rzPickShape(b.dataset.k === 'each'); });
  $('#peRzGo').addEventListener('click', () => { if (!$('#peRzGo').disabled) peSetSize(rzShown(), rzEach()); });
  $('#peRzW').addEventListener('input', rzApply); $('#peRzH').addEventListener('input', rzApply);
  $('#peWmAdd').addEventListener('click', () => { pePush(); peWmSet(true); peRender(false); edSay('pe', 'wm'); });
  $('#peWmRemove').addEventListener('click', () => { pePush(); peWmSet(false); peRender(false); });
  $('#peWmText').addEventListener('input', e => { wmPush(); PE.d.wm.text = e.target.value; peWmTouch(); });
  document.querySelectorAll('input[name=peWmAngle]').forEach(r => r.addEventListener('change', e => {
    pePush(); if (e.target.value === 'custom') { if (PE.d.wm.angle === 45 || PE.d.wm.angle === 0) PE.d.wm.angle = 30; } else PE.d.wm.angle = +e.target.value;
    peWmTouch(); if (e.target.value === 'custom') $('#peWmDeg').focus();
  }));
  $('#peWmDeg').addEventListener('input', e => {
    const v = parseFloat(e.target.value); if (!Number.isFinite(v)) return;
    wmPush(); PE.d.wm.angle = clamp(Math.round(v), -180, 180); peWmTouch();
  });
  $('#peWmDeg').addEventListener('blur', e => { if (PE.d) e.target.value = PE.d.wm.angle; });
  [['peWmB', 'b'], ['peWmI', 'i']].forEach(([id, k]) => $('#' + id).addEventListener('click', () => { pePush(); PE.d.wm[k] = k === 'b' ? PE.d.wm.b === false : !PE.d.wm.i; peWmTouch(); }));
  document.querySelectorAll('input[name=peWmMode]').forEach(r => r.addEventListener('change', e => { pePush(); PE.d.wm.mode = e.target.value; peWmTouch(); }));
  $('#peWmOpacity').addEventListener('input', e => { wmPush(); PE.d.wm.opacity = +e.target.value; $('#peWmOpacityVal').textContent = PE.d.wm.opacity + '%'; paintRange(e.target); peWmTouch(); });
  $('#peExport').addEventListener('click', peExportPdf);
  $('#peCancel').addEventListener('click', () => peLeave().then(ok => { if (ok) closePdfEditor(); })); $('#peDone').addEventListener('click', () => peLeave().then(ok => { if (ok) peApply(); })); $('#peExpStop').addEventListener('click', () => { PE.expStop = true; });
}
function peKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); if (PE.drag) { peDragEnd(true); } else if (PE.one != null) peOneClose(); else if (PE.mode !== 'pages') peTool('pages'); else peLeave().then(ok => { if (ok) closePdfEditor(); }); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) peRedo(); else peUndo(); return; }
  if (PE.mode === 'dim' && (e.key === 'Delete' || e.key === 'Backspace') && !(e.target.closest && e.target.closest('input, select, textarea')) && dimSelectedDelete()) { e.preventDefault(); return; }
  if (PE.one != null && !(e.target.closest && e.target.closest('input, select, textarea')) && !e.ctrlKey && !e.metaKey && ['+', '=', '-', '_', '0'].includes(e.key)) { e.preventDefault(); if (e.key === '0') peZoomReset(true); else peZoomAt(PE.zm.z * (e.key === '-' || e.key === '_' ? 1 / 1.6 : 1.6), null, null, true); return; }
  if (PE.one != null && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target.closest && e.target.closest('input, select, [role=slider]'))) { e.preventDefault(); peOneStep(e.key === 'ArrowLeft' ? -1 : 1); return; }
  const card = e.target.closest && e.target.closest('.page-card'); if (!card) return;
  if (PE.mode !== 'pages' && e.key !== ' ' && e.key !== 'Enter' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (PE.mode !== 'pages' && e.altKey) return;
  const id = +card.dataset.id, cards = Array.from($('#peGrid').children), i = cards.indexOf(card);
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); peMoveBy(id, e.key === 'ArrowLeft' ? -1 : 1); }
  else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); cards[i - 1].focus(); }
  else if (e.key === 'ArrowRight' && i < cards.length - 1) { e.preventDefault(); cards[i + 1].focus(); }
  else if (e.key === 'Enter' && peOneMode() && peTargets().includes(id)) { e.preventDefault(); peOneOpen(id); }          // Space ticks, Enter opens the page
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); peAct('toggle', id); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); peAct('rot', id); }
  else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); peAct('dup', id); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && PE.d.slots[id].c) { e.preventDefault(); peAct('del', id); }
}

