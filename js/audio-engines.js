'use strict';
/* ====================================================================
   Sound processing: EQ and Imager (more tools can join the same list)
   One description of the processing (S.set.fx) is turned into Web Audio nodes. The Audio Editor plays it live, and the same nodes are run
   in an OfflineAudioContext to make the processed sound the video and the exports use, so what you hear is what you get.
   The tools can sit in any order; Level and Fades always come last.
   ==================================================================== */
const FX_TOOLS = ['eq', 'imager'];
const EQ_TYPES = { peaking: 'Bell', lowshelf: 'Low shelf', highshelf: 'High shelf', highpass: 'High-pass', lowpass: 'Low-pass', notch: 'Notch' };
const EQ_MAX_BANDS = 10;
const NR_POINTS = 240;          // the noise profile has one level for each point of the EQ's frequency axis
const FX_DEFAULT = { order: FX_TOOLS.slice(), noise: { on: false, profile: null, auto: false, hum: null, mode: 'natural', reduction: 12, sensitivity: 50, smoothing: 50, dur: 0 }, eq: { on: false, bands: [], lin: false, auto: false }, spec: { on: false, edits: [] }, imager: { on: false, width: 100, monoBass: 0, bw: [100, 100, 100], bal: 0 } };
const fxClone = fx => JSON.parse(JSON.stringify(fx));
/* the browser reads Q for high-pass and low-pass in dB (resonance); here Q is the usual number, where 0.71 is perfectly flat */
const eqNodeQ = (t, q) => t === 'highpass' || t === 'lowpass' ? 20 * Math.log10(q) : q;
const eqSlope = b => (b.type === 'highpass' || b.type === 'lowpass') && (b.slope === 24 || b.slope === 48) ? b.slope : 12;          // dB per octave: a high-pass or low-pass can be made steeper
const eqNoGain = t => t === 'highpass' || t === 'lowpass' || t === 'notch';          // these types have no gain control
/* keeps only values the processing understands (a damaged or hand-edited file can't break anything) */
function fxNorm(fx) {
  const out = fxClone(FX_DEFAULT); if (!fx || typeof fx !== 'object') return out;
  const num = (v, a, b, d) => Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, a, b) : d;
  if (Array.isArray(fx.order)) { const o = fx.order.filter((k, i) => FX_TOOLS.includes(k) && fx.order.indexOf(k) === i); FX_TOOLS.forEach(k => { if (!o.includes(k)) o.push(k); }); out.order = o; }
  if (fx.eq && typeof fx.eq === 'object') {
    out.eq.on = fx.eq.on === true; out.eq.lin = false; out.eq.auto = fx.eq.auto === true;
    if (Array.isArray(fx.eq.curve) && fx.eq.curve.length === 240 && fx.eq.curve.every(v => typeof v === 'number' && isFinite(v)) && fx.eq.curve.some(v => Math.abs(v) >= 0.05)) out.eq.curve = fx.eq.curve.map(v => Math.round(clamp(v, -15, 15) * 10) / 10);
    if (Array.isArray(fx.eq.bands)) out.eq.bands = fx.eq.bands.filter(b => b && EQ_TYPES[b.type]).slice(0, EQ_MAX_BANDS).map(b => Object.assign({ type: b.type, f: Math.round(num(b.f, 20, 20000, 1000)), g: eqNoGain(b.type) ? 0 : Math.round(num(b.g, -12, 12, 0) * 10) / 10, q: Math.round(num(b.q, 0.1, 18, 1) * 100) / 100, on: b.on !== false }, eqSlope(b) > 12 ? { slope: eqSlope(b) } : {}, b.place === 'mid' || b.place === 'side' ? { place: b.place } : {}, KFX.eqDynOk(b.type) && b.dyn && typeof b.dyn === 'object' ? { dyn: Object.assign({ thr: Math.round(num(b.dyn.thr, -80, 0, -30)), range: Math.round(num(b.dyn.range, -24, 24, 0)) }, Number.isFinite(+b.dyn.auto) && b.dyn.auto !== null && b.dyn.auto !== '' ? { auto: Math.round(num(b.dyn.auto, -80, 0, -30)), prev: Math.round(num(b.dyn.prev, -80, 0, -30)) } : {}) } : {}));
  }
  if (fx.noise && typeof fx.noise === 'object') {
    const nz = fx.noise, o = out.noise; o.on = nz.on === true; o.mode = nz.mode === 'classic' ? 'classic' : 'natural'; o.reduction = Math.round(num(nz.reduction, 0, 30, 12)); o.sensitivity = Math.round(num(nz.sensitivity, 0, 100, 50)); o.smoothing = Math.round(num(nz.smoothing, 0, 100, 50)); o.dur = Math.round(num(nz.dur, 0, 3600, 0) * 10) / 10;
    if (Array.isArray(nz.profile) && nz.profile.length === NR_POINTS && nz.profile.every(v => typeof v === 'number' && isFinite(v))) { o.profile = nz.profile.map(v => Math.round(clamp(v, -300, 100) * 10) / 10); o.auto = nz.auto === true; }
    if (nz.hum && typeof nz.hum === 'object' && Number.isFinite(+nz.hum.f) && Math.min(Math.abs(nz.hum.f - 50), Math.abs(nz.hum.f - 60)) <= 0.6 && Array.isArray(nz.hum.n)) { const hn = [...new Set(nz.hum.n.filter(h => Number.isInteger(h) && h >= 1 && h <= 24))].sort((a, b) => a - b); if (hn.length) o.hum = { f: Math.round(nz.hum.f * 100) / 100, n: hn }; }          // a mains hum: its frequency and which multiples of it are taken out
  }
  if (fx.spec && Array.isArray(fx.spec.edits)) out.spec.edits = fx.spec.edits.filter(e => e && Number.isFinite(+e.a) && Number.isFinite(+e.b) && +e.b > +e.a && Number.isFinite(+e.f0) && Number.isFinite(+e.f1) && +e.f1 > +e.f0).slice(0, 40).map(e => ({ a: Math.round(num(e.a, 0, 36000, 0) * 1000) / 1000, b: Math.round(num(e.b, 0, 36000, 0) * 1000) / 1000, f0: Math.round(num(e.f0, 20, 24000, 20)), f1: Math.round(num(e.f1, 20, 24000, 20000)), mode: e.mode === 'cut' ? 'cut' : 'heal', db: Math.round(num(e.db, 3, 60, 24)) }));
  out.spec.on = out.spec.edits.length > 0;
  if (fx.imager && typeof fx.imager === 'object') { out.imager.on = fx.imager.on === true; out.imager.width = Math.round(num(fx.imager.width, 0, 200, 100)); out.imager.monoBass = Math.round(num(fx.imager.monoBass, 0, 500, 0)); out.imager.bal = Math.round(num(fx.imager.bal, -12, 12, 0) * 10) / 10; if (Array.isArray(fx.imager.bw)) out.imager.bw = [0, 1, 2].map(i => Math.round(num(fx.imager.bw[i], 0, 200, 100))); }
  return out;
}
/* the tools that really change the sound, in order (an Imager needs two channels) */
const imBands = im => im.bw && im.bw.some(v => v !== 100);
const imActive = im => im.width !== 100 || im.monoBass > 0 || !!im.bal || imBands(im);
const eqHas = fx => fx.eq.bands.some(b => b.on) || !!fx.eq.curve;          // the EQ has something to do: a band that is on, or a free curve
function fxActive(fx, nch) {
  const list = fx.order.filter(k => k === 'eq' ? fx.eq.on && eqHas(fx) : k === 'imager' ? fx.imager.on && nch === 2 && imActive(fx.imager) : false);
  return (fx.noise.on && nrReady(fx.noise)) || (fx.spec.on && fx.spec.edits.length) ? ['noise'].concat(list) : list;          // noise reduction always runs first: it has to hear the noise as it was learned
}
const fxSig = (fx, nch) => JSON.stringify(fxActive(fx, nch).map(k => k === 'noise' ? [k, nrSig(fx.noise), seSig(fx.spec)] : k === 'eq' ? [k, fx.eq.bands.filter(b => b.on), !!fx.eq.lin, !!fx.eq.auto, fx.eq.solo || 0, fx.eq.curve || 0] : [k, fx[k]]));
/* what has to stay the same for the live nodes to be adjusted in place; anything else rebuilds them */
const fxShape = (fx, nch) => JSON.stringify(fxActive(fx, nch).filter(k => k !== 'noise').map(k => k === 'eq' ? [k, fx.eq.bands.filter(b => b.on).map(b => b.type + (eqSlope(b) > 12 ? eqSlope(b) : '') + (KFX.eqPlace(b, nch) === 'st' ? '' : KFX.eqPlace(b, nch)) + (b.dyn && KFX.eqDynOk(b.type) ? 'dyn' : '')), !!fx.eq.lin, fx.eq.solo || 0] : [k, fx.imager.monoBass > 0 ? (fx.imager.monoBass < IM_X1 ? 1 : 2) : 0, imBands(fx.imager)]));
/* the response of a list of EQ bands, in dB, at the given frequencies (the browser's own filter maths) */
/* the EQ's curve in dB at the given frequencies, from the EQ's own filters (audio-fx.js), the ones every preview and export runs */
function eqResp(ctx, bands, fr, pick) {
  const out = new Float32Array(fr.length), sr = ctx.sampleRate;
  bands.filter(b => b.on && (!pick || pick(b))).forEach(b => KFX.eqSections(b, sr).forEach(c => { for (let i = 0; i < out.length; i++) out[i] += 20 * Math.log10(Math.max(1e-6, KFX.bqMag(c, fr[i], sr))); }));
  return out;
}
/* Auto gain: how much the EQ raises or lowers the sound overall (the average of its curve between 80 Hz and 10 kHz, every octave counting the same), so it can be taken back off and a before and after sound equally loud */
const eqCompGain = (ctx, bands, nch) => KFX.eqTrim(bands.filter(b => b.on), ctx.sampleRate, nch);
/* Linear phase: the same curve as a symmetric FIR filter, so every frequency is delayed the same and nothing smears in time. Cut to a Blackman window, 8192 long. */
const EQ_FIR = 8192;
const fftTab = {};
function fftN(re, im) {
  const n = re.length; let T = fftTab[n];
  if (!T) { T = fftTab[n] = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) }; for (let i = 0; i < n / 2; i++) { T.c[i] = Math.cos(2 * Math.PI * i / n); T.s[i] = -Math.sin(2 * Math.PI * i / n); } }
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const half = len >> 1, step = n / len; for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++) { const a = i + k, b = a + half, wr = T.c[k * step], wi = T.s[k * step], xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
}
function eqFirBuffer(ctx, bands) {
  const N = EQ_FIR, half = N / 2, sr = ctx.sampleRate, fr = new Float32Array(half + 1); for (let k = 0; k <= half; k++) fr[k] = Math.max(1, k * sr / N);
  const db = eqResp(ctx, bands, fr), re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= half; k++) { const m = Math.pow(10, db[k] / 20); re[k] = m; if (k > 0 && k < half) re[N - k] = m; }
  fftN(re, im);
  const buf = ctx.createBuffer(1, N, sr), d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) { const t = (i - half), w = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (N - 1)); d[i] = re[(t + N) % N] / N * w; }
  return buf;
}
function fxEq(ctx, eq, nch) {
  const lin = !!eq.lin, auto = !!eq.auto, off = /Offline/.test(ctx.constructor.name), trim = ctx.createGain(); let tm = 0;
  const comp = bands => auto ? eqCompGain(ctx, bands, nch || 2) : 1;
  if (lin) {
    const conv = ctx.createConvolver(); conv.normalize = false; conv.connect(trim);
    const set = bands => { conv.buffer = eqFirBuffer(ctx, bands); trim.gain.value = comp(bands); };
    set(eq.bands);
    return { input: conv, output: trim, update(next) { clearTimeout(tm); tm = setTimeout(() => set(next.bands), off ? 0 : 60); }, dispose() { clearTimeout(tm); conv.disconnect(); trim.disconnect(); } };
  }
  const sr = ctx.sampleRate, n2 = nch || 2, on = (eq.curve ? KFX.eqCurveBands(eq.curve, sr) : []).concat(eq.bands).filter(b => b.on), ms = KFX.eqMS({ bands: on, solo: eq.solo }, n2);          // a silent render: the browser's fixed filters, given the EQ's own numbers (what is heard is worked out in the player, see fxLive)
  const codeOf = b => { const p = KFX.eqPlace(b, n2); return p === 'mid' ? 1 : p === 'side' ? 2 : p === 'none' ? 3 : 0; }, items = [];
  on.forEach(x => KFX.eqSections(x, sr).forEach(c => items.push({ code: codeOf(x), nodes: [], make: () => ctx.createIIRFilter([c[0], c[1], c[2]], [1, c[3], c[4]]) })));
  const net = eqNet(ctx, items, ms, eq.solo === 'mid' ? 1 : eq.solo === 'side' ? 2 : 0); net.output.connect(trim); trim.gain.value = auto ? eqCompGain(ctx, on, n2) : 1;
  return { input: net.input, output: trim, update() {}, dispose() { net.dispose(); trim.disconnect(); } };
}
/* a list of filters (each with the place it works on) laid out as nodes: one chain on the whole sound, or, when a band sits on the mid or the side, the sound split into mid and side, each through only its own filters, and put back together as left and right */
function eqNet(ctx, items, ms, solo) {
  const extra = [], mk = n => (extra.push(n), n), gain = v => { const n = mk(ctx.createGain()); n.gain.value = v; return n; };
  const wire = (src, ok) => { let t = src; items.forEach(it => { if (!ok(it.code)) return; const n = it.make(); it.nodes.push(n); t.connect(n); t = n; }); return t; };
  const dispose = () => { items.forEach(it => it.nodes.forEach(n => { try { n.disconnect(); } catch (e) {} })); extra.forEach(n => { try { n.disconnect(); } catch (e) {} }); };
  if (!ms) { const inp = gain(1); return { input: inp, output: wire(inp, c => c !== 3), dispose }; }
  const split = mk(ctx.createChannelSplitter(2)), merge = mk(ctx.createChannelMerger(2)), mid = gain(1), side = gain(1), lS = gain(1), rS = gain(1), inv = gain(-1);
  const hl = gain(0.5), hr = gain(0.5), sl = gain(0.5), sr = gain(-0.5);          // mid = (L + R) / 2, side = (L - R) / 2
  split.connect(hl, 0); split.connect(hr, 1); hl.connect(mid); hr.connect(mid); split.connect(sl, 0); split.connect(sr, 1); sl.connect(side); sr.connect(side);
  const m = wire(mid, k => k !== 2), sd = wire(side, k => k !== 1), sGate = gain(solo === 1 ? 0 : 1), mGate = gain(solo === 2 ? 0 : 1);
  m.connect(mGate); sd.connect(sGate); mGate.connect(lS); sGate.connect(lS); mGate.connect(rS); sGate.connect(inv); inv.connect(rS); lS.connect(merge, 0, 0); rS.connect(merge, 0, 1);
  return { input: split, output: merge, dispose };
}
/* mid/side: width scales the side signal; "keep low frequencies centered" removes the side signal below a frequency; width can also be set separately for the low, middle, and high of the spectrum (24 dB per octave crossovers); balance trades level between the two sides with a pure gain, so nothing is filtered or lost */
const IM_X1 = 250, IM_X2 = 4000;
function fxImager(ctx, im) {
  const all = [], mk = n => (all.push(n), n), gain = v => { const n = mk(ctx.createGain()); n.gain.value = v; return n; };
  const lr4 = (type, f) => [0, 1].map(() => { const n = mk(ctx.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = eqNodeQ(type, Math.SQRT1_2); return n; });
  const chain = (src, fs) => { let t = src; fs.forEach(n => { t.connect(n); t = n; }); return t; };
  const split = mk(ctx.createChannelSplitter(2)), merge = mk(ctx.createChannelMerger(2)), mid = mk(ctx.createGain()), sideIn = mk(ctx.createGain()), inv = gain(-1);
  const a = gain(0.5), b = gain(0.5), c = gain(0.5), d = gain(-0.5);
  split.connect(a, 0); split.connect(b, 1); a.connect(mid); b.connect(mid);           // mid = (L + R) / 2
  split.connect(c, 0); split.connect(d, 1); c.connect(sideIn); d.connect(sideIn);     // side = (L - R) / 2
  /* Center low notes and the three width zones both split the sound at crossover frequencies (24dB per octave). The middle goes through exactly the same splitter as the sides (every zone at full level), so the two never drift out of step with each other and the left and right levels stay exactly as they were wherever the width is unchanged. */
  const xsOf = n => { const mb = n.monoBass > 0 ? n.monoBass : 0, multi = imBands(n), L = []; if (multi) { if (mb && mb < IM_X1) L.push(mb); L.push(IM_X1); if (mb && mb >= IM_X1) L.push(mb); L.push(IM_X2); } else if (mb) L.push(mb); return L; };
  const bwOf = (n, upper) => { const bw = n.bw || [100, 100, 100]; return (upper <= IM_X1 ? bw[0] : upper <= IM_X2 ? bw[1] : bw[2]) / 100; };
  const gainsOf = (n, F) => { const mb = n.monoBass > 0 ? n.monoBass : 0, w = n.width / 100; return F.concat([Infinity]).map(up => (mb && up <= mb) ? 0 : w * bwOf(n, up)); };
  const F0 = xsOf(im), net = (src, F) => {          // the bands from low to high; each lower band also passes the allpass of every crossover above it, so the bands add back to a perfectly flat sound
    const outs = [], fn = F.map(() => []), ap = (x, k) => { const s = mk(ctx.createGain()), lo = lr4('lowpass', F[k]), hi = lr4('highpass', F[k]); chain(x, lo).connect(s); chain(x, hi).connect(s); fn[k].push(...lo, ...hi); return s; };
    let rest = src; F.forEach((f, i) => { const lo = lr4('lowpass', f), hi = lr4('highpass', f); fn[i].push(...lo, ...hi); outs.push(chain(rest, lo)); rest = chain(rest, hi); }); outs.push(rest);
    for (let b = 0; b < F.length; b++) for (let k = b + 1; k < F.length; k++) outs[b] = ap(outs[b], k);
    return { outs, fn };
  };
  let sideOut, midOut, sideNet = null, midNet = null, sideG = [];
  if (F0.length) {
    sideOut = mk(ctx.createGain()); midOut = mk(ctx.createGain()); sideNet = net(sideIn, F0); midNet = net(mid, F0);
    gainsOf(im, F0).forEach((v, k) => { const g = gain(v); sideG.push(g); sideNet.outs[k].connect(g); g.connect(sideOut); }); midNet.outs.forEach(o => o.connect(midOut));
  } else { sideOut = gain(im.width / 100); sideIn.connect(sideOut); midOut = mid; }
  const dbG = v => Math.pow(10, v / 20), balL = () => dbG(-Math.max(0, im.bal || 0) / 2 + Math.max(0, -(im.bal || 0)) / 2), balR = () => dbG(Math.max(0, im.bal || 0) / 2 - Math.max(0, -(im.bal || 0)) / 2);
  const lSum = gain(balL()), rSum = gain(balR());                                      // L = mid + side, R = mid - side, each with its share of the balance
  midOut.connect(lSum); midOut.connect(rSum); sideOut.connect(lSum); sideOut.connect(inv); inv.connect(rSum); lSum.connect(merge, 0, 0); rSum.connect(merge, 0, 1);
  const live = typeof AudioContext !== 'undefined' && ctx instanceof AudioContext, sm = (a, v) => { if (live) a.setTargetAtTime(v, ctx.currentTime, 0.015); else a.value = v; };          // while the sound plays, a moved slider glides to its new value over a few milliseconds, so there is no zipper noise or click
  return { input: split, output: merge, update(n) {
    const F = xsOf(n); if (F0.length) { gainsOf(n, F).forEach((v, k) => { if (sideG[k]) sm(sideG[k].gain, v); }); [sideNet, midNet].forEach(nt => nt.fn.forEach((nodes, i) => nodes.forEach(x => { sm(x.frequency, F[i]); }))); } else sm(sideOut.gain, n.width / 100);
    const bl = n.bal || 0; sm(lSum.gain, dbG(-Math.max(0, bl) / 2 + Math.max(0, -bl) / 2)); sm(rSum.gain, dbG(Math.max(0, bl) / 2 - Math.max(0, -bl) / 2));
  }, dispose() { all.forEach(n => { try { n.disconnect(); } catch (e) {} }); } };
}
function fxBuild(ctx, fx, nch) {
  const inp = ctx.createGain(), out = ctx.createGain(); inp.channelCount = nch; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers';
  const mods = []; let prev = inp;
  fxActive(fx, nch).filter(k => k !== 'noise').forEach(k => { const m = k === 'eq' ? fxEq(ctx, fx.eq, nch) : fxImager(ctx, fx.imager); prev.connect(m.input); prev = m.output; mods.push([k, m]); });
  prev.connect(out);
  const shape = fxShape(fx, nch);
  return { input: inp, output: out, update(next) { if (fxShape(next, nch) !== shape) return false; return mods.every(([k, m]) => m.update(next[k]) !== false); }, dispose() { mods.forEach(([, m]) => m.dispose()); try { inp.disconnect(); out.disconnect(); } catch (e) {} } };
}
/* the EQ and the Imager as the player takes them, to be worked out on the audio thread while the sound plays: every filter's numbers in order (audio-fx.js, the ones every preview and export runs).
   next(fx) gives the new numbers for the same filters (the player glides to them), or null when the filters themselves are different and have to be made again */
function eqLive(sr, eq, nch) {
  const on = (eq.curve ? KFX.eqCurveBands(eq.curve, sr) : []).concat(eq.bands).filter(b => b.on), ms = KFX.eqMS({ bands: on, solo: eq.solo }, nch), coefs = [], items = [], dyn = [];          // a free curve first, then the bands
  on.forEach(x => { const p = KFX.eqPlace(x, nch), c = p === 'mid' ? 1 : p === 'side' ? 2 : p === 'none' ? 3 : 0;
    if (x.dyn && KFX.eqDynOk(x.type)) { items.push({ s: -1, d: dyn.length, c }); dyn.push(KFX.eqDynSpec(x, sr, ms && c === 0 ? 2 : 1)); }
    else KFX.eqSections(x, sr).forEach(q => { items.push({ s: coefs.length / 5, d: -1, c }); coefs.push.apply(coefs, q); }); });
  return { k: 'eq', nch, coefs, items, dyn, gain: eq.auto ? KFX.eqTrim(on, sr, nch) : 1, ms, solo: eq.solo === 'mid' ? 1 : eq.solo === 'side' ? 2 : 0 };
}
function imLive(sr, im) { const p = KFX.plan([{ k: 'imager', width: im.width, monoBass: im.monoBass, bw: im.bw, bal: im.bal }], sr, 2); return { k: 'im', ops: p.ops, coefs: [].concat(...p.coefs), lines: p.lines, nbq: p.nbq, out: p.out }; }
function fxLive(sr, fx, nch) {
  const shape = fxShape(fx, nch), make = f => fxActive(f, nch).filter(k => k !== 'noise').map(k => k === 'eq' ? eqLive(sr, f.eq, nch) : imLive(sr, f.imager)), mods = make(fx);
  return { mods, next(f) { if (fxShape(f, nch) !== shape) return null; const m = make(f); return m.length === mods.length && m.every((x, i) => x.k === mods[i].k && x.coefs.length === mods[i].coefs.length && (x.k === 'eq' ? x.items.length === mods[i].items.length : x.ops.length === mods[i].ops.length)) ? m : null; } };
}
/* the same description of the processing in the plain form the disk store's tools take (audio-fx.js): only what changes the sound, in the order it runs */
function fxRecipe(fx, nch) {
  const act = fxActive(fx, nch), pre = act[0] === 'noise', nz = fx.noise;
  return { noise: pre && nrReady(nz) ? { profile: nrCleans(nz) ? nz.profile : null, reduction: nz.reduction, sensitivity: nz.sensitivity, smoothing: nz.smoothing, mode: nz.mode, hum: nz.hum || null } : null, axis: Array.from(eqAxis), edits: pre ? fx.spec.edits : [],
    tools: act.filter(k => k !== 'noise').map(k => k === 'eq' ? { k, bands: fx.eq.bands.filter(b => b.on), auto: !!fx.eq.auto, solo: fx.eq.solo || 0, curve: fx.eq.curve || null } : { k, width: fx.imager.width, monoBass: fx.imager.monoBass, bw: fx.imager.bw, bal: fx.imager.bal }) };
}
/* the processed sound (the same nodes, rendered faster than real time) is kept for the current settings, with its waveform peaks */
const FXC = new Map();
function calcPeaks(buffer) {
  const per = Math.max(1, Math.floor(buffer.sampleRate / 100)), len = Math.ceil(buffer.length / per), peaks = new Float32Array(len), chs = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
  let mx = 0;
  for (let i = 0; i < len; i++) {
    let m = 0; const a = i * per, b = Math.min(buffer.length, a + per);
    for (let c = 0; c < chs.length; c++) { const d = chs[c]; for (let k = a; k < b; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > m) m = v; } }
    peaks[i] = m; if (m > mx) mx = m;
  }
  return { peaks, peakMax: mx || 1 };
}
/* true peaks: the loudest the sound gets between the samples, as a speaker or an AAC encoder will see it. Per 10 ms like the sample peaks, found by 4x oversampling (a windowed sinc) around the loud samples only, so it stays quick. */
const TPK = new WeakMap(); let TP_VER = 0;
const TP_H = (() => { const T = 12, out = []; for (const f of [0.25, 0.5, 0.75]) { const row = []; for (let k = -T + 1; k <= T; k++) { const t = k - f, s = Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t), w = 0.5 + 0.5 * Math.cos(Math.PI * t / T); row.push(s * w); } out.push(row); } return out; })();
async function tpCompute(buffer) {
  const per = Math.max(1, Math.floor(buffer.sampleRate / 100)), len = Math.ceil(buffer.length / per), out = new Float32Array(len), n = buffer.length; let t0 = performance.now();          // works in slices of a few milliseconds, so the page stays smooth while a long recording is measured in the background
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const a = i * per, b = Math.min(n, a + per); let pk = 0; for (let k = a; k < b; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > pk) pk = v; }
      let m = pk; const lim = pk * 0.5;
      if (pk > 1e-5) for (let k = a; k < b; k++) {
        const v = d[k] < 0 ? -d[k] : d[k]; if (v < lim) continue;
        for (let p = 0; p < 3; p++) { const row = TP_H[p]; let y = 0; for (let j = 0; j < 24; j++) { const q = k - 11 + j; if (q >= 0 && q < n) y += d[q] * row[j]; } if (y < 0) y = -y; if (y > m) m = y; }
      }
      if (m > out[i]) out[i] = m;
      if ((i & 63) === 63 && performance.now() - t0 > 4) { await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
    }
  }
  return out;
}
/* the live meter's true peak: the same 4x oversampling, run on the last few milliseconds the analyser holds. Only loud samples are checked, so it stays cheap enough for every frame. */
function liveTruePeak(d) {
  const n = d.length; let pk = 0; for (let k = 0; k < n; k++) { const v = d[k] < 0 ? -d[k] : d[k]; if (v > pk) pk = v; }
  if (pk <= 1e-5) return 0;
  let m = pk; const lim = pk * 0.5;
  for (let k = 0; k < n; k++) {
    const v = d[k] < 0 ? -d[k] : d[k]; if (v < lim) continue;
    for (let p = 0; p < 3; p++) { const row = TP_H[p]; let y = 0; for (let j = 0; j < 24; j++) { const q = k - 11 + j; if (q >= 0 && q < n) y += d[q] * row[j]; } if (y < 0) y = -y; if (y > m) m = y; }
  }
  return m;
}
/* the true peaks of a buffer, or its sample peaks while they are still being worked out */
function tpGet(buffer, peaks) {
  let e = TPK.get(buffer); if (e) return e.tp || peaks;
  e = { tp: null }; TPK.set(buffer, e);
  tpCompute(buffer).then(tp => { e.tp = tp; TP_VER++; if (typeof tpReady === 'function') tpReady(); }, () => {});
  return peaks;
}
/* the recording's shape, whether it is held in memory (S.audio.buffer) or lives on the disk store (S.audio.disk, no buffer) */
const audCh = () => S.audio.buffer ? S.audio.buffer.numberOfChannels : S.audio.ch;
const audSr = () => S.audio.buffer ? S.audio.buffer.sampleRate : S.audio.sr;
const audLen = () => S.audio.buffer ? S.audio.buffer.length : S.audio.frames;
const srcTp = src => src.buffer ? tpGet(src.buffer, src.peaks) : (src.tp || src.peaks);          // true peaks when they are known, else the sample peaks
const srcLen = src => src.buffer ? src.buffer.length : src.frames;
const DW = { at: -1, n: 0, len: 0, chans: null, busy: false };
function diskWindow(at, n) {          // the latest read of n frames from the store near at (one read at a time); null until the first one is in
  if (!DW.busy && (DW.at !== at || DW.n !== n)) { DW.busy = true; DISK.read(at, n).then(r => { if (S.audio && S.audio.disk) { DW.at = at; DW.n = n; DW.len = r.chans[0].length; DW.chans = r.chans; } }, () => {}).then(() => { DW.busy = false; }); }
  return DW.chans ? DW : null;
}
/* a part of the app that still works only on a recording held in memory says so, instead of failing, when the recording is on the disk store. Gives true when it said so */
const fxChannels = () => Math.min(2, audCh());
const fxKey = fx => S.audio.name + '|' + audLen() + '|' + fxSig(fx, fxChannels());
/* EQ and Imager over a recording held in memory, by the app's own sums (audio-fx.js, the code the disk store runs) instead of the browser's silent renderer.
   The two give the same samples, but Safari's fingerprinting protection adds a little noise to whatever its renderer hands back to a page; the app's own sums are never touched.
   Worked a block at a time with a pause whenever a few milliseconds have gone by, so the page stays smooth. */
