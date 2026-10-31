// Video, System layout: the sheet, scale, and placement. Each system is drawn alone on a full-frame sheet in the page's paper color, centered on its own ink with equal padding
// on both sides, at one scale for the whole score (set by the widest system and Page margin); a tall system shrinks alone to fit the Top and bottom margin; neighbors never show.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-sheet.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842, CREAM = [0.96, 0.91, 0.78];
function drawPage(doc, spec) {
  const page = doc.addPage([PW, PH]);
  if (spec.paper) page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: rgb(...spec.paper) });
  if (spec.left) page.drawRectangle({ x: 0, y: 0, width: PW * 0.4, height: PH, color: rgb(...spec.left) });
  const line = (x0, y0, x1, y1, t) => page.drawLine({ start: { x: x0, y: PH - y0 }, end: { x: x1, y: PH - y1 }, thickness: t, color: rgb(0, 0, 0) });
  spec.systems.forEach(sy => {
    sy.staves.forEach(off => { for (let k = 0; k < 5; k++) line(sy.x0, sy.y + off + k * sy.d, sy.x1, sy.y + off + k * sy.d, 0.7); });
    const top = sy.y + sy.staves[0], bot = sy.y + sy.staves[sy.staves.length - 1] + 4 * sy.d;
    [sy.x0, (sy.x0 + sy.x1) / 2, sy.x1].forEach(x => { sy.staves.forEach(off => line(x, sy.y + off, x, sy.y + off + 4 * sy.d, 0.8)); if (x === sy.x0) line(x, top, x, bot, 0.9); });
    sy.staves.forEach(off => { for (let k = 0; k < 8; k++) page.drawEllipse({ x: sy.x0 + 20 + k * (sy.x1 - sy.x0 - 40) / 8, y: PH - (sy.y + off + (k % 5) * sy.d), xScale: sy.d * 0.6, yScale: sy.d * 0.45, color: rgb(0, 0, 0) }); });
  });
}
const trio = (x1s, paper) => ({ paper, systems: [0, 1, 2].map(k => ({ y: 110 + k * 250, staves: [0, 62], d: 7, x0: 50, x1: x1s[k] })) });
(async () => {
  const doc = await PDFDocument.create();
  drawPage(doc, trio([545, 545, 545], CREAM));                                                    // 0: cream paper, three systems the same width
  drawPage(doc, trio([545, 545, 300]));                                                           // 1: a short last system
  drawPage(doc, { systems: [{ y: 60, staves: [0, 115, 230, 345, 460, 575], d: 7, x0: 50, x1: 545 }] });          // 2: one system as tall as the page
  drawPage(doc, { paper: [0.96, 0.96, 0.96], left: [0.88, 0.88, 0.88], systems: trio([545, 545, 545]).systems });          // 3: an uneven scan, darker along the left
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('console: ' + m.text().slice(0, 300)); });
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(500);
  await p.evaluate(() => { window.showAt = (i, k) => { const n = S.spreads.findIndex(sp => sp[1] === sysKey(i, k)); return n <= 0 ? S.vStart : S.turns[n - 1] + flipDur() + 0.05; }; });
  // show system `k` of page `i` and read the frame back: the paper color, and the box that holds everything unlike it
  const look = (i, k = 0) => p.evaluate(async ([i, k]) => {
    previewR.clearTextures(); S.time = showAt(i, k);
    const st = frameState(S.time); st.fade = 1; await previewR.ensure(pagesFor(st)); previewR.render(st);
    const gl = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const at = (x, y) => { const o = ((H - 1 - y) * W + x) * 4; return [px[o], px[o + 1], px[o + 2]]; }, paper = at(2, 2);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = at(x, y); if (Math.abs(c[0] - paper[0]) + Math.abs(c[1] - paper[1]) + Math.abs(c[2] - paper[2]) > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const corners = [at(2, 2), at(W - 3, 2), at(2, H - 3), at(W - 3, H - 3)];
    return { W, H, paper, corners, bb: [x0, y0, x1 + 1, y1 + 1], spread: st.spread, hasSys: (SYS.byPage.get(i) || { systems: [] }).systems.length };
  }, [i, k]);
  const pad = r => ({ l: r.bb[0], r: r.W - r.bb[2], t: r.bb[1], b: r.H - r.bb[3] });

  const a = await look(0, 0), pa = pad(a);
  ok('page 0 has three systems found', a.hasSys === 3, String(a.hasSys));
  ok('the frame is one sheet: all four corners are the same paper color', a.corners.every(c => c.every((v, j) => Math.abs(v - a.corners[0][j]) <= 2)), JSON.stringify(a.corners));
  ok('the paper matches the cream scan', a.paper.every((v, j) => Math.abs(v - CREAM[j] * 255) <= 6), JSON.stringify(a.paper));
  ok('padding is equal left and right', Math.abs(pa.l - pa.r) <= 3, JSON.stringify(pa));
  ok('padding is equal above and below', Math.abs(pa.t - pa.b) <= 6, JSON.stringify(pa));
  const w0 = a.bb[2] - a.bb[0], m = (await p.evaluate(() => S.set.margin)) / 100;
  ok('the widest system fills the width less Page margin on both sides', Math.abs(w0 - a.W * (1 - 2 * m)) <= a.W * 0.03, w0 + ' of ' + a.W * (1 - 2 * m));
  const sel = await p.evaluate(() => SYS.byPage.get(0).systems[0]);
  ok('neighbors never show: only the selected system is drawn', (a.bb[3] - a.bb[1]) <= (sel.bottom - sel.top) * (w0 / ((sel.right - sel.left) * 595 / 842)) * 1.04, (a.bb[3] - a.bb[1]) + 'px high');

  const s = await look(1, 2), ps = pad(s);
  ok('a short last system is centered with equal padding', Math.abs(ps.l - ps.r) <= 3 && Math.abs(ps.t - ps.b) <= 6, JSON.stringify(ps));
  ok('it keeps the score\'s one scale: narrower than the wide systems', (s.bb[2] - s.bb[0]) < 0.6 * w0, (s.bb[2] - s.bb[0]) + ' vs ' + w0);
  ok('the white page gives a white sheet', s.paper.every(v => v >= 250), JSON.stringify(s.paper));
  // Top and bottom margin: it never changes the scale, and shrinks only a system that no longer fits
  const set = (k, v) => p.evaluate(([k, v]) => { S.set[k] = v; }, [k, v]);
  ok('the default is 6% and the setting is accepted by import', await p.evaluate(() => DEFAULTS.tbMargin === 6 && IO_RANGES.tbMargin[1] >= 20));
  const w6 = (await look(1, 0)).bb, t6 = await look(2, 0); await set('tbMargin', 12); const w12 = (await look(1, 0)).bb, t12 = await look(2, 0);
  ok('a larger Top and bottom margin leaves the scale alone', Math.abs((w6[2] - w6[0]) - (w12[2] - w12[0])) <= 2 && (w12[3] - w12[1]) === (w6[3] - w6[1]), (w6[2] - w6[0]) + ' vs ' + (w12[2] - w12[0]));
  ok('a tall system shrinks alone to the room left', Math.abs((t6.bb[3] - t6.bb[1]) - t6.H * 0.88) <= t6.H * 0.03 && Math.abs((t12.bb[3] - t12.bb[1]) - t12.H * 0.76) <= t12.H * 0.03, (t6.bb[3] - t6.bb[1]) + ' / ' + (t12.bb[3] - t12.bb[1]) + ' of ' + t6.H);
  ok('the tall system is narrower than the score\'s one scale gives', (t6.bb[2] - t6.bb[0]) < 0.9 * w0 && (t12.bb[2] - t12.bb[0]) < (t6.bb[2] - t6.bb[0]), (t6.bb[2] - t6.bb[0]) + ' vs ' + w0);
  ok('the tall system is still centered', Math.abs(pad(t12).t - pad(t12).b) <= 6 && Math.abs(pad(t12).l - pad(t12).r) <= 3);
  await set('tbMargin', 6);
  const sl = await p.evaluate(() => { const r = document.querySelector('#tbMargin'), f = document.querySelector('#tbMarginField'); r.value = 10; r.dispatchEvent(new Event('input', { bubbles: true })); const o = { shown: !f.hidden, v: S.set.tbMargin, out: document.querySelector('#tbMarginOut').textContent, lab: f.querySelector('label').textContent }; r.value = 6; r.dispatchEvent(new Event('input', { bubbles: true })); return o; });
  ok('the Top and bottom margin slider shows in System and moves the setting', sl.shown && sl.v === 10 && sl.out === '10%' && /^Top and bottom margin/.test(sl.lab), JSON.stringify(sl));
  await p.evaluate(() => document.querySelector('#tbMargin').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await p.waitForTimeout(900);
  ok('a double-click glides it back to 6%', await p.evaluate(() => { const r = document.querySelector('#tbMargin'); r.value = 15; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return new Promise(res => setTimeout(() => res(+r.value === 6 && S.set.tbMargin === 6), 1500)); }));
  // Invert colors and Ink color apply on top
  await set('invert', true); const inv = await look(0, 0); await set('invert', false);
  ok('Invert colors turns the paper dark', inv.paper.every(v => v < 60), JSON.stringify(inv.paper));
  // wide, tall, and square frames
  for (const [W, H] of [[900, 506], [506, 900], [700, 700]]) {
    const r = await p.evaluate(async ([W, H]) => { previewR.resize(W, H); previewR.clearTextures(); return 1; }, [W, H]).then(() => look(1, 2)), q = pad(r);
    ok('a ' + W + 'x' + H + ' frame centers the short system', Math.abs(q.l - q.r) <= 3 && Math.abs(q.t - q.b) <= 6 && r.bb[2] - r.bb[0] > 0, JSON.stringify(q));
  }
  // the exported video draws what the preview draws
  const same = await p.evaluate(async () => {
    const W = previewR.W, H = previewR.H, cv = document.createElement('canvas'), rend = new Renderer(cv, PageSource, { cap: 6 }); rend.resize(W, H);
    S.time = showAt(1, 0); const st = frameState(S.time); st.fade = 1; previewR.clearTextures(); await rend.ensure(pagesFor(st)); await previewR.ensure(pagesFor(st));
    const read = r => { r.render(st); const g = r.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px); return px; };
    const a = read(previewR), b = read(rend); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); rend.destroy(); return d / a.length;
  });
  ok('an exported frame matches the preview', same < 1, String(same));
  // the transitions work with the full-frame sheet
  for (const tr of ['slide', 'flip', 'cut']) {
    const r = await p.evaluate(async tr => {
      S.set.transition = tr; const D = flipDur(), t = D ? S.turns[0] - refOffset() + D * 0.5 : S.turns[0] + 0.05, st = frameState(t); st.fade = 1; S.time = t;
      await previewR.ensure(pagesFor(st)); previewR.render(st); const g = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
      let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 300) lit++; return { lit: lit / (W * H), flip: st.flip };
    }, tr);
    ok(tr + ' draws a sheet' + (tr === 'cut' ? '' : ' mid-turn'), r.lit > 0.2, JSON.stringify(r));
  }
  await set('transition', 'flip');
  // an uneven scan shows no hard seam where the page meets the paper
  const u = await p.evaluate(async () => {
    previewR.clearTextures(); S.time = showAt(3, 0); const st = frameState(S.time); st.fade = 1; await previewR.ensure(pagesFor(st)); previewR.render(st);
    const W = previewR.W, H = previewR.H, f = sysFit(sysKey(3, 0), W, H), x = Math.round((W - f.dw) / 2), y0 = Math.round((H - f.dh) / 2), xc = x + 12, g = previewR.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
    const v = yy => px[((H - 1 - yy) * W + xc) * 4]; let step = 0; for (let yy = y0 - 5; yy < y0 + 1; yy++) step = Math.max(step, Math.abs(v(yy + 1) - v(yy)));
    return { step, paper: v(2), src: 0.88 * 255 };
  });
  ok('the page edge is feathered into the paper', Math.abs(u.paper - u.src) > 15 && u.step <= Math.abs(u.paper - u.src) * 0.6, JSON.stringify(u));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
