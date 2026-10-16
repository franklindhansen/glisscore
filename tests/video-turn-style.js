// Video: Turn style (Peel or Wrap) for a single page's turn. The choice shows only in Single page with the Turn transition. New projects start on Peel; a Single page
// video saved with Fade (in this browser, or in a settings file) loads as Peel. It comes back through settings export and import, is one History step, and
// neither style pops at the start or the end of a turn.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-turn-style.js
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
  // saved with Fade, or before turn styles existed: loads as Peel
  let p = await open(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('glisscore.settings', JSON.stringify({ pageLayout: 'single', turnStyle: 'fade' })); sessionStorage.setItem('seeded', '1'); } });
  ok('a Single page video saved with Fade loads as Peel', await p.evaluate(() => S.set.turnStyle === 'peel' && document.querySelector('input[name=turnStyle]:checked').value === 'peel'));
  await p.context().close();

  p = await open();
  const S = (f, arg) => p.evaluate(([K, f, arg]) => { const s = window[K].S; return eval('(' + f + ')')(s, arg); }, [K, String(f), arg]);
  const vis = () => p.evaluate(() => { const f = document.querySelector('#turnStyleField'); return !f.hidden; });
  const pick = (n, v) => p.evaluate(([n, v]) => { const r = document.querySelector('input[name=' + n + '][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, [n, v]);
  const settle = () => p.waitForTimeout(700);
  ok('a new project starts on Peel', await S(s => s.set.turnStyle === 'peel'));
  ok('the choice is hidden in Spread', !(await vis()));
  await pick('pageLayout', 'single'); await settle();
  ok('the choice shows in Single page with Turn', await vis());
  if (process.env.SHOTS) { await p.screenshot({ path: process.env.SHOTS + '/turn-style-desktop.png' }); await p.setViewportSize({ width: 390, height: 844 }); await settle(); await p.evaluate(() => document.querySelector('#turnStyleField').scrollIntoView({ block: 'center' })); await p.screenshot({ path: process.env.SHOTS + '/turn-style-phone.png' }); await p.setViewportSize({ width: 1300, height: 900 }); await settle(); }
  const seg = await p.evaluate(() => [...document.querySelectorAll('input[name=turnStyle]')].map(r => r.value + '=' + r.nextElementSibling.textContent).join());
  ok('it reads Peel and Wrap', seg === 'peel=Peel,wrap=Wrap', seg);
  await pick('transition', 'slide'); await settle();
  ok('the choice is hidden with Slide', !(await vis()));
  await pick('transition', 'cut'); await settle();
  ok('the choice is hidden with Cut', !(await vis()));
  await pick('transition', 'flip'); await settle();
  ok('the choice comes back with Turn', await vis());
  await pick('pageLayout', 'spread'); await settle();
  ok('the choice is hidden again in Spread', !(await vis()));
  await pick('pageLayout', 'single'); await settle();

  // the choice is one History step, named Turn style, and undo brings the control back
  const before = await S(s => s.history.length);
  await pick('turnStyle', 'wrap'); await settle();
  const lab = await p.evaluate(() => ({ n: S.history.length, label: mainStepLabel(S.history[S.history.length - 1], snap()) }));
  ok('picking Wrap is one History step named Turn style', lab.n === before + 1 && lab.label === 'Turn style', JSON.stringify(lab));
  ok('the summary names the style', (await p.evaluate(() => groupSummary('transition'))).slice(0, 2).every(t => /^Turn · Wrap/.test(t)));
  await p.evaluate(() => undo()); await settle();
  ok('undo brings Peel and its control back', await p.evaluate(() => S.set.turnStyle === 'peel' && document.querySelector('input[name=turnStyle]:checked').value === 'peel'));
  await p.evaluate(() => redo && redo()); await settle();

  // settings export and import keep it; Fade or no turn style in a file loads as Peel
  const out = await p.evaluate(() => { S.set.turnStyle = 'wrap'; return JSON.parse(buildExport('settings')).settings.turnStyle; });
  ok('the settings file holds the turn style', out === 'wrap', out);
  const imp = async (settings, start) => p.evaluate(async ([settings, start]) => { S.set.turnStyle = start; await importSettings(new File([JSON.stringify({ glisscore: 1, settings })], 's.json')); return S.set.turnStyle; }, [settings, start]);
  ok('importing a file with Peel loads Peel', (await imp({ pageLayout: 'single', turnStyle: 'peel' }, 'wrap')) === 'peel');
  ok('importing a file with Wrap loads Wrap', (await imp({ pageLayout: 'single', turnStyle: 'wrap' }, 'peel')) === 'wrap');
  ok('importing a file with Fade loads Peel', (await imp({ pageLayout: 'single', turnStyle: 'fade' }, 'wrap')) === 'peel');
  ok('importing a Single page file without a turn style loads Peel', (await imp({ pageLayout: 'single' }, 'wrap')) === 'peel');
  ok('a bad turn style in a file is dropped', (await imp({ pageLayout: 'single', turnStyle: 'wobble' }, 'peel')) !== 'wobble');
  await pick('pageLayout', 'single'); await p.evaluate(() => { S.set.pageLayout = 'single'; S.set.transition = 'flip'; S.set.fadeStyle = 'black'; }); await settle();

  // no pop at either end of a turn, in either style
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
  for (const style of ['peel', 'wrap']) {
    await S((s, v) => { s.set.turnStyle = v; }, style); await p.evaluate(() => { stageDirty = true; });
    const t = await p.evaluate(K => ({ s: window[K].S.turns[0] - refOffset(), D: flipDur() }), K), endT = t.s + t.D;
    const a = await look(endT - 0.02), z = await look(endT + 0.05), s0 = await look(t.s - 0.05), s1 = await look(t.s);
    ok(style + ': the last moment of a turn matches the settled page (no pop)', diff(a, z) < 6, 'diff ' + diff(a, z).toFixed(2));
    ok(style + ': the first moment of a turn matches the page before it', diff(s0, s1) < 6, 'diff ' + diff(s0, s1).toFixed(2));
    const mid = await look(t.s + 0.6 * t.D);
    if (style === 'peel') ok('peel: partway through, the sheet is carried out to the left of the next page', mid.left > 0, 'bright samples left of the page ' + mid.left);
  }
  // Wrap: stepping through the whole turn, no frame jumps from the one before it (the edge-on moment included), and the sheet is gone at the end
  await S((s, v) => { s.set.turnStyle = v; }, 'wrap'); await p.evaluate(() => { stageDirty = true; });
  const w = await p.evaluate(K => ({ s: window[K].S.turns[0] - refOffset(), D: flipDur() }), K), steps = [];
  for (let i = 0; i <= 80; i++) steps.push(await look(w.s + w.D * i / 80));
  const jumps = steps.slice(1).map((v, i) => diff(steps[i], v)), worst = Math.max(...jumps);
  ok('wrap: no frame jumps from the one before it', worst < 12, 'worst step ' + worst.toFixed(2) + ' at ' + jumps.indexOf(worst));
  const settled = await look(w.s + w.D + 0.1);
  ok('wrap: the last frame of the turn is the settled page', diff(steps[80], settled) < 2, 'diff ' + diff(steps[80], settled).toFixed(2));
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
