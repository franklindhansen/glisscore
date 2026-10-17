// Video: a Single page turn is always a Peel (there is no Turn style choice). The turn does not pop at its start or its end, the sheet is carried out to the left
// of the next page, and an old saved video or settings file that still names a turn style loads without it.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-single-turn.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (init) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    if (init) await p.addInitScript(init);
    await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
    await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
    return p;
  };
  // a video saved when Turn style existed: the setting is dropped and Single page still turns
  let p = await open(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('glisscore.settings', JSON.stringify({ pageLayout: 'single', turnStyle: 'wrap' })); sessionStorage.setItem('seeded', '1'); } });
  ok('a saved turn style is dropped on load', await p.evaluate(() => !('turnStyle' in S.set)));
  await p.context().close();

  p = await open();
  ok('there is no Turn style control', await p.evaluate(() => !document.querySelector('#turnStyleField') && !document.querySelector('input[name=turnStyle]')));
  await p.evaluate(() => { setPageLayout('single'); S.set.transition = 'flip'; S.set.fadeStyle = 'black'; stageDirty = true; }); await p.waitForTimeout(400);
  const imp = settings => p.evaluate(async settings => { await importSettings(new File([JSON.stringify({ glisscore: 1, settings })], 'x.json')); return 'turnStyle' in S.set; }, settings);
  ok('importing a file that names a turn style does not bring it back', !(await imp({ pageLayout: 'single', turnStyle: 'wrap' })));

  // no pop at either end of a turn
  const look = t => p.evaluate(async ([K, t]) => {
    const kf = window[K], r = kf.previewR, st = kf.frameState(t); st.fade = 1;
    await new Promise(res => { (function wait(n) { r.render(st); if (!r.pending.size || n > 40) res(); else setTimeout(() => wait(n + 1), 50); })(0); });
    r.render(st);
    const c = r.canvas, W = c.width, H = c.height, o = document.createElement('canvas'); o.width = W; o.height = H;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, W, H).data, g = [];
    for (let gy = 0; gy < 36; gy++) for (let gx = 0; gx < 64; gx++) { const i = (Math.floor((gy + .5) * H / 36) * W + Math.floor((gx + .5) * W / 64)) * 4; g.push((d[i] + d[i + 1] + d[i + 2]) / 3); }
    let left = 0; for (let yy = 0; yy < H; yy += 4) for (let xx = 0; xx < W / 4; xx += 4) { const i = (yy * W + xx) * 4; if (d[i] > 150) left++; }
    return { g, left };
  }, [K, t]);
  const diff = (a, b) => a.g.reduce((s, v, i) => s + Math.abs(v - b.g[i]), 0) / a.g.length;
  const t = await p.evaluate(K => ({ s: window[K].S.turns[0] - refOffset(), D: flipDur() }), K), endT = t.s + t.D;
  const a = await look(endT - 0.02), z = await look(endT + 0.05), s0 = await look(t.s - 0.05), s1 = await look(t.s);
  ok('the last moment of a turn matches the settled page (no pop)', diff(a, z) < 6, 'diff ' + diff(a, z).toFixed(2));
  ok('the first moment of a turn matches the page before it', diff(s0, s1) < 6, 'diff ' + diff(s0, s1).toFixed(2));
  const mid = await look(t.s + 0.6 * t.D);
  ok('partway through, the sheet is carried out to the left of the next page', mid.left > 0, 'bright samples left of the page ' + mid.left);
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
