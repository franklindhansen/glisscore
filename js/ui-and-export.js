'use strict';
/* ====================================================================
   UI wiring
   ==================================================================== */
const svgIcon = {
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
};
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const editIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 5H3"/><path d="M12 19H3"/><path d="M14 3v4"/><path d="M16 17v4"/><path d="M21 12h-9"/><path d="M21 19h-5"/><path d="M21 5h-7"/><path d="M8 10v4"/><path d="M8 12H3"/></svg>';
const xIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
/* the intro text drifts up and fades instead of vanishing */
function leaveEmpty() {
  const e = $('#empty'); if (e.hidden) return;
  if (!e.animate || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { e.hidden = true; return; }
  const st = $('#stage'); st.classList.remove('in'); void st.offsetWidth; st.classList.add('in');
  e.style.pointerEvents = 'none';
  const a = e.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 420, easing: 'cubic-bezier(.4,0,.2,1)' });
  a.onfinish = () => { e.hidden = true; e.style.pointerEvents = ''; };
}
/* when chips or buttons arrive or leave, the title box glides to its new width instead of jumping, with the same ease as the rest of the app */
let tfOld = null;
function titleFlipMark() {
  if (tfOld !== null) return;
  const t = $('.title-pill'); tfOld = t.getBoundingClientRect().width;
  queueMicrotask(() => {
    const was = tfOld; tfOld = null; const now = t.getBoundingClientRect().width;
    if (Math.abs(was - now) < 1 || !t.animate || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    t.animate([{ flex: '0 0 ' + was + 'px' }, { flex: '0 0 ' + now + 'px' }], { duration: 560, easing: EASE_OUT });
  });
}
/* the file's name without its ending (the chip shows the start of it and the ending as the format) and the format in capitals */
const audioShort = n => String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
const audioFmt = n => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(n || ''); return m ? m[1].toUpperCase() : 'Audio'; };
/* a button that shows progress keeps one width for every text it can carry, so a changing number never makes it shift or resize */
function btnHold(b, texts) {
  if (!b || !b.offsetParent) return; const t0 = b.textContent, was = b.classList.contains('loading'), key = texts.join('|') + '|' + getComputedStyle(b).font; if (b.dataset.hold === key) return;
  b.style.minWidth = ''; b.classList.add('loading'); let w = 0; texts.forEach(t => { b.textContent = t; w = Math.max(w, b.offsetWidth); }); b.textContent = t0; if (!was) b.classList.remove('loading'); b.style.minWidth = w + 'px'; b.dataset.hold = key;
  // a width measured before the web font arrives is the fallback's, so measure again once the fonts are in (one wait per button)
  const waiting = btnHold.waiting || (btnHold.waiting = new WeakSet());
  if (document.fonts.status !== 'loaded' && !waiting.has(b)) { waiting.add(b); document.fonts.ready.then(() => { waiting.delete(b); delete b.dataset.hold; btnHold(b, texts); }); }
}
/* with no score, the Open audio button shows the loading: "Loading" and how far it is, then turns into Open editor */
function syncAudioCard() {
  const b = $('#btnAudio2'); if (!b) return; btnHold(b, ['Open audio', 'Open editor', 'Loading…', 'Loading 100%']); const x0 = b.offsetParent ? b.getBoundingClientRect().left : null, extras = ['#btnAudio3', '#btnAudioStop'].map(q => $(q)), was = extras.map(e => e.hidden); const on = !S.pdf && busyKind === 'audio' && !!busyMsg;          // a first recording or one that replaces another: the card shows the new one coming in either way
  b.classList.toggle('loading', on); b.disabled = on;
  if (on) { const pct = busyFrac == null ? null : Math.round(clamp(busyFrac, 0, 1) * 100); b.style.setProperty('--p', (pct == null ? 40 : pct) + '%'); b.classList.toggle('ind', pct == null); b.textContent = pct == null ? 'Loading…' : 'Loading ' + pct + '%'; }
  else { b.style.removeProperty('--p'); b.classList.remove('ind'); b.textContent = S.audio ? 'Open editor' : 'Open audio'; }
  $('#btnAudio3').hidden = !S.audio || on; $('#btnAudioStop').hidden = !on;
  /* the pair re-centers when Stop or Replace comes or goes: the main button glides from where it was (it keeps the current position if interrupted), and the new button fades in */
  if (x0 != null && b.animate) {
    const dx = x0 - b.getBoundingClientRect().left; if (Math.abs(dx) > 0.5 && !reducedMotion()) b.animate([{ transform: 'translateX(' + dx + 'px)' }, { transform: 'none' }], { duration: 280, easing: EASE_GLIDE });
    extras.forEach((e, i) => { if (was[i] && !e.hidden) e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT }); });
  }
  if (on && S.audio) { $('#scAudT').textContent = busyName || 'New audio'; $('#scAudD').textContent = 'Replacing ' + S.audio.name + '.'; }
}
function setChips() {
  titleFlipMark();
  const el = $('#chips'); let h = '';
  const seen = setChips.seen || (setChips.seen = {}), fresh = (k, v) => seen[k] === v ? '' : ' enter';      // a chip rises in only when it is new
  const chip = (kind, icon, name, meta, label) => '<div class="chip' + fresh(kind, name) + '"><button class="chip-icon" type="button" data-remove="' + kind + '" aria-label="Remove ' + label + '" title="Remove ' + label + '"><span class="ic">' + icon + '</span><span class="x">' + xIcon + '</span></button><span>' + esc(name) + '</span><small>' + meta + '</small></div>';
  const seenNow = {}, spin = '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  const holder = (kind, name) => '<div class="chip busy' + fresh(kind, name) + '" data-k="' + kind + '"><button class="chip-icon" type="button" data-cancel="' + kind + '" aria-label="Stop loading" title="Stop loading"><span class="ic">' + spin + '</span><span class="x">' + xIcon + '</span></button><span class="chip-main plain"><span class="chip-name">' + dotsHTML(busyMsg) + '</span><span class="pp-box"><span class="busybar' + (busyFrac == null ? ' ind' : '') + '"><b style="width:' + Math.round((busyFrac || 0) * 100) + '%"></b></span></span></span></div>';          // while it works the chip says what it is doing (not the file name) and shows how far it is; the name settles in when it is done
  const settled = k => setChips.holding && setChips.holding[k] ? ' settle' : '';          // a chip that replaces its loading twin does not rise in again, it settles
  if (!S.pdf && busyMsg && busyKind === 'pdf') { h += holder('pdf', busyName); seenNow.pdf = busyName; }
  if (S.pdf) {
    const used = S.pdf.keep.length, edited = !recipeIsSimple(recipeOf()), meta = edited ? used + ' pp · edited' : used < S.pdf.n ? used + ' of ' + S.pdf.n + ' pp' : S.pdf.n + ' pp';
    h += '<div class="chip' + fresh('pdf', S.pdf.name) + settled('pdf') + '" data-k="pdf"><button class="chip-icon" type="button" data-remove="pdf" aria-label="Remove score" title="Remove score"><span class="ic">' + svgIcon.pdf + '</span><span class="x">' + xIcon + '</span></button>'
      + '<button class="chip-main" type="button" data-pages title="' + esc(S.pdf.name) + ' · Click to open the PDF Editor" aria-label="' + esc(S.pdf.name) + ', ' + meta + '. Open the PDF Editor"><span class="chip-name">' + esc(S.pdf.name) + '</span><span class="pp-box"><small class="pp">' + meta + '</small><small class="pp-go">Editor</small></span><span class="chip-edit" aria-hidden="true">' + editIcon + '</span></button></div>';
  }
  if (!S.audio && busyMsg && busyKind === 'audio' && S.pdf) { h += holder('audio', busyName); seenNow.audio = busyName; }          // with no score the progress is on the Open audio button instead, and the chip appears when the sound is ready
  if (S.audio) h += '<div class="chip' + fresh('audio', S.audio.name) + settled('audio') + '" data-k="audio"><button class="chip-icon" type="button" data-remove="audio" aria-label="Remove audio" title="Remove audio"><span class="ic">' + svgIcon.audio + '</span><span class="x">' + xIcon + '</span></button>'
    + '<button class="chip-main" type="button" data-audio title="' + esc(S.audio.name) + ' · Click to open the Audio Editor" aria-label="' + esc(S.audio.name) + ', ' + fmt(S.audio.duration) + '. Open the Audio Editor"><span class="chip-name">' + esc(audioShort(S.audio.name)) + '</span><span class="pp-box stack"><small class="pp">' + esc(audioFmt(S.audio.name)) + '</small><small class="pp">' + fmt(S.audio.duration) + '</small><small class="pp-go">Editor</small></span><span class="chip-edit" aria-hidden="true">' + editIcon + '</span></button></div>';
  const oldW = {}; el.querySelectorAll('.chip.busy').forEach(c => { oldW[c.dataset.k] = c.getBoundingClientRect().width; });
  el.innerHTML = h; seen.pdf = S.pdf ? S.pdf.name : (seenNow.pdf || null); seen.audio = S.audio ? S.audio.name : (seenNow.audio || null);
  setChips.holding = { pdf: !S.pdf && !!seenNow.pdf, audio: !S.audio && !!seenNow.audio };
  if (el.animate && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) el.querySelectorAll('.chip.settle').forEach(c => {          // the loading chip grows (or shrinks) into the finished one instead of jumping to its width
    const w0 = oldW[c.dataset.k], w1 = c.getBoundingClientRect().width; if (!w0 || Math.abs(w0 - w1) < 1) return;
    c.style.overflow = 'hidden'; c.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }], { duration: 620, easing: EASE_OUT }).onfinish = () => { c.style.overflow = ''; };
  });
  if (el.animate && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) el.querySelectorAll('.chip.enter').forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateX(-14px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 640, delay: 90 + i * 70, easing: EASE_OUT, fill: 'backwards' }));
}
/* a trailing … becomes three dots that bounce one after another (set only when the words change, so the bounce is not restarted by every update) */
const dotsHTML = t => /…$/.test(t) ? '<span>' + esc(t.slice(0, -1)) + '<span class="dots"><i>.</i><i>.</i><i>.</i></span></span>' : esc(t);          // one piece, so a button's flex gap does not open a space before the dots
function setDots(el, t) { if (el._dt === t) return; el._dt = t; el.innerHTML = dotsHTML(t); }
let busyMsg = '';
let busyKind = '', busyName = '', busyFrac = null;
function setBusy(m, kind, name, frac) { busyMsg = m; busyKind = m ? kind || '' : ''; busyName = m ? name || '' : ''; busyFrac = m && frac != null ? frac : null; setChips(); syncAudioCard(); }
/* move the busy chip's bar without rebuilding the chip (null = no measurable progress, the bar just slides) */
function setBusyFrac(f) { busyFrac = f; syncAudioCard(); const bar = document.querySelector('#chips .busybar'); if (!bar) return; bar.classList.toggle('ind', f == null); if (f != null) bar.firstElementChild.style.width = Math.round(clamp(f, 0, 1) * 100) + '%'; }
/* Before a score is loaded the intro text carries the Open buttons; afterwards they live in the header and say Change */
/* one line of the status: the circle fills and the check draws itself when something loads, and the words swap with a small rise */
function setStatus(sel, done, yes, no) {
  const el = $(sel), t = el.querySelector('.st-t'), txt = done ? yes : no;
  if (t.textContent !== txt) { const had = t.textContent !== ''; t.textContent = txt; if (had && t.animate && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) t.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE_OUT }); }
  el.classList.toggle('done', done);
}
function updateFileButtons() {
  titleFlipMark();
  const pdf = !!S.pdf, aud = !!S.audio;
  $('#btnPdf').hidden = $('#btnAudio').hidden = !pdf;
  $('#btnPdf').lastElementChild.textContent = 'Change PDF';
  $('#btnAudio').lastElementChild.textContent = aud ? 'Change Audio' : 'Open Audio';
  $('#btnPdf').title = 'Change PDF'; $('#btnAudio').title = aud ? 'Change Audio' : 'Open Audio';
  $('#btnPdf2').textContent = pdf ? 'Change PDF' : 'Open PDF';
  syncAudioCard(); $('#scAudio').classList.toggle('on', aud);
  $('#scAudT').textContent = aud ? S.audio.name : 'Audio editor'; $('#scAudD').textContent = aud ? fmt(S.audio.duration) + ' loaded. Edit it here, or add a score to make a video.' : 'Clean up noise, shape the sound, trim, and export. No score needed.';
  /* settings stay visible but dimmed until there is a score to apply them to */
  document.querySelectorAll('.panel .group').forEach(g => { g.inert = !pdf; });
  $('.panel').classList.toggle('locked', !pdf);
  $('.timeline').classList.toggle('locked', !pdf);
  setStatus('#stScore', pdf, 'Score loaded', 'Score not loaded'); setStatus('#stAudio', aud, 'Audio loaded', 'Audio not loaded');
  clearTimeout(updateFileButtons.t);
  if (pdf && aud) updateFileButtons.t = setTimeout(() => { if (S.pdf && S.audio) $('#fileStatus').hidden = true; }, 1100);     // the last check gets a moment before the line slides away
  else $('#fileStatus').hidden = false;
}
function updateButtons() {
  const has = !!S.pdf;
  updateFileButtons();
  $('#btnExport').disabled = !has; $('#btnThumb').disabled = !has;
  if (typeof syncFadeLens === 'function') syncFadeLens();             // an automatic fade length follows the video's length
  $('#exportHint').textContent = !has ? '' : (S.audio ? 'Exports as a MOV.' : 'No audio is loaded, so the video will be silent.');
  $('#bSpace').disabled = S.spreads.length < 2; $('#bFit').disabled = $('#zoom').disabled = !has;
  $('#bTap').disabled = S.spreads.length < 2; $('#stageStrip').hidden = !S.pdf; if (!S.pdf) szReset(false); try { layoutStage(); } catch (e) {}          // the picture makes room for the full screen button once there is one
  ['bStart', 'bPlay'].forEach(id => $('#' + id).disabled = !has);
  $('#tTot').textContent = fmt(duration());
}
/* The spread label ("Spread 50 / 100 · pp. 98–99") stays on the right of the row. It sits in a box as wide as the longest label this score can show (kept invisibly in
   the same cell), so its width never depends on where the playhead is: a longer label used to wrap to a second row while scrubbing, and the preview above it grew and
   shrank. When the window is narrow the label gets shorter before it ever wraps ("34 / 100 · pp. 66–67", then "pp. 66–67"); fitInfo picks the longest that fits. */
