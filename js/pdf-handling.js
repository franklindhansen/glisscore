'use strict';
/* ====================================================================
   Spreads & turn times
   ==================================================================== */
/* the pages the video uses (left-out pages do not count) */
const pageTotal = () => S.pdf ? S.pdf.keep.length : 0;
/* a two-page score is one spread (page 1 left, page 2 right), so First page alone cannot apply; the saved choice comes back for other page counts */
const firstAloneOn = () => !!S.set.firstAlone && pageTotal() !== 2 && !singleOn();
function syncFirstAlone() {
  const two = pageTotal() === 2, el = $('#firstAlone');
  el.checked = firstAloneOn(); el.disabled = two; el.closest('.field').classList.toggle('dim', two);
}
function baseSpreads() {
  const pages = S.pdf ? S.pdf.keep : [], n = pages.length, out = [];
  if (!n) return out;
  if (singleOn()) return pages.map(p => [-1, p]);          // each page sits in the right-hand slot, which the layout centers
  if (firstAloneOn()) {
    out.push([-1, pages[0]]);
    for (let i = 1; i < n; i += 2) out.push([pages[i], i + 1 < n ? pages[i + 1] : -1]);
  } else {
    for (let i = 0; i < n; i += 2) out.push([pages[i], i + 1 < n ? pages[i + 1] : -1]);
  }
  return out;
}
/* When the last page stands alone, its empty right side can carry the credits from the moment that page turns in. */
const lastPageAlone = () => { const b = baseSpreads(), l = b[b.length - 1]; return !!l && l[1] === -1; };
function buildSpreads() {
  const out = baseSpreads();
  if (!out.length || !creditsActive()) return out;
  if (creditsAtStart()) { out[0] = Object.assign([CARD, out[0][1]], { startCredits: true }); return out; }       // the credits sit on the empty left of the opening spread; the first turn covers them
  if (singleOn()) { out.push(Object.assign([-1, CARD], { credits: true })); return out; }       // the credits are their own centered card after the last page
  const last = out[out.length - 1];
  if (last[1] === -1) {
    if (S.set.creditsWithLast !== false) { out[out.length - 1] = Object.assign([last[0], CARD], { inlineCredits: true }); return out; }
    out.push(Object.assign([last[0], CARD], { credits: true })); return out;     // a separate ending: the credits fade up beside the page
  }
  out.push(Object.assign([BLANK, CARD], { credits: true }));                     // two pages: the last one folds closed, revealing the credits
  return out;
}
const spreadsText = () => singleOn() ? 'one page at a time' : peN(S.spreads.length, 'spread', 'spreads');
function rebuildSpreads(forceSpace, noHistory) {
  const before = S.spreads.length, old = { turns: S.turns.slice(), edited: S.turnsEdited, ph: S.ph.slice() };
  syncFirstAlone(); creditsAtFix();
  S.spreads = buildSpreads();
  S.manualDur = Math.max(S.manualDur || 0, 20, S.spreads.length * 8);
  if (forceSpace || S.spreads.length !== before || S.turns.length !== Math.max(0, S.spreads.length - 1)) {
    if (old.edited && S.history && !noHistory) { S.history.push(old); S.redo = []; updateHistoryButtons(); }
    autoSpace(false);
  }
  afterStructureChange();
}
/* Page layout: the choice, and what only makes sense in a spread (First page alone and the center fold shading fold away in Single page) */
function syncPageLayout(glide) {
  const one = singleOn();
  document.querySelectorAll('input[name=pageLayout]').forEach(r => { r.checked = r.value === (one ? 'single' : 'spread'); });
  const seg = $('#pagesField .seg'); if (seg && seg._place) seg._place(!!glide);
  $('#firstAloneField').hidden = one; $('#centerFold').hidden = one; applyTransitionUI();
}
/* changing it is one History step; the turns are spaced evenly again for the new number of pages, and it says so when they had been placed by hand */
function setPageLayout(v) {
  if (S.set.pageLayout === v) return;
  const hadEdits = S.turnsEdited && S.turns.length > 0;
  if (S.pdf) pushHistory();
  S.set.pageLayout = v; saveSettings(); syncPageLayout(true);
  if (!S.pdf) return;
  S.time = S.vStart; rebuildSpreads(true, true); onTurnsChanged();
  if (hadEdits) toast(tx('turns.layout'));
}
/* where the turn to the credits goes by default: finishing just as the audio ends */
const creditsTurn = () => audioLen() - flipDur() + refOffset();
/* the credits were added, removed, moved, or only their wording changed */
const spreadSig = () => S.spreads.map(s => s.join(',') + (s.credits ? 'c' : '') + (s.inlineCredits ? 'i' : '') + (s.startCredits ? 's' : '')).join('|');
function syncCredits() {
  const had = hasCreditsSpread(), before = spreadSig();
  S.spreads = buildSpreads();
  const has = hasCreditsSpread();
  if (spreadSig() === before) { stageDirty = true; TL.staticDirty = true; applyCreditsUI(); return; }      // just the wording: redraw
  if (has && !had) { S.turns.push(creditsTurn()); S.ph.push(false); } else if (!has && had) { S.turns.pop(); S.ph.pop(); }
  normalizeTurns(); ensureCreditsEnd(); afterStructureChange(); onTurnsChanged(); onTrimChanged();
}
/* Why Start cannot be used now (null when it can, or when no score is open): the layout, then the page count, then First page alone */
const startWhy = () => !S.pdf ? null : singleOn() ? 'layout' : pageTotal() === 2 ? 'pages' : !S.set.firstAlone ? 'first' : null;
const START_WHY = { layout: 'Requires <span class="hb">Spread</span> layout.', pages: 'Requires 3 or more pages.', first: 'Requires <span class="hb sw">First page alone</span>.' };
const START_TOAST = { layout: 'Spread layout', pages: '3 or more pages', first: 'First page alone' };
/* Start was chosen and the score can no longer carry it: the credits go to the end (inside the History step of the change that caused it) */
function creditsAtFix() {
  const why = startWhy(); if (S.set.creditsAt !== 'start' || !why) return;
  S.set.creditsAt = 'end'; saveSettings();
  const r = document.querySelector('input[name=creditsAt][value=end]'); if (r) r.checked = true;
  const seg = r && r.closest('.seg'); if (seg && seg._place) seg._place(true);
  toast('Credits moved to the end. Start requires ' + START_TOAST[why] + '.');
}
/* the dimmed Start: the slider's highlight nudges toward Start and springs back, and the reason line flashes once */
function creditsAtBounce() {
  const seg = document.querySelector('#creditsAtField .seg'), pill = seg.querySelector('.seg-pill'), hint = $('#creditsAtHint');
  if (seg._place) seg._place(true);
  if (!reducedMotion() && pill.animate && pill.style.transform) {
    const m = /translateX\(([-\d.]+)px\)/.exec(pill.style.transform), x = m ? +m[1] : 0;
    pill.animate([{ transform: 'translateX(' + x + 'px)' }, { transform: 'translateX(' + (x - 7) + 'px)', offset: .35 }, { transform: 'translateX(' + x + 'px)' }], { duration: 520, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  }
  if (hint.animate) hint.animate([{ color: 'var(--muted)' }, { color: 'var(--ink)', offset: .3 }, { color: 'var(--muted)' }], { duration: 900, easing: 'ease-out' });
}
/* Only show the credits options that apply to this score */
function applyCreditsUI() {
  const row = $('#creditsWithLastField'); if (!row) return;
  const atStart = S.set.creditsAt === 'start';
  row.hidden = atStart || !lastPageAlone();                 // at Start the two ending rows close and keep their saved choices
  $('#creditsEarlyField').hidden = atStart;
  const why = startWhy(), r = document.querySelector('input[name=creditsAt][value=start]'), hint = $('#creditsAtHint');
  r.closest('label').classList.toggle('dim', !!why);
  if (why) { r.setAttribute('aria-disabled', 'true'); r.setAttribute('aria-describedby', 'creditsAtHint'); } else { r.removeAttribute('aria-disabled'); r.removeAttribute('aria-describedby'); }
  const html = why ? START_WHY[why] : atStart ? 'Credits show beside the first page until it turns.' : '';
  if (hint.dataset.k !== html) { hint.dataset.k = html; hint.innerHTML = html; }
  hint.hidden = !html;
  if (typeof updateGroupSummaries === 'function') updateGroupSummaries();
  swapText($('#creditsStartHint'), S.set.creditsWithLast !== false ? 'The credits appear beside the last page as it turns in.' : 'The last page turns in on its own, then the credits appear beside it.');
  swapText($('#creditsEarlyHint'), !S.set.creditsEarly ? 'Credits stay on screen until the video ends.' : creditsActive() ? 'Drag the teal marker on the timeline to choose when the credits fade away.' : creditsHasText() ? 'Open a score PDF to see the teal marker on the timeline.' : 'Add text to a line above to see the teal marker on the timeline.');
}
/* keeps the number of page turns matching the number of spreads (after undo, or after the credits came or went) */
function reconcileTurns() {
  const need = Math.max(0, S.spreads.length - 1);
  while (S.turns.length > need) { S.turns.pop(); S.ph.pop(); }
  while (S.turns.length < need) { const b = S.turns.length ? S.turns[S.turns.length - 1] + turnGap() : turnMin(); S.turns.push(Math.min(b, vEnd())); S.ph.push(true); }
  fixPh();
}
function autoSpace(record = true) {
  if (record) pushHistory();
  const n = S.spreads.length, dur = duration(), off = refOffset(), hasC = n > 0 && !!S.spreads[n - 1].credits;
  const pages = hasC ? n - 1 : n, span = hasC ? Math.max(1, audioLen() - S.vStart) : dur;      // the pages share the time up to the end of the audio
  S.turns = [];
  for (let i = 0; i < pages - 1; i++) S.turns.push(S.vStart + (i + 1) * span / pages + off);
  if (hasC) S.turns.push(creditsTurn());
  normalizeTurns();
  S.ph = new Array(S.turns.length).fill(false);
  S.turnsEdited = false;
  onTurnsChanged();
}
/* After a button moves the turns, only their drawing travels: each handle keeps an offset in seconds (where it is drawn minus where it is) that a small spring brings to zero, with a slight landing bounce */
const shownTurn = i => S.turns[i] + ((TL.glide && TL.glide[i]) ? TL.glide[i].d : 0);
function glideFrom(was) {
  if (reducedMotion() || was.length !== S.turns.length) { TL.glide = null; return; }
  const g = {}; let any = false;
  was.forEach((t, i) => { const d = t - S.turns[i]; if (Math.abs(d) > 0.005) { g[i] = { d, v: 0 }; any = true; } });
  TL.glide = any ? g : null; TL.overlayDirty = true;
}
function glideStep(dt) {
  const g = TL.glide; if (!g) return false; TL.staticDirty = true;   // page blocks and the waveform follow the drawn handles
  if ((TL.drag && TL.drag.kind === 'turn') || reducedMotion()) { TL.glide = null; return true; }       // dragging and nudging are never delayed
  const w = 2 * Math.PI / 0.4, z = 0.78, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; let moving = false;
  for (const k in g) {
    const s = g[k];
    for (let i = 0; i < n; i++) { s.v += (-w * w * s.d - 2 * z * w * s.v) * h; s.d += s.v * h; }
    if (Math.abs(s.d) > 0.002 || Math.abs(s.v) > 0.01) moving = true; else delete g[k];
  }
  if (!moving) TL.glide = null;
  return true;
}
/* the turns after the playhead that "Turns to end" would move: the credits turn stays where it is */
function toEndIdx() {
  const n = S.turns.length, hasC = n > 0 && S.spreads.length > 0 && !!S.spreads[S.spreads.length - 1].credits, out = [];
  for (let i = 0; i < n - (hasC ? 1 : 0); i++) if (S.turns[i] > S.time) out.push(i);
  return out;
}
/* packs the turns after the playhead against the end (or against the credits turn) at the least gap, in order; they become placeholders (dashed) to place with Add page turn */
function turnsToEnd() {
  const idx = toEndIdx(); if (!idx.length) return;
  const D = turnGap(), n = S.turns.length, hasC = n > 0 && S.spreads.length > 0 && !!S.spreads[S.spreads.length - 1].credits;
  pushHistory(); const was = S.turns.map((_, i) => shownTurn(i));
  const top = hasC ? S.turns[n - 1] - D : vEnd() - D + refOffset();
  idx.forEach((g, k) => { S.turns[g] = top - (idx.length - 1 - k) * D; S.ph[g] = true; });
  S.turnsEdited = true; TL.sel = [];
  onTurnsChanged(); glideFrom(was);
  toast(idx.length === 1 ? tx('vid.toend.one') : tx('vid.toend', { n: idx.length }));
}
function syncToEnd() {
  const b = $('#bToEnd'); if (!b) return;
  const none = !toEndIdx().length; b.disabled = none;
  const t = none ? tx('vid.toend.none') : 'Move every turn after the playhead to the end'; if (b.title !== t) b.title = t;
}
function fixPh() { while (S.ph.length < S.turns.length) S.ph.push(false); S.ph.length = S.turns.length; }
function normalizeTurns() {
  fixPh();
  const n = S.turns.length; if (!n) return;
  const D = turnGap(), off = refOffset(), first = turnMin(), dur = vEnd();
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? first : S.turns[i - 1] + D;
    if (S.turns[i] < lo) S.turns[i] = lo;
  }
  const hiMax = dur - D + off;
  for (let i = n - 1; i >= 0; i--) {
    const hi = i === n - 1 ? hiMax : S.turns[i + 1] - D;
    if (S.turns[i] > hi) S.turns[i] = hi;
  }
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? first : S.turns[i - 1] + D;
    if (S.turns[i] < lo) S.turns[i] = lo;
  }
}
/* History for the settings: every setting that alters the video's result is part of a step. The audio ones (and the EQ and Imager) belong to the Audio Editor's steps, the page layout has its own field, and where you are in the app is never a step. */
const HS_OWN = ['audioKey', 'aeView', 'pageLayout', 'fx'], HS_STRUCT = ['firstAlone', 'creditsOn', 'creditsAt', 'creditsWithLast'];
const outSet = () => { const o = {}; Object.keys(DEFAULTS).forEach(k => { if (!HS_OWN.includes(k) && !AE_SET.includes(k)) o[k] = S.set[k]; }); return o; };
const HS_GROUPS = [
  ['Fades', ['fadesOn', 'fadeIn', 'fadeOut', 'fadeLen', 'fadeOutLen', 'fadeSplit', 'fadeStyle', 'fadeShape', 'fadeAuto', 'fadeAutoOut']],
  ['Transition', ['transition', 'slideDir']], ['Turn length', ['flipDur', 'slideDur']], ['Turn reference', ['ref']], ['Bend', ['bend']], ['First page alone', ['firstAlone']],
  ['Margin', ['margin']], ['Colors', ['bg', 'ink']], ['Invert', ['invert']], ['Shadows', ['shadowsOn', 'gutter', 'divider', 'turnShadow', 'turnSoft']], ['Under the score', ['scoreAmt', 'scoreSoft']],
  ['Aspect', ['aspect']], ['Resolution', ['res']], ['Frame rate', ['fps']], ['Render method', ['method']], ['Codec', ['codec']], ['Video quality', ['videoQuality']],
  ['Credits', ['creditsOn', 'creditsAt', 'creditsWithLast', 'creditsEarly', 'creditsFont', 'creditsFontEach', 'credTitleB', 'credTitleI', 'credTitleFont', 'credL2B', 'credL2I', 'credL2Font', 'credL3B', 'credL3I', 'credL3Font']],
  ['Audio format', ['audioFormat', 'audioKbps', 'audioRate']], ['Tags', ['tagsOn', 'tagTitle', 'tagArtist', 'tagAlbumArtist', 'tagAlbum', 'tagYear', 'tagTrack', 'tagDisc', 'tagComposer', 'tagWork', 'tagMovement', 'tagMovementNo', 'tagGenre', 'tagComment', 'tagShowWork', 'tagCompilation']]];
