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

/* A system on the timeline is a page number plus a multiple of SYS_STRIDE, so system 0 is the page itself and every other part of the app keeps reading a page number. */
const SYS_STRIDE = 100000;
const sysKey = (page, k) => page + k * SYS_STRIDE;
const sysPage = key => key >= 0 ? key % SYS_STRIDE : key;
const sysNo = key => key >= 0 ? Math.floor(key / SYS_STRIDE) : 0;
/* the entries one page gives in System: one per system found, or the whole page when none was (or it is not found yet) */
function sysEntries(page) { const r = SYS.byPage.get(page), n = r && r.systems.length ? r.systems.length : 1; return Array.from({ length: n }, (_, k) => sysKey(page, k)); }
/* the pages not yet measured are found in the background; the timeline follows when they are all in */
function sysKick() {
  if (!S.pdf) return; sysFresh();
  const pages = [...new Set(S.pdf.keep)], left = pages.filter(i => !SYS.byPage.has(i)).length;
  if (!left) { if (SYS.prog) sysProg(null); sysWarn(); return; }
  sysWipeStart();
  if (SYS.prog && SYS.job) return;
  sysProg({ done: pages.length - left, total: pages.length });
  const head = selCurrent();          // the page under the playhead is found first
  sysDetectAll({ first: head == null ? null : sysPage(head), onProgress: (done, total) => sysProg({ done, total }) }).then(done => { if (done) { sysProg(null); sysSettle(); sysWarn(); } });
}
/* the run, said in the System group and on the timeline and Export video */
function sysProg(p) { SYS.prog = p; sysUI(); }
const sysBusy = () => sysOn() && !!SYS.prog;
function sysUI() {
  if (typeof syncExport === 'function') syncExport();
  if (typeof sysStatusUI === 'function') sysStatusUI();
  stageDirty = true; TL.staticDirty = true; TL.overlayDirty = true;
}
const SYS_TILT = 0.3;          // degrees of tilt that earn a reason line
/* the pages that are tilted past the limit and not yet leveled, and how many are two-page scans */
async function sysWarn() {
  if (!sysOn() || !S.pdf) { SYS.warn = null; sysUI(); return; }
  const gen = SYS.gen, pages = [...new Set(S.pdf.keep)];
  const tilt = pages.filter(i => { const r = SYS.byPage.get(i); return r && Math.abs(r.tilt) > SYS_TILT && !SYS.leveled.has(i) && !peTilted(S.pdf.slots[i]); });
  let wide = 0; for (const i of pages) { const sl = S.pdf.slots[i]; try { await peAspectOf(sl); } catch (e) {} if (peSpread(sl)) wide++; }
  if (gen !== SYS.gen || !sysOn()) return;
  SYS.warn = { tilt, wide }; sysUI();
}
/* Level these pages: Re-kilter on only the tilted pages, one History step. The pages are found again on the new tilt. */
async function sysLevelPages() {
  const ids = SYS.warn ? SYS.warn.tilt.slice() : []; if (!ids.length || SYS.leveling || !S.pdf) return;
  SYS.leveling = true; sysUI(); const gen = SYS.gen;
  try {
    const res = new Map(); for (const id of ids) { res.set(id, await peLevelOne(S.pdf.slots[id])); await yieldNow(); if (gen !== SYS.gen || !sysOn()) return; }
    const r = recipeOf(); let changed = false;
    ids.forEach(id => { const [sk, vs, wk, crop] = res.get(id), sl = r.slots[id]; if (sk !== (sl.skew || 0) || vs !== (sl.vskew || 0) || wk !== (sl.warp || 0)) changed = true; sl.skew = sk; sl.vskew = vs; sl.warp = wk; if (crop) sl.crop = crop; });
    ids.forEach(id => SYS.leveled.add(id));
    if (!changed) { toast(tx('pe.skew.none')); return; }
    const was = Transport.playing, at = Transport.now(); Transport.pause();
    pushHistory(); const base = S.history.length;
    setRecipe(r); ids.forEach(id => { SYS.byPage.delete(id); SYS.scan.delete(id); SYS.hand.delete(id); }); SYS.rev++;
    rebuildSpreads(false); if (S.history.length > base) S.history.length = base;
    S.time = was ? clamp(at, S.vStart, vEnd()) : S.time; setChips(); updateTimeUI(true); if (was) Transport.play();
  } finally { SYS.leveling = false; sysWarn(); }
}
/* Stop: the work ends and the layout goes back to the one before */
function sysStopRun() { SYS.stop(); setPageLayout(SYS.prev && SYS.prev !== 'system' ? SYS.prev : 'spread'); }
function sysSettle() {
  if (!sysOn() || !S.pdf) return;
  const none = S.pdf.keep.filter(i => { const r = SYS.byPage.get(i); return r && !r.systems.length; }).join(), before = spreadSig() + '#' + SYS.none;          // a page found to have no systems is a short block, so the turns are spaced again
  S.spreads = buildSpreads(); SYS.none = none;
  if (spreadSig() + '#' + none === before) return;
  if (S.turnsEdited) reconcileTurns(); else autoSpace(false);
  afterStructureChange(); onTurnsChanged();
}

