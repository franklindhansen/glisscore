'use strict';
/* ====================================================================
   Import / export of settings and page markings
   ==================================================================== */
/* The file is plain text (compact JSON) holding only what is needed to read it back. */
const IO_RANGES = { normLufs: [-36, -6], normPeakDb: [-12, 0], audioFadeLen: [0.1, 3], audioFadeOutLen: [0, 3], flipDur: [0.3, 3], slideDur: [0.1, 3], bend: [0, 100], margin: [0, 10], gutter: [0, 100], divider: [0, 100], turnShadow: [0, 150], turnSoft: [0, 100], scoreAmt: [0, 100], scoreSoft: [0, 100], fadeLen: [0.2, 3], fadeOutLen: [0.2, 3], gainDb: [-12, 12] };
const IO_CHOICES = { pageLayout: ['spread', 'single'], creditsAt: ['start', 'end'], normBy: ['peak', 'loud'], audioFadeShape: ['standard', 'smooth', 'natural', 'slow', 'fast'], ref: ['start', 'middle', 'end'], transition: ['flip', 'slide', 'cut'], slideDir: ['in', 'out'], fadeStyle: ['black', 'score'], fadeShape: ['standard', 'smooth', 'natural'], fadeAutoOut: [null, true, false], aspect: Object.keys(ASPECTS), res: [720, 1080, 1440, 2160], fps: [24, 30, 60], method: ['auto', 'fast', 'realtime'], codec: ['avc', 'hevc'], audioRate: [0, 44100, 48000, 96000], audioFormat: ['wav24', 'wav', 'wav32', 'flac24', 'flac16', 'm4a', 'm4a128', 'm4a192', 'm4a256', 'm4a320'], videoQuality: ['standard', 'high', 'max'], audioKbps: [0, 128, 192, 256, 320], aeView: ['wave', 'spec'] };
const IO_HINTS = {
  all: 'Your settings, the work title, your credits text, and your page markings: page turns, where the video starts and ends, and any pages you left out.',
  settings: 'Only the settings in the side panel. Page markings are not included.',
  markings: 'Only your page markings: page turns, where the video starts and ends, any pages you left out, and whether page 1 starts alone.'
};
const r3 = n => Math.round(n * 1000) / 1000;
/* keeps only values this site understands, so a hand-edited or damaged file can't break anything */
function cleanSettings(src) {
  const out = {};
  Object.keys(DEFAULTS).forEach(k => {
    if (!(k in src)) return;
    const v = src[k], d = DEFAULTS[k];
    if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
    else if (d === null && v === null) out[k] = null;                 // "same as In" for the fade out length
    else if (k === 'normPreset') { if (typeof v === 'string' && /^[a-z0-9]{1,12}$/.test(v)) out[k] = v; }
    else if (/^tag[A-Z]/.test(k)) { if (typeof v === 'string') out[k] = v.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200); }
    else if (CRED_FONT_KEYS.includes(k)) { if (typeof v === 'string' && (v === '' || validFontName(v))) out[k] = v; }
    else if (k === 'bg' || k === 'ink') { if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v.toLowerCase(); }
    else if (IO_CHOICES[k]) { const hit = IO_CHOICES[k].find(c => String(c) === String(v)); if (hit !== undefined) out[k] = hit; }
    else if ((typeof d === 'number' || d === null) && IO_RANGES[k] && Number.isFinite(+v) && v !== null && v !== '') out[k] = clamp(+v, IO_RANGES[k][0], IO_RANGES[k][1]);
  });
  if (src.fx && typeof src.fx === 'object') out.fx = fxNorm(src.fx);
  if (out.codec === 'hevc' && $('#codec option[value="hevc"]').disabled) out.codec = 'avc';
  return out;
}
function buildExport(kind) {
  const o = { glisscore: 1 };
  if (kind !== 'markings') { o.settings = {}; Object.keys(DEFAULTS).forEach(k => { if (k !== 'audioKey') o.settings[k] = S.set[k]; }); }
  if (kind === 'all') {
    const cr = {}; if (S.credits.title.trim()) cr.title = S.credits.title.trim(); if (S.credits.l2.trim()) cr.l2 = S.credits.l2.trim(); if (S.credits.l3.trim()) cr.l3 = S.credits.l3.trim();
    if (Object.keys(cr).length) o.credits = cr;
  }
  if (kind !== 'settings') {
    o.firstAlone = !!S.set.firstAlone;
    if (S.pdf) { const r = recipeOf(); if (recipeIsSimple(r)) { const left = []; r.order.forEach(id => { if (r.slots[id].x) left.push(id); }); if (left.length) o.omit = left; } else o.pages = recipeToList(r); }
    else if (S.pendingPages) o.pages = S.pendingPages;
    else if (S.pendingOmit && S.pendingOmit.size) o.omit = Array.from(S.pendingOmit).sort((a, b) => a - b);
    { const z = S.pdf ? S.pdf.size : S.pendingSize; if (z) { o.resize = { w: z.w, h: z.h }; if (S.pdf ? S.pdf.each : z.each) o.resize.each = true; } }
    { const w = S.pdf ? S.pdf.wm : S.pendingWm ? wmFromJson(S.pendingWm) : null; if (w && w.on) o.watermark = { on: true, text: w.text, angle: w.angle, opacity: w.opacity, mode: w.mode, b: w.b, i: w.i }; }
    if (S.turnsEdited && S.turns.length) o.turns = S.turns.map(r3);
    if (S.vStart !== 0) o.start = r3(S.vStart);
    if (S.vEndSet != null) o.end = r3(S.vEndSet);
    if (S.set.creditsEarly && S.creditsEnd != null) o.creditsEnd = r3(S.creditsEnd);
  }
  return JSON.stringify(o);
}
function ioKind() { const r = document.querySelector('input[name=ioKind]:checked'); return r ? r.value : 'all'; }
function ioMessage(text, bad) { const m = $('#ioMsg'); swapText(m, text || ''); m.classList.toggle('err', !!bad); }
function openIO() { ioMessage(''); $('#ioKindHint').textContent = IO_HINTS[ioKind()]; sheetShow($('#ioDlg')); $('#ioExport').focus(); }
function closeIO() { sheetHide($('#ioDlg')); }
async function exportSettings() {
  const kind = ioKind(), text = buildExport(kind) + '\n';
  const label = kind === 'settings' ? 'settings' : kind === 'markings' ? 'page markings' : 'settings and page markings';
  const name = ((S.credits.title.trim() || (S.pdf && S.pdf.name) || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled') + ' - glisscore ' + label + '.txt';
  try { await saveFile(new Blob([text], { type: 'text/plain' }), name); closeIO(); toast(tx('app.exported', { what: label })); }
  catch (e) { ioMessage('The file could not be saved: ' + ((e && e.message) || 'unknown error'), true); }
}
async function importSettings(file) {
  let data = null;
  try { data = JSON.parse(await file.text()); } catch (e) { /* handled below */ }
  const bad = 'That file could not be read. Choose a file that was exported from here.';
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.glisscore !== 1) { ioMessage(bad, true); return; }
  const clean = data.settings && typeof data.settings === 'object' ? cleanSettings(data.settings) : null;
  const marks = 'firstAlone' in data;
  if (!clean && !marks) { ioMessage(bad, true); return; }
  Transport.pause();
  const was = JSON.stringify(snap()), redoWas = S.redo; pushHistory();
  if (data.credits && typeof data.credits === 'object') { const cr = data.credits, s = (v, n) => typeof v === 'string' ? v.slice(0, n) : ''; S.credits = { title: s(cr.title, 120), l2: s(cr.l2, 160), l3: s(cr.l3, 120), titleEdited: !!s(cr.title, 1) }; }
  else if (clean && marks) S.credits = { title: '', l2: '', l3: '', titleEdited: false };         // an "Everything" file with no credits means none
  const oldRef = S.set.ref;
  if (clean) { Object.assign(S.set, clean); S.set.audioKey = ''; }          // settings brought in from a file apply to whichever recording is loaded next
  if (marks && typeof data.firstAlone === 'boolean') S.set.firstAlone = data.firstAlone;
  saveSettings(); if (S.audio) fxGet(S.set.fx).then(() => { stageDirty = true; }, () => {});
  if (!marks && S.turns.length && S.set.ref !== oldRef) { const d = refOffset() - refOffset(oldRef); S.turns = S.turns.map(t => t + d); }   // same as changing the handle reference by hand
  syncControls(); layoutStage();
  let adopted = null;
  if (marks) {
    const omit = new Set(Array.isArray(data.omit) ? data.omit.filter(Number.isInteger) : []);
    const list = Array.isArray(data.pages) ? data.pages.filter(e => e && typeof e === 'object').map(e => ({ p: e.p, r: e.r, x: e.x, c: e.c, n: e.n })) : null;
    const wmIn = data.watermark && typeof data.watermark === 'object' ? data.watermark : null;
    const rzIn = data.resize && data.resize.w >= 2 && data.resize.w <= 60 && data.resize.h >= 2 && data.resize.h <= 60 ? { w: +data.resize.w, h: +data.resize.h, each: !!data.resize.each } : null;
    if (S.pdf) { const r = list && recipeFromList(list, S.pdf.n, wmIn); if (r) setRecipe(r); else { setOmit(omit); if (wmIn) { const q = recipeOf(); q.wm = wmFromJson(wmIn); setRecipe(q); } } if (rzIn) { const q = recipeOf(); q.size = { w: rzIn.w, h: rzIn.h }; q.each = rzIn.each; setRecipe(q); } }
    else { S.pendingPages = list && list.length ? list : null; S.pendingWm = wmIn; S.pendingSize = rzIn; S.pendingOmit = !S.pendingPages && omit.size ? omit : null; }
    S.vStart = Number.isFinite(data.start) ? data.start : 0; S.vEndSet = Number.isFinite(data.end) ? data.end : null;
    if (vEnd() - S.vStart < 1) { S.vStart = 0; S.vEndSet = null; }
    S.creditsEnd = Number.isFinite(data.creditsEnd) ? data.creditsEnd : null;
  }
  if (S.pdf && (marks || clean)) { S.time = S.vStart; rebuildSpreads(false, true); }
  syncCredits();
  if (marks) {
    const turns = Array.isArray(data.turns) ? data.turns.filter(Number.isFinite).sort((a, b) => a - b) : [];
    if (turns.length) { if (S.spreads.length >= 2) adopted = adoptPriorTurns({ turns, edited: true, ph: [] }, true); else if (!S.pdf) S.savedTurns = { turns, edited: true, ph: [] }; }
    else if (S.spreads.length) autoSpace(false);
  }
  normalizeTurns(); ensureCreditsEnd(); onTurnsChanged(); onTrimChanged(); updateButtons(); setChips(); TL.staticDirty = true; stageDirty = true;
  let msg = tx(clean && marks ? 'app.imp.both' : marks ? 'app.imp.marks' : 'app.imp.settings');
  if (adopted && adopted.added) msg += ' ' + tx(adopted.added === 1 ? 'app.imp.added.one' : 'app.imp.added.many', { n: adopted.added });
  if (adopted && adopted.dropped) msg += ' ' + tx(adopted.dropped === 1 ? 'app.imp.dropped.one' : 'app.imp.dropped.many', { n: adopted.dropped });
  if (JSON.stringify(snap()) === was) { S.history.pop(); S.redo = redoWas; updateHistoryButtons(); }          // nothing changed: no step, and Redo stays
  closeIO(); toast(msg, adopted && (adopted.added || adopted.dropped) ? 8000 : 4200);
}
function initImportExport() {
  document.querySelectorAll('input[name=ioKind]').forEach(r => r.addEventListener('change', () => { swapText($('#ioKindHint'), IO_HINTS[ioKind()]); }));
  $('#ioClose').addEventListener('click', closeIO);
  $('#ioExport').addEventListener('click', exportSettings);
  $('#ioImport').addEventListener('click', () => $('#settingsIn').click());
  $('#settingsIn').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importSettings(f); });
}