function infoParts(i, n) {
  const sp = S.spreads[i], one = singleOn();
  const pg = sp.credits ? 'credits' : (sp[0] >= 0 && sp[1] >= 0) ? 'pp. ' + pageNo(sp[0]) + '–' + pageNo(sp[1]) : 'p. ' + pageNo(sp[0] >= 0 ? sp[0] : sp[1]);
  if (one) return [['p', 'Page '], ['c', (i + 1) + ' / ' + n], ...(sp.credits ? [['s', ' · '], ['t', 'credits']] : [])];
  return [['p', 'Spread '], ['c', (i + 1) + ' / ' + n], ['s', ' · '], ['t', pg]];
}
function setInfo(el, parts) {
  el.textContent = '';
  parts.forEach(([k, t]) => { const e = document.createElement('span'); e.className = k; e.textContent = t; el.appendChild(e); });
}
function fitInfo() {
  const tr = $('#transport'), info = $('#spreadInfo'); if (!tr || !info || !info.offsetParent) return;
  info.style.display = 'none'; const h0 = tr.offsetHeight; info.style.display = '';          // the row's height without the label: the label must not add a row
  for (const l of ['full', 'mid', 'short']) { tr.dataset.info = l; if (tr.offsetHeight <= h0 + 1) return; }
  tr.dataset.info = 'full';                                                                   // nothing fits beside the buttons: the whole label, right-aligned on its own row
}
function updateInfo() {
  const n = S.spreads.length; syncToEnd();
  const now = $('#spreadNow'), max = $('#spreadMax');
  if (!n) { now.textContent = ''; max.textContent = ''; updateInfo.sp = null; return; }
  setInfo(now, infoParts(frameState(S.time).spread, n));
  if (updateInfo.sp !== S.spreads || updateInfo.single !== singleOn()) {          // the score or the layout changed: find the longest label of each kind
    updateInfo.sp = S.spreads; updateInfo.single = singleOn();
    $('#spreadInfo .si').dataset.l = updateInfo.single ? 'single' : 'spread';
    const best = {}, len = p => p.reduce((a, [, t]) => a + t.length, 0);
    S.spreads.forEach((sp, i) => { const p = infoParts(i, n), k = sp.credits ? 'c' : (sp[0] >= 0 && sp[1] >= 0) ? 'pp' : 'p'; if (!best[k] || len(p) > len(best[k])) best[k] = p; });
    max.textContent = '';
    Object.values(best).forEach(p => { const e = document.createElement('span'); setInfo(e, p); max.appendChild(e); });
    fitInfo();
  }
  $('#tTot').textContent = fmt(duration());
}
let lastTimeStr = '';
function updateTimeUI(force) {
  const s = fmt(S.time - S.vStart); if (s !== lastTimeStr || force) { lastTimeStr = s; $('#tNow').textContent = s; }
  updateInfo();
}
function followPlayhead() {
  const x = t2x(S.time), sc = TL.scroller;
  if (x > TL.vw - 24 || x < 0) sc.scrollLeft = Math.max(0, (S.time - tlLo()) * S.pxPerSec + TL_ROOM - TL.vw * 0.15);
}