const setStepNames = (a, b) => { const out = []; Object.keys(b).forEach(k => { if (a[k] === b[k] || (a[k] == null && b[k] == null)) return; const g = HS_GROUPS.find(x => x[1].includes(k)), nm = g ? g[0] : 'Setting'; if (!out.includes(nm)) out.push(nm); }); out.sort((x, y) => HS_GROUPS.findIndex(g => g[0] === x) - HS_GROUPS.findIndex(g => g[0] === y)); return out; };
/* A change to a setting is a step taken just before it: HB.base is how things stood when you pressed, typed or tapped. A slider drag, a burst of typing or a glide
   is one gesture (open until you let go, or 0.7s of quiet), and the changes within it join the step already taken. */
const lightSnap = () => ({ lay: S.set.pageLayout, set: outSet(), turns: S.turns.slice(), edited: S.turnsEdited, ph: S.ph.slice(), vStart: S.vStart, vEndSet: S.vEndSet, creditsEnd: S.creditsEnd });
function hsClose() { clearTimeout(HB.timer); HB.open = false; if (!HB.quiet) HB.base = lightSnap(); }
function hsOpen() { HB.open = true; clearTimeout(HB.timer); HB.timer = setTimeout(hsClose, 700); }
function hsNote() {
  if (HB.quiet) return;
  if (HB.open) { hsOpen(); return; }
  const b = HB.base; if (!b) return;
  if (JSON.stringify(b.set) === JSON.stringify(outSet()) && b.lay === S.set.pageLayout) return;
  pushSnap(Object.assign(snap(), b));
}
const HS_TEXT = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=color]), textarea';
document.addEventListener('pointerdown', () => { hsClose(); }, true);
document.addEventListener('keydown', e => { if (e.repeat) return; if (e.target.matches && e.target.matches(HS_TEXT)) { if (!HB.open) HB.base = lightSnap(); } else hsClose(); }, true);
document.addEventListener('pointerup', () => { if (HB.open) setTimeout(hsClose, 0); });
document.addEventListener('change', () => { if (HB.open) setTimeout(hsClose, 0); });
const audSnap = () => { const o = { fx: fxClone(S.set.fx) }; AE_SET.forEach(k => { o[k] = S.set[k]; }); return o; };
const snap = () => ({ lay: S.set.pageLayout, set: outSet(), turns: S.turns.slice(), edited: S.turnsEdited, ph: S.ph.slice(), vStart: S.vStart, vEndSet: S.vEndSet, creditsEnd: S.creditsEnd, pdf: S.pdf ? recipeOf() : null, aud: audSnap() });
function applySnap(h) { HB.quiet = true; try { applySnapIn(h); } finally { HB.quiet = false; hsClose(); } }
function applySnapIn(h) {
  let struct = false;
  if (h.set) { const ch = Object.keys(h.set).filter(k => h.set[k] !== S.set[k]); if (ch.length) { ch.forEach(k => { S.set[k] = h.set[k]; }); struct = ch.some(k => HS_STRUCT.includes(k)); saveSettings(); stageDirty = true; TL.staticDirty = true; TL.overlayDirty = true; syncControls(); layoutStage(); } }
  const layChanged = !!h.lay && h.lay !== S.set.pageLayout; if (layChanged) { S.set.pageLayout = h.lay; saveSettings(); syncPageLayout(true); syncFirstAlone(); if (S.pdf) { S.spreads = buildSpreads(); S.time = S.vStart; } }
  if (h.aud) { AE_SET.forEach(k => { S.set[k] = h.aud[k]; }); S.set.fx = fxClone(h.aud.fx); saveSettings(); stageDirty = true; fxGet(S.set.fx).then(() => { stageDirty = true; }, () => {}); } S.turns = h.turns.slice(); S.turnsEdited = h.edited; S.ph = h.ph ? h.ph.slice() : new Array(h.turns.length).fill(false); if (h.vStart !== undefined) { S.vStart = h.vStart; S.vEndSet = h.vEndSet; } if (h.creditsEnd !== undefined) S.creditsEnd = h.creditsEnd;
  if (h.pdf && S.pdf && recipeSig(h.pdf) !== recipeSig(recipeOf())) { setRecipe(h.pdf); S.spreads = buildSpreads(); setChips(); }       // the pages come back too
  if (struct && !layChanged && S.pdf) { S.spreads = buildSpreads(); S.time = S.vStart; }
  reconcileTurns(); if ((layChanged || struct) && S.pdf) afterStructureChange(); }
function updateHistoryButtons() { if (!HB.open && !HB.quiet) HB.base = lightSnap(); const u = $('#bUndo'), r = $('#bRedo'); if (u) u.disabled = S.history.length === 0; if (r) r.disabled = S.redo.length === 0; try { MAIN_HIST.refresh(); } catch (e) {} }
/* History: a list of the steps taken, newest on top; pick one to go back (or forward) to it. The PDF Editor and the main view use this, the way the Audio Editor does.
   c: btn, pop, list, foot, sum, sub, no, go (ids), first (name of step 0), states() oldest to newest with the current one inside, cur() the index of the current one, label(a, b) the name of the step from a to b, apply(t) goes to step t, can() true when there is any history */
