// Video editor widths: the window is swept from 300px to 1300px wide with a score and a sound open, and at each width the timeline bar, the transport, and the settings panel are looked at
// for anything that no longer fits (a control passing its box, two controls on top of each other, the bar or the play row wrapping to a second line). It also records the arrangement at each width
// (the bar's grid or one row, the transport's single row, the panel's side room), so the widths the style sheet switches at are found by measuring and can be read in the output.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-widths.js     (STEP=4 to sweep finer, SHOW=1 to print every width)
const { chromium } = require('playwright-core'), { install } = require('./lib/measure.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1', FX = process.env.S || 'tests/fixtures';
const STEP = +process.env.STEP || 8, FROM = 300, TO = 1300;
const look = fs => {
  const bad = [], badBar = [], badTr = [], live = e => !e.closest('[hidden]') && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  const name = e => e.id || (typeof e.className === 'string' && e.className.split(' ')[0]) || e.tagName;
  const tl = document.querySelector('.timeline'), bar = document.querySelector('.tl-bar'), tr = document.querySelector('#transport'), panel = document.querySelector('.panel');
  const rows = el => new Set([...el.children].filter(live).map(c => Math.round(c.getBoundingClientRect().top / 4))).size;
  const inside = (root, box, to) => root.querySelectorAll('.btn, .icon-btn, .seg, .zoom, .time, .info, h2').forEach(e => { if (!live(e)) return; const q = e.getBoundingClientRect(), r = box.getBoundingClientRect(); if (q.right > r.right + 0.5 || q.left < r.left - 0.5) to.push(name(e) + ' passes the ' + name(box)); });
  inside(bar, tl, badBar); inside(tr, tr.parentElement, badTr);
  for (const [root, to] of [[bar, badBar], [tr, badTr]]) {
    const boxes = [...root.querySelectorAll('.btn, .icon-btn, .seg, .zoom, .time, h2, .btn-group')].filter(live);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]; if (a.contains(b) || b.contains(a)) continue;
      const p = a.getBoundingClientRect(), r = b.getBoundingClientRect(), w = Math.min(p.right, r.right) - Math.max(p.left, r.left), h = Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top);
      if (w > 1 && h > 1) to.push(name(a) + ' covers ' + name(b));
    }
  }
  if (getComputedStyle(bar).display === 'flex' && bar.getBoundingClientRect().height > 38.5) badBar.push('the bar wraps (' + Math.round(bar.getBoundingClientRect().height) + 'px)');
  { const c = getComputedStyle(tr), h = tr.getBoundingClientRect().height - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom) - parseFloat(c.borderTopWidth) - parseFloat(c.borderBottomWidth); if (h > 40) badTr.push('the transport wraps (' + Math.round(h) + 'px)'); }
  if (fs !== 'fs') { if (bar.scrollWidth > bar.clientWidth + 1) badBar.push('the bar scrolls sideways'); if (tr.scrollWidth > tr.clientWidth + 1) badTr.push('the transport scrolls sideways'); }
  // the bar's rows are balanced: the title's letters and the (i) share a middle with the buttons in their row, and the bar's room above its first row equals its room under its last
  { const R = e => e.getBoundingClientRect(), kids = [...bar.children].filter(live).map(e => e.matches('.tl-info') ? e.querySelector('.info-i') : e).filter(e => e && live(e)), L = window.__mk.letters(bar.querySelector('h2')), mid = e => (R(e).top + R(e).bottom) / 2;
    if (L && !(bar.querySelector('.hint.warn') && getComputedStyle(bar.querySelector('.hint.warn')).display !== 'none')) {
      const tm = (L.capTop + L.base) / 2, row = kids.filter(e => !e.matches('h2') && R(e).top < L.base && R(e).bottom > L.capTop);
      for (const e of row) if (Math.abs(mid(e) - tm) > 0.5) badBar.push(name(e) + ' is ' + (mid(e) - tm).toFixed(1) + 'px off the title\'s middle');
      const cb = getComputedStyle(bar), br = R(bar), first = Math.min(...kids.map(e => R(e).top)), last = Math.max(...kids.map(e => R(e).bottom));
      if (Math.abs((first - br.top) - (br.bottom - last)) > 0.5) badBar.push('the bar has ' + (first - br.top).toFixed(1) + 'px above its rows and ' + (br.bottom - last).toFixed(1) + 'px under');
    }
  }
  const cs = e => getComputedStyle(e);
  bad.push(...badBar, ...badTr);
  return {
    sw: innerWidth, tlw: Math.round(tl.clientWidth), trw: Math.round(tr.clientWidth), pw: Math.round(panel.clientWidth),
    bar: cs(bar).display + ':' + rows(bar) + 'r:' + Math.round(bar.getBoundingClientRect().height), barPad: cs(bar).paddingLeft + '/' + cs(bar).columnGap,
    tr: rows(tr) + 'r:' + cs(tr).flexWrap + ':' + Math.round(tr.getBoundingClientRect().height), trTime: cs(document.querySelector('#transport .time')).marginLeft,
    panelPad: cs(panel).paddingLeft, hi: cs(document.querySelector('.tl-bar .hist-wrap .hi')).display, bad: [...new Set(bad)], badBar: [...new Set(badBar)], badTr: [...new Set(badTr)]
  };
};
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: TO, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 0); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  const sweep = async mode => {
  await p.evaluate(install); const out = []; let last = '';
  for (let w = TO; w >= FROM; w -= STEP) {
    await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(160);
    const r = await p.evaluate(look, mode), key = [r.bar, r.barPad, r.tr, r.trTime, r.panelPad, r.hi].join(' | ');
    out.push({ w, r }); if (process.env.SHOW || key !== last) console.log('PASS ' + mode + ' ' + w + 'px: ' + key + ' | timeline ' + r.tlw + ' | transport ' + r.trw + ' | panel ' + r.pw + (r.bad.length ? ' | ' + r.bad.join(', ') : '')); last = key;
  }
  // where does each arrangement stop fitting? the coarse sweep finds the step, then it is refined to the pixel
  const edge = async kind => {
    for (let i = 1; i < out.length; i++) if (!out[i - 1].r[kind].length && out[i].r[kind].length) {
      let lo = out[i - 1].w, r = out[i - 1].r;
      for (let w = out[i - 1].w - 1; w > out[i].w; w--) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(120); const q = await p.evaluate(look, mode); if (q[kind].length) break; lo = w; r = q; }
      return { lo, r };
    }
    return null;
  };
  for (const [kind, label, key] of [['badBar', 'the timeline bar', 'tlw'], ['badTr', 'the transport', 'trw']]) { const e = await edge(kind); console.log('PASS ' + mode + ': ' + label + ' keeps its arrangement down to a ' + (e ? e.r[key] + 'px-wide box (the window at ' + e.lo + 'px)' : 'width below ' + FROM + 'px')); }
  const bad = out.filter(o => o.r.bad.length);
  ok(mode + ': nothing in the timeline bar or the transport passes its box, covers another, or wraps, at any width from ' + FROM + 'px to ' + TO + 'px', !bad.length, bad.slice(0, 6).map(o => o.w + 'px: ' + o.r.bad.join(', ')).join(' || '));
  };
  await sweep('page');
  await p.setViewportSize({ width: TO, height: 900 }); await p.evaluate(() => document.querySelector('#btnFull').click()); await p.waitForTimeout(1200);
  await sweep('fs');
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})();
