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
   5. Its left and right edges are its staves' line ends, reaching out only over ink attached to them (a brace, a bracket, a bar line), so a name, a page number, a margin note, or a scan shadow never moves them;
      an edge far from the page's other systems, with plain staff ends that are not, goes back to the staff ends. */
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
    P.push({ y: wy / sw, t: e - y, x0: a0, x1: a1, a: y, b: e - 1 }); y = e;
  }
  // 2. five evenly spaced lines make a staff
  const ov = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0.6 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
  const five = i => {
    if (i + 4 >= P.length) return null;
    const sp = [1, 2, 3, 4].map(k => P[i + k].y - P[i + k - 1].y), m = (P[i + 4].y - P[i].y) / 4;
    if (m >= 3 && m <= h * 0.03 && sp.every(v => Math.abs(v - m) <= 0.3 * m) && [1, 2, 3, 4].every(k => ov(P[i], P[i + k]))) return { n: 5, top: P[i].y, bot: P[i + 4].y, d: m, x0: Math.min(...[0, 1, 2, 3, 4].map(k => P[i + k].x0)), x1: Math.max(...[0, 1, 2, 3, 4].map(k => P[i + k].x1)), next: i + 5 };
    return null;
  };
  const four = i => {                                  // one line lost in a dropout: two even gaps and one double gap
    if (i + 3 >= P.length) return null;
    const sp = [1, 2, 3].map(k => P[i + k].y - P[i + k - 1].y), q = sp.slice().sort((a, b) => a - b), m = (q[0] + q[1]) / 2;
    if (m >= 3 && m <= h * 0.03 && Math.abs(q[0] - q[1]) <= 0.3 * m && Math.abs(q[2] - 2 * m) <= 0.35 * 2 * m && [1, 2, 3].every(k => ov(P[i], P[i + k])))
      return { n: 4, top: P[i].y, bot: P[i + 3].y, d: (P[i + 3].y - P[i].y) / 4, x0: Math.min(...[0, 1, 2, 3].map(k => P[i + k].x0)), x1: Math.max(...[0, 1, 2, 3].map(k => P[i + k].x1)), next: i + 4 };
    return null;
  };
  const staves = [];
  for (let i = 0; i < P.length;) { const st = five(i); if (st) { staves.push(st); i = st.next; } else i++; }
  // a beam, a slur, or a run of ledger lines joins a staff line into a thick lump, and one stray long stroke breaks the count: with the staff spacing this page already shows,
  // a staff is also five lines at that spacing from a line, where a lump covers every line inside it (four of the five, the first and last among them, will do)
  const ds = staves.map(q => q.d).sort((a, b) => a - b), dRef = ds.length ? ds[ds.length >> 1] : 0, ws = staves.map(q => q.x1 - q.x0).sort((a, b) => a - b), wMin = ws.length ? 0.8 * ws[ws.length >> 1] : 0;          // a staff line runs the width of the staff; a beam or a slur is short
  const tmpl = i => {
    if (!dRef || !P[i]) return null;
    let best = null;
    for (let f = 0.88; f <= 1.121; f += 0.02) {
      const m = dRef * f, tol = Math.max(2, 0.2 * m), used = [];
      for (let k = 0; k < 5; k++) { const y = P[i].y + k * m; let hit = -1; for (let j = i; j < P.length && P[j].a - tol <= y; j++) if (P[j].b + tol >= y && P[j].x1 - P[j].x0 >= wMin && ov(P[i], P[j])) { hit = j; break; } used.push(hit); }
      const n = used.filter(j => j >= 0).length;
      if (n >= 4 && used[0] === i && used[4] >= 0 && (!best || n > best.n)) best = { n, m, used };
    }
    if (!best) return null;
    const L = best.used.filter(j => j >= 0), m = best.m;
    return { n: 5, top: P[i].y, bot: P[i].y + 4 * m, d: m, x0: Math.min(...L.map(j => P[j].x0)), x1: Math.max(...L.map(j => P[j].x1)), next: Math.max(...L) + 1 };
  };
  const blob = i => {                                  // a staff so thick with notes and beams that all five lines have run together into one full-width lump of staff height
    const q = P[i]; if (!dRef || !q || q.x1 - q.x0 < wMin || q.t < 3.5 * dRef || q.t > 6.5 * dRef) return null;
    return { n: 5, top: q.y - 2 * dRef, bot: q.y + 2 * dRef, d: dRef, x0: q.x0, x1: q.x1, next: i + 1, blob: true };
  };
  const staves2 = [];
  for (let i = 0; i < P.length;) {
    let st = five(i);
    if (!st) { const f4 = four(i); st = f4 && !(five(i + 1) || tmpl(i + 1)) ? f4 : tmpl(i) || blob(i); }          // a stray stroke just above a staff is not the start of one
    if (st) { staves2.push(st); i = st.next; } else i++;
  }
  staves.length = 0; staves2.forEach(q => staves.push(q));
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
  for (let k = groups.length - 1; k >= 0; k--) if (!groups[k].some(q => q.blob) && !written(groups[k])) groups.splice(k, 1);          // (a lump is all ink: there is no bare staff to look through)
  if (!groups.length) return Object.assign({}, none, { staves: staves.length });
  /* A system's edges: the staves' own line ends, reaching out only over ink attached to them (a brace, a bracket, a bar line) and no further. Attached ink is a connected piece of ink at least two and a half staff spaces tall
     (a brace or a bracket is as tall as the staves; a letter is not), no further than five staff spaces out, and joined to the staff end, or to the piece before it, across no more than two staff spaces of blank.
     So the words beside a system (an instrument name), a page number, a margin note, and a scan shadow never move an edge. Each staff keeps its own reach (e0, e1), so a mark by hand takes its edges from the staves it holds. */
  const reachOf = g => {
    const d = g.reduce((t, q) => t + q.d, 0) / g.length, lim = Math.round(5 * d), need = Math.max(3, 2.5 * d), blankMax = Math.round(2 * d), ya = Math.max(Y0, Math.round(g[0].top - 2 * d)), yb = Math.min(Y1 - 1, Math.round(g[g.length - 1].bot + 2 * d));
    g.forEach(q => { q.e0 = Math.round(q.x0); q.e1 = Math.round(q.x1) - 1; });
    for (const dir of [-1, 1]) {
      const anchor = dir < 0 ? Math.round(Math.min(...g.map(q => q.x0))) : Math.round(Math.max(...g.map(q => q.x1))) - 1, xa = dir < 0 ? Math.max(X0, anchor - lim) : anchor + 1, xb = dir < 0 ? anchor - 1 : Math.min(X1 - 1, anchor + lim);
      if (xb < xa) continue;
      const ww = xb - xa + 1, hh = yb - ya + 1, lab = new Int32Array(ww * hh), comps = [];
      for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
        if (lab[y * ww + x] || !px[(ya + y) * w + xa + x]) continue;
        const id = comps.length + 1, c = { x0: x, x1: x, y0: y, y1: y, id }; comps.push(c); const st = [y * ww + x]; lab[st[0]] = id;
        while (st.length) {
          const i = st.pop(), cy = (i / ww) | 0, cx = i - cy * ww; if (cx < c.x0) c.x0 = cx; if (cx > c.x1) c.x1 = cx; if (cy < c.y0) c.y0 = cy; if (cy > c.y1) c.y1 = cy;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const ny = cy + oy, nx = cx + ox; if (ny < 0 || nx < 0 || ny >= hh || nx >= ww) continue; const j = ny * ww + nx; if (!lab[j] && px[(ya + ny) * w + xa + nx]) { lab[j] = id; st.push(j); } }
        }
      }
      const tall = comps.filter(c => c.y1 - c.y0 + 1 >= need).sort((a1, b1) => dir < 0 ? b1.x1 - a1.x1 : a1.x0 - b1.x0), ok = new Set(); let cur = dir < 0 ? ww : -1;          // cur: the outer edge reached so far, in window dots
      for (const c of tall) { const near = dir < 0 ? c.x1 : c.x0; if (dir < 0 ? cur - near - 1 <= blankMax : near - cur - 1 <= blankMax) { ok.add(c.id); cur = dir < 0 ? Math.min(cur, c.x0) : Math.max(cur, c.x1); } }
      g.forEach((q, i) => {          // this staff's own rows, and the room between it and its neighbors
        const r0 = Math.max(ya, i ? Math.round((g[i - 1].bot + q.top) / 2) : ya), r1 = Math.min(yb, i < g.length - 1 ? Math.round((q.bot + g[i + 1].top) / 2) : yb);
        let best = dir < 0 ? Infinity : -Infinity;
        for (let y = r0; y <= r1; y++) for (let x = 0; x < ww; x++) if (ok.has(lab[(y - ya) * ww + x])) { if (dir < 0 ? x < best : x > best) best = x; }
        if (best !== Infinity && best !== -Infinity) { if (dir < 0) q.e0 = Math.min(q.e0, xa + best); else q.e1 = Math.max(q.e1, xa + best); }
      });
    }
  };
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
    // 5. its left and right edges: the staves' own line ends, reaching out only over ink attached to them (see reachOf)
    const g = groups[k]; reachOf(g); let left = Infinity, right = -Infinity;
    for (const q of g) { left = Math.min(left, q.e0); right = Math.max(right, q.e1); }
    out.push({ top: top / h, bottom: (bot + 1) / h, left: left / w, right: (right + 1) / w });
  });
  // an edge far from the page's other systems, with plain staff ends that are not far from them, was pulled out by something that is not the system's own: it goes back to the staff ends
  if (out.length > 2) {
    const med = a => { const q = a.slice().sort((x, y) => x - y); return q[(q.length - 1) >> 1]; }, ml = med(out.map(o => o.left * w)), mr = med(out.map(o => o.right * w));
    out.forEach((o, k) => {
      const g = groups[k], d = sys[k].d, sl = Math.min(...g.map(q => Math.round(q.x0))), sr = Math.max(...g.map(q => Math.round(q.x1)));
      if (Math.abs(o.left * w - ml) > 3 * d && Math.abs(sl - ml) <= 3 * d) { o.left = sl / w; g.forEach(q => { q.e0 = Math.round(q.x0); }); }
      if (Math.abs(o.right * w - mr) > 3 * d && Math.abs(sr - mr) <= 3 * d) { o.right = sr / w; g.forEach(q => { q.e1 = Math.round(q.x1) - 1; }); }
    });
  }
  const stv = []; groups.forEach((g, k) => g.forEach(q => stv.push({ k, top: q.top / h, bot: q.bot / h, x0: q.x0 / w, x1: q.x1 / w, e0: q.e0 / w, e1: (q.e1 + 1) / w })));          // the staves of the systems kept, in the same frame as the systems (k: which system)
  return { systems: out, staves: staves.length, d: sys.reduce((t, q) => t + q.d, 0) / sys.length, stv };
}

