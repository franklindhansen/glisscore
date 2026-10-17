// Makes a long, dense scanned score for the memory checks: every page is its own 300 dpi grayscale JPEG (about 2550 x 3300) with paper grain, a shadow, a slight tilt, staves, notes and dust.
// Used by pdf-editor-large-scan.js; run alone to make the file:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/make-large-scan.js [pages] [out.pdf]
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
async function makeLargeScan(pages = 220, out = path.join(os.tmpdir(), 'kf-large-scan-' + pages + '.pdf')) {
  if (fs.existsSync(out)) return out;
  const b = await chromium.launch(), p = await b.newPage(), doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const b64 = await p.evaluate(seed => {
      let s = seed * 7919 + 1; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
      const W = 2550, H = 3300, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d', { alpha: false });
      const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgb(190,186,176)'); g.addColorStop(0.15, 'rgb(232,228,214)'); g.addColorStop(1, 'rgb(236,232,220)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.save(); x.translate(W / 2, H / 2); x.rotate((rnd() - 0.5) * 0.03); x.translate(-W / 2, -H / 2);
      x.fillStyle = '#1c1c1c'; for (let sys = 0; sys < 9; sys++) { const y0 = 330 + sys * 330; for (let k = 0; k < 5; k++) x.fillRect(220, y0 + k * 18, W - 440, 3);
        for (let n = 0; n < 40; n++) { const nx = 260 + n * 52 + rnd() * 20, ny = y0 + Math.floor(rnd() * 9) * 9; x.beginPath(); x.ellipse(nx, ny, 14, 10, -0.3, 0, 7); x.fill(); x.fillRect(nx + 11, ny - 60, 3, 60); } }
      x.restore();
      for (let n = 0; n < 4000; n++) { const v = 90 + rnd() * 120; x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')'; x.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3); }          // grain and dust
      const gray = document.createElement('canvas'); gray.width = W; gray.height = H; const gx = gray.getContext('2d', { alpha: false }); gx.filter = 'grayscale(1)'; gx.drawImage(cv, 0, 0);
      return gray.toDataURL('image/jpeg', 0.55).split(',')[1];
    }, i);
    const img = await doc.embedJpg(Buffer.from(b64, 'base64')), pg = doc.addPage([612, 792]); pg.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  }
  await b.close(); fs.writeFileSync(out, await doc.save()); return out;
}
module.exports = { makeLargeScan };
if (require.main === module) makeLargeScan(+process.argv[2] || 220, process.argv[3]).then(f => console.log(f, (fs.statSync(f).size / 1e6).toFixed(0) + ' MB'));
