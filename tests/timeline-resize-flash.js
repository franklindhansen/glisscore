// Resizing the window never leaves the timeline blank for a frame: the canvas is cleared when it changes size, so it is painted again in the same frame, before the browser shows it.
// A resize observer made after the app's own sees the canvas at the moment just before it is shown; a blank canvas there is a flash.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-resize-flash.js
const { chromium } = require('playwright-core'); const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  const doc = await PDFDocument.create(); for (let i = 0; i < 40; i++) doc.addPage([420, 560]); const bytes = Buffer.from(await doc.save());
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'p.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(1200);
  await p.evaluate(() => {
    window.__seen = 0; window.__blank = 0;
    new ResizeObserver(() => {          // made after the app's own, so it runs after them in the same frame
      const c = TL.canvas, d = TL.ctx.getImageData(0, 0, c.width, c.height).data; let any = false;
      for (let i = 3; i < d.length; i += 4 * 37) if (d[i]) { any = true; break; }
      window.__seen++; if (!any) window.__blank++;
    }).observe(TL.scroller);
  });
  const widths = [1300, 1180, 1060, 940, 820, 700, 600, 520, 440, 390, 520, 700, 900, 1100, 1300];
  for (const w of widths) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(250); }
  const r = await p.evaluate(() => ({ seen: window.__seen, blank: window.__blank }));
  ok('the timeline was checked at each size change', r.seen >= widths.length - 2, 'looked ' + r.seen + ' times');
  ok('the timeline is never blank right after a resize', r.blank === 0, r.blank + ' blank');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