/* The whole measuring of one page, for a worker (it runs there with no outside names; the page's own thread draws the page and reads its pixels, nothing more).
   rgba: the page's pixels; k: how dark a dot must be, against the paper, to count as ink. The grey, the paper, the threshold, the music's box, the tilt, and the finder are the same steps the page's own thread took before. */
function sysMeasure(rgba, w, h, k) {
  const px = new Uint8ClampedArray(rgba), g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
  const hist = new Uint32Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let acc = 0, bg = 255; for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc > g.length * 0.08) { bg = t; break; } }
  const lim = Math.max(30, bg * k), ink = new Uint8Array(w * h); let n = 0; for (let i = 0; i < g.length; i++) if (g[i] < lim) { ink[i] = 1; n++; }
  const sc = { w, h, ink, n }, reg = peInkBox(sc, 0);
  if (!reg) return { systems: [], staves: 0, d: 0, tilt: 0, bare: true };
  const t = peTilt(sc), tilt = t.gain > 0.03 ? t.deg : 0, m = sysDetectCore(ink, w, h, tilt, [reg[0] * w, reg[1] * h, reg[2] * w, reg[3] * h]);
  m.tilt = tilt; return m;
}

/* A system on the timeline is a page number plus a multiple of SYS_STRIDE, so system 0 is the page itself and every other part of the app keeps reading a page number. */
const SYS_STRIDE = 100000;
const sysKey = (page, k) => page + k * SYS_STRIDE;
const sysPage = key => key >= 0 ? key % SYS_STRIDE : key;
const sysNo = key => key >= 0 ? Math.floor(key / SYS_STRIDE) : 0;
/* the entries one page gives in System: one per system found, or the whole page when none was (or it is not found yet) */
function sysEntries(page) { const r = SYS.byPage.get(page), n = r && r.systems.length ? r.systems.length : 1; return Array.from({ length: n }, (_, k) => sysKey(page, k)); }
/* the same, as the Selections themselves (null for a page shown whole) */
function sysBoxes(page) { const r = SYS.byPage.get(page); return r && r.systems.length ? r.systems : [null]; }
/* the pages not yet measured are found in the background; the timeline follows when they are all in */
function sysKick() {
  if (!S.pdf) return; sysFresh();
  const pages = [...new Set(S.pdf.keep)], left = pages.filter(i => !SYS.byPage.has(i)).length;
  if (!left) { if (SYS.prog) sysProg(null); return; }
  if (SYS.prog && SYS.job) return;
  sysProg({ done: pages.length - left, total: pages.length });
  const fresh = pages.filter(i => !SYS.byPage.has(i)), head = selCurrent();          // the page under the playhead is found first
  sysDetectAll({ first: head == null ? null : sysPage(head), onProgress: (done, total) => sysProg({ done, total }) }).then(done => {
    if (!done) return;
    sysProg(null); sysSettle(); rvStart('blocks');          // the timeline appears once, with the same rise-in as the other layouts
    sysScan(fresh).then(w => {          // one toast says what was found on the pages found now: tilted pages, then two-page scans; it takes the place of "loaded"
      const said = w ? [w.tilt.length ? sysNote('tilt', w.tilt) : '', w.wide.length ? sysNote('wide', w.wide) : ''].filter(Boolean).join(' ') : '';
      if (said) toast(said); else if (SYS.loadedMsg) toast(SYS.loadedMsg); SYS.loadedMsg = null;
    });
  });
}
/* the run, said in the System group and on the timeline and Export video */
function sysProg(p) { SYS.prog = p; sysUI(); }
const sysBusy = () => sysOn() && !!SYS.prog;
function sysUI() {
  if (typeof syncExport === 'function') syncExport();
  if (typeof syncSysBusy === 'function') syncSysBusy();
  if (typeof sysStatusUI === 'function') sysStatusUI();
  if (typeof selPaintSoon === 'function' && SPLIT.shown) selPaintSoon();          // the selector waits and releases with the preview
  stageDirty = true; TL.staticDirty = true; TL.overlayDirty = true;
}
const SYS_TILT = 0.3;          // degrees of tilt that earn a note
/* what finding these pages turned up: the ones tilted past the limit, and the two-page scans */
async function sysScan(pages) {
  const gen = SYS.gen, tilt = pages.filter(i => { const r = SYS.byPage.get(i); return r && Math.abs(r.tilt) > SYS_TILT && !peTilted(S.pdf.slots[i]); });
  const wide = []; for (const i of pages) { const sl = S.pdf.slots[i]; try { await peAspectOf(sl); } catch (e) {} if (peSpread(sl)) wide.push(i); }
  return gen === SYS.gen && sysOn() ? { tilt, wide } : null;
}
/* a note naming its pages: "Pages 4, 7, and 12 are tilted…"; more than five are counted */
const sysList = a => a.length < 3 ? a.join(' and ') : a.slice(0, -1).join(', ') + ', and ' + a[a.length - 1];
function sysNote(kind, ids) {
  const pg = ids.map(pageNo).sort((a, b) => a - b);
  return pg.length > 5 ? tx('sys.' + kind + '.count', { n: pg.length }) : tx('sys.' + kind + (pg.length === 1 ? '.one' : '.many'), { pages: sysList(pg) });
}
/* The stops changed (a system marked or removed, Full page, a page found again): the timeline follows.
   With no turn placed by hand the video is spaced evenly again. Otherwise only the changed pages' own turns change (sysRetime). The playhead stays on its system. */
