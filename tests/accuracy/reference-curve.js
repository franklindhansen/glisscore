// The average tonal curve of every recording in a folder, on the app's EQ axis (240 points, 20Hz to 20kHz), measured the way EQ Match measures a reference but over every slice.
// The built-in Wind ensemble reference (EQ_PROFILES in index.html) is the middle four of six recordings at each point, centered, every fourth point and the last.
// Needs ffmpeg. Run:  node tests/accuracy/reference-curve.js <folder of recordings> <out.json>
const { spawn } = require('child_process'), fs = require('fs'), path = require('path');
const N = 4096, SR = 44100, axis = Array.from({ length: 240 }, (_, i) => 20 * Math.pow(1000, i / 239));
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(a * k), wi = Math.sin(a * k), p = i + k, q = p + len / 2, xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr; re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi; } } }
function bands(pw, used) { const out = new Float64Array(axis.length), bw = Math.pow(2, 1 / 6), binHz = SR / N;
  for (let i = 0; i < out.length; i++) { const f = axis[i], lo = Math.max(1, Math.floor(f / bw / binHz)), hi = Math.min(N / 2, Math.ceil(f * bw / binHz)); let s = 0, n = 0; for (let k = lo; k <= hi; k++) { s += pw[k]; n++; } out[i] = 10 * Math.log10(s / n / used + 1e-20); } return out; }
async function one(file) {
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ar', String(SR), '-ac', '2', '-f', 'f32le', '-']);
  const pm = new Float64Array(N / 2 + 1), ps = new Float64Array(N / 2 + 1), re = new Float64Array(N), im = new Float64Array(N); let used = 0, carry = Buffer.alloc(0), L = new Float32Array(N), R = new Float32Array(N), fill = 0;
  const slice = () => { let e = 0; for (let i = 0; i < N; i++) { const v = (L[i] + R[i]) / 2 * win[i]; re[i] = v; im[i] = (L[i] - R[i]) / 2 * win[i]; e += v * v; } if (e < 1e-6) return;
    fft(re, im); for (let k = 0; k <= N / 2; k++) { const k2 = (N - k) % N, ar = (re[k] + re[k2]) / 2, ai = (im[k] - im[k2]) / 2, br = (im[k] + im[k2]) / 2, bi = (re[k2] - re[k]) / 2; pm[k] += ar * ar + ai * ai; ps[k] += br * br + bi * bi; } used++; };
  for await (const chunk of ff.stdout) { const b = Buffer.concat([carry, chunk]), n = Math.floor(b.length / 8); for (let i = 0; i < n; i++) { L[fill] = b.readFloatLE(i * 8); R[fill] = b.readFloatLE(i * 8 + 4); if (++fill === N) { slice(); L.copyWithin(0, N / 2); R.copyWithin(0, N / 2); fill = N / 2; } } carry = b.subarray(n * 8); }
  const m = bands(pm, used), s = bands(ps, used); let mean = 0; m.forEach(v => mean += v); mean /= m.length;
  return { name: path.basename(file), used, mid: Array.from(m, v => v - mean), side: Array.from(s, (v, i) => v - m[i]) };
}
(async () => { const dir = process.argv[2], out = []; for (const f of fs.readdirSync(dir).filter(f => /\.(mp3|aiff?|wav|flac|m4a|mp4)$/i.test(f)).sort()) { const r = await one(path.join(dir, f)); out.push(r); console.error(r.name, r.used); } fs.writeFileSync(process.argv[3], JSON.stringify({ axis, out })); })();