/* settings */
function updateHint() {
  const h = $('#tlHint'); if (!h) return;
  const left = S.ph.filter(Boolean).length;
  if (left) {
    h.classList.add('warn');
    h.textContent = left + (left === 1 ? ' page turn still needs' : ' page turns still need') + ' placing (dashed handle' + (left === 1 ? '' : 's') + '). Drag ' + (left === 1 ? 'it' : 'them') + ' into place.';
    return;
  }
  h.classList.remove('warn');
  const where = { start: 'starts', middle: 'is halfway through', end: 'finishes' }[S.set.ref], tr = S.set.transition, noun = tr === 'slide' ? 'slide' : 'page turn';
  const term = (k, t) => '<span class="term" data-glow="' + k + '" tabindex="0">' + t + '</span>';
  if (tr === 'cut') { h.innerHTML = 'Drag a handle to set the moment the page changes. Click the ' + term('ruler', 'ruler') + ' to move the ' + term('playhead', 'playhead') + '. Drag the brackets at either end to trim or extend the video; Fit shows the video from bracket to bracket.'; return; }
  h.innerHTML = 'Drag a handle to set the moment a ' + noun + ' ' + where + '. The lighter shaded area is the ' + (tr === 'slide' ? 'slide' : 'turn') + ' itself; make it longer or shorter with ' + term('turn', tr === 'slide' ? 'Slide length' : 'Turn length') + '. Click the ' + term('ruler', 'ruler') + ' to move the ' + term('playhead', 'playhead') + '. Drag the brackets at either end to trim or extend the video; Fit shows the video from bracket to bracket.';
}
function syncControls() {
  const s = S.set;
  $('#bend').value = s.bend; $('#bendOut').textContent = s.bend + '%';
  document.querySelectorAll('input[name=ref]').forEach(r => r.checked = r.value === s.ref);
  syncFirstAlone(); syncPageLayout(false);
  $('#margin').value = s.margin; $('#marginOut').textContent = s.margin + '%';
  const pre = Array.from($('#bgPreset').options).find(o => o.value.toLowerCase() === String(s.bg).toLowerCase());
  $('#bgPreset').value = pre ? pre.value : 'custom'; foldSet('#bgCustomFold', !pre);
  $('#bgColor').value = s.bg; $('#bgHex').value = s.bg; updateHint();
  $('#invert').checked = !!s.invert; $('#inkField').hidden = !s.invert;
  const ipre = Array.from($('#inkPreset').options).find(o => o.value.toLowerCase() === String(s.ink).toLowerCase());
  $('#inkPreset').value = ipre ? ipre.value : 'custom'; foldSet('#inkCustomFold', !ipre); $('#inkColor').value = s.ink; $('#inkHex').value = s.ink;
  $('#aspect').value = s.aspect; $('#res').value = String(s.res); $('#fps').value = String(s.fps); $('#method').value = s.method || 'auto'; $('#codec').value = s.codec || 'avc'; if (!QUALITY_NAME[s.videoQuality]) S.set.videoQuality = s.videoQuality = 'standard';
  { const r = document.querySelector('input[name=vidQ][value=' + (s.videoQuality || 'standard') + ']'); if (r) { r.checked = true; const sg = $('#vidQ'); if (sg._place) sg._place(false); } } vqNote(); 
  SHADOW_KEYS.forEach(k => { $('#' + k).value = s[k]; setOut(k); });
  $('#turnSoftField').hidden = !(s.turnShadow > 0); updateScoreUI(false);
  document.querySelectorAll('input[name=transition]').forEach(r => r.checked = r.value === s.transition);
  document.querySelectorAll('input[name=slideDir]').forEach(r => r.checked = r.value === s.slideDir);
  $('#shadowsOn').checked = shOn();
  $('#creditsOn').checked = s.creditsOn === true;
  document.querySelectorAll('input[name=credEnd]').forEach(r => r.checked = r.value === (s.creditsEarly ? 'early' : 'end'));
  syncCreditsControls();
  FADE_SIDE = 'both'; FADE_FORCE = false;
  syncFadeLens();
  document.querySelectorAll('input[name=fadeStyle]').forEach(r => r.checked = r.value === s.fadeStyle);
  document.querySelectorAll('input[name=fadeShape]').forEach(r => r.checked = r.value === (s.fadeShape || 'smooth'));
  applyFadeUI(); applyGroupSwitches();
  applyTransitionUI();
  paintRanges(); placeSegs();
}
/* a shadow slider at 0 reads 'Off' (there is no separate switch) */
const SHADOW_KEYS = ['gutter', 'divider', 'turnShadow', 'turnSoft', 'scoreAmt', 'scoreSoft'], ZERO_OFF = ['gutter', 'divider', 'turnShadow', 'scoreAmt'];
/* Under the score: its softness and hint appear only while it is on; with Invert colors on there is no paper to cast it, so the strength slides back to Off and locks (and slides back out when Invert is turned off) */
function updateScoreUI(anim) {
  const inv = !!S.set.invert, on = !inv && S.set.scoreAmt > 0, sl = $('#scoreAmt'), to = inv ? 0 : S.set.scoreAmt;
  sl.disabled = inv; sl.closest('.field').classList.toggle('dim', inv);
  $('#scoreSoftField').hidden = !on; $('#scoreHint').hidden = !on; $('#scoreInvHint').hidden = !inv;
  const show = v => { sl.value = v; $('#scoreAmtOut').textContent = v < 0.5 ? 'Off' : Math.round(v) + '%'; paintRange(sl); };
  cancelAnimationFrame(updateScoreUI.raf);
  const from = +sl.value;
  if (!anim || reducedMotion() || Math.abs(from - to) < 1) { show(to); return; }
  const t0 = performance.now();
  (function step(now) { const p = Math.min(1, (now - t0) / 420); show(from + (to - from) * (1 - Math.pow(1 - p, 3))); if (p < 1) updateScoreUI.raf = requestAnimationFrame(step); })(t0);
}
const setOut = k => { const v = S.set[k]; $('#' + k + 'Out').textContent = v === 0 && ZERO_OFF.includes(k) ? 'Off' : v + '%'; };
/* Fade controls: Length is for Both, In or Out (FADE_SIDE only picks what the slider moves); the first notch of the slider is Auto */
let FADE_SIDE = 'both', FADE_FORCE = false;          // FADE_FORCE: you chose Both yourself, so it stays even while the two sides differ
/* a side fades when the fades are on (older projects had a group switch) and that side is on */
const fadeOn = (s, side) => s.fadesOn !== false && !!(side === 'out' ? s.fadeOut : s.fadeIn);
function applyFadeUI() {
  const sg = $('#fadeSide'); sg.querySelectorAll('input').forEach(r => { r.checked = r.value === FADE_SIDE; }); if (sg._place) sg._place(false);
}
function fadeSide(v) { FADE_SIDE = v; FADE_FORCE = v === 'both'; applyFadeUI(); syncFadeLens(); }
/* the slider is an amount: position n is n tenths of a second (0 is Off, 0.2s the shortest, 3.0s the longest) and Auto is the notch at the length it works out to, so lengths grow to the right of it and shrink to the left */
const FADE_MAX = 30, fadeAutoPos = () => Math.round(autoFadeLen(duration()) * 10), fadeSnap = n => { n = clamp(Math.round(n), 0, FADE_MAX); return n === 1 ? 2 : n; };
/* Off turns the side off; moving off Off turns it on. A side moved alone leaves the other side exactly as it was (its length, its Auto, whether it is on) */
function fadeSet(n) {
  n = fadeSnap(n); const s = S.set, sides = FADE_SIDE === 'both' ? ['in', 'out'] : [FADE_SIDE], pa = fadeAutoPos();
  const inOn = fadeOn(s, 'in'), outOn = fadeOn(s, 'out'), inAuto = fadeAutoSide(s, 'in'), outAuto = fadeAutoSide(s, 'out'), outRaw = s.fadeSplit ? +s.fadeOutLen : +s.fadeLen;
  const R = { in: { on: inOn, auto: inAuto, len: +s.fadeLen }, out: { on: outOn, auto: outAuto, len: outRaw } };
  sides.forEach(k => { const x = R[k]; if (n === 0) x.on = false; else { x.on = true; if (n === pa) x.auto = true; else { x.auto = false; x.len = n / 10; } } });
  s.fadesOn = true; s.fadeIn = R.in.on; s.fadeOut = R.out.on; s.fadeAuto = R.in.auto; s.fadeAutoOut = R.out.auto;
  s.fadeLen = R.in.len; s.fadeOutLen = R.out.len; s.fadeSplit = s.fadeLen !== s.fadeOutLen;
  if (!s.fadeSplit && R.in.auto === R.out.auto) FADE_FORCE = false;
}
function syncFadeLens() {
  const s = S.set, { Li, Lo } = fadeLens(s, S.vStart, vEnd()), oi = fadeOn(s, 'in'), oo = fadeOn(s, 'out'), ai = fadeAutoSide(s, 'in'), ao = fadeAutoSide(s, 'out'), pa = fadeAutoPos(), r = $('#fadeLen');
  if (FADE_SIDE === 'both' && !FADE_FORCE && (oi !== oo || (oi && (ai !== ao || (!ai && Li !== Lo))))) { FADE_SIDE = 'in'; applyFadeUI(); }          // the two sides differ (a saved setting, an undo), so Both cannot say what they are
  const on = FADE_SIDE === 'out' ? oo : FADE_SIDE === 'in' ? oi : oi || oo, len = FADE_SIDE === 'out' ? Lo : Li, au = FADE_SIDE === 'out' ? ao : ai;
  r.dataset.default = pa; r.parentNode.querySelector('.fade-ends').style.setProperty('--apos', pa / FADE_MAX); r.parentNode.querySelector('.sl-end.auto').dataset.v = pa;
  if (!r._glide) r.value = !on ? 0 : au ? pa : Math.round(len * 10); $('#fadeLenVal').textContent = !on ? 'Off' : (au ? 'Auto ' : '') + len.toFixed(1) + 's';
  foldSet('#fadeMoreFold', oi || oo); paintRanges(); drawFadeShape();          // Shape, Curve and Fade to fold away while both fades are off
}
/* the Shape picture: the fade in rising and the fade out falling, in the chosen curve and the chosen lengths */
/* the picture glides to whatever you set: lengths, which side is lit and the curve ease toward their targets, so a drag, a reset or a double-click all move it smoothly */
const FSH = { li: null, lo: null, ai: 1, ao: 1, w: { standard: 0, smooth: 1, natural: 0 }, raf: 0, t: 0 };
function drawFadeShape() {
  const cv = $('#fadeCv'); if (!cv) return;
  const s = S.set, { Li, Lo } = fadeLens(s, S.vStart, vEnd()), oi = fadeOn(s, 'in'), oo = fadeOn(s, 'out'), shape = s.fadeShape || 'smooth';
  const T = { li: oi ? Math.min(Li, 3) : 0, lo: oo ? Math.min(Lo, 3) : 0, ai: oi && FADE_SIDE !== 'out' ? 1 : 0.35, ao: oo && FADE_SIDE !== 'in' ? 1 : 0.35, w: { standard: shape === 'standard' ? 1 : 0, smooth: shape === 'smooth' ? 1 : 0, natural: shape === 'natural' ? 1 : 0 } };
  FSH.T = T; if (FSH.li == null || reducedMotion() || !cv.clientWidth) { Object.assign(FSH, { li: T.li, lo: T.lo, ai: T.ai, ao: T.ao, w: Object.assign({}, T.w) }); paintFadeShape(); return; }
  if (!FSH.raf) { FSH.t = performance.now(); FSH.raf = requestAnimationFrame(stepFadeShape); }
}
function stepFadeShape(now) {
  const T = FSH.T, dt = Math.min(0.05, (now - FSH.t) / 1000), k = 1 - Math.exp(-dt * 14); FSH.t = now; let moving = false;
  const go = (o, key, to) => { o[key] += (to - o[key]) * k; if (Math.abs(to - o[key]) > 0.002) moving = true; else o[key] = to; };
  go(FSH, 'li', T.li); go(FSH, 'lo', T.lo); go(FSH, 'ai', T.ai); go(FSH, 'ao', T.ao); for (const n in T.w) go(FSH.w, n, T.w[n]);
  paintFadeShape(); FSH.raf = moving ? requestAnimationFrame(stepFadeShape) : 0;
}
function paintFadeShape() {
  const cv = $('#fadeCv'); if (!cv || !cv.clientWidth || !cv.clientHeight) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.documentElement), line = cs.getPropertyValue('--line').trim(), acc = cs.getPropertyValue('--accent').trim(), mut = cs.getPropertyValue('--muted').trim();
  let ws = 0; for (const n in FSH.w) ws += Math.max(0, FSH.w[n]);
  const g = x => { let v = 0; for (const n in FSH.w) v += Math.max(0, FSH.w[n]) * AE_SHAPES[n](x); return ws > 0 ? v / ws : x; };
  const span = 3, top = 8, bot = H - 20, y = v => top + (1 - v) * (bot - top);
  c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.moveTo(0, top + 0.5); c.lineTo(W, top + 0.5); c.moveTo(0, bot + 0.5); c.lineTo(W, bot + 0.5); c.stroke();
  const zone = (x0, x1, L, dir, al, name) => {
    c.beginPath(); for (let px = 0; px <= x1 - x0; px++) { const t = (dir > 0 ? px : (x1 - x0) - px) / (x1 - x0) * span, yy = y(L < 0.001 ? 1 : g(clamp(t / L, 0, 1))); px ? c.lineTo(x0 + px, yy) : c.moveTo(x0 + px, yy); }
    c.lineJoin = c.lineCap = 'round'; c.lineWidth = 2.4; c.strokeStyle = acc; c.globalAlpha = al; c.stroke(); c.lineTo(x1, bot); c.lineTo(x0, bot); c.closePath(); c.globalAlpha = 0.12 * al; c.fillStyle = acc; c.fill();
    c.globalAlpha = 0.45 + 0.45 * ((al - 0.35) / 0.65); c.fillStyle = mut; c.font = '600 10.5px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'top'; c.textAlign = dir > 0 ? 'left' : 'right'; c.fillText(name, dir > 0 ? x0 : x1, bot + 5); c.globalAlpha = 1;
  };
  zone(6, W * 0.46, FSH.li, 1, FSH.ai, 'IN'); zone(W * 0.54, W - 6, FSH.lo, -1, FSH.ao, 'OUT');
}
/* The switches in the Shadows and depth and Fades headers: off hides the rest of the group but keeps its values */
/* the credits text boxes and their style rows: a row (font box, B, I) shows only once its line has text */
function growBox(el) { el.style.height = 'auto'; el.style.height = (el.scrollHeight + 2) + 'px'; }
function updateLineStyles() {
  const each = !!S.set.creditsFontEach;           // with a font per line, the single Font box gives way to those
  $('#credFontField').hidden = each; $('#credFontNote').hidden = !each;
  [['Title', S.credits.title], ['L2', S.credits.l2], ['L3', S.credits.l3]].forEach(([k, text]) => {
    $('#cred' + k + 'Style').hidden = !(text.trim() || each);
    $('#cred' + k + 'FontBox').hidden = !S.set.creditsFontEach;
    $('#cred' + k + 'B').setAttribute('aria-pressed', String(!!S.set['cred' + k + 'B']));
    $('#cred' + k + 'I').setAttribute('aria-pressed', String(!!S.set['cred' + k + 'I']));
  });
}
function syncCreditsControls() {
  const s = S.set;
  $('#credTitle').value = $('#pieceTitle').value = S.credits.title; $('#credL2').value = S.credits.l2; $('#credL3').value = S.credits.l3; growBox($('#credL2'));
  document.querySelectorAll('input[name=creditsAt]').forEach(r => r.checked = r.value === (s.creditsAt === 'start' ? 'start' : 'end')); { const sg = document.querySelector('#creditsAtField .seg'); if (sg && sg._place) sg._place(false); }
  document.querySelectorAll('input[name=credStart]').forEach(r => r.checked = r.value === (s.creditsWithLast !== false ? 'with' : 'after')); $('#creditsFontEach').checked = !!s.creditsFontEach;
  $('#credFont').value = s.creditsFont || ''; ['Title', 'L2', 'L3'].forEach(k => { $('#cred' + k + 'Font').value = s['cred' + k + 'Font'] || ''; });
  updateLineStyles(); applyCreditsUI(); preloadCreditsFonts();
}
/* makes sure saved or imported fonts are loaded (and fixes their capitalization) */
function preloadCreditsFonts() {
  CRED_FONT_KEYS.forEach(k => { const f = S.set[k]; if (f) resolveGoogleFont(f).then(n => { if (n) { if (n !== f) { S.set[k] = n; const el = $('#' + (k === 'creditsFont' ? 'credFont' : k)); if (el) el.value = n; } stageDirty = true; } }); });
}
/* a font box: loads the Google Font as you type (after a short pause) and says so if it can't be found */
const fontTimers = {};
function bindFontField(id, key, msgId) {
  const input = $('#' + id), msg = msgId ? $('#' + msgId) : null;
  const say = (t, bad) => { if (msg) { msg.textContent = t; msg.classList.toggle('err', !!bad); } input.classList.toggle('bad', !!bad); input.title = bad ? t : ''; };
  input.addEventListener('input', () => {
    clearTimeout(fontTimers[id]);
    fontTimers[id] = setTimeout(async () => {
      const typed = input.value.trim();
      if (!typed) { S.set[key] = ''; say(''); saveSettings(); stageDirty = true; return; }
      say('Processing…');
      const name = await resolveGoogleFont(typed);
      if (input.value.trim() !== typed) return;                     // the box changed while it loaded
      if (name) { S.set[key] = name; if (name !== typed) input.value = name; say(''); saveSettings(); stageDirty = true; }
      else say(validFontName(typed) ? "Couldn't find “" + typed + "” on Google Fonts (or you're offline). Check the spelling." : 'Use the font name exactly as it appears on fonts.google.com.', true);
    }, 450);
  });
}
function applyGroupSwitches() {
  [['#shadowsOn', shOn()], ['#creditsOn', S.set.creditsOn === true]].forEach(([sel, on]) => $(sel).closest('.group').classList.toggle('off', !on));
  if (typeof syncGroupBodies === 'function') syncGroupBodies();
}
/* Only show the controls that matter for the chosen page transition */
function applyTransitionUI() {
  const t = S.set.transition;
  $('#turnField').hidden = t === 'cut';
  $('#slideField').hidden = t !== 'slide';
  swapText($('#turnLenLbl'), t === 'slide' ? 'Slide length' : 'Turn length', true);
  const len = $('#flipDur'), v = +S.set[lenKey()];      // the one slider shows whichever length belongs to the chosen style
  len.min = t === 'slide' ? '0.1' : '0.3'; len.value = v; $('#flipDurOut').textContent = v.toFixed(1) + 's'; paintRange(len);
  $('#refField').hidden = t === 'cut';
  $('#bendField').hidden = t !== 'flip';
  $('#turnShadowBlock').hidden = t !== 'flip';
}
/* A font box you can type in, which also drops down a list of popular Google Fonts when you click it */
const CRED_FONTS = ['Playfair Display', 'Cormorant Garamond', 'EB Garamond', 'Libre Baskerville', 'Lora', 'Merriweather', 'Crimson Text', 'Cinzel', 'Source Serif 4', 'Montserrat', 'Raleway', 'Josefin Sans', 'Poppins', 'Lato', 'Open Sans', 'Roboto', 'Oswald', 'Inter'];
function initCombo(box) {
  const input = box.querySelector('input'), list = document.createElement('ul'), btn = document.createElement('button');
  list.className = 'combo-list'; list.hidden = true; list.setAttribute('role', 'listbox'); list.id = input.id + 'List';
  btn.type = 'button'; btn.className = 'combo-btn'; btn.tabIndex = -1; btn.setAttribute('aria-label', 'Show fonts'); btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  box.append(btn, list);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', list.id);
  let act = -1, quiet = false;
  const shown = () => !list.hidden && !list._a;
  const settle = () => { if (list._a) { list._a.cancel(); list._a = null; } list.style.pointerEvents = ''; };
  const close = instant => {
    input.setAttribute('aria-expanded', 'false'); act = -1;
    if (list.hidden || list._a) return;
    if (instant === true || reducedMotion() || !list.animate) { list.hidden = true; return; }
    list.style.pointerEvents = 'none';
    const a = list._a = list.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: 'cubic-bezier(.22,1,.36,1)' });
    a.onfinish = () => { if (list._a === a) { list._a = null; list.hidden = true; list.style.pointerEvents = ''; } };
  };
  const mark = n => { const li = Array.from(list.children); li.forEach(x => x.classList.remove('act')); act = n; if (li[n]) { li[n].classList.add('act'); li[n].scrollIntoView({ block: 'nearest' }); } };
  const open = filter => {
    const q = (filter || '').trim().toLowerCase(), cur = input.value.trim().toLowerCase();
    settle(); list.textContent = '';
    CRED_FONTS.filter(f => !q || f.toLowerCase().includes(q)).forEach(f => { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = f; if (f.toLowerCase() === cur) li.setAttribute('aria-selected', 'true'); list.appendChild(li); });
    if (!list.children.length) { close(true); return; }
    list.hidden = false; input.setAttribute('aria-expanded', 'true'); act = -1;
    const sel = list.querySelector('[aria-selected]'); if (sel && !q) sel.scrollIntoView({ block: 'nearest' });
  };
  const pick = f => { input.value = f; quiet = true; input.dispatchEvent(new Event('input', { bubbles: true })); quiet = false; close(); };
  input.addEventListener('focus', () => open(''));
  input.addEventListener('click', () => { if (!shown()) open(''); });
  input.addEventListener('input', () => { if (!quiet) open(input.value); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    const n = list.children.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!shown()) open(''); mark((act + (e.key === 'ArrowDown' ? 1 : -1) + list.children.length) % Math.max(1, list.children.length)); }
    else if (e.key === 'Enter' && shown() && act >= 0 && n) { e.preventDefault(); pick(list.children[act].textContent); }
    else if (e.key === 'Escape' && shown()) { e.preventDefault(); close(); }
  });
  list.addEventListener('mousedown', e => e.preventDefault());                    // keep the cursor in the box while picking
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) pick(li.textContent); });
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => { if (shown()) { close(); return; } input.focus(); open(''); });
}
/* Group headings fold their contents away. A folded group keeps a one-line summary of what is set, so nothing hides unnoticed. */
function groupSummary(k) {
  const s = S.set, sec = v => (+v).toFixed(1) + 's', pc = v => v + '%', j = (...p) => p.filter(x => x != null && x !== '').join(' · ');
  const opt = (sel, v) => { const o = Array.from($(sel).options).find(o => o.value.toLowerCase() === String(v).toLowerCase()); return o && o.value !== 'custom' ? o.textContent : String(v); };
  const bg = () => opt('#bgPreset', s.bg), ink = () => opt('#inkPreset', s.ink), ref = { start: 'Start', middle: 'Middle', end: 'End' }[s.ref] || 'End';
  const dir = s.slideDir === 'out' ? 'Out' : 'In';
  // every summary follows the panel from top to bottom; the Under the score strength reads Off while colors are inverted, as on the slider
  const sc = s.invert ? 0 : s.scoreAmt;
  const sh = n => { const p = []; if (s.gutter > 0) p.push(n[0] + ' ' + pc(s.gutter)); if (s.divider > 0) p.push(n[1] + ' ' + pc(s.divider)); if (s.transition === 'flip' && s.turnShadow > 0) p.push(n[2] + ' ' + pc(s.turnShadow)); if (sc > 0) p.push(n[3] + ' ' + pc(sc)); return p.length ? p.join(' · ') : 'All off'; };
  // fade lengths: the second length only exists when Different lengths is in effect (auto off, both fades on)
  const fd = short => {
    if (s.fadesOn === false || (!s.fadeIn && !s.fadeOut)) return 'Off';
    const { Li, Lo } = fadeLens(s, S.vStart, vEnd()), ai = fadeAutoSide(s, 'in'), ao = fadeAutoSide(s, 'out'), both = s.fadeIn && s.fadeOut, to = (short ? '' : 'To ') + (s.fadeStyle === 'black' ? 'Black' : 'Background');
    if (both && (ai !== ao || (!ai && Li !== Lo))) return j('In ' + sec(Li), 'Out ' + sec(Lo), to);
    return j(both ? 'In and out' : s.fadeIn ? 'In' : 'Out', (s.fadeIn ? ai : ao) ? null : sec(s.fadeIn ? Li : Lo), to);
  };
  // each entry lists wordings from the fullest to the shortest; the longest one that fits on a single line is used
  if (k === 'transition') {
    if (s.transition === 'cut') return ['Cut'];
    if (s.transition === 'slide') return [j('Slide', 'Direction ' + dir, 'Slide length ' + sec(s.slideDur), 'Handle marks ' + ref), j('Slide', 'Direction ' + dir, 'Slide length ' + sec(s.slideDur)), j('Slide', dir, sec(s.slideDur))];
    return [j('Turn', 'Turn length ' + sec(s.flipDur), 'Bend effect ' + pc(s.bend), 'Handle marks ' + ref), j('Turn', sec(s.flipDur), 'Bend ' + pc(s.bend), 'Handle ' + ref), j('Turn', sec(s.flipDur), 'Bend ' + pc(s.bend)), j('Turn', sec(s.flipDur))];
  }
  if (k === 'layout') { const fa = singleOn() ? 'Single page' : firstAloneOn() ? 'First page alone' : null, iv = s.invert ? 'Invert colors' : null; return [j(fa, 'Margin ' + pc(s.margin), bg(), iv, s.invert ? 'Ink color ' + ink() : null), j(fa, 'Margin ' + pc(s.margin), bg(), iv, s.invert ? 'Ink ' + ink() : null), j(fa, 'Margin ' + pc(s.margin), bg(), iv), j(fa, pc(s.margin), bg(), iv)]; }
  if (k === 'shadows') return [sh(['Crease', 'Divider', 'Page turn', 'Under score']), sh(['Crease', 'Divider', 'Turn', 'Under score']), sh(['Crease', 'Divider', 'Turn', 'Score'])];
  if (k === 'fades') return [fd(false), fd(true)];
  if (k === 'credits') {
    const clip = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t, lines = [['Title', S.credits.title], ['Line 2', S.credits.l2], ['Line 3', S.credits.l3]].map(([n, t]) => [n, String(t).replace(/\s+/g, ' ').trim()]).filter(([, t]) => t);
    if (!lines.length) return 'Empty: add text or turn off';
    const at = S.set.creditsAt === 'start' ? 'Start · ' : '';
    return [at + lines.map(([n, t]) => n + ' ' + clip(t, 40)).join(' · '), at + lines.map(([n, t]) => n + ' ' + clip(t, 20)).join(' · '), at + lines[0][0] + ' ' + clip(lines[0][1], 26)];
  }
  if (k === 'video') { const r = Array.from($('#res').options).find(o => +o.value === +s.res); return s.aspect + ' · ' + (r ? r.textContent : s.res + 'p') + ' · ' + s.fps + 'fps'; }
  return '';
}
function fitSummary(el, options) {
  const list = [].concat(options); if (list.length === 1) return list[0];
  const cs = getComputedStyle(el), ctx = fitSummary.ctx || (fitSummary.ctx = document.createElement('canvas').getContext('2d'));
  ctx.font = cs.fontSize + ' ' + cs.fontFamily;
  const avail = el.parentElement.clientWidth - parseFloat(cs.paddingLeft) - 2;
  return list.find(t => ctx.measureText(t).width <= avail) || list[list.length - 1];
}
function updateGroupSummaries() { document.querySelectorAll('.panel .group[data-sum]').forEach(g => { const el = g.querySelector(':scope > .group-sum'); if (el) { const t = fitSummary(el, groupSummary(g.dataset.sum)); el.textContent = t; el.title = t; } }); }
/* a folded or switched-off group hides its body (smoothly, see initSmooth); the heading and summary stay */
function syncGroupBodies() {
  document.querySelectorAll('.panel .group[data-sum]').forEach(g => {
    const b = g.querySelector(':scope > .group-body'), off = g.classList.contains('off'), folded = g.classList.contains('collapsed');
    if (b) b.hidden = off || folded;
    const btn = g.querySelector('.fold-btn'); if (btn) { btn.setAttribute('aria-expanded', String(!(off || folded))); btn.toggleAttribute('aria-disabled', off); }
  });
}
/* Headings are real buttons (the standard disclosure pattern): keyboard users can Tab to them and press Space or Enter, and screen
   readers hear expanded or collapsed. After a mouse click the focus is let go, so Space and Enter go back to playing and rewinding. */
function initGroupFolds() {
  document.querySelectorAll('.panel .group[data-sum]').forEach((g, n) => {
    const h3 = g.querySelector('h3'), head = h3.parentElement === g ? h3 : h3.parentElement;
    const sum = document.createElement('p'); sum.className = 'group-sum'; head.after(sum);
    const body = document.createElement('div'); body.className = 'group-body'; body.id = 'gbody' + n; sum.after(body);
    Array.from(g.children).filter(el => ![head, sum, body].includes(el) && el.id !== 'btnExport' && el.id !== 'exportHint').forEach(el => body.appendChild(el));
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'fold-btn'; btn.textContent = h3.textContent; btn.setAttribute('aria-controls', body.id); btn.setAttribute('aria-expanded', 'true');
    h3.textContent = ''; h3.appendChild(btn);
    btn.addEventListener('click', e => {
      if (!g.classList.contains('off')) { g.classList.toggle('collapsed'); syncGroupBodies(); updateGroupSummaries(); }
      if (e.detail > 0) btn.blur();
    });
  });
  syncGroupBodies(); updateGroupSummaries();
}
/* Anything in the side panel that is shown or hidden slides open or closed instead of jumping. The code just sets `hidden`
   as before; this watches for the change and animates it (a hiding element is kept on screen until its animation ends). */
