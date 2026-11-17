// Video, System layout: every View change (each preset to each other, and the divider's double-click) is one smooth motion. The preview, the selector's pane, its page, its strips, and the divider each move a little every frame and land where the new layout puts them, with no snap when the selector comes or goes; a change made during one carries on from where things are; the picture is drawn once, for the layout it moves into.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-view-glide.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 800 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf');
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length > 0 && duration() > 2, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => !SYS.prog && !SYS.job && SYS.byPage.size === S.pdf.keep.length, null, { timeout: 60000 }); await p.waitForTimeout(1000);
  await p.evaluate(() => {          // samples the pieces every frame: the preview, the selector's pane as it shows (its clip), its page, its strips, the divider
    window.__rows = []; window.__on = false; const q = s => document.querySelector(s), box = e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
    const f = now => {
      if (window.__on) {
        const pn = q('#sysSel'), cl = /inset\(([^)]*)\)/.exec(getComputedStyle(pn).clipPath), pv = cl ? cl[1].trim().split(/\s+/) : [], cut = parseFloat(pv.length > 1 ? pv[1] : pv[0]) || 0;
        window.__rows.push({ t: now, view: !!SPLIT.view, cv: box(q('#stage')), pane: pn.hidden ? 0 : pn.offsetWidth - cut, page: pn.hidden ? null : box(q('#selCv')), nav: pn.hidden ? null : box(q('.sys-nav')), div: q('#sysDiv').hidden ? null : box(q('#sysDiv')) });
      }
      requestAnimationFrame(f);
    }; requestAnimationFrame(f);
  });
  const ids = ['spSel', 'spEq', 'spPrev', 'spOnly'], settle = async () => { await p.waitForFunction(() => !SPLIT.view && !SPLIT.moving, null, { timeout: 30000 }); await p.waitForTimeout(150); };
  const click = id => p.evaluate(id => document.getElementById(id).click(), id);
  const take = async fn => { await p.evaluate(() => { window.__rows = []; window.__on = true; }); await fn(); await settle(); await p.waitForTimeout(100); return p.evaluate(() => { window.__on = false; return window.__rows; }); };
  // the biggest step between two frames, and how far the whole change went
  const steps = (rows, pick) => { const v = rows.map(pick).filter(x => x != null && !Number.isNaN(x)), d = v.slice(1).map((x, i) => Math.abs(x - v[i])); return { step: Math.max(0, ...d), range: Math.max(...v) - Math.min(...v), last: d.slice(-3) }; };
  const judge = (name, rows) => {
    const parts = { 'preview x': r => r.cv[0], 'preview y': r => r.cv[1], 'preview width': r => r.cv[2], 'preview height': r => r.cv[3], 'pane': r => r.pane, 'page x': r => r.page && r.page[0], 'page width': r => r.page && r.page[2], 'strip x': r => r.nav && r.nav[0], 'divider x': r => r.div && r.div[0] }, bad = [];
    for (const [k, pick] of Object.entries(parts)) { const s = steps(rows, pick); if (s.range > 8 && (s.step > s.range * 0.4 || Math.max(...s.last) > 3)) bad.push(k + ' ' + JSON.stringify(s)); }
    ok(name + ': every part moves a little each frame and lands without a snap', rows.length > 8 && !bad.length, bad.join('; ') || rows.length + ' frames');
  };
  await click('spEq'); await settle();
  for (const a of ids) for (const c of ids) {
    if (a === c) continue; await click(a); await settle();
    judge(a + ' to ' + c, await take(() => click(c)));
  }
  await click('spSel'); await settle(); judge('divider double-click', await take(() => p.evaluate(() => document.querySelector('#sysDiv').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))));
  // the picture is made once, for the layout it moves into
  await click('spSel'); await settle();
  const count = (fn) => p.evaluate(async fn => { let n = 0; const o = previewR.render.bind(previewR); previewR.render = st => { n++; return o(st); }; await new Function('return ' + fn)()(); await new Promise(r => setTimeout(r, 900)); previewR.render = o; return n; }, fn.toString());
  const idle = await count(() => () => {}), glide = await count(() => () => document.getElementById('spPrev').click());
  ok('a View change draws the preview for its new size at once, not again each frame', glide <= idle + 3, JSON.stringify({ idle, glide }));
  // a change made in the middle of another carries on from where things are
  await click('spSel'); await settle();
  const mid = await take(async () => { await click('spOnly'); await p.waitForTimeout(160); await click('spEq'); });
  judge('spSel to spOnly, then spEq half way', mid);
  // reduced motion: instant
  const rm = await b.newPage({ viewport: { width: 1300, height: 800 }, reducedMotion: 'reduce' }); await rm.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await rm.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf');
  await rm.waitForFunction(() => S.pdf && S.pdf.keep.length > 0 && duration() > 2, null, { timeout: 60000 }); await rm.waitForTimeout(600);
  await rm.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await rm.waitForFunction(() => !SYS.prog && !SYS.job && SYS.byPage.size === S.pdf.keep.length, null, { timeout: 60000 }); await rm.waitForTimeout(800);
  const r1 = await rm.evaluate(() => { document.getElementById('spOnly').click(); return { view: !!SPLIT.view, hidden: document.querySelector('#sysSel').hidden }; });
  ok('with reduced motion a View change is instant', !r1.view && r1.hidden, JSON.stringify(r1));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
