/* The Audio Editor's tools for long recordings: noise reduction, Spectra, EQ and Imager worked out for any stretch of a recording, without ever holding all of it.
   The recording is read through a source ({ key, sr, ch, frames, read(start, n) }); the tools are stages, each reading from the one before it, and
   chain.read(start, n, exact) gives the processed frames start … start+n as { chans, exact }.
   The filters (EQ, Imager) and the noise reduction carry on from what came before, so the sound at one place depends on everything ahead of it. Two things make any place reachable:
   checkpoints (the state is kept every few seconds as a stage passes, and picked up again later) and a run-in (with no checkpoint near, a stage starts a few seconds early
   from rest; what is left of the difference is far below hearing, and the result is marked as not exact). With exact set, a stage always starts from a checkpoint.
   The sums follow the app's whole-file tools step for step, with the same rounding, so both give the same samples.
   No file or page access here: the same code runs in the disk store's worker, in a page, or in a check. */
(function (G) {
const NR_N = 2048, NR_H = 512, HALF = NR_N / 2, fr = Math.fround;
const NR_CK = 1024, NR_RUNIN = 128;          // noise reduction: a checkpoint every 1024 slices (~12s), a run-in of 128 slices (~1.4s: six times over what the memory of a slice lasts, and short enough that a change of setting while the sound plays is heard without a break)
const FX_CK = 1 << 18, FX_BLOCK = 1 << 14, FX_RUNIN = 5;          // filters: a checkpoint every 262144 frames, a run-in of five seconds
const IM_X1 = 250, IM_X2 = 4000;

/* ---------------- the short-time Fourier transform, the same as the app's ---------------- */
let nrT = null;
function nrTables() {
  if (nrT) return nrT; const n = NR_N, c = new Float64Array(n / 2), s = new Float64Array(n / 2), w = new Float64Array(n), r = new Uint16Array(n), bits = Math.round(Math.log(n) / Math.LN2);
  for (let i = 0; i < n / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n); s[i] = -Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) { w[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); let x = i, y = 0; for (let j = 0; j < bits; j++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; }
  return (nrT = { c, s, w, r });
}
function nrFFT(re, im, inv) {
  const n = NR_N, T = nrTables(); let i, j, k, len, half, step, a, b, wr, wi, xr, xi, t;
  if (inv) for (i = 0; i < n; i++) im[i] = -im[i];
  for (i = 0; i < n; i++) { j = T.r[i]; if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (len = 2; len <= n; len <<= 1) { half = len >> 1; step = n / len;
    for (i = 0; i < n; i += len) for (k = 0; k < half; k++) { a = i + k; b = a + half; wr = T.c[k * step]; wi = T.s[k * step]; xr = re[b] * wr - im[b] * wi; xi = re[b] * wi + im[b] * wr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
  if (inv) for (i = 0; i < n; i++) im[i] = -im[i];
}
/* two channels ride in one transform (left as the real part, right as the imaginary part); the power of the pair at bin k comes from bins k and N-k */
function nrPower(re, im, k, nch) { const k2 = (NR_N - k) % NR_N; return (re[k] * re[k] + im[k] * im[k] + re[k2] * re[k2] + im[k2] * im[k2]) / (2 * nch); }
/* the noise profile back as power at every bin */
function nrBins(prof, sr, axis) {
  const n = NR_N, out = new Float64Array(n / 2 + 1), last = axis.length - 1; let j = 0;
  for (let k = 0; k <= n / 2; k++) {
    const f = Math.max(axis[0], k * sr / n); while (j < last - 1 && axis[j + 1] < f) j++;
    let t = f >= axis[last] ? 1 : (Math.log(f / axis[j]) / Math.log(axis[j + 1] / axis[j])); t = t < 0 ? 0 : t > 1 ? 1 : t; out[k] = Math.pow(10, (prof[j] + (prof[j + 1] - prof[j]) * t) / 10);
  }
  return out;
}
const frameCount = len => Math.ceil((len + NR_N) / NR_H) + 1;
/* the frames s … e of the stage before, with silence standing in for anything before the start or after the end of the recording */
async function span(up, s, e, len, exact) {
  const a = Math.max(0, s), b = Math.min(len, e); if (b <= a) return { org: a, n: 0, chans: [], exact: true };
  const r = await up.read(a, b - a, exact); return { org: a, n: b - a, chans: r.chans, exact: r.exact };
}
function fill(sp, start, re, im, w) {
  const a = sp.chans[0], b = sp.chans.length > 1 ? sp.chans[1] : null, n = sp.n, off = start - sp.org;
  for (let i = 0; i < NR_N; i++) { const p = off + i; if (p >= 0 && p < n) { re[i] = a[p] * w[i]; im[i] = b ? b[p] * w[i] : 0; } else { re[i] = 0; im[i] = 0; } }
}

/* ---------------- noise reduction, Natural: two sizes of slice ----------------
   Low and middle frequencies are judged in slices of 2048 samples (fine in pitch, so the notes of a chord are told apart from the hiss between them); the highs, above ~4kHz, in slices of 512
   (fine in time, so the start of a note is caught four times sooner and no hiss opens up ahead of it). The two are joined by a smooth crossover from 2.8 to 5.6kHz whose two sides add to one.
   These functions use nothing outside themselves, so the same text runs here, in the disk store's worker and in the page's own worker (index.html puts them into its noise code). */
function nrTab(n) {
  const M = nrTab.m || (nrTab.m = {}); if (M[n]) return M[n]; const c = new Float64Array(n / 2), s = new Float64Array(n / 2), w = new Float64Array(n), r = new Uint16Array(n), bits = Math.round(Math.log(n) / Math.LN2);
  for (let i = 0; i < n / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n); s[i] = -Math.sin(2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) { w[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); let x = i, y = 0; for (let j = 0; j < bits; j++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; }
  return (M[n] = { n, c, s, w, r });
}
function nrFFTn(re, im, inv, T) {
  const n = T.n, c = T.c, s = T.s, r = T.r; let i, j, k, len, half, step, a, b, wr, wi, xr, xi, t;
  if (inv) for (i = 0; i < n; i++) im[i] = -im[i];
  for (i = 0; i < n; i++) { j = r[i]; if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (len = 2; len <= n; len <<= 1) { half = len >> 1; step = n / len;
    for (i = 0; i < n; i += len) for (k = 0; k < half; k++) { a = i + k; b = a + half; wr = c[k * step]; wi = s[k * step]; xr = re[b] * wr - im[b] * wi; xi = re[b] * wi + im[b] * wr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
  if (inv) for (i = 0; i < n; i++) im[i] = -im[i];
}
/* the noise profile as power at every bin of a slice of n samples (a shorter slice gathers less of the noise, in proportion) */
function nrBinsN(prof, sr, axis, n, times) {
  const out = new Float64Array(n / 2 + 1), last = axis.length - 1, sc = times * n / 2048; let j = 0;
  for (let k = 0; k <= n / 2; k++) {
    const f = Math.max(axis[0], k * sr / n); while (j < last - 1 && axis[j + 1] < f) j++;
    let t = f >= axis[last] ? 1 : (Math.log(f / axis[j]) / Math.log(axis[j + 1] / axis[j])); t = t < 0 ? 0 : t > 1 ? 1 : t; out[k] = sc * Math.pow(10, (prof[j] + (prof[j + 1] - prof[j]) * t) / 10);
  }
  return out;
}
/* p: { reduction, sensitivity, smoothing }. Sensitivity sets how much of the profile counts as noise (1 to 3 times), Smoothing how slowly the estimate moves (0.92 to 0.99 a slice) */
function nrNatSetup(prof, sr, axis, p, nch) {
  const N = 2048, M = 512, sm = p.smoothing / 100, bias = 1 + p.sensitivity / 100 * 2, hi = f => f <= 2800 ? 0 : f >= 5600 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * Math.log(f / 2800) / Math.LN2), mL = new Float64Array(N / 2 + 1), mS = new Float64Array(M / 2 + 1);
  for (let k = 0; k <= N / 2; k++) mL[k] = 1 - hi(k * sr / N); for (let k = 0; k <= M / 2; k++) mS[k] = hi(k * sr / M);
  return { nch, floorG: Math.pow(10, -p.reduction / 20), aS: 0.92 + sm * 0.07, noiseL: nrBinsN(prof, sr, axis, N, bias), noiseS: nrBinsN(prof, sr, axis, M, bias), mL, mS, TL: nrTab(N), TS: nrTab(M),
    re: new Float64Array(N), im: new Float64Array(N), rs: new Float64Array(M), is: new Float64Array(M), g: new Float64Array(N / 2 + 1), size: N / 2 + 1 + M / 2 + 1 };
}
/* the gain of every frequency of one slice (a Wiener gain from how far the sound stands above the noise, leaning on the slice before; when a note starts, a level well clear of both the noise and the slice before, it lets go of that memory).
   gs, from 'off' on, holds how far the cleaned sound stood above the noise a slice ago */
function nrNatGain(re, im, n, nch, noise, floorG, aS, gs, off, g) {
  const h = n >> 1; for (let k = 0; k <= h; k++) {
    const k2 = (n - k) % n, gam = (re[k] * re[k] + im[k] * im[k] + re[k2] * re[k2] + im[k2] * im[k2]) / (2 * nch) / (noise[k] + 1e-30), inst = gam > 1 ? gam - 1 : 0, c = gs[off + k], a = inst > 8 * c + 12 ? 0.5 : aS, xi = a * c + (1 - a) * inst; let G = xi / (1 + xi); if (G < floorG) G = floorG;
    g[k] = G; gs[off + k] = Math.min(1e9, G * G * gam);
  }
}
/* one step: xa (and xb, the second channel, or null) are the 2048 samples of the long slice; the four short slices end within its last 512 samples. ya (yb) get what the step adds to the sound over those 2048 samples.
   quiet: only the memory in gs is moved on (a run-in) */
function nrNatStep(K, xa, xb, gs, ya, yb, quiet) {
  const N = 2048, M = 512, TL = K.TL, TS = K.TS, re = K.re, im = K.im, rs = K.rs, is = K.is, g = K.g, w = TL.w, ws = TS.w, mL = K.mL, mS = K.mS;
  for (let i = 0; i < N; i++) { re[i] = xa[i] * w[i]; im[i] = xb ? xb[i] * w[i] : 0; }
  nrFFTn(re, im, false, TL); nrNatGain(re, im, N, K.nch, K.noiseL, K.floorG, K.aS, gs, 0, g);
  if (!quiet) {
    for (let k = 0; k < N; k++) { const kk = k <= N / 2 ? k : N - k, v = g[kk] * mL[kk]; re[k] *= v; im[k] *= v; }
    nrFFTn(re, im, true, TL); for (let i = 0; i < N; i++) { ya[i] = re[i] * w[i] * 0.5 / N; if (yb) yb[i] = im[i] * w[i] * 0.5 / N; }
  }
  for (let q = 0; q < 4; q++) {
    const o = N - 896 + q * 128; for (let i = 0; i < M; i++) { rs[i] = xa[o + i] * ws[i]; is[i] = xb ? xb[o + i] * ws[i] : 0; }
    nrFFTn(rs, is, false, TS); nrNatGain(rs, is, M, K.nch, K.noiseS, K.floorG, K.aS, gs, N / 2 + 1, g);
    if (quiet) continue;
    for (let k = 0; k < M; k++) { const kk = k <= M / 2 ? k : M - k, v = g[kk] * mS[kk]; rs[k] *= v; is[k] *= v; }
    nrFFTn(rs, is, true, TS); for (let i = 0; i < M; i++) { ya[o + i] += rs[i] * ws[i] * 0.5 / M; if (yb) yb[o + i] += is[i] * ws[i] * 0.5 / M; }
  }
}

/* ---------------- the noise floor of a whole recording (the noise tool's Auto) ----------------
   No stretch of noise alone is needed. The recording is read in order, in slices of 2048 (four at a time, averaged: ~0.17s), and for every frequency of the profile a count is kept of how loud those moments were.
   Music comes and goes at any one frequency while the hiss underneath is always there, so the level that the quietest moments share is the noise: the level only one moment in forty falls under is read off,
   and raised by what steady noise itself would fall short by in such a reading (known from how many separate readings each moment averages). Last, each frequency takes the lower of what its neighbors a quarter octave
   either side agree on, so a note held through the whole recording does not pass for noise. Feed it with push(chans, n); profile() gives dB at the axis, in the same measure as a learned stretch, or null when there is too little to go on. */
function NoiseFloor(sr, nch, axis) {
  const n = 2048, bw = Math.pow(2, 1 / 24), binHz = sr / n; this.nch = nch; this.T = nrTab(n); this.lo = []; this.hi = []; this.na = axis.length;
  this.w = this.T.w;
  axis.forEach(f => { let lo = Math.max(1, Math.floor(f / bw / binHz)), hi = Math.min(n / 2, Math.ceil(f * bw / binHz)); if (hi < lo) lo = hi = Math.min(n / 2, Math.max(1, Math.round(f / binHz))); this.lo.push(lo); this.hi.push(hi); });
  this.hist = new Uint32Array(this.na * 720); this.acc = new Float64Array(n / 2 + 1); this.cnt = 0; this.blocks = 0; this.at = 0; this.held = []; for (let c = 0; c < nch; c++) this.held.push(new Float32Array(n)); this.re = new Float64Array(n); this.im = new Float64Array(n);
}
NoiseFloor.prototype.push = function (chans, len) {
  const n = 2048, w = this.w, re = this.re, im = this.im, acc = this.acc, nch = this.nch; let p = 0;
  while (p < len) {
    const take = Math.min(n - this.at, len - p); for (let c = 0; c < nch; c++) this.held[c].set(chans[Math.min(c, chans.length - 1)].subarray(p, p + take), this.at); this.at += take; p += take; if (this.at < n) break; this.at = 0;
    const a = this.held[0], b = nch > 1 ? this.held[1] : null; for (let i = 0; i < n; i++) { re[i] = a[i] * w[i]; im[i] = b ? b[i] * w[i] : 0; } nrFFTn(re, im, false, this.T);
    for (let k = 0; k <= n / 2; k++) { const k2 = (n - k) % n; acc[k] += (re[k] * re[k] + im[k] * im[k] + re[k2] * re[k2] + im[k2] * im[k2]) / (2 * nch); }
    if (++this.cnt < 4) continue; this.cnt = 0; let tot = 0; for (let k = 0; k <= n / 2; k++) tot += acc[k];
    if (tot / 4 > 1e-9) { for (let i = 0; i < this.na; i++) { let s = 0; for (let k = this.lo[i]; k <= this.hi[i]; k++) s += acc[k]; const d = 10 * Math.log10(s / (4 * (this.hi[i] - this.lo[i] + 1)) + 1e-20), j = Math.round((d + 160) * 4); this.hist[i * 720 + (j < 0 ? 0 : j > 719 ? 719 : j)]++; } this.blocks++; }          // digital silence (a file padded with zeros) is not noise
    acc.fill(0);
  }
};
NoiseFloor.prototype.profile = function () {
  if (this.blocks < 48) return null; const P = 1 / 40, z = -1.9600, want = this.blocks * P, raw = new Float64Array(this.na);
  for (let i = 0; i < this.na; i++) {
    let run = 0, j = 0; const h = this.hist, o = i * 720; for (; j < 720; j++) { if (run + h[o + j] >= want) break; run += h[o + j]; } const d = (j + (h[o + j] ? (want - run) / h[o + j] : 0) - 0.5) / 4 - 160;
    const dof = 4 * this.nch * Math.max(1, (this.hi[i] - this.lo[i] + 1) / 1.5), q = Math.pow(1 - 1 / (9 * dof) + z * Math.sqrt(1 / (9 * dof)), 3);          // how far below its average the same reading of steady noise falls (Wilson and Hilferty's rule for an average of 'dof' separate readings)
    raw[i] = d - 10 * Math.log10(Math.max(0.02, q));
  }
  const out = new Array(this.na), env = new Float64Array(this.na), R = 6;
  for (let i = 0; i < this.na; i++) { const v = []; for (let k = Math.max(0, i - R); k <= Math.min(this.na - 1, i + R); k++) v.push(raw[k]); v.sort((x, y) => x - y); env[i] = Math.min(raw[i], v[Math.floor((v.length - 1) * 0.4)]); }
  for (let i = 0; i < this.na; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - 2); k <= Math.min(this.na - 1, i + 2); k++) { s += env[k]; c++; } out[i] = Math.round(s / c * 10) / 10; }
  return out;
};

/* ---------------- mains hum ----------------
   A steady hum from the mains sits at 50 or 60Hz and at whole multiples of it. HumFind looks for it: slices of ~0.7s from all over the recording, and for every frequency up to 1.3kHz the level that the quieter
   fifth of the slices share (a note comes and goes; the hum is in every slice). A hum shows there as thin spikes at whole multiples of one frequency; the frequency that gathers the most such spikes, near 50 or 60Hz, is taken,
   read off to a hundredth of a hertz from the spikes themselves. The hum's own frequency or twice it must be among them (no note of the usual tuning sits within 0.6Hz of 50, 60, 100 or 120Hz). Give it whole slices with push(chans) (size: this.n frames); find() gives { f, n: [the multiples that are there] } or null.
   Removing it is a row of very narrow notches (humBands: ~1.2Hz wide at the bottom, a little wider further up, where the mains' own wander is multiplied), run ahead of the noise reduction. */
function HumFind(sr, nch) {
  this.sr = sr; this.nch = nch; this.n = sr <= 50000 ? 32768 : 65536; this.T = nrTab(this.n); this.km = Math.min(this.n / 2 - 1, Math.ceil(1300 / (sr / this.n)) + 40); this.rows = [];
  this.w = new Float64Array(this.n); for (let i = 0; i < this.n; i++) this.w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / this.n); this.re = new Float64Array(this.n); this.im = new Float64Array(this.n);
}
HumFind.prototype.push = function (chans) {
  const n = this.n, re = this.re, im = this.im, w = this.w, row = new Float32Array(this.km + 1), a = chans[0], b = this.nch > 1 && chans[1] ? chans[1] : null; if (a.length < n) return;
  for (let i = 0; i < n; i++) { re[i] = a[i] * w[i]; im[i] = b ? b[i] * w[i] : 0; } nrFFTn(re, im, false, this.T); let tot = 0;
  for (let k = 0; k <= this.km; k++) { const k2 = (n - k) % n, p = re[k] * re[k] + im[k] * im[k] + re[k2] * re[k2] + im[k2] * im[k2]; row[k] = p; tot += p; }
  if (tot > 1e-9) this.rows.push(row);
};
HumFind.prototype.find = function () {
  const R = this.rows.length, km = this.km, hz = this.sr / this.n; if (R < 6) return null; const Q = new Float64Array(km + 1), col = new Float32Array(R), pick = Math.floor((R - 1) * 0.2);
  for (let k = 0; k <= km; k++) { for (let r = 0; r < R; r++) col[r] = this.rows[r][k]; col.sort(); Q[k] = 10 * Math.log10(col[pick] + 1e-30); }
  /* how far a frequency stands above its surroundings (the middle level of the bins 6 to 30 away on both sides), and exactly where its spike is */
  const side = new Float64Array(50), spike = f => { const k = Math.round(f / hz); if (k < 3 || k + 31 > km) return null; let kp = k; if (Q[k - 1] > Q[kp]) kp = k - 1; if (Q[k + 1] > Q[kp]) kp = k + 1; let c = 0; for (let d = 6; d <= 30; d++) { if (kp - d >= 1) side[c++] = Q[kp - d]; side[c++] = Q[kp + d]; }
    const sd = side.subarray(0, c).slice().sort(), a = Q[kp - 1], b = Q[kp], g = Q[kp + 1], den = a - 2 * b + g, off = den < 0 ? 0.5 * (a - g) / den : 0; return { up: b - sd[c >> 1], f: (kp + Math.max(-0.5, Math.min(0.5, off))) * hz }; };
  let best = null; const tol = Math.max(0.5, hz * 0.35);          // a spike counts only when it sits on the multiple, to half a hertz
  for (const base of [50, 60]) for (let f0 = base - 0.6; f0 <= base + 0.6001; f0 += 0.02) { let sc = 0, cnt = 0, low = false; for (let h = 1; h * f0 < 1250 && h <= 24; h++) { const s = spike(h * f0); if (s && s.up >= 9 && Math.abs(s.f - h * f0) < tol) { sc += s.up; cnt++; if (h <= 2) low = true; } } if (low && (!best || sc > best.sc)) best = { f0, sc, cnt }; }          // a hum always has its own frequency or twice it; spikes only higher up are the overtones of a held note
  if (!best || !(best.cnt >= 2 && best.sc >= 30) && !(best.cnt >= 1 && best.sc >= 22)) return null;
  let num = 0, den = 0; const n = []; for (let h = 1; h * best.f0 < 1250 && h <= 24; h++) { const s = spike(h * best.f0); if (s && s.up >= 9 && Math.abs(s.f - h * best.f0) < tol) { n.push(h); num += s.f * s.up; den += h * s.up; } }          // every spike says where the hum is; the higher ones say it more exactly
  const f = n.length ? Math.round(num / den * 100) / 100 : 0; return n.length && Math.min(Math.abs(f - 50), Math.abs(f - 60)) <= 0.6 ? { f, n } : null;          // read exactly, it must still be a mains frequency
};
const humBands = hum => hum.n.map(h => ({ type: 'notch', f: hum.f * h, g: 0, q: hum.f * h / Math.max(1.2, 0.012 * hum.f * h), on: true }));
/* the notches over whole channels, in place: the sums the filter stage runs (a recording in memory is cleaned by these, one on the disk store by the stage) */
function nrHum(chans, coefs, st) {          // st: the filters' memory (four numbers for each notch of each channel), to carry on from one block to the next; without it they start from rest
  for (let c = 0; c < chans.length; c++) for (let j = 0; j < coefs.length; j++) { const x = chans[c], k = coefs[j], b0 = k[0], b1 = k[1], b2 = k[2], a1 = k[3], a2 = k[4], o = (c * coefs.length + j) * 4; let x1 = st ? st[o] : 0, x2 = st ? st[o + 1] : 0, y1 = st ? st[o + 2] : 0, y2 = st ? st[o + 3] : 0;
    for (let i = 0; i < x.length; i++) { const v = x[i], y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = y; }
    if (st) { st[o] = x1; st[o + 1] = x2; st[o + 2] = y1; st[o + 3] = y2; } }
}

/* ---------------- noise reduction ----------------
   Slice f covers the frames f*512-2048 … f*512, so every frame lies in four slices. What carries over from slice to slice is one number per frequency: the smoothed gain (Classic),
   or how far the cleaned sound stood above the noise in the slice before (Natural, which judges each slice by that as well as by the slice itself, so hiss is not left chirping; it also works the highs in short slices, see above,
   so its memory is one number for every frequency of the long slice and one for every frequency of the short). */
function Noise(up, src, p, axis) {
  this.up = up; this.len = src.frames; this.nch = src.ch; this.frames = frameCount(src.frames); this.noise = nrBins(p.profile, src.sr, axis);
  const sm = p.smoothing / 100; this.floorG = Math.pow(10, -p.reduction / 20); this.alpha = 2 + p.sensitivity / 100 * 4; this.bDown = sm * 0.92; this.bUp = this.bDown * 0.3; this.fw = sm > 0.66 ? 2 : sm > 0.25 ? 1 : 0;
  this.nat = p.mode === 'natural'; this.K = this.nat ? nrNatSetup(p.profile, src.sr, axis, p, src.ch) : null; this.size = this.nat ? this.K.size : HALF + 1;
  this.cks = new Map([[0, new Float64Array(this.size).fill(1)]]); this.resume = null;
}
/* where to start so that slice f can be worked out: the place it left off, the nearest checkpoint before it, or a run-in from rest */
Noise.prototype.pick = function (f, exact) {
  let at = Math.floor(f / NR_CK) * NR_CK; while (!this.cks.has(at)) at -= NR_CK;
  let st = { f: at, gs: new Float64Array(this.cks.get(at)), exact: true };
  const r = this.resume; if (r && r.f <= f && r.f >= st.f && (r.exact || !exact)) st = { f: r.f, gs: new Float64Array(r.gs), exact: r.exact };
  if (!exact && f - st.f > NR_RUNIN) st = { f: f - NR_RUNIN, gs: new Float64Array(this.size).fill(1), exact: false };
  return st;
};
Noise.prototype.read = async function (a, n, exact) {
  const len = this.len, N = NR_N, hop = NR_H, nch = this.nch, T = nrTables(); a = Math.max(0, a); const b = Math.min(len, a + n); n = Math.max(0, b - a);
  const out = []; for (let c = 0; c < nch; c++) out.push(new Float32Array(n)); if (!n) return { chans: out, exact: true };
  const fA = Math.floor(a / hop) + 1, fB = Math.min(this.frames - 1, Math.floor((b - 1 + N) / hop)), fNext = Math.floor(b / hop) + 1, st = this.pick(fA, exact), gs = st.gs;
  const re = new Float64Array(N), im = new Float64Array(N), g = new Float64Array(HALF + 1), g2 = new Float64Array(HALF + 1), { noise, floorG, alpha, bDown, bUp, fw, nat, K } = this, scale = 0.5, xa = nat ? new Float32Array(N) : null, xb = nat && nch > 1 ? new Float32Array(N) : null, ya = nat ? new Float64Array(N) : null, yb = xb ? new Float64Array(N) : null;
  let ok = st.exact, f = st.f;
  while (f <= fB) {
    const last = Math.min(fB, f + 127), sp = await span(this.up, f * hop - N, last * hop, len, exact); if (!sp.exact) ok = false;
    for (; f <= last; f++) {
      if (ok && f % NR_CK === 0 && !this.cks.has(f)) this.cks.set(f, new Float64Array(gs));
      if (f === fNext) this.resume = { f, gs: new Float64Array(gs), exact: ok };
      const start = f * hop - N;
      if (nat) {          // Natural: the long slice and its four short ones
        const off = start - sp.org, c0 = sp.chans[0], c1 = xb ? sp.chans[1] : null, m = sp.n; for (let i = 0; i < N; i++) { const q = off + i, in_ = q >= 0 && q < m; xa[i] = in_ ? c0[q] : 0; if (xb) xb[i] = in_ ? c1[q] : 0; }
        nrNatStep(K, xa, xb, gs, ya, yb, f < fA); if (f < fA) continue;
        const i0 = Math.max(0, a - start), i1 = Math.min(N, b - start), o0 = out[0], o1 = xb ? out[1] : null; for (let i = i0; i < i1; i++) { const o = start + i - a; o0[o] += ya[i]; if (o1) o1[o] += yb[i]; }
        continue;
      }
      fill(sp, start, re, im, T.w); nrFFT(re, im, false);
      {
      for (let k = 0; k <= HALF; k++) { const P = nrPower(re, im, k, nch), G2 = 1 - alpha * noise[k] / (P + 1e-30); g[k] = G2 <= floorG * floorG ? floorG : Math.sqrt(G2); }
      if (fw) for (let k = 0; k <= HALF; k++) { let s = 0, cnt = 0; for (let i = k - fw; i <= k + fw; i++) if (i >= 0 && i <= HALF) { s += g[i]; cnt++; } g2[k] = s / cnt; } else for (let k = 0; k <= HALF; k++) g2[k] = g[k];
      for (let k = 0; k <= HALF; k++) { const v = g2[k]; gs[k] = v > gs[k] ? gs[k] * bUp + v * (1 - bUp) : gs[k] * bDown + v * (1 - bDown); }
      }
      if (f < fA) continue;          // still running in: only the gains are needed
      for (let k = 0; k < N; k++) { const gain = gs[k <= HALF ? k : N - k]; re[k] *= gain; im[k] *= gain; }
      nrFFT(re, im, true);
      const i0 = Math.max(0, a - start), i1 = Math.min(N, b - start), o0 = out[0], o1 = nch > 1 ? out[1] : null;
      for (let i = i0; i < i1; i++) { const o = start + i - a; o0[o] += re[i] * T.w[i] * scale / N; if (o1) o1[o] += im[i] * T.w[i] * scale / N; }
    }
  }
  if (f === fNext) this.resume = { f, gs: new Float64Array(gs), exact: ok };
  return { chans: out, exact: ok };
};

/* ---------------- Spectra ----------------
   Rectangles on the spectrogram, turned down or healed. Each one only touches the slices near it, and nothing carries over, so a stretch needs just the rectangles that reach into it.
   A short blip is healed from the sound before and after it; those two readings are taken once per rectangle and kept. */
function Spectra(up, src, edits) { this.up = up; this.len = src.frames; this.sr = src.sr; this.nch = src.ch; this.edits = edits; this.frames = frameCount(src.frames); this.sides = new Map(); }
Spectra.prototype.around = async function (centre, dir, exact) {
  const sr = this.sr, len = this.len, T = nrTables(), out = new Float64Array(HALF + 1), re = new Float64Array(NR_N), im = new Float64Array(NR_N); let ok = true;
  for (let j = 0; j < 3; j++) {
    const c = Math.min(len / sr - HALF / sr, Math.max(HALF / sr, centre + dir * j * 2 * NR_H / sr)), start = Math.round(c * sr) - HALF, sp = await span(this.up, start, start + NR_N, len, exact); if (!sp.exact) ok = false;
    fill(sp, start, re, im, T.w); nrFFT(re, im, false); for (let k = 0; k <= HALF; k++) out[k] += nrPower(re, im, k, this.nch) + 1e-20;
  }
  for (let k = 0; k <= HALF; k++) out[k] = Math.log(out[k] / 3);
  return { out, ok };
};
Spectra.prototype.read = async function (a, n, exact) {
  const len = this.len, N = NR_N, hop = NR_H, sr = this.sr, nch = this.nch, T = nrTables(), binHz = sr / N, F = 2 * hop / sr, scale = 0.5; a = Math.max(0, a); const b = Math.min(len, a + n); n = Math.max(0, b - a);
  const base = await this.up.read(a, n, exact); if (!n) return base;
  const fA = Math.floor(a / hop) + 1, fB = Math.min(this.frames - 1, Math.floor((b - 1 + N) / hop)); let d = null, ok = base.exact;
  const re = new Float64Array(N), im = new Float64Array(N), dg = new Float64Array(HALF + 1);
  for (let e = 0; e < this.edits.length; e++) {
    const ed = this.edits[e], ea = ed.a, eb = ed.b, k0 = Math.max(1, Math.floor(ed.f0 / binHz)), k1 = Math.min(HALF - 1, Math.ceil(ed.f1 / binHz)); if (k1 < k0 || eb <= ea) continue;
    const heal = ed.mode !== 'cut', cutG = Math.pow(10, -(ed.db || 24) / 20), fb = Math.max(2, Math.round((k1 - k0) * 0.08)), byTime = heal && (eb - ea) * sr / hop < k1 - k0 + 1;
    const f0 = Math.max(fA, Math.max(0, Math.ceil(((ea - F) * sr + N - HALF) / hop))), f1 = Math.min(fB, Math.min(this.frames - 1, Math.floor(((eb + F) * sr + N - HALF) / hop))); if (f1 < f0) continue;
    let La = null, Lb = null;
    if (byTime) {
      let s = this.sides.get(e);
      if (!s || (exact && !s.ok)) { const x = await this.around(ea - F - HALF / sr, -1, exact), y = await this.around(eb + F + HALF / sr, 1, exact); s = { La: x.out, Lb: y.out, ok: x.ok && y.ok }; this.sides.set(e, s); }
      La = s.La; Lb = s.Lb; if (!s.ok) ok = false;
    }
    const sp = await span(this.up, f0 * hop - N, f1 * hop, len, exact); if (!sp.exact) ok = false;
    if (!d) { d = []; for (let c = 0; c < nch; c++) d.push(new Float32Array(n)); }
    for (let f = f0; f <= f1; f++) {
      const start = f * hop - N, tc = (start + HALF) / sr, mt = tc < ea ? 1 - (ea - tc) / F : tc > eb ? 1 - (tc - eb) / F : 1; if (mt <= 0) continue;
      fill(sp, start, re, im, T.w); nrFFT(re, im, false);
      for (let k = 0; k <= HALF; k++) dg[k] = 0;
      const lo = Math.max(1, k0 - fb), hi = Math.min(HALF - 1, k1 + fb), u = byTime ? Math.min(1, Math.max(0, (tc - ea) / (eb - ea))) : 0; let la = 0, lb = 0;
      if (heal && !byTime) { let pl = 0, ph = 0, w = 0; for (let i = 1; i <= 3; i++) { pl += Math.log(nrPower(re, im, Math.max(1, k0 - i), nch) + 1e-20); ph += Math.log(nrPower(re, im, Math.min(HALF - 1, k1 + i), nch) + 1e-20); w++; } la = pl / w; lb = ph / w; }
      for (let k = lo; k <= hi; k++) {
        const mf = k < k0 ? 1 - (k0 - k) / (fb + 1) : k > k1 ? 1 - (k - k1) / (fb + 1) : 1, m = mt * mf; let g;
        if (!heal) g = cutG;
        else { const P = nrPower(re, im, k, nch) + 1e-20, lt = byTime ? La[k] * (1 - u) + Lb[k] * u : la + (lb - la) * ((k - k0) / Math.max(1, k1 - k0)); g = Math.min(1, Math.sqrt(Math.exp(lt) / P)); }
        dg[k] = -m * (1 - g);
      }
      for (let k = 0; k < N; k++) { const kk = k <= HALF ? k : N - k; re[k] *= dg[kk]; im[k] *= dg[kk]; }
      nrFFT(re, im, true);
      const i0 = Math.max(0, a - start), i1 = Math.min(N, b - start), d0 = d[0], d1 = nch > 1 ? d[1] : null;
      for (let i = i0; i < i1; i++) { const o = start + i - a; d0[o] += re[i] * T.w[i] * scale / N; if (d1) d1[o] += im[i] * T.w[i] * scale / N; }
    }
  }
  if (!d) return { chans: base.chans, exact: ok };
  const out = []; for (let c = 0; c < nch; c++) { const arr = new Float32Array(n), s0 = base.chans[c], dc = d[c]; for (let i = 0; i < n; i++) arr[i] = s0[i] + dc[i]; out.push(arr); }
  return { chans: out, exact: ok };
};

/* some blocks of a stage's result kept at hand: for a next stage that reads here and there (Spectra reads around each rectangle), and so that the cleaned-up sound around the playhead
   is still there when an EQ or Imager setting changes (the filters then start a few seconds back without the noise reduction being worked out again) */
/* the noise only: what the noise stage took away (the sound as it is, less what it left) */
function Removed(up, src) { this.up = up; this.src = src; }
Removed.prototype.read = async function (a, n, exact) {
  const r = await this.up.read(a, n, exact), len = r.chans[0].length, o = await this.src.read(Math.max(0, a), len), out = [];
  for (let c = 0; c < r.chans.length; c++) { const d = new Float32Array(len), x = o[c], y = r.chans[c]; for (let i = 0; i < len; i++) d[i] = x[i] - y[i]; out.push(d); }
  return { chans: out, exact: r.exact };
};
function Kept(up, src, max) { this.up = up; this.len = src.frames; this.nch = src.ch; this.B = 1 << 15; this.max = max || 12; this.blocks = new Map(); }
Kept.prototype.read = async function (a, n, exact) {
  const B = this.B; a = Math.max(0, a); const b = Math.min(this.len, a + n); n = Math.max(0, b - a);
  const out = []; for (let c = 0; c < this.nch; c++) out.push(new Float32Array(n)); let ok = true;
  for (let k = Math.floor(a / B); k * B < b; k++) {
    let blk = this.blocks.get(k);
    if (!blk || (exact && !blk.exact)) blk = await this.up.read(k * B, B, exact);
    this.blocks.delete(k); this.blocks.set(k, blk); while (this.blocks.size > this.max) this.blocks.delete(this.blocks.keys().next().value);
    if (!blk.exact) ok = false;
    const s = Math.max(a, k * B), e = Math.min(b, (k + 1) * B); for (let c = 0; c < this.nch; c++) out[c].set(blk.chans[c].subarray(s - k * B, e - k * B), s - a);
  }
  return { chans: out, exact: ok };
};

/* ---------------- EQ and Imager ----------------
   The same filters the browser's own audio nodes use (the formulas are in the Web Audio standard), wired the way the app wires its nodes, with a single-precision result after every step as there. */
function bqCoef(type, f, q, gain, sr) {
  const x = Math.min(1, Math.max(0, fr(f) / (sr / 2))), w0 = Math.PI * x, k = Math.cos(w0), sn = Math.sin(w0), A = Math.pow(10, fr(gain) / 40);
  const unit = v => [v, 0, 0, 0, 0], nz = (b0, b1, b2, a0, a1, a2) => { const i = 1 / a0; return [b0 * i, b1 * i, b2 * i, a1 * i, a2 * i]; };
  if (type === 'lowpass' || type === 'highpass') {
    const lp = type === 'lowpass'; if (x === 1) return unit(lp ? 1 : 0); if (x === 0) return unit(lp ? 0 : 1);
    const alpha = sn / (2 * Math.pow(10, fr(20 * Math.log10(q)) / 20)), beta = lp ? (1 - k) / 2 : (1 + k) / 2;
    return nz(beta, lp ? 2 * beta : -2 * beta, beta, 1 + alpha, -2 * k, 1 - alpha);
  }
  if (type === 'lowshelf' || type === 'highshelf') {
    const lo = type === 'lowshelf'; if (x === 1) return unit(lo ? A * A : 1); if (x === 0) return unit(lo ? 1 : A * A);
    const alpha = 0.5 * sn * Math.sqrt(2), k2 = 2 * Math.sqrt(A) * alpha, p = A + 1, m = A - 1;
    return lo ? nz(A * (p - m * k + k2), 2 * A * (m - p * k), A * (p - m * k - k2), p + m * k + k2, -2 * (m + p * k), p + m * k - k2)
      : nz(A * (p + m * k + k2), -2 * A * (m + p * k), A * (p + m * k - k2), p - m * k + k2, 2 * (m - p * k), p - m * k - k2);
  }
  const Q = Math.max(0, fr(q)); if (!(x > 0 && x < 1)) return unit(1);
  if (type === 'notch') { if (!(Q > 0)) return unit(0); const alpha = sn / (2 * Q); return nz(1, -2 * k, 1, 1 + alpha, -2 * k, 1 - alpha); }
  if (!(Q > 0)) return unit(A * A);
  const alpha = sn / (2 * Q); return nz(1 + alpha * A, -2 * k, 1 - alpha * A, 1 + alpha / A, -2 * k, 1 - alpha / A);          // a bell
}
/* The EQ's own filters. The usual digital formulas (above) squeeze a curve as it nears half the sample rate: a bell at 10kHz comes out narrower and lopsided at 44.1kHz, a low-pass far steeper.
   These keep the shape of the analog curve the formulas start from. The two feedback numbers place the filter's resonance where the analog one has it (its impulse response sampled);
   the three feed-forward numbers are then chosen so the size of the response follows the analog curve: exact at 0Hz, and (but for a bell low down) the least-squares fit at 64 frequencies up to 20kHz and around the
   band's own frequency. (The approach of setting a digital filter's response against the analog one is described by S. Orfanidis, 1997, and M. Vicanek, 2016; the fit here is written from scratch.)
   A notch, or anything the fit cannot do, uses the usual formula. Gives [b0, b1, b2, a1, a2] like bqCoef. */
function eqAnalog(type, f, q, gain) {          // the analog curve as (n2 s^2 + n1 s + n0) / (s^2 + d1 s + d0)
  const w = 2 * Math.PI * f, A = Math.pow(10, gain / 40), Qs = Math.SQRT1_2, rA = Math.sqrt(A);
  if (type === 'peaking') return q > 0 ? { n: [w * w, w * A / q, 1], d: [w * w, w / (A * q)] } : null;
  if (type === 'lowpass') return q > 0 ? { n: [w * w, 0, 0], d: [w * w, w / q] } : null;
  if (type === 'highpass') return q > 0 ? { n: [0, 0, 1], d: [w * w, w / q] } : null;
  if (type === 'lowshelf') return { n: [A * w * w, rA / Qs * w, 1], d: [w * w / A, w / (Qs * rA)] };
  if (type === 'highshelf') return { n: [A * w * w, A * rA / Qs * w, A * A], d: [A * w * w, rA / Qs * w] };
  return null;
}
const eqAnalogMag2 = (p, f) => { const W = 2 * Math.PI * f, nr = p.n[0] - p.n[2] * W * W, ni = p.n[1] * W, dr = p.d[0] - W * W, di = p.d[1] * W; return (nr * nr + ni * ni) / (dr * dr + di * di); };
function bqMatched(type, f, q, gain, sr) {
  const p = f > 0 && f < sr * 0.4995 ? eqAnalog(type, f, q, gain) : null; if (!p) return bqCoef(type, f, q, gain, sr);
  const T = 1 / sr, wp = Math.sqrt(p.d[0]), z = p.d[1] / (2 * wp), r = Math.exp(-z * wp * T), a1 = z <= 1 ? -2 * r * Math.cos(Math.sqrt(1 - z * z) * wp * T) : -2 * r * Math.cosh(Math.sqrt(z * z - 1) * wp * T), a2 = r * r;
  const A0 = (1 + a1 + a2) * (1 + a1 + a2), A1 = (1 - a1 + a2) * (1 - a1 + a2), A2 = -4 * a2, top = Math.min(20000, sr * 0.455);
  if (type === 'highpass') { const s1 = Math.sin(Math.PI * f / sr), p1 = s1 * s1, p0 = 1 - p1, b0 = Math.sqrt((A0 * p0 + A1 * p1 + A2 * 4 * p0 * p1) * eqAnalogMag2(p, f)) / (4 * p1); return isFinite(b0) ? [b0, -2 * b0, b0, a1, a2] : bqCoef(type, f, q, gain, sr); }          // two zeros at 0Hz, and the analog level at the corner
  const B0 = A0 * eqAnalogMag2(p, 0); let s11 = 0, s12 = 0, s22 = 0, t1 = 0, t2 = 0, C1 = 0, C2 = 0, mix = 1;
  if (type === 'peaking') {          // low down, a bell is set in closed form instead (the level at its own frequency, and the top of the curve sitting there): the fit has too little to hold on to that far from the top of the range. Between the two, a blend
    const s1 = Math.sin(Math.PI * f / sr), p1 = s1 * s1, p0 = 1 - p1, p2 = 4 * p0 * p1, G2 = eqAnalogMag2(p, f), R1 = (A0 * p0 + A1 * p1 + A2 * p2) * G2, R2 = (-A0 + A1 + 4 * (p0 - p1) * A2) * G2;
    C2 = (R1 - R2 * p1 - B0) / (4 * p1 * p1); C1 = R2 + B0 + 4 * (p1 - p0) * C2; mix = Math.min(1, Math.max(0, (f / sr - 0.02) / 0.04)); if (!(C1 >= 0)) mix = 1;
  }
  const near = type === 'peaking' ? 33 : 1, step = 0.18 / Math.max(0.2, q);          // a bell is also read at 33 places across its own width (octaves apart by its width), so a narrow one is not missed between the 64
  for (let i = 0; i < 64 + near; i++) {
    const fi = i < 64 ? 20 * Math.pow(top / 20, i / 63) : Math.min(top, Math.max(10, f * Math.pow(2, (i - 64 - (near >> 1)) * step))), wt = i < 64 ? 1 : near > 1 ? 1 : 4, s1 = Math.sin(Math.PI * fi / sr), p1 = s1 * s1, p0 = 1 - p1, p2 = 4 * p0 * p1, D = (A0 * p0 + A1 * p1 + A2 * p2) * eqAnalogMag2(p, fi), x1 = p1 / D, x2 = p2 / D, y = 1 - B0 * p0 / D;
    s11 += wt * x1 * x1; s12 += wt * x1 * x2; s22 += wt * x2 * x2; t1 += wt * x1 * y; t2 += wt * x2 * y;
  }
  const det = s11 * s22 - s12 * s12; let B1 = (t1 * s22 - t2 * s12) / det, B2 = (t2 * s11 - t1 * s12) / det; if (!(B1 >= 0)) B1 = 0;
  if (mix < 1) { if (mix > 0 && isFinite(B1) && isFinite(B2)) { B1 = C1 + (B1 - C1) * mix; B2 = C2 + (B2 - C2) * mix; } else { B1 = C1; B2 = C2; } }
  const W = (Math.sqrt(B0) + Math.sqrt(B1)) / 2; if (!(W * W + B2 >= 0)) return bqCoef(type, f, q, gain, sr);
  const b0 = (W + Math.sqrt(W * W + B2)) / 2, b1 = (Math.sqrt(B0) - Math.sqrt(B1)) / 2, b2 = -B2 / (4 * b0), c = [b0, b1, b2, a1, a2];
  return c.every(isFinite) ? c : bqCoef(type, f, q, gain, sr);
}
/* a band as the filters that make it: one, or for a steeper high-pass or low-pass (24 or 48dB per octave) two or four in a row, each with the resonance that keeps the whole flat right up to the corner (Butterworth) */
const EQ_SLOPE_Q = { 24: [0.54119610, 1.30656296], 48: [0.50979558, 0.60134489, 0.89997622, 2.56291545] };
function eqSections(b, sr) { const qs = (b.type === 'highpass' || b.type === 'lowpass') && EQ_SLOPE_Q[b.slope]; return qs ? qs.map(q => bqMatched(b.type, b.f, q, 0, sr)) : [bqMatched(b.type, b.f, b.q, b.g, sr)]; }
/* Dynamic bands: a bell or shelf whose gain follows how loud the sound is in the band's own region.
   Below the threshold the band has its set gain; as the level rises above it, the gain moves on by up to "range" dB (a negative range turns the band down, as a de-esser does; a positive one turns it up).
   The level is read from a copy of the sound filtered to the band's region (a band-pass for a bell, a low-pass or high-pass for a shelf), as the average power over ~4ms, with the left and right (or mid and side) read together
   so the picture does not lean. The full range is reached 9dB above the threshold, with a rounded start from 3dB under it. The gain eases in over ~3ms and out over ~90ms, in steps every 16 samples through a table of
   the band's own (matched) filters, so every setting between is the same shape of band. All of it is one function (eqDynRun) that the audio thread and the disk store both run, so what you hear is what is exported. */
const EQ_DYN_ST = 20;          // numbers of memory for each dynamic band: the level reader's filters (2 x 4), its power, the gain's position, the band's filters (2 x 4), a count to the next step, and the gain's position at the step before
const eqDynOk = type => type === 'peaking' || type === 'lowshelf' || type === 'highshelf';
function eqDynSpec(b, sr, pw) {
  const range = b.dyn.range, K = Math.max(4, Math.min(48, Math.ceil(Math.abs(range) * 2))), T = new Float64Array((K + 1) * 5);
  for (let k = 0; k <= K; k++) T.set(bqMatched(b.type, b.f, b.q, b.g + range * k / K, sr), k * 5);
  let sc; if (b.type === 'peaking') { const w0 = Math.PI * Math.min(0.999, b.f / (sr / 2)), al = Math.sin(w0) / (2 * Math.max(0.5, Math.min(4, b.q))), i = 1 / (1 + al); sc = [al * i, 0, -al * i, -2 * Math.cos(w0) * i, (1 - al) * i]; }
  else sc = bqCoef(b.type === 'lowshelf' ? 'lowpass' : 'highpass', b.f, Math.SQRT1_2, 0, sr);
  return { T, K, sc, thr: b.dyn.thr, kp: 1 - Math.exp(-1 / (Math.max(0.004, 1.5 / b.f) * sr)), ka: 1 - Math.exp(-16 / (0.003 * sr)), kr: 1 - Math.exp(-16 / (0.09 * sr)), pw: pw || 1 };
}
/* one dynamic band over n frames: a (and b, when two lines are read together) in, da (and db) out, with the memory at st[o …] carried on */
function eqDynRun(S, st, o, a, da, b, db, n, i0) {
  const T = S.T, K = S.K, sc = S.sc, s0 = sc[0], s1 = sc[1], s2 = sc[2], s3 = sc[3], s4 = sc[4], two = !!b, kp = S.kp, pw = S.pw;
  let ax1 = st[o], ax2 = st[o + 1], ay1 = st[o + 2], ay2 = st[o + 3], bx1 = st[o + 4], bx2 = st[o + 5], by1 = st[o + 6], by2 = st[o + 7], p = st[o + 8], amt = st[o + 9];
  let mx1 = st[o + 10], mx2 = st[o + 11], my1 = st[o + 12], my2 = st[o + 13], nx1 = st[o + 14], nx2 = st[o + 15], ny1 = st[o + 16], ny2 = st[o + 17], cnt = st[o + 18];
  /* The level is read every 16 samples and the gain takes a step toward where it should be. The filter's numbers do not jump at a step: they glide in a straight line from where the gain stood a step ago (prev)
     to where it stands now (amt) over the 16 samples between, so a moving gain leaves no stair-step in the sound. Each sample's numbers come from its place in the step alone, so the result is the same however the sound is cut into blocks. */
  let prev = st[o + 19], pos = prev * K, k = Math.min(K - 1, Math.floor(pos)), f = pos - k, q = k * 5;
  let p0 = T[q] + (T[q + 5] - T[q]) * f, p1 = T[q + 1] + (T[q + 6] - T[q + 1]) * f, p2 = T[q + 2] + (T[q + 7] - T[q + 2]) * f, p3 = T[q + 3] + (T[q + 8] - T[q + 3]) * f, p4 = T[q + 4] + (T[q + 9] - T[q + 4]) * f;
  pos = amt * K; k = Math.min(K - 1, Math.floor(pos)); f = pos - k; q = k * 5;
  let d0 = (T[q] + (T[q + 5] - T[q]) * f - p0) / 16, d1 = (T[q + 1] + (T[q + 6] - T[q + 1]) * f - p1) / 16, d2 = (T[q + 2] + (T[q + 7] - T[q + 2]) * f - p2) / 16, d3 = (T[q + 3] + (T[q + 8] - T[q + 3]) * f - p3) / 16, d4 = (T[q + 4] + (T[q + 9] - T[q + 4]) * f - p4) / 16;
  for (let i = i0 || 0, e0 = (i0 || 0) + n; i < e0; i++) {
    const b0 = p0 + d0 * cnt, b1 = p1 + d1 * cnt, b2 = p2 + d2 * cnt, a1 = p3 + d3 * cnt, a2 = p4 + d4 * cnt;
    const xa = a[i], ya = s0 * xa + s1 * ax1 + s2 * ax2 - s3 * ay1 - s4 * ay2; ax2 = ax1; ax1 = xa; ay2 = ay1; ay1 = ya; let e = ya * ya;
    const ma = b0 * xa + b1 * mx1 + b2 * mx2 - a1 * my1 - a2 * my2; mx2 = mx1; mx1 = xa; my2 = my1; my1 = ma; da[i] = ma;
    if (two) { const xb = b[i], yb = s0 * xb + s1 * bx1 + s2 * bx2 - s3 * by1 - s4 * by2; bx2 = bx1; bx1 = xb; by2 = by1; by1 = yb; e = (e + yb * yb) * 0.5; const mb = b0 * xb + b1 * nx1 + b2 * nx2 - a1 * ny1 - a2 * ny2; nx2 = nx1; nx1 = xb; ny2 = ny1; ny1 = mb; db[i] = mb; }
    p += (e * pw - p) * kp;
    if (++cnt >= 16) {          // every 16 samples: how far over the threshold, and the gain's next position
      cnt = 0; const over = 10 * Math.log10(p + 1e-14) + 3.0103 - S.thr, u = Math.min(1, Math.max(0, (over + 3) / 12)), tg = u * u * (3 - 2 * u);
      prev = amt; pos = prev * K; k = Math.min(K - 1, Math.floor(pos)); f = pos - k; q = k * 5;
      p0 = T[q] + (T[q + 5] - T[q]) * f; p1 = T[q + 1] + (T[q + 6] - T[q + 1]) * f; p2 = T[q + 2] + (T[q + 7] - T[q + 2]) * f; p3 = T[q + 3] + (T[q + 8] - T[q + 3]) * f; p4 = T[q + 4] + (T[q + 9] - T[q + 4]) * f;
      amt += (tg - amt) * (tg > amt ? S.ka : S.kr); pos = amt * K; k = Math.min(K - 1, Math.floor(pos)); f = pos - k; q = k * 5;
      d0 = (T[q] + (T[q + 5] - T[q]) * f - p0) / 16; d1 = (T[q + 1] + (T[q + 6] - T[q + 1]) * f - p1) / 16; d2 = (T[q + 2] + (T[q + 7] - T[q + 2]) * f - p2) / 16; d3 = (T[q + 3] + (T[q + 8] - T[q + 3]) * f - p3) / 16; d4 = (T[q + 4] + (T[q + 9] - T[q + 4]) * f - p4) / 16;
    }
  }
  st[o] = ax1; st[o + 1] = ax2; st[o + 2] = ay1; st[o + 3] = ay2; st[o + 4] = bx1; st[o + 5] = bx2; st[o + 6] = by1; st[o + 7] = by2; st[o + 8] = p; st[o + 9] = amt;
  st[o + 10] = mx1; st[o + 11] = mx2; st[o + 12] = my1; st[o + 13] = my2; st[o + 14] = nx1; st[o + 15] = nx2; st[o + 16] = ny1; st[o + 17] = ny2; st[o + 18] = cnt; st[o + 19] = prev;
}
/* how much a filter raises or lowers a frequency (the size of its response there) */
function bqMag(c, f, sr) {
  const w = -Math.PI * (f / (sr / 2)), zr = Math.cos(w), zi = Math.sin(w), mul = (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br];
  let t = mul(c[2] * zr + c[1], c[2] * zi, zr, zi); const nr = c[0] + t[0], ni = t[1]; t = mul(c[4] * zr + c[3], c[4] * zi, zr, zi); const dr = 1 + t[0], di = t[1];
  return fr(Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di)));
}
/* A free curve (EQ Match): any curve, drawn as the 240 points of the EQ's axis (20Hz to 20kHz, in dB), made by a row of 39 bells a quarter of an octave apart (26Hz to 19kHz), each set to the gain that brings the whole row to the curve.
   The gains come from a least-squares fit with a little smoothing between neighbours, then three rounds that measure what the filters really do (the matched filters, at this sample rate) and correct what is left,
   so the curve you see is the curve the filters have: on curves as busy as a match can be, the average difference is ~0.07dB and 99 points in 100 are within 0.3dB. The row is made the same way wherever it is needed (the page, the worker). */
const EQ_CURVE_K = 39, EQ_CURVE_Q = 2.87, EQ_CURVE_F = Array.from({ length: EQ_CURVE_K }, (_, k) => 26.5 * Math.pow(2, k / 4)), EQ_AXIS = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239)), EQ_CURVE_LAM = 0.02;
const eqCurveMem = { setup: new Map(), done: new Map() };
function eqCurveSetup(sr) {
  let st = eqCurveMem.setup.get(sr); if (st) return st; const N = EQ_CURVE_K, J = EQ_AXIS.length;
  const S = EQ_CURVE_F.map(f => { const c = bqMatched('peaking', f, EQ_CURVE_Q, 6, sr); return EQ_AXIS.map(a => 20 * Math.log10(Math.max(1e-6, bqMag(c, a, sr))) / 6); });
  const A = Array.from({ length: N }, () => new Float64Array(N));
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) { let t = 0; for (let j = 0; j < J; j++) t += S[a][j] * S[b][j]; A[a][b] = t; }
  for (let i = 1; i < N - 1; i++) { const d = [[i - 1, 1], [i, -2], [i + 1, 1]]; for (const [a, x] of d) for (const [b, y] of d) A[a][b] += EQ_CURVE_LAM * x * y; }
  for (let i = 0; i < N; i++) A[i][i] += 1e-6;
  const M = A.map((r, i) => { const x = new Float64Array(2 * N); x.set(r); x[N + i] = 1; return x; });
  for (let c = 0; c < N; c++) { let p = c; for (let r = c + 1; r < N; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; const sw = M[c]; M[c] = M[p]; M[p] = sw; const d = M[c][c]; for (let k = 0; k < 2 * N; k++) M[c][k] /= d; for (let r = 0; r < N; r++) if (r !== c) { const f = M[r][c]; if (f) for (let k = 0; k < 2 * N; k++) M[r][k] -= f * M[c][k]; } }
  const P = Array.from({ length: N }, (_, a) => { const row = new Float64Array(J); for (let j = 0; j < J; j++) { let t = 0; for (let b = 0; b < N; b++) t += M[a][N + b] * S[b][j]; row[j] = t; } return row; });
  st = { P }; eqCurveMem.setup.set(sr, st); return st;
}
/* the row of bells for a curve (an array of 240 numbers, dB): the bands that are not nearly flat, as ordinary EQ bands */
function eqCurveBands(curve, sr) {
  const key = sr + '|' + curve.join(','), hit = eqCurveMem.done.get(key); if (hit) return hit;
  const st = eqCurveSetup(sr), N = EQ_CURVE_K, J = EQ_AXIS.length, g = new Float64Array(N), resp = new Float64Array(J);
  for (let it = 0; it < 4; it++) {
    resp.fill(0); for (let k = 0; k < N; k++) if (Math.abs(g[k]) > 1e-4) { const c = bqMatched('peaking', EQ_CURVE_F[k], EQ_CURVE_Q, g[k], sr); for (let j = 0; j < J; j++) resp[j] += 20 * Math.log10(Math.max(1e-6, bqMag(c, EQ_AXIS[j], sr))); }
    for (let k = 0; k < N; k++) { let t = 0; for (let j = 0; j < J; j++) t += st.P[k][j] * (curve[j] - resp[j]); g[k] = Math.max(-15, Math.min(15, g[k] + t)); }
  }
  const out = []; for (let k = 0; k < N; k++) { const v = Math.round(g[k] * 100) / 100; if (Math.abs(v) >= 0.05) out.push({ type: 'peaking', f: EQ_CURVE_F[k], g: v, q: EQ_CURVE_Q, on: true }); }
  eqCurveMem.done.set(key, out); if (eqCurveMem.done.size > 6) eqCurveMem.done.delete(eqCurveMem.done.keys().next().value); return out;
}
/* where a band works: on the whole stereo sound, or only on its mid (L+R) or side (L−R). Only a two-channel sound has a side: a mono sound is all mid (so a side band has nothing to work on), and a sound with more channels keeps every band on every channel */
const eqPlace = (b, nch) => nch === 2 ? (b.place === 'mid' || b.place === 'side' ? b.place : 'st') : nch === 1 && b.place === 'side' ? 'none' : 'st';
/* how much of the sound a band's change reaches, for Auto gain: the whole of it for a stereo band, and for a mid or side band the share the mid or side usually holds (music keeps about four times as much in the middle) */
const EQ_PLACE_WEIGHT = { st: 1, mid: 0.8, side: 0.2, none: 0 };
/* Auto gain: the average of the EQ's curve between 80Hz and 10kHz, every octave counting the same, taken back off */
function eqTrim(bands, sr, nch) {
  const r = new Float32Array(48);
  bands.forEach(b => { const w = EQ_PLACE_WEIGHT[eqPlace(b, nch || 2)]; if (w) eqSections(b, sr).forEach(c => { for (let i = 0; i < 48; i++) r[i] += w * 20 * Math.log10(Math.max(1e-6, bqMag(c, fr(80 * Math.pow(125, i / 47)), sr))); }); });
  let s = 0; r.forEach(v => { s += v; }); return Math.pow(10, -(s / r.length) / 20);
}
/* a tool's bands split into the sound's mid and side (the side or the mid alone when "solo" says so) when any band sits on one of them; a stereo band works on both, and since the filters are linear it comes out the same as on left and right */
const eqMS = (t, nch) => nch === 2 && (!!t.solo || t.bands.some(b => eqPlace(b, 2) !== 'st'));
/* the tools as a list of small steps on numbered lines of sound: a filter, a volume, or two lines added */
function plan(tools, sr, nch) {
  const ops = [], coefs = [], dyn = []; let lines = nch, nbq = 0, cur = []; for (let c = 0; c < nch; c++) cur.push(c);
  const put = (src, c) => { const dst = lines++; coefs.push(c); ops.push([0, src, dst, nbq++]); return dst; }, bq = (src, type, f, q, g) => put(src, bqCoef(type, f, q, g, sr));          // the Imager's crossovers keep the usual formula: its bands must add back to a flat sound
  const gain = (src, v) => { const dst = lines++; ops.push([1, src, dst, fr(v)]); return dst; };
  const sum = (x, y) => { const dst = lines++; ops.push([2, x, dst, y]); return dst; };
  const lr4 = (src, type, f) => bq(bq(src, type, f, Math.SQRT1_2, 0), type, f, Math.SQRT1_2, 0);          // two the same in a row: 24dB per octave
  /* the bands from low to high; each lower band also passes the allpass of every crossover above it, so the bands add back to a flat sound */
  const net = (src, F) => {
    const outs = []; let rest = src; F.forEach(f => { outs.push(lr4(rest, 'lowpass', f)); rest = lr4(rest, 'highpass', f); }); outs.push(rest);
    for (let b = 0; b < F.length; b++) for (let k = b + 1; k < F.length; k++) outs[b] = sum(lr4(outs[b], 'lowpass', F[k]), lr4(outs[b], 'highpass', F[k]));
    return outs;
  };
  tools.forEach(t => {
    if (t.k === 'eq') {
      const all = (t.curve && t.curve.length === 240 ? eqCurveBands(t.curve, sr) : []).concat(t.bands), trim = t.auto ? eqTrim(all, sr, nch) : 1, ms = eqMS(t, nch);          // a free curve first, then the bands
      /* the bands in order on the lines they work on (one line, left and right, or the mid and the side); a dynamic band reads the lines it works on together */
      const runBands = (ls, who, pw) => {
        all.forEach(b => {
          const idx = who(b); if (!idx.length) return;
          if (b.dyn && eqDynOk(b.type)) { const sp = eqDynSpec(b, sr, idx.length === 2 && ms ? 2 : pw), dst = idx.map(() => lines++); ops.push([3, ls[idx[0]], dst[0], idx.length > 1 ? ls[idx[1]] : -1, idx.length > 1 ? dst[1] : -1, dyn.length]); dyn.push(sp); idx.forEach((i, k) => { ls[i] = dst[k]; }); }
          else idx.forEach(i => { eqSections(b, sr).forEach(c => { ls[i] = put(ls[i], c); }); });
        });
        return ls;
      };
      if (ms) {
        const ls = runBands([sum(gain(cur[0], 0.5), gain(cur[1], 0.5)), sum(gain(cur[0], 0.5), gain(cur[1], -0.5))], b => { const p = eqPlace(b, 2); return p === 'mid' ? [0] : p === 'side' ? [1] : [0, 1]; }, 1);
        const m = gain(ls[0], t.solo === 'side' ? 0 : trim), sd = gain(ls[1], t.solo === 'mid' ? 0 : trim); cur = [sum(m, sd), sum(m, gain(sd, -1))];
      } else cur = runBands(cur.slice(), b => eqPlace(b, nch) === 'none' ? [] : cur.map((_, i) => i), 1).map(line => gain(line, trim));
      return;
    }
    const mb = t.monoBass > 0 ? t.monoBass : 0, bw = t.bw || [100, 100, 100], multi = bw.some(v => v !== 100), F = [], bal = t.bal || 0, db = v => Math.pow(10, v / 20);
    if (multi) { if (mb && mb < IM_X1) F.push(mb); F.push(IM_X1); if (mb && mb >= IM_X1) F.push(mb); F.push(IM_X2); } else if (mb) F.push(mb);
    const mid = sum(gain(cur[0], 0.5), gain(cur[1], 0.5)), side = sum(gain(cur[0], 0.5), gain(cur[1], -0.5)); let midOut = mid, sideOut;
    if (F.length) {
      const gs = F.concat([Infinity]).map(up => (mb && up <= mb) ? 0 : t.width / 100 * ((up <= IM_X1 ? bw[0] : up <= IM_X2 ? bw[1] : bw[2]) / 100));
      sideOut = net(side, F).map((o, k) => gain(o, gs[k])).reduce(sum); midOut = net(mid, F).reduce(sum);
    } else sideOut = gain(side, t.width / 100);
    cur = [gain(sum(midOut, sideOut), db(-Math.max(0, bal) / 2 + Math.max(0, -bal) / 2)), gain(sum(midOut, gain(sideOut, -1)), db(Math.max(0, bal) / 2 - Math.max(0, -bal) / 2))];
  });
  return { ops, coefs, dyn, lines, nbq, out: cur };
}
function Filters(up, src, tools) {
  this.up = up; this.len = src.frames; this.sr = src.sr; this.nch = src.ch; this.p = plan(tools, src.sr, src.ch);
  this.buf = []; for (let i = 0; i < this.p.lines; i++) this.buf.push(new Float32Array(FX_BLOCK));
  this.st = new Float64Array(this.p.nbq * 4 + this.p.dyn.length * EQ_DYN_ST); this.pos = 0; this.exact = true; this.cks = new Map();
}
/* n frames (at most one block) through every step, carrying each filter's memory on */
Filters.prototype.run = function (chans, n) {
  const { ops, coefs } = this.p, buf = this.buf, st = this.st; for (let c = 0; c < this.nch; c++) buf[c].set(chans[c].subarray(0, n));
  for (let j = 0; j < ops.length; j++) {
    const op = ops[j], s = buf[op[1]], d = buf[op[2]];
    if (op[0] === 0) {
      const c = coefs[op[3]], b0 = c[0], b1 = c[1], b2 = c[2], a1 = c[3], a2 = c[4], o = op[3] * 4; let x1 = st[o], x2 = st[o + 1], y1 = st[o + 2], y2 = st[o + 3];
      for (let i = 0; i < n; i++) { const x = s[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; d[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y; }
      st[o] = x1; st[o + 1] = x2; st[o + 2] = y1; st[o + 3] = y2;
    } else if (op[0] === 1) { const g = op[3]; for (let i = 0; i < n; i++) d[i] = s[i] * g; }
    else if (op[0] === 3) eqDynRun(this.p.dyn[op[5]], st, this.p.nbq * 4 + op[5] * EQ_DYN_ST, s, d, op[3] >= 0 ? buf[op[3]] : null, op[4] >= 0 ? buf[op[4]] : null, n);
    else { const t = buf[op[3]]; for (let i = 0; i < n; i++) d[i] = s[i] + t[i]; }
  }
};
Filters.prototype.read = async function (a, n, exact) {
  const len = this.len; a = Math.max(0, a); const b = Math.min(len, a + n); n = Math.max(0, b - a);
  const out = []; for (let c = 0; c < this.nch; c++) out.push(new Float32Array(n)); if (!n) return { chans: out, exact: true };
  if (this.pos !== a || (exact && !this.exact)) {          // not carrying straight on: from the nearest checkpoint before, from where it stands, or a run-in from rest
    let at = Math.floor(a / FX_CK) * FX_CK; while (at > 0 && !this.cks.has(at)) at -= FX_CK;
    const here = this.pos <= a && this.pos >= at && (this.exact || !exact), from = here ? this.pos : at, runIn = Math.round(FX_RUNIN * this.sr);
    if (!exact && a - from > runIn) { this.st.fill(0); this.pos = a - runIn; this.exact = false; }
    else if (!here) { if (at > 0) this.st.set(this.cks.get(at)); else this.st.fill(0); this.pos = at; this.exact = true; }
  }
  while (this.pos < b) {
    const p = this.pos, m = Math.min(FX_BLOCK, b - p, FX_CK - p % FX_CK, p < a ? a - p : b - p), r = await this.up.read(p, m, exact); if (!r.exact) this.exact = false;
    if (this.exact && p > 0 && p % FX_CK === 0 && !this.cks.has(p)) this.cks.set(p, new Float64Array(this.st));
    this.run(r.chans, m); this.pos = p + m;
    if (p >= a) for (let c = 0; c < this.nch; c++) out[c].set(this.buf[this.p.out[c]].subarray(0, m), p - a);
  }
  return { chans: out, exact: this.exact };
};

/* The stages for a recipe, in order: noise reduction, Spectra, then EQ and Imager in the order chosen.
   recipe = { noise: { profile, reduction, sensitivity, smoothing } or null, axis, edits, tools: [{ k: 'eq', bands, auto } or { k: 'imager', width, monoBass, bw, bal }] }.
   A stage is kept from the chain before (prev) when it and everything ahead of it are unchanged, so moving an EQ band does not throw away what noise reduction has worked out. */
const plain = recipe => !recipe.noise && !(recipe.edits && recipe.edits.length) && !(recipe.tools && recipe.tools.length);          // nothing changes the sound
function chain(src, recipe, prev, fork) {
  const stages = {}; let sig = String(src.key), up = null, q = Promise.resolve();
  /* fork: a second reader of the same settings (a measuring pass beside playback) gets stages of its own, so the two do not pull each other back and forth, and shares the checkpoints */
  const add = (s, make) => { sig += '|' + s; const old = prev && prev.stages[sig]; if (old && !fork) { up = stages[sig] = old; return; } up = stages[sig] = make(up); if (old) { if (old.cks) up.cks = old.cks; if (old.sides) up.sides = old.sides; } };
  add('src', () => ({ read: async (a, n) => { a = Math.max(0, a); n = Math.max(0, Math.min(n, src.frames - a)); return { chans: n ? await src.read(a, n) : Array.from({ length: src.ch }, () => new Float32Array(0)), exact: true }; } }));
  if (recipe.noise && recipe.noise.hum) add('hum' + JSON.stringify(recipe.noise.hum), u => new Filters(u, src, [{ k: 'eq', bands: humBands(recipe.noise.hum), auto: false }]));          // mains hum goes first: narrow notches
  if (recipe.noise && recipe.noise.profile && recipe.noise.reduction > 0) add('noise' + JSON.stringify([recipe.noise.profile, recipe.noise.reduction, recipe.noise.sensitivity, recipe.noise.smoothing, recipe.noise.mode, recipe.axis]), u => new Noise(u, src, recipe.noise, recipe.axis));
  if (recipe.listen && recipe.noise) add('listen', u => new Removed(u, src));          // listening to the noise alone: nothing after the noise stage but the tools
  else if (recipe.edits && recipe.edits.length) { if (recipe.noise) add('kept', u => new Kept(u, src)); add('spectra' + JSON.stringify(recipe.edits), u => new Spectra(u, src, recipe.edits)); }
  if ((recipe.noise || (recipe.edits && recipe.edits.length && !recipe.listen)) && recipe.tools && recipe.tools.length) add('near', u => new Kept(u, src, 64));          // ~45 seconds
  if (recipe.tools && recipe.tools.length) add('filters' + JSON.stringify(recipe.tools), u => new Filters(u, src, recipe.tools));
  const top = up;
  return { stages, read(a, n, exact) { const r = q.then(() => top.read(Math.floor(a), Math.floor(n), !!exact)); q = r.catch(() => {}); return r; } };          // one read at a time: the stages remember where they are
}
/* ---------------- the final samples: level, fades and limiter ----------------
   The same sums as the app's masterMaker, reading the processed sound a stretch at a time. read(start, n) gives { chans } for frames inside the recording.
   spec = { vs, ve (seconds kept), gain, fade: { len, shape } or null, clamp, limit (ceiling in dB, or null), ch (channels out), total (frames out, optional) }.
   fill(pos, len) gives planar samples (channel after channel) for output frames pos … pos+len; before or after the sound is silence. */
const SHAPES = { standard: x => x, smooth: x => x * x * (3 - 2 * x), natural: x => Math.sin(x * Math.PI / 2), slow: x => x * x, fast: x => 1 - (1 - x) * (1 - x) };
const TP_H = (() => { const T = 12, out = []; for (const f of [0.25, 0.5, 0.75]) { const row = []; for (let k = -T + 1; k <= T; k++) { const t = k - f, s = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t), w = 0.5 + 0.5 * Math.cos(Math.PI * t / T); row.push(s * w); } out.push(row); } return out; })();
function master(read, info, spec) {
  const sr = info.sr, frames = info.frames, nch = info.ch, ch = spec.ch || nch, vs = spec.vs, ve = spec.ve, gain = spec.gain == null ? 1 : spec.gain, total = spec.total || Math.max(1, Math.round((ve - vs) * sr)), base = Math.round(vs * sr);
  const fd = spec.fade, hf = (ve - vs) / 2, L = fd ? Math.min(fd.len, hf) : 0, Lo = fd ? Math.min(fd.lenOut == null ? fd.len : fd.lenOut, hf) : 0, sh = fd ? SHAPES[fd.shape] || SHAPES.smooth : null, f = x => sh(x < 0 ? 0 : x > 1 ? 1 : x), fadeAt = t => L > 0 || Lo > 0 ? Math.min(L > 0 ? f((t - vs) / L) : 1, Lo > 0 ? f((ve - t) / Lo) : 1) : 1;
  const lim = spec.limit != null ? { L: new Lim(sr, ch, spec.limit, 80, TP_H), next: -1, fed: 0 } : null;
  const raw = async (pos, len) => {
    const out = new Float32Array(len * ch), a = Math.max(0, base + pos), b = Math.min(frames, base + pos + len), r = b > a ? await read(a, b - a) : null, off = a - (base + pos);
    if (r) for (let c = 0; c < ch; c++) { const x = r.chans[Math.min(c, nch - 1)], o = c * len + off; for (let k = 0; k < b - a; k++) { const v = x[k] * (fadeAt(vs + (off + k + pos) / sr) * gain); out[o + k] = spec.clamp ? (v > 1 ? 1 : v < -1 ? -1 : v) : v; } }
    return out;
  };
  /* with a limiter the sound is fed through it a little ahead (it holds the audio back by its look-ahead), carrying on from the last block; asking for a different place starts it afresh just before that place */
  const limited = async (pos, len) => {
    if (pos !== lim.next) { lim.L.reset(); lim.fed = Math.max(0, pos - 4096); }
    const D = lim.L.delay, F = pos + len + D - lim.fed, off = pos + D - lim.fed, tmp = await raw(lim.fed, F), res = new Float32Array(F * ch), out = new Float32Array(len * ch), a = [], b = [];
    for (let c = 0; c < ch; c++) { a.push(tmp.subarray(c * F, (c + 1) * F)); b.push(res.subarray(c * F, (c + 1) * F)); }
    lim.L.process(a, b, F); for (let c = 0; c < ch; c++) out.set(b[c].subarray(off, off + len), c * len);
    lim.fed = pos + len + D; lim.next = pos + len; return out;
  };
  return { sr, total, ch, fill: lim ? limited : raw, reduction: () => lim ? 20 * Math.log10(lim.L.maxGr) : 0 };
}
/* The limiter, the same as the app's: it looks 5ms ahead, works out how much each moment must come down to stay under the ceiling (counting the peaks between two samples),
   holds the lowest of those over the look-ahead and for 15ms after (so the gain rests across the waves of a low note instead of following each one), and eases the gain down
   through two averages in a row (a rounded step, not a ramp with corners) and back up. */
class Lim {
  constructor(sr, nch, ceilDb, relMs, tp) {
    this.sr = sr; this.nch = nch; this.tp = tp; this.L = Math.max(8, Math.round(0.005 * sr)); this.L1 = (this.L + 1) >> 1; this.L2 = this.L + 1 - this.L1; this.D = this.L + 11; this.W = this.D + 1 + Math.round(0.015 * sr);
    this.ceil = Math.pow(10, ceilDb / 20); this.rel = (relMs || 80) / 1000; this.relK = 1 - Math.exp(-1 / (sr * this.rel)); this.susK = 1 - Math.exp(-1 / (sr * 0.3));          // the release: the time the gain takes to come back, 80ms for a single peak and up to eight times that while the limiter has been working for a while
    this.reset();
  }
  reset() {
    const W = this.W, D = this.D, n = this.nch; this.h = []; this.dl = [];
    for (let c = 0; c < n; c++) { this.h.push(new Float64Array(48)); this.dl.push(new Float32Array(D)); }
    this.dq = new Float64Array(W); this.dqi = new Float64Array(W); this.dh = 0; this.dt = 0;
    this.bx = new Float64Array(this.L1).fill(1); this.bs = this.L1; this.bp = 0; this.cx = new Float64Array(this.L2).fill(1); this.cs = this.L2; this.cp = 0; this.gp = 1; this.i = 0; this.maxGr = 1; this.avg = 0; this.k = this.relK; this.g = 1;
  }
  get delay() { return this.D; }
  process(inp, out, n) {
    const L1 = this.L1, L2 = this.L2, W = this.W, D = this.D, nch = this.nch, ceil = this.ceil, relK = this.relK, tp = this.tp, quiet = ceil * 0.35;
    for (let s = 0; s < n; s++) {
      const i = this.i, p = i % 24; let pk = 0;
      for (let c = 0; c < nch; c++) {
        const h = this.h[c], x = inp[c][s]; h[p] = x; h[p + 24] = x;
        const a = x < 0 ? -x : x; if (a > pk) pk = a;
        const w = p + 1, m1 = h[w + 11], m2 = h[w + 12], am = (m1 < 0 ? -m1 : m1) > (m2 < 0 ? -m2 : m2) ? (m1 < 0 ? -m1 : m1) : (m2 < 0 ? -m2 : m2);
        if (am > quiet) for (let r = 0; r < 3; r++) { const row = tp[r]; let y = 0; for (let j = 0; j < 24; j++) y += h[w + j] * row[j]; if (y < 0) y = -y; if (y > pk) pk = y; }
      }
      const need = pk > ceil ? ceil / pk : 1;
      while (this.dt !== this.dh && this.dq[(this.dt - 1 + W) % W] >= need) this.dt = (this.dt - 1 + W) % W;
      this.dq[this.dt] = need; this.dqi[this.dt] = i; this.dt = (this.dt + 1) % W;
      while (this.dqi[this.dh] <= i - W) this.dh = (this.dh + 1) % W;
      const m = this.dq[this.dh];
      this.bs += m - this.bx[this.bp]; this.bx[this.bp] = m; this.bp = (this.bp + 1) % L1;
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

/* ---------------- loudness (ITU-R BS.1770 / EBU R128), the same as the app's ----------------
   fill(pos, len) gives planar samples; tick() is called now and then so the caller can show progress, let other work through, or stop (by throwing) */
const lufs = e => e > 0 ? -0.691 + 10 * Math.log10(e) : -Infinity;
/* the ear's filter (a gentle boost above ~2kHz, a cut below ~40Hz) and the power of what comes out, added up per 100ms step */
function Weigh(sr, ch) {
  const shelf = (f0, Gd, Q) => { const K = Math.tan(Math.PI * f0 / sr), Vh = Math.pow(10, Gd / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K; return { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] }; };
  const hp = (f0, Q) => { const K = Math.tan(Math.PI * f0 / sr), a0 = 1 + K / Q + K * K; return { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] }; };
  this.p = shelf(1681.974450955533, 3.999843853973347, 0.7071752369554196); this.r = hp(38.13547087602444, 0.5003270373238773); this.ch = ch; this.hop = Math.round(sr * 0.1);
  this.z = []; for (let c = 0; c < ch; c++) this.z.push([[0, 0], [0, 0]]);
}
/* len planar samples that start at output frame pos; power is counted from frame lo on (what comes before only settles the filter) */
Weigh.prototype.add = function (buf, len, pos, en, lo) {
  const p = this.p, r = this.r, hop = this.hop, nh = en.length;
  for (let c = 0; c < this.ch; c++) {
    const s0 = this.z[c][0], s1 = this.z[c][1];
    for (let i = 0; i < len; i++) {
      const x = buf[c * len + i];
      let y = p.b[0] * x + s0[0]; s0[0] = p.b[1] * x - p.a[0] * y + s0[1]; s0[1] = p.b[2] * x - p.a[1] * y;
      const w = y; y = r.b[0] * w + s1[0]; s1[0] = r.b[1] * w - r.a[0] * y + s1[1]; s1[1] = r.b[2] * w - r.a[1] * y;
      if (pos + i >= lo) { const h = ((pos + i) / hop) | 0; if (h < nh) en[h] += y * y; }
    }
  }
};
/* the readings from the summed power of every 100ms step: quiet stretches are left out of the average (below -70 LUFS, then anything 10 LU under the rest) */
function readings(en, hop) {
  const nh = en.length; for (let h = 0; h < nh; h++) en[h] /= hop;
  const win = k => { const m = Math.max(0, nh - k + 1), out = new Float64Array(m); let s = 0; for (let i = 0; i < k && i < nh; i++) s += en[i]; for (let i = 0; i < m; i++) { out[i] = s / k; if (i + k < nh) s += en[i + k] - en[i]; } return out; };
  const mom = win(4), short = win(30), res = { I: -Infinity, LRA: 0, M: -Infinity, S: -Infinity, steps: nh };
  for (const e of mom) res.M = Math.max(res.M, lufs(e)); for (const e of short) res.S = Math.max(res.S, lufs(e));
  const gated = (arr, rel) => { const a = Array.from(arr).filter(e => lufs(e) > -70); if (!a.length) return []; const th = lufs(a.reduce((x, y) => x + y, 0) / a.length) + rel; return a.filter(e => lufs(e) > th); };
  const gi = gated(mom, -10); if (gi.length) res.I = lufs(gi.reduce((x, y) => x + y, 0) / gi.length);
  const gl = gated(short, -20).map(lufs).sort((x, y) => x - y);
  if (gl.length > 1) { const pc = q => { const i = q * (gl.length - 1), lo = Math.floor(i), f = i - lo; return gl[lo] + (gl[Math.min(lo + 1, gl.length - 1)] - gl[lo]) * f; }; res.LRA = pc(0.95) - pc(0.1); }
  return res;
}
/* the power of every 100ms step of a sound, read in order; each(buf, len, pos) sees every block on the way */
async function power(fill, total, sr, ch, tick, each) {
  const W = new Weigh(sr, ch), en = new Float64Array(Math.floor(total / W.hop)), B = W.hop * 5; let pos = 0;
  while (pos < total) { const len = Math.min(B, total - pos), buf = await fill(pos, len); W.add(buf, len, pos, en, 0); if (each) each(buf, len, pos); pos += len; if (tick) await tick(pos / total); }
  return en;
}
async function loudness(fill, total, sr, ch, tick) { return readings(await power(fill, total, sr, ch, tick), Math.round(sr * 0.1)); }
/* With the limiter on: limiting takes some loudness back, so the volume is raised a little more (measuring again each time, four times at most) until what comes out lands on the target.
   The first measurement (no limiter) keeps the power of every 100ms step and the true peak of every 10ms. For each volume tried after that, the limiter only has work where a true peak
   times the volume comes near the ceiling: those stretches (from a little before, to 1.5s after or, when the limiter has still not let go by then, for as long as it takes) are run through the limiter and measured afresh, and
   everywhere else the first measurement is simply scaled. When most of the recording is such stretches, the whole of it is run instead. */
/* for the picture of the limited sound: the highest sample of every 10ms of a sound handed over in blocks (planar), and from it how much the limiter takes off each 10ms (the limited height over the height before it) */
function binTop(top, per, buf, len, pos, ch) { for (let c = 0; c < ch; c++) { const o = c * len; for (let k = 0; k < len; k++) { const v = buf[o + k] < 0 ? -buf[o + k] : buf[o + k], i = ((pos + k) / per) | 0; if (i < top.length && v > top[i]) top[i] = v; } } }
function limShape(top, peaks, g) { const out = new Float32Array(top.length); for (let i = 0; i < out.length; i++) { const raw = peaks[i] * g; out[i] = raw > 1e-6 && top[i] < raw ? top[i] / raw : 1; } return out; }
const LIM_NEAR = 0.89, LIM_LETGO = 1.5, LIM_SETTLE = 0.25, LIM_MOST = 0.7, LIM_WORTH = 0.35;          // 1dB under the ceiling counts as near; seconds for the limiter to let go; seconds for the ear's filter to settle
async function limitTo(read, info, spec, target, ceil, tick) {
  const mk = (gain, limit) => master(read, info, Object.assign({}, spec, { gain, limit, clamp: false })), m0 = mk(1, null), sr = m0.sr, ch = m0.ch, total = m0.total, hop = Math.round(sr * 0.1), H = new Heights(total, sr, ch), top = Math.pow(10, ceil / 20);
  const en0 = await power(m0.fill, total, sr, ch, tick && (f => tick(f / 3)), (buf, len) => { const a = []; for (let c = 0; c < ch; c++) a.push(buf.subarray(c * len, (c + 1) * len)); H.push(a, len); }), m = readings(en0.slice(), hop);
  if (!isFinite(m.I)) return { g: 1, I: m.I, LRA: m.LRA, gr: 0, silent: true, base: m };
  const whole = async (g, prog) => { const mm = mk(g, ceil), hts = new Float32Array(H.len), r = readings(await power(mm.fill, total, sr, ch, prog, (buf, len, pos) => binTop(hts, H.per, buf, len, pos, ch)), hop); r.gr = mm.reduction(); r.part = 1; r.shape = limShape(hts, H.peaks, g); r.per = H.per / sr; return r; };
  const one = async (g, prog) => {
    const D = new Lim(sr, ch, ceil, 80, TP_H).delay, nh = en0.length, spans = [], lim = top * LIM_NEAR / g; let cover = 0;
    for (let i = 0; i < H.len; i++) if (H.tp[i] > lim) { const a = Math.max(0, Math.floor((i * H.per - D - 24) / hop) * hop), b = Math.min(nh * hop, Math.ceil(((i + 1) * H.per + LIM_LETGO * sr) / hop) * hop), last = spans[spans.length - 1]; if (last && a - LIM_SETTLE * sr <= last[1]) { if (b > last[1]) last[1] = b; } else if (b > a) spans.push([a, b]); }
    for (const sp of spans) cover += sp[1] - sp[0]; if (cover > LIM_MOST * nh * hop) return whole(g, prog);
    const en = new Float64Array(nh), raw = mk(g, null), B = hop * 5, hts = new Float32Array(H.len); let done = 0, low = 1; for (let h = 0; h < nh; h++) en[h] = en0[h] * g * g;
    for (let i = 0; i < H.len; i++) hts[i] = H.peaks[i] * g;          // the heights of what comes out: untouched away from the limited stretches, read from the limiter's output inside them
    const clear = (p, q) => { for (let h = p / hop; h < q / hop; h++) en[h] = 0; for (let i = Math.ceil(p / H.per); i < Math.floor(q / H.per); i++) hts[i] = 0; };
    for (let si = 0; si < spans.length; si++) {
      const a = spans[si][0]; let b = spans[si][1]; const L = new Lim(sr, ch, ceil, 80, TP_H), W = new Weigh(sr, ch), from = Math.max(0, a - Math.round(LIM_SETTLE * sr)); clear(a, b);
      for (let pos = from, len = 0; pos < b; pos += len) {          // the limiter holds the sound back D frames: it is fed D frames ahead, and what comes out lines up with pos
        len = Math.min(B, b - pos); const first = pos === from, F = len + (first ? D : 0), inp = await raw.fill(first ? pos : pos + D, F), res = new Float32Array(F * ch), x = [], y = [], out = new Float32Array(len * ch);
        for (let c = 0; c < ch; c++) { x.push(inp.subarray(c * F, (c + 1) * F)); y.push(res.subarray(c * F, (c + 1) * F)); } L.process(x, y, F);
        for (let c = 0; c < ch; c++) out.set(y[c].subarray(F - len), c * len); W.add(out, len, pos, en, a); binTop(hts, H.per, out, len, pos, ch);
        done += len; if (prog) await prog(Math.min(1, done / Math.max(1, cover)));
        if (pos + len >= b && b < nh * hop && (L.gp < 0.999 || L.avg >= 0.45)) {          // the limiter has not let go yet (after a deep or long reduction it comes back slowly): the stretch carries on until it has, taking in the next stretch if it reaches it
          const nb = Math.min(nh * hop, b + B); clear(b, nb); cover += nb - b; b = nb;
          while (si + 1 < spans.length && spans[si + 1][0] - LIM_SETTLE * sr <= b) { si++; if (spans[si][1] > b) { clear(b, spans[si][1]); b = spans[si][1]; } }
        }
      }
      if (L.maxGr < low) low = L.maxGr;
    }
    const r = readings(en, hop); r.gr = 20 * Math.log10(low); r.part = Math.min(1, cover / Math.max(1, nh * hop)); r.shape = limShape(hts, H.peaks, g); r.per = H.per / sr; return r;
  };
  /* When more volume no longer makes the sound much louder (under a third of a LU for each dB: the limiter is taking nearly all of it back), the search stops at the volume before and says so (short):
     pushing on would only limit harder for a loudness the sound cannot reach. */
  const cap = Math.pow(10, 24 / 20); let g = Math.min(cap, Math.pow(10, (target - m.I) / 20)), r = null, prev = null;
  for (let k = 0; k < 4; k++) {
    r = await one(g, tick && (f => tick((Math.min(2, k + 1) + f) / 3))); r.g = g;
    if (prev && g > prev.g && r.I - prev.I < LIM_WORTH * 20 * Math.log10(g / prev.g)) { r = prev; break; }
    const off = target - r.I; if (!isFinite(off) || Math.abs(off) < 0.05 || g >= cap) break; prev = r; g = Math.min(cap, g * Math.pow(10, off / 20));
  }
  r.short = isFinite(r.I) && target - r.I > 0.1; r.base = m; return r;
}

/* ---------------- waveform heights of the processed sound ----------------
   Fed the sound in order, a block at a time: the highest sample of every 10ms, and the true peak there (the loudest the sound gets between the samples, found by 4x oversampling
   around the loud samples). The same numbers as the app's calcPeaks and tpCompute. */
function Heights(frames, sr, nch) {
  this.frames = frames; this.nch = nch; this.per = Math.max(1, Math.floor(sr / 100)); this.len = Math.ceil(frames / this.per); this.peaks = new Float32Array(this.len); this.tp = new Float32Array(this.len);
  this.held = []; for (let c = 0; c < nch; c++) this.held.push(new Float32Array(0)); this.org = 0; this.next = 0; this.end = 0; this.mx = 0;
}
Heights.prototype.push = function (chans, n) {
  const keep = this.held[0].length; for (let c = 0; c < this.nch; c++) { const w = new Float32Array(keep + n); w.set(this.held[c]); w.set(chans[c].subarray(0, n), keep); this.held[c] = w; }
  this.end += n; const last = this.end >= this.frames, per = this.per, org = this.org, total = this.frames;
  while (this.next < this.len && (last || (this.next + 1) * per + 12 <= this.end)) {
    const i = this.next++, a = i * per, b = Math.min(total, a + per); let top = 0, tpk = 0;
    for (let c = 0; c < this.nch; c++) {
      const d = this.held[c]; let pk = 0; for (let k = a; k < b; k++) { const v = d[k - org] < 0 ? -d[k - org] : d[k - org]; if (v > pk) pk = v; }
      let m = pk; const lim = pk * 0.5;
      if (pk > 1e-5) for (let k = a; k < b; k++) {
        const v = d[k - org] < 0 ? -d[k - org] : d[k - org]; if (v < lim) continue;
        for (let p = 0; p < 3; p++) { const row = TP_H[p]; let y = 0; for (let j = 0; j < 24; j++) { const q = k - 11 + j; if (q >= 0 && q < total) y += d[q - org] * row[j]; } if (y < 0) y = -y; if (y > m) m = y; }
      }
      if (pk > top) top = pk; if (m > tpk) tpk = m;
    }
    this.peaks[i] = top; this.tp[i] = tpk; if (top > this.mx) this.mx = top;
  }
  const from = Math.max(org, Math.min(this.end, this.next * per) - 11); if (from > org) { for (let c = 0; c < this.nch; c++) this.held[c] = this.held[c].slice(from - org); this.org = from; }
};
/* ---------------- Sample-rate conversion ----------------
   The same sums as the app's resampleRegion (a windowed sinc, Kaiser, about 100dB down; narrowed when going to a lower rate so nothing folds back), a stretch at a time.
   resampled(read, info, outRate, seconds) gives a reader and info for the sound at the new rate, as if the whole sound from the start were converted; seconds is the end of the part that is kept. */
function rsKernel(scale) {
  const Z = 48, Zs = Z / scale, STEP = 2048, n = Math.ceil(2 * Zs * STEP) + 2, tab = new Float64Array(n), beta = 10.5;
  const i0 = x => { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-14 * s) break; } return s; }, den = i0(beta), fc = 0.995 * scale;
  for (let i = 0; i < n; i++) {
    const t = i / STEP - Zs, u = t / Zs; if (Math.abs(u) >= 1) { tab[i] = 0; continue; }
    const x = Math.PI * t * fc, sinc = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
    tab[i] = fc * sinc * i0(beta * Math.sqrt(1 - u * u)) / den;
  }
  return { tab, Zs, STEP };
}
function resampled(read, info, outRate, seconds) {
  const inRate = info.sr, ch = info.ch, L = info.frames, scale = Math.min(1, outRate / inRate), { tab, Zs, STEP } = rsKernel(scale), ratio = inRate / outRate;
  const frames = Math.max(1, Math.ceil(Math.min(seconds, L / inRate) * outRate)), wt = new Float64Array(Math.ceil(2 * Zs) + 4);
  return {
    info: { sr: outRate, ch, frames },
    async read(a, n) {
      const out = []; for (let c = 0; c < ch; c++) out.push(new Float32Array(n));
      const lo = Math.max(0, Math.ceil(a * ratio - Zs)), hi = Math.min(L, Math.floor((a + n - 1) * ratio + Zs) + 1), r = hi > lo ? await read(lo, hi - lo) : null; if (!r) return { chans: out };
      for (let j = 0; j < n; j++) {
        const x = (a + j) * ratio, i0 = Math.ceil(x - Zs), cnt = Math.floor(x + Zs) - i0 + 1;
        for (let t = 0; t < cnt; t++) { const p = (i0 + t - x + Zs) * STEP, k = p | 0, f = p - k; wt[t] = tab[k] + (tab[k + 1] - tab[k]) * f; }
        const t0 = Math.max(0, -i0), t1 = Math.min(cnt, L - i0);          // taps that fall before or after the sound count as silence
        for (let c = 0; c < ch; c++) { const sc = r.chans[c]; let acc = 0; for (let t = t0; t < t1; t++) acc += sc[i0 + t - lo] * wt[t]; out[c][j] = acc; }
      }
      return { chans: out };
    }
  };
}
G.KFX = { HumFind, humBands, nrHum, NoiseFloor, nrTab, nrFFTn, nrBinsN, nrNatSetup, nrNatGain, nrNatStep, chain, plain, bqCoef, bqMatched, bqMag, eqTrim, eqSections, eqPlace, eqMS, eqCurveBands, EQ_CURVE_F, eqDynOk, eqDynSpec, eqDynRun, EQ_DYN_ST, plan, master, resampled, loudness, limitTo, binTop, limShape, Heights, Lim, TP_H };
})(typeof self !== 'undefined' ? self : this);