async function fxOwn(buf, fx, nch) {
  const rec = fxRecipe(fx, nch), n = buf.length, src = [], out = new AudioBuffer({ length: n, numberOfChannels: nch, sampleRate: buf.sampleRate }), B = 1 << 15;
  for (let c = 0; c < nch; c++) src.push(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
  const chn = KFX.chain({ key: 'memory', sr: buf.sampleRate, ch: nch, frames: n, read: async (a, m) => src.map(x => x.subarray(a, a + m)) }, { noise: null, axis: rec.axis, edits: [], tools: rec.tools }, null); let t0 = performance.now();
  for (let p = 0; p < n; p += B) { const r = await chn.read(p, Math.min(B, n - p), true); for (let c = 0; c < nch; c++) out.copyToChannel(r.chans[c], c, p); if (performance.now() - t0 > 6) { await new Promise(res => setTimeout(res, 0)); t0 = performance.now(); } }
  return out;
}
/* what is ready for these settings right now: the processed sound, or the original when nothing changes it (null while it is still being made) */
function fxPeek(fx) { if (!S.audio) return null; if (!fxActive(fx, fxChannels()).length) return S.audio; const h = FXC.get(fxKey(fx)); return h && !h.then ? h : null; }
async function fxGet(fx, opts) {
  if (!S.audio) return null;
  const nch = fxChannels(), act = fxActive(fx, nch); if (!act.length) return S.audio;
  if (S.audio.disk) {          // the recording is on the disk store: one pass over the processed sound there gives its waveform heights (and keeps a processed copy on disk for the measuring and playing that follow)
    const key = fxKey(fx), hit = FXC.get(key); if (hit) return hit.then ? await hit : hit;
    const nz = act.includes('noise'), job = (async () => { DISK.fxUse(fx); if (nz && NRJ.onProg) NRJ.onProg(0); try { const r = await DISK.scan({ onProgress: v => { if (nz && NRJ.onProg) NRJ.onProg(v * 0.999); } }); if (nz && NRJ.onProg) NRJ.onProg(1); return Object.assign({ disk: true, frames: S.audio.frames }, r); } catch (e) { if (nz && NRJ.onProg) NRJ.onProg(1); throw e; } })();          // the noise bar follows the pass
    FXC.set(key, job);
    try { const r = await job; FXC.set(key, r); while (FXC.size > 1) FXC.delete(FXC.keys().next().value); return r; } catch (e) { FXC.delete(key); throw e; }
  }
  const key = fxKey(fx), hit = FXC.get(key); if (hit) return hit.then ? await hit : hit;
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const job = (async () => {
    let buf = S.audio.buffer;
    if (act[0] === 'noise') buf = (await preGet(fx, false, opts)).buffer;          // the cleaned-up sound feeds the rest of the chain
    if (act.length === 1 && act[0] === 'noise') return Object.assign({ buffer: buf }, calcPeaks(buf));
    if (!(opts && opts.browser) && !(act.includes('eq') && fx.eq.lin) && window.KFX) { const own = await fxOwn(buf, fx, nch); return Object.assign({ buffer: own }, calcPeaks(own)); }
    const lag = act.includes('eq') && fx.eq.lin ? EQ_FIR / 2 : 0;          // a linear-phase filter delays everything by half its length; that is taken back off below
    const oc = new OC(nch, buf.length + lag, buf.sampleRate), src = oc.createBufferSource(); src.buffer = buf;
    const chain = fxBuild(oc, fx, nch); src.connect(chain.input); chain.output.connect(oc.destination); src.start(0);
    let rendered = await new Promise((res, rej) => { const p = oc.startRendering(); if (p && p.then) p.then(res, rej); else oc.oncomplete = e => res(e.renderedBuffer); });
    if (lag) { const sh = new AudioBuffer({ length: buf.length, numberOfChannels: rendered.numberOfChannels, sampleRate: rendered.sampleRate }); for (let c = 0; c < sh.numberOfChannels; c++) sh.copyToChannel(rendered.getChannelData(c).subarray(lag, lag + buf.length), c); rendered = sh; }
    return Object.assign({ buffer: rendered }, calcPeaks(rendered));
  })();
  FXC.set(key, job);
  // one finished copy of the sound at a time: each copy is as big as the recording, so older ones are let go
  try { const r = await job; FXC.set(key, r); while (FXC.size > 1) FXC.delete(FXC.keys().next().value); return r; }
  catch (e) { FXC.delete(key); throw e; }
}
/* the sound the video uses (the processed one once it is ready) */
const outSrc = () => fxPeek(S.set.fx) || S.audio;
const outBuf = () => outSrc().buffer;

/* ====================================================================
   Noise reduction
   You show it a stretch of just the noise; it learns that noise's spectrum (a profile), then turns down whatever matches it, everywhere else.
   It is a spectral gate: the sound is cut into short overlapping slices, each slice's frequencies are turned down by how much of them looks like the
   learned noise, and the slices are joined back up. Both channels share one setting so the stereo picture stays put.
   The code is one piece of text so the same thing runs in a background worker (the page stays responsive) or, if workers are missing, in the page.
   Method (general techniques, written out here from scratch). Classic: spectral subtraction with over-subtraction and a gain floor (S. F. Boll, 1979; M. Berouti, R. Schwartz and J. Makhoul, 1979).
   Natural: a Wiener gain from a signal-to-noise estimate that leans on the slice before (the decision-directed estimate of Y. Ephraim and D. Malah, 1984), which keeps leftover hiss steady instead of chirping, and lets go of that
   memory when a note starts; it judges the highs in slices a quarter as long, so the start of a note is caught sooner and no hiss opens ahead of it. Both applied in a short-time Fourier transform with overlap-add (J. B. Allen, 1977).
   ==================================================================== */
const NR_CODE = `
var NR_N = 2048, NR_H = 512, nrT = null;
function nrTables() {
  if (nrT) return nrT; var n = NR_N, c = new Float64Array(n / 2), s = new Float64Array(n / 2), w = new Float64Array(n), r = new Uint16Array(n), bits = Math.round(Math.log(n) / Math.LN2), i, j;
  for (i = 0; i < n / 2; i++) { c[i] = Math.cos(2 * Math.PI * i / n); s[i] = -Math.sin(2 * Math.PI * i / n); }
  for (i = 0; i < n; i++) { w[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); var x = i, y = 0; for (j = 0; j < bits; j++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; }
  return (nrT = { c: c, s: s, w: w, r: r });
}
function nrFFT(re, im, inv) {
  var n = NR_N, T = nrTables(), i, j, k, len, half, step, a, b, wr, wi, xr, xi, t;
  if (inv) for (i = 0; i < n; i++) im[i] = -im[i];
  for (i = 0; i < n; i++) { j = T.r[i]; if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (len = 2; len <= n; len <<= 1) { half = len >> 1; step = n / len;
    for (i = 0; i < n; i += len) for (k = 0; k < half; k++) { a = i + k; b = a + half; wr = T.c[k * step]; wi = T.s[k * step]; xr = re[b] * wr - im[b] * wi; xi = re[b] * wi + im[b] * wr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
  if (inv) for (i = 0; i < n; i++) im[i] = -im[i];
}
/* two channels ride in one transform (left as the real part, right as the imaginary part); the power of the pair at bin k comes from bins k and N-k */
function nrPower(re, im, k, nch) { var k2 = (NR_N - k) % NR_N; return (re[k] * re[k] + im[k] * im[k] + re[k2] * re[k2] + im[k2] * im[k2]) / (2 * nch); }
function nrFill(chans, start, re, im, w) {
  var n = NR_N, len = chans[0].length, a = chans[0], b = chans.length > 1 ? chans[1] : null, i, p;
  for (i = 0; i < n; i++) { p = start + i; if (p >= 0 && p < len) { re[i] = a[p] * w[i]; im[i] = b ? b[p] * w[i] : 0; } else { re[i] = 0; im[i] = 0; } }
}
/* the average power at every frequency over a stretch, as dB at the given frequencies */
function nrLearn(chans, sr, from, to, axis) {
  var n = NR_N, T = nrTables(), re = new Float64Array(n), im = new Float64Array(n), pw = new Float64Array(n / 2 + 1), frames = 0, pos, k, nch = chans.length;
  for (pos = from; pos + n <= to; pos += NR_H) { nrFill(chans, pos, re, im, T.w); nrFFT(re, im, false); for (k = 0; k <= n / 2; k++) pw[k] += nrPower(re, im, k, nch); frames++; }
  if (!frames) return null; var tot = 0; for (k = 0; k <= n / 2; k++) { pw[k] /= frames; tot += pw[k]; } if (!(tot > 1e-12)) return null;
  var out = new Array(axis.length), bw = Math.pow(2, 1 / 24), binHz = sr / n, i, lo, hi, s, c;
  for (i = 0; i < axis.length; i++) {
    lo = Math.max(1, Math.floor(axis[i] / bw / binHz)); hi = Math.min(n / 2, Math.ceil(axis[i] * bw / binHz)); s = 0; c = 0;
    for (k = lo; k <= hi; k++) { s += pw[k]; c++; } if (!c) { s = pw[Math.min(n / 2, Math.max(1, Math.round(axis[i] / binHz)))]; c = 1; }
    out[i] = Math.round(10 * Math.log(s / c + 1e-20) / Math.LN10 * 10) / 10;
  }
  return out;
}
/* the profile back as power at every bin */
function nrBins(prof, sr, axis) {
  var n = NR_N, out = new Float64Array(n / 2 + 1), j = 0, k, f, t, db, last = axis.length - 1;
  for (k = 0; k <= n / 2; k++) {
    f = Math.max(axis[0], k * sr / n); while (j < last - 1 && axis[j + 1] < f) j++;
    t = f >= axis[last] ? 1 : (Math.log(f / axis[j]) / Math.log(axis[j + 1] / axis[j])); t = t < 0 ? 0 : t > 1 ? 1 : t; db = prof[j] + (prof[j + 1] - prof[j]) * t; out[k] = Math.pow(10, db / 10);
  }
  return out;
}
/* a mains hum is taken out first (narrow notches, p.hum: their numbers); then the learned noise, when there is one, is turned down */
function nrProcess(chans, sr, prof, p, axis, progress) {
  if (p.hum) nrHum(chans, p.hum);
  if (!prof || !(p.reduction > 0)) { if (progress) progress(1); return chans.map(function (a) { return new Float32Array(a); }); }
  return nrProcess0(chans, sr, prof, p, axis, progress);
}
function nrProcess0(chans, sr, prof, p, axis, progress) {
  var n = NR_N, hop = NR_H, T = nrTables(), nch = chans.length, len = chans[0].length, noise = nrBins(prof, sr, axis), half = n / 2;
  var floorG = Math.pow(10, -p.reduction / 20), alpha = 2 + p.sensitivity / 100 * 4, sm = p.smoothing / 100, bDown = sm * 0.92, bUp = bDown * 0.3, fw = sm > 0.66 ? 2 : sm > 0.25 ? 1 : 0;
  var nat = p.mode === 'natural', K = nat ? nrNatSetup(prof, sr, axis, p, nch) : null, xa = nat ? new Float32Array(n) : null, xb = nat && nch > 1 ? new Float32Array(n) : null, ya = nat ? new Float64Array(n) : null, yb = xb ? new Float64Array(n) : null, gsN = nat ? new Float64Array(K.size).fill(1) : null, q, inr;          // Natural: the long slice and its four short ones, the functions of audio-fx.js themselves (put in below)
  var pad = n, total = len + 2 * pad, frames = Math.ceil((total - n) / hop) + 1, out = [], c, f, k, i;
  for (c = 0; c < nch; c++) out.push(new Float32Array(total));
  var re = new Float64Array(n), im = new Float64Array(n), g = new Float64Array(half + 1), g2 = new Float64Array(half + 1), gs = new Float64Array(half + 1), P, G2, G, s, cnt, start, gain, kk, scale = 0.5;
  for (k = 0; k <= half; k++) gs[k] = 1;
  var src = chans.map(function (a) { return a; });
  for (f = 0; f < frames; f++) {
    start = f * hop - pad;
    if (nat) {
      for (i = 0; i < n; i++) { q = start + i; inr = q >= 0 && q < len; xa[i] = inr ? src[0][q] : 0; if (xb) xb[i] = inr ? src[1][q] : 0; }
      nrNatStep(K, xa, xb, gsN, ya, yb, false);
      for (i = 0; i < n; i++) { var oo = start + pad + i; if (oo >= 0 && oo < total) { out[0][oo] += ya[i]; if (xb) out[1][oo] += yb[i]; } }
      if (progress && (f & 63) === 0) progress(f / frames);
      continue;
    }
    nrFill(src, start, re, im, T.w); nrFFT(re, im, false);
    {
    for (k = 0; k <= half; k++) { P = nrPower(re, im, k, nch); G2 = 1 - alpha * noise[k] / (P + 1e-30); G = G2 <= floorG * floorG ? floorG : Math.sqrt(G2); g[k] = G; }
    if (fw) for (k = 0; k <= half; k++) { s = 0; cnt = 0; for (i = k - fw; i <= k + fw; i++) if (i >= 0 && i <= half) { s += g[i]; cnt++; } g2[k] = s / cnt; } else for (k = 0; k <= half; k++) g2[k] = g[k];
    for (k = 0; k <= half; k++) { G = g2[k]; gs[k] = G > gs[k] ? gs[k] * bUp + G * (1 - bUp) : gs[k] * bDown + G * (1 - bDown); }
    }
    for (k = 0; k < n; k++) { kk = k <= half ? k : n - k; gain = gs[kk]; re[k] *= gain; im[k] *= gain; }
    nrFFT(re, im, true);
    for (i = 0; i < n; i++) { var o = start + pad + i; if (o >= 0 && o < total) { out[0][o] += re[i] * T.w[i] * scale / n; if (nch > 1) out[1][o] += im[i] * T.w[i] * scale / n; } }
    if (progress && (f & 63) === 0) progress(f / frames);
  }
  return out.map(function (a) { return a.subarray(pad, pad + len); }).map(function (a) { return new Float32Array(a); });
}
` + [KFX.nrTab, KFX.nrFFTn, KFX.nrBinsN, KFX.nrNatSetup, KFX.nrNatGain, KFX.nrNatStep, KFX.nrHum].map(String).join('\n') + '\n';          // Natural's own functions, the very text audio-fx.js runs, so a recording in memory and one on the disk store are cleaned by the same sums
const NR_WORKER_SRC = NR_CODE + `
onmessage = function (e) { var m = e.data, out = nrProcess(m.chans, m.sr, m.prof, m.p, m.axis, function (v) { postMessage({ t: 'p', v: v }); }); postMessage({ t: 'd', out: out }, out.map(function (a) { return a.buffer; })); };`;
const NR = new Function(NR_CODE + '; return { nrLearn: nrLearn, nrProcess: nrProcess };')();
const NRC = new Map(), NRJ = { pv: null, prog: 0, onProg: null };
const nrHash = a => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 10) & 0xffff; h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
const nrSig = n => [n.mode, n.reduction, n.sensitivity, n.smoothing, nrHash(n.profile || []), n.hum ? n.hum.f + ':' + n.hum.n.join(',') : ''].join('|');
const nrKey = n => S.audio.name + '|' + audLen() + '|' + nrSig(n);
const nrCleans = n => !!(n.profile && n.reduction > 0), nrReady = n => nrCleans(n) || !!n.hum;          // the noise stage has work: a learned noise to turn down, or a mains hum to take out
function nrPeek(n, listen) { if (!S.audio || !nrReady(n)) return null; const h = NRC.get(nrKey(n) + (listen ? '|L' : '')); return h && !h.then ? h : null; }
function nrRun(buf, nch, n, onProg) {
  if (onProg) onProg(0);          // shows at once: the bar and the light appear before the worker's first tick
  const mk = () => { const a = []; for (let c = 0; c < nch; c++) a.push(new Float32Array(buf.getChannelData(c))); return a; };
  const args = { sr: buf.sampleRate, prof: nrCleans(n) ? n.profile : null, p: { reduction: n.reduction, sensitivity: n.sensitivity, smoothing: n.smoothing, mode: n.mode, hum: n.hum ? KFX.humBands(n.hum).map(b => KFX.eqSections(b, buf.sampleRate)[0]) : null }, axis: Array.from(eqAxis) };
  let worker = null, rejectFn = null, over = false;
  const promise = new Promise((res, rej) => {
    rejectFn = rej;
    const finish = out => { if (over) return; over = true; if (onProg) onProg(1); const ab = ensureCtx().createBuffer(nch, buf.length, buf.sampleRate); out.forEach((a, c) => ab.copyToChannel(a, c)); res(ab); };
    const inPage = () => { try { finish(NR.nrProcess(mk(), args.sr, args.prof, args.p, args.axis, null)); } catch (err) { rej(err); } };
    try {
      const url = URL.createObjectURL(new Blob([NR_WORKER_SRC], { type: 'text/javascript' })); worker = new Worker(url);
      worker.onmessage = e => { if (e.data.t === 'p') { if (onProg) onProg(e.data.v); } else { worker.terminate(); URL.revokeObjectURL(url); finish(e.data.out); } };
      worker.onerror = () => { if (worker) worker.terminate(); worker = null; inPage(); };
      const chans = mk(); worker.postMessage(Object.assign({ chans }, args), chans.map(a => a.buffer));
    } catch (e) { worker = null; inPage(); }
  });
  return { promise, cancel() { over = true; if (worker) { worker.terminate(); worker = null; } if (rejectFn) rejectFn(new Error('cancelled')); } };
}
/* the cleaned-up sound for these settings (cached). A preview request replaces an older preview that is still running; "listen" returns what was taken out instead. */
async function nrGet(n, listen, opts) {
  if (S.audio.disk) throw new Error('Noise reduction is not on the disk store yet.');
  const key = nrKey(n), preview = !!(opts && opts.preview); let base = NRC.get(key);
  if (!base) {
    if (preview && NRJ.pv && NRJ.pv.key !== key) NRJ.pv.run.cancel();
    const run = nrRun(S.audio.buffer, fxChannels(), n, v => { NRJ.prog = v; if (NRJ.onProg) NRJ.onProg(v); });
    // the noise cache keeps two results at most (the current cleaning and its preview): each one is a full copy of the recording
    base = run.promise.then(buf => { const r = { buffer: buf }; NRC.set(key, r); while (NRC.size > 2) NRC.delete(NRC.keys().next().value); return r; }, e => { NRC.delete(key); throw e; });
    NRC.set(key, base); NRJ.pv = preview ? { key, run } : null;
  } else if (!preview && NRJ.pv && NRJ.pv.key === key) NRJ.pv = null;          // someone else needs this run now, so a later preview must not cancel it
  const r = base.then ? await base : base; if (!listen) return r;
  const lk = key + '|L'; let lr = NRC.get(lk); if (lr) return lr;
  const orig = S.audio.buffer, nch = r.buffer.numberOfChannels, ab = ensureCtx().createBuffer(nch, orig.length, orig.sampleRate);
  for (let c = 0; c < nch; c++) { const o = orig.getChannelData(c), p = r.buffer.getChannelData(c), d = new Float32Array(orig.length); for (let i = 0; i < d.length; i++) d[i] = o[i] - p[i]; ab.copyToChannel(d, c); }
  lr = { buffer: ab }; NRC.set(lk, lr); return lr;
}