/* ---------- running it: a worker, one page at a time, and the pages found so far ---------- */
const SYS = {
  byPage: new Map(), none: '', scan: new Map(), prog: null, warn: null, leveled: new Set(), leveling: false, prev: 'spread', hand: new Set(), rev: 0, gen: null, token: 0, job: null, w: null, n: 0, pend: new Map(),
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
    WIPE.on = false; this.token++; if (this.w) { this.w.terminate(); this.w = null; }
    this.pend.forEach(f => f(null)); this.pend.clear(); this.job = null; if (this.prog) sysProg(null);
  }
};
/* what a page's systems depend on: the edits that change its picture (Crop, Re-kilter, tilt correction, turning) */
const sysGeo = sl => [sl.src, sl.rot || 0, sl.crop ? sl.crop.join(',') : '', sl.skew || 0, sl.vskew || 0, sl.warp || 0, sl.half || ''].join('|');
/* A page edited since its systems were found is found again and loses its hand marks; the toast names it. Untouched pages keep theirs. */
function sysSync() {
  if (!S.pdf) return; const named = []; let gone = false;
  [...SYS.byPage.keys()].forEach(i => {
    const r = SYS.byPage.get(i), sl = S.pdf.slots[i]; if (r.geo === undefined) r.geo = sl ? sysGeo(sl) : '';
    if (sl && r.geo === sysGeo(sl)) return;
    if (SYS.hand.has(i) && S.pdf.keep.includes(i)) named.push(pageNo(i));
    SYS.byPage.delete(i); SYS.scan.delete(i); SYS.hand.delete(i); gone = true;
  });
  if (!gone) return;
  SYS.rev++; stageDirty = true; if (sysOn() && S.pdf.keep.length) sysKick();
  if (named.length && !HB.quiet) { SYS.noted = true; toast(tx('sys.redone', { page: named.sort((a, b) => a - b).join(', ') })); }          // noted: the caller's own toast would only replace this one
}
/* The hand-marked pages for the settings file: [{p: page in the saved list, t: tilt, s: [[top, bottom, left, right]]}] */
const sysToList = () => [...SYS.hand].filter(i => SYS.byPage.has(i) && S.pdf.slots[i]).sort((a, b) => a - b).map(i => {
  const r = SYS.byPage.get(i), q = v => Math.round(v * 10000) / 10000;
  return { p: i + 1, t: q(r.tilt || 0), s: r.systems.map(b => { const e = [q(b.top), q(b.bottom), q(b.left), q(b.right)]; return e; }) };
});
/* only values this site understands; null when nothing usable */
function sysListClean(list, n) {
  if (!Array.isArray(list) || list.length > 500) return null; const out = [], f = v => Number.isFinite(v) && v >= 0 && v <= 1;
  for (const e of list) {
    if (!e || !Number.isInteger(e.p) || e.p < 1 || e.p > n || !Array.isArray(e.s) || e.s.length > 100) continue;
    const t = Number.isFinite(e.t) ? clamp(e.t, -15, 15) : 0, s = [];
    for (const b of e.s) { if (!Array.isArray(b) || b.length < 4 || b.length > 6 || !b.slice(0, 4).every(f) || b[1] - b[0] < 0.01 || b[3] - b[2] <= 0) continue; const o = { top: b[0], bottom: b[1], left: b[2], right: b[3] }; s.push(o); }
    out.push({ p: e.p, t, s });
  }
  return out.length ? out : null;
}
/* put saved marks on the pages, which must already be in the saved order */
function sysFromList(list) {
  sysFresh(); SYS.byPage.clear(); SYS.scan.clear(); SYS.hand.clear();
  (list || []).forEach(e => { const i = e.p - 1, sl = S.pdf.slots[i]; if (!sl) return; SYS.byPage.set(i, { systems: e.s.slice().sort((a, b) => a.top - b.top), tilt: e.t, staves: 0, geo: sysGeo(sl), auto: [] }); SYS.hand.add(i); });
  SYS.rev++; stageDirty = true; if (sysOn()) sysKick();
}
/* the pages were rebuilt (an edit, a new score): what was found no longer lines up */
function sysFresh() { const g = S.pdf ? S.pdf.gen || 0 : -1; if (SYS.gen !== g) { SYS.stop(); SYS.byPage.clear(); SYS.scan.clear(); SYS.hand.clear(); SYS.leveled.clear(); SYS.warn = null; SYS.rev++; SYS.gen = g; } sysSync(); }
/* one page: its systems as fractions of the page ({ systems, tilt, staves }), found once and kept */
async function sysDetectPage(idx) {
  sysFresh();
  const hit = SYS.byPage.get(idx); if (hit) return hit;
  const tok = SYS.token, geo = sysGeo(S.pdf.slots[idx]), sc = await peScan(S.pdf.slots[idx].src, SYS_W, null, 0.85, false);
  if (tok !== SYS.token) return null;
  const reg = peInkBox(sc, 0), t = reg ? peTilt(sc) : { deg: 0, gain: 0 }, tilt = t.gain > 0.03 ? t.deg : 0;
  let r = { systems: [], tilt, staves: 0, geo };
  if (reg) {
    const regPx = [reg[0] * sc.w, reg[1] * sc.h, reg[2] * sc.w, reg[3] * sc.h], m = await SYS.run({ ink: sc.ink, w: sc.w, h: sc.h, deg: tilt, reg: regPx, token: tok });
    if (!m || tok !== SYS.token) return null;
    r = { systems: m.systems, tilt, staves: m.staves, geo };
  }
  if (SYS.byPage.has(idx)) return SYS.byPage.get(idx);          // marked or restored while it was being found: that stays
  SYS.byPage.set(idx, r); stageDirty = true; return r;
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

/* ---------- marking by hand: the page's systems as the person set them, kept with the page like a Dim region ---------- */
/* the hand-marked pages (page -> systems), as one part of a History step */
const sysSnap = () => { const o = {}; SYS.hand.forEach(i => { const r = SYS.byPage.get(i); if (r) o[i] = { systems: r.systems.map(q => Object.assign({}, q)), tilt: r.tilt || 0, geo: r.geo }; }); return o; };
/* Goes back to a snapshot's marks; true when anything changed. A page that is not marked there returns to what was found (or is found again). */
function sysRestore(m) {
  sysFresh(); if (JSON.stringify(m) === JSON.stringify(sysSnap())) return false;
  [...SYS.hand].forEach(i => {
    if (m[i]) return; SYS.hand.delete(i); const r = SYS.byPage.get(i);
    if (r && r.auto) { r.systems = r.auto; delete r.auto; } else SYS.byPage.delete(i);
  });
  Object.keys(m).forEach(k => {
    const fresh = !SYS.byPage.has(+k), r = sysHandRec(+k); if (fresh) delete r.auto;          // a page that was cleared has no found result to go back to; it is found again
    r.systems = m[k].systems.map(q => Object.assign({}, q)); r.tilt = m[k].tilt; r.geo = m[k].geo;
  });
  SYS.rev++; stageDirty = true; return true;
}
/* the first and last real stretch of ink inside a band (fractions of the page): the same rule as the finder, so a mark sits on its ink the same way */
async function sysEdges(idx, top, bottom) {
  const { w, h, ink: px } = await sysLevel(idx);
  const y0 = Math.max(1, Math.round(top * h)), y1 = Math.min(h - 2, Math.round(bottom * h)); let left = -1, right = -1, r = 0;
  for (let x = 1; x < w - 1; x++) {
    let c = 0; for (let y = y0; y <= y1; y++) { const i = y * w + x; if (px[i] && (px[i - 1] || px[i + 1] || px[i - w] || px[i + w])) c++; }
    if (c >= 3) { r++; if (r >= 5) { if (left < 0) left = x - 4; right = x; } } else r = 0;
  }
  return left < 0 ? [0, 1] : [left / w, (right + 1) / w];
}
/* a page's ink, taken level by the tilt the finder found (as the finder sees it, so marks and found systems share one frame), kept for the last few pages marked */
async function sysLevel(idx) {
  sysFresh(); const hit = SYS.scan.get(idx); if (hit) { SYS.scan.delete(idx); SYS.scan.set(idx, hit); return hit; }
  const gen = SYS.gen, sc = await peScan(S.pdf.slots[idx].src, SYS_W, null, 0.85, false), r = SYS.byPage.get(idx), deg = r ? r.tilt || 0 : 0;
  let out = sc;
  if (Math.abs(deg) > 0.05) {
    const { w, h, ink } = sc, lv = new Uint8Array(w * h), a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), cx = w / 2, cy = h / 2;
    for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) { const xx = X - cx, yy = Y - cy, sx = Math.round(xx * c - yy * sn + cx), sy = Math.round(xx * sn + yy * c + cy); if (sx >= 0 && sx < w && sy >= 0 && sy < h && ink[sy * w + sx]) lv[Y * w + X] = 1; }
    out = { w, h, ink: lv };
  }
  if (gen === SYS.gen) { SYS.scan.set(idx, out); if (SYS.scan.size > 3) SYS.scan.delete(SYS.scan.keys().next().value); }
  return out;
}
/* the page's record, with what was found kept aside so a reset or an undo can return to it */
function sysHandRec(idx) {
  const r = SYS.byPage.get(idx) || { systems: [], tilt: 0, staves: 0, geo: sysGeo(S.pdf.slots[idx]) };
  if (!SYS.hand.has(idx) && !r.auto) r.auto = r.systems;
  SYS.byPage.set(idx, r); SYS.hand.add(idx); return r;
}
/* one hand edit of a page's systems: a History step, then the timeline follows */
function sysCommit(idx, list) {
  pushHistory();
  const r = sysHandRec(idx);
  r.systems = list.slice().sort((a, b) => a.top - b.top); SYS.rev++; stageDirty = true; sysSettle();
}
/* a mark from top to bottom (page fractions) replaces every system it overlaps; `keep` is the system being moved or resized, which it also replaces */
async function sysMark(idx, a, b, keep) {
  const top = clamp(Math.min(a, b), 0, 1), bottom = clamp(Math.max(a, b), 0, 1); if (bottom - top < 0.01) return null;
  const [left, right] = await sysEdges(idx, top, bottom), r = await sysDetectPage(idx), old = r ? r.systems : [];          // a page not found yet is found first, so its own systems are not lost
  const box = { top, bottom, left, right };
  sysCommit(idx, old.filter(s => s !== keep && (s.bottom <= top || s.top >= bottom)).concat(box)); return box;
}
function sysRemove(idx, box) { const r = SYS.byPage.get(idx); if (r && r.systems.includes(box)) sysCommit(idx, r.systems.filter(s => s !== box)); }
/* Detect this page again: the page shown returns to its automatic result, one History step */
async function sysRedetect(idx) {
  pushHistory(); SYS.hand.delete(idx); SYS.byPage.delete(idx); SYS.rev++; stageDirty = true;
  const r = await sysDetectPage(idx); SYS.rev++; if (r) sysSettle();
}