const SMOOTH = '.field, .sub, .colorrow, .line-style, .combo, .hint, .group-body, #turnShadowBlock, #centerFold, #fileStatus, details';
const SMOOTH_PROPS = ['height', 'opacity', 'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
/* text that changes in place: it rises in, and a block of text eases to its new height (so a dialog or panel never jumps) */
function swapText(el, txt, flat) {
  if (el.textContent === txt) return;
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (performance.now() < 1500 || calm || !el.animate || el.offsetParent === null) { el.textContent = txt; return; }
  const h0 = el.getBoundingClientRect().height; el.textContent = txt; const h1 = el.getBoundingClientRect().height;
  el.getAnimations().forEach(a => a.cancel());
  el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE_OUT });
  if (!flat && Math.abs(h1 - h0) > 0.5) {
    el.style.overflow = 'clip';
    const a = el.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 380, easing: 'cubic-bezier(.32,.72,0,1)' });
    a.onfinish = a.oncancel = () => { el.style.overflow = ''; };
  }
}
/* the highlighted choice in every segmented control is one pill that glides to the new choice */
function initSegs() {
  document.querySelectorAll('.seg').forEach(seg => {
    const pill = document.createElement('i'); pill.className = 'seg-pill'; pill.setAttribute('aria-hidden', 'true'); seg.prepend(pill);
    seg._place = animate => {
      const on = seg.querySelector('label:has(input:checked)');
      if (!on || !seg.offsetWidth) { pill.style.opacity = '0'; return; }
      if (!animate) pill.style.transition = 'none';
      pill.style.width = on.offsetWidth + 'px'; pill.style.transform = 'translateX(' + on.offsetLeft + 'px)'; pill.style.opacity = '1';
      if (!animate) { void pill.offsetWidth; pill.style.transition = ''; }
    };
    seg.addEventListener('change', () => seg._place(true));
    if (window.ResizeObserver) new ResizeObserver(() => seg._place(false)).observe(seg);
    seg._place(false);
  });
}
const placeSegs = () => document.querySelectorAll('.seg').forEach(s => s._place && s._place(false));
function initSmooth() {
  const panel = $('.panel'); let ready = false; setTimeout(() => { ready = true; }, 900);       // nothing animates while the page is still starting up
  const calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  const run = (el, show) => {
    if (el._sm) el._sm.cancel();
    let disp = '';
    if (!show) { el.hidden = false; disp = getComputedStyle(el).display; }          // measure it as if it were shown, before anything is painted
    const cs = getComputedStyle(el), full = {}, zero = {};
    SMOOTH_PROPS.forEach(p => { full[p] = p === 'height' ? el.getBoundingClientRect().height + 'px' : p === 'opacity' ? '1' : cs[p]; zero[p] = p === 'opacity' ? '0' : '0px'; });
    full.transform = 'none'; zero.transform = 'translateY(-6px)';                  // the content drifts a little as it opens or closes
    const mo = el.dataset.motion, tr = S.set.transition;
    if (mo) {                                                                         // rows tied to the page transition: Cut does nothing, Slide slides, Turn turns
      if (tr === 'cut' || (!show && mo === 'tr')) { if (!show) el.hidden = true; return; }
      const kind = mo === 'tr' ? tr : mo;
      if (kind === 'slide') zero.transform = 'translateX(' + (S.set.slideDir === 'out' ? -30 : 30) + 'px)';
      else { zero.transform = 'perspective(520px) rotateX(' + (show ? -72 : 72) + 'deg)'; el.style.transformOrigin = '50% 0'; }
    }
    if (!show) el.hidden = true;
    if (!full.height || full.height === '0px') return;                              // nothing visible to animate (a parent is hidden)
    if (!show) el.style.setProperty('display', disp, 'important');                   // keep it on screen while it closes
    el.style.overflow = 'hidden';
    const dur = Math.round(Math.min(460, Math.max(260, 220 + parseFloat(full.height) * 0.35)));      // taller things take a little longer, so they never snap
    const mid = { opacity: show ? 1 : 0, offset: 0.5 };                               // the fade is done by halfway, so the last item is never the faint one
    const a = el.animate(show ? [zero, mid, full] : [full, mid, zero], { duration: dur, easing: 'cubic-bezier(.32,.72,0,1)' });
    el._sm = a;
    const rel = show ? setTimeout(() => { el.style.overflow = ''; }, dur * 0.55) : 0;   // let go of the clip before the slow end of the curve
    const done = () => { clearTimeout(rel); el.style.overflow = ''; el.style.transformOrigin = ''; el.style.removeProperty('display'); if (el._sm === a) el._sm = null; };
    a.onfinish = done; a.oncancel = done;
  };
  const mo = new MutationObserver(recs => {
    const was = new Map();
    recs.forEach(r => { if (!was.has(r.target)) was.set(r.target, r.oldValue !== null); });
    if (ready && !document.hidden && !(calm && calm.matches)) was.forEach((wasHidden, el) => {
      const nowHidden = el.hasAttribute('hidden');
      if (wasHidden !== nowHidden && el.matches(SMOOTH)) run(el, !nowHidden);
    });
    mo.takeRecords();                                                                // forget the changes made while measuring
  });
  [panel, $('#audioDlg'), $('#pdfDlg')].forEach(root => mo.observe(root, { subtree: true, attributes: true, attributeFilter: ['hidden'], attributeOldValue: true }));
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (typeof updateGroupSummaries === 'function') updateGroupSummaries(); });
window.addEventListener('resize', () => { if (typeof updateGroupSummaries === 'function') updateGroupSummaries(); });
function bindSettings() {
  aeBind();
  initGroupFolds(); initSmooth(); initSegs();
  document.querySelectorAll('.combo').forEach(initCombo);
  const dirty = () => { saveSettings(); stageDirty = true; TL.overlayDirty = true; };      // the timeline's fade lines follow the settings
  /* Reset to default: a double-click on a slider glides it back to its default, as in the Audio Editor; a drag in progress stops a glide. The Audio Editor and the Fade length slider have their own. */
  ['flipDur', 'bend', 'margin', 'gutter', 'divider', 'turnShadow', 'turnSoft', 'scoreAmt', 'scoreSoft', 'peCropPad', 'peWmOpacity'].forEach(id => {
    const r = $('#' + id);
    r.addEventListener('pointerdown', () => { if (r._glide) { cancelAnimationFrame(r._glide.raf); r._glide = null; } });
    r.addEventListener('dblclick', () => aeGlideTo(r, id === 'flipDur' ? DEFAULTS[lenKey()] : id in DEFAULTS ? DEFAULTS[id] : r.dataset.default));
  });
  $('#flipDur').addEventListener('input', e => {
    S.set[lenKey()] = +e.target.value; $('#flipDurOut').textContent = S.set[lenKey()].toFixed(1) + 's';
    normalizeTurns(); onTurnsChanged(); dirty();
  });
  $('#bend').addEventListener('input', e => { S.set.bend = +e.target.value; $('#bendOut').textContent = S.set.bend + '%'; dirty(); });
  document.querySelectorAll('input[name=ref]').forEach(r => r.addEventListener('change', e => {
    const old = S.set.ref, oldOff = refOffset(old);
    S.set.ref = e.target.value; const nOff = refOffset(); updateHint();
    S.turns = S.turns.map(t => t - oldOff + nOff); normalizeTurns(); onTurnsChanged(); dirty();
  }));
  document.querySelectorAll('input[name=pageLayout]').forEach(r => r.addEventListener('change', e => { if (e.target.checked) { setPageLayout(e.target.value); stageDirty = true; } }));
  $('#firstAlone').addEventListener('change', e => {
    S.set.firstAlone = e.target.checked; saveSettings();
    if (S.pdf) { S.time = S.vStart; rebuildSpreads(false); }
  });
  $('#margin').addEventListener('input', e => { S.set.margin = +e.target.value; $('#marginOut').textContent = S.set.margin + '%'; dirty(); });
  const setBg = v => { S.set.bg = v; $('#bgColor').value = v; dirty(); };
  $('#bgPreset').addEventListener('change', e => {
    if (e.target.value === 'custom') { foldSet('#bgCustomFold', true); $('#bgHex').value = S.set.bg; $('#bgHex').focus({ preventScroll: true }); }
    else { foldSet('#bgCustomFold', false); $('#bgHex').value = e.target.value; setBg(e.target.value.toLowerCase()); }
  });
  $('#bgColor').addEventListener('input', e => { $('#bgHex').value = e.target.value; setBg(e.target.value); });
  $('#bgHex').addEventListener('input', e => {
    let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) setBg(v.toLowerCase());
    else if (/^#[0-9a-f]{3}$/i.test(v)) setBg('#' + v.slice(1).split('').map(c => c + c).join('').toLowerCase());
  });
  $('#bgHex').addEventListener('blur', () => { $('#bgHex').value = S.set.bg; });
  /* Invert colors: the paper drops out and the notes take the ink color; a light background is switched to black for you */
  const lumOf = hx => { const c = hexToRgb(hx); return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; };
  $('#invert').addEventListener('change', e => {
    S.set.invert = e.target.checked; $('#inkField').hidden = !e.target.checked; updateScoreUI(true);
    const notes = [];
    if (e.target.checked && lumOf(S.set.bg) > 0.6) { S.set.bg = '#000000'; notes.push(tx('vid.inv.bg')); }
    if (e.target.checked && shOn()) { S.set.shadowsOn = false; S.shadowsAuto = true; notes.push(tx('vid.inv.shadows')); }          // there is no paper to cast a shadow
    else if (!e.target.checked && S.shadowsAuto) { S.set.shadowsOn = true; S.shadowsAuto = false; syncControls(); applyGroupSwitches(); }                     // and they come back with the paper
    if (notes.length) { syncControls(); applyGroupSwitches(); toast(tx('vid.inv.note', { notes: notes.join(' and ') })); }
    dirty();
  });
  const setInk = v => { S.set.ink = v; $('#inkColor').value = v; dirty(); };
  $('#inkPreset').addEventListener('change', e => {
    if (e.target.value === 'custom') { foldSet('#inkCustomFold', true); $('#inkHex').value = S.set.ink; $('#inkHex').focus({ preventScroll: true }); }
    else { foldSet('#inkCustomFold', false); $('#inkHex').value = e.target.value; setInk(e.target.value.toLowerCase()); }
  });
  $('#inkColor').addEventListener('input', e => { $('#inkHex').value = e.target.value; setInk(e.target.value); });
  $('#inkHex').addEventListener('input', e => {
    let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-f]{6}$/i.test(v)) setInk(v.toLowerCase());
    else if (/^#[0-9a-f]{3}$/i.test(v)) setInk('#' + v.slice(1).split('').map(c => c + c).join('').toLowerCase());
  });
  $('#inkHex').addEventListener('blur', () => { $('#inkHex').value = S.set.ink; });
  $('#aspect').addEventListener('change', e => morphStage(() => { S.set.aspect = e.target.value; saveSettings(); layoutStage(); }));
  $('#res').addEventListener('change', e => { S.set.res = +e.target.value; saveSettings(); });
  $('#fps').addEventListener('change', e => { S.set.fps = +e.target.value; saveSettings(); });
  $('#method').addEventListener('change', e => { S.set.method = e.target.value; saveSettings(); vqNote(); });
  $('#codec').addEventListener('change', e => { S.set.codec = e.target.value; saveSettings(); });
  document.querySelectorAll('input[name=vidQ]').forEach(r => r.addEventListener('change', e => { S.set.videoQuality = e.target.value; saveSettings(); vqNote(); }));
  ['#res', '#fps', '#codec', '#aspect'].forEach(q => $(q).addEventListener('change', () => setTimeout(vqNote, 0)));
  SHADOW_KEYS.forEach(k => $('#' + k).addEventListener('input', e => { S.set[k] = +e.target.value; setOut(k); updateScoreUI(false); $('#turnSoftField').hidden = !(S.set.turnShadow > 0); dirty(); }));
  $('#shadowReset').addEventListener('click', () => {
    ['shadowsOn', ...SHADOW_KEYS].forEach(k => { S.set[k] = DEFAULTS[k]; });
    syncControls(); dirty(); toast(tx('vid.shadowsreset'));
  });
  document.querySelectorAll('input[name=transition]').forEach(r => r.addEventListener('change', e => {
    S.set.transition = e.target.value; applyTransitionUI(); updateHint(); normalizeTurns(); onTurnsChanged(); dirty();
  }));
  document.querySelectorAll('input[name=slideDir]').forEach(r => r.addEventListener('change', e => { S.set.slideDir = e.target.value; dirty(); }));
  $('#fadeLen').addEventListener('input', e => { const r = e.target; fadeSet(+r.value); if (!r._glide) r.value = fadeSnap(+r.value); applyFadeUI(); syncFadeLens(); dirty(); });
  $('#fadeLen').addEventListener('dblclick', () => aeGlideTo($('#fadeLen'), fadeAutoPos()));          // back to Auto, gliding
  document.querySelectorAll('#fadeLenField .sl-end').forEach(b => b.addEventListener('click', () => { const r = $('#fadeLen'); r.value = b.dataset.v; r.dispatchEvent(new Event('input', { bubbles: true })); }));
  document.querySelectorAll('input[name=fadeSide]').forEach(r => r.addEventListener('change', e => fadeSide(e.target.value)));
  document.querySelectorAll('input[name=fadeShape]').forEach(r => r.addEventListener('change', e => { S.set.fadeShape = e.target.value; drawFadeShape(); dirty(); }));
  window.addEventListener('resize', paintFadeShape);
  document.querySelectorAll('input[name=fadeStyle]').forEach(r => r.addEventListener('change', e => { S.set.fadeStyle = e.target.value; dirty(); }));
  $('#creditsOn').addEventListener('change', e => { S.set.creditsOn = e.target.checked; applyGroupSwitches(); syncCredits(); dirty(); });
  const onLine = (key, id) => $('#' + id).addEventListener('input', e => {
    if (id === 'credL2') { let v = e.target.value.replace(/\r/g, '').split('\n'); if (v.length > 2) { v = v.slice(0, 2); e.target.value = v.join('\n'); } growBox(e.target); }
    S.credits[key] = e.target.value; if (key === 'title') $('#pieceTitle').value = e.target.value;      // the header title and the credits title are one and the same
    updateLineStyles(); syncCredits(); stageDirty = true;
  });
  $('#pieceTitle').addEventListener('input', e => { S.credits.title = e.target.value; $('#credTitle').value = e.target.value; updateLineStyles(); syncCredits(); stageDirty = true; });
  $('.brand .home').addEventListener('click', e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); if (reducedMotion()) { location.reload(); return; } document.documentElement.classList.add('leaving'); setTimeout(() => location.reload(), 190); });      // the page fades out first, so the reload is one smooth fade out and in      // a fresh start; also works when the page is opened as a file
  $('#pieceTitle').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  onLine('title', 'credTitle'); onLine('l2', 'credL2'); onLine('l3', 'credL3');
  $('#credL2').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.includes('\n')) e.preventDefault(); });   // two lines at most
  document.querySelectorAll('input[name=creditsAt]').forEach(r => {
    r.addEventListener('click', e => { if (r.value === 'start' && startWhy()) { e.preventDefault(); creditsAtBounce(); } });      // a dimmed Start: stay on End
    r.addEventListener('change', e => {
      if (!e.target.checked) return;
      if (e.target.value === 'start' && startWhy()) { document.querySelector('input[name=creditsAt][value=end]').checked = true; creditsAtBounce(); return; }
      S.set.creditsAt = e.target.value; syncCredits(); applyCreditsUI(); dirty();
    });
  });
  document.querySelectorAll('input[name=credStart]').forEach(r => r.addEventListener('change', e => { S.set.creditsWithLast = e.target.value === 'with'; syncCredits(); dirty(); }));
  $('#creditsFontEach').addEventListener('change', e => { S.set.creditsFontEach = e.target.checked; updateLineStyles(); dirty(); });
  bindFontField('credFont', 'creditsFont', 'credFontMsg');
  [['Title', 'credTitleFont'], ['L2', 'credL2Font'], ['L3', 'credL3Font']].forEach(([k, key]) => {
    bindFontField('cred' + k + 'Font', key);
    ['B', 'I'].forEach(f => $('#cred' + k + f).addEventListener('click', () => { S.set['cred' + k + f] = !S.set['cred' + k + f]; updateLineStyles(); dirty(); }));
  });
  document.querySelectorAll('input[name=credEnd]').forEach(r => r.addEventListener('change', e => { S.set.creditsEarly = e.target.value === 'early'; if (S.set.creditsEarly) ensureCreditsEnd(); else S.creditsEnd = null; applyCreditsUI(); TL.staticDirty = true; stageDirty = true; dirty(); }));
  $('#shadowsOn').addEventListener('change', e => { S.shadowsAuto = false; S.set.shadowsOn = e.target.checked; applyGroupSwitches(); dirty(); });
}