function sysSettle() {
  if (!sysOn() || !S.pdf) return;
  const hold = SYS.hold; if (!SYS.prog) SYS.hold = null;          // pages were found again after an edit: their turns come from the stops as they were before, until finding ends
  const old = S.spreads, before = spreadSig(), turns = S.turns.slice(), ph = S.ph.slice(), at = old.length ? clamp(frameState(S.time).spread, 0, old.length - 1) : -1;
  S.spreads = buildSpreads();
  if (spreadSig() === before && !hold) return;
  if (hold) sysRetime(hold.sp, hold.turns, hold.ph);
  else if (!S.turnsEdited || turns.length !== Math.max(0, old.length - 1)) autoSpace(false); else sysRetime(old, turns, ph);
  if (at >= 0 && S.spreads.length && !Transport.playing) {
    const A = sysRuns(old), B = sysRuns(S.spreads), ra = A.find(q => at >= q.i0 && at <= q.i1), rb = ra && B.find(q => q.id === ra.id);
    if (rb) {
      let j = -1; const bx = old[at].b; if (bx) for (let k = rb.i0; k <= rb.i1; k++) if (S.spreads[k].b === bx) j = k;
      if (j < 0) j = Math.min(rb.i1, rb.i0 + (at - ra.i0));
      if (frameState(S.time).spread !== j) { S.time = j === 0 ? S.vStart : Math.min(vEnd(), S.turns[j - 1] - refOffset() + flipDur() + 0.001); updateTimeUI(true); }
    }
  }
  afterStructureChange(); onTurnsChanged();
}
/* The stops as they were, with their Selections copied by value, kept while pages are found again after an edit (and in a History step, so undo and redo can match too). */
const sysStops = sp => sp.map(e => Object.assign(e.slice(), { b: e.b ? { top: e.b.top, bottom: e.b.bottom } : e.b, credits: e.credits, inlineCredits: e.inlineCredits, startCredits: e.startCredits }));
/* Turns placed by hand are about to lose their stops (a page is found again): keep the stops and the turns as they are, once, until finding ends. */
function sysHoldTurns() {
  if (SYS.hold || !sysOn() || !S.turnsEdited || !S.spreads.length || S.turns.length !== S.spreads.length - 1) return;
  SYS.hold = { sp: sysStops(S.spreads), turns: S.turns.slice(), ph: S.ph.slice() };
}
/* the turns follow the stops that were held: the pages not edited keep every turn, an edited page keeps its block's start */
function sysHoldApply() { const h = SYS.hold; if (h) sysRetime(h.sp, h.turns, h.ph); }
/* the stops grouped by page, in order: { id, i0, i1 }. A page used twice gets two ids; a credits card is its own group. */
function sysRuns(sp) {
  const out = [], seen = {};
  sp.forEach((e, i) => {
    const pg = e[1] >= 0 ? sysPage(e[1]) : 'c' + (e.startCredits ? 's' : 'e'), last = out[out.length - 1];
    if (last && last.pg === pg && e[1] >= 0) { last.i1 = i; return; }
    seen[pg] = (seen[pg] || 0) + 1; out.push({ pg, id: pg + '#' + seen[pg], i0: i, i1: i });
  });
  return out;
}
/* Turns placed by hand stay with their systems. Each page's block keeps its start; a system that stays keeps its turn; new stops share the time of the stop they split, evenly.
   old, turns, ph: the stops and their turns before the change. */
function sysRetime(old, turns, ph) {
  const start = i => i === 0 ? -Infinity : turns[i - 1], A = new Map(sysRuns(old).map(q => [q.id, q])), n = S.spreads.length, ns = new Array(n).fill(null), np = new Array(n).fill(false);
  sysRuns(S.spreads).forEach(r => {
    const o = A.get(r.id); if (!o) return; let last = -Infinity;
    const from = sysMatch(old, o, r);
    for (let j = r.i0; j <= r.i1; j++) {
      let f = from[j - r.i0];
      if (j === r.i0) f = o.i0;          // the block starts where it did
      else if (f >= 0 && !(start(f) > last)) f = -1;
      if (f >= 0) { ns[j] = start(f); np[j] = f > 0 && !!ph[f - 1]; last = ns[j]; }
    }
  });
  if (n) ns[0] = -Infinity;
  const lo = S.vStart + refOffset(), hi = vEnd();
  for (let j = 1; j < n; j++) {
    if (ns[j] != null) continue;
    let z = j; while (z < n && ns[z] == null) z++;
    const a = Math.max(lo, ns[j - 1]), b = z < n ? ns[z] : hi, m = z - j;
    for (let q = 0; q < m; q++) ns[j + q] = a + (b - a) * (q + 1) / (m + 1);
    j = z;
  }
  S.turns = ns.slice(1); S.ph = np.slice(1); normalizeTurns(); S.turnsEdited = true;
}
/* which old stop each new stop of a page's block follows (-1 for none). A Selection that is the same object follows its own stop. A page found again has new Selections: the same number of systems follow in order; a different number, by overlap (at least half of the smaller, each old one used once, in order). */
function sysMatch(old, o, r) {
  const out = []; let hit = 0;
  for (let j = r.i0; j <= r.i1; j++) { let f = -1; const bx = S.spreads[j].b; if (bx) for (let k = o.i0; k <= o.i1; k++) if (old[k].b === bx) f = k; out.push(f); if (f >= 0) hit++; }
  if (hit || r.i1 === r.i0) return out;
  if (r.i1 - r.i0 === o.i1 - o.i0) return out.map((_, q) => o.i0 + q);
  let k0 = o.i0;
  for (let j = r.i0; j <= r.i1; j++) {
    const bx = S.spreads[j].b; if (!bx) continue;
    for (let k = k0; k <= o.i1; k++) {
      const ob = old[k].b; if (!ob) continue;
      const ov = Math.min(ob.bottom, bx.bottom) - Math.max(ob.top, bx.top);
      if (ov >= 0.5 * Math.min(ob.bottom - ob.top, bx.bottom - bx.top)) { out[j - r.i0] = k; k0 = k + 1; break; }
    }
  }
  return out;
}

