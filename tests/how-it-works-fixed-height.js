// How it works keeps one frame: opening or closing a dropdown (.how-d) does not change the window's height or top, at three screen sizes. The text scrolls inside.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/how-it-works-fixed-height.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(800);
  for (const [w, h] of [[1280, 900], [1280, 720], [390, 800]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300);
    const r = await p.evaluate(async () => {
      const o = document.querySelector('#howDlg'); o.hidden = false; o.style.animation = 'none'; const d = o.querySelector('.dlg'); d.style.animation = 'none'; await new Promise(r => setTimeout(r, 400));
      const box = () => { const r = d.getBoundingClientRect(); return { h: Math.round(r.height * 10) / 10, top: Math.round(r.top * 10) / 10 }; }, ds = [...d.querySelectorAll('.how-d')], before = box();
      ds.forEach(x => { x.open = true; }); await new Promise(r => setTimeout(r, 600)); const open = box(); ds.forEach(x => { x.open = false; }); await new Promise(r => setTimeout(r, 600)); const closed = box();
      const cr = d.querySelector('.row .btn').getBoundingClientRect(); o.hidden = true; return { n: ds.length, before, open, closed, closeIn: cr.bottom <= innerHeight && cr.top >= 0, vh: innerHeight };
    });
    ok(w + 'x' + h + ': opening every dropdown leaves the window the same height and place, and closing puts it back', r.n > 0 && r.before.h === r.open.h && r.before.top === r.open.top && r.closed.h === r.before.h, JSON.stringify(r));
    ok(w + 'x' + h + ': Close stays in view and the window fits the screen', r.closeIn && r.before.h <= r.vh - 32 + 0.5, JSON.stringify(r));
  }
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
