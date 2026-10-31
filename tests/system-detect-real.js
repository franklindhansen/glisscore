// Systems on real scores: with SCORES_DIR set to a folder of PDFs, finds the systems on the first pages of each, prints what it found, and (with OUT set) saves a picture of each page with its systems outlined.
// Without SCORES_DIR it only says it was skipped. Nothing here names any score.
// Run with the app served on port 8123:  SCORES_DIR=/path/to/pdfs OUT=/path/to/pictures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/system-detect-real.js
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const dir = process.env.SCORES_DIR; if (!dir) { ok('skipped: SCORES_DIR is not set', true); return; }
  const files = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f)).sort(), out = process.env.OUT;
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  for (const f of files) {
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', path.join(dir, f));
    await p.waitForFunction(() => S.pdf && S.pdf.keep.length, null, { timeout: 120000 }); await p.waitForTimeout(500);
    const n = await p.evaluate(() => S.pdf.keep.length), pages = [...Array(Math.min(n, 6)).keys()];
    const res = await p.evaluate(async pages => { const o = []; for (const i of pages) { const t = performance.now(), r = await sysDetectPage(i); o.push({ i, ms: Math.round(performance.now() - t), n: r.systems.length, staves: r.staves, tilt: r.tilt }); } return o; }, pages);
    ok(f.slice(0, 2) + ' (' + n + ' pages)', res.every(r => r.ms < 8000), res.map(r => 'p' + (r.i + 1) + ' ' + r.n + 's/' + r.staves + 'st/' + r.tilt + 'deg/' + r.ms + 'ms').join('  '));
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      for (const i of pages.slice(1, 4)) {
        const url = await p.evaluate(async i => {
          const r = SYS.byPage.get(i), pg = await S.pdf.doc.getPage(i + 1), v = pg.getViewport({ scale: 1 }), w = 700, h = Math.round(w * v.height / v.width), cv = await renderPdfPage(S.pdf.doc, i, w, h, 0, null, null), c = cv.getContext('2d');
          c.lineWidth = 2; r.systems.forEach((s, k) => { c.strokeStyle = k % 2 ? '#d22' : '#27c'; c.strokeRect(s.left * w, s.top * h, (s.right - s.left) * w, (s.bottom - s.top) * h); });
          return cv.toDataURL('image/png');
        }, i);
        fs.writeFileSync(path.join(out, f.slice(0, 2) + '-p' + (i + 1) + '.png'), Buffer.from(url.split(',')[1], 'base64'));
      }
    }
  }
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
