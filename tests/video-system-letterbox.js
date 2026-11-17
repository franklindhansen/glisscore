// Video, System layout: the Letterbox's bars slide in and out on the preview and a system too tall for the band resizes with them, composed from its page's kept drawing (nothing is drawn from the PDF while they move);
// a system that already fits does not move; with reduced motion the change is at once; undo and redo slide the same way; the export and a frame at rest are exactly as before.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-letterbox.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function drawPage(doc, systems) {
  const page = doc.addPage([PW, PH]), line = (x0, y0, x1, y1, t) => page.drawLine({ start: { x: x0, y: PH - y0 }, end: { x: x1, y: PH - y1 }, thickness: t, color: rgb(0, 0, 0) });
  systems.forEach(sy => {
    sy.staves.forEach(off => { for (let k = 0; k < 5; k++) line(sy.x0, sy.y + off + k * sy.d, sy.x1, sy.y + off + k * sy.d, 0.7); });
    const top = sy.y + sy.staves[0], bot = sy.y + sy.staves[sy.staves.length - 1] + 4 * sy.d;
    [sy.x0, (sy.x0 + sy.x1) / 2, sy.x1].forEach(x => { sy.staves.forEach(off => line(x, sy.y + off, x, sy.y + off + 4 * sy.d, 0.8)); if (x === sy.x0) line(x, top, x, bot, 0.9); });
    sy.staves.forEach(off => { for (let k = 0; k < 8; k++) page.drawEllipse({ x: sy.x0 + 20 + k * (sy.x1 - sy.x0 - 40) / 8, y: PH - (sy.y + off + (k % 5) * sy.d), xScale: sy.d * 0.6, yScale: sy.d * 0.45, color: rgb(0, 0, 0) }); });
  });
}
(async () => {
  const doc = await PDFDocument.create();
  drawPage(doc, [0, 1, 2].map(k => ({ y: 110 + k * 250, staves: [0, 62], d: 7, x0: 50, x1: 545 })));                                      // 0: three systems that fit the band
  drawPage(doc, [{ y: 60, staves: [0, 115, 230, 345, 460, 575], d: 7, x0: 50, x1: 545 }]);                                              // 1: one system as tall as the page
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 2, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(800);
  await p.evaluate(() => { window.showAt = (i, k) => { const n = S.spreads.findIndex(sp => sp[1] === sysKey(i, k)); return n <= 0 ? S.vStart : S.turns[n - 1] + flipDur() + 0.05; }; window.PW = 0; });
  // what the frame shows: the height of the black bar at the top, and the box that holds everything unlike the paper inside the band
  const frame = () => p.evaluate(() => {
    const g = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
    const at = (x, y) => { const o = ((H - 1 - y) * W + x) * 4; return [px[o], px[o + 1], px[o + 2]]; }; let bar = 0; while (bar < H / 2 && at(3, bar).every(v => v < 6)) bar++;
    const paper = at(2, bar + 2); let y0 = H, y1 = -1; for (let y = bar; y < H - bar; y++) for (let x = 0; x < W; x += 2) { const c = at(x, y); if (Math.abs(c[0] - paper[0]) + Math.abs(c[1] - paper[1]) + Math.abs(c[2] - paper[2]) > 90) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    return { bar, h: y1 - y0 + 1, v: LB.v, moving: LB.moving, W, H };
  });
  const settle = async () => { await p.waitForFunction(() => !LB.moving, null, { timeout: 5000 }); await p.waitForTimeout(250); };
  // frames each animation frame while the bars move: sampled from inside the page
  const run = (act, key) => p.evaluate(async ([act, key]) => {
    const out = []; const g = previewR.gl, sample = () => { const W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
      const at = (x, y) => { const o = ((H - 1 - y) * W + x) * 4; return [px[o], px[o + 1], px[o + 2]]; }; let bar = 0; while (bar < H / 2 && at(3, bar).every(v => v < 6)) bar++;
      const paper = at(2, bar + 2); let y0 = H, y1 = -1; for (let y = bar; y < H - bar; y++) for (let x = 0; x < W; x += 2) { const c = at(x, y); if (Math.abs(c[0] - paper[0]) + Math.abs(c[1] - paper[1]) + Math.abs(c[2] - paper[2]) > 90) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      return { bar, h: y1 - y0 + 1, v: +LB.v.toFixed(3), t: Math.round(performance.now() - t0) }; };
    S.time = showAt(key[0], key[1]); stageDirty = true; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__pdfDraws = 0; const pg = await S.pdf.doc.getPage(1), P = Object.getPrototypeOf(pg), o = P.render; P.render = function (...a) { window.__pdfDraws++; return o.apply(this, a); };
    const t0 = performance.now(); ({ on: () => { S.set.letterbox = true; stageDirty = true; }, off: () => { S.set.letterbox = false; stageDirty = true; }, undo: () => document.querySelector('#bUndo').click(), redo: () => document.querySelector('#bRedo').click() })[act](); const end = t0 + 1500;
    await new Promise(res => { const f = () => { out.push(sample()); if (performance.now() < end && (LB.moving || out.length < 3)) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    P.render = o; return { out, draws: window.__pdfDraws };
  }, [act, key]);
  await p.evaluate(() => { S.set.letterbox = false; stageDirty = true; }); await settle();
  const t0 = await frame(), f0 = await p.evaluate(() => { S.time = showAt(0, 0); stageDirty = true; return 1; }); await p.waitForTimeout(300); const fit0 = await frame();
  ok('with no Letterbox there are no bars', t0.bar === 0, JSON.stringify(t0));
  // on: the tall system
  await p.evaluate(() => { S.time = showAt(1, 0); stageDirty = true; }); await p.waitForTimeout(400); const tall0 = await frame();
  const on = await run('on', [1, 0]);
  const bars = on.out.map(f => f.bar), hs = on.out.map(f => f.h), last = on.out[on.out.length - 1];
  const mono = (a, d) => a.every((v, i) => !i || (d > 0 ? v >= a[i - 1] - 1 : v <= a[i - 1] + 1));          // one dot of give: the sharp sheet replacing the one made while the bars moved can differ by a dot
  ok('the bars slide in over several frames, one way', on.out.length >= 8 && mono(bars, 1) && new Set(bars).size >= 6, JSON.stringify(bars));
  ok('the slide takes about the Audio Editor move time', on.out.length > 3 && Math.abs(on.out[on.out.length - 1].t - (await p.evaluate(() => AE_MOVE_MS))) < 260, JSON.stringify(on.out.map(f => f.t)));
  ok('the tall system gets smaller with the bars, a little each frame', mono(hs, -1) && new Set(hs).size >= 6 && hs[hs.length - 1] < tall0.h, JSON.stringify(hs));
  ok('nothing was drawn from the PDF while they moved', on.draws === 0, String(on.draws));
  await settle(); const rest = await frame();
  ok('at rest the bars and the system are the Letterbox\'s own', rest.bar === Math.floor((rest.H - rest.W / 2.39) / 2) && Math.abs(rest.h - last.h) <= 2, JSON.stringify([rest, last]));
  // a frame at rest equals a fresh render of the same state
  const same = await p.evaluate(async () => {
    const W = previewR.W, H = previewR.H, read = r => { const g = r.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px); return px; };
    const st = frameState(S.time); st.fade = 1; previewR.render(st); const a = read(previewR);
    const cv = document.createElement('canvas'), rend = new Renderer(cv, PageSource, { cap: 6 }); rend.resize(W, H); await rend.ensure(pagesFor(st)); rend.fx.clear(); rend.render(st); const c = read(rend); rend.destroy();
    let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - c[i]); return d / a.length;
  });
  ok('a paused frame at rest matches an export frame', same < 1.5, String(same));
  // off again
  const off = await run('off', [1, 0]);
  ok('they slide out the same way and the tall system grows back', mono(off.out.map(f => f.bar), -1) && mono(off.out.map(f => f.h), 1) && new Set(off.out.map(f => f.bar)).size >= 6, JSON.stringify(off.out.map(f => [f.bar, f.h])));
  await settle(); const back = await frame(); ok('and it ends exactly where it began', back.bar === 0 && Math.abs(back.h - tall0.h) <= 2, JSON.stringify([back, tall0]));
  // a system that already fits does not move
  await p.evaluate(() => { S.time = showAt(0, 0); stageDirty = true; }); await p.waitForTimeout(400);
  const fitOn = await run('on', [0, 0]);
  ok('a system that fits the band does not change size while the bars move', fitOn.out.every(f => Math.abs(f.h - fit0.h) <= 1) && fitOn.out.some(f => f.bar > 0), JSON.stringify(fitOn.out.map(f => [f.bar, f.h])));
  await settle(); await p.evaluate(() => { S.set.letterbox = false; stageDirty = true; }); await settle();
  // the export is exact whatever the preview is doing
  const exp = await p.evaluate(async () => {
    S.set.letterbox = true; stageDirty = true; const W = 960, H = 540, cv = document.createElement('canvas'), rend = new Renderer(cv, PageSource, { cap: 6 }); rend.resize(W, H);
    S.time = showAt(1, 0); const st = frameState(S.time); st.fade = 1; await rend.ensure(pagesFor(st)); rend.fx.clear(); rend.render(st);
    const g = rend.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px); let bar = 0; while (bar < H / 2 && px[((H - 1 - bar) * W + 3) * 4] < 6) bar++; rend.destroy(); S.set.letterbox = false; return { bar, want: Math.floor((H - W / 2.39) / 2), live: LB.v };
  });
  ok('an export frame has the bars in full at once, whatever the preview shows', exp.bar === exp.want, JSON.stringify(exp));
  await settle();
  // undo and redo slide the same way
  await p.evaluate(() => { S.time = showAt(1, 0); }); await p.waitForTimeout(300);
  await p.click('#letterbox'); await settle(); await p.waitForTimeout(200);
  const und = await run('undo', [1, 0]);
  ok('undo slides the bars out', und.out.length >= 8 && mono(und.out.map(f => f.bar), -1) && und.out[und.out.length - 1].bar === 0, JSON.stringify(und.out.map(f => f.bar)));
  const red = await run('redo', [1, 0]);
  ok('redo slides them in', red.out.length >= 8 && mono(red.out.map(f => f.bar), 1) && red.out[red.out.length - 1].bar > 0, JSON.stringify(red.out.map(f => f.bar)));
  await settle(); await p.click('#letterbox'); await settle();
  // reduced motion: at once
  await p.emulateMedia({ reducedMotion: 'reduce' });
  const rm = await run('on', [1, 0]);
  ok('with reduced motion the bars are in at once', rm.out[0].bar > 0 && rm.out.every(f => f.bar === rm.out[0].bar), JSON.stringify(rm.out.map(f => f.bar)));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