/* ---------- the sheet: one system alone on a full-frame sheet of the page's own paper ---------- */
const SYS_FEATHER = 3;          // dots over which the join between the page and the plain paper around it is softened
/* one scale for the whole score (frame dots per page height), set by the widest system and the Page margin; a system too tall for the room
   left by the Top and bottom margin shrinks alone. A page with no system is fitted whole. */
function sysFit(key, W, H) {
  const idx = sysPage(key), pa = S.pdf.aspect, mx = S.set.margin / 100, ty = (S.set.tbMargin || 0) / 100, whole = { top: 0, bottom: 1, left: 0, right: 1 };
  let wide = 0; new Set(S.pdf.keep).forEach(i => { const r = SYS.byPage.get(i); if (r) r.systems.forEach(s => { wide = Math.max(wide, (s.right - s.left) * pa); }); });
  const sc = wide ? W * (1 - 2 * mx) / wide : W * (1 - 2 * mx) / pa, r = SYS.byPage.get(idx), list = r && r.systems.length ? r.systems : [whole];
  const box = list[Math.min(sysNo(key), list.length - 1)];
  const s = Math.min(sc, W * (1 - 2 * mx) / Math.max(1e-6, (box.right - box.left) * pa), H * (1 - 2 * ty) / Math.max(1e-6, box.bottom - box.top));
  return { box, s, dw: Math.max(2, Math.round((box.right - box.left) * pa * s)), dh: Math.max(2, Math.round((box.bottom - box.top) * s)) };
}
/* the paper: the median color of what is not ink inside the box */
function sysPaper(cv) {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, step = Math.max(1, Math.floor(d.length / 4 / 40000)), lum = [];
  for (let i = 0; i < d.length; i += 4 * step) lum.push(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8);
  const top = lum.slice().sort((a, b) => a - b)[Math.floor(lum.length * 0.95)] || 255, cut = top * 0.9, ch = [[], [], []];
  for (let i = 0; i < d.length; i += 4 * step) if ((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8) >= cut) { ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]); }
  return ch.map(a => a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 255);
}
async function sysSheet(key, W, H) {
  await sysDetectAll();
  const idx = sysPage(key), f = sysFit(key, W, H), sl = S.pdf.slots[idx], pa = S.pdf.aspect, box = f.box;
  const page = await S.pdf.doc.getPage(sl.src + 1), rot = page.rotate || 0, v1 = page.getViewport({ scale: 1, rotation: rot });
  const sc = pa * f.s / v1.width, vp = page.getViewport({ scale: sc, rotation: rot });
  const src = document.createElement('canvas'); src.width = f.dw; src.height = f.dh;
  const sx = src.getContext('2d', { alpha: false }); sx.fillStyle = '#fff'; sx.fillRect(0, 0, f.dw, f.dh);
  await page.render({ canvasContext: sx, viewport: vp, transform: [1, 0, 0, 1, -box.left * vp.width, -box.top * vp.height], background: '#ffffff' }).promise;
  try { page.cleanup(); } catch (e) {}
  const paper = sysPaper(src), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d', { alpha: false }), x = Math.round((W - f.dw) / 2), y = Math.round((H - f.dh) / 2), col = a => 'rgba(' + paper.join(',') + ',' + a + ')';
  c.fillStyle = col(1); c.fillRect(0, 0, W, H); c.drawImage(src, x, y);
  const F = Math.min(SYS_FEATHER, f.dw >> 2, f.dh >> 2);          // each edge fades into the paper around it, so an uneven scan shows no hard seam
  [[x, y, F, f.dh, x, 0, x + F, 0], [x + f.dw - F, y, F, f.dh, x + f.dw, 0, x + f.dw - F, 0], [x, y, f.dw, F, 0, y, 0, y + F], [x, y + f.dh - F, f.dw, F, 0, y + f.dh, 0, y + f.dh - F]].forEach(q => {
    const g = c.createLinearGradient(q[4], q[5], q[6], q[7]); g.addColorStop(0, col(1)); g.addColorStop(1, col(0)); c.fillStyle = g; c.fillRect(q[0], q[1], q[2], q[3]);
  });
  return cv;
}
