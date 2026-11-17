'use strict';
const cssNum = (name, fallback) => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return v > 0 ? v : fallback; };
const EASE_GLIDE = 'cubic-bezier(.3,.8,.2,1)', EASE_OUT = 'cubic-bezier(.22,1,.36,1)', AE_TOOL_MS = cssNum('--ae-ms', 260), AE_MOVE_MS = cssNum('--ae-move', 400), AE_LIFT = cssNum('--ae-lift', 10), AE_NOTE_MS = cssNum('--ae-note-ms', 3000), TOAST_MS = cssNum('--toast-ms', 4200), TOAST_LONG_MS = cssNum('--toast-long-ms', 6000);          // the site's two JS curves (EASE_OUT is the CSS --ease-out) and the length and lift of an Audio Editor switch (the CSS --ae-ms and --ae-lift, defined once in style.css)
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* the one definition of a double-click or double-tap: two presses within this time and distance (a finger lands less exactly than a mouse) */
const DBL_MS = 450, DBL_PX = 6, DBL_TOUCH_PX = 30;
const dblNear = (dt, dx, dy, type) => dt < DBL_MS && Math.hypot(dx, dy) < (type === 'touch' ? DBL_TOUCH_PX : DBL_PX);
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* gives the page a turn without a timer: timers are slowed to one a second in a hidden tab or frame, and a long job that waits on them crawls */
const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });
const TIMEOUTS = { ensure: 30000, queue: 20000, flush: 180000, yield: 40, probe: 7000 };
let _yc = null; const _yq = [];
/* Lets the page breathe between frames. Raced against a timer so a lost message can never freeze an export. */
function yieldNow() {
  const viaChannel = new Promise(r => {
    if (!_yc) { _yc = new MessageChannel(); _yc.port1.onmessage = () => { const f = _yq.shift(); if (f) f(); }; }
    _yq.push(r); _yc.port2.postMessage(0);
  });
  return Promise.race([viaChannel, sleep(TIMEOUTS.yield)]);
}
function withTimeout(p, ms, label) {
  let id;
  return Promise.race([Promise.resolve(p), new Promise((_, rej) => { id = setTimeout(() => rej(new Error('Timed out after ' + Math.round(ms / 1000) + ' s while: ' + label)), ms); })]).finally(() => clearTimeout(id));
}
const LOG = { lines: [], t0: performance.now() };
function dbg(msg) {
  const line = '[' + ((performance.now() - LOG.t0) / 1000).toFixed(2) + 's] ' + msg;
  LOG.lines.push(line); if (LOG.lines.length > 2000) LOG.lines.shift();
  try { console.log(line); const d = document.getElementById('diagDlg'); if (d && !d.hidden) refreshLog(); } catch (e) {}
}
function refreshLog() { const t = document.getElementById('diagLog'); t.value = LOG.lines.join('\n'); t.scrollTop = t.scrollHeight; }
window.addEventListener('error', e => dbg('PAGE ERROR: ' + (e.message || e) + (e.filename ? ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')' : '')));
window.addEventListener('unhandledrejection', e => dbg('UNHANDLED PROMISE ERROR: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
/* the ruler's time labels, shared by the video timeline and the Audio Editor so they match: the type is the page's axis size, and the baseline puts the digits in the middle of the ruler band (its height less the 1px floor line) */
let rulerFontCache = '';
const rulerFont = () => rulerFontCache || (rulerFontCache = (getComputedStyle(document.documentElement).getPropertyValue('--type-axis').trim() || '10.5px') + ' "Hanken Grotesk",system-ui,sans-serif');
const rulerLabelY = (c, h) => (h - 1) / 2 + c.measureText('0').actualBoundingBoxAscent / 2;
function fmt(t, dec = 1) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(dec);
}

/* A slider whose default is the middle of its range (Balance, Width, a gain) catches there while it is dragged, the way Apple's sliders hold at a marked value: within 2% of the range of the
   middle it rests on the middle, and dragging further moves on. Only a drag catches; the arrow keys step through it. One rule for every slider, read from the slider's own default. */
const SLIDER_CATCH = 0.02;
let _slDrag = null;
document.addEventListener('pointerdown', e => { const r = e.target; _slDrag = r instanceof HTMLInputElement && r.type === 'range' ? r : null; }, true);
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { _slDrag = null; }, true);
/* Space plays and pauses everywhere, and the arrows move the playhead, except on a control the person is using: a button, switch, or choice they reached with the keyboard keeps its own Space (a button clicked with the mouse was not reached that way, so Space still plays after it), and a slider or choice keeps the arrows. */
document.addEventListener('focusin', e => { try { e.target._kbd = e.target.matches(':focus-visible'); } catch (x) {} }, true);          // how a control got its focus, read when it did (a key press itself makes the ring show, so it cannot be asked later)
document.addEventListener('pointerdown', e => { if (e.target) e.target._kbd = false; }, true);
function ownsKey(e) {
  const t = e.target; if (!t || !t.matches) return false;
  if ((e.code === 'Space' || e.key === 'Enter') && t.matches('.csel-list li,[role=option],.combo-list li,.sp-item')) return true;          // a list's own item takes Space and Enter to choose it
  if (e.code === 'Space') return t.matches('button,a[href],input[type=checkbox],input[type=radio],[role=button],[role=switch]') && t._kbd === true;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return t.matches('input[type=range],input[type=radio]');
  return false;
}
function sliderDefault(r) {
  if (r.dataset.default != null && r.dataset.default !== '') return +r.dataset.default;
  return typeof DEFAULTS !== 'undefined' && typeof DEFAULTS[r.id] === 'number' ? DEFAULTS[r.id] : null;
}
document.addEventListener('input', e => {
  const r = e.target; if (r !== _slDrag) return;
  const lo = r.min === '' ? 0 : +r.min, hi = r.max === '' ? 100 : +r.max, d = sliderDefault(r);
  if (d == null) return;
  const hold = r.dataset.catch ? +r.dataset.catch : Math.abs(d - (lo + hi) / 2) <= 1e-9 ? (hi - lo) * SLIDER_CATCH : 0;          // a slider can ask for a hold at its default even when that is not the middle (the Fades length: data-catch, in the slider's own units)
  if (hold > 0 && +r.value !== d && Math.abs(+r.value - d) <= hold) r.value = d;
}, true);
