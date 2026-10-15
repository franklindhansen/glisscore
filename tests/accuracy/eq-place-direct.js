// EQ bands that work on the mid or the side, measured straight on the shared code (audio-fx.js), no browser needed.
// A 1kHz tone that is the same in both channels is all mid; a 3kHz tone that is opposite in the two is all side. A band on one must move only that one,
// a stereo band must move both exactly as it did before, and with every band flat the sound must come out as it went in.
// Run:  node tests/accuracy/eq-place-direct.js
const G = {}; new Function('self', require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../../audio-fx.js'), 'utf8'))(G); const KFX = G.KFX;
const sr = 48000, N = sr * 2, axis = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239));
const mid = new Float32Array(N), side = new Float32Array(N), L = new Float32Array(N), R = new Float32Array(N);
for (let i = 0; i < N; i++) { mid[i] = 0.2 * Math.sin(2 * Math.PI * 1000 * i / sr); side[i] = 0.2 * Math.sin(2 * Math.PI * 3000 * i / sr); L[i] = mid[i] + side[i]; R[i] = mid[i] - side[i]; }
const run = async (chans, tools) => { const src = { key: 'x', sr, ch: chans.length, frames: N, read: async (a, n) => chans.map(c => c.subarray(a, a + n)) }, ch = KFX.chain(src, { noise: null, axis, edits: [], tools }, null); return (await ch.read(0, N, true)).chans; };
// the level of each part in what came out: mid = (L + R) / 2 and side = (L - R) / 2, each read at its own frequency by a single-bin sum over the second half
const level = (x, f) => { let a = 0, b = 0; for (let i = N / 2; i < N; i++) { a += x[i] * Math.sin(2 * Math.PI * f * i / sr); b += x[i] * Math.cos(2 * Math.PI * f * i / sr); } return 20 * Math.log10(2 * Math.hypot(a, b) / (N / 2) + 1e-12); };
const parts = o => { const m = new Float32Array(N), s = new Float32Array(N); for (let i = 0; i < N; i++) { m[i] = (o[0][i] + o[1][i]) / 2; s[i] = (o[0][i] - o[1][i]) / 2; } return { m: level(m, 1000), s: level(s, 3000), mLeak: level(m, 3000), sLeak: level(s, 1000) }; };
const base = parts([L, R]); let fails = 0; const ok = (name, pass, info) => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const bell = (f, g, place) => Object.assign({ type: 'peaking', f, g, q: 1, on: true }, place ? { place } : {});
const near = (v, w, tol) => Math.abs(v - w) <= tol;
(async () => {
  const want = (b, f) => 20 * Math.log10(KFX.bqMag(KFX.bqMatched(b.type, b.f, b.q, b.g, sr), f, sr));
  const wm = want(bell(1000, 6), 1000);          // what a band does to a tone is read off its own curve; a part gets every band that reaches it (a stereo band reaches both)
  const exp = (bands, f, part) => bands.filter(b => (b.place || 'st') === 'st' || b.place === part).reduce((t, b) => t + want(b, f), 0);
  for (const [name, bands] of [
    ['a stereo band moves both', [bell(1000, 6), bell(3000, 6)]],
    ['a mid band moves only the mid', [bell(1000, 6, 'mid'), bell(3000, 6, 'mid')]],
    ['a side band moves only the side', [bell(1000, 6, 'side'), bell(3000, 6, 'side')]],
    ['a mid band and a side band each move their own', [bell(1000, 6, 'mid'), bell(3000, -6, 'side')]],
    ['a stereo band beside a side band', [bell(1000, -4), bell(3000, 5, 'side')]]
  ]) { const em = exp(bands, 1000, 'mid'), es = exp(bands, 3000, 'side'), o = await run([L, R], [{ k: 'eq', bands, auto: false }]), p = parts(o); ok(name, near(p.m - base.m, em, 0.03) && near(p.s - base.s, es, 0.03) && p.mLeak < -80 && p.sLeak < -80, `mid ${(p.m - base.m).toFixed(2)}dB (want ${em.toFixed(2)}), side ${(p.s - base.s).toFixed(2)}dB (want ${es.toFixed(2)}), leaks ${p.mLeak.toFixed(0)} / ${p.sLeak.toFixed(0)}dB`); }
  { // flat bands on the mid and the side give the sound back as it was (the split into mid and side loses nothing)
    const o = await run([L, R], [{ k: 'eq', bands: [bell(1000, 0, 'mid'), bell(3000, 0, 'side')], auto: false }]); let w = 0; for (let i = 0; i < N; i++) w = Math.max(w, Math.abs(o[0][i] - L[i]), Math.abs(o[1][i] - R[i])); ok('flat bands on the mid and the side give the sound back as it was', w < 1e-6, 'largest difference ' + w.toExponential(1)); }
  { // a mid band on a left-only sound: half of it is mid, so only that half is raised
    const z = new Float32Array(N), o = await run([mid, z], [{ k: 'eq', bands: [bell(1000, 6, 'mid')], auto: false }]), m = new Float32Array(N), s = new Float32Array(N); for (let i = 0; i < N; i++) { m[i] = (o[0][i] + o[1][i]) / 2; s[i] = (o[0][i] - o[1][i]) / 2; }
    const lm = level(m, 1000) - level(mid.map(v => v / 2), 1000), ls = level(s, 1000) - level(mid.map(v => v / 2), 1000); ok('a left-only sound: its mid half is raised and its side half is not', near(lm, wm, 0.03) && near(ls, 0, 0.03), `mid ${lm.toFixed(2)}dB, side ${ls.toFixed(2)}dB`); }
  { // Listen: only the mid (or only the side) comes through
    const o = await run([L, R], [{ k: 'eq', bands: [bell(1000, 0, 'mid')], auto: false, solo: 'mid' }]), p = parts(o); ok('solo mid: the side is silent and the mid untouched', p.s < -100 && near(p.m, base.m, 0.01), `side ${p.s.toFixed(0)}dB`);
    const o2 = await run([L, R], [{ k: 'eq', bands: [bell(3000, 0, 'side')], auto: false, solo: 'side' }]), p2 = parts(o2); ok('solo side: the mid is silent and the side untouched', p2.m < -100 && near(p2.s, base.s, 0.01), `mid ${p2.m.toFixed(0)}dB`); }
  { // mono: a mid band acts as a stereo band, a side band has nothing to work on
    const a = await run([mid], [{ k: 'eq', bands: [bell(1000, 6, 'mid')], auto: false }]), b = await run([mid], [{ k: 'eq', bands: [bell(1000, 6, 'side')], auto: false }]);
    ok('a mono sound: a mid band works, a side band does nothing', near(level(a[0], 1000) - level(mid, 1000), wm, 0.03) && near(level(b[0], 1000) - level(mid, 1000), 0, 0.001)); }
  { // Auto gain: a stereo band counts in full, a mid band less, a side band least (and nothing on mono)
    const t = (place, nch) => KFX.eqTrim([bell(1000, 6, place)], sr, nch), st = t(undefined, 2), md = t('mid', 2), sd = t('side', 2);
    ok('Auto gain weighs a band by how much of the sound it reaches', st < md && md < sd && sd < 1 && t('side', 1) === 1 && t(undefined, 2) === t(undefined, 1), `stereo ${(20 * Math.log10(st)).toFixed(2)}dB, mid ${(20 * Math.log10(md)).toFixed(2)}dB, side ${(20 * Math.log10(sd)).toFixed(2)}dB`); }
  process.exit(fails ? 1 : 0);
})();
