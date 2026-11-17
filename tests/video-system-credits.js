// Video, System layout: the credits card is one sheet of the score's own paper (the median of the pages' paper) with dark text when Invert colors is off, for End; with Invert on it is as it was
// (the Background color, light or dark text). The Background setting is never rewritten, the Ink color does not change it, and a title that wraps to three lines fits the Letterbox band. The preview and an export frame match.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-credits.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function drawPage(doc, paper) {
  const page = doc.addPage([PW, PH]); if (paper) page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: rgb(...paper) });
  const line = (x0, y0, x1, y1, t) => page.drawLine({ start: { x: x0, y: PH - y0 }, end: { x: x1, y: PH - y1 }, thickness: t, color: rgb(0, 0, 0) });
  [0, 1].forEach(k => { const y = 150 + k * 300; for (const off of [0, 62]) for (let j = 0; j < 5; j++) line(50, y + off + j * 7, 545, y + off + j * 7, 0.7); [50, 300, 545].forEach(x => line(x, y, x, y + 90, 0.9)); for (let q = 0; q < 8; q++) page.drawEllipse({ x: 70 + q * 60, y: PH - (y + (q % 5) * 7), xScale: 4, yScale: 3, color: rgb(0, 0, 0) }); });
}
(async () => {
  const doc = await PDFDocument.create(); drawPage(doc, [0.96, 0.91, 0.78]); drawPage(doc, [0.96, 0.91, 0.78]); drawPage(doc, null);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 3 && S.thumbs.every(Boolean), null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(800);
  await p.evaluate(() => { S.credits.title = 'A long title that wraps over three lines at the size the card is drawn in'; S.credits.titleEdited = true; S.credits.l2 = 'Composer'; S.credits.l3 = 'Arranger'; S.set.creditsOn = true; syncCredits(); applyGroupSwitches(); });
  await p.waitForTimeout(800);
  // the End card's frame: the paper at the corners and whether any dark text is on it
  const card = (opt = {}) => p.evaluate(async opt => {
    Object.assign(S.set, opt); stageDirty = true; const last = S.spreads.length - 1, t = last === 0 ? S.vStart : S.turns[last - 1] + flipDur() + 0.05; S.time = t;
    const st = frameState(t); st.fade = 1; previewR.fx.clear(); previewR.cardKey = ''; await previewR.ensure(pagesFor(st)); previewR.render(st);
    const g = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
    const at = (x, y) => { const o = ((H - 1 - y) * W + x) * 4; return [px[o], px[o + 1], px[o + 2]]; }; let dark = 0, light = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const c = at(x, y), l = c[0] + c[1] + c[2]; if (l < 200) dark++; else if (l > 700 && opt.invert) light++; }
    return { corner: at(3, 3), mid: at(W >> 1, 3), dark, light, bg: S.set.bg, has: !!S.spreads[last].credits, W, H };
  }, opt);
  const paper = await p.evaluate(() => sysScorePaper()), pg = await p.evaluate(() => [...new Set(S.pdf.keep)].map(i => sysPaper(S.thumbs[S.pdf.slots[i].src])));
  const med = c => pg.map(q => q[c]).sort((a, b) => a - b)[pg.length >> 1];
  ok('the score-wide paper is the median of the pages\' paper', paper.every((v, c) => v === med(c)) && paper[2] < 230, JSON.stringify([paper, pg]));
  await p.evaluate(() => { S.set.invert = false; S.set.bg = '#102030'; });
  const a = await card();
  ok('the End card is a sheet of the score paper with dark text, whatever the Background is', a.has && a.corner.every((v, c) => Math.abs(v - paper[c]) <= 2) && a.dark > 100, JSON.stringify(a));
  ok('the Background setting is not changed', a.bg === '#102030');
  const ink = await card({ ink: '#ff0000' });
  ok('the Ink color does not change the card when Invert is off', ink.corner.every((v, c) => v === a.corner[c]) && Math.abs(ink.dark - a.dark) <= 4, JSON.stringify([ink.corner, ink.dark, a.dark]));
  const inv = await card({ invert: true, bg: '#000000' });
  ok('with Invert on the card is as before: the Background color, light text', inv.corner.every(v => v < 6) && inv.light > 100, JSON.stringify(inv));
  await p.evaluate(() => { S.set.invert = false; S.set.bg = '#000000'; });
  // fade and Credits end: the card fades to the Background as it does today
  const fade = await p.evaluate(async () => {
    const last = S.spreads.length - 1, t = S.turns[last - 1] + flipDur() + 0.05; S.time = t; const st = frameState(t); st.fade = 0.5; await previewR.ensure(pagesFor(st)); previewR.render(st);
    const g = previewR.gl, W = previewR.W, H = previewR.H, px = new Uint8Array(4); g.readPixels(3, H - 4, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px); return Array.from(px.slice(0, 3));
  });
  ok('a half faded card is halfway to the Background', fade.every((v, c) => Math.abs(v - paper[c] / 2) <= 6) || fade.every((v, c) => v < paper[c]), JSON.stringify([fade, paper]));
  // the card fits the Letterbox band with a title wrapping to three lines
  const fit = await p.evaluate(() => {
    const W = 1280, H = 720, band = Math.round(Math.min(H, W / 2.39) * Math.max(0.5, 1 - 4 * S.set.margin / 100)), extent = o => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; drawCreditsCard(cv, Object.assign({ title: S.credits.title, l2: S.credits.l2, l3: S.credits.l3, dark: false, paper: [255, 255, 255] }, o)); const d = cv.getContext('2d').getImageData(0, 0, W, H).data; let y0 = H, y1 = -1; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4] < 120) { if (y < y0) y0 = y; if (y > y1) y1 = y; } return [y0, y1]; };
    return { band, free: extent({}), fitted: extent({ band }), none: extent({ band: 0 }) };
  });
  ok('a title that wraps to three lines is taller than the band', fit.free[1] - fit.free[0] > fit.band, JSON.stringify(fit));
  ok('with the band told, the whole card fits it, centered', fit.fitted[1] - fit.fitted[0] <= fit.band && fit.fitted[0] >= (720 - fit.band) / 2 - 2 && fit.fitted[1] <= (720 + fit.band) / 2 + 2, JSON.stringify(fit));
  ok('with no band the card is drawn exactly as before', fit.none[0] === fit.free[0] && fit.none[1] === fit.free[1], JSON.stringify(fit));
  // the preview and an export frame match, with and without Letterbox, at the End card and in the middle of the turn to it
  for (const lb of [false, true]) {
    const d = await p.evaluate(async lb => {
      S.set.letterbox = lb; S.set.invert = false; stageDirty = true; await new Promise(r => setTimeout(r, 700)); previewR.cardKey = '';
      const last = S.spreads.length - 1, out = [];
      for (const t of [S.turns[last - 1] + flipDur() + 0.05, S.turns[last - 1] + flipDur() * 0.5]) {
        S.time = t; const st = frameState(t); st.fade = 1; const W = previewR.W, H = previewR.H, read = r => { const g = r.gl, px = new Uint8Array(W * H * 4); g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px); return px; };
        await previewR.ensure(pagesFor(st)); previewR.fx.clear(); previewR.render(st); const a = read(previewR);
        const cv = document.createElement('canvas'), rend = new Renderer(cv, PageSource, { cap: 6 }); rend.resize(W, H); await rend.ensure(pagesFor(st)); rend.fx.clear(); rend.render(st); const c = read(rend); rend.destroy();
        let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - c[i]); out.push(s / a.length);
      }
      S.set.letterbox = false; return out;
    }, lb);
    ok('the preview and an export frame match at the End card and mid-turn' + (lb ? ' with Letterbox' : ''), d.every(v => v < 2), JSON.stringify(d));
  }
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
