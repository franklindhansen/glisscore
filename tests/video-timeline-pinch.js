// Pinch to zoom the timeline: two fingers apart zoom in, together zoom out, around the point between them; one finger still drags; a second finger ends a drag and leaves no History step; the slider follows and Fit still works.
// Run with the app served (PORT, default 8123):  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-timeline-pinch.js
// Safari on iPhone and iPad reports a pinch as gesture events, which headless Chromium cannot make: that path needs a try on a device.
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 8; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-tl-pinch.pdf'); fs.writeFileSync(pdf, await doc.save());
  const sr = 8000, n = sr * 120, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(60 * Math.sin(i / 20));
  const aud = path.join(os.tmpdir(), 'kf-tl-pinch.wav'); fs.writeFileSync(aud, wav);
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 700, height: 900 }, hasTouch: true }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf); await p.setInputFiles('#audioIn', aud);
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.audio && window[K].S.audio.duration > 100, K, { timeout: 60000 }); await p.waitForTimeout(800);
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const read = () => p.evaluate(K => { const k = window[K], S = k.S; return { pps: S.pxPerSec, hist: S.history.length, sl: k.TL.scroller.scrollLeft, zoom: +document.querySelector('#zoom').value, turns: S.turns.length, t0: S.turns[0] }; }, K);
  const box = await p.evaluate(() => { const r = document.querySelector('#tl').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await p.click('#bFit'); await p.waitForTimeout(400);
  const y = box.y + box.h * 0.5, cx = box.x + box.w / 2;
  const base = await read();
  // fingers apart: zoom in
  await touch('touchStart', [[cx - 40, y], [cx + 40, y]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 40 - i * 15, y], [cx + 40 + i * 15, y]]);
  await touch('touchEnd', []); await p.waitForTimeout(200);
  const zin = await read();
  ok('two fingers apart zoom in', zin.pps > base.pps * 2.5, base.pps.toFixed(2) + ' → ' + zin.pps.toFixed(2));
  ok('the slider follows the pinch', zin.zoom > base.zoom, base.zoom + ' → ' + zin.zoom);
  ok('a pinch is not a History step', zin.hist === base.hist);
  // fingers together: zoom out
  await touch('touchStart', [[cx - 160, y], [cx + 160, y]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx - 160 + i * 15, y], [cx + 160 - i * 15, y]]);
  await touch('touchEnd', []); await p.waitForTimeout(200);
  const zout = await read();
  ok('two fingers together zoom out', zout.pps < zin.pps * 0.6, zin.pps.toFixed(2) + ' → ' + zout.pps.toFixed(2));
  // the point between the fingers stays put
  await p.click('#bFit'); await p.waitForTimeout(400);
  const tAt = x => p.evaluate(([K, x]) => window[K].x2t(x), [K, x]);
  const px = cx + 100, before = await tAt(px - box.x);
  await touch('touchStart', [[px - 30, y], [px + 30, y]]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[px - 30 - i * 12, y], [px + 30 + i * 12, y]]);
  await touch('touchEnd', []); await p.waitForTimeout(200);
  const after = await tAt(px - box.x);
  ok('the zoom is around the point between the fingers', Math.abs(after - before) < 0.6, before.toFixed(2) + 's → ' + after.toFixed(2) + 's');
  await p.click('#bFit'); await p.waitForTimeout(500);
  const fitted = await read();
  ok('Fit works after a pinch', Math.abs(fitted.pps - base.pps) / base.pps < 0.05, base.pps.toFixed(2) + ' vs ' + fitted.pps.toFixed(2));
  // one finger: still moves the playhead
  const t0 = await p.evaluate(K => window[K].S.time, K);
  await touch('touchStart', [[cx + 60, box.y + 10]]); await touch('touchEnd', []); await p.waitForTimeout(150);
  ok('one finger still moves the playhead', (await p.evaluate(K => window[K].S.time, K)) !== t0);
  // a second finger during a turn drag: no step and nothing moved
  await p.evaluate(K => { const k = window[K], S = k.S; if (S.turns.length < 2) { S.turns.push(Math.min(S.audio.duration - 1, S.vStart + 20)); S.turns.sort((a, c) => a - c); } k.TL.staticDirty = true; k.onTurnsChanged && k.onTurnsChanged(); }, K);
  await p.waitForTimeout(200);
  const tt = await p.evaluate(K => { const k = window[K]; return { x: k.t2x(k.S.turns[0]), n: k.S.turns.length, ty: k.TL.trackY + k.TL.trackH / 2 }; }, K);
  const h0 = await read();
  if (tt.n) {
    const tx = box.x + tt.x, ty = box.y + tt.ty;
    await touch('touchStart', [[tx, ty]]); await touch('touchMove', [[tx, ty + 3]]);          // the finger is down on a turn (a sideways move would start the browser's own pan and cancel it)
    await touch('touchStart', [[tx, ty + 3], [tx + 100, ty - 5]]); await touch('touchMove', [[tx, ty + 3], [tx + 140, ty - 5]]); await touch('touchEnd', []); await p.waitForTimeout(200);
    const h1 = await read();
    ok('a second finger during a drag leaves no History step', h1.hist === h0.hist, h0.hist + ' → ' + h1.hist);
    ok('a second finger during a drag moves no turn', Math.abs(h1.t0 - h0.t0) < 0.01, h0.t0 + ' → ' + h1.t0);
  } else ok('a turn exists to drag', false);
  ok('no page errors', !errs.length, errs.join(' | ').slice(0, 200));
  await b.close();
})().catch(e => { console.log('FAIL crashed — ' + e.message); process.exit(1); });
