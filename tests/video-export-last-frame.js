// An exported video's last frame is fully faded out (black), in every Page layout and both methods; the first frame is black (fade-in) and the middle is not.
// Reads the frames the exporter hands to the encoder (fast) or to the recorder (Real-time recording), from the canvas pixels.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-export-last-frame.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(180000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); const FX = process.env.S || 'tests/fixtures';
  await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.keep.length > 0);
  await p.setInputFiles('#audioIn', FX + '/loud.mp3'); await p.waitForFunction(() => S.audio && (S.audio.buffer || S.audio.disk)); await p.waitForTimeout(1000);
  await p.evaluate(() => {
    window.__seen = [];
    const mean = c => { const t = document.createElement('canvas'); t.width = 64; t.height = 36; const x = t.getContext('2d'); x.drawImage(c, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4) / 255; };
    const mk = FrameMaker.prototype.make; FrameMaker.prototype.make = function (...a) { window.__seen.push(mean(this.canvas || this.src || this.c)); return mk.apply(this, a); };
    const cs = HTMLCanvasElement.prototype.captureStream; HTMLCanvasElement.prototype.captureStream = function (...a) { const st = cs.apply(this, a), c = this, tr = st.getVideoTracks()[0]; if (tr && tr.requestFrame) { const rf = tr.requestFrame.bind(tr); tr.requestFrame = () => { window.__seen.push(mean(c)); rf(); }; } return st; };
  });
  for (const method of ['auto', 'realtime']) for (const lay of ['spread', 'single', 'system']) {
    await p.evaluate(l => { const r = document.querySelector('input[name=pageLayout][value=' + l + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); S.set.res = 720; S.set.fadesOn = true; S.set.fadeIn = true; S.set.fadeOut = true; S.set.fadeStyle = 'black'; }, lay);
    if (lay === 'system') await p.waitForFunction(() => !SYS.prog && SYS.byPage.size >= new Set(S.pdf.keep).size); await p.waitForTimeout(1200);
    const r = await p.evaluate(async m => { window.__seen = []; S.set.method = m; await startExport(); return { seen: window.__seen.slice(), n: Math.ceil(Math.max(1, duration()) * S.set.fps) }; }, method);
    const s = method === 'auto' ? r.seen.slice(-r.n) : r.seen, last = s[s.length - 1], first = s[0], mid = Math.max(...s);
    ok(method + ' ' + lay + ': the last frame is black', s.length > 5 && last < 0.02, 'last ' + (last * 100).toFixed(1) + '%, first ' + (first * 100).toFixed(1) + '%, brightest ' + (mid * 100).toFixed(1) + '% of ' + s.length + ' frames');
    ok(method + ' ' + lay + ': the first frame is black and the middle is not', first < 0.02 && mid > 0.1);
  }
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