/* ---------- running it: a worker, one page at a time, and the pages found so far ---------- */
const SYS = {
  byPage: new Map(), scan: new Map(), prog: null, prev: 'spread', hand: new Set(), rev: 0, gen: null, token: 0, job: null, ws: [], bad: [], loadedMsg: null, n: 0, pend: new Map(), hold: null,
  /* one to three workers, by what the browser reports about the computer; the page's own thread when none can start */
  lanes() { return clamp(Math.round((navigator.hardwareConcurrency || 2) / 3), 1, 3); },
  worker(k) {
    if (this.ws[k]) return this.ws[k];
    const clampFn = (v, a, b) => Math.min(b, Math.max(a, v)), src = 'const clamp=' + clampFn.toString() + ',peInkBox=' + peInkBox.toString() + ',peTilt=' + peTilt.toString() + ',sysDetectCore=' + sysDetectCore.toString() + ',sysMeasure=' + sysMeasure.toString() + ';onmessage=e=>{const m=e.data;postMessage({id:m.id,r:sysMeasure(m.rgba,m.w,m.h,m.k)});};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = this.ws[k] = new Worker(url); URL.revokeObjectURL(url);
    w.onmessage = e => { const f = this.pend.get(e.data.id); if (f) { this.pend.delete(e.data.id); f.res(e.data.r); } };
    w.onerror = () => {                                 // a worker that fails: its pages are measured here instead, and it is not used again
      this.ws[k] = null; this.bad[k] = true;
      [...this.pend].filter(([, f]) => f.k === k).forEach(([id, f]) => { this.pend.delete(id); Promise.resolve(f.m.rgba.byteLength ? f.m.rgba : f.m.again()).then(b => f.res(sysMeasure(b, f.m.w, f.m.h, f.m.k))); });          // the pixels may already have gone to the worker: the page is drawn again
    };
    return w;
  },
  run(m, k = 0) {                                       // the answer, or null when it was stopped
    let w; try { w = this.bad[k] ? null : this.worker(k); } catch (e) { w = null; this.bad[k] = true; }
    if (!w) return Promise.resolve(sysMeasure(m.rgba, m.w, m.h, m.k));
    return new Promise(res => { const id = ++this.n; this.pend.set(id, { res, k, m }); w.postMessage({ id, rgba: m.rgba, w: m.w, h: m.h, k: m.k }, [m.rgba]); });          // the pixels are handed over, not copied
  },
  stop() {                                              // leaving the layout: the workers end at once, and the pages already found stay
    this.token++; this.hold = null; sysPagesClear(); this.ws.forEach(w => w && w.terminate()); this.ws = []; this.bad = [];
    this.pend.forEach(f => f.res(null)); this.pend.clear(); this.job = null; this.loadedMsg = null; if (this.prog) sysProg(null);
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
    sysHoldTurns();          // the page's stops are about to collapse: its placed turns are kept until it is found again
    if (SYS.hand.has(i) && S.pdf.keep.includes(i)) named.push(pageNo(i));
    SYS.byPage.delete(i); SYS.scan.delete(i); SYS.hand.delete(i); gone = true;
  });
  if (!gone) return;
  SYS.rev++; stageDirty = true; if (sysOn() && S.pdf.keep.length) sysKick();
  if (named.length && !HB.quiet) { SYS.noted = true; named.sort((a, b) => a - b); toast(tx(named.length === 1 ? 'sys.redone' : 'sys.redone.many', { page: sysList(named) })); }          // noted: the caller's own toast would only replace this one
}
/* Every found page for the project and the settings file: [{p: page in the saved list, t: tilt, s: [[top, bottom, left, right]], f: 1 on Full page, h: systems held aside on Full page, a: 1 when found automatically, g: the picture it was found on}] */
const sysToList = () => [...SYS.byPage.keys()].filter(i => S.pdf.slots[i]).sort((a, b) => a - b).map(i => {
  const r = SYS.byPage.get(i), q = v => Math.round(v * 10000) / 10000, box = b => { const o = [q(b.top), q(b.bottom), q(b.left), q(b.right)]; if (b.hx || (b.er && b.er.length)) o.push(b.hx ? 1 : 0); if (b.er && b.er.length) o.push(b.er.map(t => [q(t.r)].concat(t.p.map(q)))); return o; }, e = { p: i + 1, t: q(r.tilt || 0), s: r.systems.map(box) };
  if (r.full) e.f = 1; if (r.held && r.held.length) e.h = r.held.map(box); if (r.heldTurns && r.heldTurns.length) e.ht = r.heldTurns.map(q => [Math.round(q.t * 10000) / 10000, q.ph ? 1 : 0]); if (!SYS.hand.has(i)) e.a = 1; e.g = r.geo || sysGeo(S.pdf.slots[i]);
  return e;
});
/* a box's saved erasures: [[radius, x0, y0, x1, y1, ...]] in page units, each point 0 to 1 across and down; null when none is usable */
function sysErClean(a) {
  if (!Array.isArray(a)) return null; const out = [];
  for (const t of a.slice(0, 2000)) {
    if (!Array.isArray(t) || t.length < 3 || t.length > 20002 || t.length % 2 === 0 || !t.every(Number.isFinite)) continue;
    const r = t[0], pts = t.slice(1); if (!(r > 0 && r <= 0.5) || !pts.every(v => v >= -0.5 && v <= 1.5)) continue;
    out.push({ r, p: pts });
  }
  return out.length ? out : null;
}
/* only values this site understands; null when nothing usable */
function sysListClean(list, n) {
  if (!Array.isArray(list) || list.length > 500) return null; const out = [], f = v => Number.isFinite(v) && v >= 0 && v <= 1;
  const boxes = a => { const s = []; for (const b of Array.isArray(a) ? a.slice(0, 100) : []) { if (!Array.isArray(b) || b.length < 4 || b.length > 6 || !b.slice(0, 4).every(f) || b[1] - b[0] < 0.01 || b[3] - b[2] <= 0) continue; const o = { top: b[0], bottom: b[1], left: b[2], right: b[3] }; if (b[4] === 1) o.hx = true; const er = sysErClean(b[5]); if (er) o.er = er; s.push(o); } return s; };
  for (const e of list) {
    if (!e || !Number.isInteger(e.p) || e.p < 1 || e.p > n || !Array.isArray(e.s) || e.s.length > 100) continue;
    const t = Number.isFinite(e.t) ? clamp(e.t, -15, 15) : 0, s = boxes(e.s), o = { p: e.p, t, s };
    if (e.f === 1 || e.f === true) o.f = true; if (e.a === 1 || e.a === true) o.a = true; const h = boxes(e.h); if (h.length) o.h = h; if (Array.isArray(e.ht) && h.length) { const ht = e.ht.slice(0, 100).filter(q => Array.isArray(q) && Number.isFinite(q[0]) && q[0] >= 0 && q[0] < 1e5).map(q => [q[0], q[1] ? 1 : 0]); if (ht.length) o.ht = ht; } if (typeof e.g === 'string' && e.g.length < 300) o.g = e.g;
    out.push(o);
  }
  return out.length ? out : null;
}
/* put saved pages in place (the pages must already be in the saved order); a page whose picture is not the one it was found on is found again */
function sysFromList(list) {
  sysFresh(); SYS.byPage.clear(); SYS.scan.clear(); SYS.hand.clear();
  (list || []).forEach(e => {
    const i = e.p - 1, sl = S.pdf.slots[i]; if (!sl || (e.g && e.g !== sysGeo(sl))) return;
    SYS.byPage.set(i, { systems: e.s.slice().sort((a, b) => a.top - b.top), tilt: e.t, staves: 0, geo: sysGeo(sl), auto: [], full: !!e.f || !e.s.length, held: (e.h || []).slice().sort((a, b) => a.top - b.top), heldTurns: (e.ht || []).map(q => ({ t: q[0], ph: !!q[1] })) });
    if (e.a) delete SYS.byPage.get(i).auto; else SYS.hand.add(i);
  });
  SYS.rev++; stageDirty = true; if (sysOn()) sysKick();
}
/* the pages were rebuilt (an edit, a new score): what was found no longer lines up */
function sysFresh() { const g = S.pdf ? S.pdf.gen || 0 : -1; if (SYS.gen !== g) { SYS.stop(); SYS.byPage.clear(); SYS.scan.clear(); SYS.hand.clear(); SYS.rev++; SYS.gen = g; } sysSync(); }
/* one page: its systems as fractions of the page ({ systems, tilt, staves }), found once and kept */
async function sysDetectPage(idx, lane) {
  sysFresh();
  const hit = SYS.byPage.get(idx); if (hit) return hit;
  const tok = SYS.token, geo = sysGeo(S.pdf.slots[idx]), slot = S.pdf.slots[idx], draw = () => peScan(slot.src, SYS_W, null, 0.85, false, true), sc = await draw();
  if (tok !== SYS.token) return null;
  const m = await SYS.run({ rgba: sc.rgba, w: sc.w, h: sc.h, k: 0.85, again: async () => (await draw()).rgba, token: tok }, lane || 0);
  if (!m || tok !== SYS.token) return null;
  const tilt = m.tilt || 0, r = m.bare ? { systems: [], tilt: 0, staves: 0, geo, full: true } : { systems: m.systems, tilt, staves: m.staves, geo, full: !m.systems.length };
  if (m.stv && m.stv.length) r.stv = m.stv;          // where its staves are, so a mark by hand takes its edges from them with no new drawing
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
    const queue = order.filter(i => !SYS.byPage.has(i)); let ok = true;
    await Promise.all(Array.from({ length: Math.min(SYS.lanes(), queue.length) }, async (_, lane) => {          // each worker takes the next page as it frees up
      while (ok && queue.length) {
        if (tok !== SYS.token) { ok = false; return; }
        const i = queue.shift(); if (SYS.byPage.has(i)) continue;
        const r = await sysDetectPage(i, lane); if (!r || tok !== SYS.token) { ok = false; return; }
        done++; if (opt.onProgress) opt.onProgress(done, order.length, i);
      }
    }));
    return ok && tok === SYS.token;
  })();
  job.then(() => { if (SYS.job === job) SYS.job = null; });
  return job;
}