function histPanel(c) {
  const el = k => document.getElementById(c[k]), H = { sel: -1, rec: {} }, EASE = EASE_GLIDE;
  const name = (st, i) => i === 0 ? c.first : (H.rec[i] || (H.rec[i] = c.label(st[i - 1], st[i]) || 'Change'));
  const isOpen = () => el('btn').getAttribute('aria-expanded') === 'true';
  function draw() {
    const st = c.states(), cur = c.cur(), list = el('list'); list.innerHTML = '';
    for (let i = st.length - 1; i >= 0; i--) {
      const li = document.createElement('li'), nm = name(st, i);
      li.className = 'hs-row' + (i === cur ? ' cur' : '') + (i > cur ? ' undone' : '') + (i === H.sel ? ' target' : ''); li.dataset.i = i;
      li.innerHTML = '<div class="hs-main"><i class="hs-dot"></i><button class="hs-btn" type="button" aria-label="' + (i === cur ? esc(nm) + ', current' : (i > cur ? 'Go forward to ' : 'Go back to ') + esc(nm)) + '"><span class="hs-n">' + esc(nm) + '</span></button>' + (i === cur ? '<em>Current</em>' : i > cur ? '<em>Undone</em>' : '') + '</div>';
      list.appendChild(li);
    }
    sync();
  }
  function sync() {
    const st = c.states(), cur = c.cur(), on = H.sel >= 0 && H.sel !== cur, list = el('list');
    foldSet('#' + c.foot, on); if (!on) { el('sub').textContent = 'Pick a step to go back to it'; return; }
    const fwd = H.sel > cur, n = Math.abs(H.sel - cur), t = list.querySelector('.hs-row.target .hs-n');
    el('sum').textContent = fwd ? 'Go forward to “' + (t ? t.textContent : '') + '”' : 'Undo ' + n + (n === 1 ? ' change' : ' changes');
    el('go').textContent = fwd ? 'Go forward' : 'Go back'; el('sub').textContent = fwd ? 'Pick a step to go forward to' : 'Pick a step to go back to';
  }
  function open(on) {
    const pop = el('pop'), btn = el('btn'); if (on === isOpen()) return;
    btn.setAttribute('aria-expanded', on); clearTimeout(pop._t);
    if (on) { H.sel = -1; H.rec = {}; pop.hidden = false; draw(); el('list').scrollTop = 0; if (!reducedMotion()) pop.animate([{ opacity: 0, transform: 'translateY(' + (pop.classList.contains('up') ? 6 : -6) + 'px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE }); }
    else if (reducedMotion()) pop.hidden = true; else { const a = pop.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(' + (pop.classList.contains('up') ? 6 : -6) + 'px) scale(.98)' }], { duration: 200, easing: 'ease-out' }); a.onfinish = () => { if (!isOpen()) pop.hidden = true; }; }
  }
  function refresh() { el('btn').disabled = !c.can(); if (!c.can() && isOpen()) open(false); else if (isOpen()) { H.rec = {}; if (H.sel >= c.states().length) H.sel = -1; draw(); } }
  function go() { const t = H.sel; if (t < 0 || t === c.cur()) return; open(false); c.apply(t); }
  function bind() {
    el('btn').addEventListener('click', () => open(!isOpen()));
    el('no').addEventListener('click', () => { H.sel = -1; draw(); });
    el('go').addEventListener('click', go);
    el('list').addEventListener('click', e => { const row = e.target.closest('.hs-row'); if (!row || !e.target.closest('.hs-btn')) return; const i = +row.dataset.i; H.sel = i === c.cur() || i === H.sel ? -1 : i; draw(); });
    document.addEventListener('pointerdown', e => { if (isOpen() && !e.target.closest('#' + c.pop + ', #' + c.btn)) open(false); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); e.preventDefault(); open(false); } }, true);
  }
  return { open, refresh, bind, isOpen };
}
/* what a step in the PDF Editor did, from the pages before and after */
function peStepLabel(a, b) {
  const parts = [], na = a.slots.length, nb = b.slots.length;
  if (nb > na) { const halves = b.slots.slice(na).filter(s => s.half).length; parts.push(halves ? 'Split ' + peN(halves, 'spread', 'spreads') : 'Inserted ' + peN(nb - na)); }
  else {
    const cnt = (f, g) => { let n = 0; for (let i = 0; i < nb; i++) if (a.slots[i] && f(a.slots[i], b.slots[i])) n++; return n; }, z = v => v || 0;
    const out = cnt((x, y) => !x.x && y.x), back = cnt((x, y) => x.x && !y.x); if (out) parts.push('Left out ' + peN(out)); if (back) parts.push('Put back ' + peN(back));
    if (a.order.join() !== b.order.join() && !out && !back) parts.push('Moved pages');
    const rot = cnt((x, y) => z(x.rot) !== z(y.rot)); if (rot) parts.push('Turned ' + peN(rot));
    const cr = cnt((x, y) => String(x.crop || '') !== String(y.crop || '')); if (cr) parts.push(cnt((x, y) => y.crop) ? 'Crop' : 'Crop reverted');
    const sk = cnt((x, y) => z(x.skew) !== z(y.skew) || z(x.vskew) !== z(y.vskew) || z(x.warp) !== z(y.warp)); if (sk) parts.push(cnt((x, y) => y.skew || y.vskew || y.warp) ? 'Re-kilter' : 'Re-kilter reverted');
    const dm = cnt((x, y) => dimKey(x) !== dimKey(y)); if (dm) parts.push(cnt((x, y) => dimKey(y)) ? 'Dim' : 'Dim reverted');
    const cl = cnt((x, y) => z(x.bg) !== z(y.bg) || z(x.sp) !== z(y.sp)); if (cl) parts.push(cnt((x, y) => y.bg || y.sp) ? 'Clean' : 'Clean reverted');
    if (cnt((x, y) => !!x.c !== !!y.c || !!x.nw !== !!y.nw)) parts.push('Page options');
  }
  if (JSON.stringify(a.size || 0) !== JSON.stringify(b.size || 0)) parts.push('Re-size');
  if (JSON.stringify(a.wm) !== JSON.stringify(b.wm)) parts.push(!!a.wm.on !== !!b.wm.on ? (b.wm.on ? 'Watermark on' : 'Watermark off') : 'Watermark');
  return parts.length ? parts[0] + (parts.length > 1 ? ' + ' + (parts.length - 1) + ' more' : '') : 'Change';
}
/* what a step in the main view did: the PDF's and the audio's changes made in their own editors are named as they are there */
function mainStepLabel(a, b) {
  const parts = [];
  if (a.lay && b.lay && a.lay !== b.lay) parts.push('Page layout');
  if (a.set && b.set) parts.push(...setStepNames(a.set, b.set));
  if (a.pdf && b.pdf && recipeSig(a.pdf) !== recipeSig(b.pdf)) parts.push('PDF: ' + peStepLabel(a.pdf, b.pdf));
  else if (!!a.pdf !== !!b.pdf) parts.push(b.pdf ? 'PDF opened' : 'PDF removed');
  if (a.aud && b.aud && JSON.stringify(a.aud) !== JSON.stringify(b.aud)) { let t = 'Audio'; try { const r = aeRecords(a.aud, b.aud); if (r.length) t = 'Audio: ' + r[0].label + (r.length > 1 ? ' + ' + (r.length - 1) + ' more' : ''); } catch (e) {} parts.push(t); }
  if (a.vStart !== b.vStart || a.vEndSet !== b.vEndSet) parts.push('Trim');
  if (a.creditsEnd !== b.creditsEnd) parts.push('Credits');
  if (a.turns.length !== b.turns.length) parts.push('Page turns'); else if (a.turns.some((v, i) => v !== b.turns[i])) parts.push(a.turns.filter((v, i) => v !== b.turns[i]).length === 1 ? 'Moved a page turn' : 'Page turns');
  return parts.length ? parts[0] + (parts.length > 1 ? ' + ' + (parts.length - 1) + ' more' : '') : 'Change';
}
const mainHist = () => ({ st: S.history.concat([snap()], S.redo.slice().reverse()), cur: S.history.length });
const MAIN_HIST = histPanel({ btn: 'bHist', pop: 'mHist', list: 'mHistList', foot: 'mHistFoot', sum: 'mHistSum', sub: 'mHistSub', no: 'mHistNo', go: 'mHistGo', first: 'Opened',
  states: () => mainHist().st, cur: () => S.history.length, label: mainStepLabel, can: () => S.history.length > 0 || S.redo.length > 0,
  apply: t => { const m = mainHist(), st = m.st; S.history = st.slice(0, t); S.redo = st.slice(t + 1).reverse(); applySnap(st[t]); updateHistoryButtons(); onTurnsChanged(); onTrimChanged(); } });
function pushSnap(h) {
  S.history.push(h); S.redo = [];
  if (S.history.length > 60) S.history.shift();
  hsOpen(); updateHistoryButtons();
}
function pushHistory() { pushSnap(snap()); }
function undo() {
  const h = S.history.pop(); if (!h) return;
  S.redo.push(snap()); applySnap(h); updateHistoryButtons(); onTurnsChanged(); onTrimChanged();
}
function redo() {
  const h = S.redo.pop(); if (!h) return;
  S.history.push(snap()); applySnap(h); updateHistoryButtons(); onTurnsChanged(); onTrimChanged();
}
/* the video's start or end moved: refit the timeline and keep the playhead inside the video */
function onTrimChanged() {
  if (typeof syncFadeLens === 'function') syncFadeLens();
  S.time = clamp(S.time, S.vStart, vEnd()); fixCreditsEnd();
  layoutTimeline(); TL.staticDirty = true; TL.overlayDirty = true; stageDirty = true; updateInfo(); updateTimeUI(true);
}
function onTurnsChanged() { TL.glide = null; if (TL.sel.length && TL.selN !== S.turns.length) TL.sel = []; fixCreditsEnd(); TL.staticDirty = true; stageDirty = true; updateInfo(); updateHint(); }
function afterStructureChange() {
  prefetchAround(); fixCreditsEnd();
  TL.staticDirty = true; stageDirty = true; layoutTimeline(); updateInfo(); updateButtons(); applyCreditsUI();
}

/* Which spread (and how far through a page turn) is showing at time t */
/* 0 = fully faded out, 1 = fully visible: the start and end fades */
/* a fade length chosen for you: about 6% of the video, never shorter than 0.3s or longer than 1s */
const autoFadeLen = dur => clamp(dur * 0.06, 0.3, 1.0);
/* the same envelope for the picture, the sound, and the Audio Editor's draft: s = settings, vs / ve = the video's start and end */
/* Auto is chosen for each side on its own: fadeAuto is In's, fadeAutoOut is Out's (empty: the same as In, as in older projects) */
const fadeAutoSide = (s, side) => side === 'out' && s.fadeAutoOut != null ? !!s.fadeAutoOut : !!s.fadeAuto;
function fadeLens(s, vs, ve) {
  const dur = ve - vs, au = autoFadeLen(dur);
  return { Li: Math.min(fadeAutoSide(s, 'in') ? au : +s.fadeLen, dur / 2), Lo: Math.min(fadeAutoSide(s, 'out') ? au : +(s.fadeSplit ? s.fadeOutLen : s.fadeLen), dur / 2) };
}
function fadeEnv(s, vs, ve, t) {
  if (!s.fadesOn || (!s.fadeIn && !s.fadeOut)) return 1;
  const { Li, Lo } = fadeLens(s, vs, ve);
  let f = 1;
  if (s.fadeIn && Li > 0) f = Math.min(f, (t - vs) / Li);
  if (s.fadeOut && Lo > 0) f = Math.min(f, (ve - t) / Lo);
  return (AE_SHAPES[s.fadeShape] || AE_SHAPES.smooth)(clamp(f, 0, 1));          // the picture's curve: Smooth is the long-standing ease
}
const fadeAt = t => fadeEnv(S.set, S.vStart, vEnd(), t);
/* the sound's fades are the Audio Editor's, in the video and in an exported audio file alike; the Fades panel on the page is for the picture only */
const soundFadeAt = t => { const [li, lo] = aeFadeLens(S.set); return aeEnv(S.vStart, vEnd(), t, li, S.set.audioFadeShape, lo); };
/* Normalize volume: the loudest peak of the part you use is raised (or lowered) to -1 dB below full scale, so nothing can clip */
/* the level of the sound: normalizing sets it from the loudest peak, otherwise Adjust gain (in dB) does */
const levelFor = (on, db, from, to, pk, target) => on ? normGainFor(true, from, to, pk, target) : Math.pow(10, (+db || 0) / 20);
function normGainFor(on, from, to, pks, tdb) {
  if (!on || !S.audio) return 1;
  const pk = (pks || videoPeaks()), i0 = Math.max(0, Math.floor(from * 100)), i1 = Math.min(pk.length - 1, Math.ceil(to * 100));
  let mx = 0; for (let i = i0; i <= i1; i++) if (pk[i] > mx) mx = pk[i];
  return mx < 1e-4 ? 1 : Math.min(Math.pow(10, 24 / 20), Math.pow(10, (tdb == null ? S.set.normPeakDb : tdb) / 20) / mx);
}
let normCache = { key: '', v: 1 };
/* what Normalize measures for the video: the true peaks of the sound it uses, as the sound's fades leave them */
let vpMemo = { k: '', pk: null };
function videoPeaks() {
  const src = outSrc(), tp = srcTp(src), s = S.set, fadesOn = s.audioFades !== false, vs = S.vStart, ve = vEnd();
  if (!fadesOn) return tp;
  const key = [srcLen(src), tp.length, tp === src.peaks ? 0 : 1, vs, ve, s.audioFadeLen, s.audioFadeOutLen, s.audioFadeShape, TP_VER].join('|');
  if (vpMemo.k !== key) { const o = new Float32Array(tp.length); for (let i = 0; i < tp.length; i++) o[i] = tp[i] * Math.max(soundFadeAt(i / 100), soundFadeAt((i + 1) / 100)); vpMemo = { k: key, pk: o }; }
  return vpMemo.pk;
}
let loudAppMemo = { k: '', g: 1 };
function audioGain() {
  const s = S.set;
  if (s.normalize && s.normBy === 'loud') {
    const k = [s.normLufs, s.limiter, fxKey(s.fx), S.vStart, vEnd(), s.audioFades, s.audioFadeLen, s.audioFadeOutLen, s.audioFadeShape, s.audioKey, TP_VER, LUC.size].join('|');
    if (loudAppMemo.k !== k) { const i = aeLoudInfo(aeFromApp()); loudAppMemo = { k: i && i.ready ? k : '', g: i && i.g ? i.g : 1 }; if (!(i && i.ready)) loudEnsure(aeFromApp()).then(() => { const j = aeLoudInfo(aeFromApp()); if (j && j.ready) TL.staticDirty = true; }, () => {}); }
    return loudAppMemo.g;
  }
  const key = [s.normalize, s.normPeakDb, s.gainDb, S.vStart, vEnd(), s.audioFades, s.audioFadeLen, s.audioFadeOutLen, s.audioFadeShape, TP_VER, S.audio ? S.audio.name + S.audio.duration + fxKey(S.set.fx) + (fxPeek(S.set.fx) ? 1 : 0) : ''].join('|');
  if (normCache.key !== key) normCache = { key, v: levelFor(S.set.normalize, S.set.gainDb, S.vStart, vEnd()) };
  return normCache.v;
}
function frameState(t) {
  const n = S.spreads.length, fade = fadeAt(t);
  if (!n) return { spread: 0, flip: null, t, fade };
  const D = flipDur(), off = refOffset();
  let cur = 0;
  while (cur < n - 1 && t >= S.turns[cur] - off + D) cur++;
  if (cur < n - 1 && D > 0) {
    const s = S.turns[cur] - off;
    if (t >= s) return { spread: cur, flip: clamp((t - s) / D, 0, 1), t, fade };
  }
  return { spread: cur, flip: null, t, fade };
}
function pagesFor(st) {
  const sp = S.spreads[st.spread]; if (!sp) return [];
  const out = [sp[0], sp[1]];
  if (st.flip != null) { const nx = S.spreads[st.spread + 1]; if (nx) out.push(nx[0], nx[1]); }
  return out.filter(i => i >= 0);
}

/* ====================================================================
   PDF handling
   ==================================================================== */
async function getPdfjs() {
  for (let i = 0; i < 100; i++) { if (window.pdfjsLib) break; await sleep(100); }
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('The PDF engine did not load. Reload the page.');
  if (!lib.GlobalWorkerOptions.workerPort && !lib.GlobalWorkerOptions.workerSrc) {
    /* the PDF engine runs in a background worker, so reading and drawing pages never freezes the window. It starts from a copy kept as text, because browsers refuse to start a worker straight from a file on disk. */
    lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    try {
      if (!window.__pdfWorkerSrc) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/pdf.worker.src.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
      lib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([window.__pdfWorkerSrc], { type: 'text/javascript' }))); window.__pdfWorkerSrc = null;
    } catch (e) { console.warn('PDF worker could not start; the engine will run in the page.', e); }
  }
  return lib;
}
/* the page straightened: lines turned by `skew`, upright strokes by `skew + vskew` (degrees, clockwise), about the page's middle */
const skewMat = (skew, vskew) => {
  const al = -(skew || 0) * Math.PI / 180, be = -((skew || 0) + (vskew || 0)) * Math.PI / 180, det = Math.cos(al - be) || 1;
  return new DOMMatrix([Math.cos(be) / det, -Math.sin(al) / det, Math.sin(be) / det, Math.cos(al) / det, 0, 0]);
};
/* a page whose lines tilt differently from top to bottom (a photo taken at an angle): it is drawn once, then laid onto the output piece by piece, each small piece moved to where it belongs */
async function renderWarped(page, cv, ctx, w, h, rot, geo) {
  const v0 = page.getViewport({ scale: 1, rotation: page.rotate || 0 }), Ws = v0.width, Hs = v0.height, cr = geo.crop || [0, 0, 1, 1];
  const cw = (cr[2] - cr[0]) * Ws, ch = (cr[3] - cr[1]) * Hs, side = rot % 180 !== 0, vw0 = side ? ch : cw, vh0 = side ? cw : ch, sc = Math.min(w / vw0, h / vh0);
  const src = document.createElement('canvas'); src.width = Math.max(2, Math.round(Ws * sc)); src.height = Math.max(2, Math.round(Hs * sc)); const sx = src.getContext('2d', { alpha: false }); sx.fillStyle = '#fff'; sx.fillRect(0, 0, src.width, src.height);
  await page.render({ canvasContext: sx, viewport: page.getViewport({ scale: sc, rotation: page.rotate || 0 }), background: '#ffffff' }).promise;
  const pw = vw0 * sc, ph = vh0 * sc, px = (w - pw) / 2, py = (h - ph) / 2, Ain = skewMat(geo.skew, geo.vskew).inverse(), kap = geo.warp || 0;
  const out = new DOMMatrix(); out.translateSelf(w / 2, h / 2); out.scaleSelf(sc); out.rotateSelf(rot); out.translateSelf(-(cr[0] + cr[2]) / 2 * Ws, -(cr[1] + cr[3]) / 2 * Hs);
  const N = 28, M = Math.max(4, Math.round(N * ch / Math.max(1, cw))), nx = cr[2] - cr[0], ny = cr[3] - cr[1], nodes = [];
  for (let j = 0; j <= M; j++) { const row = []; for (let i = 0; i <= N; i++) {
    const qx = (cr[0] + nx * i / N) * Ws, qy = (cr[1] + ny * j / M) * Hs, ux = qx, uy = qy + kap * ((qy - Hs / 2) / Hs) * (qx - Ws / 2);          // where this spot of the straight page sits on the tilted one
    const a = Ain.transformPoint(new DOMPoint(ux - Ws / 2, uy - Hs / 2)), c = out.transformPoint(new DOMPoint(qx, qy));
    row.push({ x: c.x, y: c.y, u: (a.x + Ws / 2) * sc, v: (a.y + Hs / 2) * sc }); } nodes.push(row); }
  ctx.save(); ctx.beginPath(); ctx.rect(Math.round(px), Math.round(py), Math.round(pw), Math.round(ph)); ctx.clip();
  const tri = (A, B, C) => {          // the picture's piece ABC, moved onto the output
    const d = (A.u * (B.v - C.v) + B.u * (C.v - A.v) + C.u * (A.v - B.v)); if (!d) return;
    const a = (A.x * (B.v - C.v) + B.x * (C.v - A.v) + C.x * (A.v - B.v)) / d, c = (A.u * (B.x - C.x) + B.u * (C.x - A.x) + C.u * (A.x - B.x)) / d, e = (A.u * (B.v * C.x - C.v * B.x) + B.u * (C.v * A.x - A.v * C.x) + C.u * (A.v * B.x - B.v * A.x)) / d;
    const b = (A.y * (B.v - C.v) + B.y * (C.v - A.v) + C.y * (A.v - B.v)) / d, dd = (A.u * (B.y - C.y) + B.u * (C.y - A.y) + C.u * (A.y - B.y)) / d, f = (A.u * (B.v * C.y - C.v * B.y) + B.u * (C.v * A.y - A.v * C.y) + C.u * (A.v * B.y - B.v * A.y)) / d;
    const gx = (A.x + B.x + C.x) / 3, gy = (A.y + B.y + C.y) / 3, grow = P => ({ x: P.x + Math.sign(P.x - gx) * 0.6, y: P.y + Math.sign(P.y - gy) * 0.6 });
    const a1 = grow(A), b1 = grow(B), c1 = grow(C); ctx.save(); ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(c1.x, c1.y); ctx.closePath(); ctx.clip(); ctx.setTransform(a, b, c, dd, e, f); ctx.drawImage(src, 0, 0); ctx.restore();
  };
  for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const A = nodes[j][i], B = nodes[j][i + 1], C = nodes[j + 1][i], D = nodes[j + 1][i + 1]; tri(A, B, C); tri(B, D, C); }
  ctx.restore(); return [px, py, pw, ph];
}
/* ---------- Clean: whiten the paper and take out specks ----------
   Runs on a worker thread so the page stays fluid. The paper is measured block by block (the brightest part of each block), so a shadow near the spine or a tinted corner is leveled out;
   White pushes the paper to white, Page color levels it to the scan's own paper tone. Specks are small dark blobs that touch nothing else (a staff line or a note takes anything it touches with it),
   sized against the page so a staccato dot or a dotted note is never as small as the dust. */
