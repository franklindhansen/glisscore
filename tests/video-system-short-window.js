// Video, System layout in a short, narrow window (stacked layout, below 960px wide): the preview is capped by the window's height, so the Play button stays on screen like it does in Spread.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-short-window.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842, SHOTS = process.env.SHOTS;
function staffPage(doc, n) { const page = doc.addPage([PW, PH]); for (let k = 0; k < n; k++) { const y = 110 + k * 250; for (const off of [0, 62]) for (let j = 0; j < 5; j++) page.drawLine({ start: { x: 50, y: PH - (y + off + j * 7) }, end: { x: 545, y: PH - (y + off + j * 7) }, thickness: 0.7 }); [50, 300, 545].forEach(x => page.drawLine({ start: { x, y: PH - y }, end: { x, y: PH - (y + 90) }, thickness: 0.9 })); } }
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); staffPage(doc, 3); const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 800, height: 600 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 's.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 3, null); await p.waitForTimeout(800);
  const lay = v => p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const m = () => p.evaluate(() => { const R = q => document.querySelector(q).getBoundingClientRect(), pl = R('#bPlay'), st = R('#stageWrap'), sel = document.querySelector('#sysSel'), sr = sel.offsetParent ? sel.getBoundingClientRect() : null;
    return { vh: innerHeight, vw: innerWidth, stageH: Math.round(st.height), playBottom: Math.round(pl.bottom), selH: sr && Math.round(sr.height), selW: sr && Math.round(sr.width), pageH: SEL.geo ? Math.round(SEL.geo.u / SEL.geo.k) : null }; });
  await lay('system'); await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 3, null); await p.waitForTimeout(1200);
  for (const [w, h] of [[800, 600], [900, 650], [700, 700], [960, 520], [390, 780], [390, 600], [844, 390], [1300, 900]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(700); const r = await m(); const stacked = w <= 960;
    const pass = !stacked || h < 420 || r.playBottom <= h;
    ok('System ' + w + 'x' + h + (stacked ? ': the Play button is in view' : ': side layout, nothing changes'), pass, JSON.stringify(r));
    if (SHOTS) await p.screenshot({ path: SHOTS + '-sys-' + w + 'x' + h + '.png' });
  }
  await p.setViewportSize({ width: 800, height: 900 }); await p.waitForTimeout(700); const tall = await m(); ok('a tall narrow window keeps the full 640px height', tall.stageH === 640, JSON.stringify(tall));
  await lay('spread'); await p.setViewportSize({ width: 800, height: 600 }); await p.waitForTimeout(900); const sp = await m(); ok('Spread is unchanged: 420px preview', sp.stageH === 420 && sp.playBottom <= 600, JSON.stringify(sp));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
