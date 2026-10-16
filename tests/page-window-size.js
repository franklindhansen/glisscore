// About, How it works, Import/Export and Diagnostics share one size: 600px (Diagnostics 720px, How it works and Keyboard shortcuts 900px) wide (92vw on a phone), at least 380px tall, none scrolling at 1280x720 except How it works, which scrolls inside its window with Close in view. The editors and the warning window keep their widths.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/page-window-size.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const WINS = { About: '#aboutDlg', 'How it works': '#howDlg', 'Import/Export': '#ioDlg', Diagnostics: '#diagDlg' };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(800);
  const read = sel => p.evaluate(sel => {
    const o = document.querySelector(sel); o.hidden = false; o.style.animation = 'none'; const d = o.querySelector('.dlg'); d.style.animation = 'none';
    const r = d.getBoundingClientRect(), body = d.querySelector('.how-body'), close = d.querySelector('.row .btn.primary, .row .btn:last-child'), cr = close.getBoundingClientRect();
    const res = { w: r.width, h: r.height, top: r.top, bottom: r.bottom, vh: innerHeight, ovScroll: o.scrollHeight - o.clientHeight, dlgScroll: d.scrollHeight - d.clientHeight, bodyScroll: body ? body.scrollHeight - body.clientHeight : 0, closeIn: cr.top >= 0 && cr.bottom <= innerHeight, bodyOver: body ? getComputedStyle(body).overflowY : '' };
    o.hidden = true; return res;
  }, sel);
  for (const [name, sel] of Object.entries(WINS)) {
    const d = await read(sel);
    ok(name + ' (1280x720): at its width (600px; Diagnostics 720px, How it works 900px), at least 380px tall', Math.abs(d.w - ({ 'How it works': 900, Diagnostics: 720 }[name] || 600)) < 0.6 && d.h >= 379.5, d.w + 'x' + d.h);
    if (name === 'How it works') {
      ok('How it works scrolls inside its window, Close in view, window within the screen minus 32px', d.bodyScroll > 0 && d.closeIn && d.h <= d.vh - 32 + 0.5 && d.ovScroll <= 0 && d.dlgScroll <= 0, JSON.stringify(d));
    } else ok(name + ' (1280x720): no scroll, centered when short', d.ovScroll <= 0 && d.dlgScroll <= 0 && Math.abs(d.top - (d.vh - d.bottom)) < 1.5, JSON.stringify(d));
  }
  const dg = await read('#diagDlg'); const ta = await p.evaluate(() => { const o = document.querySelector('#diagDlg'); o.hidden = false; const t = o.querySelector('#diagLog'); t.value = Array.from({ length: 200 }, (_, i) => 'log line ' + i).join('\n'); const h = t.getBoundingClientRect().height, scrolls = t.scrollHeight > t.clientHeight; o.hidden = true; return { h, scrolls }; });
  ok('Diagnostics log box has a fixed height and scrolls inside itself', ta.scrolls && ta.h > 100 && dg.ovScroll <= 0, JSON.stringify(ta));
  const ks = await p.evaluate(() => { const o = document.querySelector('#keysDlg'); o.hidden = false; const d = o.querySelector('.dlg').getBoundingClientRect(), l = o.querySelector('.keys'), lr = l.getBoundingClientRect(), dts = [...o.querySelectorAll('dt')].map(e => Math.round(e.getBoundingClientRect().left)); const r = { cols: new Set(dts).size, w: d.width, h: d.height, fits: lr.right <= d.right + 0.5 && l.scrollWidth <= l.clientWidth + 1, ov: o.scrollHeight - o.clientHeight }; o.hidden = true; return r; });
  ok('Keyboard shortcuts: wider (900px), two columns, list inside the window, no scroll', ks.cols === 2 && Math.abs(ks.w - 900) < 0.6 && ks.fits && ks.ov <= 0 && ks.h >= 379.5, JSON.stringify(ks));
  // phone
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
  for (const [name, sel] of Object.entries(WINS)) {
    const d = await read(sel);
    ok(name + ' (390 wide): is 92vw wide, inside the gutter, and is at least 380px tall', Math.abs(d.w - 390 * 0.92) < 1 && d.h >= 379.5, d.w + 'x' + d.h);
  }
  const tall = await p.evaluate(() => { const o = document.querySelector('#ioDlg'); o.hidden = false; const hs = [...o.querySelectorAll('.row .btn')].map(e => e.getBoundingClientRect().height); o.hidden = true; return hs; });
  ok('Import/Export buttons keep their normal height', tall.every(h => h < 44), tall.join(','));
  const ph = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  ok('Phone: no sideways scroll', ph);
  // unchanged sizes
  await p.setViewportSize({ width: 1280, height: 900 }); await p.waitForTimeout(300);
  const w = await p.evaluate(() => { const g = s => { const o = document.querySelector(s); o.hidden = false; const v = Math.round(o.querySelector('.dlg').getBoundingClientRect().width); o.hidden = true; return v; }; return { warn: g('#warnDlg'), ae: g('#audioDlg'), pe: g('#pdfDlg') }; });
  ok('Warning (480), Audio Editor (1000) and PDF Editor (1040) keep their widths', w.warn === 480 && w.ae === 1000 && w.pe === 1040, JSON.stringify(w));
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