function pdfCleanWorker() {
  self.onmessage = e => {
    const m = e.data;
    if (m.bmp) {          // the picture comes as a bitmap and goes back as one, so the page never reads or writes the pixels itself
      try { const oc = new OffscreenCanvas(m.w, m.h), c = oc.getContext('2d'); c.drawImage(m.bmp, 0, 0); m.bmp.close(); const id = c.getImageData(0, 0, m.w, m.h); clean(id.data, m.w, m.h, m.bg, m.sp, m.u); c.putImageData(id, 0, 0); const out = oc.transferToImageBitmap(); self.postMessage({ id: m.id, bmp: out }, [out]); }
      catch (x) { self.postMessage({ id: m.id, fail: 1 }); }
      return;
    }
    let err = 0; try { clean(new Uint8ClampedArray(m.buf), m.w, m.h, m.bg, m.sp, m.u); } catch (x) { err = 1; } self.postMessage({ id: m.id, buf: m.buf, err }, [m.buf]);
  };
  function clean(d, w, h, bg, sp, u) {
    const n = w * h, L = new Uint8Array(n);
    for (let i = 0, k = 0; i < n; i++, k += 4) L[i] = (d[k] * 77 + d[k + 1] * 150 + d[k + 2] * 29) >> 8;
    const bs = Math.max(12, Math.round(Math.max(w, h) / 48)), gx = Math.ceil(w / bs), gy = Math.ceil(h / bs), g = gx * gy, st = bs > 24 ? 2 : 1;
    let P = new Float32Array(g * 4), hist = new Uint32Array(256);
    for (let by = 0; by < gy; by++) for (let bx = 0; bx < gx; bx++) {
      const x0 = bx * bs, x1 = Math.min(w, x0 + bs), y0 = by * bs, y1 = Math.min(h, y0 + bs); hist.fill(0); let cnt = 0;
      for (let y = y0; y < y1; y += st) for (let x = x0, i = y * w + x0; x < x1; x += st, i += st) { hist[L[i]]++; cnt++; }
      let acc = 0, t = 255; for (; t > 0; t--) { acc += hist[t]; if (acc >= cnt * 0.4) break; }
      let r = 0, gg = 0, b = 0, c = 0;
      for (let y = y0; y < y1; y += st) for (let x = x0, i = y * w + x0; x < x1; x += st, i += st) if (L[i] >= t) { const k = i * 4; r += d[k]; gg += d[k + 1]; b += d[k + 2]; c++; }
      const o = (by * gx + bx) * 4; if (c) { P[o] = r / c; P[o + 1] = gg / c; P[o + 2] = b / c; P[o + 3] = (r * 77 + gg * 150 + b * 29) / 256 / c; } else { P[o] = P[o + 1] = P[o + 2] = P[o + 3] = 255; }
    }
    const ls = Array.from({ length: g }, (_, i) => P[i * 4 + 3]).sort((a, b) => a - b), mid = ls[g >> 1]; let G = [0, 0, 0, 0], gc = 0;
    for (let i = 0; i < g; i++) if (P[i * 4 + 3] >= mid) { for (let c = 0; c < 4; c++) G[c] += P[i * 4 + c]; gc++; }
    for (let c = 0; c < 4; c++) G[c] /= gc || 1;
    for (let i = 0; i < g; i++) if (P[i * 4 + 3] < G[3] * 0.6) for (let c = 0; c < 4; c++) P[i * 4 + c] = G[c];          // a dark edge or a dense block of music is no guide to the paper
    { const Q = new Float32Array(g * 4);          // one soft pass so the blocks do not show
      for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) for (let c = 0; c < 4; c++) { let s = 0, k = 0; for (let j = Math.max(0, y - 1); j <= Math.min(gy - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(gx - 1, x + 1); i++) { s += P[(j * gx + i) * 4 + c]; k++; } Q[(y * gx + x) * 4 + c] = s / k; }
      P = Q; }
    const xi = new Int32Array(w), xt = new Float32Array(w); for (let x = 0; x < w; x++) { const f = Math.min(gx - 1, Math.max(0, x / bs - 0.5)), i = Math.floor(f); xi[x] = i; xt[x] = f - i; }
    const at = (x, y, o) => { const f = Math.min(gy - 1, Math.max(0, y / bs - 0.5)), j = Math.floor(f), j1 = Math.min(gy - 1, j + 1), ty = f - j, i = xi[x], i1 = Math.min(gx - 1, i + 1), tx = xt[x]; for (let c = 0; c < 4; c++) o[c] = (P[(j * gx + i) * 4 + c] * (1 - tx) + P[(j * gx + i1) * 4 + c] * tx) * (1 - ty) + (P[(j1 * gx + i) * 4 + c] * (1 - tx) + P[(j1 * gx + i1) * 4 + c] * tx) * ty; };
    const R = sp ? new Uint8Array(n) : null, row = new Float32Array(gx * 4);
    for (let y = 0; y < h; y++) {
      const f = Math.min(gy - 1, Math.max(0, y / bs - 0.5)), j = Math.floor(f), j1 = Math.min(gy - 1, j + 1), ty = f - j;
      for (let q = 0; q < gx * 4; q++) row[q] = P[j * gx * 4 + q] * (1 - ty) + P[j1 * gx * 4 + q] * ty;
      for (let x = 0, i = y * w, k = i * 4; x < w; x++, i++, k += 4) {
        const a = xi[x] * 4, b = Math.min(gx - 1, xi[x] + 1) * 4, t = xt[x], s = 1 - t, pr = row[a] * s + row[b] * t, pg = row[a + 1] * s + row[b + 1] * t, pb = row[a + 2] * s + row[b + 2] * t, pl = row[a + 3] * s + row[b + 3] * t;
        if (R) R[i] = Math.min(255, L[i] * 255 / (pl || 1));
        if (bg === 1) { d[k] = d[k] * 255 / (pr * 0.94 || 1); d[k + 1] = d[k + 1] * 255 / (pg * 0.94 || 1); d[k + 2] = d[k + 2] * 255 / (pb * 0.94 || 1); }
        else if (bg === 2) { d[k] = d[k] * G[0] / (pr || 1); d[k + 1] = d[k + 1] * G[1] / (pg || 1); d[k + 2] = d[k + 2] * G[2] / (pb || 1); }
      }
    }
    if (!sp) return;
    const maxA = Math.floor((sp === 2 ? 20 : 5) * u * u); if (maxA < 1) return;
    const maxD = Math.ceil(3 * Math.sqrt(maxA)) + 1, vis = new Uint8Array(n), stack = new Int32Array(n), list = new Int32Array(maxA + 1), tmp = [0, 0, 0, 0];
    for (let s0 = 0; s0 < n; s0++) {
      if (vis[s0] || R[s0] >= 185) continue;
      let top = 0, cnt = 0, bx0 = w, bx1 = 0, by0 = h, by1 = 0; stack[top++] = s0; vis[s0] = 1;
      while (top) {
        const i = stack[--top], y = (i / w) | 0, x = i - y * w; if (cnt <= maxA) list[cnt] = i; cnt++;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= h) continue; for (let dx = -1; dx <= 1; dx++) { const nx = x + dx; if (nx < 0 || nx >= w) continue; const j = ny * w + nx; if (!vis[j] && R[j] < 185) { vis[j] = 1; stack[top++] = j; } } }
      }
      if (cnt > maxA || bx1 - bx0 >= maxD || by1 - by0 >= maxD) continue;
      for (let q = 0; q < cnt; q++) {
        const y = (list[q] / w) | 0, x = list[q] - y * w; if (bg === 1) tmp[0] = tmp[1] = tmp[2] = 255; else if (bg === 2) { tmp[0] = G[0]; tmp[1] = G[1]; tmp[2] = G[2]; } else at(x, y, tmp);
        for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= h) continue; for (let dx = -1; dx <= 1; dx++) { const nx = x + dx; if (nx < 0 || nx >= w) continue; const k = (ny * w + nx) * 4; d[k] = tmp[0]; d[k + 1] = tmp[1]; d[k + 2] = tmp[2]; } }
      }
    }
  }
}
const PdfClean = {
  w: null, n: 0, pend: new Map(),
  worker() {
    if (this.w) return this.w;
    const url = URL.createObjectURL(new Blob(['(' + pdfCleanWorker.toString() + ')()'], { type: 'text/javascript' })); const w = this.w = new Worker(url); URL.revokeObjectURL(url);
    w.onmessage = e => { const f = this.pend.get(e.data.id); if (f) { this.pend.delete(e.data.id); f(e.data); } };
    w.onerror = () => { this.pend.forEach(f => f(null)); this.pend.clear(); this.w = null; };
    return w;
  },
  run(msg, tr) { return new Promise(res => { const id = ++this.n; this.pend.set(id, res); try { this.worker().postMessage(Object.assign({ id }, msg), tr); } catch (e) { this.pend.delete(id); res(null); } }); }
};
async function pdfCleanCanvas(cv, bg, sp, rect) {
  if (!bg && !sp) return;
  const x = Math.max(0, Math.round(rect[0])), y = Math.max(0, Math.round(rect[1])), w = Math.min(cv.width - x, Math.round(rect[2])), h = Math.min(cv.height - y, Math.round(rect[3])); if (w < 16 || h < 16) return;
  const ctx = cv.getContext('2d'), u = Math.max(w, h) / 3508;
  if (PdfClean.fast !== false && typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {          // the usual way: no pixels are read on the page's own thread
    try {
      const bmp = await createImageBitmap(cv, x, y, w, h), r = await PdfClean.run({ bmp, w, h, bg, sp, u }, [bmp]);
      if (r && r.bmp) { ctx.drawImage(r.bmp, x, y); r.bmp.close(); return; }
      PdfClean.fast = false;
    } catch (e) { PdfClean.fast = false; }
  }
  const id = ctx.getImageData(x, y, w, h), r = await PdfClean.run({ buf: id.data.buffer, w, h, bg, sp, u }, [id.data.buffer]);
  if (r && !r.err) ctx.putImageData(new ImageData(new Uint8ClampedArray(r.buf), w, h), x, y);
}
/* the one place a page's edits become render options: every thumbnail, large view and export asks here. `not` leaves out one edit ('crop', 'skew' for the leveling, 'clean') for a tool's own before side or frame */
function slotGeo(sl, not) {
  const g = { crop: not === 'crop' ? null : sl.crop || null, dim: not !== 'dim' && dimKey(sl) ? sl.dim : null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0 };
  if (not !== 'skew') { g.skew = sl.skew || 0; g.vskew = sl.vskew || 0; g.warp = sl.warp || 0; }
  if (not !== 'clean') { g.bg = sl.bg || 0; g.sp = sl.sp || 0; }
  return g.crop || g.dim || g.skew || g.vskew || g.warp || g.bg || g.sp ? g : null;
}
/* where a Dim box lands on the drawn page: the box is in the file's own page, so it is cut to the crop and turned with the page (rot, clockwise) before it is laid on the page rectangle */
const DIM_ALPHA = 0.62;
function dimRect(b, rot, cr, px, py, pw, ph) {
  cr = cr || [0, 0, 1, 1]; const cw = cr[2] - cr[0], chh = cr[3] - cr[1], f = (v, a, w) => clamp((v - a) / w, 0, 1);
  const u0 = f(b[0], cr[0], cw), u1 = f(b[2], cr[0], cw), v0 = f(b[1], cr[1], chh), v1 = f(b[3], cr[1], chh), r = ((rot || 0) % 360 + 360) % 360;
  const pt = (u, v) => r === 90 ? [1 - v, u] : r === 180 ? [1 - u, 1 - v] : r === 270 ? [v, 1 - u] : [u, v], A = pt(u0, v0), B = pt(u1, v1);
  const x0 = Math.min(A[0], B[0]), x1 = Math.max(A[0], B[0]), y0 = Math.min(A[1], B[1]), y1 = Math.max(A[1], B[1]);
  return [px + x0 * pw, py + y0 * ph, (x1 - x0) * pw, (y1 - y0) * ph];
}
function paintDim(ctx, boxes, rot, cr, px, py, pw, ph) {
  ctx.save(); ctx.fillStyle = 'rgba(255,255,255,' + DIM_ALPHA + ')';
  boxes.forEach(b => { const q = dimRect(b, rot, cr, px, py, pw, ph); if (q[2] > 0 && q[3] > 0) ctx.fillRect(q[0], q[1], q[2], q[3]); });
  ctx.restore();
}
async function renderPdfPage(doc, idx, w, h, rot = 0, wm = null, geo = null) {
  const page = await doc.getPage(idx + 1);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  let px, py, pw, ph;
  if (geo && geo.warp) { const r = await renderWarped(page, cv, ctx, w, h, rot, geo); px = r[0]; py = r[1]; pw = r[2]; ph = r[3]; }
  else if (!geo || (!geo.crop && !geo.skew && !geo.vskew)) {
    const rotation = ((page.rotate || 0) + rot) % 360;
    const v1 = page.getViewport({ scale: 1, rotation });
    const sc = Math.min(w / v1.width, h / v1.height);
    const vp = page.getViewport({ scale: sc, rotation });
    await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, (w - vp.width) / 2, (h - vp.height) / 2], background: '#ffffff' }).promise;
    px = (w - vp.width) / 2; py = (h - vp.height) / 2; pw = vp.width; ph = vp.height;
  } else {
    /* the page straightened (turned a little about its middle), cut to the crop, turned by the page's rotation, and fitted into the picture */
    const v0 = page.getViewport({ scale: 1, rotation: page.rotate || 0 }), Ws = v0.width, Hs = v0.height, cr = geo.crop || [0, 0, 1, 1];
    const cw = (cr[2] - cr[0]) * Ws, ch = (cr[3] - cr[1]) * Hs, side = rot % 180 !== 0, vw0 = side ? ch : cw, vh0 = side ? cw : ch, sc = Math.min(w / vw0, h / vh0);
    const m = new DOMMatrix(); m.translateSelf(w / 2, h / 2); m.scaleSelf(sc); m.rotateSelf(rot); m.translateSelf(-(cr[0] + cr[2]) / 2 * Ws, -(cr[1] + cr[3]) / 2 * Hs);
    m.translateSelf(Ws / 2, Hs / 2); m.multiplySelf(skewMat(geo.skew, geo.vskew)); m.translateSelf(-Ws / 2, -Hs / 2);
    pw = vw0 * sc; ph = vh0 * sc; px = (w - pw) / 2; py = (h - ph) / 2;
    await page.render({ canvasContext: ctx, viewport: v0, transform: [m.a, m.b, m.c, m.d, m.e, m.f], background: '#ffffff' }).promise;
    { const cx0 = Math.round(px), cy0 = Math.round(py), cx1 = Math.round(px + pw), cy1 = Math.round(py + ph); if (cx0 > 0 || cy0 > 0 || cx1 < w || cy1 < h) {          // nothing outside the cropped page shows: painted over white afterward, because a clip set before the render makes a large scan vanish
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, Math.max(0, cy0)); ctx.fillRect(0, cy1, w, Math.max(0, h - cy1)); ctx.fillRect(0, cy0, Math.max(0, cx0), cy1 - cy0); ctx.fillRect(cx1, cy0, Math.max(0, w - cx1), cy1 - cy0); } }
  }
  try { page.cleanup(); } catch (e) {}
  if (geo && (geo.bg || geo.sp)) await pdfCleanCanvas(cv, geo.bg || 0, geo.sp || 0, [px, py, pw, ph]);
  if (geo && geo.dim) paintDim(ctx, geo.dim, rot, geo.crop, px, py, pw, ph);
  if (wm) drawWatermark(ctx, wm, px, py, pw, ph);
  return cv;
}
const PageSource = {
  q: [], active: 0,
  render(idx, w, h) {
    return new Promise((res, rej) => {
      const sl = S.pdf && S.pdf.slots[idx]; if (!sl) { rej(new Error('no such page')); return; }
      this.q.push({ geo: slotGeo(sl), src: sl.src, rot: sl.rot || 0, wm: S.pdf.wm && S.pdf.wm.on && !sl.nw ? Object.assign({}, S.pdf.wm) : null, w, h, res, rej, doc: S.pdf.doc }); this.pump();
    });
  },
  pump() {
    while (this.active < 2 && this.q.length) {
      const j = this.q.pop(); this.active++;
      renderPdfPage(j.doc, j.src, j.w, j.h, j.rot, j.wm, j.geo).then(j.res, j.rej).finally(() => { this.active--; this.pump(); });
    }
  }
};