/* ====================================================================
   Export
   ==================================================================== */
//#region muxer
/* Minimal MP4 writer (H.264 + AAC) – no external libraries */
function _B(...parts) {
  let n = 0; const arr = parts.map(p => typeof p === 'string' ? Uint8Array.from(p, c => c.charCodeAt(0)) : (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  arr.forEach(a => n += a.length); const out = new Uint8Array(n); let o = 0; arr.forEach(a => { out.set(a, o); o += a.length; }); return out;
}
const _u16 = n => [(n >> 8) & 255, n & 255];
const _u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const _zeros = n => new Uint8Array(n);
function _box(type, ...parts) { const body = _B(...parts); return _B(_u32(body.length + 8), type, body); }
function _full(type, ver, flags, ...parts) { return _box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts); }
function _table64(vals) { const o = new Uint8Array(vals.length * 8), dv = new DataView(o.buffer); vals.forEach((v, i) => { dv.setUint32(i * 8, Math.floor(v / 4294967296)); dv.setUint32(i * 8 + 4, v >>> 0); }); return o; }
function _table(vals) { const o = new Uint8Array(vals.length * 4), dv = new DataView(o.buffer); vals.forEach((v, i) => dv.setUint32(i * 4, v >>> 0)); return o; }
const _MATRIX = _B(_u32(0x10000), _u32(0), _u32(0), _u32(0), _u32(0x10000), _u32(0), _u32(0), _u32(0), _u32(0x40000000));
function _rle(vals) { const out = []; let prev = null, cnt = 0; vals.forEach(v => { if (v === prev) cnt++; else { if (cnt) out.push(cnt, prev); prev = v; cnt = 1; } }); if (cnt) out.push(cnt, prev); return out; }

class Mp4Writer {
  constructor(o) {
    this.noVideo = !!o.noVideo; this.w = o.width || 0; this.h = o.height || 0; this.fps = o.fps || 30; this.audio = o.audio || null; this.codec = o.codec === 'hevc' ? 'hevc' : 'avc';
    this.vts = 90000; this.vdur = Math.round(90000 / o.fps); this.pcm = !!(o.audio && o.audio.pcm);          // pcm: the sound is stored as it is (24-bit), in a QuickTime file
    this.v = []; this.a = []; this.avcC = null; this.encAsc = null;
    this.sink = o.sink || null; this.co64 = !!o.co64; this.pend = []; this.pos = 0; this.big = false;          // with a sink the samples are written out as they come (a long video never sits in memory) and the table at the end says where they are
    // Safari can hand back a differently-wrapped AAC setup block, which produces a silent track. We know the audio is
    // AAC-LC at a known rate and channel count, so we write the standard 2-byte AudioSpecificConfig ourselves.
    this.asc = this.audio && !this.pcm ? Mp4Writer._aacLcAsc(this.audio.sampleRate, this.audio.channels) : null;
  }
  static _aacLcAsc(sampleRate, channels) {
    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    const fi = rates.indexOf(sampleRate), bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    if (!(channels >= 1 && channels <= 7)) throw new Error('Unsupported AAC channel count: ' + channels);
    put(2, 5);                                   // audio object type 2 = AAC-LC
    if (fi >= 0) put(fi, 4); else { put(15, 4); put(sampleRate, 24); }   // sample rate index, or explicit rate
    put(channels, 4);                            // channel configuration
    while (bits.length % 8) bits.push(0);
    const out = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bits.length; i++) out[i >> 3] |= bits[i] << (7 - (i & 7));
    return out;
  }
  setTags(t) { this.tags = t; }
  _udta() {          // iTunes-style tags: title, artist, album artist, composer, album, year
    const t = this.tags; if (!t) return new Uint8Array(0); const te = new TextEncoder();
    const item = (k, v) => v ? _box(k, _full('data', 0, 1, _u32(0), te.encode(v))) : new Uint8Array(0);
    const num = (k, n, bytes) => n ? _box(k, _full('data', 0, 21, _u32(0), bytes === 1 ? [n & 255] : _u16(n))) : new Uint8Array(0);          // whole numbers
    const pair = (k, n) => n ? _box(k, _full('data', 0, 0, _u32(0), [0, 0], _u16(n), [0, 0], [0, 0])) : new Uint8Array(0);          // track and disc: number, total (left empty)
    const ilst = _box('ilst', item('\xA9nam', t.title), item('\xA9ART', t.artist), item('aART', t.albumArtist), item('\xA9alb', t.album), item('\xA9day', t.year), pair('trkn', +t.track || 0), pair('disk', +t.disc || 0),
      item('\xA9wrt', t.composer), item('\xA9wrk', t.work), item('\xA9mvn', t.movement), num('\xA9mvi', +t.movementNo || 0, 2), num('shwm', t.showWork ? 1 : 0, 1), item('\xA9gen', t.genre), item('\xA9cmt', t.comment), num('cpil', t.compilation ? 1 : 0, 1));
    return _box('udta', _full('meta', 0, 0, _full('hdlr', 0, 0, _u32(0), 'mdir', 'appl', _u32(0), _u32(0), [0]), ilst));
  }
  setAudioTrim(delay, length) { this.trim = { delay: Math.max(0, Math.round(delay)), length: Math.round(length) }; }
  addVideo(chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.avcC) this.avcC = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description);
    const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); const sm = { d, key: chunk.type === 'key' }; this.v.push(sm); if (this.sink) this.pend.push(sm);
  }
  addPcm(d, frames) { const sm = { d, dur: frames }; this.a.push(sm); if (this.sink) this.pend.push(sm); }          // a block of 24-bit big-endian sound, channels interleaved
  addAudio(chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.encAsc) {
      this.encAsc = new Uint8Array(meta.decoderConfig.description.slice ? meta.decoderConfig.description.slice(0) : meta.decoderConfig.description);
      const hex = a => Array.from(a).map(x => ('0' + x.toString(16)).slice(-2)).join(' ');
      const same = this.encAsc.length === this.asc.length && this.encAsc.every((x, i) => x === this.asc[i]);
      if (typeof dbg === 'function') dbg('AAC setup: the encoder reported ' + this.encAsc.length + ' bytes [' + hex(this.encAsc.subarray(0, 24)) + '] for ' + this.audio.sampleRate + ' Hz, ' + this.audio.channels + ' ch. The MP4 uses the standard AAC-LC setup [' + hex(this.asc) + ']' + (same ? ' (identical)' : ' (DIFFERENT, so the encoder value was not used)'));
    }
    const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    const sr = this.audio.sampleRate; const dur = chunk.duration ? Math.round(chunk.duration * sr / 1e6) : 1024;
    const sm = { d, dur }; this.a.push(sm); if (this.sink) this.pend.push(sm);
  }
  _stco(offs) { return this.big ? _full('co64', 0, 0, _u32(offs.length), _table64(offs)) : _full('stco', 0, 0, _u32(offs.length), _table(offs)); }          // 64-bit places when the file is over 4GB
  _chunks(samples, per) { const out = []; for (let i = 0; i < samples.length; i += per) out.push(samples.slice(i, i + per)); return out; }
  /* trim = { delay, length } for the sound: the encoder's start padding is skipped and the track ends at the exact length (an edit list, so players start the sound on time) */
  _trak(id, kind, ts, durMedia, stsd, sttsVals, samples, chunks, offsets, keyList, trim) {
    const durMovie = trim ? Math.round(trim.length * Mp4Writer.MT / ts) : Math.ceil(durMedia * Mp4Writer.MT / ts);
    const edts = trim ? _box('edts', _full('elst', 0, 0, _u32(1), _u32(durMovie), _u32(trim.delay), _u16(1), _u16(0))) : new Uint8Array(0);
    const tkhd = _full('tkhd', 0, 3, _u32(0), _u32(0), _u32(id), _u32(0), _u32(durMovie), _zeros(8), _u16(0), _u16(0), _u16(kind === 'soun' ? 0x100 : 0), _u16(0), _MATRIX,
      _u32(kind === 'vide' ? this.w * 65536 : 0), _u32(kind === 'vide' ? this.h * 65536 : 0));
    const mdhd = _full('mdhd', 0, 0, _u32(0), _u32(0), _u32(ts), _u32(durMedia), _u16(0x55c4), _u16(0));
    const hdlr = _full('hdlr', 0, 0, _u32(0), kind, _zeros(12), kind === 'vide' ? 'VideoHandler\0' : 'SoundHandler\0');
    const mhd = kind === 'vide' ? _full('vmhd', 0, 1, _zeros(8)) : _full('smhd', 0, 0, _zeros(4));
    const dinf = _box('dinf', _full('dref', 0, 0, _u32(1), _full('url ', 0, 1)));
    const stts = _full('stts', 0, 0, _u32(sttsVals.length / 2), _table(sttsVals));
    const stscVals = []; let prev = -1;
    chunks.forEach((c, i) => { if (c.length !== prev) { stscVals.push(i + 1, c.length, 1); prev = c.length; } });
    const stsc = _full('stsc', 0, 0, _u32(stscVals.length / 3), _table(stscVals));
    const stsz = _full('stsz', 0, 0, _u32(0), _u32(samples.length), _table(samples.map(s => s.d.length)));
    const stco = this._stco(offsets);
    const stss = keyList ? _full('stss', 0, 0, _u32(keyList.length), _table(keyList)) : new Uint8Array(0);
    const stbl = _box('stbl', stsd, stts, stss, stsc, stsz, stco);
    return _box('trak', tkhd, edts, _box('mdia', mdhd, hdlr, _box('minf', mhd, dinf, stbl)));
  }
  /* the bitrate the encoder really produced, so players show the true figure (kbps) */
  audioKbps() {
    const sr = this.audio.sampleRate; let bytes = 0, samples = 0;
    for (const c of this.a) { bytes += c.d.length; samples += c.dur; }
    return samples ? bytes * 8 * sr / samples / 1000 : 0;
  }
  _esds() {
    const asc = this.asc, bps = Math.round(this.audioKbps() * 1000);
    const dcd = _B([0x40, 0x15, 0, 0, 0], _u32(bps), _u32(bps), [0x05, asc.length], asc);
    const es = _B([0, 0, 0], [0x04, dcd.length], dcd, [0x06, 0x01, 0x02]);
    return _full('esds', 0, 0, [0x03, es.length], es);
  }
  _moov(vOff, aOff, vChunks, aChunks) {
    const hasA = !!(this.audio && this.a.length && (this.asc || this.pcm));
    const vDurMedia = this.v.length * this.vdur;
    const keyList = []; this.v.forEach((s, i) => { if (s.key) keyList.push(i + 1); });
    const ve = this.codec === 'hevc' ? ['hvc1', 'hvcC'] : ['avc1', 'avcC'];
    const avc1 = this.noVideo ? null : _box(ve[0], _zeros(6), _u16(1), _u16(0), _u16(0), _zeros(12), _u16(this.w), _u16(this.h), _u32(0x480000), _u32(0x480000), _u32(0), _u16(1), _zeros(32), _u16(0x18), _u16(0xffff), _box(ve[1], this.avcC));
    const vtrak = this.noVideo ? new Uint8Array(0) : this._trak(1, 'vide', this.vts, vDurMedia, _full('stsd', 0, 0, _u32(1), avc1), [this.v.length, this.vdur], this.v, vChunks, vOff, keyList);
    let atrak = new Uint8Array(0), aDurMs = 0;
    if (hasA && this.pcm) {
      const sr = this.audio.sampleRate, ch = this.audio.channels, frames = this.a.reduce((n, x) => n + x.dur, 0), bpf = 3 * ch;
      const in24 = _box('in24', _zeros(6), _u16(1), _u16(1), _u16(0), _u32(0), _u16(ch), _u16(16), _u16(0), _u16(0), _u32((sr * 65536) >>> 0), _u32(1), _u32(3), _u32(bpf), _u32(3), _box('wave', _box('frma', 'in24'), _box('enda', [0, 0]), _u32(8), _u32(0)));
      const sc = []; let pv = -1; aChunks.forEach((c, i) => { if (c[0].dur !== pv) { sc.push(i + 1, c[0].dur, 1); pv = c[0].dur; } });
      aDurMs = Math.ceil(frames * Mp4Writer.MT / sr);
      atrak = _box('trak', _full('tkhd', 0, 3, _u32(0), _u32(0), _u32(2), _u32(0), _u32(aDurMs), _zeros(8), _u16(0), _u16(0), _u16(0x100), _u16(0), _MATRIX, _u32(0), _u32(0)), _box('mdia', _full('mdhd', 0, 0, _u32(0), _u32(0), _u32(sr), _u32(frames), _u16(0x55c4), _u16(0)), _full('hdlr', 0, 0, _u32(0), 'soun', _zeros(12), 'SoundHandler\0'),
        _box('minf', _full('smhd', 0, 0, _zeros(4)), _box('dinf', _full('dref', 0, 0, _u32(1), _full('url ', 0, 1))), _box('stbl', _full('stsd', 0, 0, _u32(1), in24), _full('stts', 0, 0, _u32(1), _u32(frames), _u32(1)),
          _full('stsc', 0, 0, _u32(sc.length / 3), _table(sc)), _full('stsz', 0, 0, _u32(bpf), _u32(frames)), this._stco(aOff)))));
    } else if (hasA) {
      const sr = this.audio.sampleRate, ch = this.audio.channels;
      const aDurMedia = this.a.reduce((s, x) => s + x.dur, 0); aDurMs = Math.ceil((this.trim && this.trim.length > 0 ? this.trim.length : aDurMedia) * Mp4Writer.MT / sr);
      const mp4a = _box('mp4a', _zeros(6), _u16(1), _zeros(8), _u16(ch), _u16(16), _u16(0), _u16(0), _u32((sr * 65536) >>> 0), this._esds());
      atrak = this._trak(2, 'soun', sr, aDurMedia, _full('stsd', 0, 0, _u32(1), mp4a), _rle(this.a.map(x => x.dur)), this.a, aChunks, aOff, null, this.trim && this.trim.length > 0 ? this.trim : null);
    }
    const durMs = Math.max(Math.ceil(vDurMedia * Mp4Writer.MT / this.vts), aDurMs);
    const mvhd = _full('mvhd', 0, 0, _u32(0), _u32(0), _u32(Mp4Writer.MT), _u32(durMs), _u32(0x10000), _u16(0x100), _u16(0), _zeros(8), _MATRIX, _zeros(24), _u32(hasA ? 3 : 2));
    return _box('moov', mvhd, vtrak, atrak, this._udta());
  }
  _ftyp() { return this.pcm ? _box('ftyp', 'qt  ', _u32(0x20050300), 'qt  ') : this.noVideo ? _box('ftyp', 'M4A ', _u32(0), 'M4A ', 'mp42', 'isom') : _box('ftyp', 'isom', _u32(512), 'isom', 'iso2', this.codec === 'hevc' ? 'hvc1' : 'avc1', 'mp41'); }
  /* with a sink: the file starts with its type and the header of the media data (its size is filled in at the end), then samples are written as they come (drain) */
  async begin() { const f = this._ftyp(); this.mdatAt = f.length; this.pos = f.length + 16; await this.sink.put(_B(f, _u32(1), 'mdat', new Uint8Array(8)).buffer); }
  async drain() {
    if (!this.sink || !this.pend.length) return; const list = this.pend; this.pend = []; let n = 0; for (const x of list) n += x.d.length;
    const buf = new Uint8Array(n); let q = 0; for (const x of list) { buf.set(x.d, q); x.o = this.pos + q; q += x.d.length; x.d = { length: x.d.length }; }          // each sample keeps its size and place, not its bytes
    this.pos += n; await this.sink.put(buf.buffer);
  }
  /* the table of where everything is goes after the media data; the size of the media data is then written into its header. The file is over 4GB: places are 64-bit */
  async finalizeStream() {
    if (!this.noVideo && !this.avcC) throw new Error('No video data was produced.');
    await this.drain();
    const vPer = Math.max(1, Math.round(this.fps)), aPer = this.audio && !this.pcm ? Math.max(1, Math.ceil(this.audio.sampleRate / 1024)) : 1;
    const vChunks = this._chunks(this.v, vPer), aChunks = (this.audio && this.a.length && (this.asc || this.pcm)) ? this._chunks(this.a, aPer) : [];
    this.big = this.co64 || this.pos > 0xfffffff0;
    const moov = this._moov(vChunks.map(c => c[0].o), aChunks.map(c => c[0].o), vChunks, aChunks);
    await this.sink.put(moov.slice().buffer); await this.sink.done();
    const hd = new DataView(new ArrayBuffer(8)); hd.setUint32(0, Math.floor((this.pos - this.mdatAt) / 4294967296)); hd.setUint32(4, (this.pos - this.mdatAt) >>> 0);
    await this.sink.patch(this.mdatAt + 8, hd.buffer);
    return this.pos + moov.length;
  }
  finalize() {
    if (!this.noVideo && !this.avcC) throw new Error('No video data was produced.');
    const vPer = Math.max(1, Math.round(this.fps));
    const aPer = this.audio && !this.pcm ? Math.max(1, Math.ceil(this.audio.sampleRate / 1024)) : 1;
    const vChunks = this._chunks(this.v, vPer), aChunks = (this.audio && this.a.length && (this.asc || this.pcm)) ? this._chunks(this.a, aPer) : [];
    const order = []; const total = Math.max(vChunks.length, aChunks.length);
    for (let i = 0; i < total; i++) { if (vChunks[i]) order.push(['v', i]); if (aChunks[i]) order.push(['a', i]); }
    const ftyp = this._ftyp();
    const zeroV = new Array(vChunks.length).fill(0), zeroA = new Array(aChunks.length).fill(0);
    const moovLen = this._moov(zeroV, zeroA, vChunks, aChunks).length;
    let pos = ftyp.length + moovLen + 8; const vOff = [], aOff = [], body = [];
    order.forEach(([k, i]) => {
      const list = k === 'v' ? vChunks[i] : aChunks[i]; (k === 'v' ? vOff : aOff).push(pos);
      list.forEach(s => { body.push(s.d); pos += s.d.length; });
    });
    if (pos > 0xfffffff0) throw new Error('The video is too large for a single MP4 file. Try a lower quality or a shorter video.');
    const moov = this._moov(vOff, aOff, vChunks, aChunks);
    const mdatHead = _B(_u32(pos - (ftyp.length + moov.length)), 'mdat');
    return new Blob([ftyp, moov, mdatHead, ...body], { type: this.pcm ? 'video/quicktime' : this.noVideo ? 'audio/mp4' : 'video/mp4' });
  }
}
Mp4Writer.MT = 90000;          // the movie's time unit (ticks a second): fine enough that an edit list lands within a fraction of a sample
//#endregion muxer

