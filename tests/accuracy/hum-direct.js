// The hum finder and its notches measured straight on the shared code (audio-fx.js), no browser needed.
// Notes that come and go over hiss, with and without a mains hum (60.03Hz or 49.96Hz and some of its multiples, well under the music): the hum must be found to a few hundredths of a hertz with the multiples that are there,
// nothing must be found when there is none (even with low notes right beside 50 and 60Hz), and the notches must take the hum down by 30dB or more while the music keeps its level.
// Run:  node tests/accuracy/hum-direct.js
const G = {}; new Function('self', require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../../audio-fx.js'), 'utf8'))(G); const K = G.KFX; let fails = 0;
const ok = (name, pass, info) => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const axis = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239)); let seed = 31; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function make(sr, secs, hum, low) { const N = sr * secs, x = new Float32Array(N), h = new Float32Array(N), scale = low ? [49, 61.74, 98, 123.5, 196, 247] : [196, 220, 262, 294, 330, 392, 440, 523]; let t = 0;
  while (t < N - sr) { const dur = Math.round((0.3 + rnd() * 0.9) * sr); for (let v = 0; v < 2; v++) { const f0 = scale[Math.floor(rnd() * scale.length)], amp = 0.04 + rnd() * 0.05; for (let i = 0; i < dur && t + i < N; i++) { const tt = i / sr, env = Math.min(1, tt * 60) * Math.min(1, (dur - i) / (0.05 * sr)); let s = 0; for (let k = 1; k <= 8; k++) s += Math.sin(2 * Math.PI * f0 * k * tt + k) / k; x[t + i] += amp * env * s; } } t += Math.round(dur * (0.9 + rnd() * 0.5)); }
  if (hum) for (let i = 0; i < N; i++) { let s = 0; for (const [k, a] of hum.parts) s += a * Math.sin(2 * Math.PI * hum.f * k * i / sr + k); h[i] = s; }
  const mix = new Float32Array(N); for (let i = 0; i < N; i++) mix[i] = x[i] + h[i] + 0.002 * gauss(); return { N, x, h, mix }; }
function find(m, sr) { const F = new K.HumFind(sr, 1), count = Math.min(160, Math.floor(m.N / F.n)); for (let j = 0; j < count; j++) { const at = Math.floor(j * (m.N - F.n) / Math.max(1, count - 1)); F.push([m.mix.subarray(at, at + F.n)]); } return F.find(); }
(async () => {
  for (const [sr, f, parts] of [[48000, 60.03, [[1, 0.004], [2, 0.002], [3, 0.003], [5, 0.001]]], [44100, 49.96, [[1, 0.003], [3, 0.002], [5, 0.0015], [7, 0.0008]]], [96000, 60.0, [[2, 0.002], [4, 0.001]]]]) {
    const m = make(sr, 40, { f, parts }), r = find(m, sr), want = parts.map(p => p[0]);
    ok(sr + 'Hz: a hum at ' + f + 'Hz is found, with its multiples', !!r && Math.abs(r.f - f) < 0.05 && want.every(h => r.n.includes(h)) && r.n.length <= want.length + 1, JSON.stringify(r));
    if (!r) continue;
    const src = { key: 'h' + sr, sr, ch: 1, frames: m.N, read: async (a, n) => [m.mix.subarray(a, a + n)] }, y = (await K.chain(src, { noise: { profile: null, hum: r }, axis, edits: [], tools: [] }, null).read(0, m.N, true)).chans[0];
    const copy = Float32Array.from(m.mix); K.nrHum([copy], K.humBands(r).map(b => K.eqSections(b, sr)[0])); let same = 0; for (let i = 0; i < m.N; i++) same = Math.max(same, Math.abs(copy[i] - y[i]));
    /* the notches are plain filters, so what they do to the hum and to the music can be read apart: the hum alone through them, and the music alone */
    const co = K.humBands(r).map(b => K.eqSections(b, sr)[0]), hh = Float32Array.from(m.h), xx = Float32Array.from(m.x); K.nrHum([hh], co); K.nrHum([xx], co);
    const pw = (z, w) => { let t = 0; for (let i = 5 * sr; i < 35 * sr; i++) t += (w ? z[i] - w[i] : z[i]) ** 2; return t; }, down = 10 * Math.log10(pw(m.h) / pw(hh)), lvl = 10 * Math.log10(pw(xx) / pw(m.x));
    ok(sr + 'Hz: the notches take the hum down by 30dB or more, and the music keeps its level', down > 30 && Math.abs(lvl) < 0.1, 'hum down ' + down.toFixed(1) + 'dB, music level ' + lvl.toFixed(3) + 'dB');
    ok(sr + 'Hz: a recording in memory and one on the disk store get the same samples', same < 1e-6, 'worst ' + same.toExponential(1));
  }
  ok('no hum: nothing is found', find(make(48000, 40, null), 48000) === null); { const r = find(make(48000, 40, null, true), 48000); ok('no hum, with low notes at 49Hz and 61.7Hz: nothing is found', r === null, JSON.stringify(r)); }
  process.exit(fails ? 1 : 0);
})();