/* ---------- export warning ---------- */
function askWarn(title, msg, yesLabel, noLabel = 'Go back') {
  return new Promise(res => {
    $('#warnTitle').textContent = title; $('#warnMsg').textContent = msg; $('#warnYes').textContent = yesLabel; $('#warnNo').textContent = noLabel;
    sheetShow($('#warnDlg')); $('#warnNo').focus();
    const done = v => { sheetHide($('#warnDlg')); $('#warnYes').onclick = $('#warnNo').onclick = null; res(v); };
    $('#warnYes').onclick = () => done(true); $('#warnNo').onclick = () => done(false);
  });
}
async function onExportClick() {
  if (!S.audio && !await askWarn('No audio loaded', 'There is no audio, so the video will be silent. Add audio first, or export a silent video.', 'Export silent video')) return;
  if (S.set.creditsOn === true && !creditsHasText()) {             // credits with no words would silently leave them out of the video
    const off = await askWarn('Credits are enabled but empty', 'Add a title, line of text, or turn credits off. Without any text, no credits will appear in the video.', 'Turn off credits and export');
    if (!off) return;
    S.set.creditsOn = false; $('#creditsOn').checked = false; applyGroupSwitches(); syncCredits(); saveSettings();
  }
  const left = S.ph.filter(Boolean).length;
  if (left) {
    const ok = await askWarn("Some page turns aren't placed yet", left + (left === 1 ? ' page turn is' : ' page turns are') + ' still a placeholder (dashed handle) and will be exported where ' + (left === 1 ? 'it' : 'they') + ' currently sit. Go back to place ' + (left === 1 ? 'it' : 'them') + ', or export anyway.', 'Export anyway');
    if (!ok) return;
  }
  startExport();
}

