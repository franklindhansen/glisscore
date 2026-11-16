// PDF Editor widths: the window is swept from 300px to 1000px wide, and at each width every tool is looked at for anything that no longer fits:
// a word cut off, a control passing the window's edge, two controls on top of each other, or the bar's count, field, and pills not on one row.
// It also records the arrangement at each width (the tool list beside the window or as a drop-down, Re-size's cards beside each other or stacked, how many sizes sit on a row, Watermark's cards side by side or stacked), so the widths the style sheet switches at can be set from where an arrangement stops fitting.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-widths.js     (STEP=4 to sweep finer, SHOW=1 to print every width)
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html', FX = process.env.S || 'tests/fixtures';
const TOOLS = ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm'], STEP = +process.env.STEP || 8, FROM = 300, TO = 1000;
// what does not fit in the tool on show, and how the window is arranged
const look = () => {
  const win = document.querySelector('#peWin').getBoundingClientRect(), bad = [];
  const live = e => !e.closest('[hidden]') && !e.closest('.sliding') && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05 && e.getBoundingClientRect().width > 0;
  const roots = [document.querySelector('.pe-tv:not([hidden]):not(.sliding)'), document.querySelector('#peBar'), document.querySelector('.pe-rail-bar')].filter(r => r && getComputedStyle(r).display !== 'none');
  const name = e => e.id || (typeof e.className === 'string' && e.className.split(' ')[0]) || e.tagName;
  if (!roots.length) bad.push('nothing on show to measure');
  for (const root of roots) {
    root.querySelectorAll('*').forEach(e => {
      if (!live(e)) return; const q = e.getBoundingClientRect();
      if (q.right > win.right + 0.5 || q.left < win.left - 0.5) bad.push(name(e) + ' passes the window');
      if (e.matches('.btn, .seg label, .rz-opt, .pe-sub, .pe-status, .t-lbl, .check-row span, .pe-inl span') && e.scrollWidth > e.clientWidth + 1) bad.push(name(e) + ' is cut');
      const cd = e.closest('.ae-card'); if (cd && cd !== e && e.matches('.btn, .seg, .rz-grid, .rz-opt') && q.right > cd.getBoundingClientRect().right - parseFloat(getComputedStyle(cd).paddingRight) + 0.5) bad.push(name(e) + ' passes its card');          // new: a control reaching past its card's padding (before, Re-size's four sizes ran into Page shape for 50px before anything else noticed)
    });
    // two controls on top of each other
    const boxes = window.__dbg = [...root.querySelectorAll('.btn, .seg, .pe-inl, .pe-sw, input[type=text], .pe-count, .pe-pages, .btn-group, .pe-g')].filter(live);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]; if (a.contains(b) || b.contains(a)) continue;
      const p = a.getBoundingClientRect(), r = b.getBoundingClientRect(), w = Math.min(p.right, r.right) - Math.max(p.left, r.left), h = Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top);
      if (w > 1 && h > 1) bad.push(name(a) + ' covers ' + name(b));
    }
  }
  const bar = document.querySelector('#peBar'), barOn = bar && getComputedStyle(bar).display !== 'none';
  if (barOn) { const c = document.querySelector('#peCount').getBoundingClientRect(), g = document.querySelector('#peSelGrp').getBoundingClientRect(); if (bar.offsetHeight > 56) bad.push('the bar wraps (' + bar.offsetHeight + 'px)'); if (g.right > bar.getBoundingClientRect().right + 0.5) bad.push('the pills pass the bar'); if (c.height > 24) bad.push('the count wraps'); }
  const col = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).gridTemplateColumns.split(' ').length : 0; };
  const rz = [...document.querySelectorAll('.pe-rz .rz-opt')].map(e => Math.round(e.getBoundingClientRect().top)), shape = document.querySelector('.pe-card-shape'), sizes = document.querySelector('.pe-card-sizes');
  return {
    cw: innerWidth, ct: (() => { const d = document.querySelector('#pdfDlg'), c = getComputedStyle(d); return Math.round(d.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight)); })(), dlg: Math.round(document.querySelector('#pdfDlg .dlg').getBoundingClientRect().width),
    rail: getComputedStyle(document.querySelector('#peRailCur')).display === 'none' ? 'beside' : 'drop-down',
    rzPerRow: rz.length ? rz.filter(t => t === rz[0]).length : 0, rzBeside: !!(shape && sizes && shape.getBoundingClientRect().top < sizes.getBoundingClientRect().bottom - 1),
    wmCols: col('#peViewWm .pe-cards'), rzw: (e => { const c = getComputedStyle(e); return Math.round(e.clientWidth - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight)); })(document.querySelector('.pe-rzcards') || document.body),          // the width a container query sees: the box's own content, the padding left out (old: the whole width, 32px more, so each Re-size switch sat 32px higher than the rule's 1 to 24px)
    o4: (document.querySelector('.rz-opt:nth-child(4)') || document.body).getBoundingClientRect().right | 0, sh: shape ? shape.getBoundingClientRect().left | 0 : 0, bad: [...new Set(bad)]
  };
};
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1000, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(900);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(700);
  const rows = {};
  for (let w = TO; w >= FROM; w -= STEP) {
    await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(160);
    for (const t of TOOLS) {
      await p.evaluate(n => peTool(n), t); await p.waitForFunction(n => (e => e && getComputedStyle(e).opacity === '1')(document.querySelector('.pe-tv[data-tool=' + n + ']:not([hidden]):not(.sliding)')), t); await p.waitForTimeout(60);
      const r = await p.evaluate(look); (rows[t] = rows[t] || []).push({ w, ...r });
    }
  }
  // where each arrangement stops fitting: each switch in the style sheet is turned off in turn, and the window is swept down until something no longer fits
  const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'style.css'), 'utf8');
  // each switch: the style sheet's query, the tools it affects, and what it does. Turned off in turn, the window is swept down from just above it until something no longer fits;
  // the switch must sit above that width (so the arrangement has already changed when it would fail) and no more than 24px above it (so the room is not wasted)
  const VARIANTS = [
    ['the tool list becomes a drop-down', '@container pedlg (max-width:', TOOLS],
    ['Watermark\'s cards stack', '@container pedlg (max-width:', ['wm'], 1],
    ['the bar tightens', '@container pedlg (max-width:', ['pages', 'clean', 'skew', 'crop', 'split', 'wm'], 2],
    ['Re-size goes from four sizes to two a row', '@container rzcards (max-width:', ['resize'], 0],
    ['Re-size tightens its sizes (numbers smaller, less padding)', '@container rzcards (max-width:', ['resize'], 1],
    ['Re-size puts the numbers under the names', '@container rzcards (max-width:', ['resize'], 2]
  ];
  const qs = {}; // the n-th query of each kind, read from the sheet
  for (const [label, head, tools, nth] of VARIANTS) {
    const all = [...css.matchAll(new RegExp(head.replace(/[()]/g, '\\$&') + '(\\d+)px\\)', 'g'))].map(m => +m[1]);
    const mine = head.includes('rzcards') ? all : all.filter(n => [744, 728, 560, 512, 288].includes(n)).sort((a, b) => b - a);
    const list = head.includes('rzcards') ? all.sort((a, b) => b - a) : (key => key)(mine.filter(n => n !== 728));
    const bp = list[nth || 0]; if (!bp) { ok('measured: ' + label, false, 'its switch is not in the style sheet'); continue; }
    const q = await b.newPage({ viewport: { width: 1000, height: 900 } }); q.setDefaultTimeout(60000);
    const body = css.split(head + bp + 'px)').join(head + '1px)');
    await q.route('**/style.css*', r => r.fulfill({ status: 200, contentType: 'text/css', body }));
    await q.goto(URL); await q.setInputFiles('#pdfIn', FX + '/score.pdf'); await q.waitForFunction(() => S.pdf); await q.waitForTimeout(900);
    await q.evaluate(() => openPdfEditor()); await q.waitForTimeout(700);
    let first = null; const own = head.includes('rzcards'), start = own ? TO : Math.min(TO, bp + 32 + 56);
    await q.setViewportSize({ width: start, height: 900 }); await q.waitForTimeout(700);          // settle at the first width, so the count's short text is in place
    for (let w = start; w >= FROM && !first; w -= STEP) {
      await q.setViewportSize({ width: w, height: 900 }); await q.waitForTimeout(160);
      for (const t of tools) {
        await q.evaluate(n => peTool(n), t); await q.waitForFunction(n => (e => e && getComputedStyle(e).opacity === '1')(document.querySelector('.pe-tv[data-tool=' + n + ']:not([hidden]):not(.sliding)')), t); await q.waitForTimeout(60);
        let r = await q.evaluate(look); if (r.bad.length) { await q.waitForTimeout(500); r = await q.evaluate(look); } if (r.bad.length) { first = { t, ...r }; break; }
      }
    }
    const lim = first ? (own ? first.rzw : first.ct) : 0, why = first ? first.t + ': ' + first.bad.slice(0, 2).join('; ') : 'fits down to ' + FROM + 'px';
    ok('measured: ' + label + ' (switch at ' + bp + 'px; with it off, it stops fitting at ' + (first ? lim + 'px' : 'nothing') + ')', first ? bp > lim && bp - lim <= 24 : bp <= 24 + (FROM - 32), why);
    await q.close();
  }
  // the widest width from which a tool stays without faults all the way down, and what changes along the way
  for (const t of TOOLS) {
    const rs = rows[t], firstBad = rs.find(r => r.bad.length);
    ok(t + ': nothing is cut or covered from ' + TO + 'px down to ' + FROM + 'px', !firstBad, firstBad ? 'first fault at ' + firstBad.w + 'px: ' + firstBad.bad.slice(0, 4).join('; ') : '');
  }
  const hold = (key, f) => { let was = null; const out = []; for (const r of rows.resize.concat([])) { const v = f(r); if (v !== was) { out.push(r.w + 'px: ' + v); was = v; } } ok('arrangement: ' + key, true, out.join(' | ')); };
  hold('tool list', r => r.rail); hold('Re-size sizes per row', r => r.rzPerRow); hold('Re-size Page shape beside the sizes', r => r.rzBeside); for (const r of rows.wm.slice(0, 1)) void r;
  { let was = null; const out = []; for (const r of rows.wm) if (r.wmCols !== was) { out.push(r.w + 'px: ' + r.wmCols + ' column(s)'); was = r.wmCols; } ok('arrangement: Watermark cards', true, out.join(' | ')); }
  if (process.env.SHOW) for (const t of TOOLS) for (const r of rows[t]) ok(t + ' ' + r.w + ' (dialog ' + r.dlg + ')', !r.bad.length, r.rail + ' cards ' + r.rzw + ' o4 ' + r.o4 + ' shape ' + r.sh + ' ' + r.bad.join('; '));
  // the subtitles give way at the Audio Editor's narrow width (the dialog 488px and under), and show above it; Crop's Margin sits beside Auto | Manual with the normal gap, Keep frame at the right edge
  { const sub = () => p.evaluate(() => { const v = e => !!e && getComputedStyle(e).display !== 'none'; peTool('crop'); const g = document.querySelector('#pdfDlg .pe-cmode').getBoundingClientRect(), m = document.querySelector('#peCropPadF').getBoundingClientRect(), k = document.querySelector('#peCropSameF').getBoundingClientRect(), r = document.querySelector('#peViewCrop .pe-row').getBoundingClientRect();
      return { lead: v(document.querySelector('#peLead')), sub: v(document.querySelector('#peViewCrop .pe-sub')), gap: Math.round(m.left - g.right), keepRight: Math.round(r.right - k.right), ct: Math.round(document.querySelector('#pdfDlg .dlg').getBoundingClientRect().width) }; });
    await p.setViewportSize({ width: 1000, height: 900 }); await p.waitForTimeout(400); const wide = await sub();
    await p.setViewportSize({ width: 440, height: 900 }); await p.waitForTimeout(400); const narrow = await sub();
    ok('wide: the window subtitle and the tool line show', wide.lead && wide.sub, JSON.stringify(wide));
    ok('narrow: both subtitles are hidden, as in the Audio Editor', !narrow.lead && !narrow.sub, JSON.stringify(narrow));
    ok('Crop: Margin sits within 40px of Auto | Manual (the normal gap), and Keep frame is at the right edge', wide.gap > 0 && wide.gap <= 40 && wide.keepRight <= 24, JSON.stringify(wide)); }
  ok('no page errors', !errs.length, errs.join(' | ').slice(0, 200));
  await b.close();
})();
