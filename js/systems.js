'use strict';
/* ====================================================================
   Systems: finding each system (all its staves read together) on a page
   ==================================================================== */
const SYS_W = 1600;          // the width a page is drawn at for this: staff lines on a dense score are only a few dots apart

/* The whole measurement, with no outside names, so the same text can run in a worker.
   ink: 1 where the page is dark (w by h); deg: the page's tilt, taken out for the measuring only (the page itself is never changed);
   reg: [x0, y0, x1, y1], the music's box in dots. Returns the systems top to bottom as fractions of the page.
   1. Staff lines are the long horizontal runs of ink, grouped by row into lines.
   2. Five lines evenly spaced are a staff (one line missing in a dropout is filled in).
   3. Staves joined by an unbroken vertical stroke (a bar line) belong to one system.
   4. A system reaches up and down to the music attached to it, and stops at the blank space between it and its neighbor.
   5. Its left and right edges are the first and last stretch of real ink (a dot alone is dust), so specks never move them. */
function sysDetectCore(ink, w, h, deg, reg) {
  const X0 = Math.max(0, Math.floor(reg[0])), Y0 = Math.max(0, Math.floor(reg[1])), X1 = Math.min(w, Math.ceil(reg[2])), Y1 = Math.min(h, Math.ceil(reg[3])), W = X1 - X0;
  const none = { systems: [], staves: 0, d: 0 };
  if (W < 40 || Y1 - Y0 < 40) return none;
  let px = ink;
  if (Math.abs(deg) > 0.05) {                         // turn the picture level; each new dot looks up the old dot it came from
    const out = new Uint8Array(w * h), a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = w / 2, cy = h / 2;
    for (let Y = Y0; Y < Y1; Y++) {
      const yy = Y - cy;
      for (let X = X0; X < X1; X++) {
        const xx = X - cx, sx = Math.round(xx * c - yy * s + cx), sy = Math.round(xx * s + yy * c + cy);
        if (sx >= 0 && sx < w && sy >= 0 && sy < h && ink[sy * w + sx]) out[Y * w + X] = 1;
      }
    }
    px = out;
  }
  // how much ink sits on each row
  const rc = new Int32Array(h);
  for (let y = Y0; y < Y1; y++) { let n = 0; for (let x = X0, i = y * w + X0; x < X1; x++, i++) n += px[i]; rc[y] = n; }
  // 1. the long runs on each row (two dots of break are bridged), which are the staff lines
  const L = Math.max(24, Math.round(W * 0.08)), lr = new Int32Array(h), rx0 = new Int32Array(h).fill(w), rx1 = new Int32Array(h);
  for (let y = Y0; y < Y1; y++) {
    const o = y * w; let s = -1, e = -1, tot = 0, a0 = w, a1 = 0;
    for (let x = X0; x <= X1; x++) {
      if (x < X1 && px[o + x]) { if (s < 0) s = x; e = x; }
      else if (s >= 0 && (x === X1 || x - e > 2)) { if (e - s + 1 >= L) { tot += e - s + 1; if (s < a0) a0 = s; if (e + 1 > a1) a1 = e + 1; } s = -1; }
    }
    lr[y] = tot; rx0[y] = a0; rx1[y] = a1;
  }
  const P = [];
  for (let y = Y0; y < Y1; y++) {
    if (lr[y] < L) continue;
    let e = y, wy = 0, sw = 0, a0 = w, a1 = 0;
    while (e < Y1 && (lr[e] >= L || (e + 1 < Y1 && lr[e + 1] >= L))) {
      if (lr[e] >= L) { wy += e * lr[e]; sw += lr[e]; if (rx0[e] < a0) a0 = rx0[e]; if (rx1[e] > a1) a1 = rx1[e]; }
      e++;
    }
    P.push({ y: wy / sw, t: e - y, x0: a0, x1: a1 }); y = e;
  }
  // 2. five evenly spaced lines make a staff
  const ov = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0.6 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
  const staves = [];
  for (let i = 0; i < P.length;) {
    let st = null;
    if (i + 4 < P.length) {
      const sp = [1, 2, 3, 4].map(k => P[i + k].y - P[i + k - 1].y), m = (P[i + 4].y - P[i].y) / 4;
      if (m >= 3 && m <= h * 0.03 && sp.every(v => Math.abs(v - m) <= 0.3 * m) && [1, 2, 3, 4].every(k => ov(P[i], P[i + k]))) st = { n: 5, top: P[i].y, bot: P[i + 4].y, d: m, x0: Math.min(...[0, 1, 2, 3, 4].map(k => P[i + k].x0)), x1: Math.max(...[0, 1, 2, 3, 4].map(k => P[i + k].x1)) };
    }
    if (!st && i + 3 < P.length) {                    // one line lost in a dropout: two even gaps and one double gap
      const sp = [1, 2, 3].map(k => P[i + k].y - P[i + k - 1].y), q = sp.slice().sort((a, b) => a - b), m = (q[0] + q[1]) / 2;
      if (m >= 3 && m <= h * 0.03 && Math.abs(q[0] - q[1]) <= 0.3 * m && Math.abs(q[2] - 2 * m) <= 0.35 * 2 * m && [1, 2, 3].every(k => ov(P[i], P[i + k])))
        st = { n: 4, top: P[i].y, bot: P[i + 3].y, d: (P[i + 3].y - P[i].y) / 4, x0: Math.min(...[0, 1, 2, 3].map(k => P[i + k].x0)), x1: Math.max(...[0, 1, 2, 3].map(k => P[i + k].x1)) };
    }
    if (st) { staves.push(st); i += st.n === 5 ? 5 : 4; } else i++;
  }
  if (!staves.length) return none;
  // 3. staves joined by a bar line are one system
  const joined = (a, b) => {
    const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1), ya = Math.round(a.bot) + 1, yb = Math.round(b.top) - 1, n = yb - ya + 1;
    if (n < 2 || x1 - x0 < 20 || n > 14 * Math.max(a.d, b.d)) return false;
    for (let x = x0; x < x1; x++) { let c = 0; for (let y = ya; y <= yb; y++) { const i = y * w + x; if (px[i] || px[i - 1] || px[i + 1]) c++; } if (c >= n * 0.93) return true; }
    return false;
  };
  const groups = [[staves[0]]];
  for (let k = 1; k < staves.length; k++) { if (joined(staves[k - 1], staves[k])) groups[groups.length - 1].push(staves[k]); else groups.push([staves[k]]); }
  // a printed staff with nothing written on it is not a system: look at the ink between the lines (rows beside a line are left out; a dot alone is dust)
  const lineRow = new Uint8Array(h + 2); for (let y = Y0; y < Y1; y++) if (lr[y] >= L) lineRow[y] = lineRow[y + 1] = lineRow[y + 2] = 1;
  const written = g => {
    let n = 0;
    for (const q of g) for (let y = Math.round(q.top) + 1; y < Math.round(q.bot); y++) { if (lineRow[y + 1]) continue; for (let x = Math.round(q.x0); x < q.x1; x++) { const i = y * w + x; if (px[i] && (px[i - 1] || px[i + 1] || px[i - w] || px[i + w])) n++; } }
    return n >= 4 * g.reduce((t, q) => t + q.d, 0);
  };
  for (let k = groups.length - 1; k >= 0; k--) if (!written(groups[k])) groups.splice(k, 1);
  if (!groups.length) return Object.assign({}, none, { staves: staves.length });
  // 4. how far each system reaches
  const blank = Math.max(2, W * 0.006);
  const valley = (a, b, d) => {                       // the middle of the emptiest stretch between two systems
    const lo = Math.ceil(a + d), hi = Math.floor(b - d);
    if (hi <= lo) return Math.round((a + b) / 2);
    let best = -1, bs = 0, s = -1;
    for (let y = lo; y <= hi + 1; y++) {
      if (y <= hi && rc[y] <= blank) { if (s < 0) s = y; }
      else if (s >= 0) { if (y - s > bs) { bs = y - s; best = Math.round((s + y - 1) / 2); } s = -1; }
    }
    if (best >= 0) return best;
    let m = lo; for (let y = lo; y <= hi; y++) if (rc[y] < rc[m]) m = y; return m;
  };
  const sys = groups.map(g => ({ top: g[0].top, bot: g[g.length - 1].bot, d: g.reduce((t, q) => t + q.d, 0) / g.length }));
  const out = [];
  sys.forEach((s, k) => {
    const d = s.d, reach = Math.round(6 * d), need = Math.max(3, Math.round(2.2 * d)), pad = Math.round(0.4 * d);
    const limUp = Math.max(k ? valley(sys[k - 1].bot, s.top, d) : Y0, Math.round(s.top - reach)), limDn = Math.min(k < sys.length - 1 ? valley(s.bot, sys[k + 1].top, d) : Y1 - 1, Math.round(s.bot + reach));
    let up = Math.round(s.top), run = 0;
    for (let y = Math.round(s.top) - 1; y >= limUp; y--) { if (rc[y] > blank) { up = y; run = 0; } else if (++run >= need) break; }
    let dn = Math.round(s.bot); run = 0;
    for (let y = Math.round(s.bot) + 1; y <= limDn; y++) { if (rc[y] > blank) { dn = y; run = 0; } else if (++run >= need) break; }
    const top = Math.max(limUp, up - pad), bot = Math.min(limDn, dn + pad);
    // 5. the first and last real stretch of ink inside that band
    let left = -1, right = -1, r = 0;
    for (let x = X0; x < X1; x++) {
      let c = 0; for (let y = top; y <= bot; y++) { const i = y * w + x; if (px[i] && (px[i - 1] || px[i + 1] || px[i - w] || px[i + w])) c++; }          // a dot with no neighbor is dust
      if (c >= 3) { r++; if (r >= 5) { if (left < 0) left = x - 4; right = x; } } else r = 0;
    }
    if (left < 0) { const g = groups[k]; left = Math.round(Math.min(...g.map(q => q.x0))); right = Math.round(Math.max(...g.map(q => q.x1))) - 1; }
    out.push({ top: top / h, bottom: (bot + 1) / h, left: left / w, right: (right + 1) / w });
  });
  return { systems: out, staves: staves.length, d: sys.reduce((t, q) => t + q.d, 0) / sys.length };
}

