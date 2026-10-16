// Video editor timeline: the hover tags (turn, credits end, trim) are drawn over the playhead, so a handle under the playhead never cuts its tag; away from a tag the playhead is one unbroken line.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-tags-over-playhead.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  await p.evaluate(K => { const s = window[K].S; s.turns = [s.vStart + 3, s.vStart + 6, s.vStart + 9]; s.set.creditsOn = true; s.credits.title = 'Test'; s.set.creditsEarly = true; s.creditsEnd = Math.min(s.turns[2] + 6, window[K].vEnd() - 0.5); }, K);
  // draw with the playhead at time t and the given hover state, then read pixels of the column at x, and of the column 10px to its right
  const draw = (t, hover) => p.evaluate(async ([K, t, hover]) => {
    const k = window[K], TL = k.TL; k.Transport.seek(t); TL.hover = -1; TL.hoverCr = false; TL.hoverTrim = null; Object.assign(TL, hover); TL.overlayDirty = true;
    await new Promise(r => setTimeout(r, 200));
    const x = Math.round(k.t2x(t)), g = TL.canvas.getContext('2d'), d = TL.dpr;
    const px = (X, Y) => Array.from(g.getImageData(Math.round(X * d), Math.round(Y * d), 1, 1).data).join(',');
    return { trackY: TL.trackY, trackH: TL.trackH, rulerH: TL.rulerH, h: TL.h, rows: Array.from({ length: Math.floor(TL.h) }, (_, y) => [px(x - 0.5, y), px(x + 10, y)]) };
  }, [K, t, hover]);
  const tagTop = r => (r.trackY - 26 < r.rulerH ? r.trackY + r.trackH + 2 : r.trackY - 26);
  const cases = [
    ['turn', async () => { const t = await p.evaluate(K => window[K].S.turns[1], K); return [t, { hover: 1 }, r => tagTop(r)]; }],
    ['credits end', async () => { const t = await p.evaluate(K => window[K].S.creditsEnd, K); return [t, { hoverCr: true }, r => tagTop(r)]; }],
    ['trim', async () => { const t = await p.evaluate(K => window[K].S.vStart, K); return [t, { hoverTrim: 'start' }, r => r.rulerH + 4]; }],
  ];
  for (const [name, setup] of cases) {
    const [t, hover, top] = await setup();
    const r = await draw(t, hover), by = Math.round(top(r)), inTag = y => y >= by + 2 && y <= by + 4;
    ok(name + ' tag: the tag\'s pixels are the tag\'s at the playhead column', [by + 2, by + 3, by + 4].every(y => r.rows[y][0] === r.rows[y][1]), JSON.stringify(r.rows.slice(by + 2, by + 5)));
    const line = r.rows.map((p, y) => [y, p[0]]).filter(([y]) => y > 12 && y < r.h - 2 && (y < by - 1 || y > by + 21));
    const colour = line[0][1];
    ok(name + ' tag: the playhead still runs unbroken above and below the tag', line.every(([, c]) => c === colour), 'colour ' + colour + ', ' + line.filter(([, c]) => c !== colour).map(([y]) => y).join(','));
  }
  const n = await draw(await p.evaluate(K => window[K].S.turns[1], K), {});
  const col = n.rows.map(p => p[0]).slice(12, n.h - 2);
  ok('no tag: the playhead column is one unbroken line from the ruler to the bottom', col.every(c => c === col[0]), col[0]);
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
