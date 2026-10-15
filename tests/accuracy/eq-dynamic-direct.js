// Dynamic EQ bands measured straight on the shared code (audio-fx.js), no browser needed: a band whose gain follows the level of the sound in its own region.
// Run:  node tests/accuracy/eq-dynamic-direct.js
const G = {}; new Function('self', require('fs').readFileSync(process.argv[2] || require('path').join(__dirname, '../../audio-fx.js'), 'utf8'))(G); const KFX = G.KFX;
const sr = 48000, axis = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239));
let fails = 0; const ok = (name, pass, info) => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const run = async (chans, tools, a, n, ch) => { const N = chans[0].length, src = { key: 'x' + Math.random(), sr, ch: chans.length, frames: N, read: async (p, m) => chans.map(c => c.subarray(p, p + m)) }, c = ch || KFX.chain(src, { noise: null, axis, edits: [], tools }, null); return (await c.read(a || 0, n || N, true)).chans; };
const tone = (f, amp, secs, from, to) => { const N = Math.round(sr * secs), x = new Float32Array(N); for (let i = 0; i < N; i++) { const t = i / sr; x[i] = (from == null || (t >= from && t < to)) ? amp * Math.sin(2 * Math.PI * f * i / sr) : 0; } return x; };
const db = v => 20 * Math.log10(v + 1e-12), rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
const band = (extra, over) => Object.assign({ type: 'peaking', f: 6000, g: 0, q: 2, on: true, dyn: { thr: -30, range: -8 } }, extra || {}, over || {});
const eq = (bands, extra) => [Object.assign({ k: 'eq', bands, auto: false }, extra || {})];
(async () => {
  { // a loud tone in the band is turned down by the full range; the same band with no dynamics and that gain gives the same sound
    const x = tone(6000, 0.3, 2), o = (await run([x], eq([band()])))[0], ref = (await run([x], eq([{ type: 'peaking', f: 6000, g: -8, q: 2, on: true }])))[0];
    const a = Math.round(1.5 * sr), b = 2 * sr, got = db(rms(o, a, b)) - db(rms(x, a, b)), want = db(rms(ref, a, b)) - db(rms(x, a, b)); ok('a loud tone in the band is turned down by the whole range', Math.abs(got + 8) < 0.15 && Math.abs(got - want) < 0.05, `${got.toFixed(2)}dB (want −8.00; a static band at −8dB gives ${want.toFixed(2)})`); }
  { // a quiet tone is left alone
    const x = tone(6000, 0.0005, 2), o = (await run([x], eq([band()])))[0], got = db(rms(o, sr, 2 * sr)) - db(rms(x, sr, 2 * sr)); ok('a quiet tone in the band is left as it is', Math.abs(got) < 0.05, got.toFixed(3) + 'dB'); }
  { // how the gain follows the level: more turned down the louder it gets, never turning up
    const out = []; for (const amp of [0.001, 0.01, 0.02, 0.03, 0.05, 0.1, 0.3]) { const x = tone(6000, amp, 1.5), o = (await run([x], eq([band()])))[0]; out.push(db(rms(o, sr, 1.5 * sr)) - db(rms(x, sr, 1.5 * sr))); }
    ok('the louder it gets, the further the band comes down, smoothly and without turning up', out.every((v, i) => i === 0 || v <= out[i - 1] + 0.02) && out[0] > -0.1 && out[6] < -7.8, out.map(v => v.toFixed(2)).join(' ')); }
  { // a tone away from the band does not move it
    const x = tone(500, 0.3, 2), o = (await run([x], eq([band()])))[0], got = db(rms(o, sr, 2 * sr)) - db(rms(x, sr, 2 * sr)); ok('a loud tone far from the band does not bring it down', Math.abs(got) < 0.1, got.toFixed(3) + 'dB'); }
  { // attack and release: a burst of 0.5s
    const x = tone(6000, 0.3, 2, 0.5, 1.0), o = (await run([x], eq([band()])))[0], env = (a, b) => db(rms(o, a, b)) - db(rms(x, a, b)); const gain = t => env(Math.round(t * sr), Math.round((t + 0.004) * sr));
    const att = [0.502, 0.506, 0.512, 0.52, 0.6].map(gain), rel = [1.005, 1.05, 1.1, 1.2, 1.4].map(t => 0); // release: the tone is gone, so read it with a steady quiet tone under it instead
    ok('the band comes down in a few milliseconds', att[0] > -7 && att[2] < -5 && att[4] < -7.8, att.map(v => v.toFixed(1)).join(' ')); }
  { // release: a loud burst, then a tone just under the threshold; the gain climbs back over ~0.1s
    const N = 3 * sr, x = new Float32Array(N); for (let i = 0; i < N; i++) { const t = i / sr; x[i] = (t < 1 ? 0.3 : 0.001) * Math.sin(2 * Math.PI * 6000 * i / sr); }
    const o = (await run([x], eq([band()])))[0], g = t => db(rms(o, Math.round(t * sr), Math.round((t + 0.003) * sr))) - db(rms(x, Math.round(t * sr), Math.round((t + 0.003) * sr))), v = [1.01, 1.05, 1.1, 1.2, 1.5, 2].map(g);
    ok('the band comes back up over about a tenth of a second', v[0] < -6.5 && v[2] > -6 && v[2] < -1.5 && v[5] > -0.3 && v.every((q, i) => i === 0 || q >= v[i - 1] - 0.05), v.map(q => q.toFixed(1)).join(' ')); }
  { // left and right are read together: a loud left and a quiet right come down by the same amount
    const L = tone(6000, 0.3, 2), R = tone(6000, 0.01, 2), o = await run([L, R], eq([band()])), gl = db(rms(o[0], sr, 2 * sr)) - db(rms(L, sr, 2 * sr)), gr = db(rms(o[1], sr, 2 * sr)) - db(rms(R, sr, 2 * sr)); ok('left and right come down together, so the picture does not lean', Math.abs(gl - gr) < 0.05 && gl < -5, `left ${gl.toFixed(2)}dB, right ${gr.toFixed(2)}dB`); }
  { // a boost: a positive range turns a shelf up when it is loud (as far as the same shelf set to that gain does)
    const x = tone(6000, 0.2, 2), o = (await run([x], eq([band({ type: 'highshelf', f: 3000, q: 0.71 }, { dyn: { thr: -30, range: 5 } })])))[0], ref = (await run([x], eq([{ type: 'highshelf', f: 3000, g: 5, q: 0.71, on: true }])))[0];
    const got = db(rms(o, sr, 2 * sr)) - db(rms(x, sr, 2 * sr)), want = db(rms(ref, sr, 2 * sr)) - db(rms(x, sr, 2 * sr)); ok('a positive range turns a shelf up when it is loud', Math.abs(got - want) < 0.05 && got > 4, `${got.toFixed(2)}dB (the same shelf set to +5dB gives ${want.toFixed(2)})`); }
  { // mid and side: a dynamic band on the mid leaves the side exactly alone, and reads only the mid
    const m = tone(6000, 0.3, 2), s = tone(6000, 0.3, 2).map(v => v * 0.5), L = m.map((v, i) => v + s[i]), R = m.map((v, i) => v - s[i]);
    const o = await run([L, R], eq([band({ place: 'mid' })])), M = o[0].map((v, i) => (v + o[1][i]) / 2), S = o[0].map((v, i) => (v - o[1][i]) / 2), gm = db(rms(M, sr, 2 * sr)) - db(rms(m, sr, 2 * sr)), gs = db(rms(S, sr, 2 * sr)) - db(rms(s, sr, 2 * sr));
    ok('a dynamic band on the mid turns only the mid down', gm < -7.5 && Math.abs(gs) < 0.01, `mid ${gm.toFixed(2)}dB, side ${gs.toFixed(3)}dB`); }
  { // every way of reading gives the same sound: in one go, in odd pieces, and from the middle after the rest was read (from a saved place)
    const N = 7 * sr, x = new Float32Array(N); let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; for (let i = 0; i < N; i++) x[i] = (0.2 + 0.2 * Math.sin(i / 20000)) * Math.sin(2 * Math.PI * 6000 * i / sr) + 0.01 * (rnd() - 0.5);
    const tools = eq([band(), band({ f: 2000, q: 1, dyn: { thr: -40, range: -6 } }, { type: 'peaking' })]), src = { key: 'dyn-d', sr, ch: 1, frames: N, read: async (p, m) => [x.subarray(p, p + m)] }, ch = KFX.chain(src, { noise: null, axis, edits: [], tools }, null);
    const whole = (await ch.read(0, N, true)).chans[0]; const ch2 = KFX.chain({ ...src, key: 'dyn-e' }, { noise: null, axis, edits: [], tools }, null); const pieces = new Float32Array(N); let p = 0, k = 0; const sizes = [1, 17, 4000, 333, 65536, 12345]; while (p < N) { const m = Math.min(sizes[k++ % sizes.length], N - p); pieces.set((await ch2.read(p, m, true)).chans[0], p); p += m; }
    let w1 = 0; for (let i = 0; i < N; i++) w1 = Math.max(w1, Math.abs(whole[i] - pieces[i]));
    const mid = (await ch.read(5.5 * sr, 20000, true)).chans[0]; let w2 = 0; for (let i = 0; i < 20000; i++) w2 = Math.max(w2, Math.abs(mid[i] - whole[5.5 * sr + i]));
    ok('read in one go, in odd pieces, or from the middle, the sound is exactly the same', w1 === 0 && w2 === 0, `pieces ${w1.toExponential(1)}, from the middle ${w2.toExponential(1)}`); }
  { // a type with no gain (a high-pass) cannot be dynamic: the setting is ignored and nothing breaks
    const x = tone(1000, 0.3, 1), o = (await run([x], eq([{ type: 'highpass', f: 100, g: 0, q: 0.71, on: true, dyn: { thr: -30, range: -6 } }])))[0]; ok('a high-pass ignores a dynamic setting', Math.abs(db(rms(o, sr / 2, sr)) - db(rms(x, sr / 2, sr))) < 0.05); }
  process.exit(fails ? 1 : 0);
})();
