// Letting go of a bracket never jumps the timeline: outside Fit, and in full screen, the view glides like it does in Fit.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-bracket-release-glide.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes', ROOM = 36;
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 8; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-fit-brackets.pdf'); fs.writeFileSync(pdf, await doc.save());
  const sr = 8000, n = sr * 120, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(60 * Math.sin(i / 20));
  const aud = path.join(os.tmpdir(), 'kf-fit-brackets.wav'); fs.writeFileSync(aud, wav);
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf); await p.setInputFiles('#audioIn', aud);
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.audio && window[K].S.audio.duration > 100, K, { timeout: 60000 }); await p.waitForTimeout(800);

  const tr = async (act, ms) => { await p.evaluate(K => { const k = window[K]; window.__r = []; const t0 = window.__t0 = performance.now(); (function f() { window.__r.push([performance.now() - t0, k.t2x(30), k.t2x(k.S.vEndSet == null ? k.S.audio.duration : k.S.vEndSet)]); if (performance.now() - t0 < 6000) requestAnimationFrame(f); })(); }, K); const rel = await act(); await p.waitForTimeout(ms); return { out: await p.evaluate(() => window.__r), rel: await p.evaluate(r => r - window.__t0, rel) }; };
  const run = async (tag, Z, WHICH) => {
    await p.evaluate(Z => { const z = document.querySelector('#zoom'); z.value = Z; z.dispatchEvent(new Event('input', { bubbles: true })); }, Z); await p.waitForTimeout(400);
    await p.evaluate(K => { const k = window[K]; k.S.vStart = 0; k.S.vEndSet = null; k.layoutTimeline && k.layoutTimeline(); k.TL.scroller.scrollLeft = k.TL.scroller.scrollWidth; }, K); await p.waitForTimeout(300);
    const box = await p.evaluate(([K, W]) => { const k = window[K], q = k.TL.canvas.getBoundingClientRect(); return { l: q.left, y: q.top + k.TL.trackY + k.TL.trackH / 2, vw: k.TL.vw, x: W === 'end' ? k.t2x(k.S.audio.duration) : k.t2x(0) }; }, [K, WHICH]);
    const { out, rel } = await tr(async () => { await p.mouse.move(box.l + box.x, box.y); await p.mouse.down(); await p.mouse.move(box.l + (WHICH === 'end' ? box.vw - 10 : 10), box.y, { steps: 8 }); await p.waitForTimeout(1200); await p.mouse.move(box.l + box.vw / 2, box.y, { steps: 8 }); await p.waitForTimeout(300); const t = await p.evaluate(() => performance.now()); await p.mouse.up(); return t; }, 1800);
    const after = out.filter(r => r[0] >= rel - 20), step = Math.max(...after.slice(1).map((r, i) => Math.abs(r[1] - after[i][1])));
    ok(tag + ': pulling the ' + WHICH + ' bracket out and letting go moves the view in small steps, with no jump', step < 60 && after.length > 20, JSON.stringify({ step: Math.round(step), frames: after.length }));
  };
  await run('Zoomed out', 0, 'end'); await run('Zoomed out', 0, 'start'); await run('Zoomed in', 40, 'end'); await run('Zoomed in', 40, 'start');
  await p.evaluate(K => window[K].enterFull(), K); await p.waitForTimeout(1200); await p.mouse.move(600, 300); await p.mouse.move(640, 320); await p.waitForTimeout(500);
  await run('Full screen, zoomed out', 0, 'start'); await run('Full screen, zoomed in', 40, 'end');
  ok('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
