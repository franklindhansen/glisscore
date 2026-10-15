// The free curve of EQ Match (a row of 39 bells made to follow any curve) measured straight on the shared code (audio-fx.js), no browser needed:
// how far the filters' real response is from the curve asked for, on busy and on gentle curves, at each sample rate, and that a sound through the plan comes out at the curve.
// Run:  node tests/accuracy/eq-curve-direct.js
const G = {}; new Function('self', require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../../audio-fx.js'), 'utf8'))(G); const KFX = G.KFX;
const axis = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239));
let fails = 0; const ok = (name, pass, info) => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
let seed = 3; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const smooth = (a, w) => a.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - w); j <= Math.min(239, i + w); j++) { s += a[j]; n++; } return s / n; });
const taper = c => c.map((v, j) => v * Math.max(0, Math.min(1, Math.log2(axis[j] / 28) / Math.log2(40 / 28))) * Math.max(0, Math.min(1, Math.log2(18000 / axis[j]) / Math.log2(18000 / 14000))));
const real = (curve, sr) => { const bands = KFX.eqCurveBands(curve, sr), out = new Float64Array(240); bands.forEach(b => KFX.eqSections(b, sr).forEach(c => { for (let j = 0; j < 240; j++) out[j] += 20 * Math.log10(Math.max(1e-6, KFX.bqMag(c, axis[j], sr))); })); return { out, n: bands.length }; };
const stats = (curves, sr) => { let mean = 0, n = 0, worst = 0, all = []; for (const c of curves) { const r = real(c, sr); for (let j = 0; j < 240; j++) { const d = Math.abs(r.out[j] - c[j]); mean += d; n++; worst = Math.max(worst, d); all.push(d); } } all.sort((a, b) => a - b); return { mean: mean / n, worst, p99: all[Math.floor(all.length * 0.99)] }; };
const busy = [], gentle = []; for (let t = 0; t < 24; t++) { const raw = Array.from({ length: 240 }, () => (rnd() - 0.5) * 20); busy.push(taper(smooth(smooth(raw, 6 + (t % 4) * 3), 4)).map(v => Math.max(-12, Math.min(12, v * 1.6)))); gentle.push(taper(smooth(smooth(raw, 24), 12)).map(v => Math.max(-12, Math.min(12, v * 2)))); }
// the built-in reference as a match target would make it
const ref = [9, 9, 10.3, 10.3, 10.3, 10.3, 11.3, 11.3, 11.7, 11.7, 10.4, 11.2, 12.8, 13.7, 14.3, 14.2, 13.6, 13.4, 12.7, 12.7, 12.9, 13.4, 14.1, 14.4, 14.3, 14.5, 14.2, 13.5, 12.2, 11.5, 11, 9.7, 8.9, 7.3, 5.5, 5.3, 5.3, 4.1, 2.2, 0.5, -2.1, -4, -5.3, -6.7, -8.4, -10.6, -12.8, -15.1, -17.2, -19, -21.6, -23.8, -26.1, -28.1, -29.8, -31.7, -33.9, -35.6, -38.3, -41.9, -45.6];
const wind = (() => { const o = new Float32Array(240); for (let i = 0; i < 240; i++) { const k = Math.min(ref.length - 2, i >> 2), a = k * 4, b = Math.min(239, a + 4); o[i] = ref[k] + (ref[k + 1] - ref[k]) * ((i - a) / (b - a)); } let m = 0; o.forEach(v => { m += v; }); m /= 240; return taper(smooth(Array.from(o, v => (v - m) * 0.5), 10)).map(v => Math.max(-12, Math.min(12, v))); })();          // as a match makes it: smoothed, and a built-in reference leaves the rumble and the air alone
for (const sr of [44100, 48000, 96000]) {
  const b = stats(busy, sr), g = stats(gentle, sr), w = stats([wind], sr);
  ok(`${sr}Hz: busy curves are followed to ${b.mean.toFixed(2)}dB on average`, b.mean < 0.12 && b.p99 < 0.5 && b.worst < 1.0, `p99 ${b.p99.toFixed(2)}dB, worst ${b.worst.toFixed(2)}dB`);
  ok(`${sr}Hz: gentle curves and the wind ensemble match are followed closely (the one sharp ramp the match makes excepted)`, g.mean < 0.05 && g.worst < 0.4 && w.mean < 0.15 && w.worst < 2, `gentle ${g.mean.toFixed(3)} avg, ${g.worst.toFixed(2)} worst; wind ${w.mean.toFixed(3)} avg, ${w.worst.toFixed(2)} worst (at the steep drop-off the built-in reference makes above 14kHz)`);
}
{ const z = new Array(240).fill(0); ok('a flat curve makes no bands', KFX.eqCurveBands(z, 48000).length === 0); const one = real(gentle[0], 48000); ok('a curve is made of few enough bells to run live', one.n <= 39, one.n + ' bells'); }
{ const t0 = Date.now(); for (let i = 0; i < 20; i++) { const c = busy[i].map(v => v + i * 0.01); KFX.eqCurveBands(c, 48000); } const per = (Date.now() - t0) / 20; ok('a curve is worked out fast enough to follow a slider', per < 15, per.toFixed(1) + 'ms each'); }
{ // a sound through the plan: tones at several frequencies come out at the curve
  const sr = 48000, c = gentle[3], P = KFX.plan([{ k: 'eq', bands: [], curve: c, auto: false }], sr, 1); let worst = 0;
  for (const f of [60, 200, 800, 2500, 7000, 12000]) { const n = sr, x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * f * i / sr); let y = x; for (const co of P.coefs) { const o = new Float64Array(n); let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < n; i++) { const v = co[0] * y[i] + co[1] * x1 + co[2] * x2 - co[3] * y1 - co[4] * y2; o[i] = v; x2 = x1; x1 = y[i]; y2 = y1; y1 = v; } y = o; }
    let e = 0; for (let i = n / 2; i < n; i++) e += y[i] * y[i]; const got = 10 * Math.log10(e / (n / 2) * 2); let j = 0; while (axis[j + 1] < f) j++; const want = c[j] + (c[j + 1] - c[j]) * (Math.log(f / axis[j]) / Math.log(axis[j + 1] / axis[j])); worst = Math.max(worst, Math.abs(got - want)); }
  ok('tones through the plan come out at the curve', worst < 0.35, 'largest difference ' + worst.toFixed(2) + 'dB'); }
process.exit(fails ? 1 : 0);
