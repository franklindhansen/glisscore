// Video: the Page layout choice (Spread or Single page). Single page gives one centered page per turn at the largest size that fits, keeps each page's shape,
// puts the credits on their own centered card, folds away First page alone, Credits start and the center fold shading, re-spaces the turns (and says so when they were
// hand-edited) as one undo step, comes back through settings export and import, and never pops at the end of a turn.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-single-page.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
  const S = (f, arg) => p.evaluate(([K, f, arg]) => { const s = window[K].S; return eval('(' + f + ')')(s, arg); }, [K, String(f), arg]);
  const pick = v => p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const settle = () => p.waitForTimeout(700);
  const near = (a, b, e = 1.5) => Math.abs(a - b) <= e;
  // what the preview draws at time t: the box around the bright paper, and a coarse picture to compare frames
  const look = t => p.evaluate(async ([K, t]) => {
    const kf = window[K], r = kf.previewR, st = kf.frameState(t); st.fade = 1;
    await new Promise(res => { r.onUpdate = null; (function wait(n) { r.render(st); if (!r.pending.size || n > 40) res(); else setTimeout(() => wait(n + 1), 50); })(0); });
    r.render(st);
    const c = r.canvas, W = c.width, H = c.height, o = document.createElement('canvas'); o.width = W; o.height = H;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, W, H).data;
    let x0 = W, x1 = -1, y0 = H, y1 = -1; for (let y = 0; y < H; y += 2) for (let xx = 0; xx < W; xx += 2) { const i = (y * W + xx) * 4; if (d[i] > 150 && d[i + 1] > 150 && d[i + 2] > 150) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const g = []; for (let gy = 0; gy < 36; gy++) for (let gx = 0; gx < 64; gx++) { const i = (Math.floor((gy + .5) * H / 36) * W + Math.floor((gx + .5) * W / 64)) * 4; g.push((d[i] + d[i + 1] + d[i + 2]) / 3); }
    return { W, H, x0, x1, y0, y1, g };
  }, [K, t]);
  const diff = (a, b) => a.g.reduce((s, v, i) => s + Math.abs(v - b.g[i]), 0) / a.g.length;

  // the choice
  ok('Page layout starts as Spread', await S(s => s.set.pageLayout) === 'spread' && await p.evaluate(() => document.querySelector('input[name=pageLayout][value=spread]').checked));
  ok('the choice has Spread and Single page', await p.evaluate(() => [...document.querySelectorAll('input[name=pageLayout]')].map(r => r.parentElement.textContent.trim()).join('|')) === 'Spread|Single page');
  const spreadSpreads = await S(s => s.spreads.map(x => x.join(',')));
  ok('a three-page score is two spreads in Spread (the first page alone)', spreadSpreads.join('|') === '-1,0|1,2', spreadSpreads.join('|'));

  // Single page: one entry per page, and the turns follow
  await pick('single'); await settle();
  const sp = await S(s => ({ set: s.set.pageLayout, spreads: s.spreads.map(x => x.join(',')), turns: s.turns.slice(), n: s.pdf.keep.length }));
  ok('Single page gives one entry per active page', sp.set === 'single' && sp.spreads.join('|') === '-1,0|-1,1|-1,2', JSON.stringify(sp));
  ok('there is one turn between each pair', sp.turns.length === sp.n - 1, JSON.stringify(sp.turns));
  const off0 = await p.evaluate(() => refOffset()), vs0 = await S(s => s.vStart);
  ok('the turns are spaced evenly', sp.turns.length === 2 && near(sp.turns[1] - sp.turns[0], sp.turns[0] - off0 - vs0, 0.01), JSON.stringify(sp.turns));

  const info = () => p.evaluate(() => document.querySelector('#spreadNow').textContent);
  ok('the counter reads "Page 1 / 3" in Single page', await info() === 'Page 1 / 3', await info());

  // the page: centered, at the largest size that fits, in its own shape
  const vs = await S(s => s.vStart);
  const one = await look(vs + 0.2);
  const lay = await p.evaluate(K => { const r = window[K].previewR, l = r.layout(), a = window[K].S.pdf.aspect; return { ...l, W: r.W, H: r.H, a, m: window[K].S.set.margin / 100 }; }, K);
  ok('the page is centered across the frame', near((one.x0 + one.x1) / 2, one.W / 2, 3) && near((one.y0 + one.y1) / 2, one.H / 2, 3), JSON.stringify({ x0: one.x0, x1: one.x1, W: one.W }));
  ok('the page keeps the score\'s shape', near((one.x1 - one.x0) / (one.y1 - one.y0), lay.a, 0.02), ((one.x1 - one.x0) / (one.y1 - one.y0)).toFixed(3) + ' vs ' + lay.a.toFixed(3));
  ok('it is the largest size that fits (the margin leaves room all round)', near(one.y1 - one.y0, lay.H * (1 - 2 * lay.m), lay.H * 0.02) || near(one.x1 - one.x0, lay.W * (1 - 2 * lay.m), lay.W * 0.02), JSON.stringify({ h: one.y1 - one.y0, H: lay.H }));
  // other shapes: wide, tall and square pages sit centered and inside the frame
  const shapes = [];
  for (const a of [1.5, 0.45, 1]) {
    const l = await p.evaluate(([K, a]) => { const kf = window[K]; kf.S.pdf.aspect = a; const l = kf.previewR.layout(), W = kf.previewR.W, H = kf.previewR.H; return { x: l.cx, pw: l.pw, ph: l.ph, W, H, y0: l.y0 }; }, [K, a]);
    shapes.push([a, near(l.x + l.pw / 2, l.W / 2, 1.5), l.pw >= 8 && l.x >= 0 && l.x + l.pw <= l.W && l.ph <= l.H, near(l.pw / l.ph, a, 0.02), near(l.y0 + l.ph / 2, l.H / 2, 1.5)]);
  }
  await p.evaluate(([K, a]) => { window[K].S.pdf.aspect = a; }, [K, lay.a]);
  ok('wide, tall and square pages are centered, fit the frame and keep their shape', shapes.every(s => s.slice(1).every(Boolean)), JSON.stringify(shapes));

  // the exported video lays the page out with the same code, in whatever frame shape was chosen
  const ex = await p.evaluate(K => [[1920, 1080], [1080, 1920], [1080, 1080], [1620, 1080]].map(([W, H]) => {
    const c = document.createElement('canvas'), r = new Renderer(c, PageSource, { cap: 2 }); r.resize(W, H); const l = r.layout(), a = window[K].S.pdf.aspect; r.destroy();
    return { W, H, centered: Math.abs(l.cx + l.pw / 2 - W / 2) <= 1.5 && Math.abs(l.y0 + l.ph / 2 - H / 2) <= 1.5, fits: l.cx >= 0 && l.cx + l.pw <= W && l.y0 >= 0 && l.y0 + l.ph <= H, shape: Math.abs(l.pw / l.ph - a) < 0.02 };
  }), K);
  ok('the export lays a single page out centered, inside the frame and in its own shape, in every frame shape', ex.every(e => e.centered && e.fits && e.shape), JSON.stringify(ex));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/panel-single.png' });

  // the panel: First page alone, Credits start and the center fold shading fold away, and come back
  await S(s => { s.set.firstAlone = false; s.set.creditsWithLast = false; });
  const hid = () => p.evaluate(() => ({ first: document.querySelector('#firstAloneField').hidden, fold: document.querySelector('#centerFold').hidden, pages: document.querySelector('#pagesField').hidden }));
  const h1 = await hid();
  ok('First page alone and the center fold shading are hidden in Single page', h1.first && h1.fold && !h1.pages, JSON.stringify(h1));
  ok('the center fold and divider have no effect on the page', await p.evaluate(() => gutterAmt() === 0 && dividerAmt() === 0));
  ok('their saved choices are kept', await S(s => s.set.firstAlone === false && s.set.creditsWithLast === false));

  // the credits: their own centered card after the last page, whichever way "Credits start" was set
  for (const withLast of [true, false]) {
    await S((s, withLast) => { s.set.creditsWithLast = withLast; s.set.creditsOn = true; s.credits.title = 'Test piece'; s.credits.titleEdited = true; }, withLast);
    await p.evaluate(() => syncCredits()); await settle();
    const c = await S(s => { const l = s.spreads[s.spreads.length - 1]; return { last: [...l], credits: !!l.credits, inline: !!l.inlineCredits, n: s.spreads.length, turns: s.turns.length }; });
    ok('credits are a separate card after the last page (Credits start ' + (withLast ? 'With' : 'After') + ')', c.n === 4 && c.last[0] === -1 && c.last[1] === -2 && c.credits && !c.inline && c.turns === 3, JSON.stringify(c));
  }
  await p.evaluate(K => { const kf = window[K]; kf.S.time = kf.vEnd() - 0.3; updateInfo(); }, K);
  ok('on the credits card the counter reads "Page 4 / 4 · credits"', await info() === 'Page 4 / 4 · credits', await info());
  await S(s => { s.time = s.vStart; }); await p.evaluate(() => updateInfo());
  const ct = await S(s => s.turns[s.turns.length - 1]);
  const cl = await look(ct + 1.2);
  ok('the credits text sits centered in the frame', cl.x1 > cl.x0 && near((cl.x0 + cl.x1) / 2, cl.W / 2, 8), JSON.stringify({ x0: cl.x0, x1: cl.x1, W: cl.W }));
  await S(s => { s.set.creditsOn = false; }); await p.evaluate(() => syncCredits()); await settle();

  // the layout panel explains nothing the video shows: no hint under the choice, no (i) beside First page alone
  ok('the layout panel has no hint line and First page alone has no (i)', await p.evaluate(() => !document.querySelector('#pageLayoutHint') && !document.querySelector('#firstAloneField .info-i, #firstAloneField .tip')));

  // switching back brings the fields and the two-page layout back
  await pick('spread'); await settle();
  const h2 = await hid();
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/panel-spread.png' });
  ok('Spread brings First page alone and the center fold back', !h2.first && !h2.fold, JSON.stringify(h2));
  ok('Spread keeps its own counter wording', await info() === 'Spread 1 / 2 · pp. 1–2', await info());
  ok('Spread comes back with the saved First page alone choice (off)', (await S(s => s.spreads.map(x => x.join(',')))).join('|') === '0,1|2,-1');
  await S(s => { s.set.firstAlone = true; s.set.creditsWithLast = true; });

  // turns: hand-edited turns are re-spaced, it says so, and one undo restores the layout and the turns
  await p.evaluate(K => { const s = window[K].S; s.turns = [s.vStart + 3]; s.turnsEdited = true; s.ph = [false]; window[K].onTurnsChanged(); }, K);
  const before = await S(s => ({ turns: s.turns.slice(), edited: s.turnsEdited, hist: s.history.length }));
  await pick('single'); await settle();
  const after = await S(s => ({ turns: s.turns.slice(), edited: s.turnsEdited, set: s.set.pageLayout, hist: s.history.length }));
  ok('hand-edited turns are re-spaced evenly for the new layout', after.turns.length === 2 && !after.edited && near(after.turns[1] - after.turns[0], after.turns[0] - off0 - vs0, 0.01), JSON.stringify(after));
  ok('it says so', /spaced evenly/i.test(await p.evaluate(() => document.querySelector('#toast').textContent)), await p.evaluate(() => document.querySelector('#toast').textContent));
  ok('the change is one history step', after.hist === before.hist + 1, JSON.stringify({ before: before.hist, after: after.hist }));
  await p.evaluate(() => document.querySelector('#bUndo').click()); await settle();
  const undone = await S(s => ({ turns: s.turns.slice(), edited: s.turnsEdited, set: s.set.pageLayout, n: s.spreads.length }));
  ok('one undo restores the layout and the turns', undone.set === 'spread' && undone.n === 2 && JSON.stringify(undone.turns) === JSON.stringify(before.turns) && undone.edited === true, JSON.stringify(undone));
  ok('the choice shows Spread again', await p.evaluate(() => document.querySelector('input[name=pageLayout][value=spread]').checked));
  await p.evaluate(() => document.querySelector('#bRedo').click()); await settle();
  ok('redo goes back to Single page', await S(s => s.set.pageLayout === 'single' && s.spreads.length === 3));
  // turns that were never moved are re-spaced without a notice
  await p.evaluate(() => { document.querySelector('#toast').classList.remove('show'); document.querySelector('#toast').textContent = ''; });
  await S(s => { s.turnsEdited = false; }); await pick('spread'); await settle();
  ok('untouched turns are re-spaced quietly', await p.evaluate(() => !/spaced evenly/i.test(document.querySelector('#toast').textContent)));

  // settings export and import
  await pick('single'); await settle();
  const exp = await p.evaluate(() => buildExport('settings'));
  ok('the setting is in an exported settings file', JSON.parse(exp).settings.pageLayout === 'single');
  await pick('spread'); await settle();
  await p.evaluate(async exp => { await importSettings(new File([exp], 'a.json', { type: 'application/json' })); }, exp); await settle();
  ok('importing it brings Single page back', await S(s => s.set.pageLayout === 'single' && s.spreads.length === 3 && s.spreads[0][0] === -1), await S(s => s.set.pageLayout));
  ok('an unknown value is dropped on import', await p.evaluate(async () => { const o = { glisscore: 1, settings: { pageLayout: 'poster' } }; await importSettings(new File([JSON.stringify(o)], 'b.json')); return S.set.pageLayout === 'single'; }));
  await p.evaluate(() => restoreDefaults()); await settle();
  ok('Restore default settings goes back to Spread', await S(s => s.set.pageLayout === 'spread' && s.spreads.length === 2));

  // the turns: no pop at the end of a turn, in any transition, and the new page is where it settles
  await pick('single'); await settle();
  for (const tr of ['flip', 'slide', 'cut']) {
    await S((s, tr) => { s.set.transition = tr; s.set.fadeStyle = 'black'; }, tr);
    await p.evaluate(() => { stageDirty = true; });
    const t = await p.evaluate(K => ({ s: window[K].S.turns[0] - refOffset(), D: flipDur() }), K);
    const endT = t.s + t.D;
    const a = await look(endT - 0.02), z = await look(endT + 0.05);
    if (tr !== 'cut') {
      ok(tr + ': the last moment of the turn matches the settled page (no pop)', diff(a, z) < 6, 'diff ' + diff(a, z).toFixed(2));
      const st0 = await look(t.s - 0.05), st1 = await look(t.s + 0.0);
      ok(tr + ': the first moment of the turn matches the page before it', diff(st0, st1) < 6, 'diff ' + diff(st0, st1).toFixed(2));
    }
    if (process.env.SHOTS) for (const f of [0.15, 0.35, 0.55, 0.75, 0.9]) await p.evaluate(([K, t]) => { const kf = window[K]; kf.S.time = t; kf.previewR.render(Object.assign(kf.frameState(t), { fade: 1 })); window.__shot = kf.previewR.canvas.toDataURL('image/png'); }, [K, t.s + f * t.D]).then(() => p.evaluate(() => window.__shot)).then(u => require('fs').writeFileSync(process.env.SHOTS + '/single-' + tr + '-' + f + '.png', Buffer.from(u.split(',')[1], 'base64')));
    const settled = await look(endT + 0.2);
    ok(tr + ': the next page settles centered', near((settled.x0 + settled.x1) / 2, settled.W / 2, 3), JSON.stringify({ x0: settled.x0, x1: settled.x1, W: settled.W }));
  }
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