/* ---------- the page recipe ----------
   The score is a list of "slots". Each slot is one page of the video: a source page of the PDF, a rotation, whether it is left out,
   and whether it is a repeat. `order` is the order they are arranged in (including pages left out); `keep` is what the video uses. */
const WM_DEFAULT = { on: false, text: 'Perusal score', angle: 45, opacity: 20, mode: 'center', b: true, i: false };      // angle in degrees, counter-clockwise (45 diagonal, 0 straight, any other is custom); opacity in percent
/* Dim regions: boxes on a page, each [x0, y0, x1, y1] as fractions of the page as the file draws it (before the page's own turn and before the crop), so they stay put when either changes */
const dimKey = s => s && s.dim && s.dim.length ? s.dim.map(b => b.map(v => Math.round(v * 10000)).join(',')).join(';') : '';
const peCopy = r => ({ size: r.size && r.size.w > 0 && r.size.h > 0 ? { w: +r.size.w, h: +r.size.h } : null, each: !!r.each, slots: r.slots.map(s => s ? { src: s.src, rot: s.rot || 0, x: !!s.x, c: !!s.c, nw: !!s.nw, crop: s.crop ? s.crop.slice() : null, dim: s.dim && s.dim.length ? s.dim.map(b => b.slice()) : null, skew: s.skew || 0, vskew: s.vskew || 0, warp: s.warp || 0, bg: s.bg || 0, sp: s.sp || 0, half: s.half || '' } : null), order: r.order.slice(), wm: Object.assign({}, WM_DEFAULT, r.wm || {}) });
const identityRecipe = n => ({ slots: Array.from({ length: n }, (_, i) => ({ src: i, rot: 0, x: false, c: false, nw: false, crop: null, dim: null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' })), order: Array.from({ length: n }, (_, i) => i), wm: Object.assign({}, WM_DEFAULT), size: null, each: false });
const recipeOf = () => peCopy({ slots: S.pdf.slots, order: S.pdf.order, wm: S.pdf.wm, size: S.pdf.size, each: S.pdf.each });
const recipeKeep = r => r.order.filter(id => r.slots[id] && !r.slots[id].x);
const recipeSig = r => JSON.stringify([r.order.map(id => { const s = r.slots[id]; return [id, s.src, s.rot || 0, s.x ? 1 : 0, s.c ? 1 : 0, s.nw ? 1 : 0, s.crop || 0, s.skew || 0, s.vskew || 0, s.warp || 0, s.bg || 0, s.sp || 0, s.half || 0, dimKey(s) || 0]; }), r.wm.on ? [r.wm.text, r.wm.angle, r.wm.opacity, r.wm.mode, r.wm.b ? 1 : 0, r.wm.i ? 1 : 0] : 0, r.size ? [r.size.w, r.size.h, r.each ? 1 : 0] : 0]);
/* the shape every page of the video is fitted into: the first kept page after its crop, or the chosen paper size */
function recipeAspect(r) {
  const k0 = r.slots[recipeKeep(r)[0]], ca = k0 && k0.crop ? S.pdf.aspect0 * (k0.crop[2] - k0.crop[0]) / (k0.crop[3] - k0.crop[1]) : S.pdf.aspect0;
  if (r.size) { const d = sizeDims(r.size, ca); return d[0] / d[1]; } return ca;
}
function setRecipe(r) {
  const c = peCopy(r); S.pdf.slots = c.slots; S.pdf.order = c.order; S.pdf.wm = c.wm; S.pdf.keep = recipeKeep(c);
  const na = recipeAspect(c), resized = Math.abs(na - S.pdf.aspect) > 1e-6;
  S.pdf.size = c.size; S.pdf.each = c.each; S.pdf.aspect = na;
  if (!S.pdf.keep.length) { c.slots.forEach(s => { if (s) s.x = false; }); S.pdf.keep = recipeKeep(c); }
  if (typeof previewR !== 'undefined' && previewR) previewR.clearTextures();
  if (resized && S.thumbs && S.thumbs.length) { S.thumbs = new Array(S.pdf.n).fill(null); makeThumbs(loadToken); TL.staticDirty = true; stageDirty = true; }          // pictures are drawn again at the new page shape
}
/* Page sizes (in inches). A document is resized as a whole; the target keeps the document's own orientation. */
const RZ_PRESETS = [{ k: 'letter', n: 'Letter', w: 8.5, h: 11 }, { k: 'concert', n: 'Concert', w: 9, h: 12 }, { k: 'tabloid', n: 'Tabloid', w: 11, h: 17 }, { k: '12x18', n: '12 × 18', w: 12, h: 18 }, { k: 'a4', n: 'A4', w: 8.27, h: 11.69 }, { k: 'a3', n: 'A3', w: 11.69, h: 16.54 }];
const sizeDims = (size, a0) => { const lo = Math.min(size.w, size.h), hi = Math.max(size.w, size.h); return a0 > 1.0001 ? [hi, lo] : [lo, hi]; };
const rzNum = v => String(Math.round(v * 100) / 100);
const rzName = (w, h) => { const lo = Math.min(w, h), hi = Math.max(w, h), p = RZ_PRESETS.find(q => Math.abs(q.w - lo) < 0.06 && Math.abs(q.h - hi) < 0.06); return p ? p.n : ''; };
function setOmit(omit) {                       // the older way of saying it: pages left out, in their own order
  const r = identityRecipe(S.pdf.n); r.wm = Object.assign({}, S.pdf.wm || WM_DEFAULT); r.slots.forEach(s => { s.x = omit.has(s.src); });
  if (r.slots.every(s => s.x)) r.slots.forEach(s => { s.x = false; });
  setRecipe(r);
}
/* true when the recipe is only "some pages left out" (so it can be saved the short way) */
const recipeIsSimple = r => !r.wm.on && !r.size && r.order.every((id, i) => id === i && !r.slots[id].rot && !r.slots[id].c && !r.slots[id].nw && !r.slots[id].crop && !r.slots[id].skew && !r.slots[id].vskew && !r.slots[id].warp && !r.slots[id].bg && !r.slots[id].sp && !r.slots[id].half && !dimKey(r.slots[id])) && r.order.length === S.pdf.n;
/* a position in the video (1, 2, 3 ...) for a page, so labels follow the edited order */
const pageNo = idx => { const i = S.pdf ? S.pdf.keep.indexOf(idx) : -1; return i >= 0 ? i + 1 : idx + 1; };
/* a short list for the settings file: [{p: page, r: rotation, x: left out, c: repeat}] in the arranged order */
const recipeToList = r => r.order.map(id => { const s = r.slots[id], e = { p: s.src + 1 }; if (s.rot) e.r = s.rot; if (s.x) e.x = 1; if (s.c) e.c = 1; if (s.nw) e.n = 1; if (s.crop) e.k = s.crop.map(v => Math.round(v * 10000) / 10000); if (s.skew) e.s = Math.round(s.skew * 100) / 100; if (s.vskew) e.v = Math.round(s.vskew * 100) / 100; if (s.warp) e.w = Math.round(s.warp * 10000) / 10000; if (s.bg) e.g = s.bg; if (s.sp) e.q = s.sp; if (s.half) e.h = s.half; if (dimKey(s)) e.d = s.dim.map(b => b.map(v => Math.round(v * 10000) / 10000)); return e; });
function recipeFromList(list, n, wm) {
  if (!Array.isArray(list) || !list.length || list.length > 500) return null;
  const slots = [], order = [];
  for (const e of list) {
    if (!e || !Number.isInteger(e.p) || e.p < 1 || e.p > n) return null;
    const rot = e.r === undefined ? 0 : e.r; if (![0, 90, 180, 270].includes(rot)) return null;
    let crop = null; if (e.k !== undefined) { if (!Array.isArray(e.k) || e.k.length !== 4 || !e.k.every(v => Number.isFinite(v) && v >= 0 && v <= 1) || e.k[2] - e.k[0] < 0.02 || e.k[3] - e.k[1] < 0.02) return null; crop = e.k.slice(); }
    const warp = e.w === undefined ? 0 : e.w; if (!Number.isFinite(warp) || Math.abs(warp) > 0.2) return null;
    const skew = e.s === undefined ? 0 : e.s, vskew = e.v === undefined ? 0 : e.v; if (!Number.isFinite(skew) || Math.abs(skew) > 15 || !Number.isFinite(vskew) || Math.abs(vskew) > 15) return null;
    const bg = e.g === undefined ? 0 : e.g, sp = e.q === undefined ? 0 : e.q; if (![0, 1, 2].includes(bg) || ![0, 1, 2].includes(sp)) return null;
    let dim = null; if (e.d !== undefined) { if (!Array.isArray(e.d) || e.d.length > 50 || !e.d.every(b => Array.isArray(b) && b.length === 4 && b.every(v => Number.isFinite(v) && v >= 0 && v <= 1) && b[2] - b[0] >= 0.005 && b[3] - b[1] >= 0.005)) return null; dim = e.d.length ? e.d.map(b => b.slice()) : null; }
    order.push(slots.length); slots.push({ src: e.p - 1, rot, x: !!e.x, c: !!e.c, nw: !!e.n, crop, dim, skew, vskew, warp, bg, sp, half: e.h === 'L' || e.h === 'R' ? e.h : '' });
  }
  if (slots.every(s => s.x)) return null;
  return { slots, order, wm: wmFromJson(wm) };
}
/* a watermark read from a file: only values this site understands */
function wmFromJson(o) {
  const w = Object.assign({}, WM_DEFAULT); if (!o || typeof o !== 'object') return w;
  if (typeof o.on === 'boolean') w.on = o.on;
  if (typeof o.text === 'string') w.text = o.text.slice(0, 60);
  if (Number.isFinite(o.angle)) w.angle = clamp(Math.round(o.angle), -180, 180);
  if (typeof o.b === 'boolean') w.b = o.b;
  if (typeof o.i === 'boolean') w.i = o.i;
  if (o.mode === 'center' || o.mode === 'tile') w.mode = o.mode;
  if (Number.isFinite(o.opacity)) w.opacity = clamp(Math.round(o.opacity), 5, 60);
  return w;
}
/* ---- the watermark: one layout, used for the video, the thumbnails and the exported PDF ----
   Positions are in the page's own space (origin top left, y down). `measure(size)` gives the text's width at a font size. */
function wmLayout(pw, ph, wm, measure) {
  const a = wm.angle * Math.PI / 180, base = 100, tw100 = Math.max(1, measure(base)), items = [];
  if (wm.mode === 'tile') {
    const size = Math.max(6, Math.min(pw, ph) * 0.055), tw = measure(size), su = tw + size * 2.6, sv = size * 3.4, R = Math.hypot(pw, ph) / 2 + tw;
    let row = 0;
    for (let v = -R; v <= R; v += sv, row++) for (let u = -R + (row % 2) * su / 2; u <= R; u += su) {
      const x = pw / 2 + u * Math.cos(a) - v * Math.sin(a), y = ph / 2 - (u * Math.sin(a) + v * Math.cos(a));
      if (x > -tw / 2 && x < pw + tw / 2 && y > -size && y < ph + size) items.push({ x, y });
    }
    return { size, items };
  }
  const len = 0.82 * Math.min(pw / Math.max(1e-6, Math.abs(Math.cos(a))), ph / Math.max(1e-6, Math.abs(Math.sin(a))));      // the longest line through the middle that stays inside the page
  const size = Math.min(base * len / tw100, Math.min(pw, ph) * 0.2);
  return { size, items: [{ x: pw / 2, y: ph / 2 }] };
}
const WM_FONT = 'Helvetica, Arial, "Helvetica Neue", sans-serif';
const wmFont = (wm, size) => (wm.i ? 'italic ' : '') + (wm.b === false ? 400 : 700) + ' ' + size + 'px ' + WM_FONT;
function drawWatermark(ctx, wm, x0, y0, pw, ph) {
  const text = (wm.text || '').trim(); if (!wm.on || !text) return;
  const meas = ctx.measureText ? s => { ctx.font = wmFont(wm, s); return ctx.measureText(text).width; } : null;
  const L = wmLayout(pw, ph, wm, meas);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, pw, ph); ctx.clip();
  ctx.globalAlpha = clamp(wm.opacity, 5, 60) / 100; ctx.fillStyle = '#000'; ctx.font = wmFont(wm, L.size); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  L.items.forEach(it => { ctx.save(); ctx.translate(x0 + it.x, y0 + it.y); ctx.rotate(-wm.angle * Math.PI / 180); ctx.fillText(text, 0, 0); ctx.restore(); });
  ctx.restore();
}
/* a page's picture with its crop and straightening applied (drawn again at thumbnail size, once, then remembered); pages without either use the plain thumbnail */
const VT = new Map(), VTpending = new Set();
/* every PDF gets a number of its own, and everything remembered about the one before (page pictures, scans, shapes, frames) is dropped when another PDF is opened or removed */
let PDF_GEN = 0;
function pdfCachesReset() {
  VT.clear(); VTpending.clear(); PEA.cache.clear();
  if (typeof PE !== 'undefined') { PE.asp = null; PE.cropScans && PE.cropScans.clear(); PE.raw && PE.raw.clear(); PE.full && PE.full.clear(); PE.rawOne = null; PE.posWas && PE.posWas.clear(); }
}
function slotBase(sl, aspect) {
  if (!sl) return null; if (!sl.crop && !sl.skew && !sl.vskew && !sl.warp && !sl.bg && !sl.sp && !dimKey(sl)) return S.thumbs[sl.src] || null;
  const key = sl.src + '|' + (sl.crop ? sl.crop.join(',') : '') + '|' + (sl.skew || 0) + '|' + (sl.vskew || 0) + '|' + (sl.warp || 0) + '|' + (sl.bg || 0) + (sl.sp || 0) + '|' + dimKey(sl) + '|' + aspect.toFixed(4) + '|' + (S.pdf ? S.pdf.gen || 0 : 0), hit = VT.get(key);
  if (hit) return hit;
  if (!VTpending.has(key) && S.pdf) {
    VTpending.add(key); const doc = S.pdf.doc, w = Math.max(20, Math.round(240 * aspect));
    renderPdfPage(doc, sl.src, w, 240, 0, null, slotGeo(sl)).then(cv => { VT.set(key, cv); if (VT.size > 120) VT.delete(VT.keys().next().value); VTpending.delete(key); TL.staticDirty = true; stageDirty = true; if (typeof peRepaint === 'function' && PE.d && !$('#pdfDlg').hidden) peRepaint(); }, () => VTpending.delete(key));
  }
  return S.thumbs[sl.src] || null;
}
/* a page picture for the timeline and the editor, turned if the page is rotated */
function slotThumb(idx) {
  const sl = S.pdf && S.pdf.slots[idx]; if (!sl) return null;
  const t = slotBase(sl, S.pdf.aspect); if (!t) return null;
  if (!sl.rot) return t;
  if (sl._rt && sl._rt.rot === sl.rot && sl._rt.base === t) return sl._rt.cv;
  const cv = document.createElement('canvas'); cv.width = t.width; cv.height = t.height; const x = cv.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.translate(cv.width / 2, cv.height / 2); x.rotate(sl.rot * Math.PI / 180);
  const s = sl.rot === 180 ? 1 : Math.min(cv.width / cv.height, cv.height / cv.width); x.scale(s, s); x.drawImage(t, -t.width / 2, -t.height / 2);
  sl._rt = { rot: sl.rot, base: t, cv }; return cv;
}

/* ---------- looking at the pages: margins, two-page spreads, tilt ----------
   Everything here runs on this device. A page is drawn small in grey, and the ink on it is measured. */
const PEA = { cache: new Map() };
async function peScan(idx, width = 760, geo = null) {
  const hit = geo ? null : PEA.cache.get(idx); if (hit) return hit;
  const page = await S.pdf.doc.getPage(idx + 1), v = page.getViewport({ scale: 1, rotation: page.rotate || 0 }), w = width, h = Math.max(8, Math.round(width * v.height / v.width));
  const cv = await renderPdfPage(S.pdf.doc, idx, w, h, 0, null, geo), px = cv.getContext('2d').getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
  cv.width = cv.height = 0;          // the picture is not kept, only what was measured; freeing it now stops Safari holding hundreds of them until it next collects
  for (let i = 0, k = 0; i < g.length; i++, k += 4) g[i] = (px[k] * 77 + px[k + 1] * 150 + px[k + 2] * 29) >> 8;
  const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let acc = 0, bg = 255; for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc > g.length * 0.08) { bg = t; break; } }          // the paper: bright, so the 92nd percentile
  const lim = Math.max(30, bg * 0.7), ink = new Uint8Array(w * h); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] < lim) { ink[i] = 1; n++; }
  const r = { w, h, ink, n, aspect: v.width / v.height }; if (!geo) { PEA.cache.set(idx, r); if (PEA.cache.size > 10) PEA.cache.delete(PEA.cache.keys().next().value); } return r;
}
/* where the music is, as fractions of the page. Scans bring their own clutter, so before the box is drawn:
   1. dark bands along the edges (the scanner lid, shadows, a black border) are peeled off, edge by edge, while a line is mostly dark;
   2. the ink is profiled across and down, and runs of ink are grouped. Small, separate bits close to the edges (hole punches, specks,
      dust) are dropped, while anything well inside the page (a title, a page number) is kept. */