/* ====================================================================
   Spectra
   Rectangles drawn on the spectrogram (a stretch of time and a band of pitch). Each one is either turned down by a set amount, or healed:
   the spectrum inside it is replaced by a smooth bridge between what is just outside (before and after for a short blip, above and below for a long hum).
   Only the short-time Fourier frames that touch a rectangle are redone: their change is added back onto the original, so the rest of the sound stays bit for bit the same.
   ==================================================================== */
const SE_CODE = NR_CODE + `
function seProcess(chans, sr, edits) {
  var n = NR_N, hop = NR_H, T = nrTables(), nch = chans.length, len = chans[0].length, half = n / 2, pad = n, total = len + 2 * pad, binHz = sr / n, F = 2 * hop / sr, scale = 0.5;
  var frames = Math.ceil((total - n) / hop) + 1, d = [], c, e, f, k, i;
  for (c = 0; c < nch; c++) d.push(new Float32Array(total));
  var re = new Float64Array(n), im = new Float64Array(n), dg = new Float64Array(half + 1), r2 = new Float64Array(n), i2 = new Float64Array(n);
  function framePower(centre, out, add) {
    nrFill(chans, Math.round(centre * sr) - half, r2, i2, T.w); nrFFT(r2, i2, false);
    for (var kk = 0; kk <= half; kk++) out[kk] = (add ? out[kk] : 0) + nrPower(r2, i2, kk, nch) + 1e-20;
  }
  function around(centre, dir, out) {          // the average of three frames lying clear of the rectangle on one side
    var j; for (j = 0; j < half + 1; j++) out[j] = 0; for (j = 0; j < 3; j++) framePower(Math.min(len / sr - half / sr, Math.max(half / sr, centre + dir * j * 2 * hop / sr)), out, true);
    for (j = 0; j < half + 1; j++) out[j] = Math.log(out[j] / 3);
  }
  for (e = 0; e < edits.length; e++) {
    var ed = edits[e], a = ed.a, b = ed.b, k0 = Math.max(1, Math.floor(ed.f0 / binHz)), k1 = Math.min(half - 1, Math.ceil(ed.f1 / binHz));
    if (k1 < k0 || b <= a) continue;
    var heal = ed.mode !== 'cut', cutG = Math.pow(10, -(ed.db || 24) / 20), fb = Math.max(2, Math.round((k1 - k0) * 0.08)), byTime = heal && (b - a) * sr / hop < k1 - k0 + 1;
    var La = null, Lb = null;
    if (byTime) { La = new Float64Array(half + 1); Lb = new Float64Array(half + 1); around(a - F - half / sr, -1, La); around(b + F + half / sr, 1, Lb); }
    var fFrom = Math.max(0, Math.ceil(((a - F) * sr + pad - half) / hop)), fTo = Math.min(frames - 1, Math.floor(((b + F) * sr + pad - half) / hop));
    for (f = fFrom; f <= fTo; f++) {
      var start = f * hop - pad, tc = (start + half) / sr, mt = tc < a ? 1 - (a - tc) / F : tc > b ? 1 - (tc - b) / F : 1; if (mt <= 0) continue;
      nrFill(chans, start, re, im, T.w); nrFFT(re, im, false);
      for (k = 0; k <= half; k++) dg[k] = 0;
      var lo = Math.max(1, k0 - fb), hi = Math.min(half - 1, k1 + fb), la = 0, lb = 0, u = byTime ? Math.min(1, Math.max(0, (tc - a) / (b - a))) : 0;
      if (heal && !byTime) { var pl = 0, ph = 0, w = 0; for (i = 1; i <= 3; i++) { pl += Math.log(nrPower(re, im, Math.max(1, k0 - i), nch) + 1e-20); ph += Math.log(nrPower(re, im, Math.min(half - 1, k1 + i), nch) + 1e-20); w++; } la = pl / w; lb = ph / w; }
      for (k = lo; k <= hi; k++) {
        var mf = k < k0 ? 1 - (k0 - k) / (fb + 1) : k > k1 ? 1 - (k - k1) / (fb + 1) : 1, m = mt * mf, G;
        if (!heal) G = cutG;
        else { var P = nrPower(re, im, k, nch) + 1e-20, lt = byTime ? La[k] * (1 - u) + Lb[k] * u : la + (lb - la) * ((k - k0) / Math.max(1, k1 - k0)); G = Math.min(1, Math.sqrt(Math.exp(lt) / P)); }
        dg[k] = -m * (1 - G);
      }
      for (k = 0; k < n; k++) { var kk = k <= half ? k : n - k; re[k] *= dg[kk]; im[k] *= dg[kk]; }
      nrFFT(re, im, true);
      for (i = 0; i < n; i++) { var o = start + pad + i; if (o >= 0 && o < total) { d[0][o] += re[i] * T.w[i] * scale / n; if (nch > 1) d[1][o] += im[i] * T.w[i] * scale / n; } }
    }
  }
  var out = []; for (c = 0; c < nch; c++) { var arr = new Float32Array(len), s0 = chans[c]; for (i = 0; i < len; i++) arr[i] = s0[i] + d[c][pad + i]; out.push(arr); }
  return out;
}
`;
const SE_WORKER_SRC = SE_CODE + `
onmessage = function (e) { var m = e.data, out = seProcess(m.chans, m.sr, m.edits); postMessage({ out: out }, out.map(function (a) { return a.buffer; })); };`;
const SE = new Function(SE_CODE + '; return { seProcess: seProcess };')();
const SEC = new Map();
const seSig = sp => sp && sp.edits.length ? sp.edits.map(e => [e.a, e.b, e.f0, e.f1, e.mode, e.mode === 'cut' ? e.db : 0].join(',')).join(';') : '';
function seRun(buf, edits) {
  const nch = Math.min(2, buf.numberOfChannels), chans = []; for (let c = 0; c < nch; c++) chans.push(new Float32Array(buf.getChannelData(c)));
  return new Promise((res, rej) => {
    const finish = out => { const ab = ensureCtx().createBuffer(nch, buf.length, buf.sampleRate); out.forEach((a, c) => ab.copyToChannel(a, c)); res(ab); };
    const inPage = () => { try { finish(SE.seProcess(chans.map(a => new Float32Array(a)), buf.sampleRate, edits)); } catch (err) { rej(err); } };
    try {
      const url = URL.createObjectURL(new Blob([SE_WORKER_SRC], { type: 'text/javascript' })), w = new Worker(url); URL.revokeObjectURL(url);
      w.onmessage = e => { w.terminate(); finish(e.data.out); }; w.onerror = () => { w.terminate(); inPage(); };
      w.postMessage({ chans, sr: buf.sampleRate, edits }, chans.map(a => a.buffer));
    } catch (err) { inPage(); }
  });
}
/* the sound after the cleaning stage (noise reduction, then Spectra's rectangles) */
const seKey = fx => (nrReady(fx.noise) ? nrKey(fx.noise) : S.audio.name + '|' + audLen()) + '|se|' + seSig(fx.spec);
async function preGet(fx, listen, opts) {
  if (S.audio.disk) throw new Error('The tools are not on the disk store yet.');
  if (listen) return nrGet(fx.noise, true, opts);
  const base = nrReady(fx.noise) ? await nrGet(fx.noise, false, opts) : { buffer: S.audio.buffer };
  if (!fx.spec.edits.length) return base;
  const key = seKey(fx), hit = SEC.get(key); if (hit) return hit.then ? await hit : hit;
  const job = seRun(base.buffer, fx.spec.edits).then(buf => ({ buffer: buf })); SEC.set(key, job);
  // one result at a time: each is a full copy of the recording
  try { const r = await job; SEC.set(key, r); while (SEC.size > 1) SEC.delete(SEC.keys().next().value); return r; } catch (e) { SEC.delete(key); throw e; }
}
function prePeek(fx, listen) {
  if (!S.audio || S.audio.disk) return null; if (listen) return nrPeek(fx.noise, true);
  const base = nrReady(fx.noise) ? nrPeek(fx.noise, false) : { buffer: S.audio.buffer }; if (!base) return null;
  if (!fx.spec.edits.length) return base; const h = SEC.get(seKey(fx)); return h && !h.then ? h : null;
}