/* ---------- marking by hand: the page's systems as the person set them, kept with the page like a Dim region ---------- */
/* the hand-marked pages (page -> systems), as one part of a History step */
const sysSnap = () => { const o = {}; SYS.hand.forEach(i => { const r = SYS.byPage.get(i); if (r) o[i] = { systems: r.systems.map(q => Object.assign({}, q)), tilt: r.tilt || 0, geo: r.geo, full: !!r.full, held: (r.held || []).map(q => Object.assign({}, q)), ht: (r.heldTurns || []).map(q => Object.assign({}, q)) }; }); return o; };
/* Goes back to a snapshot's marks; true when anything changed. A page that is not marked there returns to what was found (or is found again). */
function sysRestore(m) {
  sysFresh(); if (JSON.stringify(m) === JSON.stringify(sysSnap())) return false;
  [...SYS.hand].forEach(i => {
    if (m[i]) return; SYS.hand.delete(i); const r = SYS.byPage.get(i);
    if (r && r.auto) { r.systems = r.auto; delete r.auto; r.full = !r.systems.length; r.held = []; r.heldTurns = []; } else SYS.byPage.delete(i);
  });
  Object.keys(m).forEach(k => {
    const fresh = !SYS.byPage.has(+k), r = sysHandRec(+k); if (fresh) delete r.auto;          // a page that was cleared has no found result to go back to; it is found again
    r.systems = m[k].systems.map(q => Object.assign({}, q)); r.tilt = m[k].tilt; r.geo = m[k].geo; r.full = !!m[k].full; r.held = (m[k].held || []).map(q => Object.assign({}, q)); r.heldTurns = (m[k].ht || []).map(q => Object.assign({}, q));
  });
  SYS.rev++; stageDirty = true; return true;
}
/* One page measured again as a calculation: nothing is replaced, the page's record and its Selections are left as they are. Resolves with the finder's answer, or null when it was stopped. */
async function sysMeasureAgain(idx) {
  sysFresh(); const tok = SYS.token, sl = S.pdf.slots[idx], draw = () => peScan(sl.src, SYS_W, null, 0.85, false, true), sc = await draw();
  return await SYS.run({ rgba: sc.rgba, w: sc.w, h: sc.h, k: 0.85, again: async () => (await draw()).rgba, token: tok }, 0);
}
/* a page's staves with their reach (the finder's own measure, kept on the page's record): a page found by the finder has them already; a page restored from saved work measures them once */
async function sysStaves(idx) {
  sysFresh(); let r = SYS.byPage.get(idx); if (r && r.stv) return r.stv;
  const gen = SYS.gen, geo = sysGeo(S.pdf.slots[idx]), m = await sysMeasureAgain(idx), stv = m && m.stv ? m.stv : [];
  r = SYS.byPage.get(idx); if (m && r && gen === SYS.gen && r.geo === geo) r.stv = stv;
  return stv;
}
/* the left and right edges of a band (fractions of the page): the staves in the band, each reaching out over the ink attached to it, by the same rule as a found system, so a mark by hand sits on its music the same way. A band with no staff in it lines up with the page's other staves. */
async function sysEdges(idx, top, bottom) {
  const stv = await sysStaves(idx), inBand = stv.filter(q => (q.top + q.bot) / 2 >= top && (q.top + q.bot) / 2 <= bottom), use = inBand.length ? inBand : stv;
  if (use.length) return [Math.min(...use.map(q => q.e0)), Math.max(...use.map(q => q.e1))];
  return sysEdgesInk(idx, top, bottom);          // a page with no staff at all: the first and last real ink in the band
}
/* the first and last real stretch of ink inside a band (fractions of the page); a dot alone is dust */
async function sysEdgesInk(idx, top, bottom) {
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
  const r = SYS.byPage.get(idx) || { systems: [], tilt: 0, staves: 0, geo: sysGeo(S.pdf.slots[idx]), full: true };
  if (!SYS.hand.has(idx) && !r.auto) r.auto = r.systems.map(q => Object.assign({}, q));          // a copy: a hand edit moves the Selections themselves
  SYS.byPage.set(idx, r); SYS.hand.add(idx); return r;
}
/* one hand edit of a page's systems: a History step, then the timeline follows */
function sysCommit(idx, list) {
  pushHistory();
  const r = sysHandRec(idx);
  r.systems = list.slice().sort((a, b) => a.top - b.top); r.full = !r.systems.length; r.held = []; r.heldTurns = []; SYS.rev++; stageDirty = true; sysSettle();          // a page left with none is a full page
}
/* Systems | Full page: a full page is shown whole, as one stop; the systems found (or marked) wait aside and come back with Systems. One History step. */
function sysSetFull(idx, full) {
  const r = SYS.byPage.get(idx); if (!r || !!r.full === full) return;
  pushHistory(); sysHandRec(idx);
  if (full) { r.heldTurns = sysTurnsOf(idx); r.held = r.systems; r.systems = []; r.full = true; } else { r.systems = r.held || []; r.held = []; r.full = false; }
  SYS.rev++; stageDirty = true; sysSettle();
  if (!full) sysTurnsBack(idx);
}
/* a page's inner turns as times from its block's start, with their placeholder flags: [] unless turns were placed by hand */
function sysTurnsOf(idx) {
  const run = S.turnsEdited ? sysRuns(S.spreads).find(q => q.pg === idx) : null; if (!run || run.i1 === run.i0 || S.turns.length !== S.spreads.length - 1) return [];
  const bs = run.i0 === 0 ? S.vStart + refOffset() : S.turns[run.i0 - 1], out = [];
  for (let k = run.i0; k < run.i1; k++) out.push({ t: S.turns[k] - bs, ph: !!S.ph[k] });
  return out;
}
/* Systems again: the page's inner turns come back at its block's start plus the times they were held at; when they no longer fit before the next block's start they are scaled to fit, in order */
function sysTurnsBack(idx) {
  const r = SYS.byPage.get(idx), ht = r && r.heldTurns || []; if (r) r.heldTurns = [];
  const run = sysRuns(S.spreads).find(q => q.pg === idx), m = run ? run.i1 - run.i0 : 0;
  if (!S.turnsEdited || !ht.length || !run || ht.length !== m || S.turns.length !== S.spreads.length - 1) return;
  const lo = S.vStart + refOffset(), bs = run.i0 === 0 ? lo : S.turns[run.i0 - 1], D = turnGap(), end = run.i1 + 1 < S.spreads.length ? S.turns[run.i1] : vEnd() + refOffset(), limit = end - D, tl = ht[m - 1].t, f = tl > 0 && bs + tl > limit ? Math.max(0, limit - bs) / tl : 1;
  ht.forEach((q, q0) => { S.turns[run.i0 + q0] = bs + q.t * f; S.ph[run.i0 + q0] = q.ph; });
  normalizeTurns(); onTurnsChanged();
}
/* Moving a Selection never removes another: its neighbors give way by the rule the timeline's handles follow. From where they stood when the drag began (base),
   a neighbor's facing edge is pushed along; at the least height the whole neighbor slides and pushes the next; the page's top and bottom stop everything.
   kind: 'top' or 'bottom' (that edge of base[i] goes to a), 'move' (base[i] moves by a), 'new' (a new one from a to b, placed among the others by where it began).
   Returns { boxes, out, cur }: the Selections in order (null for a new one), each one's [top, bottom], and which one is being moved. */