function peInkBox(sc, pad, reg) {
  const { w, h, ink } = sc, R = reg || [0, 0, 1, 1], rx0 = Math.max(0, Math.floor(R[0] * w)), rx1 = Math.min(w, Math.ceil(R[2] * w)), ry0 = Math.max(0, Math.floor(R[1] * h)), ry1 = Math.min(h, Math.ceil(R[3] * h));
  const prof = (x0, x1, y0, y1) => { const cols = new Uint32Array(w), rows = new Uint32Array(h); for (let y = y0; y < y1; y++) for (let x = x0, i = y * w + x0; x < x1; x++, i++) if (ink[i]) { cols[x]++; rows[y]++; } return { cols, rows }; };
  let x0 = rx0, x1 = rx1, y0 = ry0, y1 = ry1;
  for (let pass = 0; pass < 2; pass++) {                          // twice: a band along one edge adds to every line that crosses it
    const { cols, rows } = prof(x0, x1, y0, y1), W = x1 - x0, H = y1 - y0, dx = Math.round(W * 0.25), dy = Math.round(H * 0.25), dc = H * 0.4, dr = W * 0.4;
    const peel = (a, b, step, n, dense, lim) => { let i = a, hit = false; while (i !== b && Math.abs(i - a) < lim && n[i] > dense) { i += step; hit = true; } return hit ? i + step * Math.round(lim * 0.06) : a; };
    const nx0 = peel(x0, x1, 1, cols, dc, dx), nx1 = peel(x1 - 1, x0, -1, cols, dc, dx) + 1, ny0 = peel(y0, y1, 1, rows, dr, dy), ny1 = peel(y1 - 1, y0, -1, rows, dr, dy) + 1;
    if (nx1 - nx0 < W * 0.4 || ny1 - ny0 < H * 0.4) break;
    x0 = nx0; x1 = nx1; y0 = ny0; y1 = ny1;
  }
  const { cols, rows } = prof(x0, x1, y0, y1);
  /* the span of the real content along one direction */
  const span = (n, a, b, other, full0, full1, zone, big) => {          // zone: how far in from the edge clutter is looked for; big: the share of ink that is always kept
    const thr = Math.max(2, other * 0.004), gap = Math.max(3, (full1 - full0) * 0.025), edge = (full1 - full0) * zone, segs = [];
    let s = -1, last = -1, mass = 0;
    for (let i = a; i < b; i++) { if (n[i] >= thr) { if (s < 0) { s = i; mass = 0; } else if (i - last > gap) { segs.push([s, last + 1, mass]); s = i; mass = 0; } last = i; mass += n[i]; } }
    if (s >= 0) segs.push([s, last + 1, mass]);
    if (!segs.length) return null;
    const total = segs.reduce((t, q) => t + q[2], 0), keep = segs.filter(q => q[2] >= total * big || (q[0] > full0 + edge && q[1] < full1 - edge));
    const k = keep.length ? keep : [segs.reduce((m, q) => q[2] > m[2] ? q : m)];
    return [k[0][0], k[k.length - 1][1]];
  };
  const sx = span(cols, x0, x1, y1 - y0, rx0, rx1, 0.13, 0.08), sy = span(rows, y0, y1, x1 - x0, ry0, ry1, 0.04, 0.02);          // the sides hold punch holes and binding shadow; top and bottom only a thin strip
  if (!sx || !sy || sx[1] - sx[0] < (rx1 - rx0) * 0.05 || sy[1] - sy[0] < (ry1 - ry0) * 0.05) return null;          // a blank or nearly blank page has nothing to frame
  return [clamp(sx[0] / w - pad, R[0], 1), clamp(sy[0] / h - pad, R[1], 1), clamp(sx[1] / w + pad, 0, R[2]), clamp(sy[1] / h + pad, 0, R[3])];
}
/* a part of the page (fractions) in the scan's own dots; the whole scan when none is given */
const peRegPx = (sc, reg) => reg ? [Math.max(0, Math.floor(reg[0] * sc.w)), Math.max(0, Math.floor(reg[1] * sc.h)), Math.min(sc.w, Math.ceil(reg[2] * sc.w)), Math.min(sc.h, Math.ceil(reg[3] * sc.h))] : [0, 0, sc.w, sc.h];
/* how far the upright strokes (bar lines, stems) lean, clockwise positive; near `rigid` (the lines' own tilt) unless the strokes clearly line up better at another angle */
function peLean(sc, rigid, reg) {
  const { w, h, ink } = sc, xs = [], ys = [], R = peRegPx(sc, reg); const step = Math.max(1, Math.floor(Math.sqrt(sc.n / 50000)));
  for (let y = R[1]; y < R[3]; y += step) for (let x = R[0]; x < R[2]; x += step) if (ink[y * w + x]) { xs.push(x - w / 2); ys.push(y - h / 2); }
  if (xs.length < 800) return { deg: rigid, gain: 0 };
  const nb = w * 2, hist = new Float64Array(nb), score = d => { const t = Math.tan(d * Math.PI / 180); hist.fill(0); for (let i = 0; i < xs.length; i++) { const xx = (xs[i] + ys[i] * t + w) | 0; if (xx >= 0 && xx < nb) hist[xx]++; } let q = 0; for (let i = 0; i < nb; i++) q += hist[i] * hist[i]; return q; };
  const s0 = score(rigid); let best = rigid, bs = s0;
  for (let d = rigid - 1.5; d <= rigid + 1.5001; d += 0.25) { const v = score(d); if (v > bs) { bs = v; best = d; } }
  const c = best; for (let d = c - 0.25; d <= c + 0.2501; d += 0.05) { const v = score(d); if (v > bs) { bs = v; best = d; } }
  const gain = s0 > 0 ? bs / s0 - 1 : 0; return gain < 0.03 ? { deg: rigid, gain } : { deg: Math.round(best * 100) / 100, gain };
}
/* tilt that changes from the top of the page to the bottom (a photo taken at an angle): after the straight turn is done, how much more the rows still slant, per page height */
function peWarp(sc, skew, vskew) {
  const { w, h, ink } = sc, A = skewMat(skew, vskew), xs = [], ys = []; const step = Math.max(1, Math.floor(Math.sqrt(sc.n / 50000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (ink[y * w + x]) { const p = A.transformPoint(new DOMPoint(x - w / 2, y - h / 2)); xs.push(p.x); ys.push(p.y); }
  if (xs.length < 800) return { k: 0, gain: 0 };
  const nb = h * 2, hist = new Float64Array(nb), score = k => { hist.fill(0); for (let i = 0; i < xs.length; i++) { const yy = (ys[i] - k * (ys[i] / h) * xs[i] + h) | 0; if (yy >= 0 && yy < nb) hist[yy]++; } let q = 0; for (let i = 0; i < nb; i++) q += hist[i] * hist[i]; return q; };
  const s0 = score(0); let best = 0, bs = s0;
  for (let k = -0.05; k <= 0.0501; k += 0.005) { const v = score(k); if (v > bs) { bs = v; best = k; } }
  const c = best; for (let k = c - 0.005; k <= c + 0.00501; k += 0.001) { const v = score(k); if (v > bs) { bs = v; best = k; } }
  const gain = s0 > 0 ? bs / s0 - 1 : 0; return gain < 0.04 || Math.abs(best) < 0.004 ? { k: 0, gain } : { k: Math.round(best * 10000) / 10000, gain };
}
/* the turn and the bend together: both are searched, one after the other a few times, for the setting that makes the rows of ink sharpest */
function peFit(sc, reg) {
  const { w, h, ink } = sc, xs = [], ys = [], R = peRegPx(sc, reg); const step = Math.max(1, Math.floor(Math.sqrt(sc.n / 50000)));
  for (let y = R[1]; y < R[3]; y += step) for (let x = R[0]; x < R[2]; x += step) if (ink[y * w + x]) { xs.push(x - w / 2); ys.push(y - h / 2); }
  if (xs.length < 800) return { a: 0, k: 0, gain: 0 };
  const nb = h * 2, hist = new Float64Array(nb);
  const score = (a, k) => { const r = a * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); hist.fill(0); for (let i = 0; i < xs.length; i++) { const x1 = xs[i] * c + ys[i] * sn, y1 = ys[i] * c - xs[i] * sn, yy = (y1 - k * (y1 / h) * x1 + h) | 0; if (yy >= 0 && yy < nb) hist[yy]++; } let q = 0; for (let i = 0; i < nb; i++) q += hist[i] * hist[i]; return q; };
  const s0 = score(0, 0); let a = 0, k = 0, bs = s0;
  for (let round = 0; round < 3; round++) {
    const rng = round === 0 ? 5 : 0.6 / round, st = round === 0 ? 0.5 : 0.1 / round; let c = a;
    for (let d = c - rng; d <= c + rng + 1e-9; d += st) { const v = score(d, k); if (v > bs) { bs = v; a = d; } }
    c = k; const kr = round === 0 ? 0.05 : 0.01 / round, ks = round === 0 ? 0.005 : 0.0015 / round;
    for (let d = c - kr; d <= c + kr + 1e-9; d += ks) { const v = score(a, d); if (v > bs) { bs = v; k = d; } }
  }
  for (let d = a - 0.1; d <= a + 0.1001; d += 0.02) { const v = score(d, k); if (v > bs) { bs = v; a = d; } }
  return { a: Math.round(a * 100) / 100, k: Math.round(k * 10000) / 10000, gain: s0 > 0 ? bs / s0 - 1 : 0 };
}
/* the gap between two pages scanned side by side: where the least ink is, near the middle */
function peGutter(sc, reg) {                                      // within `reg` (a crop) when given
  const { w, h, ink } = sc, R = reg || [0, 0, 1, 1], ax = Math.round(R[0] * w), bx = Math.round(R[2] * w), ay = Math.round(R[1] * h), by = Math.round(R[3] * h), cols = new Float32Array(w);
  for (let y = ay; y < by; y++) for (let x = ax, i = y * w + ax; x < bx; x++, i++) if (ink[i]) cols[x]++;
  const W = bx - ax, mid = (ax + bx) / 2, win = Math.max(2, Math.round(W * 0.012)), lo = Math.round(ax + W * 0.38), hi = Math.round(ax + W * 0.62); let best = Math.round(mid), bv = 1e18;
  for (let x = lo; x < hi; x++) { let v = 0; for (let k = -win; k <= win; k++) v += cols[x + k] || 0; v += Math.abs(x - mid) * 0.02; if (v < bv) { bv = v; best = x; } }
  return best / w;
}
/* how far a page is tilted, in degrees (clockwise is positive): the turn that makes the rows of ink sharpest, which is what staff lines do when they are level */
function peTilt(sc) {
  const { w, h, ink } = sc, xs = [], ys = []; let step = Math.max(1, Math.floor(Math.sqrt(sc.n / 50000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (ink[y * w + x]) { xs.push(x - w / 2); ys.push(y - h / 2); }
  if (xs.length < 800) return { deg: 0, gain: 0 };
  const nb = h * 2, hist = new Float64Array(nb), score = d => { const a = d * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); hist.fill(0); for (let i = 0; i < xs.length; i++) { const yy = (ys[i] * c - xs[i] * s + h) | 0; if (yy >= 0 && yy < nb) hist[yy]++; } let t = 0; for (let i = 0; i < nb; i++) t += hist[i] * hist[i]; return t; };
  let best = 0, bs = -1; for (let d = -5; d <= 5.001; d += 0.5) { const sv = score(d); if (sv > bs) { bs = sv; best = d; } }
  let lo = best - 0.5, hi = best + 0.5; for (let d = lo; d <= hi + 1e-9; d += 0.1) { const sv = score(d); if (sv > bs) { bs = sv; best = d; } }
  lo = best - 0.1; hi = best + 0.1; for (let d = lo; d <= hi + 1e-9; d += 0.02) { const sv = score(d); if (sv > bs) { bs = sv; best = d; } }
  const s0 = score(0); return { deg: Math.round(best * 100) / 100, gain: s0 > 0 ? bs / s0 - 1 : 0 };
}

let loadToken = 0;
/* a small window that asks for a PDF's password; resolves with the password, or null if you cancel */
function askPdfPassword(name, wrong, restricted) {
  return new Promise(res => {
    const dlg = $('#pwDlg'), inp = $('#pwIn'); $('#pwFile').textContent = name; $('#pwTitle').textContent = restricted ? 'This PDF is restricted' : 'This PDF is locked'; $('#pwCancel').textContent = restricted ? 'Skip' : 'Cancel'; inp.value = ''; inp.type = 'password'; $('#pwEye').setAttribute('aria-pressed', 'false');
    foldSet('#pwErrFold', !!wrong); setBusy('', ''); sheetShow(dlg); setTimeout(() => inp.focus({ preventScroll: true }), 50);
    const done = v => { dlg.removeEventListener('click', onClick); inp.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onEsc, true); sheetHide(dlg); inp.value = ''; res(v); };
    const onClick = e => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'pwOk') { if (inp.value) done(inp.value); else inp.focus(); } else if (b.id === 'pwCancel') done(null); else if (b.id === 'pwEye') { const on = inp.type === 'password'; inp.type = on ? 'text' : 'password'; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Hide password' : 'Show password'); } };
    const onKey = e => { if (e.key === 'Enter') { e.preventDefault(); if (inp.value) done(inp.value); } e.stopPropagation(); }, onEsc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    dlg.addEventListener('click', onClick); inp.addEventListener('keydown', onKey); document.addEventListener('keydown', onEsc, true);
  });
}
async function loadPdf(file) {
  peClearStatus();
  const token = ++loadToken;
  setBusy('Reading…', 'pdf', file.name.replace(/\.pdf$/i, ''));
  try {
    const lib = await getPdfjs();
    const bytes = async () => new Uint8Array(await file.arrayBuffer());          // read again for each try, so the file is never held in two copies here (the engine keeps its own)
    let doc = null, pass, wrong = false, needed = false, restricted = false, enc = false;
    for (;;) {          // a locked score asks for its password (the password stays in this tab and is never saved)
      try { doc = await lib.getDocument({ data: await bytes(), password: pass }).promise; break; }
      catch (e) { if (!(e && e.name === 'PasswordException')) throw e; needed = true; pass = await askPdfPassword(file.name, wrong); if (pass == null) { if (token === loadToken) setBusy(''); return; } wrong = true; setBusy('Reading…', 'pdf', file.name.replace(/\.pdf$/i, '')); }
    }
    if (token !== loadToken) return;
    if (!needed) {          // opens freely but forbids editing or assembling: ask for the owner password, or Skip to open it read-only
      const perms = await doc.getPermissions(); enc = perms != null; const F = lib.PermissionFlag || { MODIFY_CONTENTS: 8, ASSEMBLE: 1024 };
      if (perms && !(perms.includes(F.MODIFY_CONTENTS) && perms.includes(F.ASSEMBLE))) {
        restricted = true; let bad = false;
        for (;;) {
          const owner = await askPdfPassword(file.name, bad, true); if (token !== loadToken) return; if (owner == null) break;
          try { const d2 = await lib.getDocument({ data: await bytes(), password: owner }).promise; doc = d2; restricted = false; break; }
          catch (e) { if (!(e && e.name === 'PasswordException')) throw e; bad = true; }
        }
        setBusy('Reading…', 'pdf', file.name.replace(/\.pdf$/i, ''));
      }
    }
    const p1 = await doc.getPage(1);
    const vp = p1.getViewport({ scale: 1 });
    Transport.pause();
    const prior = S.pdf && S.turnsEdited && S.turns.length ? { turns: S.turns.slice(), edited: true, ph: S.ph.slice() } : (S.savedTurns || null);          // your own turns come along to the next score; they wait in savedTurns until a score with 2 or more spreads can use them
    S.pdf = { doc, file, locked: needed, restricted, enc: enc || needed, n: doc.numPages, name: file.name.replace(/\.pdf$/i, ''), aspect: vp.width / vp.height, aspect0: vp.width / vp.height, pw: vp.width, ph: vp.height, size: null, gen: ++PDF_GEN * 1000 }; pdfCachesReset();
    setRecipe(identityRecipe(doc.numPages));
    if (S.pendingPages) { const r = recipeFromList(S.pendingPages, doc.numPages, S.pendingWm); if (r) setRecipe(r); S.pendingPages = null; S.pendingWm = null; }
    else if (S.pendingWm) { const r = identityRecipe(doc.numPages); r.wm = wmFromJson(S.pendingWm); setRecipe(r); S.pendingWm = null; }
    else if (S.pendingOmit) { setOmit(S.pendingOmit); }
    S.pendingOmit = null;
    if (S.pendingSize) { const q = recipeOf(); q.size = { w: S.pendingSize.w, h: S.pendingSize.h }; q.each = !!S.pendingSize.each; setRecipe(q); S.pendingSize = null; }
    closePdfEditor();
    S.thumbs = new Array(doc.numPages).fill(null);
    S.history = []; S.redo = []; updateHistoryButtons();
    S.turnsEdited = false; S.time = S.vStart;
    previewR && previewR.clearTextures();
    rebuildSpreads(true); rvStart('blocks');
    setChips();
    leaveEmpty();
    zoomFit();
    stageDirty = true;
    toast(tx('pdf.loaded', { pages: peN(doc.numPages), spreads: spreadsText() }));
    S.savedTurns = adoptPriorTurns(prior) ? null : prior;
    makeThumbs(token);
  } catch (e) {
    console.error(e);
    const msg = e && e.name === 'PasswordException' ? tx('pdf.password') :
      (e && e.message && /did not load/.test(e.message)) ? e.message : tx('pdf.readfail');
    toast(msg, 6000);
  } finally { if (token === loadToken) setBusy(''); }
}
let thumbGen = 0;
async function makeThumbs(token) {
  const doc = S.pdf.doc, H = 240, gen = ++thumbGen, n = S.pdf.n; let next = 0;          // the engine works in the background, so a few pages are drawn at once
  const worker = async () => {
    while (next < n) {
      const i = next++;
      if (token !== loadToken || gen !== thumbGen) return;
      if (S.thumbs[i]) continue;
      try {
        S.thumbs[i] = await renderPdfPage(doc, i, Math.round(H * S.pdf.aspect), H);
        TL.staticDirty = true; peThumbReady(i);
      } catch (e) { /* skip */ }
      await yieldNow();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

