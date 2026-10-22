'use strict';
const EASE_GLIDE = 'cubic-bezier(.3,.8,.2,1)', EASE_OUT = 'cubic-bezier(.22,1,.36,1)', AE_TOOL_MS = 260, AE_LIFT = 10;          // the site's two JS curves (EASE_OUT is the CSS --ease-out) and the length of an Audio Editor tool switch
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
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
function fmt(t, dec = 1) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(dec);
}