const SYS_MINH = 0.015;
function sysPush(base, kind, i, a, b) {
  const M = SYS_MINH, boxes = base.slice();
  if (kind === 'new') { i = base.filter(s => (s.top + s.bottom) / 2 < a).length; boxes.splice(i, 0, null); }
  const n = boxes.length, lo = i * M, hi = 1 - (n - 1 - i) * M, me = boxes[i], out = boxes.map(s => s ? [s.top, s.bottom] : [a, a]);
  let t, bt;
  if (kind === 'top') { bt = me.bottom; t = clamp(a, Math.min(lo, bt - M), bt - M); }
  else if (kind === 'bottom') { t = me.top; bt = clamp(a, t + M, Math.max(hi, t + M)); }
  else if (kind === 'move') { const dy = clamp(a, Math.min(0, lo - me.top), Math.max(0, hi - me.bottom)); t = me.top + dy; bt = me.bottom + dy; }
  else { t = clamp(Math.min(a, b), lo, Math.max(lo, hi)); bt = clamp(Math.max(a, b), t, Math.max(t, hi)); }
  out[i] = [t, bt];
  for (let j = i + 1; j < n; j++) { const s = boxes[j], tt = Math.max(s.top, out[j - 1][1]); out[j] = [tt, Math.max(s.bottom, tt + M)]; }
  for (let j = i - 1; j >= 0; j--) { const s = boxes[j], bb = Math.min(s.bottom, out[j + 1][0]); out[j] = [Math.min(s.top, bb - M), bb]; }
  return { boxes, out, cur: i };
}
/* puts a page's Selections where a drag left them (boxes and out as sysPush gives them): one History step. A Selection that moved keeps being itself, so its turn stays with it. */
async function sysPlace(idx, boxes, out) {
  const moved = boxes.map((s, k) => !s || Math.abs(s.top - out[k][0]) > 1e-5 || Math.abs(s.bottom - out[k][1]) > 1e-5);
  if (!moved.some(Boolean)) return false;
  await sysDetectPage(idx);          // a page not found yet is found first, so its own systems are not lost
  const edges = []; for (let k = 0; k < out.length; k++) edges.push(moved[k] && !(boxes[k] && boxes[k].hx) ? (boxes[k] ? await sysEdges(idx, out[k][0], out[k][1]) : await sysNewEdges(idx, out[k][0], out[k][1])) : null);          // sides set by hand stay; a new one takes the page's usual sides
  const r0 = SYS.byPage.get(idx); if (boxes.some(s => s && !(r0 && r0.systems.includes(s)))) return false;          // the page changed under the drag
  pushHistory(); const r = sysHandRec(idx);
  r.systems = boxes.map((s, k) => { if (!moved[k]) return s; const q = { top: out[k][0], bottom: out[k][1] }; if (edges[k]) { q.left = edges[k][0]; q.right = edges[k][1]; } return s ? Object.assign(s, q) : q; }).sort((x, y) => x.top - y.top);
  r.full = !r.systems.length; r.held = []; r.heldTurns = []; SYS.rev++; stageDirty = true; sysSettle(); return true;
}
/* the page's usual left and right for a new Selection: the middle of the sides of the systems already there (the finder's own measure of the band when there are none) */
async function sysNewEdges(idx, top, bottom) {
  const r = SYS.byPage.get(idx), list = r ? r.systems : [], med = a => { const v = a.slice().sort((x, y) => x - y); return v[v.length >> 1]; };
  if (list.length) return [med(list.map(q => q.left)), med(list.map(q => q.right))];
  return sysEdges(idx, top, bottom);
}
/* a Selection's sides as a drag would leave them: inside the page, never closer than a twentieth of the page's width */
const SYS_MINW = 0.05;
function sysSides(box, side, v) {
  v = clamp(v, 0, 1);
  return side === 'left' ? [clamp(v, 0, box.right - SYS_MINW), box.right] : [box.left, clamp(v, box.left + SYS_MINW, 1)];
}
/* a Selection's sides set by hand: one History step. They stay until the Selection is reset. */
function sysEdgeSet(idx, box, left, right) {
  const r0 = SYS.byPage.get(idx); if (!r0 || !r0.systems.includes(box)) return false;
  if (Math.abs(box.left - left) < 1e-5 && Math.abs(box.right - right) < 1e-5) return false;
  pushHistory(); sysHandRec(idx); Object.assign(box, { left, right, hx: true });
  SYS.rev++; stageDirty = true; sysSettle(); return true;
}
/* Double-click a Selection: that one box returns to what the finder found for it, as one History step. The default is the found system that overlaps the box most (at least half of the smaller of the two); a box with no
   found system under it (one drawn by hand where nothing was found) does nothing. A neighbor in the way gives way as in a drag (sysPush). Resolves with whether anything changed. */
