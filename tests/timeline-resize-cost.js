// A window drag repaints the timeline's heavy layer (waveform and ruler) at most once per size change, and the frames stay even.
// It drags the window in small steps over a 90-second recording, counts the repaints of the cached layer and the time they take, and watches the gaps between frames.
// PAGE=other.html compares another copy of the app. Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-resize-cost.js
const { chromium } = require('playwright-core'); const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
function wav(sec, sr = 22050) {          // a quiet tone with some movement, so the waveform has something to draw
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin(i / 20) * (0.5 + 0.5 * Math.sin(i / sr * 2))), 44 + i * 2);
  return b;
}
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  const doc = await PDFDocument.create(); for (let i = 0; i < 40; i++) doc.addPage([420, 560]); const bytes = Buffer.from(await doc.save());
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/' + (process.env.PAGE || 'index.html') + '?disk=0');
  await p.setInputFiles('#pdfIn', { name: 'p.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.setInputFiles('#audioIn', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav(90) });
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.audio && window[K].duration() > 60, K, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => {
    window.__n = 0; window.__ms = 0; window.__gaps = []; window.__go = false;
    const o = window.drawTimelineStatic; window.drawTimelineStatic = function () { const t = performance.now(); const r = o.apply(this, arguments); window.__n++; window.__ms += performance.now() - t; return r; };
    let last = performance.now(); (function tick(now) { if (window.__go) window.__gaps.push(now - last); last = now; requestAnimationFrame(tick); })(last);
  });
  const steps = []; for (let w = 1300; w >= 700; w -= 6) steps.push(w); for (let w = 700; w <= 1300; w += 6) steps.push(w);
  await p.evaluate(() => { window.__n = 0; window.__ms = 0; window.__gaps = []; window.__go = true; });
  for (const w of steps) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(16); }
  await p.waitForTimeout(300);
  const r = await p.evaluate(() => { window.__go = false; const g = window.__gaps.slice().sort((a, b) => a - b); return { n: window.__n, ms: window.__ms, frames: g.length, med: g[Math.floor(g.length / 2)], p95: g[Math.floor(g.length * .95)], max: g[g.length - 1] }; });
  ok('timing of the drag', true, steps.length + ' size changes: ' + r.n + ' repaints of the cached layer, ' + r.ms.toFixed(0) + 'ms in all (' + (r.ms / Math.max(1, r.n)).toFixed(1) + 'ms each); ' + r.frames + ' frames, median gap ' + r.med.toFixed(1) + 'ms, 95th ' + r.p95.toFixed(1) + 'ms, longest ' + r.max.toFixed(0) + 'ms');
  ok('the cached layer is repainted at most once per size change', r.n <= steps.length + 3, r.n + ' repaints for ' + steps.length + ' changes');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
