// Fit fits the video, bracket to bracket (plus the empty room at each end), not the whole audio; the rest of the audio stays scrollable.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-fit-brackets.js
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
  const read = () => p.evaluate(K => { const k = window[K], S = k.S, vs = S.vStart, ve = S.vEndSet == null ? k.t2x(S.audio.duration) && null : S.vEndSet; return { pps: S.pxPerSec, vw: k.TL.vw, fit: S.fitMode, sl: k.TL.scroller.scrollLeft, xs: k.t2x(vs), xe: ve == null ? null : k.t2x(ve), x0: k.t2x(0), xa: k.t2x(S.audio.duration), w: k.TL.scroller.scrollWidth }; }, K);
  const set = (s, e) => p.evaluate(([K, s, e]) => { const k = window[K]; k.S.vStart = s; k.S.vEndSet = e; k.S.time = Math.max(s, Math.min(k.S.time, e || 1e9)); }, [K, s, e]);
  const fit = async () => { await p.click('#bFit'); await p.waitForTimeout(300); return read(); };
  const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
  const base = await fit(); const full = base.pps;
  ok('Brackets at the audio ends: fit shows the whole audio', near(base.x0, ROOM) && near(base.xa, base.vw - ROOM), JSON.stringify(base));
  await set(0, 60); let r = await fit();
  ok('End bracket moved in: the video fills the width less the room', near(r.xs, ROOM) && near(r.xe, r.vw - ROOM) && r.pps > full * 1.5, JSON.stringify(r));
  ok('The rest of the audio is still there to scroll to', r.w > r.vw + 50 && r.xa > r.vw);
  await set(24, null); r = await fit();
  ok('Start bracket moved in: the video fills the width less the room', near(r.xs, ROOM) && near(r.xa, r.vw - ROOM) && r.pps > full * 1.2, JSON.stringify(r));
  ok('The audio before the start bracket is off screen to the left', r.x0 < 0);
  await set(24, 60); r = await fit();
  ok('Both brackets moved in', near(r.xs, ROOM) && near(r.xe, r.vw - ROOM) && r.pps > full * 3, JSON.stringify(r));
  await p.setViewportSize({ width: 1000, height: 900 }); await p.waitForTimeout(500); r = await read();
  ok('Resizing the window keeps the video fitted', r.fit && near(r.xs, ROOM) && near(r.xe, r.vw - ROOM), JSON.stringify(r));
  await set(-5, 125); r = await fit();
  ok('Brackets outward past the audio ends still fit, with the room', near(r.xs, ROOM) && near(r.xe, r.vw - ROOM), JSON.stringify(r));
  // dragging a bracket in fit mode: the axis holds during the drag, refits on release
  await set(0, 105); r = await fit();   // the turns reach about 97s, so the end bracket cannot go in further
  const box = await p.evaluate(() => { const c = document.querySelector('#tl canvas, .tl canvas') || window.__keyframes.TL.canvas, q = c.getBoundingClientRect(); return { l: q.left, t: q.top, y: window.__keyframes.TL.trackY + window.__keyframes.TL.trackH / 2 }; });
  const y = box.t + box.y;
  await p.mouse.move(box.l + r.xe, y); await p.mouse.down(); await p.mouse.move(box.l + r.xe - 40, y, { steps: 5 });
  const mid = await read();
  ok('During the drag the zoom does not jump', near(mid.pps, r.pps, 1e-6) && near(mid.xe, r.xe - 40, 4), JSON.stringify({ r, mid }));
  await p.mouse.up(); await p.waitForTimeout(1100); const after = await read();   // the view glides to the new fit (about 0.5s)
  ok('On release the timeline refits to the new end', after.fit && near(after.xs, ROOM) && near(after.xe, after.vw - ROOM) && after.pps > r.pps, JSON.stringify(after));
  // one motion: after a release, and after a double-click, the bracket stays where it was let go and travels with the view to its new place, in small steps and without a jump
  const trace = async (act, ms = 900) => { await p.evaluate(K => { const k = window[K]; window.__tr = []; window.__t60 = []; const t0 = performance.now(); (function f() { window.__t60.push(k.t2x(60)); window.__tr.push(k.t2x(k.TL.trimD ? k.TL.trimD.e : k.S.vEndSet == null ? k.S.audio.duration : k.S.vEndSet)); if (performance.now() - t0 < 1000) requestAnimationFrame(f); })(); }, K); await act(); await p.waitForTimeout(ms); return p.evaluate(() => ({ x: window.__tr.slice(), mid: window.__t60.slice() })); };
  const smooth = (xs, from) => { const d = xs.slice(1).map((v, i) => Math.abs(v - xs[i])), first = Math.abs(xs.find(v => Math.abs(v - from) < 1e9) - from); return Math.max(...d) < 90 && d.filter(v => v > 0.5).length >= 8; };
  await set(0, 105); r = await fit(); const y2 = box.t + box.y;
  const rel = (await trace(async () => { await p.mouse.move(box.l + r.xe, y2); await p.mouse.down(); await p.mouse.move(box.l + r.xe - 160, y2, { steps: 6 }); await p.mouse.up(); })).x;
  const fin = await read();
  ok('Letting go of a bracket glides the bracket and the view as one motion, with no jump', smooth(rel) && near(rel[rel.length - 1], fin.vw - ROOM, 2), JSON.stringify({ n: rel.length, max: Math.max(...rel.slice(1).map((v, i) => Math.abs(v - rel[i]))), last: rel[rel.length - 1], vw: fin.vw }));
  r = await read();
  const dblT = await trace(async () => { await p.mouse.dblclick(box.l + r.xe, y2); }), dbl = dblT.x; dbl.mid = dblT.mid;
  const fin2 = await read();
  ok('Double-clicking a bracket home glides the view smoothly while the bracket stays put', smooth(dbl.mid) && near(dbl[dbl.length - 1], dbl[0], 2) && fin2.fit && near(fin2.xa, fin2.vw - ROOM, 2), JSON.stringify({ n: dbl.length, max: Math.max(...dbl.slice(1).map((v, i) => Math.abs(v - dbl[i]))), xa: fin2.xa, vw: fin2.vw }));
  ok('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