async function sysResetOne(idx, box) {
  const r0 = SYS.byPage.get(idx); if (!r0 || !r0.systems.includes(box) || !S.pdf || !S.pdf.slots[idx]) return false;
  let auto = r0.auto || (SYS.hand.has(idx) ? null : r0.systems.map(q => Object.assign({}, q)));          // a page nobody marked still has what the finder found
  if (!auto) { const m = await sysMeasureAgain(idx); if (!m) return false; auto = m.systems; }
  const r = SYS.byPage.get(idx); if (!r || r !== r0 || !r.systems.includes(box) || !auto || !auto.length) return false;          // the page changed while it was measured
  let best = null, bo = 0; for (const a of auto) { const o = Math.min(box.bottom, a.bottom) - Math.max(box.top, a.top); if (o > bo && o >= 0.5 * Math.min(box.bottom - box.top, a.bottom - a.top)) { bo = o; best = a; } }
  if (!best) return false;
  const same = (x, y) => Math.abs(x - y) < 1e-5; if (same(box.top, best.top) && same(box.bottom, best.bottom) && same(box.left, best.left) && same(box.right, best.right)) return false;
  const base = r.systems.slice(), i = base.indexOf(box), a = sysPush(base, 'top', i, best.top), mid = base.map((q, k) => Object.assign({}, q, { top: a.out[k][0], bottom: a.out[k][1] })), b = sysPush(mid, 'bottom', i, best.bottom), out = b.out;
  const edges = []; for (let k = 0; k < out.length; k++) edges.push(k !== i && !base[k].hx && (!same(out[k][0], base[k].top) || !same(out[k][1], base[k].bottom)) ? await sysEdges(idx, out[k][0], out[k][1]) : null);
  const now = SYS.byPage.get(idx); if (now !== r || !r.systems.includes(box) || r.systems.length !== base.length) return false;
  if (!r.auto) r.auto = auto.map(q => Object.assign({}, q));          // kept, so Detect again and an undo can return to it
  pushHistory(); const rr = sysHandRec(idx);
  base.forEach((s2, k) => { if (k === i) { Object.assign(s2, { top: out[k][0], bottom: out[k][1], left: best.left, right: best.right }); delete s2.hx; } else if (edges[k]) Object.assign(s2, { top: out[k][0], bottom: out[k][1], left: edges[k][0], right: edges[k][1] }); else if (!same(out[k][0], s2.top) || !same(out[k][1], s2.bottom)) Object.assign(s2, { top: out[k][0], bottom: out[k][1] }); });          // the same boxes, so a turn stays with its Selection
  rr.systems = base.sort((x, y) => x.top - y.top); rr.full = false; rr.held = []; rr.heldTurns = []; SYS.rev++; stageDirty = true; sysSettle(); return true;
}
/* ---------- erasures: strokes a person brushed over one system's sheet, drawn in the video only ---------- */
/* A stroke is { r, p }: a brush radius in page heights and a line of points (x across and y down as fractions of the page, flat). It belongs to the Selection it was brushed on (box.er, never shared with the next system's sheet), is kept with the page's hand marks, and goes with the Selection. One stroke is one History step. */
function sysErase(idx, box, stroke) {
  const r0 = SYS.byPage.get(idx); if (!r0 || !r0.systems.includes(box) || !stroke || !stroke.p.length) return false;
  delete box.erLive; pushHistory(); sysHandRec(idx);
  box.er = (box.er || []).concat([stroke]);          // a new list each time: a History step keeps the one it had
  SYS.rev++; stageDirty = true; return true;
}
/* the name of a History step that changed the systems: Erase when only erasures changed */
function sysStepName(a, b) {
  const bare = m => JSON.stringify(m, (k, v) => k === 'er' ? undefined : v), has = m => m && m.systems.some(q => q.er && q.er.length), pages = [...new Set(Object.keys(a).concat(Object.keys(b)))];
  const only = pages.every(i => a[i] && b[i] ? bare(a[i]) === bare(b[i]) : has(a[i] || b[i]));          // a page that had no hand marks yet is one that has erasures now
  return only && JSON.stringify(a) !== JSON.stringify(b) ? tx('sys.erase.step') : 'Systems';
}
/* the paper beside a spot: the middle of the lightest quarter of a wide ring of dots around the brush (ink is darker than paper, and a mark bigger than the brush fills most of a near ring), so a clean page gives its exact white and a stained scan its own tone there. rr: the brush's radius in the page drawing's dots. */
function sysErSample(ent, cx, cy, rr) {
  const cv = ent.cv, R = Math.ceil(rr * 3.1) + 2, x0 = clamp(Math.floor(cx - R), 0, cv.width - 1), y0 = clamp(Math.floor(cy - R), 0, cv.height - 1), x1 = clamp(Math.ceil(cx + R), x0 + 1, cv.width), y1 = clamp(Math.ceil(cy + R), y0 + 1, cv.height), w = x1 - x0, h = y1 - y0;
  const d = cv.getContext('2d').getImageData(x0, y0, w, h).data, list = [];
  [1.25, 1.75, 2.4, 3.0].forEach((k, j) => { for (let a = 0; a < 14; a++) { const ang = a / 14 * 6.2832 + j * 0.45, X = Math.round(cx + Math.cos(ang) * rr * k) - x0, Y = Math.round(cy + Math.sin(ang) * rr * k) - y0; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const i = (Y * w + X) * 4; list.push([d[i], d[i + 1], d[i + 2]]); } });
  if (!list.length) return null;
  list.sort((p, q) => q[0] + q[1] + q[2] - p[0] - p[1] - p[2]);          // light to dark
  const top = list.slice(0, Math.max(1, list.length >> 2)), mid = c => { const v = top.map(q => q[c]).sort((p, q) => p - q); return v[v.length >> 1]; };
  return [mid(0), mid(1), mid(2)];
}
/* Draws a box's erasures on its sheet (c): along each stroke, round dabs of the paper sampled beside each point, feathered at the rim, inside the cut so the paper around the system is never patched. (x, y, f.dw, f.dh): where the system lies on the sheet; (sx, sy, sw, sh): the part of the page drawing it was cut from. */
function sysEraseDraw(c, ent, box, f, x, y, sx, sy, sw, sh, paper) {
  const list = (box.er || []).concat(box.erLive ? [box.erLive] : []); if (!list.length) return;
  const pw = ent.cv.width, ph = ent.cv.height, kx = f.dw / sw, ky = f.dh / sh; if (!ent.er) ent.er = new WeakMap();
  c.save(); c.beginPath(); c.rect(x, y, f.dw, f.dh); c.clip();
  list.forEach(t => {
    const n = t.p.length >> 1, rr = Math.max(2, t.r * ph); let k = ent.er.get(t); if (!k) { k = { n: 0, cols: [] }; ent.er.set(t, k); }
    for (let i = k.n; i < n; i++) k.cols[i] = sysErSample(ent, t.p[2 * i] * pw, t.p[2 * i + 1] * ph, rr); k.n = n;
    const rs = Math.max(1, t.r * ph * kx), dab = (X, Y, col) => { const g = c.createRadialGradient(X, Y, 0, X, Y, rs), a = 'rgba(' + col.join(',') + ','; g.addColorStop(0, a + '1)'); g.addColorStop(0.8, a + '1)'); g.addColorStop(1, a + '0)'); c.fillStyle = g; c.fillRect(X - rs, Y - rs, 2 * rs, 2 * rs); };
    const at = i => [(t.p[2 * i] * pw - sx) * kx + x, (t.p[2 * i + 1] * ph - sy) * ky + y], col = i => k.cols[i] || paper;
    for (let i = 0; i < n; i++) {
      const b = at(i); if (i) { const a = at(i - 1), ca = col(i - 1), cb = col(i), m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, rs * 0.3))); for (let q = 1; q < m; q++) { const u = q / m; dab(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, ca.map((v, j) => Math.round(v + (cb[j] - v) * u))); } }
      dab(b[0], b[1], col(i));
    }
  });
  c.restore();
}
/* a mark from top to bottom (page fractions), among the others */
async function sysMark(idx, a, b) {
  const r = SYS.byPage.get(idx), p = sysPush(r ? r.systems : [], 'new', 0, clamp(a, 0, 1), clamp(b, 0, 1));
  if (p.out[p.cur][1] - p.out[p.cur][0] < SYS_MINH) return null;
  return await sysPlace(idx, p.boxes, p.out) ? SYS.byPage.get(idx).systems.find(s => Math.abs(s.top - p.out[p.cur][0]) < 1e-9) : null;
}
function sysRemove(idx, box) { const r = SYS.byPage.get(idx); if (r && r.systems.includes(box)) sysCommit(idx, r.systems.filter(s => s !== box)); }
/* Detect this page again: the page shown returns to its automatic result, one History step */
async function sysRedetect(idx) {
  const was = SYS.byPage.get(idx), sig = r => r ? JSON.stringify([r.systems.map(q => [q.top, q.bottom, q.left, q.right].map(v => Math.round(v * 1e4))), !!r.full]) : '', s0 = sig(was), hand = SYS.hand.has(idx), rb = S.redo.slice();
  pushHistory(); SYS.hand.delete(idx); SYS.byPage.delete(idx); SYS.rev++; stageDirty = true;
  const r = await sysDetectPage(idx); SYS.rev++;
  if (r && !hand && sig(r) === s0) { SYS.byPage.set(idx, was); S.history.pop(); S.redo = rb; updateHistoryButtons(); stageDirty = true; return; }          // nothing changed: no History step, and the page keeps its Selections as they were
  if (r) sysSettle();
}

/* ---------- the sheet: one system alone on a full-frame sheet of the page's own paper ---------- */
const SYS_FEATHER = 3;          // dots over which the join between the page and the plain paper around it is softened
/* the widest system of the whole score, kept until what was found or the page list changes (it was worked out again on every paint) */
const SYS_WIDE = { key: '', v: 0 };
function sysWide() {
  const pa = S.pdf.aspect, k = [SYS.rev, SYS.gen, SYS.byPage.size, pa, S.pdf.keep.join(',')].join('|');
  if (SYS_WIDE.key === k) return SYS_WIDE.v;
  let wide = 0, any = 0; new Set(S.pdf.keep).forEach(i => { const r = SYS.byPage.get(i); if (r) r.systems.forEach(s => { const w = (s.right - s.left) * pa; any = Math.max(any, w); if (!s.hx) wide = Math.max(wide, w); }); });          // a system whose sides were set by hand shrinks alone and never sets the scale; a score with none found keeps the widest
  if (!wide) wide = any;
  SYS_WIDE.key = k; SYS_WIDE.v = wide; return wide;
}
/* one scale for the whole score (frame dots per page height), set by the widest system and the Page margin; a system too tall for the room
   left in the frame (the Letterbox band, when it is on, less twice the Margin above and below), shrinks alone. A page with no system is fitted whole. */
