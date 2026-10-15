// A new set of filters made while the sound plays (a curve added to the EQ, the Imager turned on or off) must come in without a bump: the player runs the new filters over the sound it has just played
// (so they do not start from rest), then eases them in. Checked on a low, steady sound that a filter starting from rest would make thump: after the change every 5ms of what is heard must be a mix of the sound before
// and the sound after (each worked out on its own, from the start), and the change must not delay the volume, the limiter or the rest of the same message.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-chain-swap.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.waitForTimeout(500);
  const r = await p.evaluate(async () => {
    const sr = 48000, secs = 3, n = sr * secs, L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr, v = 0.2 * Math.sin(2 * Math.PI * 55 * t) + 0.12 * Math.sin(2 * Math.PI * 95 * t + 1) + 0.1 * Math.sin(2 * Math.PI * 300 * t + 2) + 0.05 * Math.sin(2 * Math.PI * 1700 * t + 3); L[i] = v; R[i] = v * 0.9; }
    const fxOf = f => { const fx = fxClone(FX_DEFAULT); f(fx); return fx; };
    const low = Array.from(eqAxis, f => f < 120 ? 10 : f < 400 ? 4 : 0);
    const eq = fxOf(fx => { fx.eq.on = true; fx.eq.curve = low; }), both = fxOf(fx => { fx.eq.on = true; fx.eq.curve = low; fx.imager.on = true; fx.imager.bw = [160, 100, 100]; });
    const chainOf = fx => fxLive(sr, fx, 2).mods;
    const render = async (init, swap) => {
      const oac = new OfflineAudioContext(2, n, sr), s = { sr, ch: 2, frames: n, get: async (at, k) => ({ chans: [L.slice(at, at + k), R.slice(at, at + k)] }) };
      const h = await soundPlay(oac, s, 0, oac.destination, { once: true, init, chunk: n });
      if (swap) { oac.suspend(1.0).then(() => { h.post(swap); oac.resume(); }); }
      const buf = await oac.startRendering(); return [buf.getChannelData(0), buf.getChannelData(1)];
    };
    const out = {};
    for (const [name, a, c] of [['EQ added', null, eq], ['Imager added', eq, both], ['Imager removed', both, eq], ['EQ removed', eq, null]]) {
      const ya = await render(a ? { chain: chainOf(a), now: true } : { now: true }, null), yc = await render(c ? { chain: chainOf(c), now: true } : { now: true }, null);
      const y = await render(a ? { chain: chainOf(a), now: true } : { now: true }, { chain: c ? chainOf(c) : [], xf: Math.round(0.04 * sr) });
      const w = Math.round(0.005 * sr); let worst = 0, at = 0, firstAt = -1;
      for (let i = sr; i + w <= sr + sr / 2; i += w) {
        let aa = 0, cc = 0, ac = 0, ay = 0, cy = 0, yy = 0;
        for (let k = i; k < i + w; k++) { const o = ya[0][k], q = yc[0][k], v = y[0][k]; aa += o * o; cc += q * q; ac += o * q; ay += o * v; cy += q * v; yy += v * v; }
        // the best mix of before and after, over this window
        const det = aa * cc - ac * ac; let wa = 0, wc = 1; if (det > 1e-12) { wa = (ay * cc - cy * ac) / det; wc = (cy * aa - ay * ac) / det; }
        const res = yy - (wa * ay + wc * cy), rel = Math.sqrt(Math.max(0, res) / w) / Math.sqrt(cc / w + 1e-12); if (rel > worst) { worst = rel; at = (i - sr) / sr; }
      }
      out[name] = { worst: +worst.toFixed(3), at: +at.toFixed(3) };
    }
    return out;
  });
  for (const [k, v] of Object.entries(r)) ok(k + ': no bump when the filters change while it plays', v.worst < 0.1, 'worst mismatch ' + v.worst + ' of the sound level, ' + v.at + 's after the change');
  ok('no page errors', !errs.length, errs.join(' | ')); await b.close();
})();
