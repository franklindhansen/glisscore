// The start and end brackets in the video timeline: the blue grip drags like the line, a drag at the edge keeps extending and scrolling the timeline
// (faster the further past the edge) with the handle under the cursor, and snapping and clamping still work.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-bracket-drag.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 4; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-brdrag.pdf'); fs.writeFileSync(pdf, await doc.save());
  const sr = 8000, n = sr * 40, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(60 * Math.sin(i / 20));
  const aud = path.join(os.tmpdir(), 'kf-brdrag.wav'); fs.writeFileSync(aud, wav);
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf); await p.setInputFiles('#audioIn', aud);
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.audio && window[K].S.audio.duration > 30, K, { timeout: 60000 }); await p.waitForTimeout(800);
  const box = await p.evaluate(K => { const q = window[K].TL.canvas.getBoundingClientRect(); return { l: q.left, t: q.top }; }, K);
  const st = () => p.evaluate(K => { const k = window[K], S = k.S, TL = k.TL; return { vs: S.vStart, ve: k.vEnd(), vEndSet: S.vEndSet, xs: k.t2x(S.vStart), xe: k.t2x(k.vEnd()), vw: TL.vw, drag: TL.drag && TL.drag.kind, rulerH: TL.rulerH, trackY: TL.trackY, startMax: S.turns[0] - k.refOffset() - 0.3, dur: S.audio.duration }; }, K);
  const reset = async () => { await p.evaluate(K => { const k = window[K]; k.S.vStart = 0; k.S.vEndSet = null; k.S.time = 0; k.onTrimChanged(); }, K); await p.click('#bFit'); await p.waitForTimeout(400); };
  const mv = (x, y, o) => p.mouse.move(box.l + x, box.t + y, o);
  await reset(); let s = await st();
  // the grip, in the ruler
  await mv(s.xs + 6, 12); await p.mouse.down(); await mv(s.xs + 46, 12, { steps: 6 }); let m = await st(); await p.mouse.up(); await p.waitForTimeout(300);
  ok('dragging the start bracket by its grip moves it', m.drag === 'trim' && m.vs > 0.3, JSON.stringify(m));
  await reset(); s = await st();
  await mv(s.xe - 6, 12); await p.mouse.down(); await mv(s.xe - 46, 12, { steps: 6 }); m = await st(); await p.mouse.up(); await p.waitForTimeout(300);
  ok('dragging the end bracket by its grip moves it', m.drag === 'trim' && m.vEndSet !== null && m.vEndSet < s.dur - 0.3, JSON.stringify(m));
  // a click in the ruler away from a bracket still just moves the playhead
  await reset(); s = await st(); await mv(s.vw / 2, 12); await p.mouse.down(); m = await st(); await p.mouse.up();
  ok('the ruler away from the grips still scrubs', m.drag === 'scrub', m.drag);
  // snapping and clamping
  await reset(); s = await st();
  await mv(s.xs, 50); await p.mouse.down(); await mv(s.xs + 80, 50, { steps: 5 }); await mv(s.xs + 4, 50, { steps: 5 }); m = await st(); await p.mouse.up(); await p.waitForTimeout(300);
  ok('the start bracket snaps back to the start of the audio', m.vs === 0, JSON.stringify(m));
  await reset(); s = await st();
  await mv(s.xs, 50); await p.mouse.down(); await mv(s.xs + 600, 50, { steps: 8 }); m = await st(); await p.mouse.up(); await p.waitForTimeout(300);
  ok('the start bracket stops at the first page turn', Math.abs(m.vs - s.startMax) < 0.05 && m.vs <= s.startMax + 1e-6, JSON.stringify({ vs: m.vs, startMax: s.startMax }));
  await reset(); s = await st();
  await mv(s.xe, 50); await p.mouse.down(); await mv(s.xe - 80, 50, { steps: 5 }); await mv(s.xe - 4, 50, { steps: 5 }); m = await st(); await p.mouse.up(); await p.waitForTimeout(300);
  ok('the end bracket snaps back to the default end', m.vEndSet === null, JSON.stringify(m));
  // the edge: one drag past the left edge pulls the start before the audio, and the handle stays under the cursor
  const hold = async (x, ms) => { await reset(); s = await st(); await mv(s.xs, 50); await p.mouse.down(); await mv(s.xs - 10, 50, { steps: 3 }); await mv(x, 50, { steps: 4 }); const a = await st(); await p.waitForTimeout(ms); const z = await st(); return { a, z }; };
  let h = await hold(2, 1200);
  ok('holding the start bracket at the left edge keeps pulling the start before the audio', h.z.vs < -3 && h.z.vs < h.a.vs, JSON.stringify({ a: h.a.vs, z: h.z.vs }));
  ok('the handle stays on the cursor while it scrolls', Math.abs(h.z.xs - 2) <= 8 && h.z.drag === 'trim', JSON.stringify({ xs: h.z.xs }));
  const far = h.z.vs; await p.mouse.up(); await p.waitForTimeout(600); let r = await st();
  ok('on release the start stays before the audio, in view, with nothing to re-grab', r.vs <= far + 1e-6 && r.xs >= 0 && r.xs <= r.vw && r.drag === null, JSON.stringify({ vs: r.vs, xs: r.xs }));
  await mv(r.xs, 50); await p.mouse.down(); m = await st(); await p.mouse.up();
  ok('the bracket can be grabbed again where it stopped', m.drag === 'trim', m.drag);
  // speed rises with the distance past the edge
  h = await hold(16, 500); const slow = h.a.vs - h.z.vs; await p.mouse.up();
  h = await hold(-60, 500); const fast = h.a.vs - h.z.vs; await p.mouse.up();
  ok('the further past the edge, the faster it goes', slow > 0.3 && fast > slow * 1.5, JSON.stringify({ slow, fast }));
  // the end bracket at the right edge extends past the audio's end
  await reset(); s = await st(); await mv(s.xe, 50); await p.mouse.down(); await mv(s.xe + 10, 50, { steps: 3 }); await mv(s.vw - 2, 50, { steps: 4 }); await p.waitForTimeout(1000); m = await st(); await p.mouse.up();
  ok('holding the end bracket at the right edge keeps pulling the end past the audio', m.ve > s.dur + 3 && Math.abs(m.xe - (s.vw - 2)) <= 8, JSON.stringify({ ve: m.ve, dur: s.dur, xe: m.xe }));
  // reduced motion: the same drag works, with the speed taken straight (no easing), and the handle still sits under the cursor
  await p.emulateMedia({ reducedMotion: 'reduce' });
  h = await hold(2, 600); const rm = h.z;
  ok('with reduced motion the edge drag still works and the handle stays on the cursor', rm.vs < h.a.vs - 1 && Math.abs(rm.xs - 2) <= 8, JSON.stringify({ a: h.a.vs, z: rm.vs, xs: rm.xs })); await p.mouse.up();
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  ok('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