/* the height of the band the music has: the whole frame, or the 2.39:1 band between the Letterbox's bars. anim: the preview's bars while they slide (what is shown); otherwise the Letterbox as it is set (what every sheet is made for, and every export frame). */
const sysBandH = (W, H, anim) => H - (H - Math.min(H, W / 2.39)) * (anim ? LB.v : S.set.letterbox ? 1 : 0);
function sysFit(key, W, H, anim) {
  const idx = sysPage(key), pa = S.pdf.aspect, mx = S.set.margin / 100, band = sysBandH(W, H, anim), whole = { top: 0, bottom: 1, left: 0, right: 1 };
  const wide = sysWide();
  const sc = wide ? W * (1 - 2 * mx) / wide : W * (1 - 2 * mx) / pa, r = SYS.byPage.get(idx), list = r && r.systems.length ? r.systems : [whole];
  const box = list[Math.min(sysNo(key), list.length - 1)];
  const s = Math.min(sc, W * (1 - 2 * mx) / Math.max(1e-6, (box.right - box.left) * pa), band * Math.max(0.5, 1 - 4 * mx) / Math.max(1e-6, box.bottom - box.top));          // the room above and below follows the Margin too: 0.88 of the band's height is left at the default 3%
  return { box, s, dw: Math.max(2, Math.round((box.right - box.left) * pa * s)), dh: Math.max(2, Math.round((box.bottom - box.top) * s)) };
}
/* the paper: the median color of what is not ink inside the box (the one shared reading, `paperOf` in pdf-handling.js) */
const sysPaper = cv => paperOf(cv);
/* the paper of the whole score: the median of each active page's paper (the thumbnails, by the rule above), kept until the pages change. White until a thumbnail is in. */
const SYS_SP = { key: '', v: [255, 255, 255] };
function sysScorePaper() {
  const srcs = [...new Set(S.pdf.keep)].map(i => S.pdf.slots[i].src).filter(src => S.thumbs[src]), key = (S.pdf.gen || 0) + '|' + srcs.join(',');
  if (SYS_SP.key === key) return SYS_SP.v;
  const all = srcs.map(src => sysPaper(S.thumbs[src])), med = c => { const a = all.map(q => q[c]).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 255; };
  SYS_SP.key = key; SYS_SP.v = [med(0), med(1), med(2)]; return SYS_SP.v;
}
/* the paper of one sheet of the score: in System the system's own paper (read when the sheet was composed), else its page's paper (`pagePaper`); the back of a turning sheet is plain paper of this color */
function sheetPaper(key) {
  if (sysOn() && key >= 0) {
    const page = sysPage(key), r = SYS.byPage.get(page), ent = sysKept(page), list = r && r.systems.length ? r.systems : null;
    if (ent && list) { const b = list[Math.min(sysNo(key), list.length - 1)], p = ent.paper.get([b.left, b.top, b.right, b.bottom].join()); if (p) return p; }
    return pagePaper(page);
  }
  return pagePaper(key);
}
/* Each page is drawn from the PDF once per size and kept; every system on it, and every Margin or Letterbox change, is cut from that one drawing and never draws the page again.
   The store holds the page under the playhead and its neighbors: at most SYS_KEEP pages and SYS_KEEP_PX dots in all (the newest is always kept), the oldest used going first. */
const SYS_KEEP = 3, SYS_KEEP_PX = 48e6, SYS_PAGES = new Map(), SYS_DRAWING = new Map();
function sysPagesClear() { SYS_PAGES.forEach(e => { e.cv.width = e.cv.height = 0; }); SYS_PAGES.clear(); SYS_DRAWING.clear(); }
async function sysPageDraw(idx, s) {
  const sl = S.pdf.slots[idx], geo = sysGeo(sl), gen = S.pdf.gen || 0, e = SYS_PAGES.get(sl.src);
  if (e && e.geo === geo && e.gen === gen && e.s >= s * 0.999 && e.s <= s * 1.6) { SYS_PAGES.delete(sl.src); SYS_PAGES.set(sl.src, e); return e; }          // big enough to cut from, and not wastefully big
  const dk = sl.src + '|' + Math.round(s);
  if (SYS_DRAWING.has(dk)) return SYS_DRAWING.get(dk);
  const job = (async () => {
    const page = await S.pdf.doc.getPage(sl.src + 1), rot = page.rotate || 0, v1 = page.getViewport({ scale: 1, rotation: rot }), pa = S.pdf.aspect, vp = page.getViewport({ scale: pa * s / v1.width, rotation: rot });
    const cv = document.createElement('canvas'); cv.width = Math.max(2, Math.round(vp.width)); cv.height = Math.max(2, Math.round(vp.height));
    const x = cv.getContext('2d', { alpha: false }); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: x, viewport: vp, background: '#ffffff' }).promise;
    try { page.cleanup(); } catch (err) {}
    const ent = { cv, s, geo, gen, paper: new Map() };
    if (S.pdf.gen === gen && sysGeo(S.pdf.slots[idx] || sl) === geo) {
      const old = SYS_PAGES.get(sl.src); if (old && old !== ent) old.cv.width = old.cv.height = 0;
      SYS_PAGES.delete(sl.src); SYS_PAGES.set(sl.src, ent);
      let px = 0; SYS_PAGES.forEach(q => { px += q.cv.width * q.cv.height; });
      while (SYS_PAGES.size > 1 && (SYS_PAGES.size > SYS_KEEP || px > SYS_KEEP_PX)) { const k = SYS_PAGES.keys().next().value, q = SYS_PAGES.get(k); px -= q.cv.width * q.cv.height; q.cv.width = q.cv.height = 0; SYS_PAGES.delete(k); }
    }
    return ent;
  })();
  SYS_DRAWING.set(dk, job); job.then(() => SYS_DRAWING.delete(dk), () => SYS_DRAWING.delete(dk));
  return job;
}
/* a sheet: the system cut from its page's kept drawing (ent) and laid on the page's paper, its edges feathered into it. f: the fit it is made for. */
function sysCompose(ent, f, W, H, cv) {
  const box = f.box, pw = ent.cv.width, ph = ent.cv.height; let sx = box.left * pw, sy = box.top * ph, sw = Math.max(1, (box.right - box.left) * pw), sh = Math.max(1, (box.bottom - box.top) * ph);
  if (Math.abs(sw / f.dw - 1) < 0.004 && Math.abs(sh / f.dh - 1) < 0.004) { sx = clamp(Math.round(sx), 0, Math.max(0, pw - f.dw)); sy = clamp(Math.round(sy), 0, Math.max(0, ph - f.dh)); sw = Math.min(f.dw, pw); sh = Math.min(f.dh, ph); }          // drawn at this very size: a dot for a dot, so it is as sharp as a drawing made for it
  const pk = [box.left, box.top, box.right, box.bottom].join(); let paper = ent.paper.get(pk);
  if (!paper) {          // the paper is read from a small copy of the system, once per drawing
    const k = Math.min(1, 320 / sw), t = document.createElement('canvas'); t.width = Math.max(2, Math.round(sw * k)); t.height = Math.max(2, Math.round(sh * k));
    t.getContext('2d', { alpha: false }).drawImage(ent.cv, sx, sy, sw, sh, 0, 0, t.width, t.height); paper = sysPaper(t); t.width = t.height = 0; ent.paper.set(pk, paper);
  }
  if (!cv) { cv = document.createElement('canvas'); cv.width = W; cv.height = H; }
  const c = cv.getContext('2d', { alpha: false }), x = Math.round((W - f.dw) / 2), y = Math.round((H - f.dh) / 2), col = a => 'rgba(' + paper.join(',') + ',' + a + ')';
  c.fillStyle = col(1); c.fillRect(0, 0, W, H); c.imageSmoothingQuality = 'high'; c.drawImage(ent.cv, sx, sy, sw, sh, x, y, f.dw, f.dh);
  const F = Math.min(SYS_FEATHER, f.dw >> 2, f.dh >> 2);          // each edge fades into the paper around it, so an uneven scan shows no hard seam
  [[x, y, F, f.dh, x, 0, x + F, 0], [x + f.dw - F, y, F, f.dh, x + f.dw, 0, x + f.dw - F, 0], [x, y, f.dw, F, 0, y, 0, y + F], [x, y + f.dh - F, f.dw, F, 0, y + f.dh, 0, y + f.dh - F]].forEach(q => {
    const g = c.createLinearGradient(q[4], q[5], q[6], q[7]); g.addColorStop(0, col(1)); g.addColorStop(1, col(0)); c.fillStyle = g; c.fillRect(q[0], q[1], q[2], q[3]);
  });
  sysEraseDraw(c, ent, box, f, x, y, sx, sy, sw, sh, paper);          // what was brushed out of this system, so the preview, the Letterbox slide, and the export all show it
  return cv;
}
async function sysSheet(key, W, H) {
  await sysDetectAll();
  const idx = sysPage(key), f = sysFit(key, W, H), ent = await sysPageDraw(idx, f.s);
  return sysCompose(ent, f, W, H);
}
/* the kept drawing of a page, as it stands, with no waiting (null when there is none): the Letterbox's slide composes from it every frame */
function sysKept(idx) { const sl = S.pdf && S.pdf.slots[idx], e = sl && SYS_PAGES.get(sl.src); return e && e.geo === sysGeo(sl) && e.gen === (S.pdf.gen || 0) ? e : null; }