const EXP = { ctl: null, blob: null, name: '', ext: 'mp4', url: '', running: false, stage: '', stageT: 0, wd: 0, stallAfter: 8 };
const expOpen = () => !$('#expDlg').hidden;
const editorOpen = () => !$('#audioDlg').hidden || !$('#pdfDlg').hidden;
const expStallOn = () => $('#expStallFold').classList.contains('open');
function setExpOpen(on) {
  $('#expDlg').hidden = !on;
  if (!on) { const v = $('#expPreview'); v.pause(); v.removeAttribute('src'); v.hidden = true; foldSet('#expLinkFold', false); if (EXP.url) { URL.revokeObjectURL(EXP.url); EXP.url = ''; } }
}
let _expLast = 0, _expNote = '';
function expUI(state, msg, pct, note) {
  const now = performance.now();
  if (state === 'working' && now - _expLast < 120 && (note === undefined || note === _expNote)) return;   // keep the page light while rendering
  _expLast = now; if (note !== undefined) _expNote = note;
  $('#expMsg').textContent = state === 'working' ? (pct == null || pct <= 0.02 ? 'Processing…' : 'Processing ' + Math.min(100, Math.round(pct * 100)) + '%') + (msg && msg.includes(' · ') ? msg.slice(msg.indexOf(' · ')) : '') : msg || '';          // every wait reads the same: Processing… first, then Processing N%
  $('#expMsg').classList.toggle('err', state === 'error');
  if (pct != null) { $('#expBar').style.width = Math.round(pct * 100) + '%'; $('#expBarWrap').setAttribute('aria-valuenow', Math.round(pct * 100)); }
  $('#expBarWrap').hidden = state === 'error';
  $('#expCancel').hidden = state !== 'working';
  $('#expClose').hidden = state === 'working';
  $('#expSave').hidden = state !== 'done';
  const stalled = state === 'working' && expStallOn();
  if (state !== 'working') foldSet('#expStallFold', false);
  $('#expRetry').hidden = !(state === 'error' || stalled);
  $('#expLogBtn').hidden = !(state === 'error' || stalled);      // the debug log is only offered when something went wrong
  if (state === 'working') { if (note !== undefined) { $('#expNote').hidden = !note; if (note) $('#expNote').textContent = note; } }
  else { $('#expNote').hidden = !note; if (note) $('#expNote').textContent = note; }
  setDots($('#expTitle'), state === 'done' ? 'Boom. Your video is ready' : state === 'error' ? 'Export did not finish' : 'Exporting your video…');
}
async function waitQueue(enc, limit, ms, getErr) {
  const t0 = performance.now(); let spins = 0;
  while (enc.encodeQueueSize > limit) {
    if (getErr()) return;
    if (performance.now() - t0 > ms) throw new Error('The encoder stopped responding (' + enc.encodeQueueSize + ' frames waiting for ' + Math.round(ms / 1000) + ' s)');
    if (spins++ < 40) await yieldNow(); else await sleep(2);
  }
}
function envInfo() {
  const out = [];
  out.push('Browser: ' + navigator.userAgent);
  out.push('Page: ' + location.protocol + '//' + (location.host || '(local file)') + ', framed: ' + (window.top !== window) + ', secure context: ' + window.isSecureContext);
  out.push('Screen: ' + screen.width + '×' + screen.height + ' @' + (window.devicePixelRatio || 1) + 'x, CPU cores: ' + (navigator.hardwareConcurrency || '?'));
  out.push('APIs: VideoEncoder=' + (typeof VideoEncoder !== 'undefined') + ' AudioEncoder=' + (typeof AudioEncoder !== 'undefined') + ' VideoFrame=' + (typeof VideoFrame !== 'undefined') + ' AudioData=' + (typeof AudioData !== 'undefined') + ' MediaRecorder=' + (typeof MediaRecorder !== 'undefined'));
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl');
    if (gl) { const x = gl.getExtension('WEBGL_debug_renderer_info'); out.push('WebGL: ' + (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) + ', max texture ' + gl.getParameter(gl.MAX_TEXTURE_SIZE)); } else out.push('WebGL: unavailable');
  } catch (e) { out.push('WebGL check failed: ' + e.message); }
  if (actx) out.push('Audio output: ' + actx.sampleRate + ' Hz, state ' + actx.state);
  if (S.pdf) out.push('Score: ' + S.pdf.n + ' pages, page aspect ' + S.pdf.aspect.toFixed(3));
  if (S.audio) out.push('Audio file: ' + S.audio.name + ', ' + S.audio.duration.toFixed(1) + ' s, ' + audSr() + ' Hz, ' + audCh() + ' ch');
  return out;
}
/* An AAC encoder starts its output with a little padding (its filter delay), so the file's sound would start late. The size of it differs between encoders, so it is measured here:
   a single click is encoded and decoded again and found where it lands. The edit list in the MP4 then skips exactly that much. */
const AAC_DELAY = {};
async function aacDelay(cfg) {
  const sr = cfg.sampleRate, ch = cfg.numberOfChannels, key = sr + '|' + ch; if (AAC_DELAY[key] != null) return AAC_DELAY[key];
  let d = 2112;          // the usual figure, if measuring is not possible
  try {
    if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') throw new Error('no decoder');
    const n = sr, at = Math.round(sr / 2), chunks = []; let err = null;
    const enc = new AudioEncoder({ output: c => chunks.push(c), error: e => { err = e; } }); enc.configure(cfg);
    for (let pos = 0; pos < n; pos += 4096) {
      const len = Math.min(4096, n - pos), data = new Float32Array(len * ch); if (at >= pos && at < pos + len) for (let c = 0; c < ch; c++) data[c * len + at - pos] = 0.9;
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round(pos * 1e6 / sr), data }); enc.encode(ad); ad.close();
    }
    await enc.flush(); enc.close(); if (err) throw err;
    const pcm = []; const dec = new AudioDecoder({ output: a => { const x = new Float32Array(a.numberOfFrames); a.copyTo(x, { planeIndex: 0, format: 'f32-planar' }); pcm.push(x); a.close(); }, error: e => { err = e; } });
    dec.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, description: Mp4Writer._aacLcAsc(sr, ch) });
    for (const c of chunks) { const b = new Uint8Array(c.byteLength); c.copyTo(b); dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: c.timestamp, duration: c.duration, data: b })); }
    await dec.flush(); dec.close(); if (err) throw err;
    let idx = 0, best = 0, off = 0; for (const x of pcm) { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > best) { best = Math.abs(x[i]); idx = off + i; } off += x.length; }
    if (best > 0.2 && idx - at >= 0 && idx - at <= 4096) d = idx - at;
  } catch (e) { if (typeof dbg === 'function') dbg('Could not measure the AAC delay (' + (e && e.message || e) + '), using ' + d); }
  AAC_DELAY[key] = d; if (typeof dbg === 'function') dbg('AAC encoder delay at ' + sr + ' Hz: ' + d + ' samples'); return d;
}
/* the AAC settings the browser will accept. Safari ignores the bitrate you ask for unless the encoder is told to hold it (constant), then gives about 130 kbps whatever you set; Chrome keeps to it either way. */
async function aacConfig(sr, ch, bitrate) {
  const base = { codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate };
  for (const extra of [{ bitrateMode: 'constant', aac: { format: 'aac' } }, { aac: { format: 'aac' } }, {}]) {
    const cfg = Object.assign({}, base, extra);
    try { const r = await AudioEncoder.isConfigSupported(cfg); if (r && r.supported) return cfg; } catch (e) {}
  }
  return null;
}
async function detectCodecs(o, fps) {
  const res = { webcodecs: false };
  dbg('Checking encoder support for ' + o.W + '×' + o.H + ' @ ' + fps + ' fps');
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') { res.reason = 'this browser does not support WebCodecs'; dbg('  ' + res.reason); return res; }
  if (S.audio) { res.audioConfig = { sampleRate: audSr(), numberOfChannels: Math.min(2, audCh()), pcm: true }; dbg('  audio: lossless 24-bit, no encoder needed'); }          // the sound is never compressed
  res.webcodecs = true; return res;
}

/* ---------- Fast-export settings: tried in order until one works on this device ---------- */
function avcLevelFor(W, H, fps) {
  const mbs = Math.ceil(W / 16) * Math.ceil(H / 16), mbps = mbs * fps;
  const L = [['28', 245760, 8192], ['2A', 522240, 8704], ['32', 589824, 22080], ['33', 983040, 36864], ['34', 2073600, 36864]];
  let i = L.findIndex(l => mbs <= l[2] && mbps <= l[1]); if (i < 0) i = L.length - 1;
  return { a: L[i][0], b: L[Math.min(L.length - 1, i + 1)][0] };
}
function hevcLevelFor(W, H, fps) {
  const px = W * H, sr = px * fps;
  if (px <= 2228224 && sr <= 133693440) return 'L123';
  if (px <= 8912896 && sr <= 534773760) return 'L153';
  return 'L156';
}
function buildProfiles(o, fps, family) {
  const out = [];
  if (family === 'hevc') {
    const codec = 'hvc1.1.6.' + hevcLevelFor(o.W, o.H, fps) + '.B0';
    [['H2', 'realtime', 'copy2d', 'lockstep'], ['H3', 'realtime', 'direct', 'lockstep'], ['H1', 'quality', 'copy2d', 'lockstep'], ['H4', 'quality', 'direct', 'free'], ['H5', 'realtime', 'raw', 'lockstep']]
      .forEach(([id, latency, handoff, pace]) => out.push({ id, family: 'hevc', codec, latency, handoff, pace, label: 'HEVC' }));
    return out;
  }
  const lv = avcLevelFor(o.W, o.H, fps), pre = { High: '6400', Main: '4D00', Base: '42E0' };
  [['A2', 'High', lv.a, 'realtime', 'copy2d', 'lockstep'], ['A3', 'High', lv.a, 'realtime', 'direct', 'lockstep'], ['A1', 'High', lv.a, 'quality', 'copy2d', 'lockstep'],
   ['A4', 'High', lv.a, 'quality', 'direct', 'free'], ['A5', 'Main', lv.a, 'realtime', 'copy2d', 'lockstep'], ['A6', 'High', lv.b, 'realtime', 'copy2d', 'lockstep'],
   ['A7', 'High', lv.a, 'realtime', 'bitmap', 'lockstep'], ['A8', 'High', lv.a, 'realtime', 'raw', 'lockstep'], ['A9', 'Base', lv.a, 'realtime', 'copy2d', 'lockstep']]
    .forEach(([id, prof, l, latency, handoff, pace]) => out.push({ id, family: 'avc', codec: 'avc1.' + pre[prof] + l, latency, handoff, pace, label: 'H.264' }));
  return out;
}
const QUALITY_NAME = { standard: 'Standard', high: 'High', max: 'Max' };
const VQ = { standard: 1, high: 1.5, max: 2.2 };
/* what the choice means in numbers: the video's data rate for the current size, frame rate and codec, and what a minute of it weighs */
function vqNote() {
  const el = $('#vqNote'); if (!el) return; const ar = ASPECTS[S.set.aspect] || 16 / 9, px = +S.set.res * +S.set.res * ar, base = px * (+S.set.fps || 30) * (S.set.codec === 'hevc' ? 0.085 : 0.14);
  const m = clamp(base * VQ[S.set.videoQuality || 'standard'], 4e6, 100e6) / 1e6, lossless = !!S.audio && S.set.method !== 'realtime';          // real-time recording compresses the sound, so it is not lossless
  el.textContent = (lossless ? 'Lossless audio · ' : '') + '~' + Math.round(m) + 'Mbps · ' + Math.round(m * 7.5) + 'MB a minute';
}
          // the video bitrate, as a multiple of the usual