/* ---------------- state ---------------- */
const DEFAULTS = { audioKey: '', fx: FX_DEFAULT, flipDur: 1, slideDur: 0.5, ref: 'end', bend: 55, firstAlone: true, pageLayout: 'spread', margin: 3, gutter: 35, bg: '#000000', aspect: '16:9', res: 2160, transition: 'flip', slideDir: 'in', creditsOn: false, creditsAt: 'end', creditsWithLast: true, creditsEarly: false, creditsFont: '', creditsFontEach: false, credTitleB: false, credTitleI: false, credTitleFont: '', credL2B: false, credL2I: false, credL2Font: '', credL3B: false, credL3I: false, credL3Font: '', shadowsOn: true, fadesOn: true, fadeIn: true, fadeOut: true, fadeLen: 1, fadeOutLen: 1, fadeSplit: false, fadeStyle: 'black', fadeShape: 'smooth', fps: 30, method: 'auto', codec: 'avc', divider: 30, turnShadow: 100, turnSoft: 50, scoreAmt: 0, scoreSoft: 50, invert: false, ink: '#fcfcfc', fadeAuto: true, fadeAutoOut: null, normalize: false, normBy: 'peak', normLufs: -14, normPreset: 'stream', limiter: false, normPeakDb: -1, gainDb: 0, audioFades: false, audioFadeShape: 'smooth', audioFormat: 'wav24', audioFadeLen: 0.5, audioFadeOutLen: null, videoQuality: 'standard', audioKbps: 256, audioRate: 0, tagsOn: false, tagTitle: '', tagArtist: '', tagAlbumArtist: '', tagAlbum: '', tagYear: '', tagTrack: '', tagDisc: '', tagComposer: '', tagWork: '', tagMovement: '', tagMovementNo: '', tagGenre: '', tagComment: '', tagShowWork: false, tagCompilation: false, matchGain: false, aeView: 'wave' };
const ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16 };
const S = {
  set: Object.assign({}, DEFAULTS),
  pdf: null,        // {doc, n, name, aspect}
  audio: null,      // {buffer, name, duration, peaks, peakMax}
  spreads: [],      // [[leftIdx, rightIdx]] (-1 = nothing)
  turns: [],        // marker times (s) – one between each pair of spreads
  turnsEdited: false,
  ph: [], savedTurns: null,
  manualDur: 0,
  time: 0,
  pxPerSec: 20,
  vStart: 0, vEndSet: null,   // where the video starts and ends, in audio time (0 = the start of the audio); null end = the audio's end
  fitMode: true,             // the timeline keeps itself fitted to the window until the user zooms
  creditsEnd: null,          // when the credits finish fading away, if they end early (audio time)
  credits: { title: '', l2: '', l3: '', titleEdited: false },   // the closing credits text; its title is always the piece title
  thumbs: [],
  history: [], redo: []
};
try {
  const sv = JSON.parse(localStorage.getItem('glisscore.settings') || 'null');
  if (sv) { Object.assign(S.set, sv); delete S.set.turnStyle; }          // a video saved when Turn style existed has no use for it
} catch (e) {}
S.set.fx = fxNorm(S.set.fx);
/* (declared here so that saveSettings can reach it from the first moment) */
const HB = { base: null, open: false, quiet: false, timer: 0 };
function saveSettings() { hsNote(); try { localStorage.setItem('glisscore.settings', JSON.stringify(S.set)); } catch (e) {} if (typeof updateGroupSummaries === 'function') updateGroupSummaries(); }

