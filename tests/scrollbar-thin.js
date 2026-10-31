// Every scrolling area (How it works, the lists, the panel, the diagnostics log) has the same thin scrollbar, not the browser's thick default.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/scrollbar-thin.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }), p = await b.newPage({ viewport: { width: 1280, height: 600 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => {
    const thick = [...document.querySelectorAll('*')].filter(e => { const c = getComputedStyle(e); return /auto|scroll/.test(c.overflowX + c.overflowY) && c.scrollbarWidth !== 'thin'; }).map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && e.className.baseVal === undefined ? '.' + String(e.className).trim().split(/\s+/).join('.') : ''));
    const o = document.querySelector('#howDlg'); o.hidden = false; o.style.animation = 'none'; o.querySelector('.dlg').style.animation = 'none'; await new Promise(r => setTimeout(r, 400));
    const hb = o.querySelector('.how-body'), bar = hb.offsetWidth - hb.clientWidth - 6 * 0; const scrolls = hb.scrollHeight > hb.clientHeight, hc = getComputedStyle(hb); o.hidden = true;
    const scrolling = [...document.querySelectorAll('*')].filter(e => { const c = getComputedStyle(e); return /auto|scroll/.test(c.overflowX + c.overflowY); });
    return { thick, bar, scrolls, how: { w: hc.scrollbarWidth, c: hc.scrollbarColor }, colors: [...new Set(scrolling.map(e => getComputedStyle(e).scrollbarColor))], n: scrolling.length };
  });
  ok('every scrolling area asks for the thin scrollbar (' + r.n + ' checked)', r.n > 5 && r.thick.length === 0, JSON.stringify(r.thick));
  ok('How it works scrolls here, and it asks for the thin bar', r.scrolls && r.how.w === 'thin', JSON.stringify(r.how));
  ok('every scrolling area has the same bar color, so none is set apart', r.colors.length === 1 && r.colors[0] !== 'auto', JSON.stringify(r.colors));
  // the drawn width can only be measured where the browser draws a bar that takes room; with overlay bars (the macOS default) it is 0 and the checks above are what hold
  ok('where a bar takes room it is the thin one (about 11px or less, not the 15px default)', r.bar === 0 || r.bar <= 12, r.bar === 0 ? 'overlay bars here, width not measured' : r.bar + 'px');
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
