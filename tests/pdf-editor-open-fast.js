// PDF Editor: opening it stays quick with many pages, in Chromium and in WebKit (Safari).
// The paper color of a page is the same as a full sort would give, and quick enough for the cards drawn on open;
// writing the position numbers on many cards is quick in WebKit, where a :has() rule that tests :empty made every write slow;
// and the narrow head still shows while it holds a status line and goes once the line is cleared.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-open-fast.js
const { chromium, webkit } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  for (const [kind, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const b = await engine.launch(), errs = [];
    const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.waitForTimeout(800);

    // no style rule tests :empty inside :has(): WebKit then re-checks it on every change to any element's children
    const bad = await p.evaluate(() => { const out = []; const walk = list => { for (const r of list) { if (r.selectorText) { if (/:has\([^{]*:empty/.test(r.selectorText)) out.push(r.selectorText.slice(0, 80)); } else if (r.cssRules) walk(r.cssRules); } }; for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch (e) { } } return out; });
    ok(kind + ': no style rule tests :empty inside :has()', !bad.length, bad.join(' | '));

    // the paper color: the same as the full-sort reference on pages of many paper colors and inks, whole and in parts, and quick for the 24 cards drawn on open
    const pc = await p.evaluate(() => {
      function ref(cv, rect) {          // the paper color worked out with full sorts: the value the quick one must match exactly
        const r = rect ? [Math.max(0, Math.round(rect[0])), Math.max(0, Math.round(rect[1])), Math.round(rect[2]), Math.round(rect[3])] : [0, 0, cv.width, cv.height];
        r[2] = Math.min(r[2], cv.width - r[0]); r[3] = Math.min(r[3], cv.height - r[1]); if (r[2] < 1 || r[3] < 1) return [255, 255, 255];
        const d = cv.getContext('2d').getImageData(r[0], r[1], r[2], r[3]).data, step = Math.max(1, Math.floor(d.length / 4 / 40000)), lum = [];
        for (let i = 0; i < d.length; i += 4 * step) lum.push(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8);
        const top = lum.slice().sort((a, b) => a - b)[Math.floor(lum.length * 0.95)] || 255, cut = top * 0.9, ch = [[], [], []];
        for (let i = 0; i < d.length; i += 4 * step) if ((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8) >= cut) { ch[0].push(d[i]); ch[1].push(d[i + 1]); ch[2].push(d[i + 2]); }
        return ch.map(a => a.length ? a.sort((x, y) => x - y)[a.length >> 1] : 255);
      }
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const page = (w, h, paper, ink) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.fillStyle = paper; x.fillRect(0, 0, w, h);
        const id = x.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 18; d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * 0.8)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 1.2)); } x.putImageData(id, 0, 0);
        x.fillStyle = ink; for (let k = 0; k < 140; k++) x.fillRect(rnd() * w, rnd() * h, 4 + rnd() * 60, 1 + rnd() * 6); return cv; };
      const pages = [], papers = ['#fff', '#f4ecd8', '#e6e6e6', '#d9cbb0', '#cfd8dc', '#202020', '#fffef0', '#b8a07a'];
      for (let i = 0; i < 24; i++) pages.push(page(185, 240, papers[i % papers.length], i % 3 ? '#111' : '#3a2a1a'));
      const big = page(1200, 1550, '#efe6d2', '#151515'), rects = [null, [10, 20, 100, 150], [0, 0, 50, 50], [-5, -5, 300, 300], [60, 80, 0.4, 12], [120.6, 30.2, 80.7, 190.4]];
      const diff = []; pages.slice(0, 8).concat([big]).forEach((cv, i) => rects.forEach(r => { const a = paperOf(cv, r).join(), e = ref(cv, r).join(); if (a !== e) diff.push(i + ':' + JSON.stringify(r) + ' ' + a + ' vs ' + e); }));
      const t0 = performance.now(); pages.forEach(cv => paperOf(cv)); const ms = performance.now() - t0;
      return { diff, ms: Math.round(ms) };
    });
    ok(kind + ': the paper color matches the full-sort reference exactly', !pc.diff.length, pc.diff.slice(0, 4).join(' | '));
    ok(kind + ': the paper color of 24 cards takes under 60ms', pc.ms < 60, pc.ms + 'ms');

    // many cards: writing their position numbers is quick (WebKit took ~2.7ms a card with the old rule)
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
    await p.evaluate(() => { const d = PE.d; while (d.order.length < 220) { const sl = d.slots[d.order[d.order.length % 3]]; d.slots.push({ src: sl.src, rot: 0, x: false, c: true, crop: null, dim: null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' }); d.order.push(d.slots.length - 1); } peRender(false); });
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => { const r = []; for (let k = 0; k < 3; k++) { document.body.offsetHeight; const t = performance.now(); peState(); document.body.offsetHeight; r.push(performance.now() - t); } return { ms: Math.round(Math.min(...r)), cards: $('#peGrid').children.length, nums: Array.from(document.querySelectorAll('#peGrid .pe-pos')).slice(-2).map(e => e.textContent) }; });
    ok(kind + ': updating 220 cards takes under 100ms', st.cards >= 220 && st.ms < 100, JSON.stringify(st));
    ok(kind + ': the cards still show their positions', st.nums.join() === '219,220', JSON.stringify(st.nums));
    await p.evaluate(() => $('#peDone').click()); await p.waitForTimeout(600);

    // a narrow window: a head with no button shows while it holds a status line, and goes with the line
    await p.setViewportSize({ width: 420, height: 800 }); await p.waitForTimeout(300);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800); await p.evaluate(() => peTool('dim')); await p.waitForTimeout(800);
    const head = () => p.evaluate(() => { const h = $('#peDimStatus').closest('.pe-phead'); return getComputedStyle(h).display !== 'none' && getComputedStyle($('#peDimStatus')).display !== 'none'; });
    const h0 = await head(); await p.evaluate(() => peSay('#peDimStatus', 'A note')); const h1 = await head(); await p.evaluate(() => peSay('#peDimStatus', '')); const h2 = await head();
    await p.evaluate(() => peSay('#peDimStatus', 'Again')); await p.evaluate(() => peClearStatus()); const h3 = await head();
    ok(kind + ': the narrow head shows only while it holds a status line', !h0 && h1 && !h2 && !h3, JSON.stringify({ h0, h1, h2, h3 }));
    ok(kind + ': no page errors', !errs.length, errs.slice(0, 3).join(' | '));
    await b.close();
  }
})();
