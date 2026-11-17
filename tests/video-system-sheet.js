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
    const st = frameState(S.time); st.fade = 1; await previewR.ensure(pagesFor(st)); previewR.fx.clear(); previewR.render(st);
    const gl = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const at = (x, y) => { const o = ((H - 1 - y) * W + x) * 4; return [px[o], px[o + 1], px[o + 2]]; }, band = S.set.letterbox ? Math.floor(Math.min(H, W / 2.39)) : H, yA = (H - band) >> 1, paper = at(2, yA + 2);          // with the Letterbox on, the black bars are left out
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = yA; y < yA + band; y++) for (let x = 0; x < W; x++) { const c = at(x, y); if (Math.abs(c[0] - paper[0]) + Math.abs(c[1] - paper[1]) + Math.abs(c[2] - paper[2]) > 90) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
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
  // Letterbox: it never changes the scale, and shrinks only a system that no longer fits the band
  const set = (k, v) => p.evaluate(([k, v]) => { S.set[k] = v; }, [k, v]);
  ok('Letterbox is off by default and an old tbMargin is ignored on import', await p.evaluate(() => DEFAULTS.letterbox === false && !('tbMargin' in DEFAULTS) && !('tbMargin' in cleanSettings({ tbMargin: 12 }))));
  const w0b = (await look(1, 0)).bb, t0 = await look(2, 0); await set('letterbox', true); const wl = (await look(1, 0)).bb, tl = await look(2, 0); await set('letterbox', false);
  ok('Letterbox leaves the score scale alone', Math.abs((w0b[2] - w0b[0]) - (wl[2] - wl[0])) <= 2 && (wl[3] - wl[1]) === (w0b[3] - w0b[1]), (w0b[2] - w0b[0]) + ' vs ' + (wl[2] - wl[0]));
  ok('a tall system shrinks alone to the 2.39:1 band', (tl.bb[3] - tl.bb[1]) <= tl.W / 2.39 * 0.88 + 2 && (tl.bb[3] - tl.bb[1]) < (t0.bb[3] - t0.bb[1]) && (tl.bb[2] - tl.bb[0]) < (t0.bb[2] - t0.bb[0]), (tl.bb[3] - tl.bb[1]) + ' vs ' + (t0.bb[3] - t0.bb[1]) + ' of ' + t0.H);
  ok('the tall system is still centered', Math.abs(pad(tl).t - pad(tl).b) <= 6 && Math.abs(pad(tl).l - pad(tl).r) <= 3);
  const sl = await p.evaluate(() => { const r = document.querySelector('#letterbox'), f = document.querySelector('#letterboxField'); const o = { shown: !f.hidden, off: !r.checked, lab: f.querySelector('label').textContent }; r.click(); o.on = S.set.letterbox === true; r.click(); o.back = S.set.letterbox === false; return o; });
  ok('the Letterbox switch shows in System and moves the setting', sl.shown && sl.off && sl.on && sl.back && sl.lab === 'Letterbox', JSON.stringify(sl));
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
    await new Promise(r => setTimeout(r, 700));          // the Letterbox's bars may still be sliding from the steps above: a frame at rest is the one that matches the export
    const W = previewR.W, H = previewR.H, cv = document.createElement('canvas'), rend = new Renderer(cv, PageSource, { cap: 6 }); rend.resize(W, H);
    S.time = showAt(1, 0); const st = frameState(S.time); st.fade = 1; previewR.clearTextures(); await rend.ensure(pagesFor(st)); await previewR.ensure(pagesFor(st)); previewR.fx.clear();
    const read = r => { r.render(st); const g = r.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px); return px; };
    const a = read(previewR), b = read(rend); let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]); rend.destroy(); return d / a.length;
  });
  ok('an exported frame matches the preview', same < 1, String(same));
  // the transitions work with the full-frame sheet
  for (const tr of ['slide', 'flip', 'cut']) {
    const r = await p.evaluate(async tr => {
      S.set.transition = tr; const D = flipDur(), t = D ? S.turns[0] - refOffset() + D * 0.5 : S.turns[0] + 0.05, st = frameState(t); st.fade = 1; S.time = t;
      await previewR.ensure(pagesFor(st)); previewR.fx.clear(); previewR.render(st); const g = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
      let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 300) lit++; return { lit: lit / (W * H), flip: st.flip };
    }, tr);
    ok(tr + ' draws a sheet' + (tr === 'cut' ? '' : ' mid-turn'), r.lit > 0.2, JSON.stringify(r));
  }
  await set('transition', 'flip');
  // an uneven scan shows no hard seam where the page meets the paper
  const u = await p.evaluate(async () => {
    previewR.clearTextures(); S.time = showAt(3, 0); const st = frameState(S.time); st.fade = 1; await previewR.ensure(pagesFor(st)); previewR.fx.clear(); previewR.render(st);
    const W = previewR.W, H = previewR.H, f = sysFit(sysKey(3, 0), W, H), x = Math.round((W - f.dw) / 2), y0 = Math.round((H - f.dh) / 2), xc = x + 12, g = previewR.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
    const v = yy => px[((H - 1 - yy) * W + xc) * 4]; let step = 0; for (let yy = y0 - 5; yy < y0 + 1; yy++) step = Math.max(step, Math.abs(v(yy + 1) - v(yy)));
    return { step, paper: v(2), src: 0.88 * 255 };
  });
  ok('the page edge is feathered into the paper', Math.abs(u.paper - u.src) > 15 && u.step <= Math.abs(u.paper - u.src) * 0.6, JSON.stringify(u));
  // Margin is the room around the music on every side: a Full page and a tall system answer it above and below too, and at the default 3% they are exactly as they were
  const mg = await p.evaluate(() => {
    const W = 1280, H = 720, o = S.set.margin, ol = S.set.letterbox, r = SYS.byPage.get(1), keep = r.systems, tall = sysKey(2, 0), out = {};
    const old = (key, m, lb) => { const pa = S.pdf.aspect, mx = m / 100, band = lb ? Math.min(H, W / 2.39) : H, f = (() => { S.set.margin = m; S.set.letterbox = lb; return sysFit(key, W, H); })(), b = f.box;
      let wide = 0; new Set(S.pdf.keep).forEach(i => { const q = SYS.byPage.get(i); if (q) q.systems.forEach(s => { wide = Math.max(wide, (s.right - s.left) * pa); }); });
      const sc = wide ? W * (1 - 2 * mx) / wide : W * (1 - 2 * mx) / pa, s = Math.min(sc, W * (1 - 2 * mx) / Math.max(1e-6, (b.right - b.left) * pa), band * 0.88 / Math.max(1e-6, b.bottom - b.top)); return { f, s }; };
    r.systems = []; const full = sysKey(1, 0), o1 = old(full, 3, false), o2 = old(full, 3, true), o3 = old(tall, 3, false), o4 = old(tall, 3, true);          // the 0.88 of before, worked out here
    out.same = [o1, o2, o3, o4].map(q => Math.abs(q.f.s - q.s) < 1e-9);
    const h = m => { S.set.margin = m; S.set.letterbox = false; const f = sysFit(full, W, H); return f.dh; };
    out.full = [0, 3, 6, 10].map(h); r.systems = keep; S.set.margin = o; S.set.letterbox = ol; return out;
  });
  ok('at 3% a Full page and a tall system are fitted exactly as before, with and without Letterbox', mg.same.every(Boolean), JSON.stringify(mg));
  ok('a Full page grows and shrinks with Margin', mg.full[0] > mg.full[1] && mg.full[1] > mg.full[2] && mg.full[2] > mg.full[3] && mg.full[0] >= 718, JSON.stringify(mg.full));
  // a page is drawn from the PDF once per size, however many systems it has, and Margin or Letterbox never draw it again
  const dr = await p.evaluate(async () => {
    const pg = await S.pdf.doc.getPage(1), P = Object.getPrototypeOf(pg), o = P.render; let n = 0; P.render = function (...a) { n++; return o.apply(this, a); };
    sysPagesClear(); const W = 1280, H = 720, om = S.set.margin, keys = [0, 1, 2].map(k => sysKey(0, k)), out = {};
    for (const k of keys) await sysSheet(k, W, H); out.systems = n; n = 0;
    S.set.margin = 4; for (const k of keys) await sysSheet(k, W, H); S.set.letterbox = true; for (const k of keys) await sysSheet(k, W, H); S.set.letterbox = false; out.steps = n; S.set.margin = om; P.render = o; return out;
  });
  ok('three systems on a page draw the page once', dr.systems === 1, JSON.stringify(dr));
  ok('a Margin step and a Letterbox switch draw nothing from the PDF', dr.steps === 0, JSON.stringify(dr));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
