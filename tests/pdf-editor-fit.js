// PDF Editor fit sweep (1440px wide, heights 680 to 900px): every tool, with the states that put a note or a reason line in the head.
// It asserts: the dialog is inside the screen with Cancel and Done in view; the status bar ends at the tool window's bottom (Re-size has none, so its pages end there); the tool list is not cut;
// nothing in a tool's head is cut or passes the head's box; and the head keeps its height when a note or a reason line appears.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-fit.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const TOOLS = ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm'];
// the measurement, run in the page for the tool on show
const look = () => {
  const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
  const win = r('#peWin'), band = r('#peBand'), bar = document.querySelector('#peBar'), tv = document.querySelector('.pe-tv:not([hidden]):not(.sliding)'), dlg = r('#pdfDlg .dlg');
  const barOn = bar && getComputedStyle(bar).display !== 'none', end = barOn ? bar.getBoundingClientRect().bottom : r('.pe-body').bottom, bad = [];
  if (tv) tv.querySelectorAll('*').forEach(e => { if (e.closest('[hidden]') || getComputedStyle(e).visibility === 'hidden' || +getComputedStyle(e).opacity < 0.05) return; const q = e.getBoundingClientRect(); if (!q.width || !q.height) return;
    if (q.left < band.left - 0.5 || q.right > band.right + 0.5 || q.bottom > band.bottom + 0.5 || q.top < band.top - 0.5) bad.push((e.id || e.className || e.tagName) + ' passes the head by ' + [band.left - q.left, q.right - band.right, q.bottom - band.bottom].map(v => v.toFixed(1)).join('/'));
    else if (e.matches('.pe-sub, .pe-pt h3, .pe-status, .btn, .pe-st, .pe-notice span') && e.scrollWidth > e.clientWidth + 1) bad.push((e.id || e.className) + ' is cut (' + e.scrollWidth + ' > ' + e.clientWidth + ')'); });
  const rail = document.querySelector('#peRail');
  return { vh: innerHeight, dlg: { top: dlg.top, bottom: dlg.bottom }, btns: ['#peDone', '#peCancel'].map(s => r(s)).map(q => ({ top: q.top, bottom: q.bottom })), winBottom: win.bottom, end, barOn, band: band.height, tv: tv ? tv.getBoundingClientRect().height : 0,
    railCut: rail.scrollHeight - rail.clientHeight, bad, winH: win.height };
};
(async () => {
  const b = await chromium.launch(), errs = [], res = {};
  await Promise.all([680, 720, 760, 800, 900].map(async h => {
    const p = await b.newPage({ viewport: { width: 1440, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(h + ': ' + e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForTimeout(2500);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500);
    const rows = res[h] = [];
    const snap = async (tool, state) => { rows.push({ tool, state, ...(await p.evaluate(look)) }); };
    for (const t of TOOLS) {
      await p.evaluate(t => peTool(t), t); await p.waitForTimeout(900); await snap(t, 'default');
      if (['clean', 'skew', 'split', 'crop', 'wm'].includes(t)) { await p.evaluate(() => document.querySelector('#peNone').click()); await p.waitForTimeout(500); await snap(t, 'nothing ticked (a reason shows)'); await p.evaluate(() => document.querySelector('#peAll').click()); await p.waitForTimeout(400); }
      if (t === 'crop') { await p.evaluate(() => { const s = document.querySelector('#peCropSub'); s.classList.add('warn'); s.textContent = tx('pe.crop.full'); }); await p.waitForTimeout(300); await snap(t, 'the frame note'); await p.evaluate(() => { const s = document.querySelector('#peCropSub'); s.classList.remove('warn'); s.textContent = s.dataset.normal; }); }
      if (t === 'split') { await p.waitForTimeout(1500); await snap(t, 'spreads found or not'); }
    }
    await p.close();
  }));
  for (const h of [680, 720, 760, 800, 900]) {
    const rows = res[h], tag = '1440x' + h + ': ', lab = r => r.tool + ' (' + r.state + ')';
    const out = rows.filter(r => r.dlg.top < -0.5 || r.dlg.bottom > r.vh + 0.5 || r.btns.some(q => q.bottom > r.vh || q.top < 0)).map(r => lab(r) + ' dialog ' + r.dlg.top.toFixed(0) + '→' + r.dlg.bottom.toFixed(0));
    ok(tag + 'the dialog is inside the screen with Cancel and Done in view, in every tool', !out.length, out.slice(0, 3).join(' | '));
    const st = rows.filter(r => Math.abs(r.end - (r.winBottom - 1)) > 0.5).map(r => lab(r) + ' ends ' + r.end.toFixed(1) + ' window ' + r.winBottom.toFixed(1));
    ok(tag + 'the status bar ends at the tool window\'s bottom edge (Re-size: its pages), with no blank under it', !st.length, st.slice(0, 3).join(' | '));
    const rc = rows.filter(r => r.railCut > 1).map(r => lab(r) + ' by ' + r.railCut);
    ok(tag + 'the tool list is not cut', !rc.length, rc.slice(0, 3).join(' | '));
    const hd = rows.filter(r => r.bad.length).map(r => lab(r) + ': ' + r.bad.slice(0, 2).join(', '));
    ok(tag + 'nothing in a tool\'s head is cut or passes its box', !hd.length, hd.slice(0, 3).join(' | '));
    const hh = TOOLS.filter(t => { const rs = rows.filter(r => r.tool === t); return rs.some(r => Math.abs(r.band - rs[0].band) > 0.5 || Math.abs(r.tv - rs[0].tv) > 0.5); }).map(t => t + ' ' + rows.filter(r => r.tool === t).map(r => r.band + '/' + r.tv).join(' '));
    ok(tag + 'the head keeps its height when a note or a reason line appears', !hh.length, hh.join(' | '));
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
