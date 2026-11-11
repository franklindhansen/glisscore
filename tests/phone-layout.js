// Phone layout under the preview: the transport in one row, the timeline bar in two rows, no overlap and no sideways scroll at 393px, 375px, and 320px; wider screens keep the words.
// Run with the app served (PORT, default 8123):  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/phone-layout.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (w, score) => {
    const p = await b.newPage({ viewport: { width: w, height: 860 }, hasTouch: w < 600, isMobile: w < 600 }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(1000);
    if (score) { await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.keep.length > 1); await p.waitForTimeout(1500); }
    return p;
  };
  const R = (p, sel) => p.evaluate(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, shown: cs.display !== 'none' && r.width > 0 }; }, sel);
  const apart = (a, c) => a.r <= c.l + 0.5 || c.r <= a.l + 0.5 || a.b <= c.t + 0.5 || c.b <= a.t + 0.5;
  for (const score of [true, false]) for (const w of [393, 375, 320]) {
    const p = await open(w, score), tag = w + 'px' + (score ? ' with a score' : ' with none');
    ok(tag + ': no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const tr = await R(p, '#transport'), ids = ['#bStart', '#bPlay', '.transport .time', '#bTap'], rs = [];
    for (const i of ids) rs.push(await R(p, i));
    const cy = rs.map(r => (r.t + r.b) / 2);
    ok(tag + ': transport is one row, centered on one line', Math.max(...cy) - Math.min(...cy) < 1.5, cy.map(x => x.toFixed(1)).join(','));
    ok(tag + ': Add page turn at the right edge', tr.r - rs[3].r < 1.5, (tr.r - rs[3].r).toFixed(1));
    ok(tag + ': the spread label is hidden', !(await R(p, '#spreadInfo')).shown);
    ok(tag + ': the T key hint is hidden', !(await R(p, '#bTap kbd')).shown);
    const flag = w <= 360;
    ok(tag + ': Add page turn is ' + (flag ? 'the flag alone' : 'worded'), flag ? !(await R(p, '#bTap .tw')).shown && rs[3].w < 60 : (await R(p, '#bTap .tw')).shown);
    ok(tag + ': Add page turn keeps its name', await p.evaluate(() => document.querySelector('#bTap').getAttribute('aria-label') === 'Add page turn' && !!document.querySelector('#bTap').title));
    const t = {}; for (const [k, s] of Object.entries({ ttl: '.tl-bar h2', inf: '.tl-info', zm: '.tl-bar .zoom', trn: '.tl-turns', his: '.hist-wrap', bar: '.tl-bar' })) t[k] = await R(p, s);
    const keys = ['ttl', 'inf', 'zm', 'trn', 'his']; let clash = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (!apart(t[keys[i]], t[keys[j]])) clash.push(keys[i] + '/' + keys[j]);
    ok(tag + ': nothing in the timeline bar overlaps', !clash.length, clash.join(' '));
    ok(tag + ': the bar stays inside the screen', keys.every(k => t[k].l >= -0.5 && t[k].r <= w + 0.5));
    if (w > 320) {
      ok(tag + ': row 1 holds Timeline, (i), and the zoom; row 2 the turn tools and history', Math.abs(t.ttl.t - t.zm.t) < 14 && t.trn.t > t.ttl.b - 1 && Math.abs(t.trn.t - t.his.t) < 6, JSON.stringify([t.ttl.t, t.zm.t, t.trn.t, t.his.t].map(Math.round)));
      ok(tag + ': history icons at the right edge, turn tools at the left', t.bar.r - t.his.r < 20 && t.trn.l - t.bar.l < 20);
      ok(tag + ': the bar is 86px or less', t.bar.h <= 86.5, t.bar.h + '');
    } else {
      ok(tag + ': the turn tools take a full row, the icons join row 1', t.trn.t >= t.ttl.b - 1 && Math.abs(t.his.t - t.ttl.t) < 14 && t.trn.w > 250, JSON.stringify([t.ttl.t, t.his.t, t.trn.t, t.trn.w].map(Math.round)));
    }
    ok(tag + ': history shows icons, not words', await p.evaluate(() => ['#bUndo', '#bRedo', '#bHist'].every(i => { const b = document.querySelector(i); return getComputedStyle(b.querySelector('.hw')).display === 'none' && getComputedStyle(b.querySelector('.hi')).display !== 'none' && b.getAttribute('aria-label') && b.title; })));
    ok(tag + ': whole-pixel heights', await p.evaluate(() => ['#bStart', '#bPlay', '#bTap', '#bUndo', '#bSpace', '#bFit'].every(s => { const h = document.querySelector(s).getBoundingClientRect().height; return Math.abs(h - Math.round(h)) < 0.05; })));
    if (score && w === 393) {
      await p.evaluate(() => { document.querySelector('#bHist').disabled = false; }); await p.click('#bHist'); await p.waitForTimeout(500);
      const h = await R(p, '#mHist'); ok(tag + ': the History list opens upward and fits', h.shown && h.t >= 0 && h.r <= w + 0.5 && h.l >= -0.5 && h.b <= t.his.t + 2, JSON.stringify([h.t, h.l, h.r, h.b].map(Math.round)));
    }
    await p.close();
  }
  { // wider than a phone: the words stay and nothing moves
    const p = await open(700, true);
    ok('700px: Undo, Redo, and History keep their words', await p.evaluate(() => ['#bUndo', '#bRedo', '#bHist'].every(i => { const b = document.querySelector(i); return getComputedStyle(b.querySelector('.hw')).display !== 'none' && getComputedStyle(b.querySelector('.hi')).display === 'none'; })));
    ok('700px: Add page turn keeps its words', (await R(p, '#bTap .tw')).shown);
    await p.close();
  }
  { // a long time and full screen
    const p = await open(393, true);
    await p.evaluate(() => { document.querySelector('#tNow').textContent = '1:23:45.6'; document.querySelector('#tTot').textContent = '1:23:45.6'; });
    const tr = await R(p, '#transport'), tp = await R(p, '#bTap'), tm = await R(p, '.transport .time');
    ok('393px: an hour-long time still fits in one row', tr.h < 60 && tm.r <= tp.l + 1, [tr.h, tm.r, tp.l].map(Math.round).join(','));
    await p.close();
  }
  ok('no page errors', !errs.length, errs.join(' | ').slice(0, 200));
  await b.close();
})().catch(e => { console.log('FAIL crashed — ' + e.message); process.exit(1); });
