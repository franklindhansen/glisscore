'use strict';
/* ====================================================================
   Audio Editor
   The editor works on a draft. Undo, Redo and Reset belong to the draft; Done applies it to the app in one step
   (so the main Undo can take it back), and Cancel throws it away. Its trim is the video's trim, so the sound you hear here
   is exactly the sound in the exported video.
   ==================================================================== */
const AE = { d: null, base: null, undo: [], redo: [], playing: false, pos: 0, drag: null, sliding: false, dpr: 1 };
const AE_SET = ['normalize', 'normBy', 'normLufs', 'normPreset', 'limiter', 'normPeakDb', 'gainDb', 'audioFades', 'audioFadeLen', 'audioFadeOutLen', 'audioFadeShape', 'matchGain'];       // (the draft also carries fx, the EQ and Imager, which is copied separately)
const AE_FADE = 0.5;                 // the audio file's fades last half a second unless you choose another length (Audio Editor > Fades > Length)
/* the three fade curves: Standard is a straight line, Smooth eases in and out, Natural rises quickly and settles like a quarter of a sine wave */
const AE_SHAPES = { standard: x => x, smooth: x => x * x * (3 - 2 * x), natural: x => Math.sin(x * Math.PI / 2), slow: x => x * x, fast: x => 1 - (1 - x) * (1 - x) };
/* the two fade lengths of a sound's settings: In is audioFadeLen, Out is audioFadeOutLen (empty means the same as In); 0 means that side has no fade, and with the fades switched off both are 0 */
const aeFadeLens = d => { if (d.audioFades === false) return [0, 0]; const i = d.audioFadeLen == null ? AE_FADE : +d.audioFadeLen; return [i, d.audioFadeOutLen == null ? i : +d.audioFadeOutLen]; };
const aeEnv = (vs, ve, t, li, shape, lo) => { const h = (ve - vs) / 2; li = Math.min(li, h); lo = Math.min(lo == null ? li : lo, h); if (li <= 0 && lo <= 0) return 1; const g = AE_SHAPES[shape] || AE_SHAPES.smooth, f = x => g(clamp(x, 0, 1)); return Math.min(li > 0 ? f((t - vs) / li) : 1, lo > 0 ? f((ve - t) / lo) : 1); };
const AE_DEFAULT = { vStart: 0, vEndSet: null, normalize: false, normBy: 'peak', normLufs: -14, normPreset: 'stream', limiter: false, normPeakDb: -1, gainDb: 0, audioFades: false, audioFadeLen: AE_FADE, audioFadeOutLen: null, audioFadeShape: 'smooth', matchGain: false, fx: FX_DEFAULT };
const aeCopy = d => Object.assign({}, d, { fx: fxClone(d.fx) });
const aeF = (d, vs, ve, t) => { const [li, lo] = aeFadeLens(d); return aeEnv(vs, ve, t, li, d.audioFadeShape, lo); };          // the chosen fade length, or none when they are switched off
/* The one place the final samples are made: the processed sound for a stretch of the output, with the level and the fades applied.
   The WAV, M4A and video exports all read through this, so they cannot disagree with each other (or with what the editor plays).
   fill(pos, len, out) writes planar samples (channel after channel) for output samples pos .. pos+len; before or after the sound is silence. */
function masterMaker(buf, ch, vs, ve, gain, fadeAt, opt) {
  opt = opt || {};
  const sr = buf.sampleRate, total = opt.total || Math.max(1, Math.round((ve - vs) * sr)), base = Math.round(vs * sr) - (opt.origin || 0), nch = buf.numberOfChannels, chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(Math.min(c, nch - 1)));          // a mono sound feeds every output channel
  const lim = opt.limit != null ? { L: limNew(sr, ch), next: -1, fed: 0 } : null;
  const raw = (pos, len, out) => {
      const steady = fadeAt(vs + pos / sr) === 1 && fadeAt(vs + (pos + len) / sr) === 1;          // fades only touch the ends, so a block that starts and ends at full level has none
      for (let k = 0; k < len; k++) {
        const s = base + pos + k, g = (steady ? 1 : fadeAt(vs + (pos + k) / sr)) * gain, ok = s >= 0 && s < buf.length;
        for (let c = 0; c < ch; c++) { const v = ok ? chans[c][s] * g : 0; out[c * len + k] = opt.clamp ? (v > 1 ? 1 : v < -1 ? -1 : v) : v; }
      }
  };
  /* with a limiter the sound is fed through it a little ahead (it holds the audio back by its look-ahead), carrying on from the last block; asking for a different place starts it afresh just before that place */
  const limited = (pos, len, out) => {
    if (pos !== lim.next) { lim.L.reset(); lim.fed = Math.max(0, pos - 4096); }
    const D = lim.L.delay, F = pos + len + D - lim.fed, off = pos + D - lim.fed, tmp = new Float32Array(F * ch), res = new Float32Array(F * ch); raw(lim.fed, F, tmp);
    const a = [], b = []; for (let c = 0; c < ch; c++) { a.push(tmp.subarray(c * F, (c + 1) * F)); b.push(res.subarray(c * F, (c + 1) * F)); }
    lim.L.process(a, b, F); for (let c = 0; c < ch; c++) out.set(b[c].subarray(off, off + len), c * len);
    lim.fed = pos + len + D; lim.next = pos + len;
  };
  return { sr, total, ch, fill: lim ? limited : raw, reduction: () => lim ? 20 * Math.log10(lim.L.maxGr) : 0 };
}
const aeEnd = d => d.vEndSet == null ? defaultEnd() : d.vEndSet;
const aeSame = (a, b) => Object.keys(AE_DEFAULT).every(k => k === 'fx' ? JSON.stringify(a.fx) === JSON.stringify(b.fx) : a[k] === b[k]);
const aeFromApp = () => { const d = { vStart: S.vStart, vEndSet: S.vEndSet, fx: fxClone(S.set.fx) }; AE_SET.forEach(k => { d[k] = S.set[k]; }); return d; };
const aeFull = () => { const L = S.audio.duration, d = AE.d, vs = AE.dvs != null ? AE.dvs : d.vStart, ve = AE.dve != null ? AE.dve : aeEnd(d); return [Math.min(0, vs), Math.max(L, ve)]; };
const aeRange = () => AE.rlo != null && AE.rhi != null ? [AE.rlo, AE.rhi] : (AE.zoom ? [AE.zoom.lo, AE.zoom.hi] : aeFull());          // what the waveform shows: everything, or the zoomed stretch          // the shown positions glide when the draft changes (undo, reset); while dragging they follow directly
const hsSnap = (k, v) => { (TL.hs || (TL.hs = {}))[k] = { x: v, v: 0, t: v }; return v; };
const aeW = () => AE.cw || $('#aeCanvas').clientWidth, AE_PAD = 16;          // the width is read once per frame (asking the page for it in the middle of a drawing loop forces it to lay itself out again and again)
const aeX = t => { const [lo, hi] = aeRange(); return AE_PAD + (t - lo) / (hi - lo) * (aeW() - 2 * AE_PAD); };
const aeT = x => { const [lo, hi] = aeRange(); return lo + (x - AE_PAD) / (aeW() - 2 * AE_PAD) * (hi - lo); };
function aePush() { AE.undo.push(aeCopy(AE.d)); if (AE.undo.length > 60) AE.undo.shift(); AE.redo = []; }
function aeUndo() { const s = AE.undo.pop(); if (!s) return; AE.redo.push(aeCopy(AE.d)); AE.d = s; aeRefresh(); aeLive(); }
function aeRedo() { const s = AE.redo.pop(); if (!s) return; AE.undo.push(aeCopy(AE.d)); AE.d = s; aeRefresh(); aeLive(); }

/* ---------- History: every step of the draft, newest first. Click one to go back to it; changes made after it can be kept, step by step or one by one ---------- */
const aeIsObj = v => v && typeof v === 'object' && !Array.isArray(v), aeJ = v => JSON.stringify(v), aeClone = v => v === undefined ? undefined : JSON.parse(aeJ(v));
/* what changed between two drafts, as small operations: set a value, or add / remove / change one item of a list (items are matched by what they contain, so a later removal does not shift them) */
function aeOps(a, b, path = [], out = []) {
  if (aeIsObj(a) && aeIsObj(b)) { new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k => aeOps(a[k], b[k], path.concat(k), out)); return out; }
  if (Array.isArray(a) && Array.isArray(b) && (a.concat(b)).some(aeIsObj)) {
    const left = b.map(aeJ), gone = [], news = [];
    a.forEach(x => { const k = left.indexOf(aeJ(x)); if (k >= 0) left[k] = null; else gone.push(x); });
    b.forEach((x, k) => { if (left[k] !== null) news.push(x); });
    const rem = gone, add = news;
    for (let k = 0; k < Math.max(rem.length, add.length); k++) { if (rem[k] !== undefined && add[k] !== undefined) out.push({ t: 'item', path, kind: 'change', before: rem[k], after: add[k] }); else if (add[k] !== undefined) out.push({ t: 'item', path, kind: 'add', after: add[k] }); else out.push({ t: 'item', path, kind: 'remove', before: rem[k] }); }
    return out;
  }
  if (aeJ(a) !== aeJ(b)) out.push({ t: 'set', path, val: aeClone(b) });
  return out;
}
function aeApplyOp(d, op) {
  let o = d; for (let i = 0; i < op.path.length - 1; i++) { if (!aeIsObj(o[op.path[i]])) o[op.path[i]] = {}; o = o[op.path[i]]; } const k = op.path[op.path.length - 1];
  if (op.t === 'set') { o[k] = aeClone(op.val); return; }
  const arr = Array.isArray(o[k]) ? o[k] : (o[k] = []), at = x => arr.findIndex(y => aeJ(y) === aeJ(x));
  if (op.kind === 'add') { if (at(op.after) < 0) arr.push(aeClone(op.after)); }
  else if (op.kind === 'remove') { const i = at(op.before); if (i >= 0) arr.splice(i, 1); }
  else { const i = at(op.before); if (i >= 0) arr[i] = aeClone(op.after); else if (at(op.after) < 0) arr.push(aeClone(op.after)); }
}
/* the changes of one step, grouped the way a person thinks of them ("Loudness" is one change, not three settings) */
function aeRecords(a, b) {
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v), im = b.fx && b.fx.imager || {}, hz = f => f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + 'kHz' : Math.round(f) + 'Hz', band = x => hz(x.f) + (x.g ? ' ' + sg(x.g) + 'dB' : ''), box = x => fmt(x.a) + '–' + fmt(x.b);
  const G = [[/^(vStart|vEndSet)$/, 'trim', () => 'Trim'], [/^gainDb$/, 'gain', () => 'Gain ' + sg(b.gainDb) + 'dB'],
    [/^(normalize|normBy|normLufs|normPreset|normPeakDb)$/, 'norm', () => !b.normalize ? 'Normalize off' : b.normBy === 'loud' ? 'Loudness ' + LUFS_TXT(+b.normLufs) : 'Peak ' + sg(+b.normPeakDb) + 'dB'],
    [/^limiter$/, 'lim', () => b.limiter ? 'Limiter on' : 'Limiter off'], [/^audioFade/, 'fade', () => b.audioFades === false ? 'Fades off' : 'Fades'],
    [/^fx\.noise/, 'noise', () => 'Noise reduction'], [/^fx\.eq\.(on|lin|auto)/, 'eq', () => 'EQ ' + (b.fx.eq.on ? 'on' : 'off')], [/^fx\.spec\.on/, 'spec', () => 'Spectra'],
    [/^fx\.imager\.width/, 'width', () => 'Width ' + sg((im.width || 100) - 100)], [/^fx\.imager\.bw/, 'bw', () => 'Width by band'], [/^fx\.imager\.bal/, 'bal', () => 'Balance'], [/^fx\.imager\.monoBass/, 'bass', () => 'Center low notes'], [/^fx\.imager\.on$/, 'imager', () => 'Imager'],
    [/^fx\.order/, 'order', () => 'Processing order']];
  const recs = [], by = {};
  aeOps(a, b).forEach(op => {
    const p = op.path.join('.');
    if (op.t === 'item') {
      const eq = /^fx\.eq\.bands$/.test(p), x = op.after || op.before, nm = eq ? 'EQ band' : 'Box';
      const lab = eq ? (op.kind === 'change' ? 'EQ band ' + band(op.before) + ' → ' + band(op.after) : (op.kind === 'add' ? 'EQ band added · ' : 'EQ band removed · ') + band(x)) : (op.kind === 'change' ? 'Box ' + box(op.before) + ' → ' + box(op.after) : (op.kind === 'add' ? 'Box added · ' : 'Box removed · ') + box(x));
      recs.push({ label: lab, ops: [op] }); return;
    }
    const g = G.find(x => x[0].test(p)); const key = g ? g[1] : p, r = by[key] || (by[key] = { label: g ? g[2]() : 'Change', ops: [] }); if (!r.ops.length) recs.push(r); r.ops.push(op);
  });
  return recs;
}
const aeHistStates = () => AE.undo.concat([AE.d], AE.redo.slice().reverse());
const aeHistRec = (H, st, i) => H.rec[i] || (H.rec[i] = i === 0 ? [] : aeRecords(st[i - 1], st[i]));
const aeStepTitle = (i, recs) => i === 0 ? 'Opened' : !recs.length ? 'Change' : recs[0].label + (recs.length > 1 ? ' + ' + (recs.length - 1) + ' more' : '');
function aeHistDraw() {
  const st = aeHistStates(), cur = AE.undo.length, list = $('#aeHistList'), H = AE.hist, sel = H.sel; list.innerHTML = '';
  for (let i = st.length - 1; i >= 0; i--) {
    const recs = aeHistRec(H, st, i), li = document.createElement('li'), between = sel >= 0 && sel < cur && i > sel && i <= cur, many = recs.length > 1;
    li.className = 'hs-row' + (i === cur ? ' cur' : '') + (i > cur ? ' undone' : '') + (i === sel ? ' target' : '') + (between ? ' between' : '') + (H.open.has(i) ? ' open' : ''); li.dataset.i = i;
    const name = aeStepTitle(i, recs);
    li.innerHTML = '<div class="hs-main"><i class="hs-dot"></i><button class="hs-btn" type="button" aria-label="' + (i === cur ? esc(name) + ', current' : 'Go back to ' + esc(name)) + '"><span class="hs-n">' + esc(name) + '</span></button>'
      + (many ? '<button class="hs-more" type="button" aria-expanded="' + H.open.has(i) + '" aria-label="Show the changes in this step"><i></i></button>' : '') + (i === cur ? '<em>Current</em>' : i > cur ? '<em>Undone</em>' : '')
      + (between ? '<input class="hs-cb" type="checkbox" data-k="' + i + '" aria-label="Keep ' + esc(name) + '">' : '') + '</div>'
      + (many ? '<div class="hs-sub"><ul>' + recs.map((r, j) => '<li class="hs-ch" data-k="' + i + ':' + j + '"><span>' + esc(r.label) + '</span>' + (between ? '<input class="hs-cb" type="checkbox" data-k="' + i + ':' + j + '" aria-label="Keep ' + esc(r.label) + '">' : '') + '</li>').join('') + '</ul></div>' : '');
    list.appendChild(li);
  }
  aeHistSync();
}
/* checkboxes, struck-out names, the arrow and the footer follow the choices, without redrawing the list */
function aeHistSync() {
  const H = AE.hist, st = aeHistStates(), cur = AE.undo.length, list = $('#aeHistList'), on = H.sel >= 0 && H.sel !== cur, kept = H.keep;
  list.querySelectorAll('.hs-row.between').forEach(li => {
    const i = +li.dataset.i, recs = aeHistRec(H, st, i), n = recs.length ? recs.filter((r, j) => kept.has(i + ':' + j)).length : 0, all = n === recs.length && n > 0;
    const cb = li.querySelector('.hs-main .hs-cb'); if (cb) { cb.checked = all; cb.indeterminate = n > 0 && !all; }
    li.classList.toggle('kept', n > 0); li.classList.toggle('drop', n === 0);
    li.querySelectorAll('.hs-ch').forEach(c => { const k = c.dataset.k, cc = c.querySelector('.hs-cb'); if (cc) cc.checked = kept.has(k); c.classList.toggle('drop', !kept.has(k)); });
  });
  list.querySelectorAll('.hs-row:not(.between)').forEach(li => { li.classList.remove('kept', 'drop'); });
  aeHistArrow(); foldSet('#aeHistFoot', on); if (!on) return;
  let gone = 0; if (H.sel < cur) for (let i = H.sel + 1; i <= cur; i++) gone += Math.max(1, aeHistRec(H, st, i).length);
  const keptN = H.sel < cur ? [...kept].filter(k => { const i = +k.split(':')[0]; return i > H.sel && i <= cur; }).length : 0;
  $('#aeHistSum').textContent = H.sel > cur ? 'Go forward to “' + list.querySelector('.hs-row.target .hs-n').textContent + '”' : 'Undo ' + (gone - keptN) + ((gone - keptN) === 1 ? ' change' : ' changes') + (keptN ? ', keep ' + keptN : '');
  $('#aeHistSub').textContent = H.sel < cur ? 'Tick anything you want to hold onto' : 'Pick a step to go back to it';
}
function aeHistArrow() {
  const list = $('#aeHistList'), H = AE.hist; let a = list.querySelector('.hs-arrow'); const cur = list.querySelector('.hs-row.cur .hs-main'), tg = list.querySelector('.hs-row.target .hs-main');
  if (!(cur && tg && H.sel < AE.undo.length)) { if (a) a.remove(); return; }
  if (!a) { a = document.createElement('i'); a.className = 'hs-arrow'; list.appendChild(a); }
  const top = cur.parentElement.offsetTop + cur.offsetHeight / 2, bot = tg.parentElement.offsetTop + tg.offsetHeight / 2; a.style.top = top + 'px'; a.style.height = Math.max(0, bot - top) + 'px';
}
function aeHistOpen(on) {
  const pop = $('#aeHist'), btn = $('#aeHistBtn'); if (on === (btn.getAttribute('aria-expanded') === 'true')) return;
  btn.setAttribute('aria-expanded', on); clearTimeout(pop._t);
  if (on) { AE.hist = { sel: -1, keep: new Set(), open: new Set(), rec: {} }; pop.hidden = false; aeHistDraw(); $('#aeHistList').scrollTop = 0; if (!reducedMotion()) pop.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: AE_PG_EASE }); }
  else if (reducedMotion()) pop.hidden = true; else { const a = pop.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-6px) scale(.98)' }], { duration: 200, easing: 'ease-out' }); a.onfinish = () => { if (btn.getAttribute('aria-expanded') !== 'true') pop.hidden = true; }; }
}
function aeHistGo() {
  const H = AE.hist, st = aeHistStates(), cur = AE.undo.length, t = H.sel; if (t < 0 || t === cur) return;
  const keep = [...H.keep].map(k => k.split(':').map(Number)).filter(([i]) => i > t && i <= cur).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  if (t > cur || !keep.length) { AE.undo = st.slice(0, t); AE.d = st[t]; AE.redo = st.slice(t + 1).reverse(); }          // a plain step back or forward
  else { const d = aeCopy(st[t]); keep.forEach(([i, j]) => aeHistRec(H, st, i)[j].ops.forEach(op => aeApplyOp(d, op))); AE.undo = st.slice(0, cur + 1); if (AE.undo.length > 60) AE.undo.shift(); AE.d = d; AE.redo = []; }          // back to that step, with the kept changes laid on top (a new step, so nothing is lost)
  aeHistOpen(false); aeRefresh(); aeLive();
}
function aeHistBind() {
  $('#aeHistBtn').addEventListener('click', () => aeHistOpen($('#aeHistBtn').getAttribute('aria-expanded') !== 'true'));
  $('#aeHistNo').addEventListener('click', () => { Object.assign(AE.hist, { sel: -1, keep: new Set() }); aeHistDraw(); });
  $('#aeHistGo').addEventListener('click', aeHistGo);
  $('#aeHistList').addEventListener('click', e => {
    const row = e.target.closest('.hs-row'); if (!row) return; const i = +row.dataset.i, H = AE.hist, cur = AE.undo.length, st = aeHistStates();
    const cb = e.target.closest('.hs-cb');
    if (cb) {          // a tick on a whole step ticks all of its changes; a tick on one change leaves the rest alone
      const k = cb.dataset.k, on = cb.checked;
      if (k.includes(':')) { if (on) H.keep.add(k); else H.keep.delete(k); } else aeHistRec(H, st, +k).forEach((r, j) => { if (on) H.keep.add(k + ':' + j); else H.keep.delete(k + ':' + j); });
      aeHistSync(); return;
    }
    if (e.target.closest('.hs-more')) { const op = !row.classList.contains('open'); row.classList.toggle('open', op); op ? H.open.add(i) : H.open.delete(i); e.target.closest('.hs-more').setAttribute('aria-expanded', op); const t0 = performance.now(); (function f() { aeHistArrow(); if (performance.now() - t0 < 520) requestAnimationFrame(f); })(); return; }
    if (!e.target.closest('.hs-btn')) return;
    if (i === cur || i === H.sel) { H.sel = -1; H.keep = new Set(); aeHistDraw(); return; }
    H.sel = i; H.keep = new Set([...H.keep].filter(k => { const n = +k.split(':')[0]; return n > i && n <= cur; })); aeHistDraw();
  });
  document.addEventListener('pointerdown', e => { if ($('#aeHistBtn').getAttribute('aria-expanded') === 'true' && !e.target.closest('#aeHist, #aeHistBtn')) aeHistOpen(false); }, true);
}
const aeHasMatch = () => !!(AE.matchOpen || (AE.match && (AE.match.ref || AE.match.busy)));
function aeReset() {
  if (aeSame(AE.d, AE_DEFAULT) && !aeHasMatch() && !aeBpAny()) return;
  if (!aeSame(AE.d, AE_DEFAULT)) { aePush(); Object.assign(AE.d, AE_DEFAULT, { fx: fxClone(FX_DEFAULT) }); }
  AE.match = null; AE.matchOpen = false; AE.bp = {}; AE.band = 0; AE.nsel = null; AE.nrListen = false; if (AE.zoom) aeZoomSet(-1e9, 1e9, false); aeRefresh(); aeLive(); if (AE.playing) aeRoute(); aeAnim();
}
function openAudioEditor() {
  if (!S.audio) return;
  Transport.pause();
  AE.base = aeFromApp(); AE.d = aeCopy(AE.base); AE.undo = []; AE.redo = []; AE.pos = Math.max(0, AE.d.vStart); AE.bp = {}; AE.band = 0; AE.meas = null; aeInitTools();
  aeFormatUI();
  sheetShow($('#audioDlg')); aeRefresh(); { const d = $('#audioDlg'); d.tabIndex = -1; d.focus({ preventScroll: true }); } edIntro('ae'); requestAnimationFrame(aeAlignView); setTimeout(aeAlignView, 600); setTimeout(aeAlignView, 1400);
}
/* the opening screen always fits its box: at full size when there is room, scaled down evenly when there is not, never with a scroll bar */
function introFit() {
  const em = document.getElementById('empty'), fit = document.getElementById('emptyFit'); if (!em || !fit || em.hidden || !em.offsetParent) return;
  em.style.setProperty('--is', 1);          // the box is scaled with a transform, so its own size is always the unscaled one
  const cs = getComputedStyle(em), avail = em.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), natural = fit.offsetHeight;
  if (natural <= avail || avail <= 0 || !natural) return;
  em.style.setProperty('--is', Math.max(0.1, avail / natural).toFixed(3));
}
if (window.ResizeObserver) new ResizeObserver(() => introFit()).observe(document.querySelector('.stage-wrap') || document.body);
if (window.ResizeObserver) {          // the spread label picks the longest wording that fits beside the buttons whenever the row's or the label's width changes (on the next frame, so it never loops)
  let sig = ''; const tr = $('#transport'), info = $('#spreadInfo');
  new ResizeObserver(() => { const now = tr.offsetWidth + '|' + info.offsetWidth; if (now !== sig) { sig = now; requestAnimationFrame(() => { fitInfo(); sig = tr.offsetWidth + '|' + info.offsetWidth; }); } }).observe(tr);
  new ResizeObserver(() => { const now = tr.offsetWidth + '|' + info.offsetWidth; if (now !== sig) { sig = now; requestAnimationFrame(() => { fitInfo(); sig = tr.offsetWidth + '|' + info.offsetWidth; }); } }).observe(info);
}
window.addEventListener('resize', introFit); { const em = document.getElementById('empty'); if (em) new MutationObserver(introFit).observe(em, { attributes: true, attributeFilter: ['hidden'] }); } introFit();
const QUIPS = MSG.quips;
/* the (i) texts come from the same block */
/* the wording of the toasts, status lines and large-view notes comes from the same block; {n}, {pages} and so on are filled in */
const tx = (k, v) => String((MSG.text && MSG.text[k]) || '').replace(/\{(\w+)\}/g, (m, w) => v && w in v ? v[w] : m);
function applyTips() { document.querySelectorAll('[data-tip]').forEach(el => { const t = MSG.tips && MSG.tips[el.dataset.tip]; if (t && el.textContent !== t) el.textContent = t; }); }
applyTips();
/* the line under an editor's title: the very first open always gets the original; after that a random one from the pool */
function edIntro(which) {
  let first = true; try { first = !localStorage.getItem('glisscore.intro.' + which); localStorage.setItem('glisscore.intro.' + which, '1'); } catch (e) {}
  const pool = QUIPS[which] || []; if (pool.length) edLead(which, first ? pool[0] : pool[Math.floor(Math.random() * pool.length)], false);
  edSay.done = { pe: {}, ae: {} };
}
/* a lot of clipping after raising the gain: one of the reaction lines, never the same one twice in a visit */
function aeClipSay() { const ks = ['clip', 'clipb'].filter(k => MSG.says['ae.' + k] && !(edSay.done && edSay.done.ae[k])); if (ks.length) edSay('ae', ks[Math.floor(Math.random() * ks.length)]); }
/* a line for something you just did, shown at most once each time an editor is opened */
function edSay(which, key) {
  const text = MSG.says[which + '.' + key]; if (!text) return;
  const d = edSay.done || (edSay.done = { pe: {}, ae: {} }); if (d[which][key]) return; d[which][key] = 1;
  edLead(which, text, false, 2100);
}
function edLeadStop(which) { const el = $('#' + which + 'Lead'); el._tok = (el._tok || 0) + 1; if (el.dataset.normal) el.textContent = el.dataset.normal; el.classList.remove('quip'); el.style.minHeight = ''; }
/* editors fade and settle in and out instead of popping */
const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
/* While a window is open the page behind must not scroll. Instead of hiding the page's scrollbar (which made the layout jump when it came back), scrolling is simply stopped unless something inside the window can really scroll that way. */
document.addEventListener('wheel', e => {
  const ov = Array.from(document.querySelectorAll('.exp-overlay')).find(o => !o.hidden && !o.classList.contains('closing')); if (!ov) return;
  if (!ov.contains(e.target)) { e.preventDefault(); return; }
  const dy = e.deltaY; if (!dy) return;
  for (let n = e.target; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 1) { if (dy < 0 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1) return; }
    if (n === ov) break;
  }
  e.preventDefault();
}, { passive: false });
function sheetShow(el) { clearTimeout(el._ct); el.classList.remove('closing'); el.inert = false; el.hidden = false; }
function sheetHide(el) {
  clearTimeout(el._ct); if (el.hidden) return;
  if (reducedMotion()) { el.hidden = true; return; }
  el.classList.add('closing'); el.inert = true;
  el._ct = setTimeout(() => { el.hidden = true; el.classList.remove('closing'); el.inert = false; }, 240);
}
function aeDropPreview() { if (NRJ.pv && S.audio && nrReady(S.set.fx.noise) && NRJ.pv.key === nrKey(S.set.fx.noise)) return; if (NRJ.pv) { NRJ.pv.run.cancel(); NRJ.pv = null; } }
/* leaving while the audio is still being exported would throw the export away, so ask first */
function aeLeave() {
  return AE.exporting ? askWarn('Close the editor?', 'Your audio is still being exported. Closing the editor now stops the export and nothing is saved.', 'Stop export and close', 'Keep exporting') : Promise.resolve(true);
}
function closeAudioEditor() { if (AE.exporting) AE.expStop = true; aeHistOpen(false); edLeadStop('ae'); aeStop(); aeFsStop(); AE.fsBusy = false; if (AE.full) aeFsApply(false); sheetHide($('#audioDlg')); AE.d = null; }
function aeApply() {
  if (AE.exporting) { aeLeave().then(ok => { if (ok) aeApply(); }); return; }
  const d = AE.d; aeStop();
  const changed = !aeSame(d, AE.base);
  if (changed) {
    pushHistory();
    S.vStart = d.vStart; S.vEndSet = d.vEndSet; AE_SET.forEach(k => { S.set[k] = d[k]; }); S.set.fx = fxClone(d.fx);
    S.time = clamp(S.time, S.vStart, vEnd());
    normalizeTurns(); onTurnsChanged(); onTrimChanged(); syncControls(); saveSettings(); stageDirty = true;
    TL.staticDirty = true;
    fxGet(S.set.fx).then(() => { stageDirty = true; TL.staticDirty = true; }, e => { dbg('Processing failed: ' + (e && e.message || e)); toast(tx('vid.fxfail'), 5000); });
    toast(tx('vid.updated'), 2400);
  }
  closeAudioEditor();
}
/* everything on the dialog follows the draft */
/* where the sound really starts and ends: the markers move to just outside the first and last moments louder than the quiet floor */
/* where the sound starts and ends. With noise reduction on, the cleaned sound is what is looked at (once it is ready), so a lead-in of hiss that stood above the threshold counts as the silence it now is */
function aeSilenceRange() {
  const fp = AE.d && S.audio && fxActive(AE.d.fx, fxChannels()).includes('noise') ? fxPeek(AE.d.fx) : null, pk = fp && fp.peaks ? fp.peaks : S.audio.peaks, L = S.audio.duration; let mx = fp && fp.peaks ? fp.peakMax : S.audio.peakMax;
  if (pk && !(mx > 0)) { mx = 0; for (let i = 0; i < pk.length; i++) if (pk[i] > mx) mx = pk[i]; } if (!pk || !(mx > 0)) return null;
  const th = Math.max(0.004, mx * 0.01); let a = 0, b = pk.length - 1;
  while (a < b && pk[a] < th) a++; while (b > a && pk[b] < th) b--;
  let st = Math.max(0, a / 100 - 0.2), en = Math.min(L, (b + 1) / 100 + 0.3);
  if (en - st < 1) return null;
  return [st, en];
}
/* the trim stops at a page turn, as the video's own trim does: the first turn stays after the start, the last one before the end */
function aeTrimStop(which, t, d) {
  const lim = trimLimitsFor(d.vStart, aeEnd(d));
  if (which === 'start') { const hi = Math.max(0, lim.startMax); return t > hi ? { t: hi, turn: 1 } : { t }; }
  const lo = Math.min(lim.endMin, S.audio.duration); return t < lo ? { t: lo, turn: S.turns.length } : { t };
}
/* says why the trim stopped (once per drag or trim): the turn in the way */
function aeTrimSaid(which, s) {          // a note on the waveform itself (a toast sits behind the editor), with a dashed line where the page turn holds the handle
  if (!s.turn) return; const el = $('#aeStopNote'); if (!el) return;
  el.textContent = tx('ae.turnstop', { n: s.turn, which }); el.hidden = false; requestAnimationFrame(() => el.classList.add('show'));
  AE.stopMark = { t: s.t, which }; clearTimeout(AE.stopT); AE.stopT = setTimeout(aeStopClear, 4200); aeAnim(); aeDraw();
}
function aeStopClear() { const el = $('#aeStopNote'); AE.stopMark = null; if (el) { el.classList.remove('show'); setTimeout(() => { if (!AE.stopMark) el.hidden = true; }, 300); } if ($('#audioDlg') && !$('#audioDlg').hidden) aeDraw(); }
function aeTrimSilence() {
  const r = aeSilenceRange(), d = AE.d; if (!r) return;
  edSay('ae', 'silence');
  const s = aeTrimStop('start', r[0], d), e = aeTrimStop('end', r[1], d);
  aePush(); d.vStart = s.t; d.vEndSet = e.t >= S.audio.duration - 0.05 ? null : e.t; AE.pos = Math.max(0, d.vStart); aeRefresh();
  if (s.turn) aeTrimSaid('start', s); else aeTrimSaid('end', e);
}
const LUFS_TXT = v => isFinite(v) ? v.toFixed(1).replace('-', '−') + 'LUFS' : '—';
const loudPresets = () => (MSG.loud && MSG.loud.length ? MSG.loud : []);
/* the Normalize card: Off / Peak / Loudness, the target for the one chosen, and what the loudness target comes to */
function aeNormUI(d) {
  const mode = !d.normalize ? 'off' : d.normBy === 'loud' ? 'loud' : 'peak';
  const rr = document.querySelector('input[name=aeNormMode][value=' + mode + ']'); if (rr && !rr.checked) { rr.checked = true; const sg = $('#aeNormMode'); if (sg._place) sg._place(true); }
  foldSet('#aePeakFold', mode === 'peak'); foldSet('#aeLoudFold', mode === 'loud');
  $('#aeNormDb').disabled = mode !== 'peak'; if (document.activeElement !== $('#aeNormDb')) $('#aeNormDb').value = (+d.normPeakDb).toFixed(1);
  const pr = loudPresets(), sel = $('#aeLoudPreset'), sig = pr.map(p => p.id + p.name + p.lufs).join('|');
  if (sel._sig !== sig) { sel._sig = sig; sel.innerHTML = pr.map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '<option value="custom">Custom</option>';
    }
  const hit = d.normPreset === 'custom' ? null : pr.find(p => p.id === d.normPreset && Math.abs(p.lufs - d.normLufs) < 0.05) || pr.find(p => Math.abs(p.lufs - d.normLufs) < 0.05); sel.value = hit ? hit.id : 'custom';
  if (document.activeElement !== $('#aeLoudDb')) $('#aeLoudDb').value = (+d.normLufs).toFixed(1);
  const note = $('#aeLoudNote'), i = aeLoudInfo(d); let txt = '', cls = '';
  if (mode === 'loud') { if (!i || !i.ready) { txt = 'Processing…'; cls = 'busy'; } else if (i.silent) txt = 'Nothing to measure.'; else if (i.capped) { txt = 'Capped at +24dB · reaches ' + LUFS_TXT(i.reached); cls = 'warn'; } else txt = 'Reaches ' + LUFS_TXT(i.reached); }
  const lim = mode === 'loud' && d.limiter;
  if (lim && i && i.ready && !i.silent) { if (!i.lim) { txt = 'Processing…'; cls = 'busy'; } else if (i.lim.short) { txt = 'Limiter at its limit · reaches ' + LUFS_TXT(i.lim.I); cls = 'warn'; } else txt = 'Reaches ' + LUFS_TXT(i.lim.I); }
  setDots(note, txt); note.className = 'lv-note' + (cls ? ' ' + cls : '');
  const lp = $('#aeLoudPk'), clipTxt = mode === 'loud' && i && i.ready && i.clips ? 'Audio clips (' + DB_TXT(i.peakDb) + ')' : '';
  setDots(lp, clipTxt); lp.className = 'lv-note warn';
  const pn = $('#aePeakNote'); let ptxt = '', pcls = '';
  if (mode === 'peak') { const mx = aePeakMax(d); if (mx > 1e-4 && Math.pow(10, d.normPeakDb / 20) / mx > Math.pow(10, 24 / 20)) { ptxt = 'Capped at +24dB · reaches ' + DB_TXT(20 * Math.log10(mx * Math.pow(10, 24 / 20))); pcls = 'warn'; } }
  setDots(pn, ptxt); pn.className = 'lv-note' + (pcls ? ' ' + pcls : '');
  const lhint = mode === 'loud' && i && i.ready && i.clips && !d.limiter;
  const lt = $('#aeLimTip'); lt.style.visibility = lhint ? 'visible' : 'hidden'; $('#aeLimiter').checked = !!d.limiter; $('#aeLimRow').classList.toggle('nudge', !!lhint);          // when the target would clip, the switch gently asks to be tried
  if (mode === 'loud' || AE.tool === 'level') loudWant(d);
}
function aeRefresh() {
  const d = AE.d, L = S.audio.duration, end = aeEnd(d);
  $('#aeStart').textContent = fmt(d.vStart); $('#aeEnd').textContent = fmt(end);
  aeNormUI(d);
  { const fl = $('#aeFadeLen'), mx = clamp(Math.floor((end - d.vStart) / 2 * 10) / 10, 0.1, 3), [li, lo] = aeFadeLens(d), off = li <= 0 && lo <= 0;          // a fade can be at most half the part you keep
    if (AE.fadeSide === 'both' && li !== lo && !AE.fadeForce) aeFadeSide('in', true);          // the two lengths differ (an undo, a saved setting), so Both cannot say what they are
    const sd = AE.fadeSide || 'both', cur = sd === 'out' ? lo : li, fv = Math.min(cur, mx), tx = v => v <= 0 ? 'Off' : v.toFixed(1) + 's';
    fl.max = mx; aeSlide(fl, fv); $('#aeFadeLenVal').textContent = tx(fv); $('#aeFdBadge').textContent = aeFadeBadge(d); $('#aeFdLed').classList.toggle('on', !off);
    const shp = document.querySelector('input[name=aeFadeShape][value=' + (d.audioFadeShape || 'smooth') + ']'); if (shp && !shp.checked) { shp.checked = true; const sg = $('#aeFadeShape'); if (sg._place) sg._place(true); }
    aeFadeDraw(); }
  const gdb = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v % 1) > 0.04 ? 1 : 0) + 'dB';
  { const from = Math.max(0, d.vStart), to = Math.min(end, L), G = aeLevel(d, from, to), gdBnow = 20 * Math.log10(G); AE.G = G;
    const busy = fxActive(d.fx, fxChannels()).length > 0 && !fxPeek(d.fx); if (busy) fxWait(d);          // the meter waits for the finished sound rather than show the one before
    const pkN = aeLevelPeaks(d), i0 = Math.max(0, Math.floor(from * 100)), i1 = Math.min(pkN.length - 1, Math.ceil(to * 100));
    const pkO = srcTp(S.audio); let mN = 0, mO = 0, over = 0; for (let i = i0; i <= i1; i++) { if (pkN[i] > mN) mN = pkN[i]; if (pkO[i] > mO) mO = pkO[i]; if (pkN[i] * G > 1) over++; }
    const db = m => m > 1e-4 ? 20 * Math.log10(m) : -Infinity, mNow = limOn(d) ? Math.min(mN * G, Math.pow(10, LIM_CEIL / 20)) : mN * G, pos = v => isFinite(v) ? clamp((v + 36) / 48, 0, 1) * 100 : 0;          // the meter runs from -36 to +12 dB
    $('#aeGain').disabled = !!d.normalize; $('#aeGainCard').classList.toggle('dim', !!d.normalize); aeSlide($('#aeGain'), d.normalize ? clamp(gdBnow, -12, 12) : d.gainDb); $('#aeLvLed').classList.toggle('on', !!d.normalize || d.gainDb !== 0);
    $('#aeGainBig').textContent = gdb(Math.round(gdBnow * 10) / 10); $('#aeNet').innerHTML = 'Net gain <b>' + (Math.abs(gdBnow) < 0.05 ? '0dB' : gdb(Math.round(gdBnow * 10) / 10)) + '</b>'; $('#aeLvBadge').textContent = d.normalize ? (d.normBy === 'loud' ? LUFS_TXT(d.normLufs) : DB_TXT(d.normPeakDb)) : d.gainDb ? gdb(d.gainDb) : '';
    const dbf = v => isFinite(v) ? (v >= 0.05 ? '+' : '') + v.toFixed(1).replace('-', '−') + 'dB' : '—';
    AE.ms = busy ? { fill: 0, orig: pos(db(mO)), hot: false, good: false, text: '…' } : { fill: pos(db(mNow)), orig: pos(db(mO)), hot: mNow > 1.0005, good: mNow >= 0.5 && mNow <= 1.0005, text: dbf(db(mNow)) };          // at rest the bar is the loudest peak you will get; the tick is the file's own
    AE.sumIn = { mNow, mO, gdBnow, busy }; aeSummary(d);
    { /* with a loudness target and no limiter it says so too, once the volume is known */ const cn = $('#aeClipNote'), lw = d.normalize && d.normBy === 'loud', li = lw ? aeLoudInfo(d) : null, on = !busy && !limOn(d) && (!lw || (li && li.ready)) && mNow > 1.00001; cn.hidden = !on; setDots(cn, on ? 'Audio clips (' + DB_TXT(20 * Math.log10(mNow)) + ')' : ''); }
    { const lk = [d.gainDb, d.normalize, d.normBy, d.normLufs, d.normPeakDb, d.limiter, fxKey(d.fx)].join('|'); if (AE.clipKey !== lk) { AE.clipKey = lk; AE.clipLatch = false; AE.clipFrom = performance.now() + 150; if (AE.mLive) { AE.mv = 0; AE.hold = 0; } } }          // a change to what sets the level clears the Clip light; if the sound still clips while it plays, the light comes back at once
    if (!AE.mLive) aeMeterStatic();
    const clip = mNow > 1 && (over / Math.max(1, i1 - i0 + 1) >= 0.005 || mNow > 1.19);          // a lot of clipping: a few louder moments are not worth a joke
    $('#aeGainBig').classList.toggle('clip', clip); if (clip && !AE.clip) aeClipSay(); AE.clip = clip; }
  { const r = aeSilenceRange(), sb = $('#aeSilence'), done = r && Math.abs(r[0] - Math.max(0, d.vStart)) < 0.05 && Math.abs(r[1] - Math.min(end, L)) < 0.05, off = !r || done;          // greyed out but still answers: it says why when you point at it
    sb.classList.toggle('soft', off); sb.setAttribute('aria-disabled', off ? 'true' : 'false'); const none = !r || (r[0] < 0.05 && r[1] > L - 0.05); sb.dataset.why = none ? 'Can’t find any silence to remove.' : done ? 'Already trimmed past the silence.' : ''; }
  if (!AE.playing) AE.pos = clamp(AE.pos, Math.max(0, d.vStart), Math.max(0, d.vStart, Math.min(end, L)));      // the playhead stays inside the part that is kept
  $('#aeUndo').disabled = !AE.undo.length; $('#aeRedo').disabled = !AE.redo.length; $('#aeHistBtn').disabled = !AE.undo.length && !AE.redo.length; if ($('#aeHistBtn').getAttribute('aria-expanded') === 'true') { if (AE.hist) { AE.hist.rec = {}; aeHistDraw(); } } $('#aeReset').disabled = aeSame(d, AE_DEFAULT) && !aeHasMatch() && !aeBpAny();
  aeToolsRefresh(); aeSize(); aeDraw(); aeAnim();
}
function aeSize() {
  const cv = $('#aeCanvas'), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  AE.dpr = dpr; if (w) AE.cw = w;
}
/* ---------------- the spectrum view: sound as a picture of time (across) and pitch (up) ----------------
   Each column is a short slice of the sound; each row a band of pitch from 20 Hz upward (low at the bottom, a row is a fixed fraction of an octave); the color is how loud that pitch is in that slice. Steady noise is a flat haze, hum is thin level lines, notes are bright strips with their overtones above. The analysis runs in a background worker, the picture is drawn in as it arrives. */
const SPEC_H = 224, SPEC_B = 320, SPEC_HOP = 0.02, SPEC_N = 2048, SPEC_FMIN = 20;          // 320 bands of pitch are analysed, 224 rows are drawn
const SPEC_CODE = `
function specRun(mono, sr, hop, N, H, fmin, fmax, emit) {
  var half = N / 2, re = new Float64Array(N), im = new Float64Array(N), w = new Float64Array(N), i, k, j, b;
  for (i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  var tc = new Float64Array(half), ts = new Float64Array(half); for (i = 0; i < half; i++) { tc[i] = Math.cos(2 * Math.PI * i / N); ts[i] = -Math.sin(2 * Math.PI * i / N); }
  var rev = new Uint16Array(N), bits = Math.round(Math.log(N) / Math.LN2); for (i = 0; i < N; i++) { var x = i, y = 0; for (j = 0; j < bits; j++) { y = (y << 1) | (x & 1); x >>= 1; } rev[i] = y; }
  var lo = new Float64Array(H), hi = new Float64Array(H), ratio = fmax / fmin, binHz = sr / N;
  for (b = 0; b < H; b++) { lo[b] = fmin * Math.pow(ratio, b / H); hi[b] = fmin * Math.pow(ratio, (b + 1) / H); }
  var cols = Math.max(1, Math.floor((mono.length - N) / (hop * sr)) + 1), step = Math.max(1, Math.round(hop * sr)), pw = new Float64Array(half + 1), norm = 4 / N, chunk = 120, out = new Float32Array(chunk * H), n = 0, c0 = 0;
  for (var c = 0; c < cols; c++) {
    var s = c * step; for (i = 0; i < N; i++) { var p = s + i; re[rev[i]] = p < mono.length ? mono[p] * w[i] : 0; im[rev[i]] = 0; }
    for (var len = 2; len <= N; len <<= 1) { var hf = len >> 1, st = N / len; for (i = 0; i < N; i += len) for (k = 0; k < hf; k++) { var a = i + k, bb = a + hf, wr = tc[k * st], wi = ts[k * st], xr = re[bb] * wr - im[bb] * wi, xi = re[bb] * wi + im[bb] * wr; re[bb] = re[a] - xr; im[bb] = im[a] - xi; re[a] += xr; im[a] += xi; } }
    for (k = 0; k <= half; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    for (b = 0; b < H; b++) {
      var f0 = lo[b] / binHz, f1 = hi[b] / binHz, sum = 0, cnt = 0, k0 = Math.ceil(f0), k1 = Math.floor(f1);
      if (k1 >= k0) { for (k = k0; k <= k1 && k <= half; k++) { sum += pw[k]; cnt++; } sum /= cnt; }
      else { var fc = (f0 + f1) / 2, kk = Math.min(half - 1, Math.max(0, Math.floor(fc))), fr = fc - kk; sum = pw[kk] * (1 - fr) + pw[kk + 1] * fr; }
      out[n * H + b] = 10 * Math.log10(sum * norm * norm + 1e-14);
    }
    n++; if (n === chunk || c === cols - 1) { emit(c0, out.slice(0, n * H), n); c0 = c + 1; n = 0; }
  }
  return cols;
}`;
const SPEC_PAL = (() => {          // quiet to loud: deep indigo, the accent blue, violet, amber, warm white
  const stops = [[0, [14, 17, 46]], [0.22, [40, 52, 150]], [0.45, [92, 82, 214]], [0.62, [176, 56, 156]], [0.8, [236, 140, 40]], [1, [255, 240, 205]]], lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { const v = i / 255; let k = 0; while (k < stops.length - 2 && v > stops[k + 1][0]) k++; const a = stops[k], b = stops[k + 1], t = clamp((v - a[0]) / (b[0] - a[0]), 0, 1); for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(a[1][c] + (b[1][c] - a[1][c]) * t); }
  return lut;
})();
const SPEC_TOP = -6, SPEC_RANGE = 84;           // loudest color at -6 dB below full scale, the quietest 84 dB below that: the same for every file, so two pictures can be compared
/* the pitch axis: low notes get more room than a plain log scale gives them (it bends to a plain log above about 200 Hz), so the part where the music lives is not squeezed */
const specRaw = f => Math.log(1 + f / 200), specRawInv = r => 200 * (Math.exp(r) - 1);
function specFrac(f, fmax) { const a = specRaw(SPEC_FMIN), b = specRaw(fmax); return clamp((specRaw(f) - a) / (b - a), 0, 1); }
function specRowMap(fmax) { const a = specRaw(SPEC_FMIN), b = specRaw(fmax), m = new Float32Array(SPEC_H); for (let r = 0; r < SPEC_H; r++) { const f = specRawInv(a + (1 - (r + 0.5) / SPEC_H) * (b - a)); m[r] = clamp(Math.log(f / SPEC_FMIN) / Math.log(fmax / SPEC_FMIN) * SPEC_B - 0.5, 0, SPEC_B - 1.001); } return m; }
function specPaint(S0, c0, n) {
  const H = SPEC_H, ctx = S0.ctx, img = ctx.createImageData(n, H), d = img.data, B = SPEC_B, map = S0.map || (S0.map = specRowMap(S0.fmax));
  for (let x = 0; x < n; x++) for (let r = 0; r < H; r++) {
    const m = map[r], i0 = Math.floor(m), fr = m - i0, base = (c0 + x) * B, db = S0.db[base + i0] * (1 - fr) + S0.db[base + i0 + 1] * fr, v = clamp((db - (SPEC_TOP - SPEC_RANGE)) / SPEC_RANGE, 0, 1), li = Math.round(v * 255) * 3, o = (r * n + x) * 4;
    d[o] = SPEC_PAL[li]; d[o + 1] = SPEC_PAL[li + 1]; d[o + 2] = SPEC_PAL[li + 2]; d[o + 3] = 255;
  }
  ctx.putImageData(img, c0, 0);
}
/* the sound the picture is made from: after the cleaning stage (Noise reduction, then Spectra's rectangles), so the picture shows what those did. EQ, Imager and Level have their own pictures. */
function specSource() { const d = AE.d; if (!d) return S.audio.buffer; const r = prePeek(d.fx, false); return r ? r.buffer : fxActive(d.fx, fxChannels()).includes('noise') ? null : S.audio.buffer; }
function specSync() { if (AE.view !== 'spec' || !AE.d || !S.audio) return; if (S.audio.disk) { specSyncDisk(); return; } const buf = specSource(); if (!buf || (AE.spec && AE.spec.buf === buf)) return; specStart(buf); }
function specStart(buf) {
  if (S.audio.disk) { specSyncDisk(); return; }
  buf = buf || specSource() || S.audio.buffer; const old = AE.spec; if (old && old.buf === buf) return;
  if (old && old.worker) { try { old.worker.terminate(); } catch (e) {} }
  const sr = buf.sampleRate, len = buf.length, mono = new Float32Array(len), a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
  const cols = Math.max(1, Math.floor((len - SPEC_N) / (SPEC_HOP * sr)) + 1), cv = document.createElement('canvas'); cv.width = cols; cv.height = SPEC_H;
  const S0 = AE.spec = { buf, t0: 0, cs: SPEC_HOP, cols, db: new Float32Array(cols * SPEC_B), cv, ctx: cv.getContext('2d'), done: 0, sr, fmax: Math.min(20000, sr / 2 * 0.98) };
  if (old && old.cols === cols) { S0.ctx.drawImage(old.cv, 0, 0); S0.db.set(old.db); S0.done = cols; }          // the old picture stays until the new one paints over it
  const fmax = S0.fmax, got = (c0, data, n) => { if (AE.spec !== S0) return; S0.db.set(data, c0 * SPEC_B); specPaint(S0, c0, n); S0.done = Math.max(S0.done, c0 + n); aeAnim(); };
  (async () => {
  for (let i = 0; i < len; i += 1 << 20) {          // the mono mix in slices, so a long recording never holds the screen still while tools and pictures are moving
    for (let j = i, e = Math.min(len, i + (1 << 20)); j < e; j++) mono[j] = b ? (a[j] + b[j]) * 0.5 : a[j];
    if (i + (1 << 20) < len) { await new Promise(r => setTimeout(r)); if (AE.spec !== S0) return; }
  }
  try {
    const url = URL.createObjectURL(new Blob([SPEC_CODE + '\nonmessage = function (e) { var m = e.data; specRun(m.mono, m.sr, m.hop, m.N, m.H, m.fmin, m.fmax, function (c0, data, n) { postMessage({ t: "p", c0: c0, data: data, n: n }, [data.buffer]); }); postMessage({ t: "d" }); };'], { type: 'text/javascript' }));
    const w = S0.worker = new Worker(url); URL.revokeObjectURL(url);
    w.onmessage = e => { if (e.data.t === 'p') got(e.data.c0, e.data.data, e.data.n); };
    w.onerror = () => { S0.worker = null; specFallback(S0, mono, sr, fmax, got); };
    w.postMessage({ mono, sr, hop: SPEC_HOP, N: SPEC_N, H: SPEC_B, fmin: SPEC_FMIN, fmax }, [mono.buffer]);
  } catch (e) { specFallback(S0, mono, sr, fmax, got); }
  })();
}
/* a recording on the disk store: the picture is made for the stretch that is on screen (about 1200 columns across it, each the average of a few slices), so it is ready in a moment whatever the length, and again when you zoom or move. What was on screen stays, stretched, until the new one arrives. */
const SPEC_COLS = 1200;
function specSyncDisk() {
  if (AE.view !== 'spec' || !AE.d || !S.audio || !S.audio.disk) return;
  const L = S.audio.duration, [r0, r1] = AE.zoom ? [AE.zoom.lo, AE.zoom.hi] : aeFull(), lo = clamp(r0, 0, L), hi = clamp(r1, 0, L); if (hi - lo < 0.05) return;          // the stretch the view is heading for, not where it is in the middle of a glide
  const rc = fxRecipe(AE.d.fx, audCh()), key = JSON.stringify([rc.noise, rc.edits]) + '|' + lo.toFixed(3) + '|' + hi.toFixed(3), cur = AE.spec;
  if (cur && cur.key === key) return; if (AE.specAsk === key) return;
  AE.specLoad = { key, f: 0, t: performance.now() }; aeAnim();          // the picture says it is being made until it is in
  clearTimeout(AE.specT); AE.specT = setTimeout(async () => {
    if (AE.view !== 'spec' || !AE.d) return; if (AE.specBusy) { AE.specAgain = true; return; }
    AE.specBusy = true; AE.specAsk = key; const stale = () => AE.specAsk !== key || AE.view !== 'spec';
    try {
      const rec = fxRecipe(AE.d.fx, audCh()), span = hi - lo, K = clamp(Math.round(span / SPEC_COLS / SPEC_HOP), 1, 4), r = await DISK.specScan(rec, { t0: lo, t1: hi, cols: SPEC_COLS, K }, { stale, onProgress: f => { if (AE.specLoad && AE.specLoad.key === key) AE.specLoad.f = f; } });
      if (!stale() && AE.d) {
        const cv = document.createElement('canvas'); cv.width = SPEC_COLS; cv.height = SPEC_H;
        const S0 = { disk: true, key, t0: lo, cs: span / SPEC_COLS, cols: SPEC_COLS, db: r.db, cv, ctx: cv.getContext('2d'), done: SPEC_COLS, sr: S.audio.sr, fmax: Math.min(20000, S.audio.sr / 2 * 0.98) };
        specPaint(S0, 0, SPEC_COLS); AE.specRev = { t: performance.now(), wipe: !AE.spec }; AE.spec = S0; aeAnim();
      }
    } catch (e) { if (e !== STALE) console.error(e); }
    if (AE.specLoad && AE.specLoad.key === key) AE.specLoad = null;
    AE.specBusy = false; if (AE.specAgain) { AE.specAgain = false; specSyncDisk(); }
  }, AE.spec ? 140 : 0);
}
function specFallback(S0, mono, sr, fmax, got) {          // no workers: the same analysis in the page, a slice at a time
  const run = new Function(SPEC_CODE + '; return specRun;')(), q = [];
  run(mono, sr, SPEC_HOP, SPEC_N, SPEC_B, SPEC_FMIN, fmax, (c0, data, n) => q.push([c0, data, n]));
  (function pump() { const t = q.shift(); if (!t || AE.spec !== S0) return; got(t[0], t[1], t[2]); setTimeout(pump, 0); })();
}
/* the picture for the part of the time axis that is on screen */
function specDraw(c, top, bot) {
  const S0 = AE.spec; if (!S0) return; const L = S.audio.duration, x0 = AE_PAD, x1 = aeW() - AE_PAD, t0 = Math.max(0, aeT(x0)), t1 = Math.min(L, aeT(x1));
  if (t1 <= t0) return; const cs = S0.cs, ta = Math.max(t0, S0.t0), tb = Math.min(t1, S0.t0 + S0.cols * cs), sx = clamp((ta - S0.t0) / cs, 0, S0.cols), sx1 = clamp((tb - S0.t0) / cs, 0, S0.cols); if (sx1 - sx < 0.01) return;          // the picture covers a stretch of its own (all of it for a recording in memory)
  c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(S0.cv, sx, 0, sx1 - sx, SPEC_H, aeX(ta), top, aeX(tb) - aeX(ta), bot - top); c.restore();
  if (S0.done < S0.cols) { const fx = aeX(S0.t0 + S0.done * cs); c.fillStyle = 'rgba(8,10,24,.55)'; c.fillRect(fx, top, Math.max(0, x1 - fx), bot - top); }          // not analysed yet
}
const specY = (f, top, bot) => bot - specFrac(f, AE.spec ? AE.spec.fmax : 20000) * (bot - top);
function specAxis(c, top, bot) {
  const S0 = AE.spec; if (!S0) return;
  c.save(); c.font = '10px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'left';
  [[100, '100'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']].forEach(([f, t]) => { if (f > S0.fmax) return; const y = Math.round(specY(f, top, bot)) + 0.5; c.globalAlpha = 0.16; c.fillStyle = '#fff'; c.fillRect(AE_PAD, y, aeW() - 2 * AE_PAD, 1); c.globalAlpha = 0.78; c.fillStyle = '#fff'; c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 3; c.fillText(t, AE_PAD + 14, y - 0.5); });
  c.restore();
}
function specHover(c, top, bot) {
  const m = AE.mxy, S0 = AE.spec; if (!m || !S0 || AE.drag || AE.nsDrag) return; const t = aeT(m.x); if (t < 0 || t > S.audio.duration || m.y < top || m.y > bot) return;
  const ra = specRaw(SPEC_FMIN), rb = specRaw(S0.fmax), f = specRawInv(ra + (bot - m.y) / (bot - top) * (rb - ra)), col = clamp(Math.floor((t - S0.t0) / S0.cs), 0, S0.cols - 1), inside = t >= S0.t0 && t <= S0.t0 + S0.cols * S0.cs, band = clamp(Math.round(Math.log(f / SPEC_FMIN) / Math.log(S0.fmax / SPEC_FMIN) * SPEC_B - 0.5), 0, SPEC_B - 1);
  const db = inside && col < S0.done ? S0.db[col * SPEC_B + band] : null, txt = fmt(t, 1) + '   ' + (f >= 1000 ? (f / 1000).toFixed(2) + 'kHz' : Math.round(f) + 'Hz') + (db != null ? '   ' + Math.round(db) + 'dB' : '');
  c.save(); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(m.x + 0.5, top); c.lineTo(m.x + 0.5, bot); c.moveTo(AE_PAD, m.y + 0.5); c.lineTo(aeW() - AE_PAD, m.y + 0.5); c.stroke(); c.setLineDash([]);
  c.font = '600 11px "Instrument Sans",system-ui,sans-serif'; const w = c.measureText(txt).width + 16, bx = clamp(m.x + 12, 4, aeW() - w - 4), by = clamp(m.y - 30, top + 4, bot - 24); roundRect(c, bx, by, w, 20, 8); c.fillStyle = 'rgba(14,17,40,.88)'; c.fill(); c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(txt, bx + 8, by + 10.5); c.restore();
}
/* ---------------- Spectra: rectangles on the picture ----------------
   Drag over a blip, a hum, or a squeak. Each rectangle is healed (bridged from the sound around it) or turned down. They are listed beside the picture, and each can be picked, changed or removed. */
const SP = { shape: 'box', mode: 'heal', db: 24, sel: -1, drag: null, hover: -1, arm: false };
const spHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(f));
const spInSpec = () => AE.tool === 'spec' && AE.view === 'spec' && AE.spec;
/* nothing is drawn until Draw is pressed; without it a click on the picture only selects an edit or moves the playhead */
const spArmed = () => spInSpec() && SP.arm;
function spArm(on) { SP.arm = !!on; const b = $('#spDraw'); if (b) b.setAttribute('aria-pressed', SP.arm); const cv = $('#aeCanvas'); if (cv && !SP.arm) cv.style.cursor = ''; aeAnim(); }
function spY2F(y, H) { const S0 = AE.spec, top = 10, bot = H - 10, ra = specRaw(SPEC_FMIN), rb = specRaw(S0.fmax); return specRawInv(ra + clamp((bot - y) / (bot - top), 0, 1) * (rb - ra)); }
function spRect(e, H) { return { x0: aeX(e.a), x1: aeX(e.b), y0: specY(e.f1, 10, H - 10), y1: specY(e.f0, 10, H - 10) }; }
function spHit(x, y, H) { const ed = AE.d.fx.spec.edits; for (let i = ed.length - 1; i >= 0; i--) { const r = spRect(ed[i], H); if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return i; } return -1; }
/* the finished drag: a new rectangle in the shape that is chosen */
function spCommit(dr, H) {
  const L = S.audio.duration, S0 = AE.spec, x0 = Math.min(dr.x0, dr.x), x1 = Math.max(dr.x0, dr.x), y0 = Math.min(dr.y0, dr.y), y1 = Math.max(dr.y0, dr.y), sh = SP.shape;
  const needX = sh !== 'band', needY = sh !== 'moment'; if ((needX && x1 - x0 < 6) || (needY && y1 - y0 < 6)) return false;
  const a = sh === 'band' ? 0 : clamp(aeT(x0), 0, L), b = sh === 'band' ? L : clamp(aeT(x1), 0, L), f1 = sh === 'moment' ? S0.fmax : spY2F(y0, H), f0 = sh === 'moment' ? SPEC_FMIN : spY2F(y1, H);
  if (b - a < 0.005 && sh !== 'band') return false;
  aeFx(fx => { fx.spec.edits.push({ a: Math.round(a * 1000) / 1000, b: Math.round(b * 1000) / 1000, f0: Math.round(f0), f1: Math.round(f1), mode: SP.mode, db: SP.db }); }); SP.sel = AE.d.fx.spec.edits.length - 1; spPanel(); return true;
}
function spDelete(i) { aeFx(fx => { fx.spec.edits.splice(i, 1); }); SP.sel = -1; spPanel(); aeAnim(); }
function spPatch(i, patch, slide) { aeFx(fx => { Object.assign(fx.spec.edits[i], patch); }, slide); }
function spLabel(e) {
  const L = S.audio.duration, whole = e.a <= 0.01 && e.b >= L - 0.01, allPitch = e.f0 <= SPEC_FMIN + 1 && AE.spec && e.f1 >= AE.spec.fmax - 2;
  return [whole ? 'Whole sound' : fmt(e.a) + ' to ' + fmt(e.b), allPitch ? 'All pitches' : spHz(e.f0) + ' to ' + spHz(e.f1) + 'Hz'];
}
function spPanel() {
  if (!AE.d || !$('#spList')) return; const ed = AE.d.fx.spec.edits, list = $('#spList'); if (SP.sel >= ed.length) SP.sel = -1;
  const sig = JSON.stringify(ed) + '|' + SP.sel + '|' + (AE.spec ? AE.spec.fmax : 0);
  if (list._sig !== sig) {
    list._sig = sig;
    const prevN = list._n == null ? ed.length : list._n; list._n = ed.length;          // only an edit that was just added fades in; the rest are redrawn still
    list.innerHTML = ed.map((e, i) => { const lb = spLabel(e); return '<div class="sp-item' + (i >= prevN ? ' in' : '') + (i === SP.sel ? ' on' : '') + '" data-i="' + i + '" tabindex="0"><i class="sp-dot ' + e.mode + '"></i><span class="sp-t"><b>' + lb[0] + '</b><small>' + lb[1] + '</small></span><em>' + (e.mode === 'cut' ? '−' + e.db + 'dB' : 'Heal') + '</em><button class="sp-x" type="button" aria-label="Remove" data-x="' + i + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>'; }).join('') || '<div class="sp-empty" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="6" width="16" height="12" rx="2" stroke-dasharray="3 3"/></svg></div>';
  }
  $('#spClear').disabled = !ed.length;
  const cur = SP.sel >= 0 ? ed[SP.sel] : null, mode = cur ? cur.mode : SP.mode, db = cur ? cur.db : SP.db;
  [['spShape', SP.shape], ['spMode', mode]].forEach(([id, v]) => { const r = document.querySelector('#' + id + ' input[value=' + v + ']'); if (r && !r.checked) { r.checked = true; const sg = $('#' + id); if (sg._place) sg._place(true); } });
  foldSet('#spAmtF', mode === 'cut'); if (document.activeElement !== $('#spAmt')) $('#spAmt').value = db; $('#spAmtVal').textContent = db + 'dB';
}
function spBind() {
  document.querySelectorAll('input[name=spShape]').forEach(r => r.addEventListener('change', e => { SP.shape = e.target.value; aeAnim(); }));
  document.querySelectorAll('input[name=spMode]').forEach(r => r.addEventListener('change', e => { SP.mode = e.target.value; if (SP.sel >= 0 && AE.d.fx.spec.edits[SP.sel] && AE.d.fx.spec.edits[SP.sel].mode !== SP.mode) spPatch(SP.sel, { mode: SP.mode }); else spPanel(); }));
  $('#spAmt').addEventListener('input', e => { SP.db = +e.target.value; $('#spAmtVal').textContent = SP.db + 'dB'; if (SP.sel >= 0 && AE.d.fx.spec.edits[SP.sel]) spPatch(SP.sel, { db: SP.db }, true); });
  $('#spAmt').addEventListener('change', () => { AE.sliding = false; });
  $('#spDraw').addEventListener('click', () => spArm(!SP.arm));
  $('#spClear').addEventListener('click', () => { aeFx(fx => { fx.spec.edits = []; }); SP.sel = -1; spPanel(); aeAnim(); });
  const list = $('#spList');
  list.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (x) { spDelete(+x.dataset.x); return; } const it = e.target.closest('.sp-item'); if (!it) return; SP.sel = SP.sel === +it.dataset.i ? -1 : +it.dataset.i; spPanel(); aeAnim(); });
  list.addEventListener('keydown', e => { const it = e.target.closest('.sp-item'); if (!it) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); SP.sel = +it.dataset.i; spPanel(); aeAnim(); } else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); spDelete(+it.dataset.i); } });
  list.addEventListener('pointerover', e => { const it = e.target.closest('.sp-item'), i = it ? +it.dataset.i : -1; if (i !== SP.hover) { SP.hover = i; aeAnim(); } });
  list.addEventListener('pointerleave', () => { if (SP.hover !== -1) { SP.hover = -1; aeAnim(); } });
}
/* the rectangles on the picture */
function spOverlay(c, W, H) {
  const ed = AE.d.fx.spec.edits, tool = AE.tool === 'spec', L = S.audio.duration; c.save(); c.beginPath(); c.rect(AE_PAD, 10, W - 2 * AE_PAD, H - 20); c.clip();
  const box = (r, mode, state) => {
    const w = Math.max(2, r.x1 - r.x0), h = Math.max(2, r.y1 - r.y0); roundRect(c, r.x0, r.y0, w, h, 4);
    c.fillStyle = mode === 'cut' ? 'rgba(251,146,60,' + (state ? .3 : .16) + ')' : 'rgba(52,211,153,' + (state ? .3 : .15) + ')'; c.fill();
    c.lineWidth = state === 2 ? 2 : 1.2; c.strokeStyle = state ? '#fff' : 'rgba(255,255,255,.78)'; c.setLineDash(state === 2 ? [] : [4, 3]); c.shadowColor = 'rgba(0,0,0,.5)'; c.shadowBlur = 3; c.stroke(); c.setLineDash([]); c.shadowBlur = 0;
    if (state === 2) { c.fillStyle = '#fff'; [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 3.5, 0, 6.2832); c.fill(); }); }
  };
  ed.forEach((e, i) => { const r = spRect(e, H); if (r.x1 < AE_PAD - 4 || r.x0 > W) return; box(r, e.mode, i === SP.sel ? 2 : i === SP.hover || (AE.spHov === i) ? 1 : 0); });
  const dr = SP.drag; if (dr && dr.moved && SP.arm) {
    const sh = SP.shape, x0 = sh === 'band' ? aeX(0) : Math.min(dr.x0, dr.x), x1 = sh === 'band' ? aeX(L) : Math.max(dr.x0, dr.x), y0 = sh === 'moment' ? 10 : Math.min(dr.y0, dr.y), y1 = sh === 'moment' ? H - 10 : Math.max(dr.y0, dr.y);
    box({ x0, x1, y0, y1 }, SP.mode, 1);
  }
  c.restore();
  if (tool && SP.arm && !ed.length && !dr) { const txt = 'Drag over a sound to fix'; c.save(); c.font = '600 12px "Instrument Sans",system-ui,sans-serif'; const w = c.measureText(txt).width + 26; roundRect(c, W / 2 - w / 2, 14, w, 24, 12); c.fillStyle = 'rgba(14,17,40,.78)'; c.fill(); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, W / 2, 26.5); c.restore(); }
}
/* the waveform's frame: a pane of frosted glass. A light from above, a soft shade at the bottom, a bright hairline just inside the top edge */
const AE_RULER = 24;          // the ruler: the time labels and the tabs of the start and end sit in this band across the top
/* the picture's paper: a clean panel with a faint depth to it, a time grid that follows the zoom, a dotted centre line, so the picture reads as an instrument and not just a shape */
const PKID = new WeakMap(); let PKN = 0; const pkId = a => PKID.get(a) || (PKID.set(a, ++PKN), PKN);
function aeTicks(lo, hi, px) { const span = hi - lo, want = span / Math.max(1, px / 90); let st = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find(v => v >= want) || 3600; return st; }
/* the ruler across the top of the picture, the same in the wave and the spectrogram: its floor, a tall tick and a time at every step, and small ticks between (as in the video timeline) */
function aeRuler(c, W, C, lo, hi, grid, Hc) {
  const x0 = AE_PAD, x1 = W - AE_PAD, st = aeTicks(lo, hi, x1 - x0), k = (x1 - x0) / (hi - lo), first = Math.ceil(lo / st) * st, minor = st / 5;
  c.save(); c.font = '10px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  c.globalAlpha = 0.5; c.fillStyle = C.line; c.fillRect(0, AE_RULER - 1, W, 1);          // the ruler's floor
  c.globalAlpha = 0.55; c.fillStyle = C.muted; for (let t = Math.ceil(lo / minor) * minor, n = 0; t <= hi && n < 400; t += minor, n++) { const x = Math.round(x0 + (t - lo) * k) + 0.5; if (x < x0 - 1 || x > x1 + 1) continue; c.fillRect(x - 0.5, AE_RULER - 5, 1, 4); }          // the small ticks
  for (let t = first, n = 0; t <= hi && n < 80; t += st, n++) {
    const x = Math.round(x0 + (t - lo) * k) + 0.5;
    if (grid) { c.globalAlpha = 0.5; c.fillStyle = C.line; c.fillRect(x, AE_RULER, 1, Hc - AE_RULER); }
    c.globalAlpha = 0.8; c.fillStyle = C.muted; c.fillRect(x - 0.5, AE_RULER - 9, 1, 8);          // the tall tick
    if (x < x0 + 22 || x > x1 - 34) continue; c.globalAlpha = 0.85; const m = Math.floor(t / 60), sec = t - m * 60; c.fillText(st < 1 ? m + ':' + sec.toFixed(1).padStart(4, '0') : m + ':' + String(Math.round(sec)).padStart(2, '0'), x + 4, 15);
  }
  c.restore();
}
function aePaper(c, W, H, Hc, C, lo, hi, cy, half, plain) {
  roundRect(c, 0.5, 0.5, W - 1, H - 1, 12); c.fillStyle = C.panel2; c.fill();
  c.save(); roundRect(c, 0.5, 0.5, W - 1, H - 1, 12); c.clip();
  let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(120,130,170,0)'); g.addColorStop(1, 'rgba(120,130,170,.10)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
  const x0 = AE_PAD, x1 = W - AE_PAD;
  aeRuler(c, W, C, lo, hi, !plain, Hc);
  if (plain) { c.restore(); c.lineWidth = 1; c.strokeStyle = C.line; roundRect(c, 0.5, 0.5, W - 1, H - 1, 12); c.stroke(); return; }
  c.globalAlpha = 1; c.strokeStyle = C.line; c.lineWidth = 1; c.setLineDash([2, 4]); c.globalAlpha = 0.55;
  c.setLineDash([]);
  c.globalAlpha = 0.8; c.strokeStyle = C.accent; c.lineWidth = 1.4; c.lineCap = 'round'; c.setLineDash([0.1, 6]); c.beginPath(); c.moveTo(x0, cy); c.lineTo(x1, cy); c.stroke(); c.setLineDash([]);
  c.restore(); c.globalAlpha = 1; c.lineWidth = 1; c.strokeStyle = C.line; roundRect(c, 0.5, 0.5, W - 1, H - 1, 12); c.stroke();
}
/* the heights the wave is drawn from. With the limiter on, each 10ms is brought down by what the limiter takes off there (read from the limiter's own output when the loudness was measured), so the picture is the sound that comes out */
function aeShownPeaks(d) {
  const pk = aePeaks(d), l = limOn(d) ? limPeek(d) : null; if (!l || !l.shape) return pk;
  const m = AE.limPk; if (m && m.pk === pk && m.shape === l.shape && m.vs === d.vStart) return m.out;
  const out = Float32Array.from(pk), sh = l.shape, k = 1 / (100 * l.per), o = d.vStart / l.per; for (let j = 0; j < out.length; j++) { const i = Math.floor(j * k - o + 0.5); if (i >= 0 && i < sh.length) out[j] *= sh[i]; }
  AE.limPk = { pk, shape: sh, vs: d.vStart, out }; return out;
}
/* when the heights change (a slider moved, a better copy arrived) the wave eases from the old shape to the new one instead of jumping */
function aePeakMorph(pk) {
  const now = performance.now();
  if (AE.pkCur !== pk) { AE.pkPrev = AE.pkCur ? (AE.pkShown === AE.pkOut ? Float32Array.from(AE.pkShown) : (AE.pkShown || AE.pkCur)) : null; AE.pkCur = pk; AE.pkT = now; }
  const k = clamp((now - AE.pkT) / 160, 0, 1), e = 1 - Math.pow(1 - k, 3);
  if (!AE.pkPrev || k >= 1 || reducedMotion() || AE.pkPrev.length !== pk.length) { AE.pkAnim = false; AE.pkShown = pk; return pk; }
  AE.pkAnim = true; const o = AE.pkOut && AE.pkOut.length === pk.length ? AE.pkOut : (AE.pkOut = new Float32Array(pk.length)), a = AE.pkPrev;
  for (let i = 0; i < pk.length; i++) o[i] = a[i] + (pk[i] - a[i]) * e;
  AE.pkShown = o; return o;
}
/* the transport floats over the lower edge of the picture; everything that is drawn for the eye stays above it (full screen has its own rows, so no room is kept there) */
const aeInsetNow = () => { const dlg = $('#audioDlg'); if (dlg.classList.contains('afull') || window.innerWidth <= 760) return 0; const bar = dlg.querySelector('.ae-bar'); return bar && bar.offsetHeight ? bar.offsetHeight + 8 : 0; };
const aeHc = () => { const cv = $('#aeCanvas'); return Math.max(60, cv.clientHeight - aeInsetNow()); };
/* the columns of the picture: the loudest peak under each pixel (worked out once per picture, not once per pass) */
function aeColumns(src, lo, hi, W, L) {
  const x0 = Math.floor(AE_PAD), x1 = Math.floor(W - AE_PAD), n = Math.max(0, x1 - x0 + 1), out = new Float32Array(n), k = (hi - lo) / (W - 2 * AE_PAD);
  for (let j = 0; j < n; j++) {
    const t0 = lo + (x0 + j - AE_PAD) * k, t1 = t0 + k; if (t1 < 0 || t0 >= L) { out[j] = -1; continue; }
    const i0 = Math.max(0, Math.floor(t0 * 100)), i1 = Math.min(src.length - 1, Math.max(i0, Math.ceil(t1 * 100)));
    let m = 0; for (let i = i0; i <= i1; i++) if (src[i] > m) m = src[i]; out[j] = m;
  }
  return out;
}
/* the part of the picture that only changes when the sound, the zoom or the size does: the paper and the wave (or the spectrogram). It is drawn once and copied for every frame, so playing and moving sliders stay light. */
function aePaintBase(c, o) {
  const { W, H, Hc, C, lo, hi, cy, half, pk, pk0, G, cap, changed, specOn, L } = o;
  c.setTransform(AE.dpr, 0, 0, AE.dpr, 0, 0); c.clearRect(0, 0, W, H);
  aePaper(c, W, Hc, Hc, C, lo, hi, cy, half, specOn);
  c.save(); roundRect(c, 1, 1, W - 2, Hc - 2, 9); c.clip();
  if (specOn) { specDraw(c, AE_RULER + 2, Hc - 8); specAxis(c, AE_RULER + 2, Hc - 8); c.restore(); return; }
  const x0 = Math.floor(AE_PAD), cols = aeColumns(pk, lo, hi, W, L), cols0 = changed ? aeColumns(pk0, lo, hi, W, L) : null;
  const bars = (arr, g, ghost) => {
    const base = c.fillStyle;
    for (let j = 0; j < arr.length; j++) {
      const m = arr[j]; if (m < 0) continue; const x = x0 + j, amp = cap && !ghost ? Math.min(cap, m * g) : m * g, a = Math.max(1, Math.min(1, amp) * half);          // cap: the limiter's ceiling, which nothing that comes out goes over
      if (ghost) { c.fillRect(x, cy - a, 1, 1); c.fillRect(x, cy + a - 1, 1, 1); continue; }
      c.fillRect(x, cy - a, 1, a * 2);
      if (amp > 1) { c.fillStyle = '#e5484d'; c.fillRect(x, cy - half, 1, 3); c.fillRect(x, cy + half - 3, 1, 3); c.fillStyle = base; }
    }
  };
  const wg = c.createLinearGradient(0, cy - half, 0, cy + half); wg.addColorStop(0, 'rgba(255,255,255,0)'); wg.addColorStop(0.5, 'rgba(255,255,255,.42)'); wg.addColorStop(1, 'rgba(255,255,255,0)');          // a lighter core, so the wave reads as a rounded form
  if (changed) { c.save(); c.fillStyle = C.ink; c.globalAlpha = 0.45; bars(cols0, 1, true); c.restore(); }
  c.save(); c.translate(0, 2.5); c.fillStyle = C.ink; c.globalAlpha = 0.09; bars(cols, G, false); c.restore();               // a soft shadow underneath
  c.fillStyle = C.wave; c.globalAlpha = 1; bars(cols, G, false);
  c.save(); c.fillStyle = wg; bars(cols, G, false); c.restore();
  c.restore();
}
/* a CSS color as rgba(…) with the given opacity */
function withAlpha(col, a) { const t = withAlpha.c || (withAlpha.c = document.createElement('canvas').getContext('2d', { willReadFrequently: true })); t.clearRect(0, 0, 1, 1); t.fillStyle = col; t.fillRect(0, 0, 1, 1); const d = t.getImageData(0, 0, 1, 1).data; return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + a + ')'; }
/* the spectrum picture being made (a long recording takes a few seconds): the paper stays empty (or the old picture fades back) with a small label, a spinner and the share done; when the picture is in it is drawn in
   with a soft wipe from the left (or the old one clears) */
function specVeil(c, W, Hc, hadPicture) {
  const top = AE_RULER, L = AE.specLoad, R = AE.specRev, C = TL.C, now = performance.now();
  if (L) {
    if (hadPicture) { c.fillStyle = C.panel2; c.globalAlpha = 0.6; c.fillRect(0, top, W, Hc - top); c.globalAlpha = 1; }
    c.font = '600 12.5px "Instrument Sans",system-ui,sans-serif'; const txt = (hadPicture ? 'Repainting the spectrum' : 'Painting the spectrum') + (L.f > 0.02 ? ' ' + Math.round(L.f * 100) + '%' : ''), tw = Math.ceil(c.measureText((hadPicture ? 'Repainting the spectrum' : 'Painting the spectrum') + ' 100%').width), w = tw + 46, h = 34, x = W / 2 - w / 2, y = top + (Hc - top) / 2 - h / 2;
    c.save(); c.shadowColor = 'rgba(20,24,60,.16)'; c.shadowBlur = 14; c.shadowOffsetY = 3; roundRect(c, x, y, w, h, 17); c.fillStyle = C.bg; c.fill(); c.restore();
    roundRect(c, x, y, w, h, 17); c.strokeStyle = C.line; c.lineWidth = 1; c.stroke();
    const a0 = reducedMotion() ? 0 : now / 260, cx = x + 20, cy = y + h / 2;
    c.lineWidth = 2; c.lineCap = 'round'; c.strokeStyle = C.line; c.beginPath(); c.arc(cx, cy, 6.5, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = C.accent; c.beginPath(); c.arc(cx, cy, 6.5, a0, a0 + 1.6); c.stroke();
    c.fillStyle = C.ink; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(txt, x + 34, cy + 0.5);
    if (L.f > 0.02) { roundRect(c, x + 34, y + h - 7, w - 50, 2, 1); c.fillStyle = C.line; c.fill(); roundRect(c, x + 34, y + h - 7, Math.max(2, (w - 50) * L.f), 2, 1); c.fillStyle = C.accent; c.fill(); }
  } else if (R) {
    const k = reducedMotion() ? 1 : (now - R.t) / 700; if (k >= 1) { AE.specRev = null; return; } const e = 1 - Math.pow(1 - k, 3);
    if (R.wipe) { const fe = 150, edge = AE_PAD + e * (W + fe - AE_PAD); c.save(); c.fillStyle = C.panel2; c.fillRect(Math.floor(edge) - 1, top, W - edge + 2, Hc - top); const gg = c.createLinearGradient(edge - fe, 0, edge, 0), col = C.panel2; gg.addColorStop(0, withAlpha(col, 0)); gg.addColorStop(1, withAlpha(col, 1)); c.fillStyle = gg; c.fillRect(edge - fe, top, fe, Hc - top); c.restore(); }
    else { c.fillStyle = C.panel2; c.globalAlpha = 0.6 * (1 - e); c.fillRect(0, top, W, Hc - top); c.globalAlpha = 1; }
  }
}
function aeDraw() {
  if (!AE.d || $('#audioDlg').hidden) return;
  const cv = $('#aeCanvas'), c = cv.getContext('2d'), W = AE.cw = cv.clientWidth, H = cv.clientHeight, Hc = Math.max(60, H - aeInsetNow()), d = AE.d, C = TL.C, L = S.audio.duration, endT = aeEnd(d);
  const dvs = AE.dvs = AE.drag ? hsSnap('ae-vs', d.vStart) : hsGet('ae-vs', d.vStart), end = AE.dve = AE.drag ? hsSnap('ae-ve', endT) : hsGet('ae-ve', endT);
  { const tg = AE.zoom ? [AE.zoom.lo, AE.zoom.hi] : aeFull(), still = AE.drag || AE.scrub || AE.nsDrag || AE.zdrag; AE.rlo = still ? hsSnap('ae-rlo', tg[0]) : hsGet('ae-rlo', tg[0]); AE.rhi = still ? hsSnap('ae-rhi', tg[1]) : hsGet('ae-rhi', tg[1]); }
  const pk0 = S.audio.peaks, pk = aePeakMorph(aeShownPeaks(d)), cap = limOn(d) ? Math.pow(10, (LIM_CEIL - LIM_GUARD) / 20) : 0, G = hsGet('ae-lv', AE.G || 1), cy = AE_RULER + (Hc - AE_RULER) / 2 - 2, half = (Hc - AE_RULER) / 2 - 8, x0 = AE_PAD, x1 = W - AE_PAD, changed = Math.abs(G - 1) > 0.01 || pk !== pk0, e = clamp(hsGet('ae-vt', AE.view === 'spec' ? 1 : 0), 0, 1), showSpec = AE.view === 'spec' || e > 0.004, showWave = AE.view !== 'spec' || e < 0.996, specOn = showSpec && !!AE.spec;          // e: how far the picture has turned from the waveform (0) to the spectrum (1)
  // the base pictures (the waveform and the spectrum, each on its own canvas): redrawn only when something they show has changed
  const baseOf = (slot, sp) => {
    const key = [cv.width, cv.height, Hc, AE.rlo.toFixed(5), AE.rhi.toFixed(5), sp ? (AE.spec ? pkId(AE.spec.cv) + ':' + AE.spec.done : AE.specLoad ? 'w' : 0) : pkId(pk) + '|' + pkId(pk0) + '|' + G.toFixed(4) + '|' + changed + '|' + cap, C.wave, C.ink, C.panel2, C.line, C.muted, C.accent, !sp && AE.pkAnim ? performance.now() : 0].join('|');
    const b = AE[slot] || (AE[slot] = document.createElement('canvas'));
    if (AE[slot + 'Key'] !== key || b.width !== cv.width || b.height !== cv.height) {
      b.width = cv.width; b.height = cv.height; AE[slot + 'Key'] = key;
      aePaintBase(b.getContext('2d'), { W, H, Hc, C, lo: AE.rlo, hi: AE.rhi, cy, half, pk, pk0, G, cap, changed, specOn: sp, L });
    }
    return b;
  };
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height);
  if (showWave) c.drawImage(baseOf('baseW', false), 0, 0);
  if (showSpec) {
    const sb = baseOf('baseS', true);
    if (!showWave) c.drawImage(sb, 0, 0);
    else {          // the two pictures sit in the same frame: the ruler, the border and the handles stay put, and the spectrum settles into place over the waveform (or lifts away from it)
      const k = AE.dpr, ease = 1 - Math.pow(1 - e, 3);
      c.save(); c.beginPath(); c.rect(3 * k, (AE_RULER + 2) * k, cv.width - 6 * k, (Hc - AE_RULER - 5) * k); c.clip();
      c.globalAlpha = e; c.drawImage(sb, 0, (1 - ease) * 9 * k); c.restore();
    }
  } c.setTransform(AE.dpr, 0, 0, AE.dpr, 0, 0);
  c.save(); roundRect(c, 1, 1, W - 2, Hc - 2, 9); c.clip();
  if (specOn) { c.save(); c.globalAlpha = e; spOverlay(c, W, Hc); specHover(c, AE_RULER + 2, Hc - 8); c.restore(); }
  if (showSpec && (AE.specLoad || AE.specRev)) { c.save(); c.globalAlpha = AE.view === 'spec' ? 1 : e; specVeil(c, W, Hc, specOn); c.restore(); }
  // the parts that will not be used
  const xs = aeX(dvs), xe = aeX(end); c.fillStyle = 'rgba(8,10,20,.34)';
  if (xs > x0) c.fillRect(0, 0, xs, Hc); if (xe < x1) c.fillRect(xe, 0, W - xe, Hc);

  // the volume envelope: where the fades take the sound down. It follows the fade settings as they change (length and curve glide), and a faint veil dims the part of the wave the fades remove
  { const fe = aeFadeFn(d), lim = Math.max(0, (end - dvs) / 2), Li = Math.min(fe.Li, lim), Lo = Math.min(fe.Lo, lim); if (Li > 0.001 || Lo > 0.001) {
    const k = (AE.rhi - AE.rlo) / (W - 2 * AE_PAD), xa = Math.max(Math.floor(xs), 0), xb = Math.min(Math.ceil(xe), W), up = [], dn = [];
    const env = t => Math.min(Li > 0.001 ? fe.f((t - dvs) / Li) : 1, Lo > 0.001 ? fe.f((end - t) / Lo) : 1);
    for (let x = xa; x <= xb; x++) { const t = clamp(AE.rlo + (x - AE_PAD) * k, dvs, end); up.push(env(t)); }
    const pass = (wave, mul) => {
    if (wave) { c.save(); c.fillStyle = C.panel2; c.globalAlpha = 0.5 * mul; for (let i = 0; i < up.length; i++) { const v = up[i]; if (v < 0.999) { const h = half * (1 - v); c.fillRect(xa + i, cy - half, 1, h); c.fillRect(xa + i, cy + half - h, 1, h); } } c.restore(); }
    c.strokeStyle = C.fade; c.globalAlpha = 0.6 * mul; c.lineWidth = 1.5; c.lineJoin = c.lineCap = 'round';
    [-1, 1].forEach(sg => { if (!wave && sg > 0) return; c.beginPath(); let down = false; for (let i = 1; i < up.length; i++) { const v = up[i], pv = up[i - 1]; if (v < 0.999 || pv < 0.999) { const y = wave ? cy + sg * half * v : AE_RULER + 4 + (1 - v) * (Hc - AE_RULER - 14), py = wave ? cy + sg * half * pv : AE_RULER + 4 + (1 - pv) * (Hc - AE_RULER - 14); if (!down) { c.moveTo(xa + i - 1, py); down = true; } c.lineTo(xa + i, y); } else down = false; } c.stroke(); });
    c.globalAlpha = 1; };
    if (showWave) pass(true, 1 - e); if (showSpec) pass(false, e); } }
  { const nsA = hsGet('ae-ns', AE.nsel && AE.tool === 'noise' ? 1 : 0); if (AE.nsel) AE.nsShow = AE.nsel; if (nsA > 0.01 && AE.nsShow) { const x1 = aeX(AE.nsShow.a), x2 = aeX(AE.nsShow.b); c.save(); c.globalAlpha = nsA; c.fillStyle = 'rgba(217,119,6,.2)'; c.fillRect(x1, 0, Math.max(1, x2 - x1), H); c.fillStyle = C.turn; c.fillRect(x1, 0, 2, H); c.fillRect(x2 - 2, 0, 2, H); c.restore(); } }
  c.restore();
  if (AE.nsArm) { const txt = 'Drag over isolated noise', w = c.measureText ? (c.font = '600 12px "Instrument Sans",system-ui,sans-serif', c.measureText(txt).width + 26) : 190; c.save(); roundRect(c, W / 2 - w / 2, 12, w, 24, 12); c.fillStyle = 'rgba(217,119,6,.92)'; c.shadowColor = 'rgba(217,119,6,.45)'; c.shadowBlur = 10; c.fill(); c.shadowBlur = 0; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, W / 2, 24.5); c.restore(); }
  { const za = hsGet('ae-zb', AE.zoom ? 1 : 0); if (za > 0.01) { const [flo, fhi] = aeFull(), fx = t => x0 + (t - flo) / (fhi - flo) * (x1 - x0), tx0 = fx(AE.rlo), tx1 = fx(AE.rhi); c.save(); c.globalAlpha = za; roundRect(c, x0, Hc - 6, x1 - x0, 3, 1.5); c.fillStyle = C.line; c.fill(); roundRect(c, tx0, Hc - 6, Math.max(8, tx1 - tx0), 3, 1.5); c.fillStyle = C.accent; c.globalAlpha = 0.55 * za; c.fill(); c.restore(); } }
  if (AE.stopMark) { const px = Math.round(aeX(AE.stopMark.t)); c.save(); c.strokeStyle = C.accent; c.globalAlpha = 0.7; c.lineWidth = 1.5; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(px, AE_RULER); c.lineTo(px, Hc - 1); c.stroke(); c.restore(); }          // where the page turn holds the handle
  // the start and end: a thin line down the picture, with a grip tab in the ruler (the same design as the video timeline)
  [['start', xs, 1], ['end', xe, -1]].forEach(([w, x, dir]) => {
    const grabbed = AE.drag && AE.drag.which === w, sc = hsGet('ae-' + w, grabbed ? 1.12 : AE.hover === w ? 1.05 : 1), px = Math.round(x), tw = 8 * sc, th = 14 * sc;
    c.save(); c.fillStyle = C.accent; c.fillRect(px - 1, 0, 2, Hc - 1);
    if (grabbed || AE.hover === w) { c.shadowColor = 'rgba(63,85,230,.45)'; c.shadowBlur = 8 * sc; }
    roundRect(c, dir > 0 ? px + 2 : px - 2 - tw, (AE_RULER - th) / 2, tw, th, 3 * sc); c.fill(); c.restore();
  });
  // the playhead is the top layer: one unbroken line from its head in the ruler to the bottom edge, over the lines and the tabs
  { const px = aeX(AE.pos); c.fillStyle = C.play; c.fillRect(px - 1, 0, 2, Hc); c.beginPath(); c.moveTo(px - 5, 0); c.lineTo(px + 5, 0); c.lineTo(px, 8); c.closePath(); c.fill(); }
}
/* dragging the handles (staying inside the audio, with a snap at its ends) */
function aeHit(x) { const d = AE.d, xs = aeX(d.vStart), xe = aeX(aeEnd(d)); if (x >= xs - 10 && x <= xs + 14) return 'start'; if (x >= xe - 14 && x <= xe + 10) return 'end'; return null; }
function aeBindCanvas() {
  const cv = $('#aeCanvas');
  const pt = e => { const r = cv.getBoundingClientRect(); return e.clientX - r.left; };
  const barDrag = e => { const [flo, fhi] = aeFull(), r = AE.zoom; if (!r) return; const span = r.hi - r.lo, t = flo + (pt(e) - AE_PAD) / (aeW() - 2 * AE_PAD) * (fhi - flo); aeZoomSet(t - span / 2, t + span / 2, true); };
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !AE.d) return; if (AE.zoom && e.clientY - cv.getBoundingClientRect().top > aeHc() - 12 && e.clientY - cv.getBoundingClientRect().top < aeHc()) { cv.setPointerCapture(e.pointerId); AE.zdrag = true; barDrag(e); return; }
    const w = aeHit(pt(e));
    if (!w && spInSpec()) { const H = aeHc(), y = e.clientY - cv.getBoundingClientRect().top, x = pt(e), hit = spHit(x, y, H); if (SP.arm || hit >= 0) { cv.setPointerCapture(e.pointerId); SP.drag = { x0: x, y0: y, x, y, moved: false, hit }; return; } }
    if (!w && AE.tool === 'noise' && AE.nsArm) { const t0 = clamp(aeT(pt(e)), 0, S.audio.duration); cv.setPointerCapture(e.pointerId); AE.nsDrag = { t0, x0: pt(e), moved: false }; return; }
    if (!w) { const t = aeT(pt(e)), d = AE.d; if (t >= Math.max(0, d.vStart) && t <= Math.min(aeEnd(d), S.audio.duration)) { cv.setPointerCapture(e.pointerId); AE.scrub = { wasPlaying: AE.playing }; if (AE.playing) aeStop(); aeSeek(t); } return; }
    cv.setPointerCapture(e.pointerId); aePush(); AE.drag = { which: w, moved: false, dx: (w === 'start' ? AE.d.vStart : aeEnd(AE.d)) - aeT(pt(e)) }; aeAnim();
  });
  cv.addEventListener('pointermove', e => {
    if (!AE.d) return; const x = pt(e), dr = AE.drag, L = S.audio.duration; AE.mxy = { x, y: e.clientY - cv.getBoundingClientRect().top }; if (AE.view === 'spec') aeAnim();
    if (AE.zdrag) { barDrag(e); return; }
    if (SP.drag) { const dr = SP.drag; dr.x = x; dr.y = AE.mxy.y; if (!dr.moved && Math.hypot(dr.x - dr.x0, dr.y - dr.y0) > 4) dr.moved = true; aeAnim(); return; }
    if (AE.nsDrag) { const nd = AE.nsDrag; if (!nd.moved && Math.abs(x - nd.x0) < 4) return; nd.moved = true; const t = clamp(aeT(x), 0, L); AE.nsel = { a: Math.min(nd.t0, t), b: Math.max(nd.t0, t) }; aeNrPanel(); aeDraw(); aeAnim(); return; }
    if (AE.scrub) { aeSeek(aeT(x)); return; }
    if (!dr) { const h = aeHit(x); if (h !== AE.hover) { AE.hover = h; aeAnim(); } if (spInSpec()) { const hv = spHit(x, AE.mxy.y, aeHc()); if (hv !== AE.spHov) { AE.spHov = hv; aeAnim(); } } cv.style.cursor = h ? 'ew-resize' : spArmed() ? 'crosshair' : AE.tool === 'noise' && AE.nsArm ? 'crosshair' : (aeT(x) >= Math.max(0, AE.d.vStart) && aeT(x) <= Math.min(aeEnd(AE.d), S.audio.duration) ? 'pointer' : 'default'); return; }
    let t = aeT(x) + dr.dx; const d = AE.d, st = Math.max(0, d.vStart), en = Math.min(aeEnd(d), L);
    const stop = aeTrimStop(dr.which, t, d); t = stop.t; if (stop.turn) { if (!dr.said) { dr.said = true; aeTrimSaid(dr.which, stop); } else { clearTimeout(AE.stopT); AE.stopT = setTimeout(aeStopClear, 4200); } }
    if (dr.which === 'start') { t = clamp(t, 0, en - 1); if (Math.abs(aeX(t) - aeX(0)) <= 8) t = 0; if (t !== d.vStart) { d.vStart = t; dr.moved = true; } }
    else { t = clamp(t, st + 1, L); if (Math.abs(aeX(t) - aeX(L)) <= 8) t = L; const nv = t >= L - 1e-6 ? null : t; if (nv !== d.vEndSet) { d.vEndSet = nv; dr.moved = true; } }
    aeRefresh();
  });
  const end = () => { if (SP.drag) { const dr = SP.drag; SP.drag = null; const H = aeHc(); if (dr.moved) { if (!(SP.arm && spCommit(dr, H))) aeAnim(); } else if (dr.hit >= 0) { SP.sel = dr.hit; spPanel(); aeAnim(); } else { SP.sel = -1; spPanel(); aeSeek(aeT(dr.x0)); } return; } if (AE.zdrag) { AE.zdrag = false; return; } if (AE.nsDrag) { const nd = AE.nsDrag; AE.nsDrag = null; if (!nd.moved) aeSeek(nd.t0); else if (AE.nsel && AE.nsel.b - AE.nsel.a < 0.05) AE.nsel = null; else if (AE.nsel) nrArm(false); aeRefresh(); return; } if (AE.scrub) { const w = AE.scrub.wasPlaying; AE.scrub = null; if (w) aePlay(); return; } const dr = AE.drag; if (!dr) return; AE.drag = null; if (!dr.moved) AE.undo.pop(); aeRefresh(); aeAnim(); };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { AE.mxy = null; if (!AE.drag && AE.hover) AE.hover = null; aeAnim(); });
  cv.addEventListener('wheel', e => {
    if (!AE.d) return; const x = pt(e);
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); aeZoomBy(Math.exp(clamp(-e.deltaY * 0.01, -0.7, 0.7)), aeT(x), true); }
    else if (AE.zoom) { e.preventDefault(); e.stopPropagation(); const r = AE.zoom, span = r.hi - r.lo; aeZoomSet(r.lo + (e.deltaX || e.deltaY) / (aeW() - 2 * AE_PAD) * span, r.hi + (e.deltaX || e.deltaY) / (aeW() - 2 * AE_PAD) * span, true); }
  }, { passive: false });
  let gScale = 1;
  window.addEventListener('gesturestart', e => { if ($('#audioDlg').hidden) return; e.preventDefault(); gScale = 1; });
  window.addEventListener('gesturechange', e => { if ($('#audioDlg').hidden || !AE.d) return; e.preventDefault(); aeZoomBy(e.scale / gScale, AE.pos, true); gScale = e.scale; });
  cv.addEventListener('dblclick', e => {         // double-click a handle: back to the audio's own start or end
    const w = aeHit(pt(e)); if (!w || !AE.d) return; const d = AE.d;
    if (w === 'start' ? d.vStart === 0 : d.vEndSet == null) return; aePush(); if (w === 'start') d.vStart = 0; else d.vEndSet = null; aeRefresh();
  });
}
/* zooming the waveform: pinch or Cmd/Ctrl + scroll, Cmd/Ctrl + and -, Cmd/Ctrl 0 for the whole sound; two-finger swipe or the bar underneath moves along */
function aeZoomSet(lo, hi, snap) {
  const [flo, fhi] = aeFull(), fs = fhi - flo, span = clamp(hi - lo, Math.min(0.4, fs), fs);
  if (span >= fs * 0.995) AE.zoom = null; else { lo = clamp(lo, flo, fhi - span); AE.zoom = { lo, hi: lo + span }; } specSync();
  if (snap) { const r = AE.zoom || { lo: flo, hi: fhi }; hsSnap('ae-rlo', r.lo); hsSnap('ae-rhi', r.hi); }
  $('#aeZoomFit').classList.toggle('gone', !AE.zoom); aeAnim(); aeDraw();
}
function aeZoomBy(f, anchor, snap) {
  const [flo, fhi] = aeFull(), r = AE.zoom || { lo: flo, hi: fhi }, a = anchor == null ? (r.lo + r.hi) / 2 : anchor, k = (a - r.lo) / (r.hi - r.lo), span = (r.hi - r.lo) / f;
  aeZoomSet(a - k * span, a - k * span + span, snap);
}
/* moves the playhead (always inside the kept part) and carries on playing from there if it was playing */
function aeSeek(t) {
  const d = AE.d, L = S.audio.duration, st = Math.max(0, d.vStart), en = Math.min(aeEnd(d), L);
  AE.pos = clamp(t, st, Math.max(st, en - 0.05)); aeDraw();
}
/* the handles' little spring keeps the canvas redrawing until it settles */
function aeAnim() {
  cancelAnimationFrame(aeAnim.raf);
  const step = () => { if (!AE.d || $('#audioDlg').hidden) return; const moving = hsStep(1 / 60); aeDraw(); if (AE.tool === 'emu') aeEmDraw(); aeToolLive(); if (moving || AE.playing || AE.pkAnim || ((AE.specLoad || (AE.specRev && performance.now() - AE.specRev.t < 760)) && AE.view === 'spec')) aeAnim.raf = requestAnimationFrame(step); };
  aeAnim.raf = requestAnimationFrame(step);
}
/* where the preview is, in seconds: the player's own count of frames played */
const aeNow = () => AE.ph ? AE.ph.frame() / AE.ph.sr : AE.pos;
/* Bypass works on the open tool alone, so one tool at a time can be heard without its work (the Emulator's own bypass takes out what it set: the EQ, the Imager and Level). Each bypassed tool stays so, with its row dimmed, until it is switched back */
const AE_BPSET = { noise: ['noise'], spec: ['spec'], eq: ['eq'], imager: ['imager'], level: ['level'], fades: ['fades'], emu: ['eq', 'imager', 'level'] };
const aeBp = k => !!(AE.bp && AE.bp[k]), aeBpAny = () => !!AE.bp && Object.values(AE.bp).some(Boolean), aeBpTool = t => (AE_BPSET[t] || []).some(aeBp), aeBy = () => aeBpTool(AE.tool) ? 1 : 0;
/* the settings as they are heard: a bypassed tool does nothing (its volume and fades are handled where the gain is worked out) */
function aeFxHeard(fx) {
  if (!aeBp('noise') && !aeBp('spec') && !aeBp('eq') && !aeBp('imager')) return fx;
  const f = fxClone(fx); if (aeBp('noise')) { f.noise.on = false; f.noise.profile = null; f.noise.hum = null; } if (aeBp('spec')) { f.spec.on = false; f.spec.edits = []; } if (aeBp('eq')) f.eq.on = false; if (aeBp('imager')) f.imager.on = false; return f;
}
const aeGainAt = (d, st, en, t) => (aeBp('fades') ? 1 : aeF(d, d.vStart, aeEnd(d), t)) * (aeBp('level') ? 1 : aeLevel(d, st, en));
/* the tools changed while a recording from the disk store plays: the new settings are sent, and what plays carries on for a quarter of a second before the new sound takes over. A burst of changes (a slider drag) becomes one */
/* what the disk store works out for the editor's playback: the noise reduction and Spectra only. The EQ and the Imager run live on the page, as for a recording in memory, so a band can be moved, listened to or made dynamic without the sound being made over */
function aeDiskFx() { const f = fxClone(AE.d ? aeFxHeard(AE.d.fx) : FX_DEFAULT); f.eq.on = false; f.imager.on = false; return f; }
function aeDiskSync() {
  if (AE.dsT) return;          // a slider that keeps moving still updates the sound every 60ms (waiting for it to stop would leave the sound behind)
  AE.dsT = setTimeout(async () => {
    AE.dsT = 0; AE.dsLast = performance.now(); const h = AE.dh; if (!h || !AE.d) return; if (AE.dsBusy) { AE.dsAgain = true; return; }
    DISK.fxUse(aeDiskFx(), { listen: AE.nrListen && !aeBp('noise'), slot: 'ply' }); if (DISK.fxSigP === AE.dsSig) return;          // something else may have set the tools already, so what matters is whether the player has heard them
    AE.dsSig = DISK.fxSigP;
    AE.dsBusy = true; try { const t0 = performance.now(); await h.refresh(AE.dsKeep != null ? AE.dsKeep : Math.round(S.audio.sr * 0.15)); const took = performance.now() - t0; AE.dsAvg = AE.dsAvg ? 0.6 * AE.dsAvg + 0.4 * took : took; AE.dsKeep = Math.round(S.audio.sr * clamp((2.5 * AE.dsAvg + 40) / 1000, 0.1, 0.25)); } catch (e) { console.error(e); } AE.dsBusy = false;          // the old sound carries on only as long as the new sound has taken to arrive lately (at least 0.1s, at most 0.25s), so a change is heard quickly and never leaves a gap if (AE.dsAgain) { AE.dsAgain = false; aeDiskSync(); }
  }, Math.max(0, 60 - (performance.now() - (AE.dsLast || 0))));          // the first change after a pause goes at once; changes that keep coming are taken every 60ms
}
/* preview: plays the trimmed part with the draft's fades and volume */
/* Play and pause are one control: while a start is still on its way (or waiting for the noise reduction) pressing it again cancels that start, and never begins a second one */
function aeToggle() { if (AE.playing || AE.wantPlay || AE.starting) aeStop(); else aePlay(); }
async function aePlay() {
  if (!AE.d || !S.audio) return; Transport.pause();
  if (aeWaiting()) { AE.wantPlay = true; aeWaitUI(true); aeToolsRefresh(); return; }          // nothing cleaned yet: wait for it instead of playing the raw sound as if it were cleaned
  AE.wantPlay = false; aeWaitUI(false);
  const tok = AE.playTok = (AE.playTok || 0) + 1; AE.starting = true; clearTimeout(AE.startT); AE.startT = setTimeout(() => { if (AE.starting && AE.playTok === tok) aeWaitUI(true, 'Starting…'); }, 250);          // from here until the sound is in hand a second press cancels this start; one that takes a moment says so on the button
  const ac = ensureCtx(); if (ac.state !== 'running') { try { await ac.resume(); } catch (e) {} } if (AE.playTok !== tok) return;
  AE.clipLatch = false;
  const d = AE.d, L = S.audio.duration, st = Math.max(0, d.vStart), en = Math.min(aeEnd(d), L);
  const from = AE.pos > st && AE.pos < en - 0.1 ? AE.pos : st;
  /* the player makes the sound, from memory or from the disk store (there with the noise reduction and Spectra already on it), and works out the EQ, the Imager, the volume with its fades and the limiter itself.
     It plays into a gain node that stands where the source would be; two more outputs carry the sound after the filters and after the volume */
  const dk = !!S.audio.disk, src = ac.createGain(), lv = aeGainAt(d, st, en, from); let ph = null;
  const opt = { taps: true, ease: true, meter: true, init: Object.assign({ gain: lv, now: true }, aeRouteMsg(false), aeLimMsg()) };
  try {
    if (dk) { DISK.fxUse(aeDiskFx(), { listen: AE.nrListen && !aeBp('noise'), slot: 'ply' }); ph = await DISK.play(ac, Math.floor(from * S.audio.sr), src, Object.assign({ fx: true, slot: 'ply' }, opt)); AE.dsSig = DISK.fxSigP; }
    else { AE.mem = memSound(ac, aeSrcBuffer()); ph = await soundPlay(ac, AE.mem, Math.floor(from * ac.sampleRate), src, opt); }
  } catch (e) { clearTimeout(AE.startT); if (AE.playTok === tok) { AE.starting = false; aeWaitUI(false); } if (e !== STALE) { console.error(e); toast(tx('ae.playfail2') + ' ' + (e && e.message || ''), 5000); } return; }
  if (AE.playTok !== tok || !AE.d) { ph.stop(); return; }          // stopped, or the editor closed, while the first sound was being made
  AE.starting = false; clearTimeout(AE.startT); aeWaitUI(false);
  const g = ac.createGain(), tapC = ac.createGain(), out = ac.createGain(); out.gain.setValueAtTime(0, ac.currentTime); out.gain.setValueAtTime(0, ac.currentTime + 0.02); out.gain.linearRampToValueAtTime(1, ac.currentTime + 0.03); src.connect(out); out.connect(ac.destination); AE.out = out;          // silent for 20ms (the graph takes a moment to start), then eased in over 10ms, so starting mid-wave does not click
  ph.tap(1, g); ph.tap(2, tapC); AE.ph = ph; AE.dh = dk ? ph : null; AE.src = src; AE.g = g; AE.tapC = tapC; if (AE.chain) AE.chain.output = tapC; AE.gT = AE.gv = lv; AE.gAt = performance.now();
  aeTap(); AE.playing = true; AE.pos = from;
  aeLimSync(); if (!AE.chain || !AE.chain.update(aeHearFx())) aeRoute();          // whatever changed while the first sound was being made
  $('#aePlayIcon').innerHTML = '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>';
  const tick = () => {
    if (!AE.playing) return;
    const t = aeNow(), dd = AE.d;
    if (!dd || t >= Math.min(aeEnd(dd), L) - 0.01) { aeStop(true); return; }
    if (t < Math.max(0, dd.vStart) - 0.02 && !AE.drag) { aeStop(); AE.pos = Math.max(0, dd.vStart); aePlay(); return; }          // the start was trimmed past the playhead: the sound carries on from the new start
    AE.pos = t; const tg = aeGainAt(dd, Math.max(0, dd.vStart), Math.min(aeEnd(dd), L), t); if (tg !== AE.gT) { AE.gT = tg; ph.post({ gain: tg }); }          // the player eases to it over 20ms
    const now = performance.now(); AE.gv += (tg - AE.gv) * (1 - Math.exp(-(now - AE.gAt) / 20)); AE.gAt = now;          // where the player's volume has got to
    if (Math.abs(AE.gv - tg) > 0.08 * Math.max(tg, 0.05)) AE.clipFrom = now + 120;          // the volume is still on its way to a new setting: the meter holds the sound from before it, so the Clip light waits for it to settle
    AE.raf2 = requestAnimationFrame(tick);
  };
  AE.raf2 = requestAnimationFrame(tick); aeAnim();          // the picture is drawn once a frame, by aeAnim
}
/* the limiter sits after the volume, inside the player: it keeps running there, and switching it in or out (the Limiter tick, Bypass) eases between the limited sound and the plain one, so nothing clicks */
const aeLimMsg = () => ({ lim: { on: !!(limOn(AE.d) && !aeBp('level')), ceil: LIM_CEIL - LIM_GUARD, tp: TP_H } });
function aeLimSync() { if (AE.ph) AE.ph.post(aeLimMsg()); }
function aeStop(ended) {
  if (AE.wantPlay) { AE.wantPlay = false; aeWaitUI(false); aeToolsRefresh(); }
  if (!AE.playing && !AE.src && !AE.starting) return;
  AE.playTok = (AE.playTok || 0) + 1; if (AE.starting) { AE.starting = false; clearTimeout(AE.startT); aeWaitUI(false); } clearTimeout(AE.dsT); AE.dsT = 0; AE.dsAgain = false;
  cancelAnimationFrame(AE.raf2); AE.playing = false;
  const o = { ph: AE.ph, src: AE.src, g: AE.g, out: AE.out, tapC: AE.tapC }, eased = !ended && !!o.out;          // the sound is eased out over a few milliseconds before it is cut, so stopping mid-wave does not click
  const cut = () => {
    if (o.ph) { try { o.ph.stop(); } catch (e) {} }
    try { o.src && o.src.disconnect(); o.g && o.g.disconnect(); o.tapC && o.tapC.disconnect(); o.out && o.out.disconnect(); } catch (e) {}
  };
  aeUntap(); AE.ph = AE.dh = null; AE.mem = null; AE.src = AE.g = AE.out = AE.tapC = null; AE.chain = null;
  if (eased) { try { const ct = o.out.context.currentTime; o.out.gain.cancelScheduledValues(ct); o.out.gain.setValueAtTime(o.out.gain.value, ct); o.out.gain.linearRampToValueAtTime(0, ct + 0.01); } catch (e) {} setTimeout(cut, 40); } else cut();
  if (ended && AE.d) AE.pos = Math.max(0, AE.d.vStart);
  $('#aePlayIcon').innerHTML = '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>'; aeDraw(); clearTimeout(AE.stopT); AE.stopT = setTimeout(() => { if (AE.d && !AE.playing) aeToolsRefresh(); }, 80);
}
/* the draft as a 16-bit WAV: the trimmed part, with the fades and volume applied */
/* ---------------- Sample-rate conversion ----------------
   Each new sample is a weighted sum of the ~100 nearest old ones (more when converting down), weighted by a windowed sinc (the ideal low-pass filter, eased with a Kaiser window, about 100dB down).
   When going to a lower rate the filter is narrowed so nothing above the new Nyquist can fold back as aliasing. Only the part being exported is converted. */
function rsKernel(scale) {          // scale = out/in (capped at 1): the table of filter weights across +-Zs input samples, 2048 steps per sample
  const Z = 48, Zs = Z / scale, STEP = 2048, n = Math.ceil(2 * Zs * STEP) + 2, tab = new Float64Array(n), beta = 10.5;
  const i0 = x => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-14 * s) break; } return s; }, den = i0(beta), fc = 0.995 * scale;
  for (let i = 0; i < n; i++) {
    const t = i / STEP - Zs, u = t / Zs; if (Math.abs(u) >= 1) { tab[i] = 0; continue; }
    const x = Math.PI * t * fc, sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    tab[i] = fc * sinc * i0(beta * Math.sqrt(1 - u * u)) / den;
  }
  return { tab, Zs, STEP };
}
/* the part a..b (seconds) of the buffer at a new rate; returns a stand-in buffer plus the sample number its first sample sits at (origin) */
async function resampleRegion(buf, a, b, outRate, ch) {
  const inRate = buf.sampleRate, scale = Math.min(1, outRate / inRate), K = rsKernel(scale), { tab, Zs, STEP } = K, ratio = inRate / outRate;
  const j0 = Math.max(0, Math.floor(a * outRate)), j1 = Math.ceil(b * outRate), n = Math.max(1, j1 - j0), out = [];
  for (let c = 0; c < ch; c++) out.push(new Float32Array(n));
  const src = []; for (let c = 0; c < ch; c++) src.push(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))); const L = buf.length;
  const wt = new Float64Array(Math.ceil(2 * Zs) + 4);          // the weights for one new sample, worked out once and used for every channel
  for (let j = 0; j < n; j++) {
    const x = (j0 + j) * ratio, i0 = Math.ceil(x - Zs), cnt = Math.floor(x + Zs) - i0 + 1;
    for (let t = 0; t < cnt; t++) { const p = (i0 + t - x + Zs) * STEP, k = p | 0, f = p - k; wt[t] = tab[k] + (tab[k + 1] - tab[k]) * f; }
    const lo = Math.max(0, -i0), hi = Math.min(cnt, L - i0);          // taps that fall before or after the sound count as silence
    for (let c = 0; c < ch; c++) { const sc = src[c]; let acc = 0; for (let t = lo; t < hi; t++) acc += sc[i0 + t] * wt[t]; out[c][j] = acc; }
    if ((j & 0x3fff) === 0x3fff) await tick();
  }
  return { buf: { sampleRate: outRate, numberOfChannels: ch, length: n, duration: n / outRate, getChannelData: c => out[c] }, origin: j0 };
}
/* the rate the exported audio file will have: the recording's own unless another is chosen in the export window */
const aeOutRate = buf => +S.set.audioRate || buf.sampleRate;
/* the draft's final samples for a file: converted to the chosen rate first when it differs from the recording's */
async function aeMasterFor(d, buf, ch, clamped, ui) {
  const vs = d.vStart, ve = aeEnd(d), want = aeOutRate(buf); let src = buf, origin = 0;
  if (d.normalize && d.normBy === 'loud') { const pr = p => ui && ui('Processing', p), stop = () => AE.expStop; await loudEnsure(d, stop, pr); if (d.limiter) await limEnsure(d, stop, pr); }          // the volume for a loudness target comes from measuring the sound first
  if (want !== buf.sampleRate) { const r = await resampleRegion(buf, Math.max(0, vs), Math.min(ve, buf.duration), want, ch); src = r.buf; origin = r.origin; }
  return masterMaker(src, ch, vs, ve, aeLevel(d, Math.max(0, vs), Math.min(ve, buf.duration)), t => aeF(d, vs, ve, t), { clamp: clamped, origin, total: Math.max(1, Math.round((ve - vs) * want)), limit: limOn(d) ? LIM_CEIL : null });
}
/* ---------------- Loudness (ITU-R BS.1770 / EBU R128) ----------------
   How loud something sounds, not how tall its tallest spike is. The sound is first filtered the way the ear hears it (two filters: a gentle boost above ~2kHz and a cut
   below ~40Hz), then its power is averaged over short windows. Quiet stretches are left out of the average (below -70 LUFS, then anything 10 LU under the rest), so a long silence
   does not make a piece read as quiet. Written from the published method (the filter shapes and gating rules are in the standard); 1 LU is 1dB.
   Loudness range (EBU Tech 3342) is the spread between the quieter and louder parts: the 10th to the 95th percentile of the 3-second loudness, after its own gating. */
const LU = (() => {
  function stages(sr) {          // the two filters as biquads, worked out for any sample rate by the bilinear transform
    const shelf = (f0, G, Q) => { const K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K; return { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] }; };
    const hp = (f0, Q) => { const K = Math.tan(Math.PI * f0 / sr), a0 = 1 + K / Q + K * K; return { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] }; };
    return [shelf(1681.974450955533, 3.999843853973347, 0.7071752369554196), hp(38.13547087602444, 0.5003270373238773)];
  }
  const lufs = e => e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity;
  /* fill(pos, len, out) gives planar samples (channel after channel) of the sound to measure; returns the readings */
  async function measure(fill, total, sr, ch, yieldFn) {
    const st = stages(sr), hop = Math.round(sr * 0.1), nh = Math.floor(total / hop), en = new Float64Array(nh);
    const z = []; for (let c = 0; c < ch; c++) z.push([[0, 0], [0, 0]]);          // each channel: state of both filters
    const B = hop * 5, buf = new Float32Array(B * ch); let pos = 0, n = 0;
    while (pos < total) {
      const len = Math.min(B, total - pos); fill(pos, len, buf);
      for (let c = 0; c < ch; c++) {
        const s0 = z[c][0], s1 = z[c][1], p = st[0], r = st[1];
        for (let i = 0; i < len; i++) {
          const x = buf[c * len + i];
          let y = p.b[0] * x + s0[0]; s0[0] = p.b[1] * x - p.a[0] * y + s0[1]; s0[1] = p.b[2] * x - p.a[1] * y;          // transposed direct form II
          const w = y; y = r.b[0] * w + s1[0]; s1[0] = r.b[1] * w - r.a[0] * y + s1[1]; s1[1] = r.b[2] * w - r.a[1] * y;
          const h = ((pos + i) / hop) | 0; if (h < nh) en[h] += y * y;
        }
      }
      pos += len; if (yieldFn && ++n % 8 === 0) await yieldFn();
    }
    for (let h = 0; h < nh; h++) en[h] /= hop;          // mean power of each 100ms step (channels added, front channels weigh 1)
    const win = (k) => { const m = Math.max(0, nh - k + 1), out = new Float64Array(m); let s = 0; for (let i = 0; i < k && i < nh; i++) s += en[i]; for (let i = 0; i < m; i++) { out[i] = s / k; if (i + k < nh) s += en[i + k] - en[i]; } return out; };
    const mom = win(4), short = win(30), res = { I: -Infinity, LRA: 0, M: -Infinity, S: -Infinity, steps: nh };
    for (const e of mom) res.M = Math.max(res.M, lufs(e)); for (const e of short) res.S = Math.max(res.S, lufs(e));
    const gated = (arr, rel) => { const a = Array.from(arr).filter(e => lufs(e) > -70); if (!a.length) return []; const th = lufs(a.reduce((x, y) => x + y, 0) / a.length) + rel; return a.filter(e => lufs(e) > th); };
    const gi = gated(mom, -10); if (gi.length) res.I = lufs(gi.reduce((x, y) => x + y, 0) / gi.length);
    const gl = gated(short, -20).map(lufs).sort((x, y) => x - y);
    if (gl.length > 1) { const pc = q => { const i = q * (gl.length - 1), lo = Math.floor(i), f = i - lo; return gl[lo] + (gl[Math.min(lo + 1, gl.length - 1)] - gl[lo]) * f; }; res.LRA = pc(0.95) - pc(0.1); }
    return res;
  }
  return { stages, measure, lufs };
})();
/* ---------------- Loudness of the draft ----------------
   The Level tool can aim the sound's loudness (LUFS) instead of its loudest peak. The sound is measured once (as the other tools and the fades leave it, before any volume change),
   and the volume that reaches the target follows from that. A target that would need peaks above the ceiling stops at the ceiling unless the limiter is on. */
const LIM_CEIL = -1;          // dB true peak: the highest the sound may reach when a loudness target is set
const LIM_WORTH = 0.35;          // the loudness search gives up when a dB more volume adds less than this many LU (the limiter is taking the rest back)
const LUC = new Map();          // measurements by key: the readings, or the promise of them
const loudKey = d => [fxKey(d.fx), d.vStart, aeEnd(d), d.audioFades === false ? 'x' : d.audioFadeLen + '/' + d.audioFadeOutLen + d.audioFadeShape, S.set.audioKey].join('|');
const loudPeek = d => { const h = LUC.get(loudKey(d)); return h && !h.then ? h : null; };
async function loudEnsure(d, stale, prog, slot) {
  const key = loudKey(d), h = LUC.get(key); if (h) return h.then ? await h : h;
  const job = S.audio.disk ? (async () => { DISK.fxUse(d.fx, { slot }); return await DISK.loud(d, { stale, onProgress: prog, slot }); })() : (async () => {
    const buf = (await fxGet(d.fx)).buffer, ch = Math.min(2, buf.numberOfChannels), vs = d.vStart, ve = aeEnd(d), mm = masterMaker(buf, ch, vs, ve, 1, t => aeF(d, vs, ve, t));
    return await LU.measure((pos, len, out) => { mm.fill(pos, len, out); if (prog) prog(pos / mm.total); }, mm.total, mm.sr, ch, async () => { await sleep(0); if (stale && stale()) throw new Error('stale'); });
  })();
  LUC.set(key, job);
  try { const r = await job; LUC.set(key, r); while (LUC.size > 6) LUC.delete(LUC.keys().next().value); return r; } catch (e) { LUC.delete(key); throw e; }
}
/* with the limiter on: the loudness and dynamic range of what actually comes out (measured through the limiter at the volume the target asks for) */
const LLC = new Map();
const limKey = d => loudKey(d) + '|' + d.normLufs + '|' + LIM_CEIL;
const limPeek = d => { const h = LLC.get(limKey(d)); return h && !h.then ? h : null; };
/* Limiting takes some loudness back, so the volume is raised a little more (measuring again each time) until what comes out through the limiter lands on the target. */
async function limEnsure(d, stale, prog, slot) {
  const key = limKey(d), h = LLC.get(key); if (h) return h.then ? await h : h;
  const job = S.audio.disk ? (async () => { DISK.fxUse(d.fx, { slot }); const r = await DISK.limit(d, { stale, onProgress: prog, slot }); if (r.base && !LUC.has(loudKey(d))) LUC.set(loudKey(d), r.base); return r; })() : (async () => {
    const m = await loudEnsure(d, stale); if (!isFinite(m.I)) return { g: 1, I: m.I, LRA: m.LRA, gr: 0, silent: true };
    const buf = (await fxGet(d.fx)).buffer, ch = Math.min(2, buf.numberOfChannels), vs = d.vStart, ve = aeEnd(d), cap = Math.pow(10, 24 / 20); let g = Math.min(cap, Math.pow(10, (d.normLufs - m.I) / 20)), r = null;
    const fadeOf = t => aeF(d, vs, ve, t), per = Math.max(1, Math.floor(buf.sampleRate / 100)), m1 = masterMaker(buf, ch, vs, ve, 1, fadeOf), pk1 = new Float32Array(Math.ceil(m1.total / per)); { const B = 1 << 15, t = new Float32Array(B * ch); for (let p = 0; p < m1.total; p += B) { const len = Math.min(B, m1.total - p), o = len === B ? t : new Float32Array(len * ch); m1.fill(p, len, o); KFX.binTop(pk1, per, o, len, p, ch); } }          // the height of every 10ms before the limiter, for the picture of the limited sound
    let prev = null;
    for (let k = 0; k < 4; k++) {
      const mm = masterMaker(buf, ch, vs, ve, g, t => aeF(d, vs, ve, t), { limit: LIM_CEIL });
      const top = new Float32Array(pk1.length);
      r = await LU.measure((pos, len, out) => { mm.fill(pos, len, out); KFX.binTop(top, per, out, len, pos, ch); if (prog) prog(Math.min(1, (k + pos / mm.total) / 2)); }, mm.total, mm.sr, ch, async () => { await sleep(0); if (stale && stale()) throw new Error('stale'); }); r.gr = mm.reduction(); r.g = g; r.shape = KFX.limShape(top, pk1, g); r.per = per / buf.sampleRate;
      if (prev && g > prev.g && r.I - prev.I < LIM_WORTH * 20 * Math.log10(g / prev.g)) { r = prev; break; }          // more volume is no longer making it louder, only limiting harder: stop at the volume before
      const off = d.normLufs - r.I; if (!isFinite(off) || Math.abs(off) < 0.05 || g >= cap) break; prev = r; g = Math.min(cap, g * Math.pow(10, off / 20));
    }
    r.short = isFinite(r.I) && d.normLufs - r.I > 0.1; return r;
  })();
  LLC.set(key, job);
  try { const r = await job; LLC.set(key, r); while (LLC.size > 6) LLC.delete(LLC.keys().next().value); return r; } catch (e) { LLC.delete(key); throw e; }
}
/* what the loudness target comes to: the volume, whether the peak ceiling stopped it, and the loudness it reaches */
function aeLoudInfo(d) {
  if (!d.normalize || d.normBy !== 'loud') return null;
  const m = loudPeek(d); if (!m) return { ready: false }; if (!isFinite(m.I)) return { ready: true, silent: true, g: 1 };
  const pk = aeLevelPeaks(d), from = Math.max(0, d.vStart), to = Math.min(aeEnd(d), S.audio.duration), i0 = Math.max(0, Math.floor(from * 100)), i1 = Math.min(pk.length - 1, Math.ceil(to * 100)); let mx = 0; for (let i = i0; i <= i1; i++) if (pk[i] > mx) mx = pk[i];
  const cap = Math.pow(10, 24 / 20), g = Math.min(cap, Math.pow(10, (d.normLufs - m.I) / 20));          // gain only: the loudness target sets the gain, and the limiter (if on) deals with the peaks
  const peakDb = mx > 1e-4 ? 20 * Math.log10(mx * g) : -Infinity;
  const info = { ready: true, I: m.I, LRA: m.LRA, g, capped: Math.pow(10, (d.normLufs - m.I) / 20) > cap, reached: m.I + 20 * Math.log10(g), peak: mx, peakDb, clips: !d.limiter && peakDb > LIM_CEIL + 0.05 };
  if (d.limiter) { const l = limPeek(d); info.lim = l; if (l && l.g) { info.g = l.g; info.reached = l.I; info.clips = false; } }          // with the limiter, the volume is the one that makes the limited sound land on the target
  return info;
}
/* start (after a short pause, and dropping any older request) measuring what the Level tool needs to show */
function loudWant(d) {
  const key = loudKey(d) + '|' + d.normLufs + '|' + (d.limiter ? 'L' : ''), have = LUC.has(loudKey(d)) && (!d.limiter || LLC.has(limKey(d)));
  if (have) return; clearTimeout(AE.loudT); AE.loudKey = key;
  AE.loudT = setTimeout(() => { if (!AE.d || AE.loudKey !== key) return; const stale = () => AE.loudKey !== key, prog = p => measureTick('after', p, stale); (d.limiter ? limEnsure(d, stale, prog) : loudEnsure(d, stale, prog)).then(() => { if (AE.d && !stale()) { measureDone('after'); aeRefresh(); aeLive(); } }, () => { if (!stale()) measureDone('after'); }); }, AE.sliding ? 220 : 40);
}
/* the Level summary shows a measure's progress while it runs (AE.meas holds a fraction per measure, or nothing) */
function measureTick(kind, p, stale) {
  if (stale && stale()) return; (AE.meas = AE.meas || {})[kind] = p;
  if (!AE.measRaf) AE.measRaf = requestAnimationFrame(() => { AE.measRaf = 0; if (AE.d) aeSummary(AE.d); });
}
function measureDone(kind) { if (AE.meas) AE.meas[kind] = null; }
/* the meter waits for the EQ or Imager to be made, then reads the finished sound */
/* the meter waits for the EQ or Imager to be made, then reads the finished sound. Only one preview render runs at a time, and the newest request waits its turn: a slider drag would otherwise start a full copy of the recording for every step */
function fxWait(d) { const k = fxKey(d.fx); if (AE.fxWaitKey === k || AE.fxWaitNext === k) return; AE.fxWaitNext = d; if (!AE.fxWaitKey) fxWaitRun(); }
function fxWaitRun() {
  const d = AE.fxWaitNext; if (!d) return; AE.fxWaitNext = null; const k = fxKey(d.fx); AE.fxWaitKey = k;
  fxGet(d.fx).then(() => { AE.fxWaitKey = null; if (AE.d) aeRefresh(); fxWaitRun(); }, () => { AE.fxWaitKey = null; fxWaitRun(); });
}
/* the largest true peak the Peak target would have to lift, over the part you keep */
function aePeakMax(d) { const pk = aeLevelPeaks(d), from = Math.max(0, d.vStart), to = Math.min(aeEnd(d), S.audio.duration), i0 = Math.max(0, Math.floor(from * 100)), i1 = Math.min(pk.length - 1, Math.ceil(to * 100)); let mx = 0; for (let i = i0; i <= i1; i++) if (pk[i] > mx) mx = pk[i]; return mx; }
const DB_TXT = v => isFinite(v) ? (v >= 0.05 ? '+' : '') + v.toFixed(1).replace('-', '−') + 'dB' : '—';
const CHG_TXT = v => Math.abs(v) < 0.05 ? '0.0dB' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + 'dB';
/* the Level summary: the loudness, the peak and the net change, as the sound is now (the change is the gain applied) */
function aeSummary(d) {
  const s = AE.sumIn; if (!s) return; const mr = AE.meas || {};
  const m = loudPeek(d), li = limOn(d) ? limPeek(d) : null, loud = li && isFinite(li.I) ? li.I : m && isFinite(m.I) ? m.I + s.gdBnow : null;
  const loudH = s.busy ? '…' : loud != null ? LUFS_TXT(loud) : mr.after != null ? 'Processing ' + Math.round(mr.after * 100) + '%' : '…';
  const chg = s.busy ? '…' : CHG_TXT(s.gdBnow);
  const L = $('#aeSumLoud'), C = $('#aeSumChg');
  if (L._h !== loudH) { L._h = loudH; L.textContent = loudH; }
  if (C._h !== chg) { C._h = chg; C.textContent = chg; }
}
/* ---------------- Limiter ----------------
   Keeps the sound under a ceiling without clipping it. It looks 5ms ahead, works out how much each moment must come down to stay under the ceiling (counting the peaks that fall between two samples),
   holds the lowest of those over the look-ahead window and for 15ms after, and eases the gain down and back up so there is no click. Holding on that long keeps the gain still across the waves of a low note
   (a bass drum or tuba would otherwise be bent out of shape, each wave pulling the gain down and letting it go). The gain climbs back slowly (about 80ms), so a quiet note after a loud one is not pumped.
   The same text runs in the page (exports) and in the player on the audio thread (what you hear). */
const LIM_CODE = `
class Lim {
  constructor(sr, nch, ceilDb, relMs, tp) {          // tp: the three rows of the 4x oversampling filter (the same one the peak meter uses)
    this.sr = sr; this.nch = nch; this.tp = tp; this.L = Math.max(8, Math.round(0.005 * sr)); this.L1 = (this.L + 1) >> 1; this.L2 = this.L + 1 - this.L1; this.D = this.L + 11; this.W = this.D + 1 + Math.round(0.015 * sr);          // the gain is smoothed over L samples (two averages in a row, L1 then L2 long); the audio is held back D samples; the lowest need is held over W (the look-ahead and 15ms more)
    this.ceil = Math.pow(10, ceilDb / 20); this.rel = (relMs || 80) / 1000; this.relK = 1 - Math.exp(-1 / (sr * this.rel)); this.susK = 1 - Math.exp(-1 / (sr * 0.3));          // the release: the time the gain takes to come back, 80ms for a single peak and up to eight times that while the limiter has been working for a while
    this.reset();
  }
  reset() {
    const W = this.W, D = this.D, n = this.nch; this.h = []; this.dl = [];
    for (let c = 0; c < n; c++) { this.h.push(new Float64Array(48)); this.dl.push(new Float32Array(D)); }          // the last 24 samples of each channel, written twice so they can be read as one run, and the audio delay line
    this.dq = new Float64Array(W); this.dqi = new Float64Array(W); this.dh = 0; this.dt = 0;          // sliding minimum: values and where they came from
    this.bx = new Float64Array(this.L1).fill(1); this.bs = this.L1; this.bp = 0; this.cx = new Float64Array(this.L2).fill(1); this.cs = this.L2; this.cp = 0; this.gp = 1; this.i = 0; this.maxGr = 1; this.avg = 0; this.k = this.relK; this.g = 1;
  }
  get delay() { return this.D; }
  /* in: one Float32Array per channel; out: same shape; n samples */
  process(inp, out, n) {
    const L1 = this.L1, L2 = this.L2, W = this.W, D = this.D, nch = this.nch, ceil = this.ceil, relK = this.relK, tp = this.tp, quiet = ceil * 0.35;
    for (let s = 0; s < n; s++) {
      const i = this.i, p = i % 24; let pk = 0;
      for (let c = 0; c < nch; c++) {
        const h = this.h[c], x = inp[c][s]; h[p] = x; h[p + 24] = x;
        const a = x < 0 ? -x : x; if (a > pk) pk = a;
        const w = p + 1, m1 = h[w + 11], m2 = h[w + 12], am = (m1 < 0 ? -m1 : m1) > (m2 < 0 ? -m2 : m2) ? (m1 < 0 ? -m1 : m1) : (m2 < 0 ? -m2 : m2);
        if (am > quiet) for (let r = 0; r < 3; r++) { const row = tp[r]; let y = 0; for (let j = 0; j < 24; j++) y += h[w + j] * row[j]; if (y < 0) y = -y; if (y > pk) pk = y; }          // the peaks that fall between two samples (only looked for where the sound is loud)
      }
      const need = pk > ceil ? ceil / pk : 1;
      while (this.dt !== this.dh && this.dq[(this.dt - 1 + W) % W] >= need) this.dt = (this.dt - 1 + W) % W;          // keep only values that can still be the lowest
      this.dq[this.dt] = need; this.dqi[this.dt] = i; this.dt = (this.dt + 1) % W;
      while (this.dqi[this.dh] <= i - W) this.dh = (this.dh + 1) % W;
      const m = this.dq[this.dh];
      this.bs += m - this.bx[this.bp]; this.bx[this.bp] = m; this.bp = (this.bp + 1) % L1;          // averaged, then averaged again: the gain moves in a rounded step
      const s1 = this.bs / L1; this.cs += s1 - this.cx[this.cp]; this.cx[this.cp] = s1; this.cp = (this.cp + 1) % L2;
      const sm = this.cs / L2;
      this.avg += ((this.gp < 0.995 ? 1 : 0) - this.avg) * this.susK;          // how much of the last ~0.3s the gain has been held down (a lone hit holds it for a fraction of that, dense sound for all of it)
      if ((i & 31) === 0) this.k = 1 - Math.exp(-1 / (this.sr * this.rel * Math.pow(8, Math.max(0, Math.min(1, (this.avg - 0.45) / 0.4)))));          // program-dependent release: a lone peak lets go in ~80ms, but when the gain has stayed down for most of the last half second it comes back over ~640ms, so it stops following every wave of dense or sustained sound
      let g = this.gp + (1 - this.gp) * this.k; if (sm < g) g = sm; this.gp = g; this.g = g; if (g < this.maxGr) this.maxGr = g;
      const k = i % D; for (let c = 0; c < nch; c++) { const dl = this.dl[c], x = dl[k]; dl[k] = inp[c][s]; out[c][s] = x * g; }
      this.i = i + 1;
    }
  }
}
`;
const LimCls = new Function(LIM_CODE + '\nreturn Lim;')();
const LIM_GUARD = 0.15;          // dB held back from the ceiling, for the peaks the filter cannot see
const limNew = (sr, nch) => new LimCls(sr, nch, LIM_CEIL - LIM_GUARD, 80, TP_H);
const limOn = d => !!(d && d.normalize && d.normBy === 'loud' && d.limiter);
/* ---------------- FLAC (lossless audio, about half the size of WAV) ----------------
   Written from the published FLAC format description. Each block of 4096 samples is predicted from the samples before it (a fixed or a fitted filter),
   and only what the prediction missed is stored, in a compact code. Decoding gives back every sample exactly.
   For two channels each block tries left/right, left/side, side/right and mid/side and keeps the smallest. */
const FLAC = (() => {
  const T8 = new Uint8Array(256), T16 = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i, d = i << 8; for (let k = 0; k < 8; k++) { c = (c & 0x80) ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; d = (d & 0x8000) ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff; } T8[i] = c; T16[i] = d; }
  class Bits {
    constructor() { this.b = new Uint8Array(1 << 16); this.n = 0; this.cur = 0; this.nb = 0; }
    put(v, bits) {          // the lowest `bits` bits of v (up to 32), most significant first
      while (bits > 0) {
        const take = bits < 8 - this.nb ? bits : 8 - this.nb; bits -= take;
        this.cur = (this.cur << take) | ((v >>> bits) & ((1 << take) - 1)); this.nb += take;
        if (this.nb === 8) { if (this.n >= this.b.length) { const nb = new Uint8Array(this.b.length * 2); nb.set(this.b); this.b = nb; } this.b[this.n++] = this.cur; this.cur = 0; this.nb = 0; }
      }
    }
    unary(q) { while (q > 32) { this.put(0, 32); q -= 32; } if (q) this.put(0, q); this.put(1, 1); }          // q zeros, then a one
    align() { if (this.nb) this.put(0, 8 - this.nb); }
  }
  const zig = v => v >= 0 ? v * 2 : -v * 2 - 1;
  /* the Rice parameter that costs least for a stretch with this sum over this many values */
  function bestK(sum, cnt) {
    if (!cnt || sum <= 0) return { k: 0, bits: cnt };
    const k0 = Math.max(0, Math.floor(Math.log2(sum / cnt + 1))); let bk = 0, bb = Infinity;
    for (let k = Math.max(0, k0 - 1); k <= Math.min(30, k0 + 1); k++) { const b = cnt * (k + 1) + Math.floor(sum / Math.pow(2, k)); if (b < bb) { bb = b; bk = k; } }
    return { k: bk, bits: bb };
  }
  /* how to split the residual into parts, each with its own Rice parameter: the cheapest split */
  function riceBest(r, ord, n) {
    const rn = n - ord, pre = new Float64Array(rn + 1);
    for (let i = 0; i < rn; i++) pre[i + 1] = pre[i] + zig(r[i]);
    let best = null;
    for (let po = 0; po <= 8; po++) {
      const parts = 1 << po; if (n % parts) break; const P = n >> po; if (P <= ord || (po && P < 16)) break;
      let bits = 6;
      for (let p = 0; p < parts; p++) { const lo = p ? p * P - ord : 0, hi = (p + 1) * P - ord; bits += 5 + bestK(pre[hi] - pre[lo], hi - lo).bits; }
      if (!best || bits < best.bits) best = { bits, po };
    }
    best.pre = pre; return best;
  }
  function writeRice(w, r, ord, n, rb) {
    const parts = 1 << rb.po, P = n >> rb.po, pre = rb.pre; w.put(1, 2); w.put(rb.po, 4);          // method 1: 5-bit parameters
    for (let p = 0; p < parts; p++) {
      const lo = p ? p * P - ord : 0, hi = (p + 1) * P - ord, k = bestK(pre[hi] - pre[lo], hi - lo).k; w.put(k, 5);
      const pk = Math.pow(2, k);
      for (let i = lo; i < hi; i++) { const u = zig(r[i]), q = Math.floor(u / pk); w.unary(q); if (k) w.put(u - q * pk, k); }
    }
  }
  const lpcCache = { win: null, n: 0 };
  function window(n) {          // Tukey(0.5): flat in the middle, eased at the edges
    if (lpcCache.n === n) return lpcCache.win; const w = new Float64Array(n), e = Math.floor(n / 4);
    for (let i = 0; i < n; i++) w[i] = i < e ? 0.5 - 0.5 * Math.cos(Math.PI * i / e) : i >= n - e ? 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / e) : 1;
    lpcCache.win = w; lpcCache.n = n; return w;
  }
  const LPC_ORDERS = [8, 12];
  /* the cheapest way to store one channel of one block: constant, plain, a fixed predictor, or a fitted one */
  function analyze(x, n, bps) {
    let same = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { same = false; break; }
    if (same) return { kind: 'const', bits: 8 + bps, v: x[0] };
    let best = { kind: 'raw', bits: 8 + n * bps };
    for (let ord = 0; ord <= 4 && ord < n; ord++) {
      const rn = n - ord, r = new Int32Array(rn);
      for (let i = ord; i < n; i++) {
        const a = x[i], b = x[i - 1], c = x[i - 2], d = x[i - 3], e = x[i - 4];
        r[i - ord] = ord === 0 ? a : ord === 1 ? a - b : ord === 2 ? a - 2 * b + c : ord === 3 ? a - 3 * b + 3 * c - d : a - 4 * b + 6 * c - 4 * d + e;
      }
      const rb = riceBest(r, ord, n), bits = 8 + ord * bps + rb.bits; if (bits < best.bits) best = { kind: 'fixed', ord, r, rb, bits };
    }
    if (n >= 64) {
      const maxO = LPC_ORDERS[LPC_ORDERS.length - 1], w = window(n), xw = new Float64Array(n), R = new Float64Array(maxO + 1);
      for (let i = 0; i < n; i++) xw[i] = x[i] * w[i];
      for (let l = 0; l <= maxO; l++) { let s = 0; for (let i = l; i < n; i++) s += xw[i] * xw[i - l]; R[l] = s; }
      if (R[0] > 0) {
        R[0] *= 1 + 1e-9; const A = [], a = new Float64Array(maxO + 1); let err = R[0];          // Levinson-Durbin: the best filter of each order
        for (let m = 1; m <= maxO; m++) {
          let acc = R[m]; for (let j = 1; j < m; j++) acc -= a[j] * R[m - j];
          const k = acc / err, prev = a.slice(); a[m] = k; for (let j = 1; j < m; j++) a[j] = prev[j] - k * prev[m - j]; err *= 1 - k * k;
          if (LPC_ORDERS.includes(m)) A.push([m, Array.from(a.slice(1, m + 1))]);
          if (err <= 0) break;
        }
        const prec = bps > 16 ? 15 : 13;
        for (const [ord, co] of A) {
          let cmax = 0; for (const c of co) cmax = Math.max(cmax, Math.abs(c)); if (!(cmax > 0)) continue;
          const shift = Math.max(0, Math.min(15, prec - 1 - (Math.floor(Math.log2(cmax)) + 1))), sc = Math.pow(2, shift), lim = Math.pow(2, prec - 1) - 1, q = new Int32Array(ord);
          let er = 0; for (let j = 0; j < ord; j++) { er += co[j] * sc; const v = Math.max(-lim - 1, Math.min(lim, Math.round(er))); q[j] = v; er -= v; }
          const rn = n - ord, r = new Int32Array(rn), inv = 1 / sc;
          for (let i = ord; i < n; i++) { let s = 0; for (let j = 0; j < ord; j++) s += q[j] * x[i - 1 - j]; r[i - ord] = x[i] - Math.floor(s * inv); }
          const rb = riceBest(r, ord, n), bits = 8 + ord * bps + 9 + ord * prec + rb.bits; if (bits < best.bits) best = { kind: 'lpc', ord, r, rb, bits, q, shift, prec };
        }
      }
    }
    return best;
  }
  function writeSub(w, x, n, bps, p) {
    if (p.kind === 'const') { w.put(0, 8); w.put(p.v, bps); return; }
    if (p.kind === 'raw') { w.put(2, 8); for (let i = 0; i < n; i++) w.put(x[i], bps); return; }
    if (p.kind === 'fixed') { w.put((8 + p.ord) << 1, 8); for (let i = 0; i < p.ord; i++) w.put(x[i], bps); writeRice(w, p.r, p.ord, n, p.rb); return; }
    w.put((32 + p.ord - 1) << 1, 8); for (let i = 0; i < p.ord; i++) w.put(x[i], bps);
    w.put(p.prec - 1, 4); w.put(p.shift, 5); for (let j = 0; j < p.ord; j++) w.put(p.q[j], p.prec); writeRice(w, p.r, p.ord, n, p.rb);
  }
  function utf8(w, v) {
    if (v < 0x80) { w.put(v, 8); return; }
    let nb = v < 0x800 ? 2 : v < 0x10000 ? 3 : v < 0x200000 ? 4 : v < 0x4000000 ? 5 : 6;
    w.put(((0xff00 >> nb) & 0xff) | (v >>> (6 * (nb - 1))), 8); for (let i = nb - 2; i >= 0; i--) w.put(0x80 | ((v >>> (6 * i)) & 63), 8);
  }
  const SIZE_CODE = { 8: 1, 12: 2, 16: 4, 20: 5, 24: 6 };
  /* one block: chs = one Int32Array per channel, n samples each */
  function frame(chs, n, bps, no) {
    const nc = chs.length; let assign = nc - 1, subs, xs, bpss = [];
    if (nc === 2) {
      const L = chs[0], R = chs[1], M = new Int32Array(n), S = new Int32Array(n);
      for (let i = 0; i < n; i++) { M[i] = (L[i] + R[i]) >> 1; S[i] = L[i] - R[i]; }
      const pl = analyze(L, n, bps), pr = analyze(R, n, bps), pm = analyze(M, n, bps), ps = analyze(S, n, bps + 1);
      const opts = [[pl.bits + pr.bits, 1, [pl, pr], [L, R], [bps, bps]], [pl.bits + ps.bits, 8, [pl, ps], [L, S], [bps, bps + 1]], [ps.bits + pr.bits, 9, [ps, pr], [S, R], [bps + 1, bps]], [pm.bits + ps.bits, 10, [pm, ps], [M, S], [bps, bps + 1]]];
      opts.sort((a, b) => a[0] - b[0]); const o = opts[0]; assign = o[1]; subs = o[2]; xs = o[3]; bpss = o[4];
    } else { xs = chs; bpss = chs.map(() => bps); subs = chs.map(c => analyze(c, n, bps)); }
    const w = new Bits(), bsCode = n === 4096 ? 12 : 7;
    w.put(0xff, 8); w.put(0xf8, 8); w.put(bsCode << 4, 8); w.put((assign << 4) | (SIZE_CODE[bps] << 1), 8); utf8(w, no); if (bsCode === 7) w.put(n - 1, 16);
    let c8 = 0; for (let i = 0; i < w.n; i++) c8 = T8[c8 ^ w.b[i]]; w.put(c8, 8);
    for (let c = 0; c < xs.length; c++) writeSub(w, xs[c], n, bpss[c], subs[c]);
    w.align(); let c16 = 0; for (let i = 0; i < w.n; i++) c16 = ((c16 << 8) & 0xffff) ^ T16[(c16 >> 8) ^ w.b[i]]; w.put(c16, 16);
    return w.b.slice(0, w.n);
  }
  function streamInfo(sr, nc, bps, total, minF, maxF, more) {
    const h = new Uint8Array(42), dv = new DataView(h.buffer); h.set([0x66, 0x4c, 0x61, 0x43, more ? 0 : 0x80, 0, 0, 34]);          // "fLaC", last metadata block, 34 bytes
    const bs = total < 4096 ? Math.max(16, total) : 4096; dv.setUint16(8, bs); dv.setUint16(10, 4096 === bs ? 4096 : bs); dv.setUint8(12, minF >> 16); dv.setUint16(13, minF & 0xffff); dv.setUint8(15, maxF >> 16); dv.setUint16(16, maxF & 0xffff);
    dv.setUint32(18, ((sr << 12) | ((nc - 1) << 9) | ((bps - 1) << 4) | (Math.floor(total / 4294967296) & 15)) >>> 0); dv.setUint32(22, total >>> 0);          // rate 20 bits, channels 3, depth 5, length 36 (the checksum stays zero: "not computed")
    return h;
  }
  /* the tags (title, artist...) as a Vorbis comment block, the way FLAC files carry them */
  function comments(t) {
    const te = new TextEncoder(), list = [['TITLE', t.title], ['ARTIST', t.artist], ['ALBUMARTIST', t.albumArtist], ['ALBUM', t.album], ['DATE', t.year], ['TRACKNUMBER', t.track], ['DISCNUMBER', t.disc], ['COMPOSER', t.composer], ['WORK', t.work], ['MOVEMENTNAME', t.movementName || t.movement], ['MOVEMENT', t.movementNo], ['GENRE', t.genre], ['COMMENT', t.comment], ['COMPILATION', t.compilation ? '1' : ''], ['SHOWMOVEMENT', t.showWork ? '1' : '']].filter(x => x[1]).map(x => te.encode(x[0] + '=' + x[1]));
    const vendor = te.encode('glisscore'), n = 8 + vendor.length + list.reduce((a, b) => a + 4 + b.length, 0), out = new Uint8Array(4 + n), dv = new DataView(out.buffer);
    out[0] = 0x84; out[1] = n >> 16; out[2] = (n >> 8) & 255; out[3] = n & 255;          // last metadata block, type 4, then its length
    let o = 4; dv.setUint32(o, vendor.length, true); o += 4; out.set(vendor, o); o += vendor.length; dv.setUint32(o, list.length, true); o += 4;
    for (const c of list) { dv.setUint32(o, c.length, true); o += 4; out.set(c, o); o += c.length; }
    return out;
  }
  return { frame, streamInfo, comments };
})();

/* the tags to write into an exported audio file: nothing unless Add tags is on; the title follows the Credits title until it is typed over */
function aeTags() {
  const s = S.set, v = k => String(s[k] || '').trim(), sw = !!s.tagShowWork;
  const t = { title: (s.tagTitle || S.credits.title || '').trim(), artist: v('tagArtist'), albumArtist: v('tagAlbumArtist'), album: v('tagAlbum'), year: v('tagYear'), track: v('tagTrack'), disc: v('tagDisc'), composer: v('tagComposer'), work: sw ? v('tagWork') : '', movement: sw ? v('tagMovement') : '', movementNo: sw ? v('tagMovementNo') : '', genre: v('tagGenre'), comment: v('tagComment') };
  const any = Object.values(t).some(Boolean); if (!any) return null;
  t.showWork = sw && !!(t.work || t.movement); t.compilation = !!s.tagCompilation; return t;
}
/* WAV tags: a LIST/INFO chunk (read by Windows and most editors) and an ID3 chunk (carries album artist and composer too), both after the sound */
function wavTagChunks(t) {
  const te = new TextEncoder(), le = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255], be = n => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255], ss = n => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];
  const even = a => a.length & 1 ? _B(a, [0]) : a;
  const info = [['INAM', t.title], ['IART', t.artist], ['IPRD', t.album], ['ICRD', t.year], ['IGNR', t.genre], ['ICMT', t.comment], ['ITRK', t.track]].filter(x => x[1]).map(x => { const v = _B(te.encode(x[1]), [0]); return _B(x[0], le(v.length), even(v)); });
  const infoChunk = info.length ? (() => { const body = _B('INFO', ...info); return _B('LIST', le(body.length), body); })() : new Uint8Array(0);
  const u16 = s => { const o = new Uint8Array(2 + s.length * 2 + 2); o[0] = 0xff; o[1] = 0xfe; for (let i = 0; i < s.length; i++) { o[2 + i * 2] = s.charCodeAt(i) & 255; o[3 + i * 2] = s.charCodeAt(i) >> 8; } return o; };
  const text = (id, v) => { const body = _B([1], u16(v)); return _B(id, be(body.length), [0, 0], body); };
  const frames = [['TIT2', t.title], ['TPE1', t.artist], ['TPE2', t.albumArtist], ['TCOM', t.composer], ['TALB', t.album], ['TYER', t.year], ['TRCK', t.track], ['TPOS', t.disc], ['TIT1', t.work], ['MVNM', t.movement], ['MVIN', t.movementNo], ['TCON', t.genre], ['TCMP', t.compilation ? '1' : '']].filter(x => x[1]).map(x => text(x[0], x[1]));
  if (t.comment) { const body = _B([1], 'eng', u16(''), u16(t.comment)); frames.push(_B('COMM', be(body.length), [0, 0], body)); }
  const fb = _B(...frames), id3 = _B('ID3', [3, 0, 0], ss(fb.length), fb), id3Chunk = frames.length ? _B('id3 ', le(id3.length), even(id3)) : new Uint8Array(0);
  return _B(infoChunk, id3Chunk);
}
/* a sample (-1..1) as a whole number of the chosen depth; 16-bit gets a touch of dither so quiet tails stay smooth */
const pcmQ = (raw, bits) => bits === 24 ? clamp(Math.round(raw * 8388607), -8388608, 8388607)
  : clamp(Math.round(clamp(raw, -1, 1) * 32767 + (raw > 1e-7 || raw < -1e-7 ? Math.random() + Math.random() - 1 : 0)), -32768, 32767);
/* the draft as a FLAC file: the same trimmed, faded, leveled sound as the WAV, stored exactly but about half the size */
/* the Export audio button shows how far the export has got: a fill across the button and the percentage (no number while it is still getting ready) */
function aeExpUI(btn) {
  const lb = btn.querySelector('span'); let last = '';
  return (text, f) => {
    if (AE.expStop) throw new Error('export stopped');          // every step reports here, so a stop ends the export at the next one
    const t = f == null ? text + '…' : text + ' ' + Math.min(100, Math.floor(f * 100)) + '%'; if (t === last) return; last = t;
    aeRunProg(t, f);
    btn.classList.add('exporting'); btn.style.setProperty('--p', f == null ? 0 : Math.min(1, f).toFixed(3)); if (f == null) lb.innerHTML = dotsHTML(t); else lb.textContent = t;
  };
}
/* the final samples of the draft, from the disk store: the same as aeMasterFor, with the sound read, converted, faded, leveled and limited a stretch at a time in the store's worker */
async function aeMasterDisk(d, ch, clamped, ui, opt) {          // opt: the video's own way (the recording's rate, the length and volume it already has)
  const m = DISK.meta, vs = d.vStart, ve = aeEnd(d), want = opt && opt.own ? m.sr : aeOutRate({ sampleRate: m.sr }), dur = m.frames / m.sr;
  if (d.normalize && d.normBy === 'loud') { const pr = p => ui && ui('Processing', p), stop = () => AE.expStop; await loudEnsure(d, stop, pr, 'exp'); if (d.limiter) await limEnsure(d, stop, pr, 'exp'); }
  DISK.fxUse(d.fx, { slot: 'exp' }); const sig = DISK.fxSigE, total = opt && opt.total || Math.max(1, Math.round((ve - vs) * want)), BL = 1 << 16;
  const spec = DISK.spec(d, opt && opt.gain != null ? opt.gain : aeLevel(d, Math.max(0, vs), Math.min(ve, dur)), { ch, clamp: !!clamped, limit: limOn(d) ? LIM_CEIL - LIM_GUARD : null, total, rate: want !== m.sr ? want : 0 });
  let cache = null;          // a longer stretch is asked for at a time and handed out in smaller blocks; asks follow one another, so the limiter carries on
  return { sr: want, total, ch, async fill(pos, len, out) {
    if (DISK.fxSigE !== sig) throw new Error('The settings changed while exporting.');
    if (!cache || pos < cache.pos || pos + len > cache.pos + cache.n) { const n = Math.max(len, Math.min(BL, total - pos)), r = await DISK.master(spec, pos, n, 'exp'); cache = { pos, n, data: r.data }; }
    const off = pos - cache.pos; for (let c = 0; c < ch; c++) out.set(cache.data.subarray(c * cache.n + off, c * cache.n + off + len), c * len);
  } };
}
/* a file written in order into the store's folder; a few writes are on their way at a time */
function diskWriter() {
  let at = 0, fly = [], err = null;
  return { get at() { return at; }, async put(ab) { if (err) throw err; const n = ab.byteLength, p = DISK.fileWrite(at, ab).catch(e => { err = err || e; }); at += n; /* the length is taken first: sending hands the buffer over */ fly.push(p); if (fly.length >= 4) await fly.shift(); if (err) throw err; },
    async done() { await Promise.all(fly); fly = []; if (err) throw err; }, patch: (to, ab) => DISK.fileWrite(to, ab) };
}
async function aeExportFlac(d, ui) {
  const dk = !!S.audio.disk; ui('Processing'); const buf = dk ? (await fxGet(d.fx), null) : (await fxGet(d.fx)).buffer, ch = Math.min(2, dk ? audCh() : buf.numberOfChannels), vs = d.vStart, ve = aeEnd(d), bits = S.set.audioFormat === 'flac16' ? 16 : 24;
  const mm = dk ? await aeMasterDisk(d, ch, false, ui) : await aeMasterFor(d, buf, ch, false, ui), sr = mm.sr, total = mm.total, B = 4096, tmp = new Float32Array(B * ch), parts = [null], tg = aeTags();
  let tk = performance.now(), no = 0, minF = 1e9, maxF = 0, wr = null, head = null, pend = [], pendN = 0;
  if (dk) { wr = diskWriter(); await DISK.fileOpen(); head = [FLAC.streamInfo(sr, ch, bits, total, 0, 0, !!tg)]; if (tg) head.push(FLAC.comments(tg)); const hb = new Uint8Array(head.reduce((a, h) => a + h.length, 0)); let q = 0; for (const h of head) { hb.set(h, q); q += h.length; } await wr.put(hb.buffer); }          // the header goes first with a stand-in stream info, which is written again at the end when the frame sizes are known
  const flush = async () => { if (!pendN) return; const o = new Uint8Array(pendN); let q = 0; for (const f of pend) { o.set(f, q); q += f.length; } pend = []; pendN = 0; await wr.put(o.buffer); };
  for (let pos = 0; pos < total; pos += B, no++) {
    const len = Math.min(B, total - pos); await mm.fill(pos, len, tmp); const chs = [];
    for (let c = 0; c < ch; c++) { const x = new Int32Array(len); for (let k = 0; k < len; k++) x[k] = pcmQ(tmp[c * len + k], bits); chs.push(x); }
    const f = FLAC.frame(chs, len, bits, no); if (len === B) { minF = Math.min(minF, f.length); } maxF = Math.max(maxF, f.length);
    if (dk) { pend.push(f); pendN += f.length; if (pendN >= 1 << 20) await flush(); } else parts.push(f);
    if (performance.now() - tk > 30) { ui('Processing', pos / total); await tick(); tk = performance.now(); }
  }
  ui('Processing', 1);
  const si = FLAC.streamInfo(sr, ch, bits, total, minF === 1e9 ? 0 : minF, maxF, !!tg); let file = null;
  if (dk) { await flush(); await wr.done(); await DISK.fileWrite(0, si.slice().buffer); file = await DISK.fileDone(); } else { parts[0] = si; if (tg) parts.splice(1, 0, FLAC.comments(tg)); }
  const name = ((S.credits.title.trim() || S.audio.name.replace(/\.[^.]+$/, '') || 'Audio').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Audio') + ' - Audio.flac';
  await saveFile(file ? file.slice(0, file.size, 'audio/flac') : new Blob(parts, { type: 'audio/flac' }), name); toast(tx('ae.saved.flac', { len: fmt(ve - vs), bits }));
}
/* the header of a WAV file: RIFF as usual, or RF64 (the same layout with 64-bit sizes in a ds64 chunk) when the file is over 4GB; tail is what follows the sound (a pad byte and the tag chunks) */
function wavHead(bits, ch, sr, total, tail, rf) {
  const bps = bits / 8, bytes = total * ch * bps, fl = bits === 32, hdr = (rf ? 80 : 44) + (fl ? 12 : 0), head = new DataView(new ArrayBuffer(hdr)), wr = (o, s) => { for (let i = 0; i < s.length; i++) head.setUint8(o + i, s.charCodeAt(i)); };
  let o = 0; wr(0, rf ? 'RF64' : 'RIFF'); head.setUint32(4, rf ? 0xffffffff : hdr + bytes - 8 + tail, true); wr(8, 'WAVE'); o = 12;
  if (rf) { wr(o, 'ds64'); head.setUint32(o + 4, 28, true); const big = (at, v) => { head.setUint32(at, v % 4294967296, true); head.setUint32(at + 4, Math.floor(v / 4294967296), true); }; big(o + 8, hdr + bytes - 8 + tail); big(o + 16, bytes); big(o + 24, total); o += 36; }
  wr(o, 'fmt '); head.setUint32(o + 4, 16, true); head.setUint16(o + 8, fl ? 3 : 1, true); head.setUint16(o + 10, ch, true); head.setUint32(o + 12, sr, true); head.setUint32(o + 16, sr * ch * bps, true); head.setUint16(o + 20, ch * bps, true); head.setUint16(o + 22, bits, true); o += 24;
  if (fl) { wr(o, 'fact'); head.setUint32(o + 4, 4, true); head.setUint32(o + 8, rf ? 0xffffffff : total, true); o += 12; }
  wr(o, 'data'); head.setUint32(o + 4, rf ? 0xffffffff : bytes, true);
  return head.buffer;
}
/* len frames of planar samples (tmp) as the bytes of a WAV file at 16, 24 or 32 bits */
function wavBlock(tmp, len, ch, bits) {
  const bps = bits / 8, dv = new DataView(new ArrayBuffer(len * ch * bps)); let o = 0;
  for (let k = 0; k < len; k++) for (let c = 0; c < ch; c++) {
    const raw = tmp[c * len + k];
    if (bits === 32) dv.setFloat32(o, raw, true);          // floating point keeps everything, even peaks past full scale
    else if (bits === 24) { const q = pcmQ(raw, 24); dv.setUint8(o, q & 255); dv.setUint8(o + 1, (q >> 8) & 255); dv.setUint8(o + 2, (q >> 16) & 255); }
    else dv.setInt16(o, pcmQ(raw, 16), true);
    o += bps;
  }
  return dv.buffer;
}
async function aeExport() {
  const btn = $('#aeExport'), d = AE.d && aeCopy(AE.d); if (!d || !S.audio || AE.exporting) return;          // the export works from a copy of the draft as it is now: edits made while it runs do not reach it
  AE.exporting = true; aeRunShow(); let failed = null; const lb = btn.querySelector('span'), label = lb.textContent, ui = aeExpUI(btn); ui('Processing');
  const fmtKind = /^m4a/.test(S.set.audioFormat) ? 'm4a' : /^flac/.test(S.set.audioFormat) ? 'flac' : 'wav';          // wav24 (default), wav (16-bit), wav32 (float), flac24, flac16, m4a<kbps>
  AE.expStop = false; $('#aeExpStop').hidden = false;
  const dk = !!S.audio.disk; if (dk) aeStop();          // the tools on the stored recording are used by the export alone while it runs
  try {
    if (fmtKind === 'm4a') { await aeExportM4a(d, ui); return; }
    if (fmtKind === 'flac') { await aeExportFlac(d, ui); return; }
    const buf = dk ? (await fxGet(d.fx), null) : (await fxGet(d.fx)).buffer, ch = Math.min(2, dk ? audCh() : buf.numberOfChannels), vs = d.vStart, ve = aeEnd(d);
    const mm = dk ? await aeMasterDisk(d, ch, false, ui) : await aeMasterFor(d, buf, ch, false, ui), sr = mm.sr, total = mm.total;
    const kind = S.set.audioFormat, bits = kind === 'wav32' ? 32 : kind === 'wav24' ? 24 : 16, bps = bits / 8, hdr = bits === 32 ? 56 : 44, bytes = total * ch * bps;
    if (!dk && bytes + hdr > 3.9e9) throw new Error('too long');          // a WAV header counts bytes in 32 bits (a recording on the disk store is written as RF64 instead)
    const rf = bytes + hdr > 3.9e9, tg = aeTags(), extra = tg ? wavTagChunks(tg) : null, pad = extra && extra.length && (bytes & 1) ? 1 : 0, tail = pad + (extra ? extra.length : 0);          // chunks sit on even positions
    const head = wavHead(bits, ch, sr, total, tail, rf), parts = [head], block = 65536, tmp = new Float32Array(block * ch);          // written block by block into pieces, so no single huge buffer is needed
    const wr = dk ? diskWriter() : null; if (dk) { await DISK.fileOpen(); await wr.put(head); parts.length = 0; }
    let tk = performance.now();
    for (let pos = 0; pos < total; pos += block) {
      const len = Math.min(block, total - pos); await mm.fill(pos, len, tmp); const ab = wavBlock(tmp, len, ch, bits);
      if (dk) await wr.put(ab); else parts.push(ab);
      if (performance.now() - tk > 30) { ui('Processing', pos / total); await tick(); tk = performance.now(); }
    }
    ui('Processing', 1);
    if (extra && extra.length) { const t = new Uint8Array(tail); t.set(extra, pad); if (dk) await wr.put(t.buffer); else { if (pad) parts.push(new Uint8Array(1)); parts.push(extra); } }
    let file = null; if (dk) { await wr.done(); file = await DISK.fileDone(); }
    const name = ((S.credits.title.trim() || S.audio.name.replace(/\.[^.]+$/, '') || 'Audio').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Audio') + ' - Audio.wav';
    await saveFile(file ? file.slice(0, file.size, 'audio/wav') : new Blob(parts, { type: 'audio/wav' }), name); toast(tx('ae.saved.wav', { len: fmt(ve - vs), kind: bits === 32 ? '32-bit float' : bits + '-bit' }));
  } catch (e) { failed = e; if (AE.expStop) { toast(tx('ae.expstop')); if (S.audio && S.audio.disk) DISK.fileDrop(); } else { console.error(e); toast(tx(e && /changed while exporting/.test(e.message) ? 'ae.expchanged' : 'ae.expfail'), 5000); } }
  finally { const stopped = AE.expStop; $('#aeExpStop').hidden = true; AE.expStop = false; AE.exporting = false; aeRunEnd(failed ? (stopped ? 'stopped' : 'error') : 'done'); btn.classList.remove('exporting'); btn.style.removeProperty('--p'); lb.textContent = label; }
}
/* the draft as an M4A (AAC) file: the same trimmed, faded, leveled sound, encoded in the browser and wrapped in an MP4 container */
const AAC_TOP = 0.985;          // the highest a decoded M4A may stand when the limiter is on (just under full scale; a peak between two samples can be a touch higher than the samples)
async function aeExportM4a(d, ui) {
  if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') { toast(tx('ae.nom4a'), 6000); return; }
  const dk = !!S.audio.disk; ui('Processing'); const buf = dk ? (await fxGet(d.fx), { sampleRate: audSr(), numberOfChannels: audCh() }) : (await fxGet(d.fx)).buffer, sr = aeOutRate(buf), ch = Math.min(2, buf.numberOfChannels), vs = d.vStart, ve = aeEnd(d);
  const kbps = +(String(S.set.audioFormat).replace('m4a', '')) || 256, cfg = await aacConfig(sr, ch, kbps * 1000);
  if (!cfg) { toast(tx('ae.nom4a'), 6000); return; }
  const mm = dk ? await aeMasterDisk(d, ch, true, ui) : await aeMasterFor(d, buf, ch, true, ui), total = mm.total;
  /* AAC does not keep peaks exactly: what a player decodes can stand a little higher than what went in. The limiter's ceiling leaves room for that, and with the limiter on the file is also checked:
     it is decoded as it is made, and if anything would reach full scale it is made once more, turned down by just that much. So a limited M4A never plays back clipped. */
  const guard = limOn(d) && typeof AudioDecoder !== 'undefined', delay = await aacDelay(cfg), block = 4096;
  const pass = async (trim, share) => {
    const mx = new Mp4Writer({ noVideo: true, audio: { sampleRate: sr, channels: ch } }); mx.setAudioTrim(delay, total);
    let err = null, dec = null, top = 0, tmp = new Float32Array(0);
    const hear = a => { try { for (let c = 0; c < a.numberOfChannels; c++) { if (tmp.length < a.numberOfFrames) tmp = new Float32Array(a.numberOfFrames); a.copyTo(tmp, { planeIndex: c, format: 'f32-planar' }); for (let i = 0; i < a.numberOfFrames; i++) { const v = tmp[i] < 0 ? -tmp[i] : tmp[i]; if (v > top) top = v; } } } catch (e) { top = NaN; } a.close(); };
    const enc = new AudioEncoder({ output: (c, m) => { mx.addAudio(c, m);
      if (!guard) return;
      try { if (!dec && m && m.decoderConfig) { dec = new AudioDecoder({ output: hear, error: () => { top = NaN; } }); dec.configure(m.decoderConfig); } if (dec && dec.state === 'configured') dec.decode(c); } catch (e) { top = NaN; } }, error: e => { err = e; } }); enc.configure(cfg);
    for (let pos = 0; pos < total; pos += block) {
      if (err) throw err;
      const len = Math.min(block, total - pos), data = new Float32Array(len * ch); await mm.fill(pos, len, data); if (trim !== 1) for (let i = 0; i < data.length; i++) data[i] *= trim;
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round(pos * 1e6 / sr), data });
      enc.encode(ad); ad.close();
      while (enc.encodeQueueSize > 12 || (dec && dec.decodeQueueSize > 24)) await sleep(5);
      if ((pos / block) % 64 === 63) { ui('Processing', share[0] + (share[1] - share[0]) * pos / total); await tick(); }
    }
    ui('Processing', 1); await enc.flush(); enc.close(); if (err) throw err;
    if (dec) { try { await dec.flush(); dec.close(); } catch (e) { top = NaN; } }
    return { mx, top: dec ? top : NaN };
  };
  let made = await pass(1, [0, 1]);
  if (guard && made.top > AAC_TOP) { const trim = AAC_TOP / made.top * 0.98; dbg('Audio export (M4A): decoded peak ' + DB_TXT(20 * Math.log10(made.top)) + ', made again ' + DB_TXT(20 * Math.log10(trim)) + ' lower'); made = await pass(trim, [0, 1]); made.trim = trim; }
  AE.m4aLast = { top: made.top, trim: made.trim || 1 };          // for checks
  const mx = made.mx, tg = aeTags(); if (tg) mx.setTags(tg);
  const blob = mx.finalize(); dbg('Audio export (M4A): asked the encoder for ' + cfg.bitrate / 1000 + ' kbps, it produced about ' + Math.round(mx.audioKbps()) + ' kbps');
  const name = ((S.credits.title.trim() || S.audio.name.replace(/\.[^.]+$/, '') || 'Audio').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Audio') + ' - Audio.m4a';
  await saveFile(blob, name); toast(tx('ae.saved.m4a', { len: fmt(ve - vs) }));
}
/* ---------------- Audio Editor tools: the rail, EQ, and Imager ---------------- */
const FX_NAMES = { eq: 'EQ', imager: 'Imager' };
/* the waveform's heights: the exact processed sound, or the quick stand-in, or (while those are being made) the last picture shown, never the unprocessed sound, so nothing jumps while a slider is dragged */
const aePeaks = d => {
  const r = fxPeek(d.fx); if (r) return (AE.pkLast = srcTp(r));          // always true peaks, so the meter and the original's peak are measured the same way
  if (AE.pkLast && fxActive(d.fx, fxChannels()).length) return AE.pkLast; return srcTp(S.audio);
};
/* the waveform answers at once: while the exact sound is still being made, a quick copy at a quarter of the sample rate (about four times faster, the same loudness to the eye) stands in for it */
const DEC = new WeakMap();
/* a smaller copy of a recording (every k-th sample, averaged) for sketches; made in short slices so a long recording never freezes the page */
async function decimated(buf, k) {
  let d = DEC.get(buf); if (d) return d; const n = Math.ceil(buf.length / k), out = new AudioBuffer({ length: n, numberOfChannels: Math.min(2, buf.numberOfChannels), sampleRate: buf.sampleRate / k }); let t0 = performance.now();
  for (let c = 0; c < out.numberOfChannels; c++) { const s = buf.getChannelData(c), o = out.getChannelData(c); for (let i = 0; i < n; i++) { let a = 0; const e = Math.min(buf.length, (i + 1) * k); for (let j = i * k; j < e; j++) a += s[j]; o[i] = a / Math.max(1, e - i * k); if ((i & 4095) === 4095 && performance.now() - t0 > 5) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } } }
  DEC.set(buf, out); return out;
}
async function fxQuick(fx) {
  if (S.audio.disk) return null;
  const nch = fxChannels(), act = fxActive(fx, nch).filter(k => k !== 'noise'); if (!act.length) return null;
  const nz = fxActive(fx, nch).includes('noise'), nr = nz ? prePeek(fx, false) : null, src = await decimated(nr ? nr.buffer : S.audio.buffer, Math.max(4, Math.ceil((nr ? nr.buffer : S.audio.buffer).length / 1.6e6))), OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const f2 = fxClone(fx); f2.eq.lin = false;
  const oc = new OC(nch, src.length, src.sampleRate), s = oc.createBufferSource(); s.buffer = src; const chain = fxBuild(oc, f2, nch); s.connect(chain.input); chain.output.connect(oc.destination); s.start(0);
  const out = await new Promise((res, rej) => { const p = oc.startRendering(); if (p && p.then) p.then(res, rej); else oc.oncomplete = e => res(e.renderedBuffer); });
  const per = Math.max(1, Math.floor(out.sampleRate / 100)), len = Math.ceil(S.audio.buffer.length / Math.max(1, Math.floor(S.audio.buffer.sampleRate / 100))), pk = new Float32Array(len), chs = []; for (let c = 0; c < out.numberOfChannels; c++) chs.push(out.getChannelData(c));
  let t0 = performance.now();
  for (let i = 0; i < len; i++) { let m = 0; const a = i * per, b = Math.min(out.length, a + per); for (let c = 0; c < chs.length; c++) { const d = chs[c]; for (let k = a; k < b; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; } } pk[i] = m; if ((i & 255) === 255 && performance.now() - t0 > 5) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); } }
  return { key: fxKey(fx), peaks: pk };
}
function aeQuickKick() {
  if (!AE.d || (AE.quick && AE.quick.key === fxKey(AE.d.fx))) return; if (AE.qBusy) { AE.qAgain = true; return; }
  AE.qBusy = true; const fx = AE.d.fx;
  fxQuick(fx).then(r => { AE.qBusy = false; if (r && AE.d) { AE.quick = r; if (!fxPeek(AE.d.fx)) aeRefresh(); } if (AE.qAgain) { AE.qAgain = false; clearTimeout(AE.qT); AE.qT = setTimeout(aeQuickKick, Math.min(600, 120 + S.audio.duration * 2)); } }, () => { AE.qBusy = false; });          // at most one sketch at a time, with a short rest between them that grows with the length of the recording
}
/* Normalize aims the loudest peak that comes out, so the part the fades turn down does not count */
let aeNormMemo = { k: '', pk: null };
function aeLevelPeaks(d) {
  const pk = aePeaks(d); if (d.audioFades === false) return pk;
  const vs = d.vStart, ve = aeEnd(d), key = [pk.length, TP_VER, pk[0], pk[pk.length >> 1], vs, ve, d.audioFadeLen, d.audioFadeOutLen, d.audioFadeShape, S.audio.name, fxKey(d.fx)].join('|');
  if (aeNormMemo.k !== key) { const o = new Float32Array(pk.length); for (let i = 0; i < pk.length; i++) o[i] = pk[i] * Math.max(aeF(d, vs, ve, i / 100), aeF(d, vs, ve, (i + 1) / 100)); aeNormMemo = { k: key, pk: o }; }
  return aeNormMemo.pk;
}
const aeLevel = (d, from, to) => { if (d.normalize && d.normBy === 'loud') { const i = aeLoudInfo(d); return i && i.g ? i.g : 1; } return levelFor(d.normalize, d.gainDb, from, to, d.normalize ? aeLevelPeaks(d) : aePeaks(d), d.normPeakDb); };
/* the true peaks finished: the numbers that depend on them are worked out again */
function tpReady() { normCache.key = ''; clearTimeout(tpReady.t); tpReady.t = setTimeout(() => { if (AE.d && !$('#audioDlg').hidden) aeRefresh(); }, 40); }
/* sliders that move for you (undo, reset, a preset, Normalize) glide to their place instead of jumping */
const AE_EASE = x => 1 - Math.pow(1 - x, 4);
function aeSlide(el, v) {
  v = +v; if (el._glide) { if (el._glide.user || el._glide.to === v) return; cancelAnimationFrame(el._glide.raf); el._glide = null; }          // a glide you started (a click or double-click) is never interrupted by the refresh it causes
  if (+el.value === v) { paintRange(el); return; }
  if (reducedMotion() || $('#audioDlg').hidden) { el.value = v; paintRange(el); return; }
  const from = +el.value, t0 = performance.now(), dur = 380, g = el._glide = { to: v, raf: 0 };
  const step = now => { if (el._glide !== g) return; const k = clamp((now - t0) / dur, 0, 1); el.value = k < 1 ? from + (v - from) * AE_EASE(k) : v; paintRange(el); if (k < 1) g.raf = requestAnimationFrame(step); else el._glide = null; };
  g.raf = requestAnimationFrame(step);
}
/* a click on a slider's end label, or a double-click on the slider, slides it there as if dragged (one undo step) */
function aeGlideTo(el, v) {
  v = +v; if (el.disabled) return; if (el._glide) { cancelAnimationFrame(el._glide.raf); el._glide = null; }
  const from = +el.value, fire = n => el.dispatchEvent(new Event(n, { bubbles: true }));
  if (from === v) return; if (reducedMotion()) { el.value = v; fire('input'); fire('change'); return; }
  const span = (+el.max) - (+el.min) || 1, t0 = performance.now(), dur = 240 + 260 * Math.min(1, Math.abs(v - from) / span), g = el._glide = { to: v, raf: 0, user: true };
  const step = now => { if (el._glide !== g) return; const k = clamp((now - t0) / dur, 0, 1); el.value = k < 1 ? from + (v - from) * AE_EASE(k) : v; paintRange(el); fire('input'); if (k < 1) g.raf = requestAnimationFrame(step); else { el._glide = null; fire('change'); } };
  g.raf = requestAnimationFrame(step);
}
/* a change to the EQ or Imager: one undo step (a slider drag is one step), then the sound follows live */
/* a tool with nothing to do switches itself off, so the switch always tells the truth */
function fxTidy(fx) { fx.spec.on = fx.spec.edits.length > 0; fx.noise.on = nrReady(fx.noise); fx.eq.on = eqHas(fx); fx.imager.on = imActive(fx.imager); }          // there are no on/off switches: a tool is on when it has something to do
function aeNudge(tool) {
  if (tool === 'eq') { AE.eqNudge = performance.now(); aeAnim(); }
  else { const card = tool === 'noise' ? $('#aeNrSample') : $('#aeWidth').closest('.ae-card'); card.classList.remove('nudge'); void card.offsetWidth; card.classList.add('nudge'); }
}
function aeFx(fn, slide, nudge) {
  const before = JSON.stringify(AE.d.fx); let pushed = false;
  if (slide) { if (!AE.sliding) { aePush(); AE.sliding = true; pushed = true; } } else { aePush(); pushed = true; }
  fn(AE.d.fx); fxTidy(AE.d.fx);
  if (pushed && JSON.stringify(AE.d.fx) === before) { AE.undo.pop(); if (slide) AE.sliding = false; if (nudge) aeNudge(nudge); }          // nothing changed: no undo step
  aeRefresh(); aeLive();
}
/* the live sound: the EQ and Imager nodes sit between the audio and the volume */
/* how much louder or quieter the processed sound is than the original, over the part you keep: the average level where there is sound, so a bypassed tool can be heard at the same loudness (a louder one always seems better) */
function aeRmsOf(buf, a, b) {
  const sr = buf.sampleRate, i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(buf.length, Math.floor(b * sr)), blk = Math.floor(sr / 10), ch = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c));
  const pw = []; let mx = 0; for (let p = i0; p + blk <= i1; p += blk) { let s = 0; for (const d of ch) for (let i = p; i < p + blk; i += 2) s += d[i] * d[i]; pw.push(s); if (s > mx) mx = s; }
  let t = 0, n = 0; pw.forEach(v => { if (v > mx * 1e-5) { t += v; n++; } }); return n ? Math.sqrt(t / n) : 0;
}
/* the loudness of what is heard without the open tool against what the whole chain gives, so the two can be compared at the same level (the volume counts on both sides) */
const AE_RMS = new Map();
function aeRmsGet(fx, a, b) {
  const act = fxActive(fx, fxChannels()).length, key = (act ? fxKey(fx) : 'orig') + '|' + a + '|' + b; if (AE_RMS.has(key)) return AE_RMS.get(key);
  const r = act ? fxPeek(fx) : S.audio; if (!r) return null; const v = aeRmsOf(r.buffer, a, b); if (AE_RMS.size > 8) AE_RMS.clear(); AE_RMS.set(key, v); return v;
}
function aeBypassGain() {
  const d = AE.d; if (!d || !aeBpAny()) return 1; const hf = aeFxHeard(d.fx), a = Math.max(0, d.vStart), b = Math.min(aeEnd(d), S.audio.duration), G = aeLevel(d, a, b), Gh = aeBp('level') ? 1 : G;
  if (Math.abs(G - Gh) < 1e-4 && fxKey(hf) === fxKey(d.fx)) return 1;
  if (S.audio.disk) {          // measured in the store's worker, then the gain follows
    const key = fxKey(d.fx) + '|' + fxKey(hf) + '|' + a + '|' + b + '|' + G.toFixed(4) + '|' + Gh.toFixed(4); if (AE.bpKey === key) return AE.bpLast;
    if (AE.bpAsk !== key) { AE.bpAsk = key; const st = { stale: () => AE.bpAsk !== key }; DISK.rmsScan(fxRecipe(d.fx, audCh()), a, b, st).then(f => DISK.rmsScan(fxRecipe(hf, audCh()), a, b, st).then(h => { if (AE.bpAsk !== key) return; AE.bpKey = key; const pf = f.p * G, ph = h.p * Gh; AE.bpLast = ph > 1e-7 && pf > 1e-7 ? clamp(pf / ph, 0.1, 10) : 1; aeToolsRefresh(); }), e => { if (e !== STALE) console.error(e); }); }
    return AE.bpLast || 1;
  }
  const rf = aeRmsGet(d.fx, a, b), rh = aeRmsGet(hf, a, b);
  if (rf == null || rh == null) {          // one of the two sounds is not made yet: make it (the whole chain last, so that is the one kept), then ask again
    if (!AE.bpBusy) { AE.bpBusy = true; (async () => { try { for (const fx of [hf, d.fx]) if (AE.d === d && aeRmsGet(fx, a, b) == null) { await fxGet(fx, { preview: true }); aeRmsGet(fx, a, b); } } catch (e) { if (e !== STALE) console.error(e); } AE.bpBusy = false; if (AE.d === d) aeToolsRefresh(); })(); }
    return AE.bpLast || 1;
  }
  const key = fxKey(d.fx) + '|' + fxKey(hf) + '|' + a + '|' + b + '|' + G.toFixed(4) + '|' + Gh.toFixed(4); AE.bpKey = key;
  const pf = rf * G, ph = rh * Gh; AE.bpLast = ph > 1e-7 && pf > 1e-7 ? clamp(pf / ph, 0.1, 10) : 1; return AE.bpLast;
}
/* The EQ and the Imager run inside the player (see the player's own notes). A new set of filters while the sound plays (Listen on or off, another band to listen to, a band moved to the mid or the side, Bypass)
   is made beside the old ones and faded in over 40ms as the old ones fade out, so the sound never jumps or rings from filters that start from rest */
const AE_XFADE = 0.04;
/* what the player is told: the filters (none for the original), the original's matched loudness, and whether only the mid or the side is heard */
function aeRouteMsg(soft) {
  const on = !!AE.d, nch = fxChannels(), live = on ? fxLive(actx.sampleRate, aeHearFx(), nch) : null;
  AE.chain = live ? { output: AE.tapC, update(next) { const u = live.next(next); if (!u || !AE.ph) return false; AE.ph.post({ upd: u }); return true; } } : null;
  AE.bpV = aeBpAny() && AE.d && AE.d.matchGain ? aeBypassGain() : 1;          // the original, brought to the processed sound's loudness
  return { chain: live ? live.mods : null, xf: soft ? Math.round(AE_XFADE * actx.sampleRate) : 0, pre: AE.bpV, lis: AE.imListen && nch === 2 ? (AE.imListen === 'mid' ? 1 : 2) : 0 };          // lis: hear only the middle (what both sides share) or only the sides (what differs)
}
function aeRoute() {
  if (!AE.ph) return;
  if (AE.dh) aeDiskSync();          // a disk recording brings its noise reduction and Spectra in the sound itself; a change of Bypass or of those goes to the store
  AE.ph.post(aeRouteMsg(AE.playing && actx.state === 'running'));
}
/* Listen: while it is on (and the EQ is the open tool), playback hears only the part of the sound the chosen band works on: the stretch around a bell or notch, the side a shelf lifts or lowers,
   or what a high-pass or low-pass takes away. Only what plays changes; the settings, the picture and anything exported stay as they are. */
function aeHearFx() {
  const fx = aeFxHeard(AE.d.fx), b = AE.eqListen && AE.tool === 'eq' && !aeBp('eq') ? fx.eq.bands[AE.band] : null; if (!b) return fx;
  const f2 = fxClone(fx), w = Math.max(1 / 3, eqFixedQ(b.type) ? 1 : eqOct(b.q)) / 2, ms = fxChannels() === 2 && (b.place === 'mid' || b.place === 'side'), cut = (type, f) => Object.assign({ type, f: Math.round(clamp(f, 20, 20000)), g: 0, q: 0.71, slope: 48, on: true }, ms ? { place: b.place } : {});          // a mid or side band is heard on its own mid or side
  f2.eq.on = true; f2.eq.auto = false; delete f2.eq.curve; if (ms) f2.eq.solo = b.place;
  f2.eq.bands = b.type === 'lowshelf' || b.type === 'highpass' ? [cut('lowpass', b.f)] : b.type === 'highshelf' || b.type === 'lowpass' ? [cut('highpass', b.f)] : [cut('highpass', b.f / Math.pow(2, w)), cut('lowpass', b.f * Math.pow(2, w))];
  return f2;
}
function aeLive() { if (!AE.playing || !AE.d) return; if (AE.dh) aeDiskSync(); if (!AE.chain || !AE.chain.update(aeHearFx())) aeRoute(); }
/* meters listen to the sound after the volume */
function aeTap() {
  aeUntap(); const ac = actx, mk = () => { const a = ac.createAnalyser(); a.fftSize = 2048; a.smoothingTimeConstant = 0.82; return a; };
  const sp = ac.createChannelSplitter(2), l = mk(), r = mk(), m = mk(); const T = AE.out || AE.g; T.connect(m); T.connect(sp); sp.connect(l, 0); sp.connect(r, fxChannels() === 2 ? 1 : 0);
  const eqA = ac.createAnalyser(); eqA.fftSize = 8192; eqA.smoothingTimeConstant = 0.8; T.connect(eqA);          // a finer one for the EQ's spectrum: 5 Hz apart at the bottom
  AE.an = { sp, l, r, m, eqA, eqSpec: new Float32Array(eqA.frequencyBinCount), buf: new Float32Array(2048), buf2: new Float32Array(2048), spec: new Float32Array(m.frequencyBinCount) };
}
function aeUntap() { if (!AE.an) return; try { const T = AE.out || AE.g; T && T.disconnect(AE.an.eqA); T && T.disconnect(AE.an.m); T && T.disconnect(AE.an.sp); AE.an.sp.disconnect(); } catch (e) {} AE.an = null; }

/* starting points for the EQ: bands only, written from common practice for mixing recordings and mockups of each group. A high-pass at 30Hz or the group's lowest note, nothing past 3dB (most 2dB or less), and wide bells (Q 1 or lower, so a move sounds like tone and not like a notch). Typical problems: mud around 250 to 400Hz, edge around 2 to 4kHz, a dull top. Checked against six wind ensemble recordings (they differ from one another by 5 to 13dB at every point from 125Hz to 5kHz, so moves this size are well within real variety). They are places to start; listen and adjust.
   High-passes above 30Hz: the lowest note of the group (bassoon Bb1 58Hz, tuba F1 44Hz, cello C2 65Hz, bass voice E2 82Hz) with a little room. Reduce harshness is a repair, not a whole sound, so it has none. */
const EQ_PRESETS = [
  ['Wind ensemble', [['highpass', 30, 0, 0.71], ['peaking', 300, -1.5, 0.7], ['peaking', 3000, -1, 0.7], ['highshelf', 10000, 1.5, 0.71]]],
  ['Chamber winds', [['highpass', 45, 0, 0.71], ['peaking', 350, -1.5, 0.8], ['peaking', 2800, -1, 0.8], ['highshelf', 10000, 1.5, 0.71]]],
  ['Brass quintet', [['highpass', 35, 0, 0.71], ['peaking', 250, -1.5, 0.8], ['peaking', 800, -1, 0.8], ['peaking', 3500, -2, 0.8], ['highshelf', 8000, 1, 0.71]]],
  ['Orchestra', [['highpass', 30, 0, 0.71], ['lowshelf', 100, 1, 0.71], ['peaking', 300, -1.5, 0.7], ['peaking', 3000, -1.5, 0.7], ['highshelf', 10000, 1.5, 0.71]]],
  ['Chamber strings', [['highpass', 30, 0, 0.71], ['peaking', 250, -1.5, 0.7], ['peaking', 3000, -1.5, 0.8], ['highshelf', 10000, 2, 0.71]]],
  ['String quartet', [['highpass', 50, 0, 0.71], ['peaking', 300, -1.5, 0.8], ['peaking', 2800, -1.5, 0.9], ['highshelf', 9000, 1.5, 0.71]]],
  ['Choir', [['highpass', 70, 0, 0.71], ['peaking', 280, -2, 0.8], ['peaking', 4000, 1.5, 0.8], ['highshelf', 11000, 1, 0.71]]],
  ['Piano', [['highpass', 30, 0, 0.71], ['peaking', 400, -2, 0.8], ['peaking', 2500, 1, 0.8], ['highshelf', 10000, 1, 0.71]]],
  ['Percussion', [['highpass', 30, 0, 0.71], ['peaking', 400, -2, 0.9], ['peaking', 5000, 1.5, 0.7]]],
  ['Reduce harshness', [['peaking', 3000, -2.5, 0.7], ['peaking', 6000, -1, 0.8]]]
];
const eqBandsOf = p => p[1].map(([type, f, g, q]) => ({ type, f, g, q, on: true }));
const eqMatch = fx => { const sig = JSON.stringify(fx.eq.bands.map(b => [b.type, b.f, b.g, b.q])); const hit = EQ_PRESETS.find(p => JSON.stringify(p[1]) === sig); return hit ? hit[0] : ''; };
/* the Width slider: right is wider (a lower Q). It runs from Q 10 (narrow) to Q 0.2 (wide), and the readout is the band's width in octaves */
const eqQtoPos = q => Math.round(100 * (1 - Math.log(clamp(q, 0.2, 10) / 0.2) / Math.log(50)));
const eqPosToQ = v => Math.round(0.2 * Math.pow(50, 1 - v / 100) * 100) / 100;
const eqOct = q => (2 / Math.LN2) * Math.asinh(1 / (2 * q));
const eqFixedQ = t => t === 'highpass' || t === 'lowpass' || t === 'lowshelf' || t === 'highshelf';          // these have no adjustable width
const EQ_PAD = 34, EQ_DB = 12;          // like most EQ windows, 12 dB up or down is plenty for a score video (and keeps a stray drag from going far)
const eqFx = (f, W) => EQ_PAD + Math.log(f / 20) / Math.log(1000) * (W - 2 * EQ_PAD);
const eqXf = (x, W) => clamp(20 * Math.pow(1000, (x - EQ_PAD) / (W - 2 * EQ_PAD)), 20, 20000);
const eqY = (g, H) => H / 2 - g / EQ_DB * (H / 2 - 14);
const eqYg = (y, H) => clamp((H / 2 - y) / (H / 2 - 14) * EQ_DB, -EQ_DB, EQ_DB);
const eqAxis = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239));
/* the combined EQ curve in dB: the curve the EQ's own filters really have at this recording's sample rate */
function eqCurve(bands, pick) {
  return eqResp({ sampleRate: audSr() }, bands, eqAxis, pick);
}
/* the curve as drawn: the free curve (from EQ Match) as the filters really make it, with the bands on top */
function eqCurveOf(bands, pick) { const e = AE.d && AE.d.fx.eq, cb = e && e.curve ? KFX.eqCurveBands(e.curve, audSr()) : []; return eqCurve(cb.concat(bands), pick); }
/* with a band on the mid or the side, the EQ has one curve for each (a stereo band is on both) */
const eqSplit = bands => fxChannels() === 2 && bands.some(b => b.on && (b.place === 'mid' || b.place === 'side'));
function aeCvSize(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return false;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); return true;
}
/* the bands as drawn: each glides toward its real value (a preset, undo or reset moves the curve instead of snapping it); while you drag they follow directly */
function eqDisp(real) {
  const dn = AE.dn || (AE.dn = []), snap = !!AE.eqDrag || reducedMotion(), k = snap ? 1 : 0.3; let moving = false;
  while (dn.length < real.length) { const b = real[dn.length]; dn.push({ type: b.type, lf: Math.log(b.f), g: snap ? b.g : 0, lq: Math.log(b.q), a: snap ? 1 : 0, on: b.on, slope: b.slope, place: b.place, dyn: b.dyn }); }
  dn.forEach((d, i) => {
    const b = real[i], ta = b ? 1 : 0, tf = b ? Math.log(b.f) : d.lf, tg = b ? b.g : 0, tq = b ? Math.log(b.q) : d.lq;
    if (b) { d.type = b.type; d.on = b.on; d.slope = b.slope; d.place = b.place; d.dyn = b.dyn; }
    d.lf += (tf - d.lf) * k; d.g += (tg - d.g) * k; d.lq += (tq - d.lq) * k; d.a += (ta - d.a) * k;
    if (Math.abs(tf - d.lf) < 0.002 && Math.abs(tg - d.g) < 0.02 && Math.abs(tq - d.lq) < 0.005 && Math.abs(ta - d.a) < 0.01) { d.lf = tf; d.g = tg; d.lq = tq; d.a = ta; } else moving = true;
  });
  for (let i = dn.length - 1; i >= real.length; i--) if (dn[i].a === 0) dn.pop();
  AE.eqMoving = moving;
  return dn.map(d => ({ type: d.type, f: Math.exp(d.lf), g: d.g, q: Math.exp(d.lq), on: d.on, a: d.a, slope: d.slope, place: d.place, dyn: d.dyn }));
}
function aeEqDraw() {
  const cv = $('#aeEqCv'); if (!AE.d || $('#aePaneEq').hidden || !aeCvSize(cv)) return;
  const c = cv.getContext('2d'), W = cv.clientWidth, H = cv.clientHeight, C = TL.C, real = AE.d.fx.eq.bands, bands = eqDisp(real), on = AE.d.fx.eq.on;
  c.clearRect(0, 0, W, H); roundRect(c, 0.5, 0.5, W - 1, H - 1, 10); c.fillStyle = C.panel2; c.fill(); c.save(); c.globalAlpha = 0.06; c.fillStyle = C.ink; c.fill(); c.restore(); c.strokeStyle = C.line; c.lineWidth = 1; c.stroke();
  c.save(); roundRect(c, 1, 1, W - 2, H - 2, 9); c.clip();
  c.font = '10.5px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle'; c.fillStyle = C.muted;
  [-9, -6, -3, 3, 6, 9].forEach(g => { c.globalAlpha = 0.35; c.fillStyle = C.line; c.fillRect(EQ_PAD, Math.round(eqY(g, H)), W - 2 * EQ_PAD, 1); });
  c.globalAlpha = 1; c.fillStyle = C.line; c.fillRect(EQ_PAD, Math.round(eqY(0, H)), W - 2 * EQ_PAD, 1.5);
  [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']].forEach(([f, t]) => { const x = Math.round(eqFx(f, W)); c.globalAlpha = 0.35; c.fillStyle = C.line; c.fillRect(x, 8, 1, H - 24); c.globalAlpha = 1; c.fillStyle = C.muted; c.textAlign = 'center'; c.fillText(t, x, H - 9); });
  c.textAlign = 'right'; [[12, '+12'], [6, '+6'], [0, '0'], [-6, '−6'], [-12, '−12']].forEach(([g, t]) => { c.fillStyle = C.muted; c.fillText(t, EQ_PAD - 6, eqY(g, H)); });
  // the live spectrum while playing
  if (AE.an && AE.playing) {                 // the spectrum as it plays: smoothed to a sixth of an octave, with a thin line that holds the peaks and falls back slowly
    const a = AE.an.eqA, sp = AE.an.eqSpec, sr = actx.sampleRate, hz = sr / 2 / sp.length; a.getFloatFrequencyData(sp);
    const pts = []; for (let i = 0; i < 160; i++) { const f = 20 * Math.pow(1000, i / 159), lo = Math.max(1, Math.floor(f / 1.0595 / hz)), hi = Math.min(sp.length - 1, Math.max(lo, Math.ceil(f * 1.0595 / hz))); let s = 0, n = 0; for (let k = lo; k <= hi; k++) { s += Math.pow(10, (isFinite(sp[k]) ? sp[k] : -140) / 10); n++; } pts.push(10 * Math.log10(s / n + 1e-14)); }
    const pk = AE.eqPk && AE.eqPk.length === 160 ? AE.eqPk : (AE.eqPk = new Float32Array(160).fill(-140)); for (let i = 0; i < 160; i++) pk[i] = Math.max(pts[i], pk[i] - 0.5);
    const yv = db => H - 22 - clamp((db + 100) / 80, 0, 1) * (H - 60);
    c.beginPath(); c.moveTo(EQ_PAD, H - 22); pts.forEach((db, i) => c.lineTo(eqFx(20 * Math.pow(1000, i / 159), W), yv(db))); c.lineTo(W - EQ_PAD, H - 22); c.closePath(); c.globalAlpha = 0.22; c.fillStyle = C.wave; c.fill();
    c.beginPath(); pk.forEach((db, i) => { const x = eqFx(20 * Math.pow(1000, i / 159), W), y = yv(db); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.lineWidth = 1; c.strokeStyle = C.wave; c.globalAlpha = 0.5; c.stroke(); c.globalAlpha = 1;
  } else if (AE.eqPk) AE.eqPk = null;
  // the curve
  const by = hsGet('ae-by', aeBy()), split = eqSplit(bands), cur = split ? eqCurveOf(bands, b => b.place !== 'side') : eqCurveOf(bands), live = on && (real.some(b => b.on) || !!AE.d.fx.eq.curve);
  if (by > 0.01) { c.fillStyle = C.ink; c.globalAlpha = 0.05 * by; c.fillRect(0, 0, W, H); c.globalAlpha = 1; c.setLineDash([6 * by, 6 * by]); }
  c.beginPath(); eqAxis.forEach((f, i) => { const x = eqFx(f, W), y = eqY(clamp(cur[i], -EQ_DB, EQ_DB), H); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
  c.lineJoin = c.lineCap = 'round'; c.lineWidth = 2.2; c.strokeStyle = C.accent; c.globalAlpha = (live ? 1 : 0.35) * (1 - 0.7 * by); c.stroke(); c.setLineDash([]);
  c.lineTo(eqFx(20000, W), eqY(0, H)); c.lineTo(eqFx(20, W), eqY(0, H)); c.closePath(); c.globalAlpha = (live ? 0.12 : 0.05) * (1 - by); c.fillStyle = C.accent; c.fill(); c.globalAlpha = 1;
  if (split) {          // the side has a curve of its own (the mid one is the main curve)
    const cs = eqCurveOf(bands, b => b.place !== 'mid'); if (by > 0.01) c.setLineDash([6 * by, 6 * by]);
    c.beginPath(); eqAxis.forEach((f, i) => { const x = eqFx(f, W), y = eqY(clamp(cs[i], -EQ_DB, EQ_DB), H); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.lineJoin = c.lineCap = 'round'; c.lineWidth = 2.2; c.strokeStyle = C.fade; c.globalAlpha = (live ? 1 : 0.35) * (1 - 0.7 * by); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  }
  // a dynamic band's range: a line from where the band sits to where it goes when the sound is loud
  bands.forEach((b, i) => { if (!b.dyn || !KFX.eqDynOk(b.type) || b.a < 0.5 || !b.dyn.range) return; const x = eqFx(b.f, W), y0 = eqY(b.g, H), y1 = eqY(clamp(b.g + b.dyn.range, -EQ_DB, EQ_DB), H), hue = b.place === 'side' ? C.fade : C.accent, sel = i === AE.band;
    c.save(); c.globalAlpha = (b.on && on ? (sel ? 0.9 : 0.55) : 0.3) * (1 - 0.6 * by); c.strokeStyle = hue; c.lineWidth = 1.6; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); c.setLineDash([]);
    c.beginPath(); c.arc(x, y1, 4.2, 0, 7); c.fillStyle = C.panel2; c.fill(); c.lineWidth = 1.8; c.stroke(); c.restore(); });
  // the bands
  bands.forEach((b, i) => {
    if (b.a < 0.02) return; const x = eqFx(b.f, W), y = eqY(eqNoGain(b.type) ? 0 : b.g, H), sel = i === AE.band, hot = AE.eqHover === i || (AE.eqDrag && AE.eqDrag.i === i), r = (sel || hot ? 9.5 : 8) * (0.5 + 0.5 * b.a);
    c.beginPath(); c.arc(x, y, r, 0, 7); c.globalAlpha = (b.on && on ? 1 : 0.5) * (1 - 0.55 * by) * b.a; const hue = b.place === 'side' ? C.fade : C.accent; c.fillStyle = sel ? hue : C.panel2; c.fill(); c.lineWidth = 2; c.strokeStyle = hue; c.stroke();
    c.fillStyle = sel ? '#fff' : hue; c.font = '600 10.5px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'center'; c.fillText(String(i + 1), x, y + 0.5); c.globalAlpha = 1;
  });
  { // the match target: a clear line, with the gap between it and your EQ softly shaded
    const tgOn = !!(AE.matchOpen && AE.match && AE.match.target); if (tgOn) AE.tgt = AE.match.target; const ta = hsGet('ae-tg', tgOn ? 1 : 0);
    if (ta > 0.01 && AE.tgt) {
      const T = AE.tgt, y = (v) => eqY(clamp(v, -EQ_DB, EQ_DB), H);
      c.save(); c.globalAlpha = 0.14 * ta; c.fillStyle = C.turn; c.beginPath(); eqAxis.forEach((f, i) => { const x = eqFx(f, W); if (i) c.lineTo(x, y(T[i])); else c.moveTo(x, y(T[i])); });
      for (let i = eqAxis.length - 1; i >= 0; i--) c.lineTo(eqFx(eqAxis[i], W), y(cur[i])); c.closePath(); c.fill(); c.restore();
      c.save(); c.globalAlpha = ta; c.lineJoin = c.lineCap = 'round'; c.lineWidth = 2.6; c.strokeStyle = C.turn; c.shadowColor = C.turn; c.shadowBlur = 8; c.beginPath(); eqAxis.forEach((f, i) => { const x = eqFx(f, W); if (i) c.lineTo(x, y(T[i])); else c.moveTo(x, y(T[i])); }); c.stroke(); c.restore();
      c.save(); c.globalAlpha = ta; c.font = '600 11px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = C.turn; c.fillText('━ Target', EQ_PAD + 8, 16); c.fillStyle = C.accent; c.fillText('━ Your EQ', EQ_PAD + 76, 16); if (AE.zoneShown) { c.globalAlpha = 0.45 * ta; c.fillStyle = C.turn; c.fillRect(EQ_PAD + 150, 11, 12, 10); c.globalAlpha = ta; c.fillStyle = C.muted; c.fillText('Spread of six recordings', EQ_PAD + 167, 16); } c.restore();
    }
    if (split) { c.save(); c.globalAlpha = 1 - by * 0.5; c.font = '600 11px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; const ly = tgOn ? 34 : 16; c.fillStyle = C.accent; c.fillText('━ Mid', EQ_PAD + 8, ly); c.fillStyle = C.fade; c.fillText('━ Side', EQ_PAD + 56, ly); c.restore(); }
    const nud = AE.eqNudge ? clamp(1 - (performance.now() - AE.eqNudge) / 900, 0, 1) : 0;
    if (!real.length && !AE.d.fx.eq.curve && !(ta > 0.01)) { c.save(); c.fillStyle = nud > 0 ? C.accent : C.muted; c.font = (nud > 0 ? '600 ' : '') + '13px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'center'; c.globalAlpha = 0.9; c.translate(W / 2, eqY(0, H) - 22); c.scale(1 + 0.06 * nud, 1 + 0.06 * nud); c.fillText(AE.matchOpen ? 'Import a reference to see its target' : 'Double-click to add a band', 0, 0); c.restore(); }
    if (nud > 0) AE.eqMoving = true;
  }
  aePill(c, W, by);
  c.restore();
  if (AE.eqMoving && !AE.eqRaf) AE.eqRaf = requestAnimationFrame(() => { AE.eqRaf = 0; aeEqDraw(); });
}
/* "Bypassed" slides in at the top corner of a stage while the processing is switched off */
function aePill(c, W, by) {
  if (by < 0.02) return; c.save(); c.globalAlpha = Math.min(1, by * 1.4); const t = 'Bypassed', w = 70, h = 22, x = W - w - 12, y = 10 + (1 - Math.min(1, by)) * -8;
  roundRect(c, x, y, w, h, 11); c.fillStyle = TL.C.ink; c.fill(); c.globalAlpha *= 1; c.fillStyle = TL.C.panel2; c.font = '600 11.5px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, x + w / 2, y + h / 2 + 0.5); c.restore();
}
function eqSelected() { const b = AE.d && AE.d.fx.eq.bands[AE.band]; return b || null; }
function aeEqPanel() {
  if (!AE.d) return; const fx = AE.d.fx, b = eqSelected(), row = $('#aeBandG');
  $('#aeAutoBtn').setAttribute('aria-pressed', !!fx.eq.auto);
  $('#aeEqPreset').value = ''; aeMatchUi();          // the menu is a list of starting points, so it always reads Presets
  $('#aeEqAdd').disabled = fx.eq.bands.length >= EQ_MAX_BANDS; $('#aeBandDel').disabled = !b;
  $('#aeEqBand').classList.toggle('none', !b);
  $('#aeBandPlace').hidden = fxChannels() !== 2; document.querySelectorAll('input[name=aeBandPlace]').forEach(r => { r.disabled = !b; }); $('#aeBandPlace').classList.toggle('dim', !b); if (!b) { foldSet('#aeBandDynFold', false); $('#aeBandDyn').setAttribute('aria-pressed', 'false'); }
  if (b) {
    $('#aeBandNo').textContent = AE.band + 1; $('#aeBandType').value = b.type; $('#aeBandF').value = b.f; aeSlide(row, b.g); $('#aeBandGVal').textContent = (b.g > 0 ? '+' : b.g < 0 ? '−' : '') + Math.abs(b.g).toFixed(b.g % 1 ? 1 : 0) + 'dB';
    const q = $('#aeBandQ'), fixed = eqFixedQ(b.type); aeSlide(q, eqQtoPos(b.q)); $('#aeBandQVal').textContent = fixed ? '—' : eqOct(b.q).toFixed(1) + 'oct'; $('#aeBandOn').checked = b.on;
    $('#aeBandGField').classList.toggle('dim', eqNoGain(b.type)); row.disabled = eqNoGain(b.type);
    $('#aeBandQField').classList.toggle('dim', fixed); q.disabled = fixed;
    { const ok = KFX.eqDynOk(b.type), d = ok && b.dyn; $('#aeBandDyn').setAttribute('aria-pressed', !!d); $('#aeBandDyn').disabled = !ok; foldSet('#aeBandDynFold', !!d);
      if (d) { aeSlide($('#aeBandThr'), b.dyn.thr); aeSlide($('#aeBandRange'), b.dyn.range); $('#aeBandThrVal').textContent = (b.dyn.thr < 0 ? '−' : '') + Math.abs(b.dyn.thr) + 'dB'; { const a = $('#aeBandThrAuto'), on = b.dyn.auto != null && b.dyn.thr === b.dyn.auto; a.setAttribute('aria-pressed', on); a.classList.toggle('on', on); } $('#aeBandRangeVal').textContent = (b.dyn.range > 0 ? '+' : b.dyn.range < 0 ? '−' : '') + Math.abs(b.dyn.range) + 'dB'; } }
    $('#aeBandPlace').hidden = fxChannels() !== 2; document.querySelectorAll('input[name=aeBandPlace]').forEach(r => { r.disabled = false; }); { const r = document.querySelector('input[name=aeBandPlace][value="' + (b.place || 'st') + '"]'); if (r && !r.checked) r.checked = true; const sg = $('#aeBandPlace'); if (sg._place) sg._place(false); }
    const cut = b.type === 'highpass' || b.type === 'lowpass'; $('#aeBandQField').hidden = cut; $('#aeBandSField').hidden = !cut;          // a high-pass or low-pass has a slope where the others have a width
    if (cut) { const r = document.querySelector('input[name=aeBandSlope][value="' + eqSlope(b) + '"]'); if (r && !r.checked) r.checked = true; const sg = $('#aeBandSlope'); if (sg._place) sg._place(false); }
  }
  { const h = $('#aeBandHear'); if (!b && AE.eqListen) AE.eqListen = false; h.setAttribute('aria-pressed', !!AE.eqListen); h.disabled = !b;
  }
}
/* Auto threshold: how loud the sound gets in the band's own region over the part you keep (read in pieces, so a long recording does not stall the page), and the threshold set where the louder tenth of it begins.
   It reads the recording as it is, before any band. */
async function aeDynAuto(i, quiet) {
  const d = AE.d, b = d && d.fx.eq.bands[i]; if (!b || !b.dyn || !S.audio || AE.dynBusy) return; AE.dynBusy = true; const t00 = performance.now(), btn = $('#aeBandThrAuto'); btn.disabled = true; btnHold(btn, ['Auto', 'Processing 100%']); btn.classList.add('loading'); btn.style.setProperty('--p', '0%'); btn.textContent = 'Processing 0%';
  try {
    const sr = audSr(), nch = fxChannels(), sp = KFX.eqDynSpec(Object.assign({}, b, { dyn: { thr: 0, range: -6 } }), sr, 1), sc = sp.sc, place = KFX.eqPlace(b, nch), a0 = Math.floor(Math.max(0, d.vStart) * sr), a1 = Math.min(audLen(), Math.floor(aeEnd(d) * sr)), hist = new Float64Array(240), CH = 1 << 17;
    let t = [0, 0, 0, 0], u = [0, 0, 0, 0], p = 0, cnt = 0, total = 0, tick = performance.now();
    for (let at = a0; at < a1; at += CH) {
      const n = Math.min(CH, a1 - at); let L, R; if (S.audio.disk) { const r = await DISK.read(at, n); L = r.chans[0]; R = r.chans[1] || null; } else { const bf = S.audio.buffer; L = bf.getChannelData(0).subarray(at, at + n); R = nch > 1 ? bf.getChannelData(1).subarray(at, at + n) : null; }
      if (!AE.d || AE.d !== d) return;
      for (let k = 0; k < n; k++) {
        let xa = L[k], xb = R ? R[k] : 0; if (R && nch === 2 && place === 'mid') { xa = (xa + xb) / 2; xb = 0; } else if (R && nch === 2 && place === 'side') { xa = (xa - xb) / 2; xb = 0; }
        const ya = sc[0] * xa + sc[1] * t[0] + sc[2] * t[1] - sc[3] * t[2] - sc[4] * t[3]; t[1] = t[0]; t[0] = xa; t[3] = t[2]; t[2] = ya; let e = ya * ya;
        if (R && (place === 'st' || nch !== 2)) { const yb = sc[0] * xb + sc[1] * u[0] + sc[2] * u[1] - sc[3] * u[2] - sc[4] * u[3]; u[1] = u[0]; u[0] = xb; u[3] = u[2]; u[2] = yb; e = (e + yb * yb) / 2; }
        p += (e - p) * sp.kp; if (++cnt >= 16) { cnt = 0; const lv = 10 * Math.log10(p + 1e-14) + 3.0103; if (lv > -110) { hist[Math.min(239, Math.max(0, Math.round((lv + 120) * 2)))]++; total++; } }
      }
      { const pc = Math.round(clamp((at + n - a0) / Math.max(1, a1 - a0), 0, 1) * 100); btn.style.setProperty('--p', pc + '%'); btn.textContent = 'Processing ' + pc + '%'; }
      if (performance.now() - tick > 8) { await new Promise(r => setTimeout(r, 0)); tick = performance.now(); }
    }
    btn.style.setProperty('--p', '100%'); btn.textContent = 'Processing 100%'; const spent = performance.now() - t00; if (spent < 400) await new Promise(r => setTimeout(r, 400 - spent));          // a short recording is read in a blink; the bar stays long enough to be seen
    if (total < 50) { if (!quiet) toast(tx('ae.dyn.nosound'), 3600); return; }
    let acc = 0, lvl = -120; for (let k = 0; k < 240; k++) { acc += hist[k]; if (acc >= total * 0.9) { lvl = k / 2 - 120; break; } }
    const thr = clamp(Math.round(lvl - 3), -80, 0); aeFx(fx => { const x = fx.eq.bands[i]; if (x && x.dyn) { if (!(x.dyn.auto != null && x.dyn.thr === x.dyn.auto)) x.dyn.prev = x.dyn.thr; x.dyn.auto = thr; x.dyn.thr = thr; } });
  } catch (e) { console.error(e); } finally { AE.dynBusy = false; btn.disabled = false; btn.classList.remove('loading'); btn.style.removeProperty('--p'); btn.textContent = 'Auto'; }
}
function aeEqBind() {
  const cv = $('#aeEqCv'), sel = $('#aeBandType');
  sel.innerHTML = Object.keys(EQ_TYPES).map(k => '<option value="' + k + '">' + EQ_TYPES[k] + '</option>').join('');
  $('#aeEqPreset').innerHTML = '<option value="">Presets</option>' + EQ_PRESETS.map(p => '<option>' + p[0] + '</option>').join('');
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const hit = (x, y) => { const W = cv.clientWidth, H = cv.clientHeight, bs = AE.d.fx.eq.bands; let best = -1, bd = 14; bs.forEach((b, i) => { const d = Math.hypot(eqFx(b.f, W) - x, eqY(eqNoGain(b.type) ? 0 : b.g, H) - y); if (d <= bd) { bd = d; best = i; } }); return best; };
  const addAt = (x, y, g) => { const W = cv.clientWidth, H = cv.clientHeight; if (AE.d.fx.eq.bands.length >= EQ_MAX_BANDS) return; aeFx(fx => { fx.eq.on = true; fx.eq.bands.push({ type: 'peaking', f: Math.round(eqXf(x, W)), g: g == null ? Math.round(eqYg(y, H) * 2) / 2 : g, q: 1, on: true }); AE.band = fx.eq.bands.length - 1; }); };
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !AE.d) return; const [x, y] = pos(e), i = hit(x, y); if (i < 0) return;
    cv.setPointerCapture(e.pointerId); AE.band = i; AE.eqDrag = { i, moved: false, pushed: false }; aeRefresh();
  });
  cv.addEventListener('pointermove', e => {
    if (!AE.d) return; const [x, y] = pos(e), W = cv.clientWidth, H = cv.clientHeight, dr = AE.eqDrag;
    if (!dr) { const i = hit(x, y); if (i !== AE.eqHover) { AE.eqHover = i < 0 ? null : i; cv.style.cursor = i < 0 ? 'default' : 'grab'; aeEqDraw(); } return; }
    const b = AE.d.fx.eq.bands[dr.i]; if (!b) return; if (!dr.pushed) { aePush(); dr.pushed = true; }
    b.f = Math.round(eqXf(x, W)); if (!eqNoGain(b.type)) b.g = Math.round(eqYg(y, H) * 2) / 2; dr.moved = true; AE.d.fx.eq.on = true; cv.style.cursor = 'grabbing'; aeRefresh(); aeLive();
  });
  const end = () => { if (AE.eqDrag) { AE.eqDrag = null; cv.style.cursor = 'grab'; aeEqDraw(); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (AE.eqHover != null && !AE.eqDrag) { AE.eqHover = null; aeEqDraw(); } });
  cv.addEventListener('dblclick', e => {
    if (!AE.d) return; const [x, y] = pos(e), i = hit(x, y);
    if (i >= 0) { aeFx(fx => { fx.eq.bands.splice(i, 1); AE.band = Math.min(AE.band, fx.eq.bands.length - 1); if (!fx.eq.bands.length) AE.band = 0; }); return; }
    addAt(x, y);
  });
  cv.addEventListener('wheel', e => {
    if (!AE.d) return; const [x, y] = pos(e), i = hit(x, y); if (i < 0) return; e.preventDefault();
    AE.band = i; aeFx(fx => { const b = fx.eq.bands[i]; b.q = Math.round(clamp(b.q * Math.exp(e.deltaY * 0.004), 0.2, 10) * 100) / 100; fx.eq.on = true; }, true);
    clearTimeout(AE.wheelT); AE.wheelT = setTimeout(() => { AE.sliding = false; }, 300);
  }, { passive: false });
  $('#aeEqAdd').addEventListener('click', () => { if (AE.d.fx.eq.bands.length >= EQ_MAX_BANDS) return; aeFx(fx => { fx.eq.on = true; const used = fx.eq.bands.map(b => b.f); let f = 1000; while (used.some(u => Math.abs(Math.log(u / f)) < 0.3) && f < 15000) f *= 1.6; fx.eq.bands.push({ type: 'peaking', f: Math.round(f), g: 0, q: 1, on: true }); AE.band = fx.eq.bands.length - 1; }); });
  $('#aeEqPreset').addEventListener('change', e => {
    const p = EQ_PRESETS.find(q => q[0] === e.target.value); if (!p) { aeEqPanel(); return; }
    aeFx(fx => { fx.eq.on = true; fx.eq.bands = eqBandsOf(p); delete fx.eq.curve; AE.band = 0; });
  });
  const band = fn => aeFx(fx => { const b = fx.eq.bands[AE.band]; if (b) fn(b); }, false), bandS = fn => aeFx(fx => { const b = fx.eq.bands[AE.band]; if (b) fn(b); }, true);
  document.querySelectorAll('input[name=aeBandSlope]').forEach(r => r.addEventListener('change', e => { if (e.target.checked) band(b => { if (+e.target.value > 12) b.slope = +e.target.value; else delete b.slope; }); }));
  document.querySelectorAll('input[name=aeBandPlace]').forEach(r => r.addEventListener('change', e => { if (e.target.checked) band(b => { if (e.target.value === 'st') delete b.place; else b.place = e.target.value; }); }));
  $('#aeBandDyn').addEventListener('click', () => { const b = eqSelected(); if (!b || !KFX.eqDynOk(b.type)) return; const on = !b.dyn; aeFx(fx => { const x = fx.eq.bands[AE.band]; if (!x) return; if (on) { x.dyn = { thr: -30, range: -6 }; fx.eq.on = true; } else delete x.dyn; }); if (on) aeDynAuto(AE.band, true); });
  $('#aeBandThr').addEventListener('input', e => bandS(b => { if (b.dyn) b.dyn.thr = +e.target.value; })); $('#aeBandRange').addEventListener('input', e => bandS(b => { if (b.dyn) b.dyn.range = +e.target.value; }));
  ['#aeBandThr', '#aeBandRange'].forEach(id => $(id).addEventListener('change', () => { AE.sliding = false; }));
  $('#aeBandThrAuto').addEventListener('click', () => { const b = eqSelected(); if (!b || !b.dyn || AE.dynBusy) return; if (b.dyn.auto != null && b.dyn.thr === b.dyn.auto) aeFx(fx => { const x = fx.eq.bands[AE.band]; if (x && x.dyn) { x.dyn.thr = x.dyn.prev != null ? x.dyn.prev : -30; delete x.dyn.auto; delete x.dyn.prev; } }); else aeDynAuto(AE.band, false); });          // as Balance's Auto: it sets the value it measured, pressing it again puts the slider back where it was, and moving the slider lets it go
  $('#aeBandHear').addEventListener('click', () => { AE.eqListen = !AE.eqListen; aeEqPanel(); aeLive(); });
  sel.addEventListener('change', e => band(b => { b.type = e.target.value; if (b.type !== 'highpass' && b.type !== 'lowpass') delete b.slope; if (eqNoGain(b.type)) b.g = 0; if (eqFixedQ(b.type)) b.q = 0.71; }));
  $('#aeBandF').addEventListener('change', e => band(b => { b.f = Math.round(clamp(+e.target.value || b.f, 20, 20000)); }));
  $('#aeBandG').addEventListener('input', e => bandS(b => { b.g = +e.target.value; })); $('#aeBandQ').addEventListener('input', e => bandS(b => { b.q = eqPosToQ(+e.target.value); }));
  ['#aeBandG', '#aeBandQ'].forEach(id => $(id).addEventListener('change', () => { AE.sliding = false; }));
  $('#aeBandOn').addEventListener('change', e => aeFx(fx => { const b = fx.eq.bands[AE.band]; if (b) { b.on = e.target.checked; if (b.on) fx.eq.on = true; } }));
  $('#aeBandDel').addEventListener('click', () => aeFx(fx => { fx.eq.bands.splice(AE.band, 1); AE.band = Math.max(0, Math.min(AE.band, fx.eq.bands.length - 1)); }));
}

/* Imager: the stereo picture (left against right) and how alike the two sides are */
/* where the sound sits between left and right over the part you keep (only where there is sound): the mean power of each side, from blocks of a tenth of a second */
function imSummary(pl, pr, blk) {
  let mx = 0; pl.forEach((v, i) => { mx = Math.max(mx, v + pr[i]); }); let tl = 0, tr = 0, n = 0; pl.forEach((v, i) => { if (v + pr[i] > mx * 1e-5) { tl += v; tr += pr[i]; n++; } });          // quiet gaps do not count: only where there is sound
  return n && tl > 0 && tr > 0 ? { l: tl / n, r: tr / n, db: 10 * Math.log10(tl / tr), ldb: 10 * Math.log10(tl / n / (blk / 2)), rdb: 10 * Math.log10(tr / n / (blk / 2)) } : null;
}
function imMeasure() {
  const d = AE.d, key = S.audio.name + '|' + d.vStart + '|' + aeEnd(d); if (AE.lrKey === key && AE.lr) return AE.lr;
  if (S.audio.disk) { if (audCh() < 2) return (AE.lr = null); imMeasureDisk(key, d); return AE.lrKey === key ? AE.lr : null; }          // read from the disk store a little at a time; the panel fills in when it is done
  const buf = S.audio.buffer, sr = buf.sampleRate; if (buf.numberOfChannels < 2) return (AE.lr = null);
  const a = Math.max(0, Math.floor(d.vStart * sr)), e = Math.min(buf.length, Math.floor(aeEnd(d) * sr)), L = buf.getChannelData(0), R = buf.getChannelData(1), blk = Math.floor(sr / 10), pl = [], pr = [];
  for (let p = a; p + blk <= e; p += blk) { let sl = 0, srr = 0; for (let i = p; i < p + blk; i += 2) { sl += L[i] * L[i]; srr += R[i] * R[i]; } pl.push(sl); pr.push(srr); }
  AE.lrKey = key; return (AE.lr = imSummary(pl, pr, blk));
}
function imMeasureDisk(key, d) {
  if (AE.lrWant === key) return; AE.lrWant = key; clearTimeout(AE.lrT);
  AE.lrT = setTimeout(async () => {          // after a short rest, so dragging the start or end does not read the recording again at every step
    const sr = S.audio.sr, a = Math.max(0, Math.floor(d.vStart * sr)), e = Math.min(S.audio.frames, Math.floor(aeEnd(d) * sr)), blk = Math.floor(sr / 10), step = blk * 10, pl = [], pr = [];          // a second at a time, so a start of playing never waits long behind it
    try {
      for (let p = a; p + blk <= e;) {
        const n = Math.min(step, Math.floor((e - p) / blk) * blk), r = await DISK.read(p, n); if (AE.lrWant !== key || !AE.d) return; const L = r.chans[0], R = r.chans[1];
        for (let q = 0; q + blk <= n; q += blk) { let sl = 0, srr = 0; for (let i = q; i < q + blk; i += 2) { sl += L[i] * L[i]; srr += R[i] * R[i]; } pl.push(sl); pr.push(srr); }
        p += n; await new Promise(r => setTimeout(r, AE.playing || AE.starting ? 60 : 0));
      }
    } catch (err) { if (AE.lrWant === key) AE.lrWant = null; return; }
    AE.lrKey = key; AE.lr = imSummary(pl, pr, blk); if (AE.d && AE.lrWant === key) aeToolsRefresh();
  }, 250);
}
const imSgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
function aeImPanel() {
  const im = AE.d.fx.imager, mono = fxChannels() < 2, w = $('#aeWidth'), f = $('#aeMonoBassF'), v = im.width - 100;
  aeSlide(w, v); $('#aeWidthVal').textContent = im.width + '%';
  const bw = im.bw || [100, 100, 100]; [['#aeBwLo', 0], ['#aeBwMid', 1], ['#aeBwHi', 2]].forEach(([id, i]) => { const x = bw[i] - 100; aeSlide($(id), x); $(id + 'Val').textContent = imSgn(x); });
  const bandsOn = imBands(im) || AE.imBandsView; const mode = bandsOn ? 'bands' : 'all'; AE.imBandsView = bandsOn;
  const r = document.querySelector('input[name=aeWidthMode][value=' + mode + ']'); if (r && !r.checked) { r.checked = true; const sg = $('#aeWidthMode'); if (sg._place) sg._place(true); }
  $('#aeWvAll').classList.toggle('off', bandsOn); $('#aeWvBands').classList.toggle('off', !bandsOn);
  $('#aeMonoBass').checked = im.monoBass > 0; if (im.monoBass > 0) aeSlide(f, im.monoBass); $('#aeMonoBassVal').textContent = (im.monoBass > 0 ? im.monoBass : f.value) + 'Hz';
  $('#aeMonoBassField').classList.toggle('dim', !(im.monoBass > 0)); f.disabled = !(im.monoBass > 0);
  const bl = im.bal || 0; aeSlide($('#aeBal'), bl); $('#aeBalVal').textContent = Math.abs(bl) < 0.05 ? 'No shift' : Math.abs(bl).toFixed(1) + 'dB ' + (bl > 0 ? 'right' : 'left');
  const m = mono ? null : imMeasure(), lr = $('#aeLR'), ab = $('#aeBalAuto'), say = $('#aeBalSay'); lr.classList.toggle('none', !m);
  if (m) {          // d0 is left minus right in dB (positive = left louder). A shift to the right takes that many dB off the difference, so Auto sets the shift to d0.
    const d0 = m.db, target = Math.round(clamp(d0, -12, 12) * 10) / 10, auto = Math.abs(d0) >= 0.05 && Math.abs(bl - target) < 0.06, nl = m.ldb - bl / 2, nr = m.rdb + bl / 2, diff = nl - nr, even = Math.abs(diff) < 0.25;
    const ref = Math.max(nl, nr), pct = v => clamp((v - (ref - 6)) / 6, 0, 1) * 100, dbf = v => v.toFixed(1).replace('-', '−') + 'dB';          // the louder side fills its bar; a side 6dB down shows empty
    $('#aeBalLb').style.width = pct(nl) + '%'; $('#aeBalRb').style.width = pct(nr) + '%';
    $('#aeBalL').textContent = dbf(nl); $('#aeBalR').textContent = dbf(nr); lr.classList.toggle('even', even);
    say.textContent = even ? 'Even' : (diff > 0 ? 'Left' : 'Right') + ' louder by ' + Math.abs(diff).toFixed(1) + 'dB'; say.classList.toggle('even', even);
    ab.setAttribute('aria-pressed', auto); ab.classList.toggle('on', auto);
  } else { say.textContent = ''; say.classList.remove('even'); ab.setAttribute('aria-pressed', 'false'); ab.classList.remove('on'); ['#aeBalL', '#aeBalR'].forEach(i => { $(i).textContent = ''; }); }
  [w, $('#aeMonoBass'), f, $('#aeBal'), $('#aeBalAuto'), $('#aeBwLo'), $('#aeBwMid'), $('#aeBwHi')].forEach(el => { el.disabled = mono || (el === f && !(im.monoBass > 0)); });
  $('#aeWidthCard').classList.toggle('dim', mono); $('#aeBalCard').classList.toggle('dim', mono);
  document.querySelectorAll('input[name=aeListen]').forEach(x => { x.disabled = mono; x.checked = x.value === (AE.imListen || ''); }); const lsg = $('#aeListen'); if (lsg._place) lsg._place(false);
}
function aeImBind() {
  $('#aeWidth').addEventListener('input', e => { aeFx(fx => { fx.imager.width = 100 + +e.target.value; fx.imager.on = true; }, true); if (+e.target.value === -100) edSay('ae', 'mono'); });
  [['#aeBwLo', 0], ['#aeBwMid', 1], ['#aeBwHi', 2]].forEach(([id, i]) => $(id).addEventListener('input', e => aeFx(fx => { fx.imager.bw = (fx.imager.bw || [100, 100, 100]).slice(); fx.imager.bw[i] = 100 + +e.target.value; fx.imager.on = true; }, true)));
  $('#aeBal').addEventListener('input', e => aeFx(fx => { fx.imager.bal = Math.round(+e.target.value * 10) / 10; fx.imager.on = true; }, true));
  $('#aeBalAuto').addEventListener('click', () => { const m = imMeasure(); if (!m) { toast(tx('ae.nosound'), 4200); return; } const target = Math.round(clamp(m.db, -12, 12) * 10) / 10, on = Math.abs(m.db) >= 0.05 && Math.abs((AE.d.fx.imager.bal || 0) - target) < 0.06; if (!on && Math.abs(m.db) < 0.05) { toast(tx('ae.balmatch'), 3200); return; } aeFx(fx => { fx.imager.bal = on ? 0 : target; if (!on) fx.imager.on = true; }); });          // Auto is a switch: it sets the shift that evens the two sides, and pressing it again puts the shift back to none          // left louder by 2 dB: take 1 off the left and put 1 on the right
  $('#aeMonoBassF').addEventListener('input', e => aeFx(fx => { fx.imager.monoBass = +e.target.value; fx.imager.on = true; }, true));
  ['#aeWidth', '#aeMonoBassF', '#aeBal', '#aeBwLo', '#aeBwMid', '#aeBwHi'].forEach(id => $(id).addEventListener('change', () => { AE.sliding = false; }));
  $('#aeMonoBass').addEventListener('change', e => aeFx(fx => { fx.imager.monoBass = e.target.checked ? +$('#aeMonoBassF').value : 0; if (e.target.checked) fx.imager.on = true; }));
  document.querySelectorAll('input[name=aeWidthMode]').forEach(r => r.addEventListener('change', e => {
    AE.imBandsView = e.target.value === 'bands';
    if (!AE.imBandsView && imBands(AE.d.fx.imager)) aeFx(fx => { fx.imager.bw = [100, 100, 100]; }); else aeImPanel();           // back to Overall puts the three bands level again
  }));
  document.querySelectorAll('input[name=aeListen]').forEach(r => r.addEventListener('change', e => { AE.imListen = e.target.value || null; if (AE.playing) aeRoute(); }));
}
function aeScopeDraw() {
  const cv = $('#aeScope'); if (!AE.d || $('#aePaneImager').hidden || !aeCvSize(cv)) return;
  const c = cv.getContext('2d'), W = cv.clientWidth, H = cv.clientHeight, C = TL.C, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 18;
  c.clearRect(0, 0, W, H); roundRect(c, 0.5, 0.5, W - 1, H - 1, 12); c.fillStyle = C.panel2; c.fill(); c.save(); c.globalAlpha = 0.06; c.fillStyle = C.ink; c.fill(); c.restore(); c.strokeStyle = C.line; c.lineWidth = 1; c.stroke();
  c.save(); c.strokeStyle = C.line; c.globalAlpha = 0.9; c.beginPath(); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx - R * 0.7071, cy + R * 0.7071); c.lineTo(cx + R * 0.7071, cy - R * 0.7071); c.moveTo(cx - R * 0.7071, cy - R * 0.7071); c.lineTo(cx + R * 0.7071, cy + R * 0.7071); c.stroke(); c.restore();
  c.fillStyle = C.muted; c.font = '10.5px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('Mono', cx, cy - R - 8); c.fillText('L', cx - R * 0.7071 - 9, cy - R * 0.7071 - 6); c.fillText('R', cx + R * 0.7071 + 9, cy - R * 0.7071 - 6);
  if (fxChannels() < 2) { c.fillStyle = C.muted; c.font = '13px "Instrument Sans",system-ui,sans-serif'; c.fillText('Mono audio', cx, cy + R + 4); }
  aePill(c, W, hsGet('ae-by', aeBy()));
  if (!AE.an || !AE.playing) return;
  const a = AE.an; a.l.getFloatTimeDomainData(a.buf); a.r.getFloatTimeDomainData(a.buf2);
  let sl = 0, sr2 = 0, slr = 0, pk = 0; for (let i = 0; i < a.buf.length; i++) { const L = a.buf[i], Rr = a.buf2[i]; sl += L * L; sr2 += Rr * Rr; slr += L * Rr; pk = Math.max(pk, Math.abs(L), Math.abs(Rr)); }
  AE.scopeMax = Math.max(pk, (AE.scopeMax || 0) * 0.985); const k = R / Math.max(0.1, AE.scopeMax);
  c.save(); c.beginPath(); c.arc(cx, cy, R + 8, 0, 7); c.clip(); c.fillStyle = C.accent; c.globalAlpha = 0.42;
  for (let i = 0; i < a.buf.length; i += 2) { const L = a.buf[i], Rr = a.buf2[i]; c.fillRect(cx + (Rr - L) * 0.7071 * k - 0.7, cy - (L + Rr) * 0.7071 * k - 0.7, 1.5, 1.5); }
  c.restore();
  const corr = sl > 1e-9 && sr2 > 1e-9 ? slr / Math.sqrt(sl * sr2) : 1; AE.corr = (AE.corr == null ? corr : AE.corr * 0.85 + corr * 0.15);
  $('#aeCorr').style.setProperty('--c', ((AE.corr + 1) / 2).toFixed(3));
  $('#aeCorr').classList.toggle('bad', AE.corr < 0);
}
/* the meter at rest shows the loudest peak of the part you keep; while the sound plays it rides the audio instead, with a peak hold, and a Clip light that stays on until you click it (or until you change what sets the level) */
function aeMeterStatic() {
  const m = AE.ms, el = $('#aeMeter'); if (!m) return;
  $('#aeMeterFill').style.width = m.fill + '%'; $('#aeMeterOrig').style.left = m.orig + '%'; $('#aeMeterHold').style.opacity = '0'; el.classList.toggle('hot', m.hot); el.classList.toggle('good', m.good);
  $('#aePeakNow').textContent = m.text; $('#aeClip').hidden = !(m.hot || AE.clipLatch);
}
function aeMeterLive() {
  const el = $('#aeMeter'), on = !!(AE.playing && AE.an);
  if (!on) { if (AE.mLive) { AE.mLive = false; el.classList.remove('live'); aeMeterStatic(); if (AE.d && AE.sumIn) aeSummary(AE.d); } return; }
  const a = AE.an, w = AE.ph && AE.ph.wave(); if (w) a.buf.set(w); else a.m.getFloatTimeDomainData(a.buf); const pk = liveTruePeak(a.buf);          // true peak, the same measure as when stopped, on the samples the player itself put out (an analyser's readings carry Safari's protection noise, enough to light Clip by mistake)
  if (!AE.mLive) { AE.mLive = true; AE.mv = 0; AE.hold = 0; AE.holdT = 0; el.classList.add('live'); }
  const now = performance.now(), fresh = now >= (AE.clipFrom || 0); AE.mv = Math.max(pk, (AE.mv || 0) * 0.9);          // just after a change of level the meter still holds the sound from before it
  if (fresh && pk > AE.hold) AE.hold = pk;          // the highest true peak since play started: held like the peak readouts in Logic and Cubase, until it is reset
  const db = v => v > 1e-5 ? 20 * Math.log10(v) : -Infinity, pos = v => isFinite(v) ? clamp((v + 36) / 48, 0, 1) * 100 : 0;
  $('#aeMeterFill').style.width = pos(db(AE.mv)) + '%'; const h = $('#aeMeterHold'); h.style.left = pos(db(AE.hold)) + '%'; h.style.opacity = AE.hold > 1e-4 ? '1' : '0';
  el.classList.toggle('hot', AE.mv > 1.0005); el.classList.toggle('good', AE.mv >= 0.5 && AE.mv <= 1.0005);
  $('#aePeakNow').textContent = DB_TXT(db(AE.hold));          // the number is the highest true peak since play started
  if (!fresh) AE.mv = 0; else if (pk > 1.0005 && !AE.clipLatch) { AE.clipLatch = true; if (!AE.clip) aeClipSay(); } $('#aeClip').hidden = !(AE.clipLatch || (fresh && AE.mv > 1.0005));
}
/* while the sound clips, the gain readout jumps with the music */
function aeBounce() {
  const el = $('#aeGainBig'); let sc = 1;
  if (AE.clip && AE.playing && AE.an) { const a = AE.an; a.m.getFloatTimeDomainData(a.buf); let pk = 0; for (let i = 0; i < a.buf.length; i++) { const v = a.buf[i] < 0 ? -a.buf[i] : a.buf[i]; if (v > pk) pk = v; } AE.bnc = (AE.bnc || 0) * 0.5 + Math.min(1, pk) * 0.5; sc = 1 + AE.bnc * 0.32; } else AE.bnc = 0;
  el.style.transform = sc === 1 ? '' : 'scale(' + sc.toFixed(3) + ')';
}
/* the fade's shape: the start and the end of the part you keep, drawn at the chosen length. Length and curve glide when they change. */
/* the fade as it is drawn right now: length and curve glide to the new setting, shared by the Shape picture and the waveform */
function aeFadeFn(d) {
  const shape = d.audioFadeShape || 'smooth', hs = TL.hs || (TL.hs = {}), w = {}, [ti, to] = aeFadeLens(d); let ws = 0;
  const init = (k, v) => { if (!hs[k]) hs[k] = { x: v, v: 0, t: v }; };
  init('ae-fl', ti); init('ae-fo', to); Object.keys(AE_SHAPES).forEach(k => init('ae-fw-' + k, k === shape ? 1 : 0));
  const Li = hsGet('ae-fl', ti), Lo = hsGet('ae-fo', to);
  Object.keys(AE_SHAPES).forEach(k => { w[k] = Math.max(0, hsGet('ae-fw-' + k, k === shape ? 1 : 0)); ws += w[k]; });
  return { Li, Lo, f: x => { x = clamp(x, 0, 1); let v = 0; for (const k in w) v += w[k] * AE_SHAPES[k](x); return ws > 0 ? v / ws : x; } };
}
/* which fade the Length slider is for: Both, In or Out. This only picks what the slider moves; it is not part of the sound's settings */
function aeFadeSide(v, quiet) {
  AE.fadeSide = v; AE.fadeForce = v === 'both' && !quiet;          // choosing Both yourself is allowed even when the two differ: moving the slider then sets them to one length const r = document.querySelector('input[name=aeFadeSide][value=' + v + ']'); if (r && !r.checked) { r.checked = true; const sg = $('#aeFadeSide'); if (sg._place) sg._place(!quiet); }
  if (!quiet && AE.d) aeRefresh();
}
/* move the chosen fade to a length; a side left at 0 has no fade, and with both at 0 the fades are off */
function aeFadeSet(v) {
  const d = AE.d, sd = AE.fadeSide || 'both'; let [li, lo] = aeFadeLens(d);
  if (sd === 'both') li = lo = v; else if (sd === 'in') li = v; else lo = v;
  if (li <= 0 && lo <= 0) { d.audioFades = false; d.audioFadeLen = AE_FADE; d.audioFadeOutLen = null; return; }
  d.audioFades = true; d.audioFadeLen = li; d.audioFadeOutLen = lo === li ? null : lo; if (lo === li) AE.fadeForce = false;
}
const aeFadeBadge = d => { const [i, o] = aeFadeLens(d), t = v => (+Math.min(v, 3)).toFixed(1) + 's'; return i <= 0 && o <= 0 ? '' : i === o ? t(i) : i <= 0 ? 'Out ' + t(o) : o <= 0 ? 'In ' + t(i) : (+Math.min(i, 3)).toFixed(1) + '/' + t(o); };
function aeFadeDraw() {
  const cv = $('#aeFadeCv'); if (!AE.d || $('#aePaneFades').hidden || !aeCvSize(cv)) return;
  const c = cv.getContext('2d'), W = cv.clientWidth, H = cv.clientHeight, C = TL.C, d = AE.d, side = AE.fadeSide || 'both';
  const { Li, Lo, f } = aeFadeFn(d);
  const top = 10, bot = H - 24, span = Math.max(0.5, +$('#aeFadeLen').max || 3), a0 = 8, a1 = W * 0.42, b0 = W * 0.58, b1 = W - 8;
  c.clearRect(0, 0, W, H); c.strokeStyle = C.line; c.lineWidth = 1; c.beginPath(); c.moveTo(0, top + 0.5); c.lineTo(W, top + 0.5); c.moveTo(0, bot + 0.5); c.lineTo(W, bot + 0.5); c.stroke();
  const y = v => top + (1 - v) * (bot - top), font = '11px "Instrument Sans",system-ui,sans-serif';
  /* time runs left to right in both pictures: the first rises into the music, the second falls away from it, each with a caption */
  const zone = (x0, x1, L, dir, name, on) => {
    const al = (on ? 1 : 0.4) * (0.35 + 0.65 * Math.min(1, L / 0.25)), pt = px => { const t = (dir > 0 ? px : (x1 - x0) - px) / (x1 - x0) * span; return [x0 + px, y(L < 0.001 ? 1 : f(t / L))]; };
    c.beginPath(); for (let px = 0; px <= x1 - x0; px++) { const [x, yy] = pt(px); px ? c.lineTo(x, yy) : c.moveTo(x, yy); }
    c.lineJoin = c.lineCap = 'round'; c.lineWidth = 2.4; c.strokeStyle = C.accent; c.globalAlpha = al; c.stroke();
    c.lineTo(x1, bot); c.lineTo(x0, bot); c.closePath(); c.globalAlpha = 0.12 * al; c.fillStyle = C.accent; c.fill();
    if (L > 0.02) {          // a tick and the length where the fade finishes (in) or starts (out)
      const k = Math.max(3, Math.round(L / span * (x1 - x0))), tx = dir > 0 ? x0 + k : x1 - k;
      c.globalAlpha = Math.min(1, L / 0.15) * (on ? 1 : 0.5); c.fillStyle = C.muted; c.font = font; c.textBaseline = 'top'; c.fillRect(Math.round(tx), bot - 3, 1, 7); c.textAlign = dir > 0 ? 'left' : 'right'; c.fillText(L.toFixed(1) + 's', tx + (dir > 0 ? -3 : 3), bot + 7);
    }
    c.globalAlpha = on ? 0.9 : 0.45; c.fillStyle = C.muted; c.font = '600 10.5px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'bottom'; c.textAlign = dir > 0 ? 'right' : 'left'; c.fillText(name, dir > 0 ? x1 - 6 : x0 + 6, bot - 6); c.globalAlpha = 1;
  };
  zone(a0, a1, Li, 1, 'FADE IN', side !== 'out'); zone(b0, b1, Lo, -1, 'FADE OUT', side !== 'in');
  c.save(); c.setLineDash([2, 5]); c.strokeStyle = C.muted; c.globalAlpha = 0.6; c.beginPath(); c.moveTo(a1 + 4, y(1)); c.lineTo(b0 - 4, y(1)); c.stroke(); c.restore();          // the music carries on in between
}
function aeToolLive() { if (AE.tool === 'eq') aeEqDraw(); else if (AE.tool === 'imager') aeScopeDraw(); else if (AE.tool === 'level') { aeMeterLive(); aeBounce(); } else if (AE.tool === 'fades') aeFadeDraw(); else if (AE.tool === 'noise') aeNrDraw(); }
/* the tool windows slide like one tall page: the new one comes in from the side of the list you are moving toward, with the old one leaving the other way */
/* the order of tools as they sit on screen: every slide's direction is read from here */
const railOrder = sel => Array.from(document.querySelectorAll(sel)).map(b => b.dataset.tool);
const paneNow = el => { const cs = getComputedStyle(el); return { o: +cs.opacity, y: cs.transform === 'none' ? 0 : new DOMMatrixReadOnly(cs.transform).m42 }; };          // where a pane is right now, so a switch made mid-motion carries on from there instead of starting over
function aeSlidePane(panes, prev, name) {
  const body = $('#aeBody') || $('.ae-pbody'), tools = railOrder('#aeRail .ae-tool'), was = new Map();
  const h0 = body.offsetHeight;
  Object.keys(panes).forEach(k => { const el = $('#' + panes[k]); if (el._slide) was.set(el, paneNow(el)); (el._slide || []).forEach(a => a.cancel()); el._slide = null; el.classList.remove('sliding'); if (k !== name) el.hidden = true; });
  body.classList.remove('sliding'); const cur = $('#' + panes[name]), old = prev && prev !== name ? $('#' + panes[prev]) : null; cur.hidden = false;
  if (!old || reducedMotion()) return;
  const dir = tools.indexOf(name) > tools.indexOf(prev) ? 1 : -1, lift = AE_LIFT, f = was.get(old) || { o: 1, y: 0 }, g = was.get(cur) || { o: 0, y: dir * lift };
  old.hidden = false; old.classList.add('sliding'); body.classList.add('sliding');
  const a1 = old.animate([{ transform: 'translateY(' + f.y + 'px)', opacity: f.o }, { transform: 'translateY(' + (-dir * lift) + 'px)', opacity: 0 }], { duration: AE_TOOL_MS * 0.55, easing: EASE_OUT, fill: 'forwards' });          // the old tool leaves quickly: a quick fade and a small lift the way you are moving
  const a2 = cur.animate([{ transform: 'translateY(' + g.y + 'px)', opacity: g.o }, { transform: 'none', opacity: 1 }], { duration: AE_TOOL_MS * 0.85, delay: AE_TOOL_MS * 0.15, easing: EASE_OUT, fill: 'backwards' });          // the new one arrives a moment later, so the two overlap and the window is never empty
  old._slide = [a1]; cur._slide = [a2];
  const h1 = body.offsetHeight; if (Math.abs(h1 - h0) > 1) { const a3 = body.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: AE_TOOL_MS, easing: EASE_GLIDE }); a2.finished.then(() => a3.cancel(), () => a3.cancel()); }          // a window that is taller or shorter for the next tool (phones) grows or shrinks along with it
  a2.onfinish = () => { old._slide = null; cur._slide = null; a1.cancel(); old.classList.remove('sliding'); old.hidden = AE.tool !== prev; body.classList.remove('sliding'); };
}
/* the tool list: which tool is open, which are on, and in what order they run */
/* each tool has its natural picture: Spectra works on the spectrogram, every other tool on the waveform. Choosing a tool sets it; the Wave | Spec switch overrides it until the next tool is chosen. */
/* the waveform and the spectrum share one frame: the picture turns from one to the other in place (aeDraw), while the ruler, the handles and the playhead stay where they are */
function aeSetView(v, dir) {
  if (AE.view === v) return;
  AE.view = v; $('#audioDlg').dataset.view = v; const r = document.querySelector('input[name=aeView][value=' + v + ']'); if (r) { r.checked = true; const sg = $('#aeView'); if (sg._place) sg._place(true); }
  hsGet('ae-vt', v === 'spec' ? 1 : 0); if (v === 'spec') specStart(); aeAnim();          // the target is set first, so the animation loop sees something moving
}
const AE_NAMES = { noise: 'Noise reduction', spec: 'Spectra', eq: 'EQ', imager: 'Imager', level: 'Level', fades: 'Fades', emu: 'Emulator (beta)' };
const AE_SUBS = { noise: 'Banish hiss, hum, or room tone.', spec: 'Heals or turns down a blip, a hum, or a squeak you can see.', eq: 'Shapes the tone, band by band.', imager: 'Stereo width and balance.', level: 'Gain, and how loud the finished audio is.', fades: 'Eases the start in and the end out.', emu: 'Borrows the sound of another recording.' };
/* the head, the tool window and the line between them travel together: the old ones leave, the new ones come in from the same side */
function aeHead(name, dir) {
  const top = $('#aeTop'), head = $('#aeHead'), win = $('#aeWin'), set = () => { $('#aePaneTitle').textContent = AE_NAMES[name]; $('#aePaneSub').textContent = AE_SUBS[name]; };
  win.querySelectorAll('.ae-ghost').forEach(n => n.remove()); const was = head._slide ? paneNow(head) : null; (head._slide || []).forEach(a => a.cancel());
  if (!dir || reducedMotion() || !top.offsetHeight || $('#audioDlg').hidden) { set(); return; }
  const ghost = head.cloneNode(true), lift = AE_LIFT, f = was || { o: 1, y: 0 };
  ghost.removeAttribute('id'); ghost.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); ghost.classList.add('ae-ghost'); ghost.inert = true; ghost.setAttribute('aria-hidden', 'true'); top.appendChild(ghost); set();
  const g = ghost.animate([{ transform: 'translateY(' + f.y + 'px)', opacity: f.o }, { transform: 'translateY(' + (-dir * lift) + 'px)', opacity: 0 }], { duration: AE_TOOL_MS * 0.55, easing: EASE_OUT, fill: 'forwards' }); g.onfinish = g.oncancel = () => ghost.remove();
  head._slide = [head.animate([{ transform: 'translateY(' + (dir * lift) + 'px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: AE_TOOL_MS * 0.85, delay: AE_TOOL_MS * 0.15, easing: EASE_OUT, fill: 'backwards' })];          // the title and its line arrive as the old ones leave; the divider line stays where it is
}
function aeTool(name) {
  const prev = AE.tool; AE.tool = name; aeRingSync(); if (name === 'level' && AE.d) aeRefresh();          // opening Level starts its measures (they only run while it is open)
  $('#audioDlg').dataset.tool = name; hsSnap('ae-by', aeBy()); if (name !== 'noise') nrArm(false); if (name !== 'spec') spArm(false);
  const panes = { noise: 'aePaneNoise', spec: 'aePaneSpec', eq: 'aePaneEq', imager: 'aePaneImager', level: 'aePaneLevel', fades: 'aePaneFades', emu: 'aePaneEmu' };
  const order = railOrder('#aeRail .ae-tool'), dir = prev && prev !== name ? (order.indexOf(name) > order.indexOf(prev) ? 1 : -1) : 0;
  aeSlidePane(panes, prev, name);
  document.querySelectorAll('#aeRail .ae-tool').forEach(b => { const on = b.dataset.tool === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('#aeRailName').textContent = AE_NAMES[name]; aeHead(name, dir); $('#aeAB').classList.remove('gone'); $('#aeABm').classList.remove('gone'); aeSetView(name === 'spec' ? 'spec' : 'wave', prev ? dir : 0); aeRailOpen(false); aeRailSel(!!prev); if (AE.d) aeBpUi();
  requestAnimationFrame(aeAlignView); requestAnimationFrame(() => { if (name === 'imager') aeScopeDraw(); if (name === 'eq') aeEqDraw(); if (name === 'fades') aeFadeDraw(); if (name === 'noise') aeNrDraw(); if (name === 'emu') aeEmUi(); });
}
/* on a narrow window the tool list folds into one line that opens like a menu */
function aeRailSel(animate) {
  const sel = $('#aeRailSel'), root = $('#aeRailIn'), btn = document.querySelector('#aeRail .ae-tool.on'); if (!sel || !btn || !btn.offsetWidth) { if (sel) sel.style.opacity = '0'; return; }
  let x = 0, y = 0, n = btn; while (n && n !== root) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  if (!animate || reducedMotion() || sel.style.opacity !== '1') sel.style.transition = 'none';
  sel.style.width = btn.offsetWidth + 'px'; sel.style.height = btn.offsetHeight + 'px'; sel.style.transform = 'translate(' + x + 'px,' + y + 'px)'; sel.style.opacity = '1';
  if (sel.style.transition === 'none') { void sel.offsetWidth; sel.style.transition = ''; }
}
function aeRailOpen(on) { const r = $('#aeRail'); r.classList.toggle('open', !!on); $('#aeRailCur').setAttribute('aria-expanded', !!on); }
/* which tools are doing something right now (they light up and get wired into the chain) */
function aeLit(d) {
  const nch = fxChannels(), fx = d.fx;
  return { noise: !!fx.noise.on, spec: !!fx.spec.on, eq: !!fx.eq.on && eqHas(fx), imager: !!fx.imager.on && nch === 2, level: !!d.normalize || d.gainDb !== 0, fades: d.audioFades !== false };
}
const aeChainOrder = d => ['noise', 'spec'].concat(d.fx.order, ['level', 'fades']);
function aeRailSync() {
  const procs = $('#aeProcs'), want = AE.d.fx.order, cur = Array.from(procs.children).map(e => e.dataset.tool), d = AE.d, fx = d.fx, nch = fxChannels(), lit = aeLit(d);
  if (want.join() !== cur.join()) {
    const first = new Map(Array.from(procs.children).map(e => [e, e.getBoundingClientRect().top]));
    want.forEach(k => procs.appendChild(procs.querySelector('.ae-proc[data-tool=' + k + ']')));
    if (!reducedMotion()) Array.from(procs.children).forEach(e => { const dy = first.get(e) - e.getBoundingClientRect().top; if (dy) e.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' }); });
    aeRailSel(true); aeWiresFollow();
  }
  const led = { noise: '#aeNrLed', spec: '#aeSpLed', eq: '#aeEqLed', imager: '#aeImLed', level: '#aeLvLed', fades: '#aeFdLed' };
  Object.keys(led).forEach(k => { $(led[k]).classList.toggle('on', lit[k]); const row = $('#aeRail .ae-proc[data-tool=' + k + ']'); row.classList.toggle('off', !lit[k]); row.classList.toggle('bp', aeBp(k)); });
  const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  const bd = { noise: lit.noise ? fx.noise.reduction + 'dB' : '', spec: lit.spec ? String(fx.spec.edits.length) : '', eq: lit.eq ? (n => fx.eq.curve ? (n ? 'Curve + ' + n + (n === 1 ? ' band' : ' bands') : 'Curve') : n + (n === 1 ? ' band' : ' bands'))(fx.eq.bands.filter(b => b.on).length) : '', imager: lit.imager ? (fx.imager.width !== 100 ? sg(fx.imager.width - 100) : imBands(fx.imager) ? 'Bands' : fx.imager.bal ? 'Bal' : 'Bass') : (nch < 2 ? 'Mono' : ''), level: d.normalize ? (d.normBy === 'loud' ? LUFS_TXT(d.normLufs) : DB_TXT(d.normPeakDb)) : d.gainDb ? sg(d.gainDb) + 'dB' : '', fades: aeFadeBadge(d) };
  $('#aeNrBadge').textContent = bd.noise; aeRingSync(); $('#aeSpBadge').textContent = bd.spec; $('#aeEqBadge').textContent = bd.eq; $('#aeImBadge').textContent = bd.imager; $('#aeLvBadge').textContent = bd.level; $('#aeFdBadge').textContent = bd.fades;
  $('#aeRailBadge').textContent = bd[AE.tool] || '';
  { const on = aeChainOrder(d).filter(k => lit[k]), trimmed = d.vStart > 0 || d.vEndSet != null, idle = 'No processing. ' + (trimmed ? 'Only the trim changes the sound.' : 'Audio plays unchanged.'), sig = on.map(k => k + (aeBp(k) ? '-' : '')).join() + '|' + idle, ch = $('#aeChain'); if (ch._sig !== sig) { ch._sig = sig; ch.innerHTML = on.length ? '<span>Runs</span>' + on.map(k => '<b' + (aeBp(k) ? ' class="bp" title="Bypassed"' : '') + '>' + AE_NAMES[k] + '</b>').join('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>') : '<span>' + idle + '</span>'; } }
  aeWiresDraw();
}
/* the wires: a cable runs from light to light down the list, in the order the sound travels. A tool that is off has nothing to plug in, so the cable skips it.
   Each cable is a small rope (points with gravity and fixed link lengths) pinned to two lights. Unplug a light and its cable swings loose and reels back in; plug one in and the cable whips across and settles. */
const WR = { N: 11, H: 1 / 120, G: 1200, SIDE: 70, K: 300, C: 22 };
const AE_LEDS = { noise: '#aeNrLed', spec: '#aeSpLed', eq: '#aeEqLed', imager: '#aeImLed', level: '#aeLvLed', fades: '#aeFdLed' };
const AE_JACKS = { in: '#aeJackIn i', out: '#aeJackOut i' };          // where the sound comes in and goes out: the cable always runs from one to the other through whatever is lit
const WIRE_DEFS = '<defs><radialGradient id="wDot" cx=".34" cy=".28" r=".8"><stop offset="0" stop-color="#ecfff3"/><stop offset=".3" stop-color="#7defa6"/><stop offset=".7" stop-color="#2fb872"/><stop offset="1" stop-color="#17894c"/></radialGradient></defs>';
function wirePath(pts) { let d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1); for (let i = 1; i < pts.length - 1; i++) d += 'Q' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1) + ' ' + ((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1) + ' ' + ((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1); return d + 'L' + pts[pts.length - 1][0].toFixed(1) + ' ' + pts[pts.length - 1][1].toFixed(1); }
function wireCable(d, cls, op) { return '<g' + (op < 1 ? ' opacity="' + op.toFixed(2) + '"' : '') + '><path class="w-back ' + cls + '" d="' + d + '"/><path class="w-front ' + cls + '" d="' + d + '"/><path class="w-hi ' + cls + '" d="' + d + '"/></g>'; }
function wirePin(x, y) { return { x, y, vx: 0, vy: 0, tx: x, ty: y, free: false }; }
function wireLen(r) { return Math.hypot(r.pb.tx - r.pa.tx, r.pb.ty - r.pa.ty) * 1.06 + 6; }
function wireStep(r) {
  const h = WR.H, P = r.pts, n = P.length;
  [r.pa, r.pb].forEach(p => { p.vx += (p.tx - p.x) * WR.K * h; p.vy += (p.ty - p.y) * WR.K * h; p.vx *= 1 - WR.C * h; p.vy *= 1 - WR.C * h; p.x += p.vx * h; p.y += p.vy * h; });
  if (r.dying) { r.L = Math.max(6, r.L * (1 - 2.2 * h)); r.life -= h; if (r.life < 0) r.alpha = Math.max(0, r.alpha - 2.2 * h); }
  for (let i = 0; i < n; i++) { const p = P[i], vx = (p.x - p.px) * 0.993, vy = (p.y - p.py) * 0.993; p.px = p.x; p.py = p.y; p.x += vx - WR.SIDE * h * h; p.y += vy + WR.G * h * h; }
  const pin = (i, q) => { if (!q.free) { P[i].x = q.x; P[i].y = q.y; P[i].px = q.x - q.vx * h; P[i].py = q.y - q.vy * h; } };
  const seg = r.L / (n - 1);
  for (let it = 0; it < 12; it++) {
    pin(0, r.pa); pin(n - 1, r.pb);
    for (let i = 0; i < n - 1; i++) {
      const A = P[i], B = P[i + 1], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6; if (d <= seg) continue;
      const f = (d - seg) / d, wa = i === 0 && !r.pa.free ? 0 : 1, wb = i === n - 2 && !r.pb.free ? 0 : 1, s = wa + wb; if (!s) continue;
      A.x += dx * f * wa / s; A.y += dy * f * wa / s; B.x -= dx * f * wb / s; B.y -= dy * f * wb / s;
    }
  }
  pin(0, r.pa); pin(n - 1, r.pb);
}
function wireMake(a, b, s, e, settled) {
  const r = { a, b, pa: wirePin(s[0], s[1]), pb: wirePin(settled ? e[0] : s[0], settled ? e[1] : s[1]), pts: [], L: 0, alpha: 1, life: 0.45, dying: false };
  r.pb.tx = e[0]; r.pb.ty = e[1]; r.L = wireLen(r);
  for (let i = 0; i < WR.N; i++) { const t = i / (WR.N - 1), x = r.pa.x + (r.pb.x - r.pa.x) * t, y = r.pa.y + (r.pb.y - r.pa.y) * t; r.pts.push({ x, y, px: x, py: y }); }
  if (settled) for (let i = 0; i < 360; i++) wireStep(r);
  return r;
}
function wireRopeDone(r) { return !r.dying && Math.abs(r.pa.tx - r.pa.x) + Math.abs(r.pa.ty - r.pa.y) + Math.abs(r.pb.tx - r.pb.x) + Math.abs(r.pb.ty - r.pb.y) < 0.4 && Math.hypot(r.pa.vx, r.pa.vy, r.pb.vx, r.pb.vy) < 3 && r.pts.every(p => Math.abs(p.x - p.px) < 0.03 && Math.abs(p.y - p.py) < 0.03); }
function wireRender() {
  const W = AE.wr, svg = $('#aeWires'); if (!W || !svg) return; let h = '';
  W.ropes.forEach(r => { if (r.alpha > 0.01) { h += wireCable(wirePath(r.pts.map(p => [p.x, p.y])), '', r.alpha); const f = r.pa.free ? r.pts[0] : r.pb.free ? r.pts[r.pts.length - 1] : null; if (f) h += '<circle class="w-plug drag" cx="' + f.x.toFixed(1) + '" cy="' + f.y.toFixed(1) + '" r="3.5" opacity="' + r.alpha.toFixed(2) + '"/>'; } });
  Object.keys(W.pg).forEach(k => { const g = W.pg[k]; if (g.s > 0.02 && W.at[k]) h += '<circle class="w-plug" cx="' + W.at[k][0] + '" cy="' + W.at[k][1] + '" r="' + (8 * g.s).toFixed(2) + '"/>'; });
  Object.keys(W.pg).forEach(k => { const g = W.pg[k]; if (g.s > 0.02 && W.at[k]) h += '<circle class="w-dot" cx="' + W.at[k][0] + '" cy="' + W.at[k][1] + '" r="' + (5 * Math.min(1, g.s)).toFixed(2) + '"/>'; });          // the lit light is drawn again above the cable, so the cable goes over the lights that are off and under the ones it plugs into
  if (AE.wire && W.at[AE.wire.tool]) { const [x0, y0] = W.at[AE.wire.tool], w = AE.wire, gap = w.y - y0, bow = Math.max(6, Math.min(15, 6 + Math.abs(gap) * 0.1)); h += wireCable('M' + x0 + ' ' + y0 + 'C' + (x0 - bow) + ' ' + (y0 + gap * 0.3) + ' ' + (w.x - bow) + ' ' + (w.y - gap * 0.3) + ' ' + w.x + ' ' + w.y, 'drag', 1) + '<circle class="w-plug drag" cx="' + w.x + '" cy="' + w.y + '" r="6"/>'; }
  svg.innerHTML = WIRE_DEFS + h;
}
function wireLoop(now) {
  const W = AE.wr; if (!W) return; W.raf = 0; if (!AE.d || $('#audioDlg').hidden) return;
  const dt = Math.min(0.05, (now - (W.t || now)) / 1000); W.t = now; W.acc += dt;
  for (let n = 0; W.acc >= WR.H && n < 10; n++, W.acc -= WR.H) {
    W.ropes.forEach(wireStep); W.ropes = W.ropes.filter(r => r.alpha > 0.01);
    Object.keys(W.pg).forEach(k => { const g = W.pg[k]; g.v += (g.t - g.s) * 520 * WR.H; g.v *= 1 - 11 * WR.H; g.s += g.v * WR.H; });
  }
  wireRender();
  if (W.ropes.every(wireRopeDone) && Object.keys(W.pg).every(k => Math.abs(W.pg[k].t - W.pg[k].s) < 0.01 && Math.abs(W.pg[k].v) < 0.05) && !AE.wire) { W.t = 0; return; }
  W.raf = requestAnimationFrame(wireLoop);
}
function aeWiresDraw(force) {
  const svg = $('#aeWires'), root = $('#aeRailIn'); if (!svg || !root || !AE.d || !root.offsetWidth) return;
  const rr = root.getBoundingClientRect(), lit = aeLit(AE.d), W0 = Math.round(rr.width), H0 = Math.round(rr.height), sig = aeChainOrder(AE.d).filter(k => lit[k]).join() + '|' + W0 + 'x' + H0 + '|' + (reducedMotion() ? 1 : 0);
  if (!force && !AE.wire && AE.wSig === sig && AE.wr) return; AE.wSig = sig;          // nothing about the cables has changed (a slider moved): leave them be
  svg.setAttribute('width', W0); svg.setAttribute('height', H0);
  const at = {}; [AE_LEDS, AE_JACKS].forEach(o => Object.keys(o).forEach(k => { const el = $(o[k]).getBoundingClientRect(); at[k] = [Math.round((el.left + el.width / 2 - rr.left) * 10) / 10, Math.round((el.top + el.height / 2 - rr.top) * 10) / 10]; }));
  const rawChain = ['in'].concat(aeChainOrder(AE.d).filter(k => lit[k]), ['out']); let chain = rawChain;
  if (!AE.wc || !AE.wr) { AE.wc = rawChain; clearTimeout(AE.wcT); }
  else if (rawChain.join() !== AE.wc.join()) {
    const sameSet = rawChain.slice().sort().join() === AE.wc.slice().sort().join();
    if (sameSet || !AE.sliding) { AE.wc = rawChain; clearTimeout(AE.wcT); }
    else { clearTimeout(AE.wcT); AE.wcT = setTimeout(() => { AE.wc = null; aeWiresDraw(true); }, 240); }          // a light flickering while a slider is dragged across its off position is not worth plugging and unplugging: wait until it settles
  } else clearTimeout(AE.wcT);
  chain = AE.wc || rawChain;
  if (reducedMotion()) {       // no swinging: a plain curve between the lights
    const cable = (x0, y0, x1, y1, cls) => { const gap = y1 - y0, bow = Math.max(6, Math.min(15, 6 + Math.abs(gap) * 0.1)); return wireCable('M' + x0 + ' ' + y0 + 'C' + (x0 - bow) + ' ' + (y0 + gap * 0.3) + ' ' + (x1 - bow) + ' ' + (y1 - gap * 0.3) + ' ' + x1 + ' ' + y1, cls, 1); };
    let h = ''; for (let i = 0; i < chain.length - 1; i++) h += cable(...at[chain[i]], ...at[chain[i + 1]], '');
    chain.forEach(k => { if (AE_LEDS[k]) h += '<circle class="w-plug" cx="' + at[k][0] + '" cy="' + at[k][1] + '" r="8"/>'; });
    if (AE.wire) { const w = AE.wire; h += cable(...at[w.tool], w.x, w.y, 'drag') + '<circle class="w-plug drag" cx="' + w.x + '" cy="' + w.y + '" r="6"/>'; }
    chain.forEach(k => { if (AE_LEDS[k]) h += '<circle class="w-dot" cx="' + at[k][0] + '" cy="' + at[k][1] + '" r="5"/>'; });
    svg.innerHTML = WIRE_DEFS + h; AE.wr = null; return;
  }
  const first = !AE.wr; if (first) AE.wr = { ropes: [], pg: {}, at, raf: 0, t: 0, acc: 0 }; const W = AE.wr; W.at = at;
  const cables = []; for (let i = 0; i < chain.length - 1; i++) cables.push([chain[i], chain[i + 1]]);
  const liveR = W.ropes.filter(r => !r.dying), used = new Set(), inChain = new Set(chain);
  const aim = (r, a, b) => { r.a = a; r.b = b; r.pa.tx = at[a][0]; r.pa.ty = at[a][1]; r.pb.tx = at[b][0]; r.pb.ty = at[b][1]; r.pa.free = r.pb.free = false; r.L = Math.max(r.L, wireLen(r)); };
  cables.forEach(([a, b]) => {
    let r = liveR.find(x => !used.has(x) && x.a === a && x.b === b) || liveR.find(x => !used.has(x) && x.a === a) || liveR.find(x => !used.has(x) && x.b === b);
    if (r) { used.add(r); aim(r, a, b); r.L = wireLen(r); }
    else { r = wireMake(a, b, at[a], at[b], first); used.add(r); W.ropes.push(r); }
  });
  liveR.filter(r => !used.has(r)).forEach(r => {
    r.dying = true; r.life = 0.5; const aOn = inChain.has(r.a), bOn = inChain.has(r.b);
    r.pa.free = !aOn; r.pb.free = !bOn || aOn;
    if (r.pa.free && r.pb.free) r.life = 0;
    const f = r.pa.free ? r.pts[0] : r.pts[r.pts.length - 1]; f.px += 1.2; f.py -= 0.5;      // a little shove so it swings
  });
  W.ropes.forEach(r => { if (r.dying) { if (!r.pa.free && inChain.has(r.a)) { r.pa.tx = at[r.a][0]; r.pa.ty = at[r.a][1]; } if (!r.pb.free && inChain.has(r.b)) { r.pb.tx = at[r.b][0]; r.pb.ty = at[r.b][1]; } } });
  Object.keys(AE_LEDS).forEach(k => { const g = W.pg[k] || (W.pg[k] = { s: first ? (inChain.has(k) ? 1 : 0) : 0, v: 0, t: 0 }); g.t = inChain.has(k) ? 1 : 0; if (first) g.s = g.t; });
  wireRender(); if (!W.raf) { W.t = 0; W.raf = requestAnimationFrame(wireLoop); }
}
/* while rows slide to their new places the cables follow them */
function aeWiresFollow() { const t0 = performance.now(); (function f(now) { aeWiresDraw(true); if (now - t0 < 480) requestAnimationFrame(f); })(t0); }
/* the Bypass button follows the open tool: it works when that tool is doing something, and shows whether it is bypassed */
/* what a tool is set to, so a bypassed tool that is then edited can come back in: the sound you hear should follow the change you make */
function aeBpSig(k) { const d = AE.d; const pick = re => JSON.stringify(Object.keys(d).filter(x => re.test(x)).sort().map(x => [x, d[x]])); return k === 'level' ? pick(/^(norm|gain|limiter)/i) : k === 'fades' ? pick(/fade/i) : JSON.stringify(d.fx[k]); }
function aeBpUi() {
  const lit = aeLit(AE.d); AE.bpS = AE.bpS || {};
  Object.keys(AE.bp || {}).forEach(k => { if (!lit[k]) delete AE.bp[k]; else if (AE.bpS[k] === undefined) AE.bpS[k] = aeBpSig(k); else if (AE.bpS[k] !== aeBpSig(k)) { delete AE.bp[k]; AE.bpEdit = true; } });          // editing a bypassed tool switches it back on
  $('#audioDlg').dataset.by = aeBy();          // a tool that no longer does anything has nothing to bypass
  const act = (AE_BPSET[AE.tool] || []).some(k => lit[k]), by = aeBpTool(AE.tool), ab = $('#aeAB'); ab.disabled = !act && !by; ab.setAttribute('aria-pressed', by); ab.title = 'Hear the sound without ' + (AE_NAMES[AE.tool] || 'this tool') + ', to compare (B)'; return lit;
}
/* the ring in the tool list: a tool that works in the background (Noise reduction: its main job, Auto, Learn noise, Mains hum; the Emulator: reading the reference or your audio) fills a blue ring with the share done,
   and only while another tool is open. With its own window open, the bar there says it, so it is said once. Learn noise knows no share, so a short arc turns */
function aeRingSync() {
  if (!AE.d) return; const J = AE.ringJ || (AE.ringJ = { noise: $('.ae-jack[data-tool="noise"]'), emu: $('.ae-jack[data-tool="emu"]') }), em = AE.em;
  const job = { noise: AE.nrShown ? { p: AE.nrTarget > 0.001 ? AE.nrCur || 0 : null } : AE.nrAutoBusy ? { p: (AE.nrAutoPc || 0) / 100 } : AE.humBusy ? { p: (AE.humPc || 0) / 100 } : AE.nrLearning ? { p: null } : null, emu: em && (em.busy || em.busyOwn) ? { p: clamp(em.prog || 0, 0, 1) } : null };
  for (const k in J) { const j = job[k], on = !!j && AE.tool !== k, el = J[k]; if (on && !el.classList.contains('busy')) { el.classList.add('start'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('start'))); }          // a new job starts its ring at once at its own share, not gliding down from where the last one ended
  el.classList.toggle('busy', on); el.classList.toggle('wait', on && j.p == null); if (el.tagName === 'BUTTON') el.setAttribute('aria-busy', on); if (on && j.p != null) el.style.setProperty('--ring', j.p.toFixed(4)); }
}
function aeToolsRefresh() {
  if (!AE.d) return; const nch = fxChannels();
  aeRailSync(); aeEqPanel(); aeImPanel(); aeNrPanel(); spPanel(); specSync(); aeEmUi();
  const lit = aeBpUi(); if (AE.bpEdit) { AE.bpEdit = false; aeSwapSrc(); if (AE.playing) { aeRoute(); aeLimSync(); } } { const am = $('#aeABm'); am.disabled = !Object.values(lit).some(Boolean); am.setAttribute('aria-pressed', !!AE.d.matchGain); if (AE.ph && aeBpAny() && AE.d.matchGain) { const v = aeBypassGain(); if (v !== AE.bpV) { AE.bpV = v; AE.ph.post({ pre: v }); } } }   if (aeBpAny() && AE.playing) aeLive();
  aeToolLive();
  if (!fxPeek(AE.d.fx)) aeQuickKick();
  if ((!fxPeek(AE.d.fx) || (AE.nrListen && !S.audio.disk && !nrPeek(AE.d.fx.noise, true))) && (!AE.playing || AE.d.normalize || limOn(AE.d) || AE.tool === 'level')) { clearTimeout(AE.fxT); const rest = Math.max(AE.sliding ? 220 : 60, Math.min(1400, S.audio.duration * 5)); AE.fxT = setTimeout(() => { const d = AE.d; if (!d) return; fxGet(d.fx, { preview: true }).then(() => AE.nrListen && !S.audio.disk && d === AE.d && nrReady(d.fx.noise) ? nrGet(d.fx.noise, true, { preview: true }) : null).then(() => { if (AE.d) { aeSwapSrc(); aeRefresh(); } }, () => {}); }, rest); }       // the processed sound, for Normalize's loudest peak and the picture: a long recording waits longer, and while the sound plays it waits for Stop (the live chain is what you hear, and the quick sketch already moves the picture)
}
function aeToggleBypass() {
  if ($('#aeAB').disabled || !AE.d) return; const lit = aeLit(AE.d), set = AE_BPSET[AE.tool] || [], off = aeBpTool(AE.tool); AE.bp = AE.bp || {};
  AE.bpS = AE.bpS || {}; set.forEach(k => { if (off) delete AE.bp[k]; else if (lit[k]) { AE.bp[k] = true; AE.bpS[k] = aeBpSig(k); } }); if (!off) edSay('ae', 'bypass');
  { const v = aeFxHeard(AE.d.fx); if (aeBp('noise') && v.spec.edits.length && !prePeek(v, false)) preGet(v, false).then(() => { if (AE.d) { aeSwapSrc(); } }, () => {}); }          // Spectra's edits on the sound with no noise reduction are made once, for the comparison
  aeToolsRefresh(); aeSwapSrc(); if (AE.playing) { aeRoute(); aeLimSync(); } aeAnim(); }
/* the export choice is two menus: the file type, then its depth (WAV) or bitrate (M4A) */
const AE_FMT = { flac: [['flac24', '24-bit'], ['flac16', '16-bit']], wav: [['wav24', '24-bit'], ['wav', '16-bit'], ['wav32', '32-bit float']], m4a: [['m4a128', '128kbps'], ['m4a192', '192kbps'], ['m4a256', '256kbps'], ['m4a320', '320kbps']] };
const AE_FMT_LAST = { flac: 'flac24', wav: 'wav24', m4a: 'm4a256' };
const TAG_FIELDS = [['Title', 'tagTitle'], ['Artist', 'tagArtist'], ['AlbumArtist', 'tagAlbumArtist'], ['Album', 'tagAlbum'], ['Year', 'tagYear'], ['Track', 'tagTrack'], ['Disc', 'tagDisc'], ['Composer', 'tagComposer'], ['Work', 'tagWork'], ['Movement', 'tagMovement'], ['MovementNo', 'tagMovementNo'], ['Genre', 'tagGenre'], ['Comment', 'tagComment']];
/* open or close a folding block (a .fa) with the shared slide: its height eases, its content fades, and a closed one cannot be tabbed into */
function foldSet(sel, on) { const f = $(sel); if (!f) return; f.classList.toggle('open', !!on); const inn = f.firstElementChild; if (inn) inn.inert = !on; }
const aeFmtType = f => /^m4a/.test(f) ? 'm4a' : /^flac/.test(f) ? 'flac' : 'wav';
const AE_FMT_NOTE = { flac: 'Exact copy, about half the size of WAV', wav: 'Exact copy, plays everywhere', m4a: 'Smaller file, tiny loss of detail' };
/* the export window has two pages that glide past each other (same ease and length as the editor's picture slide); the window grows or shrinks to the page it is showing */
const AE_PG_EASE = EASE_GLIDE, AE_PG_MS = 380;
function aePage(meta, instant) {
  const w = $('#aePgWrap'), m = $('#aePgMain'), t = $('#aePgMeta'), to = meta ? t : m, from = meta ? m : t, was = w.classList.contains('meta');
  (w._anims || []).forEach(a => a.cancel()); w._anims = null; w.classList.remove('moving');
  w.classList.toggle('meta', meta); m.inert = meta; t.inert = !meta; m.setAttribute('aria-hidden', meta); t.setAttribute('aria-hidden', !meta);
  to.style.visibility = 'visible';
  const h0 = w.offsetHeight, h1 = to.offsetHeight;
  if (instant || reducedMotion() || was === meta) { from.style.visibility = 'hidden'; w.style.height = h1 + 'px'; }
  else {
    const d = meta ? 1 : -1, o = { duration: AE_PG_MS, easing: AE_PG_EASE };
    w.classList.add('moving'); w.style.height = h1 + 'px';
    const a = [to.animate([{ opacity: 0, transform: 'translateX(' + d * 40 + 'px)' }, { opacity: 1, transform: 'none' }], o),
      from.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(' + -d * 40 + 'px)' }], Object.assign({ fill: 'forwards' }, o)),
      w.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], o)];
    w._anims = a; a[0].onfinish = () => { from.style.visibility = 'hidden'; a[1].cancel(); w.classList.remove('moving'); w._anims = null; };
  }
  if (!instant) (meta ? $('#aeTagTitle') : $('#aeMetaGo')).focus({ preventScroll: true });
}
function aePageFit() { const w = $('#aePgWrap'); if (w.classList.contains('moving')) return; w.style.height = ($('#aePgWrap').classList.contains('meta') ? $('#aePgMeta') : $('#aePgMain')).offsetHeight + 'px'; }
/* the export window stays up while the audio is made (like the video export): a progress page with the stage and a bar. It can be hidden to keep editing; the Export audio button then shows the progress and brings it back */
function aeRunShow() { $('#aePgWrap').hidden = true; $('#aeExpRun').hidden = false; $('#aeRunStop').hidden = false; $('#aeRunHide').hidden = false; $('#aeRunClose').hidden = true; $('#aeRunBarWrap').hidden = false; $('#aeRunNote').hidden = false; $('#aeRunNote').textContent = 'You can keep editing while this runs. The Export audio button shows how far it is, and brings this window back.'; setDots($('#aeRunTitle'), 'Exporting your audio…'); $('#aeRunMsg').classList.remove('err'); $('#aeRunMsg').textContent = 'Processing…'; $('#aeRunBar').style.width = '0%'; $('#aeRunBarWrap').setAttribute('aria-valuenow', 0); $('#aeRunStop').disabled = false; }
function aeRunProg(t, f) { $('#aeRunMsg').textContent = t; if (f != null) { const pc = Math.round(Math.min(1, f) * 100); $('#aeRunBar').style.width = pc + '%'; $('#aeRunBarWrap').setAttribute('aria-valuenow', pc); } }
function aeRunEnd(state) {          // done, stopped or error: shown when the window is open (a toast says it when it is hidden)
  if ($('#aeExpDlg').hidden) { aeRunReset(); return; }
  setDots($('#aeRunTitle'), state === 'done' ? 'Boom. Your audio is saved' : state === 'stopped' ? 'Export stopped' : 'Export did not finish');
  $('#aeRunMsg').textContent = state === 'done' ? 'The file is in your downloads.' : state === 'stopped' ? 'Nothing was saved.' : 'The audio could not be exported. Try again, or pick another file type.'; $('#aeRunMsg').classList.toggle('err', state === 'error');
  if (state === 'done') { $('#aeRunBar').style.width = '100%'; $('#aeRunBarWrap').setAttribute('aria-valuenow', 100); } $('#aeRunBarWrap').hidden = state !== 'done'; $('#aeRunNote').hidden = true;
  $('#aeRunStop').hidden = true; $('#aeRunHide').hidden = true; $('#aeRunClose').hidden = false; $('#aeRunClose').focus({ preventScroll: true });
}
function aeRunReset() { $('#aeExpRun').hidden = true; $('#aePgWrap').hidden = false; }
function aeExpOpen() { if (!AE.d) return; if (AE.exporting) { sheetShow($('#aeExpDlg')); $('#aeRunHide').focus({ preventScroll: true }); return; } aeRunReset(); aeFormatUI(); sheetShow($('#aeExpDlg')); aePage(false, true); if (!aeExpOpen.ro && window.ResizeObserver) { aeExpOpen.ro = new ResizeObserver(aePageFit); aeExpOpen.ro.observe($('#aePgMain')); aeExpOpen.ro.observe($('#aePgMeta')); } $('#aeFormat').focus({ preventScroll: true }); }
function aeExpClose() { sheetHide($('#aeExpDlg')); $('#aeExport').focus({ preventScroll: true }); }
/* the loudest level the export will write, in dB (the gain and the fades included; the limiter keeps it under the ceiling) */
function aeFinalDb(d) {
  if (limOn(d) || (d.normalize && d.normBy === 'loud' && !loudPeek(d))) return -Infinity;          // the limiter holds the peak under the ceiling; a loudness target is not known until it is measured
  const G = aeLevel(d, Math.max(0, d.vStart), Math.min(aeEnd(d), S.audio.duration)), mx = aePeakMax(d);
  return mx > 1e-4 ? 20 * Math.log10(mx * G) : -Infinity;
}
function aeFormatUI() {
  let f = S.set.audioFormat === 'm4a' ? 'm4a256' : S.set.audioFormat; const t = aeFmtType(f); if (!AE_FMT[t].some(o => o[0] === f)) f = AE_FMT_LAST[t]; AE_FMT_LAST[t] = f;
  $('#aeFormat').value = t; const q = $('#aeFormatQ'); q.innerHTML = AE_FMT[t].map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join(''); q.value = f; $('#aeFormatQL').textContent = t === 'm4a' ? 'Bitrate' : 'Bit depth';
  if (AE.d && S.audio) {
    const len = Math.max(0, aeEnd(AE.d) - AE.d.vStart), ch = Math.min(2, audCh()), inSr = audSr(), sr = aeOutRate({ sampleRate: inSr }), wavMb = len * sr * ch * (f === 'wav32' ? 4 : /24$/.test(f) ? 3 : 2) / 1e6;
    const mb = t === 'm4a' ? len * parseInt(f.slice(3), 10) * 125 / 1e6 : t === 'flac' ? wavMb * 0.6 : wavMb;
    const fin = aeFinalDb(AE.d), clipE = fin > 0.0005;
    $('#aeExpNote').textContent = AE_FMT_NOTE[t] + ' (~' + (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + 'MB).' + (clipE ? ' Audio clips (' + DB_TXT(fin) + ').' : '');
    const rs = $('#aeRate'), kh = r => (r / 1000).toString().replace(/\.0+$/, '') + 'kHz', want = +S.set.audioRate || 0;
    rs.innerHTML = [[0, 'Same as recording (' + kh(inSr) + ')'], [44100, '44.1kHz'], [48000, '48kHz'], [96000, '96kHz']].map(o => '<option value="' + o[0] + '">' + o[1] + '</option>').join(''); rs.value = String(want);
    const rn = $('#aeExpRate'), up = want > inSr; if (up) rn.textContent = 'Converting up adds no quality.'; foldSet('#aeRateFold', up);
    foldSet('#aeWorkFold', !!S.set.tagShowWork); $('#aeMetaVal').textContent = aeTags() ? 'Added' : '';
    TAG_FIELDS.forEach(([id, k]) => { const el = $('#aeTag' + id); if (document.activeElement !== el) el.value = k === 'tagTitle' ? (S.set.tagTitle || S.credits.title.trim()) : S.set[k]; });
    $('#aeTagShowWork').checked = !!S.set.tagShowWork; $('#aeTagCompilation').checked = !!S.set.tagCompilation;
    const lossy = S.audio.lossy, src = $('#aeExpSrc'); const showSrc = !!lossy && t !== 'm4a'; if (lossy) src.textContent = 'Source is ' + lossy + '. Lossless export can’t increase quality.'; foldSet('#aeSrcFold', showSrc);
  }
}
function aeInitTools() { AE.eqListen = false; SP.sel = -1; SP.hover = -1; SP.drag = null; spArm(false); AE.spHov = -1; AE.match = null; AE.matchOpen = false; AE.em = null; AE.nsel = null; AE.nsShow = null; AE.nsArm = false; AE.quick = null; AE.view = 'wave'; TL.hs = TL.hs || {}; TL.hs['ae-vt'] = { x: 0, v: 0, t: 0 }; $('#audioDlg').dataset.view = 'wave'; { const r = document.querySelector('input[name=aeView][value=wave]'); if (r) { r.checked = true; const sg = $('#aeView'); if (sg._place) sg._place(false); } } AE.imListen = null; AE.imBandsView = false; AE.lrKey = null; AE.lrWant = null; clearTimeout(AE.lrT); if (AE.wr && AE.wr.raf) cancelAnimationFrame(AE.wr.raf); AE.wr = null; AE.wc = null; clearTimeout(AE.wcT); AE.nrPost = undefined; AE.nrLv = null; AE.nrRef = undefined; AE.nrListen = false; AE.nrLast = null; AE.nrProf = null; AE.tool = null; AE.zoom = null; AE.rlo = AE.rhi = null; AE.clipLatch = false; AE.mLive = false; aeTool('noise'); aeUntap(); TL.hs = TL.hs || {}; TL.hs['ae-by'] = { x: 0, v: 0, t: 0 }; AE.dn = []; AE.dvs = AE.dve = null; AE.tgt = null; AE.eqNudge = 0; AE.fadeSide = 'both'; { const r = document.querySelector('input[name=aeFadeSide][value=both]'); if (r) r.checked = true; } { const d0 = AE.d, sh = d0.audioFadeShape || 'smooth'; hsSnap('ae-vs', d0.vStart); hsSnap('ae-ve', aeEnd(d0)); { const f0 = aeFull(); hsSnap('ae-rlo', f0[0]); hsSnap('ae-rhi', f0[1]); hsSnap('ae-zb', 0); } $('#aeZoomFit').classList.add('gone'); hsSnap('ae-tg', 0); hsSnap('ae-ns', 0); hsSnap('ae-nrp', d0.fx.noise.profile ? 1 : 0); hsSnap('ae-nrr', d0.fx.noise.on ? d0.fx.noise.reduction : 0); hsSnap('ae-fl', aeFadeLens(d0)[0]); hsSnap('ae-fo', aeFadeLens(d0)[1]); Object.keys(AE_SHAPES).forEach(k => hsSnap('ae-fw-' + k, k === sh ? 1 : 0)); } { const G = S.audio ? aeLevel(AE.d, Math.max(0, AE.d.vStart), Math.min(aeEnd(AE.d), S.audio.duration)) : 1; TL.hs['ae-lv'] = { x: G, v: 0, t: G }; } AE.eqHover = null; AE.corr = null; AE.scopeMax = 0; }
function aeMove(tool, dir) {
  const o = AE.d.fx.order, i = o.indexOf(tool), j = i + dir; if (i < 0 || j < 0 || j >= o.length) return false;
  aeFx(fx => { const t = fx.order[i]; fx.order[i] = fx.order[j]; fx.order[j] = t; }); edSay('ae', 'order'); return true;
}
function aeToolsBind() {
  document.querySelectorAll('#aeRail .ae-tool').forEach(b => b.addEventListener('click', () => aeTool(b.dataset.tool)));
  $('#aeRailCur').addEventListener('click', () => aeRailOpen(!$('#aeRail').classList.contains('open')));
  $('#aeAB').addEventListener('click', aeToggleBypass);
  $('#aeABm').addEventListener('click', () => { aePush(); AE.d.matchGain = !AE.d.matchGain; AE.bpKey = null; aeToolsRefresh(); aeRefresh(); if (AE.playing && aeBpAny()) aeRoute(); });
  $('#aeClip').addEventListener('click', () => { AE.clipLatch = false; if (AE.mLive) AE.mv = 0; aeMeterStatic(); $('#aeClip').hidden = !(AE.ms && AE.ms.hot); });
  $('#aeZoomFit').addEventListener('click', () => aeZoomSet(-1e9, 1e9, false));
  /* a lit light on EQ or Imager is a plug: pull its wire onto another lit light and the two swap places */
  document.querySelectorAll('#aeProcs .ae-proc').forEach(row => {
    const tool = row.dataset.tool, jack = row.querySelector('.ae-jack');
    jack.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; e.preventDefault(); const lit = aeLit(AE.d)[tool], rr = $('#aeRailIn').getBoundingClientRect();
      if (!lit) { const l = jack.querySelector('.led'); l.classList.remove('shake'); void l.offsetWidth; l.classList.add('shake'); return; }
      jack.setPointerCapture(e.pointerId); AE.wire = { tool, x: e.clientX - rr.left, y: e.clientY - rr.top, moved: false, x0: e.clientX, y0: e.clientY, target: null };
    });
    jack.addEventListener('pointermove', e => {
      const w = AE.wire; if (!w || w.tool !== tool) return; const rr = $('#aeRailIn').getBoundingClientRect(); w.x = e.clientX - rr.left; w.y = e.clientY - rr.top;
      if (!w.moved && Math.hypot(e.clientX - w.x0, e.clientY - w.y0) < 5) return; w.moved = true; jack.classList.add('pulling');
      const lit = aeLit(AE.d); let tgt = null;
      AE.d.fx.order.forEach(k => { if (k === tool || !lit[k]) return; const r = $('#aeRail .ae-proc[data-tool=' + k + ']').getBoundingClientRect(); if (e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) tgt = k; });
      if (tgt !== w.target) { document.querySelectorAll('#aeRail .led.tgt').forEach(l => l.classList.remove('tgt')); if (tgt) $({ eq: '#aeEqLed', imager: '#aeImLed' }[tgt]).classList.add('tgt'); w.target = tgt; }
      aeWiresDraw();
    });
    const up = () => {
      const w = AE.wire; if (!w || w.tool !== tool) return; AE.wire = null; jack.classList.remove('pulling'); document.querySelectorAll('#aeRail .led.tgt').forEach(l => l.classList.remove('tgt'));
      if (!w.moved) { aeTool(tool); aeWiresDraw(true); return; }
      if (w.target) { aeFx(fx => { const o = fx.order, i = o.indexOf(tool), j = o.indexOf(w.target); [o[i], o[j]] = [o[j], o[i]]; }); edSay('ae', 'order'); } else aeWiresDraw(true);
    };
    jack.addEventListener('pointerup', up); jack.addEventListener('pointercancel', up);
    row.addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); if (aeMove(tool, e.key === 'ArrowUp' ? -1 : 1)) (e.target.closest('.ae-tool') || row.querySelector('.ae-tool')).focus(); } });
  });
  document.querySelectorAll('#aeRail .ae-jack.lockd').forEach(j => j.addEventListener('click', () => aeTool(j.dataset.tool)));
  document.querySelectorAll('#audioDlg input[type=range]').forEach(r => r.addEventListener('pointerdown', () => { if (r._glide) { cancelAnimationFrame(r._glide.raf); r._glide = null; } }));
  document.querySelectorAll('#audioDlg input[type=range][data-default]').forEach(r => r.addEventListener('dblclick', () => aeGlideTo(r, r.dataset.default)));
  document.querySelectorAll('#audioDlg .sl-end').forEach(b => b.addEventListener('click', () => { const r = b.closest('.field').querySelector('input[type=range]'); aeGlideTo(r, b.dataset.v === 'max' ? r.max : b.dataset.v); }));
  $('#aeFadeShape').addEventListener('change', e => { aePush(); AE.d.audioFadeShape = e.target.value; if (AE.d.audioFades === false) { AE.d.audioFades = true; AE.d.audioFadeLen = AE.d.audioFadeLen || AE_FADE; AE.d.audioFadeOutLen = null; } aeRefresh(); });
  document.querySelectorAll('input[name=aeFadeSide]').forEach(r => r.addEventListener('change', e => { aeFadeSide(e.target.value); }));
  if (window.ResizeObserver) { new ResizeObserver(() => { aeRailSel(false); aeWiresDraw(true); }).observe($('#aeRailIn')); new ResizeObserver(() => { if (AE.d && !$('#audioDlg').hidden) { aeSize(); aeDraw(); } }).observe($('#aeCanvas')); new ResizeObserver(() => { if (AE.full) aeFsLayout(); }).observe($('#audioDlg .ae-main')); { const ro = new ResizeObserver(() => { if (AE.d && !$('#audioDlg').hidden) aeToolLive(); }); ['#aeEqCv', '#aeNrCv', '#aeFadeCv', '#aeScope'].forEach(id => ro.observe($(id))); } }          // a picture that gets more or less room (EQ Match opening, the window growing) redraws to fit
  aeEqBind(); aeImBind();
  window.addEventListener('resize', () => { if (AE.d && !$('#audioDlg').hidden) aeToolLive(); });
}
/* ---------------- EQ Match ----------------
   The browser measures the average spectrum of this sound (and of a reference: another audio file, or a text file of the same kind),
   takes the difference, and fits a few EQ bands to it. Nothing leaves the page. */
const FFT_N = 4096;
let FFT_T = null;
function fftTables() {
  if (FFT_T) return FFT_T; const n = FFT_N, c = new Float64Array(n / 2), s = new Float64Array(n / 2), w = new Float64Array(n);
  for (let i = 0; i < n / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n); s[i] = -Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  return (FFT_T = { c, s, w });
}
function fftIn(re, im) {
  const n = re.length, T = fftTables();
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) {
      const a = i + k, b = a + half, wr = T.c[k * step], wi = T.s[k * step], xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
const curveCenter = a => { let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length; const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - m; return o; };
/* the average level at each point of the EQ's frequency axis (dB, centered on zero so the overall loudness doesn't matter) */
function avgCurve(chans, from, to, sr) {
  const N = FFT_N, T = fftTables(), len = to - from; if (len < N) return null;
  const step = Math.max(N / 2, (len - N) / 399), pw = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N); let used = 0;
  for (let pos = from; pos + N <= to; pos += step) {
    const p0 = Math.floor(pos); let e = 0;
    for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < chans.length; c++) v += chans[c][p0 + i]; v = v / chans.length * T.w[i]; re[i] = v; im[i] = 0; e += v * v; }
    if (e < 1e-6) continue;           // silence says nothing about the sound
    fftIn(re, im); for (let k = 0; k <= N / 2; k++) pw[k] += re[k] * re[k] + im[k] * im[k]; used++;
  }
  return avgFinish(pw, used, sr);
}
function avgFinish(pw, used, sr) {
  if (!used) return null;
  const N = FFT_N, out = new Float32Array(eqAxis.length), bw = Math.pow(2, 1 / 6), binHz = sr / N;
  for (let i = 0; i < out.length; i++) {
    const f = eqAxis[i], lo = Math.max(1, Math.floor(f / bw / binHz)), hi = Math.min(N / 2, Math.ceil(f * bw / binHz)); let s = 0, n = 0;
    for (let k = lo; k <= hi; k++) { s += pw[k]; n++; }
    if (!n) { s = pw[Math.min(N / 2, Math.max(1, Math.round(f / binHz)))]; n = 1; }
    out[i] = 10 * Math.log10(s / n / used + 1e-20);
  }
  return curveCenter(out);
}
/* the same for a recording on the disk store: each slice is read from it (the slices are spread over the part you keep, at most about 400, so it is a few seconds whatever the length) */
async function avgCurveDisk(from, to, sr, nch, tick) {
  const N = FFT_N, T = fftTables(), len = to - from; if (len < N) return null;
  const step = Math.max(N / 2, (len - N) / 399), pw = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N); let used = 0, n = 0;
  for (let pos = from; pos + N <= to; pos += step) {
    const p0 = Math.floor(pos), chans = (await DISK.read(p0, N)).chans; let e = 0; n++;
    for (let i = 0; i < N; i++) { let v = 0; for (let c = 0; c < nch; c++) v += chans[c][i]; v = v / nch * T.w[i]; re[i] = v; im[i] = 0; e += v * v; }
    if (e >= 1e-6) { fftIn(re, im); for (let k = 0; k <= N / 2; k++) pw[k] += re[k] * re[k] + im[k] * im[k]; used++; }
    if (tick && n % 20 === 0) await tick();
  }
  return avgFinish(pw, used, sr);
}
function smoothCurve(a, w) { const o = new Float32Array(a.length), h = w >> 1; for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k++) { s += a[k]; n++; } o[i] = s / n; } return o; }
/* the text file: a short header, then one "frequency  level" pair per line. Any list of such pairs is understood, so curves from other tools can be tried too. */
function curveToText(curve, name) {
  const L = ['glisscore eq curve: 1', 'name: ' + name, '# frequency in Hz, then level in dB (the average is 0, so loudness does not matter)'];
  for (let i = 0; i < eqAxis.length; i += 2) L.push(eqAxis[i].toFixed(1) + '\t' + curve[i].toFixed(2));
  return L.join('\n') + '\n';
}
function curveFromText(text) {
  const pts = [];
  String(text).split(/\r?\n/).forEach(l => {
    l = l.trim(); if (!l || /^[#*;%]/.test(l)) return; const m = l.split(/[\s,;]+/); if (m.length < 2) return;
    const f = parseFloat(m[0]), v = parseFloat(m[1]); if (f > 0 && f < 1e6 && isFinite(v) && Math.abs(v) < 200) pts.push([f, v]);
  });
  if (pts.length < 8) return null; pts.sort((a, b) => a[0] - b[0]);
  const out = new Float32Array(eqAxis.length); let j = 0;
  for (let i = 0; i < out.length; i++) {
    const f = eqAxis[i]; while (j < pts.length - 2 && pts[j + 1][0] < f) j++;
    const [f0, v0] = pts[j], [f1, v1] = pts[j + 1], t = f1 > f0 ? clamp(Math.log(f / f0) / Math.log(f1 / f0), 0, 1) : 0; out[i] = v0 + (v1 - v0) * t;
  }
  return curveCenter(out);
}
/* a few bell bands that follow a target curve: place one where the gap is biggest, as wide as the gap, take its effect away, and repeat */
function eqFit(target, maxBands) {
  const R = Float32Array.from(target), bands = [];
  { // a lasting lift or dip across the top end is one shelf, not a pile of bells
    let sum = 0, cnt = 0; eqAxis.forEach((f, i) => { if (f >= 11000 && f <= 18000) { sum += R[i]; cnt++; } }); const pl = cnt ? sum / cnt : 0;
    if (Math.abs(pl) >= 2) {
      let ci = eqAxis.findIndex(f => f >= 11000); while (ci > 0 && R[ci] * Math.sign(pl) > Math.abs(pl) / 2) ci--;
      const sh = { type: 'highshelf', f: Math.round(eqAxis[ci]), g: clamp(Math.round(pl * 2) / 2, -EQ_DB, EQ_DB), q: 0.71, on: true };
      const resp = eqCurve([sh]); for (let i = 0; i < R.length; i++) R[i] -= resp[i]; bands.push(sh);
    }
  }
  for (let n = bands.length; n < maxBands; n++) {
    let bi = -1, bm = 0; for (let i = 0; i < R.length; i++) { const f = eqAxis[i]; if (f < 30 || f > 18000) continue; const a = Math.abs(R[i]); if (a > bm) { bm = a; bi = i; } }
    if (bi < 0 || bm < 0.8) break;
    const sg = Math.sign(R[bi]); let l = bi, r = bi; while (l > 0 && R[l - 1] * sg > bm / 2) l--; while (r < R.length - 1 && R[r + 1] * sg > bm / 2) r++;
    const oct = clamp(Math.log2(eqAxis[r] / eqAxis[l]), 0.3, 4), q = clamp(1 / (2 * Math.sinh(Math.LN2 / 2 * oct)), 0.4, 8);
    const band = { type: 'peaking', f: Math.round(eqAxis[bi]), g: clamp(Math.round(R[bi] * 2) / 2, -EQ_DB, EQ_DB), q: Math.round(q * 100) / 100, on: true };
    const resp = eqCurve([band]); for (let i = 0; i < R.length; i++) R[i] -= resp[i]; for (let i = l; i <= r; i++) R[i] = 0; bands.push(band);          // that stretch is dealt with, even where the band could not reach
  }
  return bands.sort((a, b) => a.f - b.f);
}
/* your own recording's average curve over the part you keep. Held in memory it is worked out at once; on the store it is read from there, so it comes as a promise (the same for both through aeOwnCurveA) */
function aeOwnCurveA() {
  if (!S.audio.disk) return Promise.resolve(aeOwnCurve());
  const d = AE.d, sr = S.audio.sr, from = Math.floor(Math.max(0, d.vStart) * sr), to = Math.floor(Math.min(aeEnd(d), S.audio.duration) * sr), key = from + '|' + to, m = AE.match || (AE.match = {});
  if (m.ownKey === key && m.ownP) return m.ownP;
  m.ownKey = key; m.busyOwn = true; aeMatchUi();
  const p = m.ownP = avgCurveDisk(from, to, sr, Math.min(2, S.audio.ch), tick).then(c => { m.own = c; return c; }).finally(() => { if (m.ownP === p) { m.busyOwn = false; aeMatchUi(); } });
  return p;
}
function aeOwnCurve() {
  const d = AE.d, buf = S.audio.buffer, sr = buf.sampleRate, from = Math.floor(Math.max(0, d.vStart) * sr), to = Math.floor(Math.min(aeEnd(d), S.audio.duration) * sr), key = from + '|' + to, m = AE.match || (AE.match = {});
  if (m.ownKey !== key) { const ch = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c)); m.own = avgCurve(ch, from, to, sr); m.ownKey = key; }
  return m.own;
}
async function aeMatchTarget() {
  const m = AE.match; if (!m || !m.ref) return null; const own = await aeOwnCurveA(); if (!own || AE.match !== m || !m.ref) return null;
  const D = new Float32Array(own.length); for (let i = 0; i < D.length; i++) D[i] = m.ref[i] - own[i];
  const sm = smoothCurve(D, 10), amt = (+$('#aeMatchAmt').value) / 100;
  return sm.map(v => clamp(v * amt, -EQ_DB, EQ_DB));
}
async function aeMatchApply(slide) {
  const t = await aeMatchTarget(); if (!t) { toast(tx('ae.nosound'), 4500); return; }
  AE.match.target = t; const curve = Array.from(t, v => Math.round(v * 10) / 10), has = curve.some(v => Math.abs(v) >= 0.05);
  aeFx(fx => { if (has) { fx.eq.on = true; fx.eq.curve = curve; } else delete fx.eq.curve; AE.band = Math.max(0, Math.min(AE.band, fx.eq.bands.length - 1)); }, slide); if (!slide) edSay('ae', 'match');          // the match is a free curve of its own, made exactly (EQ Match), and the bands stay yours
}
/* the free curve turned into bands you can move: the nearest handful of bells, set beside the bands you have */
function aeMatchToBands() {
  const fx = AE.d.fx, c = fx.eq.curve; if (!c) return; const room = EQ_MAX_BANDS - fx.eq.bands.length;
  if (room < 1) { toast(tx('ae.nobands'), 4200); return; }
  const made = eqFit(Float32Array.from(c), Math.min(8, room)), first = fx.eq.bands.length;
  if (!made.length) { toast(tx('ae.flatbands'), 4200); return; }          // a flat match has nothing to turn into bands: keep it as it is
  aeFx(fx2 => { fx2.eq.bands.push(...made); delete fx2.eq.curve; fx2.eq.on = true; AE.band = first; }); if (AE.match) { AE.match.ref = null; AE.match.target = null; AE.match.refName = ''; } AE.matchOpen = false; aeMatchUi(); aeEqDraw();
}
async function aeMatchLoad(file, kind) {
  const m = AE.match || (AE.match = {}); m.busy = true; m.refName = file.name; m.ref = null; m.target = null; aeMatchUi();
  try {
    let curve = null;
    if (kind === 'profile') curve = curveFromText(await file.text());
    else {
      const ab = await file.arrayBuffer(), ac = ensureCtx(), buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
      await sleep(30); const ch = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c)); curve = avgCurve(ch, 0, buf.length, buf.sampleRate);
    }
    if (AE.match !== m) return;           // the editor was reset while this was loading
    m.busy = false;
    if (!curve) { m.refName = ''; aeMatchUi(); toast(tx(kind === 'profile' ? 'ae.badprofile.long' : 'ae.measurefail'), 5200); return; }
    m.ref = curve; aeMatchUi(); aeMatchApply(false);
  } catch (e) { console.error(e); if (AE.match === m) { m.busy = false; m.refName = ''; aeMatchUi(); } toast(tx(kind === 'profile' ? 'ae.badprofile' : 'ae.readfail'), 5200); }
}
/* the band controls and EQ Match take turns: one folds shut (its height glides to nothing, grid 0fr) as the other opens, so the curve above grows and shrinks with them */
function eqFold(sel, open) { const el = $(sel); el.classList.toggle('shut', !open); el.inert = !open; el.setAttribute('aria-hidden', String(!open)); }
/* the two steps of EQ Match: pick a reference, then choose how far to go */
function aeMatchUi() {
  const open = !!AE.matchOpen, m = AE.match, has = !!(m && m.ref), busy = !!(m && (m.busy || m.busyOwn));
  eqFold('#aeMatchFold', open); eqFold('#aeBandFold', !open); $('#aeMatchBtn').setAttribute('aria-pressed', open);
  $('#aeRefEmpty').hidden = has || busy; $('#aeRefChip').hidden = !(has || busy); $('#aeRefChip').classList.toggle('busy', busy);
  $('#aeRefName').textContent = busy ? (m.busy ? 'Processing ' + m.refName : 'Processing your audio') + '…' : has ? m.refName : '';
  $('#aeAmtStep').classList.toggle('dim', !has); $('#aeMatchAmt').disabled = !has;
  $('#aeMatchAmtVal').textContent = $('#aeMatchAmt').value + '%'; paintRange($('#aeMatchAmt'));
  $('#aeRefSave').disabled = !S.audio; $('#aeRefBands').disabled = !(AE.d && AE.d.fx.eq.curve); $('#aeMatchBtn').classList.toggle('has', !!(AE.d && AE.d.fx.eq.curve) && !open); aeAnim();
  if (AE.d) $('#aeReset').disabled = aeSame(AE.d, AE_DEFAULT) && !aeHasMatch() && !aeBpAny();
}
function aeMatchBind() {
  $('#aeMatchBtn').addEventListener('click', () => { AE.matchOpen = !AE.matchOpen; aeMatchUi(); aeEqDraw(); });
  $('#aeAutoBtn').addEventListener('click', () => aeFx(fx => { fx.eq.auto = !fx.eq.auto; }));
  $('#aeRefProfile').addEventListener('click', () => $('#aeProfIn').click());
  $('#aeRefAudio').addEventListener('click', () => $('#aeRefIn').click());
  $('#aeProfIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) aeMatchLoad(f, 'profile'); });
  $('#aeRefIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) aeMatchLoad(f, 'audio'); });
  $('#aeRefClear').addEventListener('click', () => { if (AE.match) { AE.match.ref = null; AE.match.target = null; AE.match.busy = false; AE.match.refName = ''; } if (AE.d.fx.eq.curve) aeFx(fx => { delete fx.eq.curve; }); aeMatchUi(); });          // the curve goes with its reference (Turn into bands keeps it as bands)
  $('#aeRefBands').addEventListener('click', aeMatchToBands);
  $('#aeRefSave').addEventListener('click', async () => {
    let c = null; try { c = await aeOwnCurveA(); } catch (e) { console.error(e); } if (!c) { toast(tx('ae.nosound'), 4500); return; }
    const base = (S.credits.title.trim() || S.audio.name.replace(/\.[^.]+$/, '') || 'Audio').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Audio';
    try { await saveFile(new Blob([curveToText(c, base)], { type: 'text/plain' }), base + ' - glisscore EQ profile.txt'); toast(tx('ae.profilesaved')); } catch (e) { toast(tx('ae.filefail'), 5000); }
  });
  $('#aeMatchAmt').addEventListener('input', () => { aeMatchUi(); if (AE.match && AE.match.ref) aeMatchApply(true); });
  $('#aeMatchAmt').addEventListener('change', () => { AE.sliding = false; });
}
/* ---------------- Audio Editor: the Emulator ----------------
   An assistant, not a stage in the chain. It measures another recording (its tone, how wide it is in the low, middle, and high notes, how loud
   it is) and sets the EQ's free curve, the Imager's widths and Level's loudness target to bring yours there. It is one undo step, Amount scales
   the tone and the width, and Bypass with Match gain compares before and after. Noise reduction, Spectra, the trim and the fades are left alone. */
/* what is measured: the tone as EQ Match measures it, and in each of the Imager's three bands how far the side lies under the mid (dB).
   `read(pos, n)` gives the channels of n samples from pos (at once or as a promise), so a recording in memory, one on the store and a reference all go through here */
async function emPrint(read, from, to, sr, nch, alive, prog) {
  const N = FFT_N, T = fftTables(), len = to - from; if (len < N) return null;
  const step = Math.max(N / 2, (len - N) / 399), pm = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N), binHz = sr / N;
  const cut = [20, IM_X1, IM_X2, 20000].map(f => Math.min(N / 2, Math.max(1, Math.round(f / binHz)))), bm = [0, 0, 0], bs = [0, 0, 0]; let used = 0, n = 0;
  for (let pos = from; pos + N <= to; pos += step) {
    const ch = await read(Math.floor(pos), N); if (alive && !alive()) return null; n++;
    const L = ch[0], R = nch > 1 ? ch[1] : ch[0]; let e = 0;
    for (let i = 0; i < N; i++) { const v = (L[i] + R[i]) / 2 * T.w[i]; re[i] = v; im[i] = 0; e += v * v; }
    if (e >= 1e-6) {          // silence says nothing about the sound
      fftIn(re, im); for (let k = 0; k <= N / 2; k++) pm[k] += re[k] * re[k] + im[k] * im[k];
      for (let b = 0; b < 3; b++) for (let k = cut[b]; k < cut[b + 1]; k++) bm[b] += re[k] * re[k] + im[k] * im[k];
      if (nch > 1) { for (let i = 0; i < N; i++) { re[i] = (L[i] - R[i]) / 2 * T.w[i]; im[i] = 0; } fftIn(re, im); for (let b = 0; b < 3; b++) for (let k = cut[b]; k < cut[b + 1]; k++) bs[b] += re[k] * re[k] + im[k] * im[k]; }
      used++;
    }
    if (n % 20 === 0) { if (prog) prog((pos - from) / len); await tick(); }
  }
  if (prog) prog(1);
  if (!used) return null;
  return { tone: avgFinish(pm, used, sr), side: nch > 1 ? bm.map((m, b) => 10 * Math.log10((bs[b] + 1e-20) / (m + 1e-20))) : null };
}
const EM_LO0 = 40, EM_LO1 = 90, EM_HI0 = 9000, EM_HI1 = 16000, EM_UP = 6, EM_DOWN = 9;          // the tone is chased fully between 90Hz and 9kHz, not at all below 40Hz or above 16kHz, and no boost goes far past 6dB
const EM_MONO = -50;          // a side this far under the mid is a mono recording: there is nothing there to widen
/* the settings that bring `own` to `ref`: the EQ's curve, the Imager's three widths (percent) and the loudness target; null where a part is not taken or cannot be */
function emPlan(own, ref, amt, take) {
  const out = { curve: null, bw: null, lufs: null };
  if (take.tone) {
    const n = own.tone.length, D = new Float32Array(n), W = new Float32Array(n), ss = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
    for (let i = 0; i < n; i++) { const f = eqAxis[i]; D[i] = ref.tone[i] - own.tone[i]; W[i] = ss(Math.log2(f / EM_LO0) / Math.log2(EM_LO1 / EM_LO0)) * (1 - ss(Math.log2(f / EM_HI0) / Math.log2(EM_HI1 / EM_HI0))); }          // W: how far a place is chased; the deepest bass and the top octave are where recordings differ by what they were made with (a room's rumble, an encoder's low-pass), not by how they sound
    let m = 0, k = 0; for (let i = 0; i < n; i++) if (eqAxis[i] >= 80 && eqAxis[i] <= 10000) { m += D[i]; k++; } m = k ? m / k : 0;          // the overall level difference is the loudness's business
    const sm = smoothCurve(D.map(v => v - m), 10), soft = v => v >= 0 ? EM_UP * Math.tanh(v / EM_UP) : -EM_DOWN * Math.tanh(-v / EM_DOWN);          // a boost bends over toward 6dB, a cut toward 9dB
    out.curve = Array.from(sm, (v, i) => Math.round(clamp(soft(v * W[i]) * amt, -EQ_DB, EQ_DB) * 10) / 10);
  }
  if (take.width && own.side && ref.side) out.bw = own.side.map((v, b) => v < EM_MONO ? 100 : Math.round(clamp(100 * Math.pow(10, amt * clamp(ref.side[b] - v, -4, 6) / 20), 0, 200)));
  if (take.loud && amt > 0 && Number.isFinite(ref.I)) out.lufs = clamp(Math.round(ref.I * 10) / 10, -36, -6);
  return out;
}
function emApply(base, plan) {
  const d = aeCopy(base);
  if (plan.curve) { if (plan.curve.some(v => Math.abs(v) >= 0.05)) d.fx.eq.curve = plan.curve; else delete d.fx.eq.curve; }
  if (plan.bw) d.fx.imager.bw = plan.bw.slice();
  if (plan.lufs != null) { d.normalize = true; d.normBy = 'loud'; d.normLufs = plan.lufs; d.normPreset = 'custom'; d.limiter = true; }
  fxTidy(d.fx); return d;
}
const emTake = () => ({ tone: $('#aeEmTone').getAttribute('aria-pressed') === 'true', width: $('#aeEmWidth').getAttribute('aria-pressed') === 'true' && !$('#aeEmWidth').disabled, loud: $('#aeEmLoud').getAttribute('aria-pressed') === 'true' });
const emLive = () => !!(AE.em && AE.em.result && AE.d && aeSame(AE.d, AE.em.result));          // the editor still holds exactly what the Emulator set
/* your own recording over the part you keep, measured once for that part */
function aeEmOwn() {
  const em = AE.em || (AE.em = {}), d = AE.d, sr = S.audio.sr || S.audio.buffer.sampleRate, from = Math.floor(Math.max(0, d.vStart) * sr), to = Math.floor(Math.min(aeEnd(d), S.audio.duration) * sr), key = from + '|' + to, nch = fxChannels();
  if (em.ownKey === key && em.ownP) return em.ownP;
  let read; if (S.audio.disk) read = async (p, n) => (await DISK.read(p, n)).chans; else { const ch = []; for (let c = 0; c < nch; c++) ch.push(S.audio.buffer.getChannelData(c)); read = (p, n) => ch.map(a => a.subarray(p, p + n)); }
  em.ownKey = key; em.busyOwn = true; aeEmUi();
  em.prog = 0; const p = em.ownP = emPrint(read, from, to, sr, nch, () => AE.em === em, v => emBar(em, v)).then(o => { em.own = o; return o; }, () => null).finally(() => { if (em.ownP === p) { em.busyOwn = false; if (AE.d) aeEmUi(); } });
  return p;
}
async function aeEmLoad(file) {
  const em = AE.em = { busy: true, name: file.name, prog: 0 }; aeEmUi();
  try {
    const ab = await file.arrayBuffer(), ac = ensureCtx(), buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
    await sleep(30); if (AE.em !== em) return;
    const nch = Math.min(2, buf.numberOfChannels), ch = []; for (let c = 0; c < nch; c++) ch.push(buf.getChannelData(c));
    const pr = await emPrint((p, n) => ch.map(a => a.subarray(p, p + n)), 0, buf.length, buf.sampleRate, nch, () => AE.em === em, v => emBar(em, v * 0.8)); if (AE.em !== em) return;
    if (!pr) { AE.em = null; aeEmUi(); toast(tx('ae.emnosound'), 4800); return; }
    const lu = await LU.measure((pos, len, out) => { for (let c = 0; c < nch; c++) out.set(ch[c].subarray(pos, pos + len), c * len); }, buf.length, buf.sampleRate, nch, tick); if (AE.em !== em) return; emBar(em, 1);
    em.ref = { tone: pr.tone, side: pr.side, I: lu.I, LRA: lu.LRA }; em.busy = false; aeEmUi(); aeEmOwn();
  } catch (e) { console.error(e); if (AE.em === em) { AE.em = null; aeEmUi(); } toast(tx('ae.readfail'), 5200); }
}
/* Emulate sets everything in one undo step and stays solid while the editor holds it; pressing it again puts the settings back as they were.
   Moving Amount or the three choices while it is solid sets it again from the same starting point */
async function aeEmGo(again) {
  const em = AE.em; if (!em || !em.ref || !AE.d) return; const live = emLive();
  if (!again && live) { aePush(); AE.d = aeCopy(em.base); em.result = null; aeRefresh(); aeLive(); return; }
  if (again && !live) { aeEmUi(); return; }
  const own = await aeEmOwn(); if (AE.em !== em || !AE.d) return;
  if (!own) { toast(tx('ae.nosound'), 4500); return; }
  if (!live) { aePush(); em.base = aeCopy(AE.d); } else if (!emLive()) return;
  AE.d = emApply(em.base, emPlan(own, em.ref, +$('#aeEmAmt').value / 100, emTake())); em.result = aeCopy(AE.d);
  aeRefresh(); aeLive(); if (!again) edSay('ae', 'match');
}
function aeEmUi() {
  if (!$('#aeEmGo')) return; const em = AE.em, has = !!(em && em.ref), busy = !!(em && (em.busy || em.busyOwn)), live = emLive(), mono = fxChannels() < 2 || (has && !em.ref.side) || !!(em && em.own && em.own.side && em.own.side.every(v => v < EM_MONO));
  $('#aeEmEmpty').hidden = has || !!(em && em.busy); $('#aeEmChip').hidden = !(has || (em && em.busy)); $('#aeEmChip').classList.toggle('busy', busy);
  $('#aeEmName').textContent = em && em.busy ? 'Processing ' + em.name + '…' : has && em.busyOwn ? 'Processing your audio…' : has ? em.name : '';
  $('#aeEmTakeStep').classList.toggle('dim', !has); $('#aeEmAmtStep').classList.toggle('dim', !has);
  ['#aeEmTone', '#aeEmWidth', '#aeEmLoud'].forEach(id => { $(id).disabled = !has; }); const wb = $('#aeEmWidth'); if (has && mono) wb.disabled = true; wb.title = has && mono ? 'Needs a stereo recording and a stereo reference' : 'Sets the Imager\'s width for the low, middle, and high notes';
  const amt = $('#aeEmAmt'); amt.disabled = !has; $('#aeEmAmtVal').textContent = amt.value + '%'; paintRange(amt);
  const t = emTake(), go = $('#aeEmGo'); btnHold(go, ['Emulate', 'Emulated', 'Processing 100%']); go.disabled = !has || busy || !(t.tone || t.width || t.loud); go.classList.toggle('on', live && !busy); go.setAttribute('aria-pressed', String(live && !busy));
  go.classList.toggle('loading', busy); if (busy) { const pc = Math.round(clamp(em.prog || 0, 0, 1) * 100); go.style.setProperty('--p', pc + '%'); go.textContent = 'Processing ' + pc + '%'; } else { go.style.removeProperty('--p'); go.textContent = live ? 'Emulated' : 'Emulate'; }
  const w = [t.tone && 'the EQ', t.width && 'the Imager', t.loud && 'Level'].filter(Boolean); $('#aeEmSay').textContent = live && w.length ? 'Press again to put ' + (w.length > 1 ? 'them' : 'it') + ' back.' : '';
  $('#aeEmBadge').textContent = live ? amt.value + '%' : '';
  emSum(); $('#aeEmEmptyMsg').hidden = has; $('#aeEmBar').hidden = !busy; if (busy) emBar(em, em.prog || 0); aeRingSync(); aeAnim();
}
/* the measuring bar: the share of the sound read so far */
function emBar(em, v) { if (AE.em !== em) return; const was = Math.round((em.prog || 0) * 100); em.prog = v; const b = $('#aeEmBar'); if (b && b.firstElementChild) b.firstElementChild.style.transform = 'scaleX(' + Math.max(0.02, Math.min(1, v)) + ')'; if (Math.round(v * 100) !== was && (em.busy || em.busyOwn) && AE.d) aeEmUi(); }
/* what Emulate would set, set beside what is there now: the EQ's biggest move, the Imager's three widths and the loudness */
function emSum() {
  const em = AE.em, has = !!(em && em.ref), own = has && em.own, t = emTake(), amt = +$('#aeEmAmt').value / 100, db1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('-', '−'), hz = f => f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + 'kHz' : Math.round(f) + 'Hz';
  if (!own) { $('#aeEmT').textContent = $('#aeEmW').textContent = '–'; $('#aeEmL').textContent = has && Number.isFinite(em.ref.I) ? LUFS_TXT(Math.round(em.ref.I * 10) / 10) : '–'; $('#aeEmT2').textContent = $('#aeEmW2').textContent = ''; $('#aeEmR').textContent = has ? 'Range ' + db1(em.ref.LRA) + ' LU' : ''; return; }
  const plan = emPlan(own, em.ref, amt, t), cur = emLive() ? em.base : AE.d, was = (cur.fx.imager.bw || [100, 100, 100]).map(Math.round);
  if (plan.curve && t.tone) { let k = 0; plan.curve.forEach((v, i) => { if (Math.abs(v) > Math.abs(plan.curve[k])) k = i; }); const v = plan.curve[k]; $('#aeEmT').textContent = Math.abs(v) < 0.05 ? 'No change' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + 'dB at ' + hz(eqAxis[k]); $('#aeEmT2').textContent = 'Biggest move'; } else { $('#aeEmT').textContent = t.tone ? 'No change' : 'Not taken'; $('#aeEmT2').textContent = ''; }
  if (plan.bw && t.width) { $('#aeEmW').textContent = plan.bw.join(' · ') + '%'; $('#aeEmW2').textContent = 'Was ' + was.join(' · ') + '%, low · mid · high'; } else { $('#aeEmW').textContent = t.width ? 'No change' : 'Not taken'; $('#aeEmW2').textContent = ''; }
  $('#aeEmL').textContent = t.loud && plan.lufs != null ? LUFS_TXT(plan.lufs) : 'Not taken'; $('#aeEmR').textContent = Number.isFinite(em.ref.LRA) ? 'Reference range ' + db1(em.ref.LRA) + ' LU' : '';
}
/* the picture: yours, the reference's and yours with the curve added, on the EQ's frequency scale; it draws in and moves with Amount and the choices */
const emHs = (k, t) => { if (!TL.hs || !TL.hs[k]) hsSnap(k, 0); return hsGet(k, t); };
function aeEmDraw() {
  const cv = $('#aeEmCv'), em = AE.em; if (!cv || !cv.clientWidth) return; const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'), cs = getComputedStyle(cv), col = k => cs.getPropertyValue(k).trim(); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const fx = f => Math.log(f / 20) / Math.log(1000) * W, R = 20, y = v => H / 2 - v / R * (H / 2 - 6);
  c.strokeStyle = col('--line'); c.lineWidth = 1; c.fillStyle = col('--muted'); c.font = '10.5px ' + cs.fontFamily; c.textBaseline = 'bottom';
  [[100, '100Hz'], [1000, '1kHz'], [10000, '10kHz']].forEach(q => { const x = Math.round(fx(q[0])) + 0.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); c.fillText(q[1], x + 4, H - 2); });
  const has = !!(em && em.ref), reveal = emHs('em-in', has ? 1 : 0), own = has && em.own, tone = emTake().tone, amt = +$('#aeEmAmt').value / 100;
  if (em && em.fullOf !== own) { em.fullOf = own; em.full = own ? emPlan(own, em.ref, 1, { tone: true }).curve : null; }
  const mix = emHs('em-f', em && em.full && tone ? amt : 0), x1 = Math.max(0, reveal * W), mid = y(0);
  c.save(); c.beginPath(); c.rect(0, 0, x1, H); c.clip();
  const pts = (a, add) => { if (!a) return null; const q = smoothCurve(a, 8); return Array.from(q, (v, i) => [fx(eqAxis[i]), y(clamp(v + (add ? add[i] * mix : 0), -R, R))]); };
  const path = P => { c.beginPath(); P.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); };
  const A = pts(own && own.tone), B = pts(has && em.ref.tone), Q = em && em.full && A ? pts(own.tone, em.full) : null;
  if (A && Q && mix > 0.01) { c.beginPath(); Q.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); for (let i = A.length - 1; i >= 0; i--) c.lineTo(A[i][0], A[i][1]); c.closePath(); c.globalAlpha = 0.14 * Math.min(1, mix * 2); c.fillStyle = col('--accent'); c.fill(); c.globalAlpha = 1; }
  c.lineJoin = 'round'; if (A) { path(A); c.strokeStyle = col('--muted'); c.lineWidth = 1.6; c.stroke(); } if (B) { path(B); c.strokeStyle = col('--turn'); c.lineWidth = 2; c.stroke(); }
  if (Q && mix > 0.01) { path(Q); c.globalAlpha = Math.min(1, mix * 3); c.strokeStyle = col('--accent'); c.lineWidth = 2.2; c.stroke(); c.globalAlpha = 1; }
  c.restore();
  if (reveal > 0.01 && reveal < 0.995) { c.strokeStyle = col('--line'); c.beginPath(); c.moveTo(x1, 0); c.lineTo(x1, H); c.stroke(); }
}
function aeEmBind() {
  $('#aeEmPick').addEventListener('click', () => $('#aeEmIn').click());
  $('#aeEmIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) aeEmLoad(f); });
  $('#aeEmClear').addEventListener('click', () => { AE.em = null; aeEmUi(); });          // the settings it made stay: they are the EQ's, the Imager's and Level's now
  ['#aeEmTone', '#aeEmWidth', '#aeEmLoud'].forEach(id => $(id).addEventListener('click', e => { const b = e.currentTarget; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); if (emLive()) aeEmGo(true); else aeEmUi(); }));
  $('#aeEmAmt').addEventListener('input', () => { if (emLive()) aeEmGo(true); else aeEmUi(); });
  $('#aeEmGo').addEventListener('click', () => aeEmGo(false));
  window.addEventListener('resize', () => { if (AE.d && AE.tool === 'emu') requestAnimationFrame(aeEmDraw); });
}
/* ---------------- Audio Editor: the Noise reduction pane ---------------- */
const NR_MIN = 0.3;          // the shortest sample worth learning from, in seconds
/* a quiet stretch of the whole file: the lowest average level over a window, skipping stretches of pure silence (they hold no noise to learn) */
/* picking noise by hand is something you turn on: otherwise the waveform just moves the playhead and the handles, as it does for every other tool */
function nrArm(on) { AE.nsArm = !!on; const b = $('#aeNrHand'); if (b) b.setAttribute('aria-pressed', AE.nsArm); const cv = $('#aeCanvas'); if (cv && !AE.nsArm) cv.style.cursor = ''; aeAnim(); }
function nrFindQuiet() {
  const pk = S.audio.peaks, L = S.audio.duration, win = Math.min(1.5, Math.max(0.5, L / 4)), n = Math.round(win * 100); if (pk.length < n + 2) return null;
  let sum = 0; for (let i = 0; i < n; i++) sum += pk[i]; let best = Infinity, bi = -1;
  for (let i = 0; i + n <= pk.length; i++) { if (i) sum += pk[i + n - 1] - pk[i - 1]; const avg = sum / n; if (avg > 2e-4 && avg < best) { best = avg; bi = i; } }
  return bi < 0 ? null : { a: bi / 100, b: Math.min(L, (bi + n) / 100) };
}
function aeNrLearn() {
  const sel = AE.nsel; if (!sel || sel.b - sel.a < NR_MIN || AE.nrLearning) return;
  AE.nrLearning = true; const btn = $('#aeNrLearn'), t00 = performance.now(), show = pc => { btn.style.setProperty('--p', pc + '%'); btn.textContent = 'Processing ' + pc + '%'; };          // as Auto: the button is the bar
  btn.disabled = true; btnHold(btn, [btn.textContent, 'Learn noise', 'Learn again', 'Processing 100%']); btn.classList.add('loading'); show(0); aeNrHumUi(); NRJ.onProg(0);          // the bar shows at once; the analysis runs after one frame has painted
  requestAnimationFrame(() => setTimeout(async () => {
    try {
      const sr = audSr(), d0 = AE.d, hc = humCoefs(d0.fx.noise.hum, sr), a0 = Math.floor(sel.a * sr), lead = hc ? Math.min(a0, sr) : 0; let from = lead, to = lead + Math.floor(sel.b * sr) - a0;          // only the picked stretch is read (with a second ahead of it for the notches to settle, when a hum is being removed): the learning looks at nothing outside it
      const ch = await nrBlock(a0 - lead, to, fxChannels()); if (AE.d !== d0) return; to = Math.min(to, ch[0].length); if (hc) KFX.nrHum(ch, hc); show(50);
      const prof = NR.nrLearn(ch, sr, from, to, Array.from(eqAxis)); show(100); const spent = performance.now() - t00; if (spent < 400) await new Promise(r => setTimeout(r, 400 - spent)); if (AE.d !== d0) return;          // a short stretch is read in a blink; the bar stays long enough to be seen
      if (!prof) { NRJ.onProg(1); toast(tx('ae.nr.silent'), 5600); return; }
      const dur = Math.round((sel.b - sel.a) * 10) / 10;
      AE.nrPrev = null; aeFx(fx => { fx.noise.profile = prof; fx.noise.dur = dur; fx.noise.auto = false; }); edSay('ae', 'learn');
    } finally { AE.nrLearning = false; btn.disabled = false; btn.classList.remove('loading'); btn.style.removeProperty('--p'); if (AE.d) aeNrPanel(); aeNrHumUi(); }
  }, 0));
}
/* Auto: the noise is worked out from the whole recording (audio-fx.js, NoiseFloor), so no stretch of noise alone has to be found or learned. As the other Auto buttons that set a value:
   it stays solid while the profile is the one it measured, and pressing it again puts back what was there before. A recording too short to judge falls back to picking its quietest stretch for Learn */
async function aeNrAuto() {
  const d = AE.d; if (!d || !S.audio || AE.nrAutoBusy || AE.humBusy || AE.nrLearning) return; const nz = d.fx.noise;
  if (nz.auto && nz.profile) { const pv = AE.nrPrev; AE.nrPrev = null; aeFx(fx => { fx.noise.profile = pv ? pv.profile : null; fx.noise.dur = pv ? pv.dur : 0; fx.noise.auto = false; }); return; }
  AE.nrAutoBusy = true; nrArm(false); const btn = $('#aeNrFind'), t00 = performance.now(), show = pc => { AE.nrAutoPc = pc; btn.style.setProperty('--p', pc + '%'); btn.textContent = 'Processing ' + pc + '%'; aeRingSync(); if (pc === 0) aeNrPanel(); }; btn.disabled = true; btn.classList.remove('on'); btnHold(btn, [btn.textContent, 'Auto', 'Processing 100%']); btn.classList.add('loading'); aeNrHumUi(); show(0);
  try {
    const prof = await nrFloor(d, nz.hum, v => show(Math.round(v * 100))); if (prof === undefined) return;
    show(100); const spent = performance.now() - t00; if (spent < 400) await new Promise(r => setTimeout(r, 400 - spent)); if (AE.d !== d) return;          // a short recording is read in a blink; the bar stays long enough to be seen
    if (!prof) { const q = nrFindQuiet(); if (!q) { toast(tx('ae.nr.noquiet'), 4600); return; } AE.nsel = q; aeRefresh(); return; }
    AE.nrPrev = nz.profile ? { profile: nz.profile.slice(), dur: nz.dur } : null; AE.nsel = null;
    aeFx(fx => { fx.noise.profile = prof; fx.noise.dur = 0; fx.noise.auto = true; }); edSay('ae', 'learn');
  } catch (e) { console.error(e); } finally { AE.nrAutoBusy = false; AE.nrAutoPc = null; btn.disabled = false; btn.classList.remove('loading'); btn.style.removeProperty('--p'); btn.textContent = 'Auto'; if (AE.d) aeNrPanel(); }
}
/* the notches for a mains hum as numbers, and the sound as the noise is to be judged from: with the hum already out when one is being removed (it is taken out ahead of the noise reduction, so the noise learned must not have it in) */
const humCoefs = (hum, sr) => hum ? KFX.humBands(hum).map(b => KFX.eqSections(b, sr)[0]) : null;
async function nrBlock(at, n, nch) { if (S.audio.disk) return (await DISK.read(at, n)).chans.slice(0, nch); const bf = S.audio.buffer, ch = []; for (let c = 0; c < nch; c++) ch.push(bf.getChannelData(c).slice(at, at + n)); return ch; }          // a copy, free to be changed
/* the noise floor of the whole recording (null: too short to judge; undefined: the editor moved on meanwhile) */
async function nrFloor(d, hum, prog) {
  const sr = audSr(), nch = fxChannels(), total = audLen(), F = new KFX.NoiseFloor(sr, nch, Array.from(eqAxis)), CH = 1 << 17, hc = humCoefs(hum, sr), hst = hc ? new Float64Array(nch * hc.length * 4) : null; let tick = performance.now();
  for (let at = 0; at < total; at += CH) {
    const n = Math.min(CH, total - at), ch = await nrBlock(at, n, nch); if (AE.d !== d) return undefined; if (hc) KFX.nrHum(ch, hc, hst);
    F.push(ch, Math.min(n, ch[0].length)); if (prog) prog((at + n) / total);
    if (performance.now() - tick > 8) { await new Promise(r => setTimeout(r, 0)); tick = performance.now(); }
  }
  return F.profile();
}
/* Mains hum: the button looks for a steady 50 or 60Hz hum (audio-fx.js, HumFind: slices from all over the recording) and, when there is one, takes out it and its overtones with narrow notches ahead of the noise reduction.
   It stays solid while they are out; pressing it again puts the sound back */
async function aeNrHum() {
  const d = AE.d; if (!d || !S.audio || AE.humBusy || AE.nrAutoBusy || AE.nrLearning) return; const nz = d.fx.noise, redo = !!(nz.auto && nz.profile);          // redo: Auto's reading of the noise is taken again without (or with) the hum, in the same step
  if (nz.hum && !redo) { aeFx(fx => { fx.noise.hum = null; }); return; }
  d.humNote = ''; AE.humBusy = true; const t00 = performance.now(), show = pc => { AE.humPc = pc; AE.humPhase = !nz.hum && (!redo || pc < 50) ? 'Looking for a hum' : 'Updating the noise'; $('#aeNrHumBar').style.width = pc + '%'; aeNrHumUi(); }; show(0);
  try {
    let r = null;
    if (!nz.hum) {
      const sr = audSr(), nch = fxChannels(), total = audLen(), F = new KFX.HumFind(sr, nch), count = Math.min(160, Math.floor(total / F.n)); let tick = performance.now();
      for (let j = 0; j < count; j++) {
        const at = Math.floor(j * (total - F.n) / Math.max(1, count - 1)), ch = await nrBlock(at, F.n, nch); if (AE.d !== d) return; F.push(ch); show(Math.round((j + 1) / count * (redo ? 50 : 100)));
        if (performance.now() - tick > 8) { await new Promise(r2 => setTimeout(r2, 0)); tick = performance.now(); }
      }
      r = F.find(); if (!r) { const left = 400 - (performance.now() - t00); if (left > 0) await new Promise(r2 => setTimeout(r2, left)); if (AE.d !== d) return; d.humNote = count < 6 ? 'Too short to look' : 'No hum found'; return; }          // the message stays in the row until the next press
    }
    const prof = redo ? await nrFloor(d, r, v => show(Math.round((r ? 50 : 0) + v * (r ? 50 : 100)))) : null; if (prof === undefined || AE.d !== d) return;
    show(100); const spent = performance.now() - t00; if (spent < 400) await new Promise(r2 => setTimeout(r2, 400 - spent)); if (AE.d !== d) return;
    aeFx(fx => { fx.noise.hum = r; if (prof) fx.noise.profile = prof; });
  } catch (e) { console.error(e); } finally { AE.humBusy = false; AE.humPc = null; $('#aeNrHumBar').style.width = ''; if (AE.d) aeNrPanel(); }
}
const aeHumOn = nz => !!(nz && nz.hum), aeHumTxt = nz => 'Removed ' + Math.round(nz.hum.f) + 'Hz' + (nz.hum.n && nz.hum.n.length > 1 ? ' and its overtones' : '');
/* the Mains hum row: a switch (on while the hum is out), what it is doing in words and a thin bar along the row while it works */
function aeNrHumUi() {
  if (!AE.d) return; aeRingSync(); const nz = AE.d.fx.noise, busy = !!AE.humBusy, row = $('#aeNrHumRow'), sw = $('#aeNrHum'), t = $('#aeNrHumVal');
  sw.checked = busy ? !!AE.humWas : aeHumOn(nz); sw.disabled = busy || !!AE.nrAutoBusy || !!AE.nrLearning; row.classList.toggle('busy', busy); row.classList.toggle('on', !busy && aeHumOn(nz)); row.classList.toggle('none', !busy && !aeHumOn(nz) && !!AE.d.humNote);
  const txt = busy ? (AE.humPhase || 'Looking for a hum') + '… ' + (AE.humPc || 0) + '%' : aeHumOn(nz) ? aeHumTxt(nz) : AE.d.humNote || ''; if (t.textContent !== txt) t.textContent = txt;
}
/* what shows beside the waveform and in the pane follows the draft */
function aeNrPanel() {
  const d = AE.d, nz = d.fx.noise, has = !!nz.profile, sel = AE.nsel, short = sel && sel.b - sel.a < NR_MIN;
  aeSlide($('#aeNrRed'), nz.reduction); aeSlide($('#aeNrSens'), nz.sensitivity); aeSlide($('#aeNrSmooth'), nz.smoothing);
  $('#aeNrRedVal').textContent = nz.reduction ? nz.reduction + 'dB' : 'Off'; $('#aeNrSensVal').textContent = nz.sensitivity + '%'; $('#aeNrSmoothVal').textContent = nz.smoothing + '%';
  $('#aeNrCtl').classList.toggle('dim', !has); ['#aeNrRed', '#aeNrSens', '#aeNrSmooth'].forEach(id => { $(id).disabled = !has; });
  document.querySelectorAll('input[name=aeNrMode]').forEach(r => { r.disabled = !has; const on = r.value === nz.mode; if (r.checked !== on) { r.checked = on; const sg = $('#aeNrMode'); if (on && sg._place) sg._place(true); } });
  $('#aeNrListen').disabled = !(has && nz.on) || !!AE.nrBusy || !!AE.nrAutoBusy; $('#aeNrListen').closest('.nr-listen').title = (AE.nrBusy || AE.nrAutoBusy) ? 'Available when processing finishes' : ''; if (!(has && nz.on) && AE.nrListen) { AE.nrListen = false; aeSwapSrc(); } $('#aeNrListen').checked = !!AE.nrListen;
  aeNrLayout(has); foldSet('#aeNrSub', has && nz.reduction > 0);
  $('#aeNrChip').hidden = !has; $('#aeNrChipTxt').textContent = has ? (nz.auto ? 'Whole recording' : 'Learned ' + nz.dur.toFixed(1) + 's') : '';
  aeNrHumUi();
  { const a = $('#aeNrFind'), on = has && !!nz.auto; if (!AE.nrAutoBusy) { a.setAttribute('aria-pressed', on); a.classList.toggle('on', on); } }          // as every Auto that sets a value: solid while the profile is the one it measured
  $('#aeNrSelTxt').textContent = sel ? (short ? 'Too short. Needs ' + NR_MIN + 's.' : (sel.b - sel.a).toFixed(1) + 's selected') : ''; $('#aeNrSelTxt').classList.toggle('bad', !!short);
  if (!AE.nrLearning) { $('#aeNrLearn').disabled = !sel || short; $('#aeNrLearn').textContent = has && !nz.auto ? 'Learn again' : 'Learn noise'; } $('#aeNrLearnStep').classList.toggle('dim', !sel && !has);
}
/* before anything is learned the two steps fill the big window; once there is a profile they slide down into their own card and the graph takes over */
function aeNrLayout(post) {
  const grid = $('#aeNrGrid'); if (!grid || AE.nrPost === post) return; const first = AE.nrPost === undefined; AE.nrPost = post;
  const els = [$('#aeNrSample'), $('#aeNrCtl')], r0 = els.map(e => e.getBoundingClientRect()), shown = !$('#aePaneNoise').hidden && !$('#audioDlg').hidden;
  grid.classList.toggle('pre', !post);
  if (first || !shown || reducedMotion() || !r0[0].width) return;
  const ease = EASE_GLIDE;
  els.forEach((e, i) => { const r1 = e.getBoundingClientRect(); e.animate([{ transform: 'translate(' + (r0[i].left - r1.left) + 'px,' + (r0[i].top - r1.top) + 'px)', width: r0[i].width + 'px', height: r0[i].height + 'px', overflow: 'hidden' }, { transform: 'none', width: r1.width + 'px', height: r1.height + 'px', overflow: 'hidden' }], { duration: 640, easing: ease }); });
  els[0].querySelector('.mt-steps').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay: 160, easing: 'ease-out', fill: 'backwards' });
}
/* the sound at the playhead on the profile's own scale: before the cleaning and after it */
function nrLive() {
  const now = performance.now(), L = AE.nrLv || (AE.nrLv = { t: 0, inp: null, out: null, key: '' }); const t = AE.playing && AE.src ? aeNow() : AE.pos, key = t.toFixed(3);
  if (now - L.t < 30 || (key === L.key && !AE.playing)) return L; L.t = now; L.key = key;
  if (S.audio.disk) {          // the sound around the playhead comes from the store a moment late: the latest read is used, and the next one starts
    const w = diskWindow(clamp(Math.floor(t * S.audio.sr) - 3072, 0, Math.max(0, S.audio.frames - 6144)), 6144); if (!w || w.len < 2048) return L;
    const mix = (a, b) => { if (!b) return null; if (!a) return b; return b.map((v, i) => a[i] + (v - a[i]) * 0.45); };
    L.inp = mix(L.inp, NR.nrLearn(w.chans.slice(0, Math.min(2, w.chans.length)), S.audio.sr, 0, w.len, Array.from(eqAxis))); L.out = null; return L;
  }
  const buf = S.audio.buffer, sr = buf.sampleRate, from = clamp(Math.floor(t * sr) - 3072, 0, Math.max(0, buf.length - 6144)), to = from + 6144, pick = b => { const ch = []; for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) ch.push(b.getChannelData(c)); return NR.nrLearn(ch, b.sampleRate, from, to, Array.from(eqAxis)); };
  const mix = (a, b) => { if (!b) return null; if (!a) return b; return b.map((v, i) => a[i] + (v - a[i]) * 0.45); };
  L.inp = mix(L.inp, pick(buf)); const r = nrPeek(AE.d.fx.noise, false); L.out = r && AE.d.fx.noise.on && !aeBp('noise') ? mix(L.out, pick(r.buffer)) : null; return L;
}
function aeNrProg(v) {
  const bar = $('#aeNrProgBar'), busy = v < 0.999; if (!bar) return;
  AE.nrTarget = clamp(v, 0, 1); bar.classList.toggle('wait', busy && AE.nrTarget <= 0.001);          // no tick yet: a sweep shows it is working
  if (busy !== !!AE.nrShown) { AE.nrShown = busy; if (busy) AE.nrCur = 0;          // a new job fills from empty, not down from where the last one ended
     bar.classList.toggle('on', busy); aeToolsRefresh(); if (AE.d && !$('#audioDlg').hidden) aeNrPanel(); }          // the light, the badge and the row change once per job, not per tick
  if (!AE.nrRaf) AE.nrRaf = requestAnimationFrame(aeNrTween);
  if (AE.wantPlay && !AE.nrBusy) aeResume(0);
}
/* the fill eases to the latest progress on each frame: no waiting for the next tick, and no layout work (transform only) */
function aeNrTween() {
  const b = $('#aeNrProg'); if (!b) { AE.nrRaf = 0; return; }
  AE.nrCur = (AE.nrCur || 0) + ((AE.nrTarget || 0) - (AE.nrCur || 0)) * 0.35;
  if (Math.abs(AE.nrTarget - AE.nrCur) < 0.002) AE.nrCur = AE.nrTarget;
  b.style.transform = 'scaleX(' + AE.nrCur.toFixed(4) + ')'; aeRingSync(); const pc = $('#aeNrPct'); if (pc) pc.textContent = AE.nrCur > 0.01 && AE.nrCur < 0.999 ? Math.round(AE.nrCur * 100) + '%' : '';
  AE.nrRaf = AE.nrCur !== AE.nrTarget || AE.nrTarget < 0.999 ? requestAnimationFrame(aeNrTween) : 0;
}
/* playback waits only while the noise removal has not produced anything yet; after that the last finished version plays (and is swapped in when a new one is done) */
function aeWaiting() { const d = AE.d; return !!d && !!S.audio && !S.audio.disk && !aeBp('noise') && AE.nrBusy && !AE.nrLast && fxActive(d.fx, fxChannels()).includes('noise') && !prePeek(d.fx, AE.nrListen); }
function aeResume(n) {
  if (!AE.wantPlay) return;
  if (aeWaiting() && n < 120) { requestAnimationFrame(() => aeResume(n + 1)); return; }
  AE.wantPlay = false; aeWaitUI(false); aePlay();
}
/* the play button pulses while it waits, and the status bar says what it is waiting for */
function aeWaitUI(on, why) { const b = $('#aePlay'); if (!b) return; const t = why || 'Waiting for noise reduction to finish'; b.classList.toggle('waiting', !!on); b.setAttribute('aria-label', on ? t : 'Play preview'); b.title = on ? t : ''; }
/* the learned noise: its level at every frequency (hum shows up as spikes, hiss as a slope), with the floor it will be turned down to */
function aeNrDraw() {
  const cv = $('#aeNrCv'); if (!AE.d || $('#aePaneNoise').hidden || !aeCvSize(cv)) return;
  const c = cv.getContext('2d'), W = cv.clientWidth, H = cv.clientHeight, C = TL.C, nz = AE.d.fx.noise, has = !!nz.profile; if (has) AE.nrProf = nz.profile;
  const pa = hsGet('ae-nrp', has ? 1 : 0), red = hsGet('ae-nrr', has && nz.on ? nz.reduction : 0), by = hsGet('ae-by', aeBy());
  c.clearRect(0, 0, W, H); roundRect(c, 0.5, 0.5, W - 1, H - 1, 10); c.fillStyle = C.panel2; c.fill(); c.save(); c.globalAlpha = 0.06; c.fillStyle = C.ink; c.fill(); c.restore(); c.strokeStyle = C.line; c.lineWidth = 1; c.stroke();
  c.save(); roundRect(c, 1, 1, W - 2, H - 2, 9); c.clip();
  c.font = '10.5px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle';
  [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']].forEach(([f, t]) => { const x = Math.round(eqFx(f, W)); c.globalAlpha = 0.35; c.fillStyle = C.line; c.fillRect(x, 8, 1, H - 24); c.globalAlpha = 1; c.fillStyle = C.muted; c.textAlign = 'center'; c.fillText(t, x, H - 9); });
  { const hm = nz.hum && !aeBp('noise') ? nz.hum : null, ha = hsGet('ae-hum', hm ? 1 : 0); if (hm) AE.humLast = hm; const hh = hm || AE.humLast;
    if (hh && ha > 0.01) { c.save(); c.globalAlpha = ha; const col = C.accent, hs = (hh.n && hh.n.length ? hh.n : [1]).filter(k => hh.f * k < 20000);          // the hum's own pitch and its overtones: thin dashed lines where the notches are
      hs.forEach((k, i) => { const x = Math.round(eqFx(hh.f * k, W)); c.save(); c.globalAlpha = ha * (i ? 0.55 : 0.9); c.strokeStyle = col; c.lineWidth = 1.4; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x + 0.5, 22); c.lineTo(x + 0.5, H - 24); c.stroke(); c.restore(); });
      c.font = '600 11px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'left'; c.fillStyle = col; c.fillText('Hum out · ' + Math.round(hh.f) + 'Hz', Math.min(W - 150, Math.round(eqFx(hh.f * (hs[0] || 1), W)) + 6), 16); c.restore(); } }
  const P = AE.nrProf;
  if (P && pa > 0.01) {
    let mx = -1e9; P.forEach(v => { if (v > mx) mx = v; }); const lv = nrLive(); let lm = -1e9; if (lv.inp) lv.inp.forEach(v => { if (v > lm) lm = v; });
    const refT = Math.max(mx, lm > -1e9 ? lm - 6 : mx), ref = AE.nrRef = AE.nrRef === undefined ? refT : AE.nrRef + (refT - AE.nrRef) * 0.12, top = 30, bot = H - 24, y = v => top + clamp((ref + 4 - v) / 78, 0, 1.2) * (bot - top);
    if (lv.inp) { c.save(); c.beginPath(); eqAxis.forEach((f, i) => { const x = eqFx(f, W), yy = Math.min(bot, y(lv.inp[i])); if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }); c.lineTo(eqFx(20000, W), bot); c.lineTo(eqFx(20, W), bot); c.closePath(); c.globalAlpha = 0.2 * pa * (1 - 0.6 * by); c.fillStyle = C.wave; c.fill(); c.restore(); }
    const pts = eqAxis.map((f, i) => [eqFx(f, W), y(P[i])]), flo = eqAxis.map((f, i) => [eqFx(f, W), Math.min(bot + 2, y(P[i] - red))]);
    c.save(); c.globalAlpha = pa * (1 - 0.5 * by);
    const ra = clamp(red / 2, 0, 1);
    if (ra > 0.01) { c.beginPath(); pts.forEach(([x, yy], i) => { if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }); for (let i = flo.length - 1; i >= 0; i--) c.lineTo(flo[i][0], flo[i][1]); c.closePath(); c.globalAlpha = 0.16 * pa * (1 - by) * ra; c.fillStyle = C.accent; c.fill(); c.globalAlpha = pa * (1 - 0.5 * by); }
    c.lineJoin = c.lineCap = 'round'; c.beginPath(); pts.forEach(([x, yy], i) => { if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }); c.lineTo(pts[pts.length - 1][0], bot); c.lineTo(pts[0][0], bot); c.closePath(); c.globalAlpha = 0.14 * pa; c.fillStyle = C.turn; c.fill();
    c.globalAlpha = pa * (1 - 0.5 * by); c.beginPath(); pts.forEach(([x, yy], i) => { if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }); c.lineWidth = 2.2; c.strokeStyle = C.turn; c.stroke();
    if (ra > 0.01) { c.globalAlpha = pa * (1 - 0.5 * by) * ra; c.beginPath(); flo.forEach(([x, yy], i) => { if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }); c.lineWidth = 1.8; c.strokeStyle = C.accent; c.setLineDash([5, 4]); c.stroke(); c.setLineDash([]); }
    if (lv.out && by < 0.5) { c.beginPath(); eqAxis.forEach((f, i) => { const x = eqFx(f, W), yy = Math.min(bot, y(lv.out[i])); if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }); c.lineWidth = 1.6; c.strokeStyle = C.accent; c.globalAlpha = 0.9 * pa * (1 - 2 * by); c.stroke(); }
    c.restore();
    { const la = clamp(red / 2, 0, 1), e = 1 - Math.pow(1 - la, 3);          // 'After' slides in beside 'Noise' as Reduction rises from Off and slides out as it falls
      c.save(); c.font = '600 11px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'right'; const lx = W - 14;
      if (la > 0.01) { c.globalAlpha = pa * la; c.fillStyle = C.accent; c.fillText('╍ After', lx + 10 * (1 - e), 16); }
      c.globalAlpha = pa; c.fillStyle = C.turn; c.fillText('━ Noise', lx - 68 * e, 16); c.restore(); }
  }
  if (pa < 0.5) { c.save(); c.fillStyle = C.muted; c.font = '13px "Instrument Sans",system-ui,sans-serif'; c.textAlign = 'center'; c.globalAlpha = 1 - pa * 2; c.fillText('No noise learned yet', W / 2, H / 2 - 6); c.restore(); }
  aePill(c, W, by); c.restore();
}
/* what the editor plays: the cleaned-up sound while Noise reduction is on (the last one that was ready until a new one is), or just the noise */
function aeSrcBuffer() {
  const d = AE.d, hf = d && aeFxHeard(d.fx); if (!d || !fxActive(hf, fxChannels()).includes('noise')) return S.audio.buffer;
  const r = prePeek(hf, AE.nrListen && !aeBp('noise')); if (r) { if (hf === d.fx) AE.nrLast = r.buffer; return r.buffer; }
  return hf === d.fx ? AE.nrLast || S.audio.buffer : S.audio.buffer;
}
/* a new source (the cleaning finished, Bypass, listening to the noise): carry on from the same place */
function aeSwapSrc() {
  if (!AE.playing || !AE.ph || !AE.mem || !AE.d || AE.dh) return; const buf = aeSrcBuffer(); if (AE.mem.buf === buf) return;
  AE.mem.use(buf); AE.ph.refresh(Math.round(AE.ph.sr * 0.03)).catch(() => {});          // the player carries on for a moment with what it holds, then eases into the new sound
}
function aeNrBind() {
  NRJ.onProg = v => { AE.nrBusy = v < 0.999; aeNrProg(v); };
  $('#aeNrHand').addEventListener('click', () => nrArm(!AE.nsArm));
  $('#aeNrFind').addEventListener('click', aeNrAuto); $('#aeNrHum').addEventListener('click', e => { e.preventDefault(); AE.humWas = !!(AE.d && AE.d.fx.noise.hum); aeNrHum(); });          // the switch shows what the hum is doing (aeNrHumUi), not what a click would do
  $('#aeNrLearn').addEventListener('click', aeNrLearn);
  $('#aeNrClear').addEventListener('click', () => { AE.nrPrev = null; aeFx(fx => { fx.noise.profile = null; fx.noise.on = false; fx.noise.dur = 0; fx.noise.auto = false; }); });
  const nzS = (id, key) => $(id).addEventListener('input', e => aeFx(fx => { fx.noise[key] = +e.target.value; if (fx.noise.profile) fx.noise.on = fx.noise.reduction > 0; }, true));
  nzS('#aeNrRed', 'reduction'); nzS('#aeNrSens', 'sensitivity'); nzS('#aeNrSmooth', 'smoothing');
  document.querySelectorAll('input[name=aeNrMode]').forEach(r => r.addEventListener('change', e => { if (e.target.checked) aeFx(fx => { fx.noise.mode = e.target.value; }); }));
  ['#aeNrRed', '#aeNrSens', '#aeNrSmooth'].forEach(id => $(id).addEventListener('change', () => { AE.sliding = false; }));
  $('#aeNrListen').addEventListener('change', e => { AE.nrListen = e.target.checked; aeSwapSrc(); aeToolsRefresh(); if (AE.dh) aeLive(); });          // on the store the player is told to listen to the noise alone
}
function aeBind() {
  aeBindCanvas(); aeToolsBind(); aeMatchBind(); aeEmBind(); aeNrBind(); spBind();
  $('#aeFormat').addEventListener('change', e => { const t = e.target.value; S.set.audioFormat = AE_FMT_LAST[t]; saveSettings(); aeFormatUI(); });
  $('#aeMetaGo').addEventListener('click', () => aePage(true)); $('#aeMetaBack').addEventListener('click', () => aePage(false));
  TAG_FIELDS.forEach(([id, k]) => $('#aeTag' + id).addEventListener('input', e => { const v = e.target.value; S.set[k] = k === 'tagTitle' && v.trim() === S.credits.title.trim() ? '' : (/Year|Track|Disc|MovementNo/.test(id) ? v.replace(/\D/g, '') : v); if (S.set[k] !== v && id !== 'Title') e.target.value = S.set[k]; saveSettings(); $('#aeMetaVal').textContent = aeTags() ? 'Added' : ''; }));
  [['ShowWork', 'tagShowWork'], ['Compilation', 'tagCompilation']].forEach(([id, k]) => $('#aeTag' + id).addEventListener('change', e => { S.set[k] = e.target.checked; saveSettings(); aeFormatUI(); }));
  $('#aeRate').addEventListener('change', e => { S.set.audioRate = +e.target.value; saveSettings(); aeFormatUI(); });
  $('#aeFormatQ').addEventListener('change', e => { S.set.audioFormat = e.target.value; AE_FMT_LAST[aeFmtType(e.target.value)] = e.target.value; saveSettings(); aeFormatUI(); });
  aeHistBind(); $('#aeUndo').addEventListener('click', aeUndo); $('#aeRedo').addEventListener('click', aeRedo); $('#aeReset').addEventListener('click', aeReset);
  $('#aePlay').addEventListener('click', aeToggle);
  $('#aeCancel').addEventListener('click', () => { const go = () => { aeDropPreview(); closeAudioEditor(); }; if (AE.exporting) aeLeave().then(ok => { if (ok) go(); }); else go(); }); $('#aeDone').addEventListener('click', aeApply); $('#aeExport').addEventListener('click', aeExpOpen); $('#aeExpStop').addEventListener('click', () => { AE.expStop = true; $('#aeExpStop').hidden = true; });
  $('#aeExpCancel').addEventListener('click', aeExpClose); $('#aeExpGo').addEventListener('click', aeExport); $('#aeRunHide').addEventListener('click', aeExpClose); $('#aeRunClose').addEventListener('click', () => { aeExpClose(); aeRunReset(); }); $('#aeRunStop').addEventListener('click', () => { AE.expStop = true; $('#aeExpStop').hidden = true; $('#aeRunStop').disabled = true; $('#aeRunMsg').textContent = 'Stopping…'; });
  $('#aeSilence').addEventListener('click', e => { const b = e.currentTarget; if (b.classList.contains('soft')) { b.classList.add('say'); clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove('say'), 2200); return; } aeTrimSilence(); });
  document.querySelectorAll('input[name=aeView]').forEach(r => r.addEventListener('change', e => { aeSetView(e.target.value); }));
  $('#aeNormDb').addEventListener('change', e => { const v = clamp(Math.round((+e.target.value) * 10) / 10, -12, 0); if (!Number.isFinite(v) || e.target.value === '') { aeRefresh(); return; } aePush(); AE.d.normPeakDb = v; aeRefresh(); aeLive(); });
  $('#aeNormDb').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } e.stopPropagation(); });
  $('#aeGain').addEventListener('input', e => { AE.clipLatch = false; if (!AE.sliding) { aePush(); AE.sliding = true; } AE.d.gainDb = +e.target.value; aeRefresh(); if (AE.playing && AE.ph) { AE.gT = aeGainAt(AE.d, Math.max(0, AE.d.vStart), Math.min(aeEnd(AE.d), S.audio.duration), AE.pos); AE.ph.post({ gain: AE.gT }); } });
  $('#aeGain').addEventListener('change', () => { AE.sliding = false; });
  $('#aeFadeLen').addEventListener('input', e => { if (!AE.sliding) { aePush(); AE.sliding = true; } aeFadeSet(+e.target.value); aeRefresh(); });
  $('#aeFadeLen').addEventListener('change', () => { AE.sliding = false; });
  $('#aeFull').addEventListener('click', () => aeFs(!AE.full)); $('#aeDock').addEventListener('click', () => aeDockToggle());
  document.querySelectorAll('input[name=aeNormMode]').forEach(r => r.addEventListener('change', e => { const v = e.target.value; aePush(); if (v === 'off') AE.d.normalize = false; else { AE.d.normalize = true; if (v === 'loud' && AE.d.normBy !== 'loud') AE.d.limiter = true; AE.d.normBy = v; } aeRefresh(); aeLimSync(); aeLive(); }));
  $('#aePeakNow').addEventListener('click', () => { AE.hold = 0; if (AE.mLive) aeMeterLive(); });          // like Logic and Cubase: a click on the number resets the peak hold
  $('#aeLimiter').addEventListener('change', e => { aePush(); AE.d.limiter = e.target.checked; aeRefresh(); aeLimSync(); });
  $('#aeLoudPreset').addEventListener('change', e => { const id = e.target.value, p = loudPresets().find(x => x.id === id); aePush(); AE.d.normPreset = id; if (p) AE.d.normLufs = p.lufs; aeRefresh(); aeLive(); });
  $('#aeLoudDb').addEventListener('change', e => { const v = clamp(Math.round((+e.target.value) * 10) / 10, -36, -6); if (!Number.isFinite(v) || e.target.value === '') { aeRefresh(); return; } aePush(); AE.d.normLufs = v; const m = loudPresets().find(x => Math.abs(x.lufs - v) < 0.05); AE.d.normPreset = m ? m.id : 'custom'; aeRefresh(); aeLive(); });
  $('#aeLoudDb').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } e.stopPropagation(); });
  window.addEventListener('resize', () => { if (AE.d && !$('#audioDlg').hidden) { aeFsLayout(); aeSize(); aeDraw(); } });
}
/* full screen for the Audio Editor: the picture fills the screen and everything else floats over it as frosted glass */
function aeFsApply(on) {
  const dlg = $('#audioDlg'); AE.full = on; dlg.classList.toggle('afull', on); { const small = on && window.innerWidth <= 760; dlg.classList.toggle('dock-off', small); $('#aeDock').setAttribute('aria-pressed', !small); } $('#aeDock').classList.toggle('gone', !on);
  $('#aeFull').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); $('#aeFull').title = (on ? 'Exit full screen' : 'Full screen') + ' (F)';
  $('#aeFull').innerHTML = on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
  aeFsLayout(); aeSize(); aeDraw(); aeRailSel(false); aeWiresFollow(); aeAnim();
}
/* full screen is one gesture: the window travels to the other layout's rectangle on one ease and length, moved by transform alone (no layout at each size); the picture goes with it between its two real rectangles (unseen: it fades with the rest). The old parts fade out at once, the other layout takes over near the end (at the same place and size) and its parts fade in as the motion lands, like a video player's controls. The picture is one of the parts: it is never seen stretched or at a size it does not have */
const AE_FS_DIP = 0.45, AE_FS_EASE = EASE_GLIDE, AE_FS_MS = 400, AE_FS_SWAP = 0.17, AE_FS_OUT = 64, AE_FS_IN = 220;          // the hand-over is where the picture is about halfway (the ease is at .5), so it is never stretched far from either size
function aeFsGeo(box, wave) {          // the window's rectangle and the picture's gaps to the window's inner edges
  const r = box.getBoundingClientRect(), w = wave.getBoundingClientRect(), cs = getComputedStyle(box), px = v => parseFloat(v) || 0;
  return { l: r.left, t: r.top, w: r.width, h: r.height, rad: px(cs.borderTopLeftRadius), wl: w.left - r.left - px(cs.borderLeftWidth), wt: w.top - r.top - px(cs.borderTopWidth), wr: r.right - w.right - px(cs.borderRightWidth), wb: r.bottom - w.bottom - px(cs.borderBottomWidth) };
}
function aeFsStop(hold) {          // hold: keep transitions off until the layout that is about to change has been drawn once
  (AE.fsAnims || []).forEach(a => a.cancel()); AE.fsAnims = null; if (AE.fsPulse) { AE.fsPulse.cancel(); AE.fsPulse = null; } const dlg = $('#audioDlg');
  if (hold) requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.remove('fsmove'))); else dlg.classList.remove('fsmove');
}
function aeFsEase(p) {          // AE_FS_EASE as a function of time
  const [x1, y1, x2, y2] = AE_FS_EASE.match(/[\d.]+/g).map(Number), at = (a, b, s) => 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
  let lo = 0, hi = 1; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; at(x1, x2, m) < p ? lo = m : hi = m; } return at(y1, y2, (lo + hi) / 2);
}
function aeFsTarget(dlg, box, wave, on) {          // where the window and picture belong in the other layout, measured without drawing it
  const was = dlg.className, wt = wave.style.top, wb = wave.style.bottom, dock = $('#aeDock'), gone = dock.classList.contains('gone'); dock.classList.toggle('gone', !on);          // the Tools button is part of the full screen bar
  if (on) { dlg.classList.add('afull'); dlg.classList.toggle('dock-off', window.innerWidth <= 760); aeFsLayout(true); aeFsLayout(true); } else { dlg.classList.remove('afull', 'dock-off'); wave.style.top = wave.style.bottom = ''; }
  const g = aeFsGeo(box, wave); dlg.className = was; wave.style.top = wt; wave.style.bottom = wb; dock.classList.toggle('gone', gone); return g;
}
function aeFs(on, instant) {
  const dlg = $('#audioDlg'), box = dlg.querySelector('.dlg'), wave = dlg.querySelector('.ae-wave'); on = !!on; if (!!AE.full === on || AE.fsBusy) return;
  const calm = instant || reducedMotion() || !box.animate || dlg.hidden;
  if (calm) { dlg.classList.add('fsmove'); aeFsApply(on); aeFsStop(true); return; }          // the layout changes at once, with nothing gliding into it
  const D = AE_FS_MS, fade = (full, from, to, o) => [...box.children].filter(el => el !== wave).map(el => el.animate(full && el.matches('.row') ? [{ opacity: 0 }, { opacity: 0 }] : [{ opacity: from }, { opacity: to }], o));          // everything in the window but the picture fades, so the picture is seen travelling with the window and the controls come and go around it (the picture only eases to about half strength at the hand-over, where it is stretched most); in full screen the buttons row lies hidden behind the picture, so it stays hidden
  dlg.classList.add('fsmove');          // nothing else transitions while the window moves, or while the other layout is measured
  const g0 = aeFsGeo(box, wave), g1 = aeFsTarget(dlg, box, wave, on), rect = g => ({ l: g.l + g.wl, t: g.t + g.wt, w: g.w - g.wl - g.wr, h: g.h - g.wt - g.wb }), w0 = rect(g0), w1 = rect(g1), mix = (a, b, p) => a + (b - a) * p;
  const path = (gx, wx, from, to) => {          // the window and the picture each travel between their two rectangles on the shared ease; the picture sits inside the window, so its own transform is the one that, after the window's, lands it on its rectangle. Written against the layout that is in place (gx, wx)
    const boxKF = [], waveKF = [], n = 14;
    for (let i = 0; i <= n; i++) {
      const s = mix(from, to, i / n), p = aeFsEase(s), R = { l: mix(g0.l, g1.l, p), t: mix(g0.t, g1.t, p), w: mix(g0.w, g1.w, p), h: mix(g0.h, g1.h, p) }, W = { l: mix(w0.l, w1.l, p), t: mix(w0.t, w1.t, p), w: mix(w0.w, w1.w, p), h: mix(w0.h, w1.h, p) };
      const sx = R.w / gx.w, sy = R.h / gx.h, kx = W.w / wx.w / sx, ky = W.h / wx.h / sy;
      const rv = mix(g0.rad, g1.rad, p);          // the corner radius as seen, undone for the scaling so it rounds smoothly
      boxKF.push({ offset: i / n, transform: 'translate(' + (R.l - gx.l) + 'px,' + (R.t - gx.t) + 'px) scale(' + sx + ',' + sy + ')', borderRadius: rv / sx + 'px / ' + rv / sy + 'px' });
      waveKF.push({ offset: i / n, transform: 'translate(' + ((W.l - R.l) / sx - (wx.l - gx.l)) + 'px,' + ((W.t - R.t) / sy - (wx.t - gx.t)) + 'px) scale(' + kx + ',' + ky + ')' });
    }
    return [box.animate(boxKF, { duration: D * (to - from), easing: 'linear', fill: 'forwards' }), wave.animate(waveKF, { duration: D * (to - from), easing: 'linear', fill: 'forwards' })];
  };
  AE.fsBusy = true; box.style.transformOrigin = wave.style.transformOrigin = '0 0';
  AE.fsPulse = wave.animate([{ opacity: 1, easing: 'ease-out' }, { opacity: AE_FS_DIP, offset: 0.09, easing: 'ease-in-out' }, { opacity: 1, offset: 0.55 }, { opacity: 1 }], { duration: D });          // the picture is stretched most near the hand-over, so it eases to half strength there and comes back, never to empty
  const first = path(g0, w0, 0, AE_FS_SWAP);
  AE.fsAnims = first.concat(fade(!on, 1, 0, { duration: AE_FS_OUT, easing: 'ease-out', fill: 'forwards' }));
  first[0].onfinish = () => {          // the window is partway: the other layout takes over in the same frame, at the same place and size, and the motion goes on to the end with its parts fading in
    AE.fsAnims.forEach(a => a.cancel()); aeFsApply(on);
    const rest = path(g1, w1, AE_FS_SWAP, 1); AE.fsAnims = rest; AE.fsXform = true; fade(on, 0, 1, { duration: AE_FS_IN, easing: 'ease-out' });          // the window lands while its parts are still coming in
    rest[0].onfinish = () => { AE.fsXform = false; aeFsStop(true); box.style.transformOrigin = wave.style.transformOrigin = ''; AE.fsBusy = false; aeFsLayout(); aeSize(); aeDraw(); aeRailSel(false); aeWiresFollow(); };
  };
}
/* in full screen the picture reaches just under the floating head and just behind the floating bottom, so nothing important hides behind them but the glass still has something to blur */
/* the Wave | Spec switch starts where the tool window's heading starts, so the two line up down the page */
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (typeof aeAlignView === 'function') aeAlignView(); });
function aeAlignView() {
  const sg = $('#aeView'), w = $('#aeWin'); if (!sg || !w || $('#audioDlg').hidden) return; sg.style.marginLeft = '0px';
  if (window.innerWidth <= 760 || !w.offsetWidth || $('#audioDlg').classList.contains('dock-off')) return;          // Wave | Spec starts exactly where the tool window below it starts
  const dl = $('#audioDlg .dlg'), k = dl && dl.offsetWidth ? dl.getBoundingClientRect().width / dl.offsetWidth : 1, dx = (w.getBoundingClientRect().left - sg.getBoundingClientRect().left) / (k || 1); if (dx > 0 && dx < 400) sg.style.marginLeft = Math.round(dx) + 'px';          // measured without the opening zoom
}
function aeFsLayout(force) {          // force: measure for full screen before it is on
  if (AE.fsXform) return;          // the window is moving by transform, so its rectangles are not where it lays out: the last layout is drawn once it has landed
  if (!force) aeAlignView();
  const dlg = $('#audioDlg'), w = dlg.querySelector('.ae-wave'); if (!AE.full && !force) { w.style.top = w.style.bottom = ''; return; }
  const hd = dlg.querySelector('.ed-head'), bar = dlg.querySelector('.ae-bar'), mn = dlg.querySelector('.ae-main'), off = dlg.classList.contains('dock-off'), root = dlg.querySelector('.dlg').getBoundingClientRect();
  const top = hd.getBoundingClientRect().bottom - root.top, bot = root.bottom - (off ? bar.getBoundingClientRect().top : Math.min(bar.getBoundingClientRect().top, mn.getBoundingClientRect().top));
  w.style.top = '0px'; w.style.bottom = Math.max(0, bot - 18 + (off ? 0 : 0)) + 'px';
}
function aeDockToggle(on) {
  const dlg = $('#audioDlg'), bar = dlg.querySelector('.ae-bar'), y0 = bar.getBoundingClientRect().top; on = on == null ? dlg.classList.contains('dock-off') : !!on;
  dlg.classList.toggle('dock-off', !on); $('#aeDock').setAttribute('aria-pressed', on);
  const dy = y0 - bar.getBoundingClientRect().top; if (dy && !reducedMotion() && bar.animate) bar.animate([{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 320, easing: EASE_OUT });
  requestAnimationFrame(aeFsLayout); setTimeout(() => { if (AE.d) { aeFsLayout(); aeRailSel(false); aeWiresFollow(); } }, 400);
}
function aeKey(e) {
  if (e.key === 'Escape' && AE.full && !AE.nsArm) { e.preventDefault(); aeFs(false); return; }
  if ((e.code === 'KeyF' || e.code === 'KeyT') && !e.metaKey && !e.ctrlKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); if (e.code === 'KeyF') aeFs(!AE.full); else if (AE.full) aeDockToggle(); return; }
  if (e.key === 'Escape' && AE.nsArm) { e.preventDefault(); nrArm(false); return; }
  if (e.key === 'Escape') { e.preventDefault(); if (!$('#warnDlg').hidden) return; if (AE.exporting) aeLeave().then(ok => { if (ok) closeAudioEditor(); }); else closeAudioEditor(); return; }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key)) { e.preventDefault(); if (e.key === '0') aeZoomSet(-1e9, 1e9, false); else aeZoomBy(e.key === '-' || e.key === '_' ? 1 / 1.4 : 1.4, AE.pos, false); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) aeRedo(); else aeUndo(); return; }
  if (e.code === 'KeyB' && !e.metaKey && !e.ctrlKey && !e.altKey && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); aeToggleBypass(); return; }
  { const tg = e.target.tagName, typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tg), nav = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (!e.metaKey && !e.ctrlKey && !e.altKey && ((e.key === 'Enter' && !typing && tg !== 'BUTTON' && tg !== 'A') || (nav && !typing))) {          // the same keys as the main window: Enter back to the start, arrows move 1s (Shift 5s)
      e.preventDefault(); const d = AE.d, was = AE.playing; if (was) aeStop();
      aeSeek(e.key === 'Enter' ? Math.max(0, d.vStart) : AE.pos + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); if (was) aePlay(); return;
    } }
  if (e.code === 'Space' && !e.repeat && !['SELECT', 'TEXTAREA'].includes(e.target.tagName) && !(e.target.tagName === 'INPUT' && ['text', 'number'].includes(e.target.type))) { e.preventDefault(); aeToggle(); }
}
window.addEventListener('keyup', e => { if (e.code === 'Space' && !$('#audioDlg').hidden && e.target.tagName === 'BUTTON') e.preventDefault(); }, true);