/* ---------- running it: a worker, one page at a time, and the pages found so far ---------- */
const SYS = {
  byPage: new Map(), gen: null, token: 0, job: null, w: null, n: 0, pend: new Map(),
  worker() {
    if (this.w) return this.w;
    const url = URL.createObjectURL(new Blob(['const core=' + sysDetectCore.toString() + ';onmessage=e=>{const m=e.data;postMessage({id:m.id,r:core(m.ink,m.w,m.h,m.deg,m.reg)});};'], { type: 'text/javascript' }));
    const w = this.w = new Worker(url); URL.revokeObjectURL(url);
    w.onmessage = e => { const f = this.pend.get(e.data.id); if (f) { this.pend.delete(e.data.id); f(e.data.r); } };
    w.onerror = () => { this.pend.forEach(f => f(null)); this.pend.clear(); this.w = null; };
    return w;
  },
  run(m) {                                              // the answer, or null when it was stopped or the worker failed
    let w; try { w = this.worker(); } catch (e) { return Promise.resolve(sysDetectCore(m.ink, m.w, m.h, m.deg, m.reg)); }
    return new Promise(res => { const id = ++this.n; this.pend.set(id, res); w.postMessage({ id, ink: m.ink, w: m.w, h: m.h, deg: m.deg, reg: m.reg }, [m.ink.buffer]); });
  },
  stop() {                                              // leaving the layout: the worker ends at once, and the pages already found stay
    this.token++; if (this.w) { this.w.terminate(); this.w = null; }
    this.pend.forEach(f => f(null)); this.pend.clear(); this.job = null;
  }
};
/* the pages were rebuilt (an edit, a new score): what was found no longer lines up */
function sysFresh() { const g = S.pdf ? S.pdf.gen || 0 : -1; if (SYS.gen !== g) { SYS.byPage.clear(); SYS.gen = g; } }
/* one page: its systems as fractions of the page ({ systems, tilt, staves }), found once and kept */
async function sysDetectPage(idx) {
  sysFresh();
  const hit = SYS.byPage.get(idx); if (hit) return hit;
  const tok = SYS.token, sc = await peScan(idx, SYS_W, null, 0.85, false);
  if (tok !== SYS.token) return null;
  const reg = peInkBox(sc, 0), t = reg ? peTilt(sc) : { deg: 0, gain: 0 }, tilt = t.gain > 0.03 ? t.deg : 0;
  let r = { systems: [], tilt, staves: 0 };
  if (reg) {
    const regPx = [reg[0] * sc.w, reg[1] * sc.h, reg[2] * sc.w, reg[3] * sc.h], m = await SYS.run({ ink: sc.ink, w: sc.w, h: sc.h, deg: tilt, reg: regPx, token: tok });
    if (!m || tok !== SYS.token) return null;
    r = { systems: m.systems, tilt, staves: m.staves };
  }
  SYS.byPage.set(idx, r); return r;
}
/* every active page, the one named in `first` before the rest; onProgress(done, total) after each page. Resolves with whether it finished. */
function sysDetectAll(opt = {}) {
  sysFresh();
  if (SYS.job) return SYS.job;
  const keep = S.pdf ? S.pdf.keep.slice() : [], pages = [...new Set(keep)], order = opt.first != null && pages.includes(opt.first) ? [opt.first, ...pages.filter(k => k !== opt.first)] : pages, tok = SYS.token;
  const job = SYS.job = (async () => {
    let done = order.filter(i => SYS.byPage.has(i)).length; if (opt.onProgress) opt.onProgress(done, order.length);
    for (const i of order) {
      if (tok !== SYS.token) return false;
      if (SYS.byPage.has(i)) continue;
      const r = await sysDetectPage(i); if (!r || tok !== SYS.token) return false;
      done++; if (opt.onProgress) opt.onProgress(done, order.length, i);
    }
    return true;
  })();
  job.then(() => { if (SYS.job === job) SYS.job = null; });
  return job;
}