const audioLen = () => S.audio ? S.audio.duration : S.manualDur;           // the audio's own length (a stand-in when there is no audio)
const vStart = () => S.vStart;
/* Credits: an extra last spread, revealed under the last page. It only exists when line 1 or line 2 has text. */
const CARD = -2, BLANK = -3;                                          // special page numbers: the credits text, and a blank sheet
const isSheet = i => i >= 0 || i === BLANK;                           // a real sheet of paper (as opposed to nothing, or loose text)
const creditsActive = () => !!(S.pdf && S.set.creditsOn === true && (S.credits.l2.trim() || S.credits.l3.trim() || S.credits.title.trim()));
/* Credits at the start sit on the empty left of the opening spread, which needs First page alone; otherwise they stay at the end. */
const creditsAtStart = () => S.set.creditsAt === 'start' && creditsActive() && firstAloneOn();
const creditsAtEnd = () => creditsActive() && !creditsAtStart();
const creditsHasText = () => !!(S.credits.title.trim() || S.credits.l2.trim() || S.credits.l3.trim());
const creditsTitle = () => S.credits.title.trim();
const hasCreditsSpread = () => { const l = S.spreads[S.spreads.length - 1]; return !!(l && l.credits); }
const CREDITS_TAIL = 5, CREDITS_OUT = 0.6;                         // a separate credits page adds 5 s after the audio (drag the video's end bracket to change it); credits fade out over 0.6 s
const defaultEnd = () => audioLen() + (hasCreditsSpread() ? CREDITS_TAIL : 0);
/* Ending the credits early: a teal marker on the timeline says when they have finished fading away. */
const creditsStart = () => S.turns.length ? S.turns[S.turns.length - 1] - refOffset() : S.vStart;      // when the credits begin to appear
const creditsFull = () => creditsStart() + flipDur();                                                    // when they are fully on screen
const creditsEarlyOn = () => creditsAtEnd() && S.set.creditsEarly === true && S.creditsEnd != null;
function creditsAlpha(t) { if (!creditsEarlyOn()) return 1; const a = clamp((S.creditsEnd - t) / CREDITS_OUT, 0, 1); return a * a * (3 - 2 * a); }
function ensureCreditsEnd() { if (creditsAtEnd() && S.set.creditsEarly === true && S.creditsEnd == null) S.creditsEnd = clamp(Math.min(creditsFull() + 5, vEnd() - 1), creditsFull() + 0.5, vEnd()); }   // about 5 s on screen to begin with
function fixCreditsEnd() { if (S.creditsEnd == null) return; const hi = vEnd(), lo = Math.min(creditsFull() + 0.5, hi); S.creditsEnd = clamp(S.creditsEnd, lo, hi); }
const vEnd = () => S.vEndSet == null ? defaultEnd() : S.vEndSet;
const duration = () => vEnd() - S.vStart;                                  // the length of the video
const lenKey = () => S.set.transition === 'slide' ? 'slideDur' : 'flipDur';           // the page flip and the slide each keep their own length
const markerTimes = () => S.turns.concat(creditsEarlyOn() ? [S.creditsEnd] : []).sort((x, y) => x - y);      // every marker: the page turns, then where the credits end
function jumpMarker(dir) {           // to the nearest marker before or after the playhead; nothing happens past the last one
  const t = Transport.now(), m = markerTimes().filter(x => dir < 0 ? x < t - 0.02 : x > t + 0.02);
  if (m.length) Transport.seek(dir < 0 ? m[m.length - 1] : m[0]);
}
const turnNoun = () => S.set.transition === 'slide' ? 'Slide' : S.set.transition === 'cut' ? 'Cut' : 'Turn';       // what a marker is called
const flipDur = () => S.set.transition === 'cut' ? 0 : +S.set[lenKey()];            // a straight cut has no animation time
const shOn = () => S.set.shadowsOn !== false;                                     // the Shadows switch
const singleOn = () => S.set.pageLayout === 'single';                    // Page layout: one centered page per turn, not a spread
const gutterAmt = () => shOn() && !singleOn() ? S.set.gutter / 100 : 0;          // a single page has no center fold
const dividerAmt = () => shOn() && !singleOn() ? S.set.divider / 100 : 0;
const turnGap = () => Math.max(flipDur(), 0.1);                                   // least time between two page changes
const turnMin = () => S.vStart + (S.set.transition === 'cut' ? turnGap() : refOffset());   // earliest time the first handle can sit
const refOffset = (ref = S.set.ref, D = flipDur()) => ref === 'start' ? 0 : ref === 'middle' ? D / 2 : D;

/* the filled part of a slider (the sliders are drawn by the site, see style.css) */
function paintRange(el) {
  const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, pct = Math.max(0, Math.min(100, (el.value - min) / (max - min) * 100)); el.style.setProperty('--pct', pct + '%');
  if (el.classList.contains('bi')) { const z = (0 - min) / (max - min) * 100; el.style.setProperty('--lo', Math.min(z, pct) + '%'); el.style.setProperty('--hi', Math.max(z, pct) + '%'); }          // a slider with a middle zero fills from the middle
}
function paintRanges() { document.querySelectorAll('input[type=range]').forEach(paintRange); }
document.addEventListener('input', e => { if (e.target.type === 'range') paintRange(e.target); }, true);

/* ---------------- toast ---------------- */
let toastTimer = 0;
function toast(msg, ms = 4200) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

