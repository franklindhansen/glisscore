// EQ Match opens and closes with a height glide (the band controls fold shut as it unfolds): sampled every frame at phone, laptop and large sizes.
// No jump (no frame moves the panels more than a share of the whole move), the end state is the full card with nothing clipped, nothing scrolls sideways, and the page does not scroll where it should not.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-match-panel.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
function wav() { const sr = 48000, n = sr * 2, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sr)), 44 + i * 2); return b; }
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [w, h] of [[390, 800], [1280, 720], [1920, 1080]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', { name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() });
    await p.waitForFunction(() => S.audio); await p.waitForTimeout(800); await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(600);
    await p.evaluate(() => aeTool('eq')); await p.waitForTimeout(500);
    // click, then sample both folds' heights on every frame until they settle
    const run = open => p.evaluate(async open => {
      const bf = document.querySelector('#aeBandFold'), mf = document.querySelector('#aeMatchFold'), btn = document.querySelector('#aeMatchBtn'), rows = [];
      const sample = () => rows.push({ t: performance.now(), band: bf.getBoundingClientRect().height, match: mf.getBoundingClientRect().height });
      sample(); const start = rows[0]; btn.click(); const t0 = performance.now();
      await new Promise(res => { const tick = () => { sample(); if (performance.now() - t0 < 900) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      const card = document.querySelector(open ? '#aeMatch' : '#aeEqBand'), fin = rows[rows.length - 1], vis = document.querySelector(open ? '#aeMatchFold' : '#aeBandFold');
      return { rows, start, fin, cardH: card.getBoundingClientRect().height + parseFloat(getComputedStyle(card).marginTop) + parseFloat(getComputedStyle(card).marginBottom), foldH: vis.getBoundingClientRect().height, pageX: document.documentElement.scrollWidth - innerWidth, dlgX: document.querySelector('#audioDlg .dlg').scrollWidth - document.querySelector('#audioDlg .dlg').clientWidth,
        inertOpen: vis.inert === false, shutInert: document.querySelector(open ? '#aeBandFold' : '#aeMatchFold').inert === true };
    }, open);
    for (const open of [true, false]) {
      const r = await run(open), tag = w + 'x' + h + (open ? ' opening: ' : ' closing: ');
      const grow = r.rows.map(x => open ? x.match : x.band), shrink = r.rows.map(x => open ? x.band : x.match), total = Math.abs(grow[grow.length - 1] - grow[0]);
      const steps = grow.slice(1).map((v, i) => Math.abs(v - grow[i])), monotone = grow.every((v, i) => i === 0 || (v >= grow[i - 1] - 0.5)), shrinkMono = shrink.every((v, i) => i === 0 || (v <= shrink[i - 1] + 0.5));
      ok(tag + 'the panel grows through in-between heights (not a jump) and the other folds away', total > 40 && Math.max(...steps) < total * 0.45 && grow.some(v => v > grow[0] + 5 && v < grow[grow.length - 1] - 5) && monotone && shrinkMono, 'total ' + total.toFixed(0) + 'px, biggest frame ' + Math.max(...steps).toFixed(0) + 'px, frames ' + grow.length);
      ok(tag + 'it ends at the full card, nothing clipped; the folded one is inert', Math.abs(r.foldH - r.cardH) < 1 && r.inertOpen && r.shutInert && Math.min(...(open ? [r.fin.band] : [r.fin.match])) < 1, JSON.stringify({ fold: r.foldH, card: r.cardH }));
      ok(tag + 'nothing scrolls sideways', r.pageX <= 0 && r.dlgX <= 0, r.pageX + ' / ' + r.dlgX);
    }
    await p.close();
  }
  ok('no page errors', !errs.length, errs.join('; '));
  await b.close();
})();