const profDesc = p => p.id + ' [' + p.codec + ', ' + p.latency + ' latency, ' + p.handoff + ' frames, ' + p.pace + ' pacing]';
function profileConfig(p, o, fps) {
  const bitrate = Math.round(clamp(o.W * o.H * fps * (p.family === 'hevc' ? 0.085 : 0.14) * VQ[S.set.videoQuality || 'standard'], 4e6, 100e6));
  const cfg = { codec: p.codec, width: o.W, height: o.H, bitrate, framerate: fps, latencyMode: p.latency };
  if (p.family === 'hevc') cfg.hevc = { format: 'hevc' }; else cfg.avc = { format: 'avc' };
  return cfg;
}
const profSig = (o, fps, family) => navigator.userAgent + '|' + family + '|' + o.W + 'x' + o.H + '@' + fps;
function savedProfiles() { try { return JSON.parse(localStorage.getItem('glisscore.profiles') || '{}'); } catch (e) { return {}; } }
function saveProfile(sig, id) { try { const m = savedProfiles(); if (id) m[sig] = id; else delete m[sig]; localStorage.setItem('glisscore.profiles', JSON.stringify(m)); } catch (e) {} }

/* Turns the WebGL picture into a VideoFrame. Different browsers are happy with different methods. */
class FrameMaker {
  constructor(canvas, gl, kind, W, H) { this.canvas = canvas; this.gl = gl; this.kind = kind; this.W = W; this.H = H; this.c2 = null; this.raw = null; this.flip = null; }
  async make(ts, dur) {
    const k = this.kind, init = { timestamp: ts, duration: dur };
    if (k === 'copy2d') {
      if (!this.c2) { this.c2 = document.createElement('canvas'); this.c2.width = this.W; this.c2.height = this.H; this.c2x = this.c2.getContext('2d', { alpha: false }); }
      this.c2x.drawImage(this.canvas, 0, 0); return new VideoFrame(this.c2, init);
    }
    if (k === 'bitmap') { const bm = await createImageBitmap(this.canvas); try { return new VideoFrame(bm, init); } finally { bm.close(); } }
    if (k === 'raw') {
      const gl = this.gl, W = this.W, H = this.H, rb = W * 4;
      if (!this.raw) { this.raw = new Uint8Array(W * H * 4); this.flip = new Uint8Array(W * H * 4); }
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.raw);
      for (let y = 0; y < H; y++) this.flip.set(this.raw.subarray((H - 1 - y) * rb, (H - y) * rb), y * rb);
      return new VideoFrame(this.flip, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: ts, duration: dur });
    }
    return new VideoFrame(this.canvas, init);
  }
}
function drawTestPattern(gl, i, W, H) {
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, W, H); gl.clearColor(0.97, 0.97, 0.95, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.clearColor(0, 0, 0, 1);
  for (let k = 0; k < 14; k++) { gl.scissor(Math.round(W * 0.1), Math.round(H * (0.1 + k * 0.06)), Math.round(W * 0.8), Math.max(2, Math.round(H * 0.004))); gl.clear(gl.COLOR_BUFFER_BIT); }
  gl.scissor(Math.round(W * (0.1 + 0.7 * (i % 24) / 24)), Math.round(H * 0.05), Math.round(W * 0.05), Math.round(H * 0.9)); gl.clearColor(0.2, 0.3, 0.8, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.SCISSOR_TEST);
}
/* Encodes a short test clip with one set of settings. Passes only if every frame comes back out. */
async function probeProfile(pr, o, fps, opt = {}) {
  const N = opt.n || 30, limit = opt.limit || TIMEOUTS.probe, t0 = performance.now();
  const st = { submitted: 0, outputs: 0, err: null }; let enc = null, hasDesc = false;
  const canvas = document.createElement('canvas'); canvas.width = o.W; canvas.height = o.H;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  if (!gl) return { ok: false, ms: 0, n: 0, reason: 'could not create a WebGL context' };
  const cfg = profileConfig(pr, o, fps);
  const run = async () => {
    const sup = await VideoEncoder.isConfigSupported(cfg);
    if (!sup || !sup.supported) throw new Error('this browser says the configuration is not supported');
    enc = new VideoEncoder({ output: (c, m) => { st.outputs++; if (m && m.decoderConfig && m.decoderConfig.description) hasDesc = true; if (opt.onChunk) opt.onChunk(c, m); }, error: e => { st.err = e; } });
    enc.configure(cfg);
    const fm = new FrameMaker(canvas, gl, pr.handoff, o.W, o.H), lim = pr.pace === 'lockstep' ? 2 : 12;
    for (let i = 0; i < N; i++) {
      drawTestPattern(gl, i, o.W, o.H);
      const f = await fm.make(Math.round(i * 1e6 / fps), Math.round(1e6 / fps));
      enc.encode(f, { keyFrame: i === 0 }); f.close(); st.submitted++;
      if (st.err) throw st.err;
      await waitQueue(enc, lim, 60000, () => st.err);
    }
    await enc.flush();
    if (st.err) throw st.err;
    if (st.outputs < N) throw new Error('only ' + st.outputs + ' of ' + N + ' frames came out');
    if (!hasDesc) throw new Error('the encoder gave no decoder configuration');
  };
  const pRun = run(); pRun.catch(() => {});
  try { await withTimeout(pRun, limit, 'encoding test frames'); return { ok: true, ms: performance.now() - t0, n: N }; }
  catch (e) { return { ok: false, ms: performance.now() - t0, n: st.submitted, reason: ((e && e.message) || e) + ' [sent ' + st.submitted + ', came out ' + st.outputs + ', queue ' + (enc ? enc.encodeQueueSize : '?') + ']' }; }
  finally { try { enc && enc.close(); } catch (e) {} try { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {} }
}
async function pickProfile(o, fps, family, opt = {}) {
  const profiles = buildProfiles(o, fps, family), sig = profSig(o, fps, family), skip = opt.skip || new Set();
  if (!opt.fresh && !opt.report) {
    const id = savedProfiles()[sig], pr = profiles.find(p => p.id === id && !skip.has(p.id));
    if (pr) { dbg('Using the encoder settings that worked last time: ' + profDesc(pr)); return pr; }
  }
  let winner = null;
  for (const pr of profiles) {
    if (skip.has(pr.id)) continue;
    EXP.stage = 'testing encoder settings ' + pr.id; EXP.stageT = performance.now();
    if (opt.progress) opt.progress(pr);
    const r = await probeProfile(pr, o, fps);
    dbg((r.ok ? 'PASS  ' : 'FAIL  ') + profDesc(pr) + ' — ' + (r.ok ? 'worked: ' + r.n + ' test frames in ' + Math.round(r.ms) + ' ms' : r.reason));
    if (r.ok && !winner) { winner = pr; if (!opt.report) break; }
    if (!opt.report && EXP.ctl && EXP.ctl.cancelled) return null;
  }
  if (winner && !opt.noSave) saveProfile(sig, winner.id);
  return winner;
}

async function exportWebCodecs(o, fps, dur, ctl, caps) {
  const stage = s => { EXP.stage = s; EXP.stageT = performance.now(); };
  const pr = caps.profile, vcfg = profileConfig(pr, o, fps);
  stage('creating the renderer');
  const canvas = document.createElement('canvas'); canvas.width = o.W; canvas.height = o.H;
  const rend = new Renderer(canvas, PageSource, { cap: 10 }); rend.resize(o.W, o.H);
  const fm = new FrameMaker(canvas, rend.gl, pr.handoff, o.W, o.H), qLimit = pr.pace === 'lockstep' ? 2 : 12;
  dbg('renderer created (' + o.W + '×' + o.H + '), using ' + profDesc(pr));
  const dk = !!(S.audio && S.audio.disk), wr = dk ? diskWriter() : null; if (dk) { await DISK.fileOpen(); DISK.fxUse(S.set.fx); }          // a long recording: the file is written into the store as it is made
  const mux = new Mp4Writer({ width: o.W, height: o.H, fps, codec: pr.family, sink: wr, audio: caps.audioConfig ? { sampleRate: caps.audioConfig.sampleRate, channels: caps.audioConfig.numberOfChannels, pcm: !!caps.audioConfig.pcm } : null });
  let encErr = null, vOut = 0, aOut = 0;
  const venc = new VideoEncoder({
    output: (c, m) => { vOut++; if (vOut <= 3) dbg('video chunk ' + vOut + ': ' + c.type + ', ' + c.byteLength + ' bytes' + (m && m.decoderConfig ? ', has decoder config' : '')); mux.addVideo(c, m); },
    error: e => { encErr = e; dbg('VIDEO ENCODER ERROR: ' + (e && e.message || e)); }
  });
  const cleanup = (drop) => { try { venc.close(); } catch (e) {} rend.destroy(); if (dk && drop !== false) DISK.fileDrop(); };
  try {
    if (dk) await mux.begin();
    stage('configuring the video encoder');
    venc.configure(vcfg); dbg('video encoder configured: ' + JSON.stringify(vcfg));
    const pcm = !!(caps.audioConfig && caps.audioConfig.pcm);
    if (caps.audioConfig) {
      expUI('working', 'Processing', 0.02);
      try { await fxGet(S.set.fx); } catch (e) { dbg('Processing failed: ' + (e && e.message || e)); }
      if (S.set.normalize && S.set.normBy === 'loud') { expUI('working', 'Processing', 0.02); { const da = aeFromApp(); await loudEnsure(da); if (da.limiter) await limEnsure(da); } }
      const buf = dk ? null : outBuf(), sr = dk ? audSr() : buf.sampleRate, ch = caps.audioConfig.numberOfChannels, total0 = Math.ceil(dur * sr);
      const mm = dk ? await aeMasterDisk(aeFromApp(), ch, false, null, { own: true, total: total0, gain: audioGain() }) : masterMaker(buf, ch, S.vStart, vEnd(), audioGain(), soundFadeAt, { total: total0, limit: limOn(S.set) ? LIM_CEIL : null }), total = mm.total;
      for (let pos = 0, n = 0; pos < total; pos += sr, n++) {          // the sound goes in untouched, one second at a time, 24-bit
        if (ctl.cancelled) break;
        const len = Math.min(sr, total - pos), data = new Float32Array(len * ch); await mm.fill(pos, len, data); mux.addPcm(pcm24be(data, len, ch), len); aOut++; if (dk) await mux.drain();
        if (n % 8 === 0) { expUI('working', 'Processing', 0.02 + 0.08 * pos / total); await yieldNow(); }
      }
      dbg('lossless audio written: ' + aOut + ' blocks');
    }
    let lastKey = null;
    const totalFrames = Math.ceil(dur * fps), keyEvery = Math.max(1, fps * 2), t0 = performance.now();
    dbg('rendering ' + totalFrames + ' frames');
    for (let i = 0; i < totalFrames; i++) {
      if (ctl.cancelled || encErr) break;
      const v = i < 4, n = i + 1, st = frameState(S.vStart + i / fps);
      const key = st.spread + '|' + st.flip + '|' + st.fade + '|' + creditsAlpha(st.t);          // nothing on screen has moved since the last frame: the canvas still holds it, so it is not drawn again
      if (key !== lastKey) {
        stage('frame ' + n + ': loading score pages');
        await withTimeout(rend.ensure(pagesFor(st)), TIMEOUTS.ensure, 'loading score pages for frame ' + n);
        if (v) dbg('frame ' + n + ': pages ready');
        stage('frame ' + n + ': drawing'); rend.render(st); if (v) dbg('frame ' + n + ': drawn'); lastKey = key;
      }
      stage('frame ' + n + ': copying the image for the encoder');
      const frame = await fm.make(Math.round(i * 1e6 / fps), Math.round(1e6 / fps));
      if (v) dbg('frame ' + n + ': video frame created');
      stage('frame ' + n + ': sending to the video encoder');
      venc.encode(frame, { keyFrame: i % keyEvery === 0 }); frame.close();
      if (v) dbg('frame ' + n + ': encode() returned, queue ' + venc.encodeQueueSize + ', encoded so far ' + vOut);
      if (venc.encodeQueueSize > qLimit) { stage('frame ' + n + ': waiting for the encoder (queue ' + venc.encodeQueueSize + ')'); await waitQueue(venc, qLimit, TIMEOUTS.queue, () => encErr); }
      if (dk && i % 30 === 29) await mux.drain();
      if (i % 5 === 0) {
        const done = i / totalFrames, el = (performance.now() - t0) / 1000, eta = done > 0.02 ? el / done * (1 - done) : 0;
        expUI('working', 'Processing' + (eta ? ' · about ' + Math.max(1, Math.round(eta)) + 's left' : ''), 0.1 + 0.88 * done);
        stage('frame ' + n + ': yielding to the page'); await yieldNow(); if (v) dbg('frame ' + n + ': yield done');
      }
      if (i % 150 === 0 && i > 0) dbg('progress: frame ' + n + '/' + totalFrames + ', encoded ' + vOut + ', queue ' + venc.encodeQueueSize);
    }
    if (ctl.cancelled) { cleanup(); return null; }
    if (encErr) throw encErr;
    expUI('working', 'Processing', 0.99);
    stage('finishing the video encoder'); await withTimeout(venc.flush(), TIMEOUTS.flush, 'the video encoder finishing');
    dbg('video encoding done: ' + vOut + ' chunks for ' + totalFrames + ' frames');
    if (encErr) throw encErr;
    if (!vOut) throw new Error('The video encoder produced no video');
    stage('writing the MP4 file'); let blob; if (dk) { const size = await mux.finalizeStream(), file = await DISK.fileDone(); blob = file.slice(0, size, pcm ? 'video/quicktime' : 'video/mp4'); } else blob = mux.finalize(); if (caps.audioConfig && !pcm) dbg('Audio: asked the encoder for ' + caps.audioConfig.bitrate / 1000 + ' kbps, it produced about ' + Math.round(mux.audioKbps()) + ' kbps'); dbg('MP4 written: ' + (blob.size / 1048576).toFixed(1) + ' MB');
    cleanup(false);
    return { blob, ext: pcm ? 'mov' : 'mp4' };
  } catch (e) { cleanup(); throw e; }
}

/* floating-point sound to 24-bit big-endian, channels interleaved (a quiet file never gets noisier: rounding to 24 bits is far below anything audible) */
function pcm24be(planar, len, ch) {
  const out = new Uint8Array(len * ch * 3); let o = 0;
  for (let k = 0; k < len; k++) for (let c = 0; c < ch; c++) { let v = Math.round(clamp(planar[c * len + k], -1, 1) * 8388607); if (v < 0) v += 16777216; out[o++] = v >>> 16; out[o++] = (v >>> 8) & 255; out[o++] = v & 255; }
  return out;
}
/* Fallback: record the canvas in real time (slower, but works in more browsers) */
async function exportRealtime(o, fps, dur, ctl) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video. Try the latest Chrome, Edge, or Safari.');
  const canvas = document.createElement('canvas'); canvas.width = o.W; canvas.height = o.H;
  const rend = new Renderer(canvas, PageSource, { cap: 10 }); rend.resize(o.W, o.H);
  let stream = canvas.captureStream(0);
  const vtrack = stream.getVideoTracks()[0], manual = !!(vtrack && typeof vtrack.requestFrame === 'function');
  if (!manual) { stream.getTracks().forEach(t => t.stop()); stream = canvas.captureStream(fps); }
  let src = null, gainNode = null, ac = null, exportAc = null; const vS = S.vStart;
  if (S.audio) {
    /* in Safari the playback context runs at the speakers' rate; the recording is made on a context of its own at the sound's rate, so the exported audio keeps it. Nothing is heard here, so its delay does not matter. If it will not start, the playback context is used */
    ac = ensureCtx();
    if (SAFARI && outBuf().sampleRate !== ac.sampleRate) { try { const own = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: outBuf().sampleRate }); await Promise.race([own.resume(), new Promise(r => setTimeout(r, 1500))]); if (own.state === 'running' && own.sampleRate === outBuf().sampleRate) { ac = own; exportAc = own; } else own.close(); } catch (e) {} }
    if (ac.state !== 'running') await ac.resume();
    const dest = ac.createMediaStreamDestination(); try { await fxGet(S.set.fx); } catch (e) {}
    src = ac.createBufferSource(); src.buffer = outBuf();
    gainNode = ac.createGain(); src.connect(gainNode); gainNode.connect(dest);
    dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  }
  const mimes = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
  dbg('real-time recording using ' + (mime || 'browser default format'));
  const bps = Math.round(clamp(o.W * o.H * fps * 0.14 * VQ[S.set.videoQuality || 'standard'], 5e6, 100e6));
  const rec = new MediaRecorder(stream, Object.assign({ videoBitsPerSecond: bps, audioBitsPerSecond: (S.set.audioKbps || 256) * 1000 }, mime ? { mimeType: mime } : {}));
  const parts = []; rec.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
  const stopped = new Promise(r => rec.onstop = r);
  await rend.ensure(pagesFor(frameState(vS)));
  rend.render(frameState(vS));
  rec.start(1000);
  const t0 = performance.now();
  if (src) { if (vS >= 0) src.start(0, vS); else src.start(ac.currentTime - vS); }      // before the audio starts: wait for it
  let lastReq = -1e9;
  try {
    for (;;) {
      const now = performance.now(), t = (now - t0) / 1000;
      EXP.stage = 'recording at ' + fmt(t, 0); EXP.stageT = now;
      if (ctl.cancelled || t >= dur) break;
      const st = frameState(vS + t); if (gainNode) gainNode.gain.value = soundFadeAt(vS + t) * audioGain(); await rend.ensure(pagesFor(st)); rend.render(st);
      if (manual && now - lastReq >= 900 / fps) { vtrack.requestFrame(); lastReq = now; }
      expUI('working', 'Processing', t / dur, 'This method records at normal speed, so it takes as long as your piece. Keep this tab open and in front.');
      await new Promise(r => requestAnimationFrame(r));
    }
  } finally {
    try { if (src) src.stop(); } catch (e) {}
    if (rec.state !== 'inactive') rec.stop();
    await stopped; if (exportAc) { try { exportAc.close(); } catch (e) {} } stream.getTracks().forEach(t => t.stop()); rend.destroy();
  }
  if (ctl.cancelled) return null;
  const type = (mime || 'video/webm').split(';')[0];
  return { blob: new Blob(parts, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}
function cancelExport() {
  if (EXP.ctl) EXP.ctl.cancelled = true;
  EXP.running = false; clearInterval(EXP.wd); setExpOpen(false); dbg('Export cancelled');
}
async function startExport(opts = {}) {
  if (!S.pdf) return;
  Transport.pause();
  if (creditsActive()) await Promise.all(creditsFontsInUse().map(f => resolveGoogleFont(f)));       // the credits fonts must be ready before frames are drawn
  const o = outputSize(), fps = S.set.fps, dur = Math.max(1, duration()), family = S.set.codec === 'hevc' ? 'hevc' : 'avc';
  const ctl = { cancelled: false }; EXP.ctl = ctl; EXP.blob = null; EXP.running = true; EXP.stage = 'starting'; EXP.stageT = performance.now();
  setExpOpen(true); foldSet('#expStallFold', false); $('#expMethod').textContent = '';
  expUI('working', 'Processing', 0, 'Keep this tab open and in front until the export finishes.');
  dbg('===== EXPORT START ====='); envInfo().forEach(dbg);
  dbg('Settings: ' + JSON.stringify(S.set) + ' · ' + fmt(dur) + ' long · ' + S.spreads.length + ' spreads');
  clearInterval(EXP.wd);
  EXP.wd = setInterval(() => {
    if (EXP.ctl !== ctl || !EXP.running) return;
    const idle = (performance.now() - EXP.stageT) / 1000;
    if (idle > EXP.stallAfter) {
      $('#expStall').textContent = 'No progress for ' + Math.round(idle) + ' s. Last step: ' + EXP.stage + '.';
      foldSet('#expStallFold', true);
      $('#expRetry').hidden = false; $('#expLogBtn').hidden = false;
      if (!ctl.stallLogged) { ctl.stallLogged = true; dbg('STALL: no progress for ' + Math.round(idle) + ' s. Last step: ' + EXP.stage); }
    } else if (expStallOn()) { foldSet('#expStallFold', false); ctl.stallLogged = false; }
  }, 1000);
  const finish = () => { if (EXP.ctl === ctl) { EXP.running = false; clearInterval(EXP.wd); } };
  try {
    let r = null;
    const caps = await detectCodecs(o, fps);
    if (ctl.cancelled) return;
    const method = opts.forceRealtime ? 'realtime' : (S.set.method || 'auto');
    if (!r && method !== 'realtime' && caps.webcodecs) {
      const tried = new Set();
      for (let attempt = 0; attempt < 4 && !r && !ctl.cancelled; attempt++) {
        expUI('working', 'Processing', 0.01);
        const pr = await pickProfile(o, fps, family, { skip: tried, fresh: attempt > 0, });
        if (ctl.cancelled || EXP.ctl !== ctl) return;
        if (!pr) { caps.reason = 'no ' + (family === 'hevc' ? 'HEVC' : 'H.264') + ' encoder setting worked on this device'; break; }
        tried.add(pr.id);
        $('#expMethod').textContent = QUALITY_NAME[S.set.videoQuality || 'standard'] + ' · ' + o.W + '×' + o.H;
        try {
          r = await exportWebCodecs(o, fps, dur, ctl, Object.assign({}, caps, { profile: pr }));
          if (!r) break;
        } catch (e) {
          const msg = (e && e.message) || '';
          if (/stopped responding|Timed out/.test(msg) && EXP.ctl === ctl && !ctl.cancelled) {
            dbg('Settings ' + pr.id + ' stalled during the export (' + msg + '). Trying other settings.');
            saveProfile(profSig(o, fps, family), null); EXP.stageT = performance.now(); continue;
          }
          throw e;
        }
      }
    }
    if (ctl.cancelled || EXP.ctl !== ctl) return;
    if (!r) {
      if (S.audio && S.audio.disk) throw new Error('A long recording needs the fast export, and it is not available on this device (' + (caps.reason || 'unknown reason') + ')');
      if (method === 'fast') throw new Error('Fast export is not available on this device (' + (caps.reason || 'unknown reason') + '). Choose Automatic or Real-time recording under Export method');
      $('#expMethod').textContent = method === 'realtime' ? 'Real-time recording: this takes as long as your piece.' : 'Fast export is not available (' + (caps.reason || 'unknown reason') + '), so the video is recorded in real time and takes as long as your piece.';
      dbg('Using real-time recording');
      r = await exportRealtime(o, fps, dur, ctl);
    }
    if (EXP.ctl !== ctl) return;
    if (!r || ctl.cancelled) { finish(); setExpOpen(false); return; }
    EXP.blob = r.blob; EXP.ext = r.ext;
    // the name lists the settings that shape the file; the usual ones (16:9, 30fps, H.264) are left out
    const resLabel = +S.set.res === 2160 ? '4K' : (+S.set.res + 'p'), lossless = r.ext === 'mov', tags = [resLabel + ' (' + QUALITY_NAME[S.set.videoQuality || 'standard'].toLowerCase() + ')'];
    if (S.set.aspect && S.set.aspect !== '16:9') tags.push(S.set.aspect);
    if ((+S.set.fps || 30) !== 30) tags.push(S.set.fps + 'fps');
    if (S.set.codec === 'hevc') tags.push('HEVC');
    if (lossless) tags.push('Lossless audio');          // a MOV holds the sound as it is (24-bit), so the name says so
    EXP.name = ((S.credits.title.trim() || S.pdf.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled') + ' - Video [' + tags.join(', ') + '].' + r.ext;
    const mb = (r.blob.size / 1048576).toFixed(r.blob.size > 1e7 ? 0 : 1);
    try {
      if (EXP.url) URL.revokeObjectURL(EXP.url);
      EXP.url = URL.createObjectURL(r.blob);
      if (r.ext !== 'mov') { const v = $('#expPreview'); v.muted = true; v.src = EXP.url; v.hidden = false; }
      const lk = $('#expLink'); lk.href = EXP.url; lk.download = EXP.name;
      foldSet('#expLinkFold', true);
    } catch (e) { console.warn(e); }
    finish(); dbg('EXPORT DONE: ' + EXP.name + ', ' + mb + ' MB');
    expUI('done', o.W + '×' + o.H + ' · ' + fps + ' fps · ' + fmt(dur, 0) + ' · ' + mb + ' MB' + (r.ext === 'mov' ? ' · Lossless audio' : ''), 1, r.ext === 'webm' ? 'Your browser saved this as WebM. YouTube accepts it; for Final Cut or other editors, use Chrome or Safari to get an MP4.' : '');
  } catch (e) {
    if (EXP.ctl !== ctl || ctl.cancelled) return;
    finish();
    dbg('EXPORT ERROR: ' + ((e && e.stack) || e));
    expUI('error', 'Something went wrong: ' + (e && e.message ? e.message : e) + '.', 0);
  }
}

/* ---------- Diagnostics panel + self-test ---------- */
function setDiagOpen(on) { $('#diagDlg').hidden = !on; if (on) refreshLog(); }
async function runSelfTest() {
  const btn = $('#diagTest'); btn.disabled = true;
  dbg('===== SELF-TEST START ====='); envInfo().forEach(dbg);
  const o = outputSize(), fps = S.set.fps;
  const step = async (name, fn, ms = 20000) => {
    const t0 = performance.now();
    try { const r = await withTimeout(fn(), ms, name); dbg('PASS  ' + name + ' (' + Math.round(performance.now() - t0) + ' ms)' + (r ? ' — ' + r : '')); return true; }
    catch (e) { dbg('FAIL  ' + name + ' — ' + ((e && e.message) || e)); return false; }
  };
  try {
    let cv = null, gl = null;
    await step('Create a ' + o.W + '×' + o.H + ' WebGL canvas', async () => {
      cv = document.createElement('canvas'); cv.width = o.W; cv.height = o.H;
      gl = cv.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
      if (!gl) throw new Error('could not create a WebGL context');
      drawTestPattern(gl, 0, o.W, o.H); return 'ok';
    });
    await step('Frame pacing (20 yields)', async () => { const t0 = performance.now(); for (let i = 0; i < 20; i++) await yieldNow(); return Math.round(performance.now() - t0) + ' ms total'; });
    if (typeof VideoFrame !== 'undefined' && gl) {
      for (const kind of ['direct', 'copy2d', 'bitmap', 'raw']) {
        await step('Make a video frame: ' + kind, async () => {
          const t0 = performance.now(), f = await new FrameMaker(cv, gl, kind, o.W, o.H).make(0, 33333);
          const r = f.displayWidth + '×' + f.displayHeight + ', ' + f.format; f.close(); return r + ', ' + Math.round(performance.now() - t0) + ' ms';
        });
      }
    }
    await step('Check audio encoder support', async () => { const caps = await detectCodecs(o, fps); return caps.webcodecs ? 'ok' : 'not available: ' + caps.reason; });
    if (typeof VideoEncoder !== 'undefined') {
      dbg('--- Encoder experiment: H.264 (every setting is tried) ---');
      const win = await pickProfile(o, fps, 'avc', { report: true });
      dbg(win ? 'BEST H.264 SETTINGS: ' + profDesc(win) + ' — remembered for future exports' : 'NO H.264 SETTINGS WORKED');
      dbg('--- Encoder experiment: HEVC (stops at the first that works) ---');
      const hw = await pickProfile(o, fps, 'hevc', { noSave: true });
      dbg(hw ? 'HEVC WORKS WITH: ' + profDesc(hw) : 'HEVC did not work in any setting');
      const sr = S.audio ? audSr() : 44100;
      const mx = new Mp4Writer({ width: o.W, height: o.H, fps, codec: 'avc', audio: { sampleRate: sr, channels: 2 } });
      await step('AAC encode 1 s of audio', async () => {
        if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') throw new Error('AudioEncoder is not available');
        const cfg = await aacConfig(sr, 2, 192000); if (!cfg) throw new Error('AAC encoding is not supported');
        let err = null, n = 0; const enc = new AudioEncoder({ output: (c, m) => { n++; mx.addAudio(c, m); }, error: e => { err = e; } });
        enc.configure(cfg);
        for (let pos = 0; pos < sr; pos += 4096) {
          const len = Math.min(4096, sr - pos), data = new Float32Array(len * 2);
          for (let k = 0; k < len; k++) { const v = 0.2 * Math.sin(2 * Math.PI * 440 * (pos + k) / sr); data[k] = v; data[len + k] = v; }
          const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round(pos * 1e6 / sr), data });
          enc.encode(ad); ad.close(); if (err) throw err;
        }
        await withTimeout(enc.flush(), 15000, 'flushing the audio encoder'); enc.close();
        if (err) throw err; if (!n) throw new Error('the encoder returned no data');
        return n + ' chunks';
      }, 30000);
      if (win) {
        await step('Build an MP4 with the winning settings and let the browser open it', async () => {
          const r = await probeProfile(win, o, fps, { onChunk: (c, m) => mx.addVideo(c, m) });
          if (!r.ok) throw new Error('second test run failed: ' + r.reason);
          const blob = mx.finalize(), url = URL.createObjectURL(blob), v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
          try {
            const info = await new Promise((res, rej) => {
              v.onloadedmetadata = () => res(v.videoWidth + '×' + v.videoHeight + ', ' + v.duration.toFixed(2) + ' s');
              v.onerror = () => rej(new Error('the browser could not open the MP4 it just made (' + ((v.error && v.error.message) || 'unknown') + ')'));
            });
            return Math.round(blob.size / 1024) + ' KB, ' + info;
          } finally { URL.revokeObjectURL(url); }
        }, 30000);
      }
    }
  } finally { dbg('===== SELF-TEST END ====='); btn.disabled = false; }
}

/* The frame under the playhead as a YouTube thumbnail: 1280x720, JPG, kept under their 2 MB limit */
async function saveThumbnail() {
  if (!S.pdf) return;
  const btn = $('#btnThumb'); btn.disabled = true;
  try {
    const W = 1280, H = 720, st = frameState(S.time); st.fade = 1;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const rend = new Renderer(canvas, PageSource, { cap: 6 }); rend.resize(W, H);
    await rend.ensure(pagesFor(st));
    rend.render(st); if (pagesFor(st).length === 0 || st.spread >= 0) { await sleep(60); rend.render(st); }          // a second pass lets any late credits font settle
    const flat = document.createElement('canvas'); flat.width = W; flat.height = H; const fx = flat.getContext('2d');
    fx.fillStyle = S.set.bg; fx.fillRect(0, 0, W, H); fx.drawImage(canvas, 0, 0);
    rend.destroy();
    let q = 0.93, blob = null;
    for (let i = 0; i < 8; i++) { blob = await new Promise(r => flat.toBlob(r, 'image/jpeg', q)); if (!blob || blob.size <= 1.9 * 1024 * 1024) break; q -= 0.08; }
    if (!blob || blob.size > 1.9 * 1024 * 1024) throw new Error('could not make the image under 2 MB');
    const name = ((S.credits.title.trim() || S.pdf.name || 'Score').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Score') + ' - Thumbnail.jpg';
    await saveFile(blob, name); toast(tx('vid.thumb', { mb: (blob.size / 1048576).toFixed(1) }));
  } catch (e) { console.error(e); toast(tx('vid.thumbfail'), 5000); }
  finally { updateButtons(); }
}
async function saveFile(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  return { status: 'saved' };
}