/* ---------- settings menu ---------- */
function restoreDefaults() {
  const was = JSON.stringify(snap()), redoWas = S.redo; pushHistory();
  const oldOff = refOffset(), oldFirst = S.set.firstAlone, oldLayout = S.set.pageLayout;
  S.set = Object.assign({}, DEFAULTS, { fx: fxClone(FX_DEFAULT) }); saveSettings();
  const nOff = refOffset();
  if (S.turns.length) { S.turns = S.turns.map(t => t - oldOff + nOff); normalizeTurns(); }
  syncControls(); layoutStage(); stageDirty = true; TL.staticDirty = true;
  if (S.pdf && (oldFirst !== S.set.firstAlone || oldLayout !== S.set.pageLayout)) { S.time = S.vStart; rebuildSpreads(false, true); }
  syncCredits(); onTrimChanged();
  onTurnsChanged();
  if (JSON.stringify(snap()) === was) { S.history.pop(); S.redo = redoWas; updateHistoryButtons(); }          // nothing changed: no step, and Redo stays
  toast(tx('app.reset'));
}
const DEEP_DIALOGS = { '/about': '#aboutDlg', '/how-it-works': '#howDlg', '/support': '#aboutDlg' };
/* closing a dialog that a link opened (see initMenu) also takes the address back to the app's own */
function dlgClose(el) { sheetHide(el); if (DEEP_DIALOGS[location.pathname.replace(/\/+$/, '')]) history.replaceState(null, '', '/' + location.search); }
function initMenu() {
  const btn = $('#btnSettings'), menu = $('#settingsMenu'), reset = $('#menuReset'); let timer = 0;
  const disarm = () => { clearTimeout(timer); reset.classList.remove('confirm'); reset.textContent = 'Restore default settings'; };
  const fading = () => !!menu._a;
  const settle = () => { if (menu._a) { menu._a.cancel(); menu._a = null; } menu.style.pointerEvents = ''; };
  const close = () => {
    btn.setAttribute('aria-expanded', 'false'); disarm();
    if (menu.hidden || fading()) return;
    if (reducedMotion() || !menu.animate) { menu.hidden = true; return; }
    menu.style.pointerEvents = 'none';          // the fade is 120ms and carries no movement; a click in that time reaches what is behind it
    const a = menu._a = menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'cubic-bezier(.22,1,.36,1)' });
    a.onfinish = () => { if (menu._a === a) { menu._a = null; menu.hidden = true; menu.style.pointerEvents = ''; } };
  };
  btn.addEventListener('click', e => { e.stopPropagation(); const open = menu.hidden || fading(); if (!open) { close(); return; } settle(); menu.hidden = false; const wr = menu.offsetParent.getBoundingClientRect(), br = btn.getBoundingClientRect(); menu.style.transformOrigin = (br.left + br.width / 2 - wr.left - menu.offsetLeft) + 'px ' + (br.top + br.height / 2 - wr.top - menu.offsetTop) + 'px'; btn.setAttribute('aria-expanded', 'true'); disarm(); $('#menuAbout').focus(); });          // the menu grows from the center of its button (offsets, not rects: the open animation is already scaling the box)
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  $('#menuIO').addEventListener('click', () => { close(); openIO(); });
  const keys = $('#menuKeys'), list = $('#keysList'), mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  list.querySelectorAll('[data-mod]').forEach(k => { k.textContent = mac ? '⌘' : 'Ctrl'; });
  list.querySelectorAll('[data-alt]').forEach(k => { k.textContent = mac ? 'Option' : 'Alt'; });
  keys.addEventListener('click', e => { e.stopPropagation(); close(); sheetShow($('#keysDlg')); $('#keysClose').focus(); });
  $('#keysClose').addEventListener('click', () => sheetHide($('#keysDlg')));
  $('#menuHow').addEventListener('click', e => { e.stopPropagation(); close(); sheetShow($('#howDlg')); $('#howClose').focus(); });
  $('#howClose').addEventListener('click', () => dlgClose($('#howDlg')));
  // the dropdowns glide open and shut: the box grows from its own height, so a click mid-glide turns around from where it is
  $('#howDlg').addEventListener('click', e => {
    const sum = e.target.closest('.how-d > summary'); if (!sum) return;
    const d = sum.parentNode, body = d.querySelector('.how-in'); if (!body.animate || reducedMotion()) return;
    e.preventDefault();
    const now = body.getBoundingClientRect().height, cs = getComputedStyle(body), opening = !d.open || d.dataset.closing === '1';
    if (body._glide) body._glide.cancel();
    if (opening) { d.open = true; d.dataset.closing = ''; }
    else d.dataset.closing = '1';
    const full = body.scrollHeight + (parseFloat(cs.borderTopWidth) || 0), from = opening && now > 0 && body._glide ? now : opening ? 0 : now, to = opening ? full : 0;
    const k = h => ({ height: h + 'px', paddingTop: h ? cs.paddingTop : '0px', paddingBottom: h ? cs.paddingBottom : '0px', opacity: h ? 1 : 0 });
    body.style.overflow = 'hidden';
    const a = body._glide = body.animate([k(from), k(to)], { duration: 450, easing: EASE_OUT });
    a.onfinish = () => { body._glide = null; body.style.overflow = ''; if (!opening) { d.open = false; d.dataset.closing = ''; } };
    a.oncancel = () => { body.style.overflow = ''; };
  });
  $('#menuAbout').addEventListener('click', e => { e.stopPropagation(); close(); sheetShow($('#aboutDlg')); $('#aboutClose').focus(); });
  /* the number comes from the VERSION.txt file, the one place it is written, read once at the start so About never grows when it opens; if it cannot be read the line stays hidden */
  function aboutVersion() { fetch('VERSION.txt', { cache: 'no-cache' }).then(r => r.ok ? r.text() : '').then(t => { t = t.trim(); const el = $('#aboutVersion'); el.textContent = /^\d+\.\d+\.\d+$/.test(t) ? 'Version ' + t : ''; el.hidden = !el.textContent; }).catch(() => {}); }
  aboutVersion();
  $('#aboutClose').addEventListener('click', () => dlgClose($('#aboutDlg')));
  $('#aboutDlg').addEventListener('click', e => { if (e.target === $('#aboutDlg')) dlgClose($('#aboutDlg')); });
  $('#howDlg').addEventListener('click', e => { if (e.target === $('#howDlg')) dlgClose($('#howDlg')); });
  $('#keysDlg').addEventListener('click', e => { if (e.target === $('#keysDlg')) sheetHide($('#keysDlg')); });
  /* the site answers /about, /how-it-works and /support with this page (the _redirects file): the matching dialog opens over the app, and closing it takes the address back to / */
  const deep = DEEP_DIALOGS[location.pathname.replace(/\/+$/, '')];
  if (deep) { sheetShow($(deep)); $(deep + ' .btn.primary').focus(); }
  reset.addEventListener('click', () => {
    if (!reset.classList.contains('confirm')) { reset.classList.add('confirm'); reset.textContent = 'Click again to restore'; timer = setTimeout(disarm, 4000); return; }
    close(); restoreDefaults();
  });
}

