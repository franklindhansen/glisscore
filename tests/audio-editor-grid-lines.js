// The layout lines of every Audio Editor tool: what must line up inside a tool window, read from the page at every size the tool has, in every state that changes one of its cards, and in full screen.
// The rules live in tests/lib/layout-lines.js (read it for the list) and measure through the shared helper tests/lib/measure.js, which audio-editor-measure.js proves against pixels. Nothing here names a card:
// the cards are the .ae-card inside the tool pane on show, so a new card is measured as soon as it exists, on or off the tool grid (.tool-grid).
// Today's failures are the backlog, kept in tests/audio-editor-layout-expected.txt, one line each, "tool state size rule element  # what was measured". The list may only shrink: this check fails on a failure that is not
// listed, and on a listed failure that now passes (it names the line to delete). Card heights at 1440x900 are kept in tests/audio-editor-card-heights.txt, "tool state card height"; a card that changes height fails here.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-grid-lines.js
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const { install } = require('./lib/measure.js'), { lines } = require('./lib/layout-lines.js'), { fitMeasure } = require('./lib/fit-measure.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const EXPECTED = path.join(__dirname, 'audio-editor-layout-expected.txt'), HEIGHTS = path.join(__dirname, 'audio-editor-card-heights.txt');
const SIZES = [[1440, 900], [1440, 720], [1040, 760], [900, 760], [761, 800], [700, 800], [600, 800], [521, 800], [390, 800], [360, 800], 'full'];          // 'full' is full screen at 1440x900
// a tool, and the states that change what its cards hold; each state is set from the one before it
const radio = (name, v) => { const r = document.querySelector('input[name=' + name + '][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); };
const TOOLS = {
  noise: [['idle', null], ['auto', async () => { document.querySelector('#aeNrFind').click(); await sleep(100); for (let i = 0; i < 600 && AE.nrAutoBusy; i++) await sleep(25); await sleep(300); }],
    ['learned', async () => { document.querySelector('#aeNrLearn').click(); for (let i = 0; i < 200 && document.querySelector('#aeNrGrid').classList.contains('pre'); i++) await sleep(50); await sleep(700); }]],
  spec: [['heal', null], ['reduce', () => __radio('spMode', 'cut')]],
  eq: [['idle', null], ['match', () => document.querySelector('#aeMatchBtn').click()]],
  imager: [['overall', null], ['frequency', () => __radio('aeWidthMode', 'bands')]],
  fades: [['idle', null]],
  level: [['off', null], ['loud', () => __radio('aeNormMode', 'loud')], ['peak', () => __radio('aeNormMode', 'peak')]],
  emu: [['idle', null]],
};
const readFile = f => { try { return fs.readFileSync(f, 'utf8').split('\n'); } catch (e) { return []; } };
const data = f => readFile(f).map((l, i) => [l.replace(/\s+#.*$/, '').trim(), i + 1]).filter(([t]) => t && t[0] !== '#');
(async () => {
  const b = await chromium.launch(), errs = [], seen = new Map(), counts = {};          // seen: failure key -> what was measured
  const heights = new Map(data(HEIGHTS).map(([t]) => { const p = t.split(/\s+/); return [p.slice(0, 3).join(' '), +p[3]]; }));
  const queue = [...SIZES], one = async size => {
    const full = size === 'full', [w, h] = full ? [1440, 900] : size, tag = full ? 'full' : w + 'x' + h, main = full || (w === 1440 && h === 900);
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push(tag + ': ' + e.message); });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
    if (full) { await p.click('#aeFull'); await p.waitForTimeout(900); }
    await p.evaluate(install); await p.evaluate('window.__radio = ' + radio);
    counts[tag] = { states: 0, n: 0 };
    for (const [tool, states] of Object.entries(TOOLS)) {
      await p.evaluate(t => aeTool(t), tool); await p.waitForTimeout(500);
      for (const [state, go] of states) {
        if (go) { await p.evaluate('(' + go + ')()'); await p.waitForTimeout(tool === 'level' ? 1000 : 500); }
        const m = await p.evaluate(lines, { main }), fit = await p.evaluate(fitMeasure, { card: '.ae-card', body: '.ae-pbody', root: '.ae-pane:not([hidden])' }), at = tool + ' ' + state + ' ' + tag + ' ';
        counts[tag].states++; counts[tag].n += m.n;
        if (!m.n) seen.set(at + 'measured nothing', 'no card was found in the tool');
        for (const [rule, el, note] of m.fails) seen.set(at + rule + ' ' + el, note);
        for (const x of fit.pass) { const [el, rest] = x.split(' (')[0].split(' > '); seen.set(at + 'clipped ' + el + '>' + (rest || '').replace(/ /g, '.'), x); }
        if (tag === '1440x900') for (const [card, ht] of Object.entries(m.heights)) { const want = heights.get(tool + ' ' + state + ' ' + card); if (want === undefined || Math.abs(want - ht) > 0.5) seen.set(at + 'card-height ' + card, 'is ' + ht + 'px, recorded ' + (want === undefined ? 'nowhere (add "' + tool + ' ' + state + ' ' + card + ' ' + ht + '" to tests/audio-editor-card-heights.txt)' : want + 'px')); }
      } }
    await p.close();
  };
  await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) await one(queue.shift()); }));          // four windows at a time: each decodes the recording, and the suite runs many checks at once
  const exp = new Map(data(EXPECTED)), fresh = [...seen.keys()].filter(k => !exp.has(k)).sort(), fixed = [...exp].filter(([k]) => !seen.has(k)).sort((a, c) => a[1] - c[1]);
  for (const size of SIZES) { const tag = size === 'full' ? 'full' : size.join('x'), mine = fresh.filter(k => k.split(' ')[2] === tag), c = counts[tag];
    ok(tag + ': ' + c.n + ' measurements in ' + c.states + ' tool states, and no failure that is not listed as expected', mine.length === 0, mine.length + ' new'); }
  for (const k of fresh) ok('new failure: ' + k, false, seen.get(k));
  for (const [k, n] of fixed) ok('expected failure now passes, delete line ' + n + ' of tests/audio-editor-layout-expected.txt: ' + k, false);
  ok('every failure listed in tests/audio-editor-layout-expected.txt still fails', fixed.length === 0, fixed.length ? fixed.length + ' now pass: delete their lines' : '');
  ok(exp.size + ' expected failures listed, ' + [...seen.keys()].filter(k => exp.has(k)).length + ' still failing', true);
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
