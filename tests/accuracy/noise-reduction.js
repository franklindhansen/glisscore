const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(120000); await p.goto('http://localhost:8123/index.html?disk=0'); await p.waitForTimeout(800);
 const r = await p.evaluate(() => { const sr = 48000, N = sr * 12; let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296; const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const noise = new Float32Array(N), clean = new Float32Array(N); const nl = Math.pow(10, -42 / 20);          // white hiss at -42 dBFS rms
  // plucked notes from 3s: 6 notes with harmonics and a decay, about -22 dBFS
  const notes = [220, 262, 330, 392, 330, 262]; for (let k = 0; k < notes.length; k++) { const t0 = Math.round((3 + k * 1.4) * sr); for (let i = 0; i < 1.3 * sr && t0 + i < N; i++) { const t = i / sr, env = Math.exp(-t * 2.2) * Math.min(1, t * 200); let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * notes[k] * h * t) / h; clean[t0 + i] += 0.09 * env * v; } }
  for (let i = 0; i < N; i++) noise[i] = clean[i] + nl * gauss();
  const rms = (a, s0, s1) => { let s = 0; for (let i = Math.round(s0 * sr); i < Math.round(s1 * sr); i++) s += a[i] * a[i]; return 10 * Math.log10(s / (Math.round((s1 - s0) * sr)) + 1e-30); };
  const out = {}; const prof = NR.nrLearn([noise], sr, 0, 2 * sr, Array.from(eqAxis)); out.profile = !!prof;
  for (const red of [12, 24]) { const o = NR.nrProcess([noise], sr, prof, { reduction: red, sensitivity: 50, smoothing: 50 }, Array.from(eqAxis))[0];
   // noise-only parts: 0.5-2.5s (learned), and the gap at 11.2-11.9s ... compare residual rms; and the music: error vs clean
   const gap = [0.3, 2.5], tail = [11.0, 11.9];
   let es = 0, ec = 0, en = 0; for (let i = 3 * sr; i < 11 * sr; i++) { const d = o[i] - clean[i], d0 = noise[i] - clean[i]; es += d * d; ec += clean[i] * clean[i]; en += d0 * d0; }
   // spectral flatness / modulation of the residual in the learned region = "musical noise": std of 20ms rms envelope in dB
   const env = (a, s0, s1) => { const w = 960, v = []; for (let i = Math.round(s0 * sr); i + w < Math.round(s1 * sr); i += w) { let s = 0; for (let j = 0; j < w; j++) s += a[i + j] * a[i + j]; v.push(10 * Math.log10(s / w + 1e-30)); } const m = v.reduce((x, y) => x + y) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - m) * (y - m), 0) / v.length); };
   out['red' + red] = { noiseOnlyBefore: +rms(noise, 0.3, 2.5).toFixed(1), after: +rms(o, 0.3, 2.5).toFixed(1), dropDb: +(rms(noise, 0.3, 2.5) - rms(o, 0.3, 2.5)).toFixed(1), tailDrop: +(rms(noise, ...tail) - rms(o, ...tail)).toFixed(1), musicSNRbefore: +(10 * Math.log10(ec / en)).toFixed(1), musicSNRafter: +(10 * Math.log10(ec / es)).toFixed(1), envJitterBefore: +env(noise, 0.3, 2.5).toFixed(2), envJitterAfter: +env(o, 0.3, 2.5).toFixed(2) }; }
  return out; });
 console.log(JSON.stringify(r, null, 1)); await b.close(); })();