/* ---------- full screen (controls and timeline fade when the mouse is still) ---------- */
const FS = { on: false, native: false, timer: 0, hover: false };
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
function wakeFs() {
  if (!FS.on) return;
  const app = document.querySelector('.app'); app.classList.add('fs-active');
  clearTimeout(FS.timer);
  FS.timer = setTimeout(() => { if (FS.hover || TL.drag || expOpen()) { wakeFs(); return; } app.classList.remove('fs-active'); }, 2500);
}
/* full screen is one glide: the picture and its frame travel between the two layouts' rectangles by transform alone (the new layout is in place from the first frame, so nothing is laid out as it moves), the old header and settings leave as a fading ghost, and the controls rise in as the picture lands. Same ease as the Audio Editor's full screen (aeFsEase) */
const FS_MS = 380;
function fsGhosts() {          // the header, the settings, the bar, and the timeline, copied where they were (the timeline's drawing too), so they can fade out after the layout has already changed
  const app = document.querySelector('.app');
  return ['.top', '.panel', '.transport', '.timeline'].map(sel => {
    const el = document.querySelector(sel), r = el && el.getBoundingClientRect(), cs = el && getComputedStyle(el); if (!r || r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || +cs.opacity < 0.02) return null;
    const g = document.createElement('div'), c = el.cloneNode(true);          // the copy sits in a stand-in for the app, so the rules that dress it in this layout (the glass bar in full screen) still apply
    c.removeAttribute('id'); c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    const from = el.querySelectorAll('canvas'); c.querySelectorAll('canvas').forEach((cv, k) => { const f = from[k]; if (!f) return; cv.width = f.width; cv.height = f.height; cv.getContext('2d').drawImage(f, 0, 0); });
    c.style.cssText = 'position:absolute;margin:0;inset:auto;left:0;top:0;transform:none;width:' + r.width + 'px;height:' + r.height + 'px;opacity:' + cs.opacity;
    g.className = app.className + ' fs-ghost'; g.inert = true; g.setAttribute('aria-hidden', 'true'); g.appendChild(c);
    g.style.cssText = 'position:fixed;inset:auto;margin:0;padding:0;border:0;background:transparent;display:block;z-index:95;pointer-events:none;overflow:hidden;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
    document.body.appendChild(g); return g;
  }).filter(Boolean);
}
function fsGlideStop() { (FS.anims || []).forEach(a => a.cancel()); FS.anims = null; document.querySelectorAll('.fs-ghost').forEach(g => g.remove()); fsGliding = false; }
function fsGlide(on, from) {          // from: where the picture and its frame were, the page's chrome as ghosts, and the colors they had
  const app = document.querySelector('.app'), wrap = $('#stageWrap'), cv = stageCanvas, mix = (a, b, p) => a + (b - a) * p;
  layoutStage(); try { drawStage(); } catch (e) {} stageDirty = false;          // the picture is made for the layout it is moving into, so it only has to travel
  const c1 = cv.getBoundingClientRect(), w1 = wrap.getBoundingClientRect(), c0 = from.c, w0 = from.w;
  if (c1.width < 2 || w1.width < 2 || c0.width < 2 || w0.width < 2) { from.ghosts.forEach(g => g.remove()); return; }
  const wcs = getComputedStyle(wrap), r1 = parseFloat(wcs.borderTopLeftRadius) || 0, bg1 = wcs.backgroundColor, n = 12, wk = [], ck = [];
  for (let i = 0; i <= n; i++) {          // the frame and the picture each go from their old rectangle to their new one; the picture sits inside the frame, so its own transform is the one that, after the frame's, lands it
    const p = aeFsEase(i / n), W = { l: mix(w0.left, w1.left, p), t: mix(w0.top, w1.top, p), w: mix(w0.width, w1.width, p), h: mix(w0.height, w1.height, p) }, C = { l: mix(c0.left, c1.left, p), t: mix(c0.top, c1.top, p), w: mix(c0.width, c1.width, p), h: mix(c0.height, c1.height, p) };
    const sx = W.w / w1.width, sy = W.h / w1.height, rad = mix(from.rad, r1, p);
    wk.push({ offset: i / n, transform: 'translate(' + (W.l - w1.left) + 'px,' + (W.t - w1.top) + 'px) scale(' + sx + ',' + sy + ')', borderRadius: rad / sx + 'px / ' + rad / sy + 'px' });
    ck.push({ offset: i / n, transform: 'translate(' + ((C.l - W.l) / sx - (c1.left - w1.left)) + 'px,' + ((C.t - W.t) / sy - (c1.top - w1.top)) + 'px) scale(' + C.w / c1.width / sx + ',' + C.h / c1.height / sy + ')' });
  }
  wk[0].backgroundColor = from.bg; wk[n].backgroundColor = bg1;
  const o = { duration: FS_MS, easing: 'linear' }, bgTo = getComputedStyle(document.body).backgroundColor, rise = el => el && el.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 140, easing: EASE_OUT, fill: 'backwards' });
  fsGliding = true; wrap.style.transformOrigin = cv.style.transformOrigin = '0 0';
  const anims = [wrap.animate(wk, o), cv.animate(ck, o), app.animate([{ backgroundColor: on ? bgTo : '#000' }, { backgroundColor: on ? '#000' : bgTo }], { duration: on ? FS_MS : 200, easing: 'ease-out' })];
  if (on) { anims.push(rise(app.querySelector('.transport')), rise(app.querySelector('.timeline'))); }          // the controls come up from the bottom as the picture lands
  else ['.top', '.panel', '.transport', '.timeline'].forEach(s => { const el = app.querySelector(s) || document.querySelector(s); if (el) anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 40, easing: EASE_OUT, fill: 'backwards' })); });
  from.ghosts.forEach(g => anims.push(g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' })));
  const live = FS.anims = anims.filter(Boolean);
  const end = () => { if (FS.anims !== live) return; fsGlideStop(); wrap.style.transformOrigin = cv.style.transformOrigin = ''; layoutStage(); layoutTimeline(); stageDirty = true; TL.staticDirty = true; };
  anims[0].onfinish = end;
}
function setFull(on) {
  const app0 = document.querySelector('.app'), glide = !!S.pdf && FS.on !== on && !reducedMotion() && !!stageCanvas.animate, wrap0 = $('#stageWrap');
  fsGlideStop(); wrap0.style.transformOrigin = stageCanvas.style.transformOrigin = ''; if (SZ.z !== 1) szReset(false);          // the picture starts at Fit in either layout
  const from = glide ? { c: stageCanvas.getBoundingClientRect(), w: wrap0.getBoundingClientRect(), rad: parseFloat(getComputedStyle(wrap0).borderTopLeftRadius) || 0, bg: getComputedStyle(wrap0).backgroundColor, ghosts: fsGhosts() } : null;
  FS.on = on; TL.glass = on; const app = document.querySelector('.app');
  $('#btnFull').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen'); $('#btnFull').title = on ? 'Exit full screen (F)' : 'Full screen (F)';
  app.classList.toggle('fs', on); document.documentElement.classList.toggle('fs-lock', on); if (!on) app.classList.remove('fs-min');
  if (on) wakeFs(); else { clearTimeout(FS.timer); app.classList.remove('fs-active'); FS.hover = false; }
  if (from) { fsGlide(on, from); layoutTimeline(); TL.staticDirty = true; } else
  requestAnimationFrame(() => { layoutStage(); layoutTimeline(); stageDirty = true; TL.staticDirty = true; });
  if (!on) requestAnimationFrame(() => {        // browsers can keep showing stale (grayed) controls after full screen: force one clean repaint
    const pn = document.querySelector('.panel'); if (!pn) return;
    pn.style.visibility = 'hidden'; void pn.offsetHeight; pn.style.visibility = ''; paintRanges();
  });
}
async function enterFull() {
  if (!S.pdf || FS.on) return;
  const app = document.querySelector('.app'); FS.native = false;
  try {
    if (app.requestFullscreen) { await app.requestFullscreen(); FS.native = true; }
    else if (app.webkitRequestFullscreen) { app.webkitRequestFullscreen(); FS.native = true; }
  } catch (e) { dbg('Native full screen unavailable (' + ((e && e.message) || e) + '); using full-window mode instead'); }
  setFull(true);
}
async function exitFull() {
  if (fsEl()) { try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {} }
  setFull(false);
}
const toggleFull = () => FS.on ? exitFull() : enterFull();

let glowTimer = 0;
function setGlow(kind) {
  clearTimeout(glowTimer);
  const f = $('#turnField'); f.classList.toggle('glow-ring', kind === 'turn');
  TL.glow = (kind === 'ruler' || kind === 'playhead') ? kind : null; TL.overlayDirty = true;
  if (kind === 'turn') {
    const r = f.getBoundingClientRect(), pr = $('.panel').getBoundingClientRect();
    if (r.height && (r.top < pr.top || r.bottom > pr.bottom)) f.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}
function setEditorHidden(h) {
  document.querySelector('.app').classList.toggle('fs-min', h); wakeFs();
  requestAnimationFrame(() => { layoutTimeline(); TL.staticDirty = true; stageDirty = true; });
}
function initUiExtras() {
  initMenu();
  $('#btnHideEditor').addEventListener('click', () => setEditorHidden(true));
  $('#btnShowEditor').addEventListener('click', () => setEditorHidden(false));
  document.querySelectorAll('.info-i').forEach(b => { b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="ring" cx="12" cy="12" r="10"/><path class="stem" d="M12 16v-4"/><path class="dot" d="M12 8h.01"/></svg>'; });
  document.querySelectorAll('.info-i').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation(); const tip = btn.nextElementSibling, open = !tip.classList.contains('open');
    tip.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
  }));
  document.addEventListener('click', () => document.querySelectorAll('.tip.open, .hint.open').forEach(t => { t.classList.remove('open'); t.previousElementSibling.setAttribute('aria-expanded', 'false'); }));
  const hint = $('#tlHint');
  hint.addEventListener('mouseover', e => { const t = e.target.closest('.term'); if (t) setGlow(t.dataset.glow); });
  hint.addEventListener('mouseout', e => { if (e.target.closest('.term')) setGlow(null); });
  hint.addEventListener('focusin', e => { const t = e.target.closest('.term'); if (t) setGlow(t.dataset.glow); });
  hint.addEventListener('focusout', e => { if (e.target.closest('.term')) setGlow(null); });
  hint.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; const t = e.target.closest('.term'); if (t) { setGlow(t.dataset.glow); glowTimer = setTimeout(() => setGlow(null), 2400); } });
  $('#btnAudioStop').addEventListener('click', () => { loadSeq++; setBusy(''); toast(tx('app.stopped')); });          // the card has no loading chip above it, so it carries its own way to stop
  $('#chips').addEventListener('click', e => { if (e.target.closest('[data-pages]')) { openPdfEditor(); return; } if (e.target.closest('[data-audio]')) { openAudioEditor(); return; } const cn = e.target.closest('[data-cancel]'); if (cn) { if (cn.dataset.cancel === 'pdf') loadToken++; else loadSeq++; setBusy(''); toast(tx('app.stopped')); return; } const b = e.target.closest('[data-remove]'); if (!b) return; if (b.dataset.remove === 'pdf') removePdf(); else removeAudio(); });          // the X works while a file is still loading too
  $('#btnFull').addEventListener('click', toggleFull); szBind(); szApply(false);
  $('#btnExitFull').addEventListener('click', exitFull);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => { if (FS.on && FS.native && !fsEl()) setFull(false); }));
  ['mousemove', 'pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, wakeFs));
  document.addEventListener('touchstart', wakeFs, { passive: true });
  ['.transport', '.timeline', '#stageStrip'].forEach(sel => { const el = document.querySelector(sel); el.addEventListener('mouseenter', () => { FS.hover = true; wakeFs(); }); el.addEventListener('mouseleave', () => { FS.hover = false; wakeFs(); }); });
  updateHint(); updateHistoryButtons();
}

