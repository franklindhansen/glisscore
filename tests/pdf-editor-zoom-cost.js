// PDF Editor: the page-size slider sets the grid's own columns (not a variable the cards inherit), once a frame, redraws no page while it moves,
// lets cards far from the view skip layout and paint without changing the scroll length, and keeps the card nearest the middle in place.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-zoom-cost.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
  const frame = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const set = v => p.evaluate(v => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'); zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  const rest = () => p.waitForTimeout(500);
  // the original guarantees: the slider widens the cards and sets the grid's own columns
  await set(-40); await rest(); const a = await p.evaluate(() => $('#peGrid').querySelector('.page-card').getBoundingClientRect().width);
  await set(40); await rest(); const r = await p.evaluate(() => { const g = $('#peGrid'); return { c: g.querySelector('.page-card').getBoundingClientRect().width, cols: g.style.gridTemplateColumns, v: g.style.getPropertyValue('--pe-th') }; });
  ok('the slider widens the cards', r.c > a * 1.5, JSON.stringify({ a, c: r.c }));
  ok('it sets the grid\'s columns and no inherited variable', /minmax/.test(r.cols) && r.v === '', JSON.stringify(r));
  // many pages, some turned a quarter, so cards have two shapes
  await p.evaluate(() => { const d = PE.d; while (d.order.length < 120) { const sl = d.slots[d.order[d.order.length % 3]]; d.slots.push({ src: sl.src, rot: d.order.length % 5 === 0 ? 90 : 0, x: false, c: true, crop: null, dim: null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' }); d.order.push(d.slots.length - 1); } peRender(false); });
  await p.waitForTimeout(1500); await set(0); await rest();
  // one update per frame: many input events in one frame write the grid's columns at most once
  const w = await p.evaluate(async () => { const g = $('#peGrid'), zs = document.querySelector('#pdfDlg .pe-zoom-in'); let n = 0; const mo = new MutationObserver(m => { n += m.filter(x => x.attributeName === 'style').length; }); mo.observe(g, { attributes: true });
    for (let v = -50; v <= 50; v += 5) { zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); await new Promise(r => setTimeout(r, 0)); mo.disconnect(); return n; });
  ok('21 input events in one frame change the grid once at most', w <= 2, 'style writes: ' + w);
  await set(0); await rest();
  // nothing redrawn or freed while it moves; the pictures follow once it rests
  const d = await p.evaluate(async () => {
    const zs = document.querySelector('#pdfDlg .pe-zoom-in'), f = () => new Promise(r => requestAnimationFrame(r)); let draws = 0; const o = CanvasRenderingContext2D.prototype.drawImage; CanvasRenderingContext2D.prototype.drawImage = function () { draws++; return o.apply(this, arguments); };
    const sizes = () => Array.from(document.querySelectorAll('#peGrid canvas')).map(c => c.width).join(',');
    const s0 = sizes(); for (let v = -50; v <= 50; v += 2) { zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); await f(); } const s1 = sizes(), during = draws;          // what was drawn while it moved; the pictures that were waiting are drawn once it rests
    await new Promise(r => setTimeout(r, 600)); CanvasRenderingContext2D.prototype.drawImage = o; return { draws: during, same: s0 === s1 };
  });
  ok('no page is drawn or freed while the slider moves', d.draws === 0 && d.same, JSON.stringify(d));
  const near = await p.evaluate(() => { const vp = $('#peWrap').getBoundingClientRect(); return Array.from(document.querySelectorAll('#peGrid .page-card')).filter(c => { const q = c.getBoundingClientRect(); return q.bottom > vp.top && q.top < vp.bottom; }).every(c => c.querySelector('canvas').width > 1); });
  ok('cards on screen hold their pictures once it rests', near);
  // far cards skip layout and paint, and the scroll length is the same with the skipping switched off
  for (const v of [-50, -42, -35, -20, 0, 13, 25, 50]) {          // sizes where the layout's 64ths of a pixel round both ways: a skipped card must still match a drawn one
    await set(v); await rest(); await p.evaluate(() => { $('#peWrap').scrollTop = 1e6; }); await frame();
    const q = await p.evaluate(() => { const g = $('#peGrid'), wrap = $('#peWrap'), far = Array.from(g.querySelectorAll('.page-card.far')), skipped = far.filter(c => getComputedStyle(c).contentVisibility === 'auto').length, H = wrap.scrollHeight, top = Array.from(g.children).map(c => c.getBoundingClientRect().top);
      g.classList.remove('sized'); const H2 = wrap.scrollHeight, top2 = Array.from(g.children).map(c => c.getBoundingClientRect().top); g.classList.add('sized');
      return { far: far.length, skipped, H, H2, drift: Math.max(...top.map((t, i) => Math.abs(t - top2[i]))) }; });
    ok('slider ' + v + ': far cards are skipped and the scroll length is true', q.far > 0 && q.skipped === q.far && Math.abs(q.H - q.H2) < 0.5 && q.drift < 0.5, JSON.stringify(q));
  }
  // Dim boxes: a card that scrolls into view has its box's X and handles at the right size at once, in the same frame, with no script run per card
  await p.evaluate(() => { const d = PE.d; d.order.slice(-3).forEach(id => { d.slots[id].dim = [[0.1, 0.1, 0.7, 0.4]]; }); peTool('dim'); }); await p.waitForTimeout(900);
  await p.evaluate(() => { $('#peWrap').scrollTop = 0; }); await frame(); await p.waitForTimeout(300);
  await p.evaluate(() => { $('#peWrap').scrollTop = 1e6; });
  const dm = await p.evaluate(async () => { await new Promise(r => requestAnimationFrame(r)); const c = Array.from(document.querySelectorAll('#peGrid .page-card')).pop(), layer = c.querySelector('.pe-dim-layer'), box = c.querySelector('.pe-dimbox'), x = c.querySelector('.pe-dimx').getBoundingClientRect(), W = layer.clientWidth, H = layer.clientHeight, px = Math.min(0.6 * W, 0.3 * H), want = Math.min(22, Math.max(6, px * 0.5)); return { x: x.width, want, W, H, shown: !!box && box.getBoundingClientRect().width > 5 }; });
  ok('a Dim box on a card that scrolls into view is sized in the same frame, from the picture', dm.shown && Math.abs(dm.x - dm.want) < 1, JSON.stringify(dm));
  await p.evaluate(() => peTool('pages')); await p.waitForTimeout(500);
  // smooth: the cards' width follows the slider on every step (no standing still between column changes), and the middle card stays put on every step
  const sm = await p.evaluate(async () => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'), w = () => document.querySelector('#peGrid .page-card').getBoundingClientRect().width, out = []; zs.value = 0; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 600));
    for (let v = 0; v <= 24; v += 4) { zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); out.push(+w().toFixed(1)); } return out; });
  ok('the cards are wider on every step of the slider', sm.every((x, i) => i === 0 || x > sm[i - 1] + 0.5), JSON.stringify(sm));
  // the card nearest the middle stays in place when the columns change
  await set(0); await rest(); await p.evaluate(() => { $('#peWrap').scrollTop = 900; }); await frame();
  const st = await p.evaluate(async () => { const wrap = $('#peWrap'), vp = wrap.getBoundingClientRect(), mid = vp.top + vp.height / 2, zs = document.querySelector('#pdfDlg .pe-zoom-in'), cards = Array.from(document.querySelectorAll('#peGrid .page-card'));
    const pick = () => { let best = null, d = 1e9; cards.forEach(c => { const q = c.getBoundingClientRect(), k = Math.abs(q.top + q.height / 2 - mid); if (q.bottom > vp.top && q.top < vp.bottom && k < d) { d = k; best = c; } }); return best; };
    const c = pick(), y0 = (() => { const q = c.getBoundingClientRect(); return q.top + q.height / 2 - mid; })(); zs.value = 35; zs.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900)); const q = c.getBoundingClientRect(); return { y0, y1: q.top + q.height / 2 - mid, vis: q.bottom > vp.top && q.top < vp.bottom }; });
  ok('the card nearest the middle stays in view when the columns change', st.vis && Math.abs(st.y1) < 140, JSON.stringify(st));
  // the range: the biggest card is smaller than before, the smallest smaller still; every row ends flush with the grid's right edge at both ends and in between, at three window sizes
  for (const [w, h] of [[1280, 800], [900, 700], [1600, 900]]) {
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500);
    const rg = await p.evaluate(async () => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'), out = [];
      for (const v of [-50, -25, 0, 25, 50]) { zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 1000)); const g = document.querySelector('#peGrid'), gr = g.getBoundingClientRect(), cards = Array.from(g.children).map(c => c.getBoundingClientRect()), top = cards[0].top, row = cards.filter(q => Math.abs(q.top - top) < 2), last = row[row.length - 1];
        out.push({ v, w: +cards[0].width.toFixed(1), cols: row.length, gapRight: +(gr.right - last.right).toFixed(1) }); }
      return out; });
    ok('window ' + w + ': cards run from 90px to 162px wide', rg[0].w >= 88 && rg[0].w <= 92 && rg[4].w >= 150 && rg[4].w <= 165, JSON.stringify(rg.map(x => x.w)));
    ok('window ' + w + ': every row ends flush with the right edge, at every size', rg.every(x => x.cols >= 2 && Math.abs(x.gapRight) < 1.5), JSON.stringify(rg));
  }
  await p.setViewportSize({ width: 1280, height: 800 }); await p.waitForTimeout(500);
  // the zoom's one motion: when the number of columns changes, the pages in view slide to their new places (a transform or a fade, 200ms), and while the cards only grow nothing moves
  const nm = await p.evaluate(async () => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'), f = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), cardAnims = () => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('page-card')); let changes = 0, last = PE.cols, moved = 0, props = 0, long = 0, idle = 0;
    zs.value = -50; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 1000)); last = PE.cols;
    for (let v = -50; v <= 50; v += 2) { zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); PE.zfAt = 0; await f(); const was = last, n = cardAnims(); if (PE.cols !== last) { changes++; last = PE.cols; } if (PE.cols !== was) moved += n.length; else if (n.length && !PE.cols) idle++; n.forEach(a => { a.effect.getKeyframes().forEach(k => Object.keys(k).forEach(key => { if (!['offset', 'easing', 'composite', 'computedOffset', 'transform', 'opacity'].includes(key)) props++; })); if (a.effect.getTiming().duration > 520) long++; }); }
    return { changes, moved, props, long, idle }; });
  ok('a column change slides the pages in view, by transform and opacity only, and only then', nm.changes >= 2 && nm.moved > 0 && nm.props === 0 && nm.long === 0 && nm.idle === 0, JSON.stringify(nm));
  const sw = await p.evaluate(async () => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'), f = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); let running = 0, last = PE.cols, changes = 0;
    zs.value = -50; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 1000)); last = PE.cols; PE.zfAt = 0;
    for (let v = -50; v <= 50; v += 6) { zs.value = v; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(r)); if (PE.cols !== last) { changes++; last = PE.cols; } if (changes >= 2) running += document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('page-card')).length; }
    await new Promise(r => setTimeout(r, 700)); zs.value = -50; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 700)); zs.value = 50; zs.dispatchEvent(new Event('input', { bubbles: true })); await f(); const jump = document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('page-card')).length;
    return { changes, running, jump }; });
  ok('a quick sweep along the slider, and a jump from end to end, place the pages at once (after the first change, nothing moves)', sw.changes >= 2 && sw.running === 0 && sw.jump === 0, JSON.stringify(sw));
  const rm = await b.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); rm.setDefaultTimeout(30000);
  await rm.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await rm.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await rm.waitForFunction(() => S.pdf && S.pdf.n >= 2); await rm.waitForTimeout(800); await rm.evaluate(() => openPdfEditor()); await rm.waitForTimeout(1200);
  const rmN = await rm.evaluate(async () => { const zs = document.querySelector('#pdfDlg .pe-zoom-in'); zs.value = 40; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); zs.value = -40; zs.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return document.querySelectorAll('#peGrid .page-card').length && Array.from(document.querySelectorAll('#peGrid .page-card')).filter(c => c.getAnimations().length).length; });
  ok('reduced motion places the cards at once', rmN === 0, 'running: ' + rmN);
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
