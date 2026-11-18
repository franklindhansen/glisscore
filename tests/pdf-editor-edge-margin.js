// PDF Editor: the page grid keeps the same space left and right at every size and window width (the room kept for the scroll bar counts as part of the right margin).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-edge-margin.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 1);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500);
  await p.evaluate(() => { const d = PE.d, n = S.pdf.n; for (let i = 0; i < 36; i++) d.slots.push({ src: i % n, rot: 0, x: false, c: true, crop: null, dim: null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' }); d.order = d.slots.map((_, i) => i); peRender(false); }); await p.waitForTimeout(1500);
  const set = v => p.evaluate(v => { const z = document.querySelector('#pdfDlg .pe-zoom-in'); z.value = v; z.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  for (const w of [1280, 1000]) {
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(700);
    for (const v of [-50, 0, 50]) { await set(v); await p.waitForTimeout(1300);
      const g = await p.evaluate(() => { const wr = document.querySelector('#peWrap').getBoundingClientRect(), cs = Array.from(document.querySelectorAll('#peGrid .page-card')).map(c => c.getBoundingClientRect()), top = cs[0].top, row = cs.filter(q => Math.abs(q.top - top) < 2), w = document.querySelector('#peWrap'); return { left: row[0].left - wr.left, right: wr.right - row[row.length - 1].right, bar: w.scrollHeight > w.clientHeight, gutter: w.offsetWidth - w.clientWidth }; });
      ok('window ' + w + ', size ' + v + ': the left margin is 20px, and the right is 20px too (the scroll bar sits in the right margin, never beside empty space)', Math.abs(g.left - 20) <= 0.6 && Math.abs(g.right - g.left) <= 0.6, JSON.stringify(g));
    }
  }
  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