function boot() {
  syncControls(); bindSettings(); readColors();
  try { previewR = new Renderer(stageCanvas, PageSource, { cap: 14 }); }
  catch (e) { toast(e.message, 8000); console.error(e); return; }
  previewR.onUpdate = () => { stageDirty = true; };
  layoutStage(); layoutTimeline(); updateButtons(); updateTimeUI(true); setChips();
  /* A resize wipes the timeline's canvas, so it is painted again in the same frame, before the browser shows it (a redraw left for the next frame showed one blank frame, a flash). */
  new ResizeObserver(() => { layoutStage(); layoutTimeline(); drawTimeline(); }).observe($('#stageWrap'));
  new ResizeObserver(() => document.querySelector('.app').style.setProperty('--fs-trh', $('#transport').offsetHeight + 'px')).observe($('#transport'));          // full screen: the zoom strip rides above the play bar
  new ResizeObserver(() => { const sc = TL.scroller; if (Math.max(200, sc.clientWidth) === TL.vw && Math.max(150, sc.clientHeight) === TL.h) return; layoutTimeline(); drawTimeline(); }).observe(TL.scroller);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  $('#zoom').value = zoomToSlider(S.pxPerSec); paintRanges();

  ['#btnPdf', '#btnPdf2'].forEach(s => $(s).addEventListener('click', () => $('#pdfIn').click()));
  ['#btnAudio', '#btnAudio3'].forEach(s => $(s).addEventListener('click', () => $('#audioIn').click()));
  $('#btnAudio2').addEventListener('click', () => { if (S.audio) openAudioEditor(); else $('#audioIn').click(); });
  $('#scScore').addEventListener('click', e => { if (!e.target.closest('button')) $('#pdfIn').click(); });
  $('#scAudio').addEventListener('click', e => { if (!e.target.closest('button')) $('#btnAudio2').click(); });
  $('#pdfIn').addEventListener('change', e => { if (e.target.files[0]) loadPdf(e.target.files[0]); e.target.value = ''; });
  $('#audioIn').addEventListener('change', e => { if (e.target.files[0]) loadAudio(e.target.files[0]); e.target.value = ''; });
  $('#bPlay').addEventListener('click', () => Transport.toggle());
  $('#bStart').addEventListener('click', () => { Transport.seek(S.vStart); TL.scroller.scrollLeft = 0; });
  $('#bTap').addEventListener('click', tapTurn);
  $('#bUndo').addEventListener('click', undo);
  $('#bRedo').addEventListener('click', redo);
  $('#bSpace').addEventListener('click', () => { const was = S.turns.map((_, i) => shownTurn(i)); autoSpace(true); glideFrom(was); toast(tx('app.spaced')); });
  $('#bToEnd').addEventListener('click', turnsToEnd);
  $('#bFit').addEventListener('click', zoomFit);
  $('#zoom').addEventListener('input', e => setZoom(sliderToZoom(+e.target.value), TL.vw / 2));
  $('#btnExport').addEventListener('click', () => onExportClick());
  $('#btnThumb').addEventListener('click', saveThumbnail);
  $('#expCancel').addEventListener('click', cancelExport);
  $('#expLogBtn').addEventListener('click', () => setDiagOpen(true));
  $('#expRetry').addEventListener('click', () => {
    cancelExport(); dbg('Retrying with real-time recording (this export only; your Export method setting is unchanged)');
    setTimeout(() => startExport({ forceRealtime: true }), 250);
  });
  initUiExtras(); peBind(); initImportExport();
  $('#diagClose').addEventListener('click', () => setDiagOpen(false));
  $('#diagTest').addEventListener('click', runSelfTest);
  $('#diagClear').addEventListener('click', () => { LOG.lines.length = 0; refreshLog(); });
  $('#diagCopy').addEventListener('click', async () => {
    const txt = LOG.lines.join('\n');
    try { await navigator.clipboard.writeText(txt); toast(tx('app.logcopied')); }
    catch (e) { const t = $('#diagLog'); t.focus(); t.select(); try { document.execCommand('copy'); toast(tx('app.logcopied')); } catch (e2) { toast(tx('app.logmanual')); } }
  });
  $('#expClose').addEventListener('click', () => setExpOpen(false));
  $('#expSave').addEventListener('click', async () => {
    if (!EXP.blob) return;
    try { const r = await saveFile(EXP.blob, EXP.name); if (r) toast(tx('app.saved')); }
    catch (e) { toast(tx('app.savefail', { why: (e && e.message) || 'unknown error' }), 6000); }
  });

  // drag & drop anywhere
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { dragDepth++; document.body.classList.add('dragging'); e.preventDefault(); } });
  window.addEventListener('dragover', e => { e.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); handleFiles(e.dataTransfer.files); });

  /* Command/Ctrl with + or - zooms the timeline instead of the whole page (0 fits it). Pinch and Ctrl+scroll do the same. */
  const zoomAnchor = () => { const x = t2x(S.time); return x >= 0 && x <= TL.vw ? x : TL.vw / 2; };
  let zoomAnim = 0;
  function zoomTo(target, anchorX) {
    target = clamp(target, 1, 400); cancelAnimationFrame(zoomAnim);
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { setZoom(target, anchorX); return; }
    const from = S.pxPerSec, t0 = performance.now(), D = 240;
    (function step(now) { const k = clamp((now - t0) / D, 0, 1), e = 1 - Math.pow(1 - k, 3); setZoom(Math.exp(Math.log(from) + (Math.log(target) - Math.log(from)) * e), anchorX); if (k < 1) zoomAnim = requestAnimationFrame(step); })(t0);
  }
  window.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key)) {
      e.preventDefault(); if (!S.pdf || expOpen() || editorOpen()) return;
      if (e.key === '0') { cancelAnimationFrame(zoomAnim); zoomFit(); } else zoomTo(S.pxPerSec * (e.key === '-' || e.key === '_' ? 1 / 1.4 : 1.4), zoomAnchor());
      return;
    }
  }, true);
  window.addEventListener('wheel', e => { if (e.ctrlKey && !e.target.closest('.tl-scroll')) { e.preventDefault(); if (S.pdf && !editorOpen()) setZoom(S.pxPerSec * Math.exp(-e.deltaY * 0.01), zoomAnchor()); } }, { passive: false });
  let gScale = 1;
  window.addEventListener('gesturestart', e => { e.preventDefault(); gScale = 1; });
  window.addEventListener('gesturechange', e => { e.preventDefault(); if (S.pdf && !editorOpen()) setZoom(S.pxPerSec * (e.scale / gScale), zoomAnchor()); gScale = e.scale; });
  window.addEventListener('keydown', e => {
    const tg = e.target, tag = tg.tagName, type = tg.type;
    if (!$('#aeExpDlg').hidden) { if (e.key === 'Escape') { e.preventDefault(); if ($('#aePgWrap').classList.contains('meta')) aePage(false); else aeExpClose(); } return; }
    if ((e.code === 'Space' || e.key === 'Enter') && tg.closest && tg.closest('.fold-btn')) return;        // a focused heading button keeps its own Space and Enter
    if (tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && (type === 'text' || type === 'color'))) return;
    if (!$('#howDlg').hidden) { if (e.key === 'Escape') dlgClose($('#howDlg')); return; }
    if (!$('#aboutDlg').hidden) { if (e.key === 'Escape') dlgClose($('#aboutDlg')); return; }
    if (!$('#keysDlg').hidden) { if (e.key === 'Escape') sheetHide($('#keysDlg')); return; }
    if (!$('#ioDlg').hidden) { if (e.key === 'Escape') closeIO(); return; }
    if (!$('#audioDlg').hidden) { if (AE.d) aeKey(e); return; }
    if (!$('#pdfDlg').hidden) { if (PE.d) peKey(e); return; }
    if (!$('#diagDlg').hidden) { if (e.key === 'Escape') setDiagOpen(false); return; }
    if (expOpen()) { if (e.key === 'Escape' && !$('#expCancel').hidden) cancelExport(); return; }
    if (!S.pdf) return;                                  // nothing to play, tap or move yet
    if (!e.ctrlKey && !e.metaKey && !e.altKey && ['+', '=', '-', '_', '0'].includes(e.key) && !(tg.closest && tg.closest('input, select, textarea'))) { e.preventDefault(); if (e.key === '0') szReset(true); else szAt(SZ.z * (e.key === '-' || e.key === '_' ? 1 / 1.6 : 1.6), null, null, true); return; }
    if (e.code === 'Space') { e.preventDefault(); Transport.toggle(); }
    else if (e.key === 't' || e.key === 'T') { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); tapTurn(); } }
    else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && S.pdf) { e.preventDefault(); toggleFull(); }
    else if (e.key === 'Escape' && FS.on && !FS.native) exitFull();
    else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== 'BUTTON' && tag !== 'A')) { e.preventDefault(); Transport.seek(S.vStart); TL.scroller.scrollLeft = 0; }   // Enter works like Return in Logic Pro: back to the start
    else if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); jumpMarker(e.key === 'ArrowLeft' ? -1 : 1); }   // Option or Alt with the arrows: to the previous or next marker
    else if (e.key === 'ArrowLeft') { e.preventDefault(); Transport.seek(Transport.now() - (e.shiftKey ? 5 : 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); Transport.seek(Transport.now() + (e.shiftKey ? 5 : 1)); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  });

  (function tick() {
    requestAnimationFrame(tick);
    if (Transport.playing) {
      const t = Transport.now();
      if (t >= vEnd()) { Transport.pause(); S.time = vEnd(); }
      else S.time = t;
      if (Transport.dh) { const v = soundFadeAt(t) * audioGain(); if (v !== Transport.lvl) { Transport.lvl = v; Transport.dh.post({ gain: v }); } }
      updateTimeUI(); followPlayhead(); stageDirty = true; TL.overlayDirty = true;
    }
    if (stageDirty) { stageDirty = false; try { drawStage(); } catch (e) { console.error(e); } }
    if (TL.glow) TL.overlayDirty = true;
    { const nowT = performance.now(), dt = Math.min(0.033, (nowT - (tick.last || nowT)) / 1000 || 0.016); tick.last = nowT; if (hsStep(dt)) TL.overlayDirty = true; if (glideStep(dt)) TL.overlayDirty = true; if (edgeStep(dt)) TL.overlayDirty = true; if (trimStep(dt)) { TL.overlayDirty = true; if (TL.intro || (TL.trimD && Math.abs(TL.trimD.vs) + Math.abs(TL.trimD.ve) > 1e-4)) TL.staticDirty = true; } }
    if (rvActive()) TL.staticDirty = true;
    if (TL.staticDirty || TL.overlayDirty) { try { drawTimeline(); } catch (e) { console.error(e); } }
  })();
}
window.__keyframes = { get stageZoom() { return SZ; }, S, Transport, TL, t2x, x2t, EXP, LOG, TIMEOUTS, FS, redo, removeAudio, removePdf, enterFull, exitFull, restoreDefaults, runSelfTest, FrameMaker, pickProfile, probeProfile, buildProfiles, frameState, get previewR() { return previewR; }, loadPdf, loadAudio, DISK, tapTurn, shownTurn, startExport, outputSize, normalizeTurns, onTrimChanged, onTurnsChanged, vEnd, duration, autoSpace, rebuildSpreads, syncCredits, turnGap, refOffset, ensureCreditsEnd, AE, aeX, audioGain, PE, recipeOf, buildExport, importSettings, pageNo, buildPdfBlob, wmLayout, drawWatermark };
dbg('glisscore loaded'); envInfo().forEach(dbg);
async function checkHevc() {
  const opt = document.querySelector('#codec option[value="hevc"]'); let ok = false;
  try { if (typeof VideoEncoder !== 'undefined') { const r = await VideoEncoder.isConfigSupported({ codec: 'hvc1.1.6.L123.B0', width: 1920, height: 1080, bitrate: 8e6, framerate: 30, hevc: { format: 'hevc' } }); ok = !!(r && r.supported); } } catch (e) {}
  opt.disabled = !ok;
  if (!ok) { opt.textContent = 'HEVC (not available in this browser)'; if (S.set.codec === 'hevc') { S.set.codec = 'avc'; $('#codec').value = 'avc'; saveSettings(); } }
  dbg('HEVC encoding: ' + (ok ? 'reported as available' : 'not available'));
}
/* on localhost the development guard (dev-guard.js) is loaded; the live site never asks for it */
if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { const g = document.createElement('script'); g.src = 'dev-guard.js'; document.head.appendChild(g); }
boot();
checkHevc();
