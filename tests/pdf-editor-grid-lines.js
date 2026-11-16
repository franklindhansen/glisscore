// The layout lines of the PDF Editor's tools that stand on the shared card, heading bar, and tool grid (all eight): the same rules as the Audio Editor's tool windows (tests/lib/layout-lines.js),
// read from the page at every size and in every state that changes one of the tool's cards. A tool is added to TOOLS when it moves onto the shared blocks.
// Failures that are not fixed yet are kept in tests/pdf-editor-layout-expected.txt, one line each, "tool state size rule element  # what was measured". The list may only shrink.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-grid-lines.js   (through tests/run-all.sh)
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const { install } = require('./lib/measure.js'), { lines } = require('./lib/layout-lines.js'), { fitMeasure } = require('./lib/fit-measure.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const EXPECTED = path.join(__dirname, 'pdf-editor-layout-expected.txt');
const SEL = { pane: '.pe-tv:not([hidden])', card: '.ae-card', head: '.pe-phead', body: '.pe-top', line: '.pe-tv:not([hidden]) .pe-phead, .pe-tv:not([hidden]) .pe-row, .pe-tv:not([hidden]) .pe-cards'  /* the line is the head's; with the head gone (nothing to say, in the narrow layout), the first row's, or the cards' own box */ };
const SIZES = [[1440, 900], [1040, 760], [900, 760], [761, 800], [700, 800], [600, 800], [521, 800], [390, 800], [360, 800]];
const TOOLS = { pages: [['insert', null]], clean: [['choices', null]], skew: [['lone', null]], crop: [['auto', null], ['manual', () => { const r = document.querySelector('input[name=peCropMode][value=hand]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }]], dim: [['plain', null]], split: [['lone', null]], resize: [['sizes', null], ['custom', () => document.querySelector('#peRzGrid .rz-opt[data-k=custom]').click()]], wm: [['cards', null], ['custom', () => document.querySelector('input[name=peWmAngle][value=custom]').click()]] };
const data = f => { try { return fs.readFileSync(f, 'utf8').split('\n'); } catch (e) { return []; } };
const rows = f => data(f).map((l, i) => [l.replace(/\s+#.*$/, '').trim(), i + 1]).filter(([t]) => t && t[0] !== '#');
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 3; i++) doc.addPage([612, 792]); const file = path.join(os.tmpdir(), 'kf-grid-lines.pdf'); fs.writeFileSync(file, await doc.save());
  const b = await chromium.launch(), errs = [], seen = new Map(), counts = {};
  const queue = [...SIZES], one = async ([w, h]) => {
    const tag = w + 'x' + h, main = w === 1440 && h === 900, p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push(tag + ': ' + e.message); });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(500);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(400); await p.evaluate(install);
    counts[tag] = { states: 0, n: 0 };
    for (const [tool, states] of Object.entries(TOOLS)) {
      await p.evaluate(t => peTool(t), tool); await p.waitForTimeout(900);
      for (const [state, go] of states) {
        if (go) { await p.evaluate('(' + go + ')()'); await p.waitForTimeout(500); }
        const m = await p.evaluate(lines, { main, sel: SEL }), fit = await p.evaluate(fitMeasure, { card: SEL.card, body: SEL.body, root: SEL.pane }), at = tool + ' ' + state + ' ' + tag + ' ';
        counts[tag].states++; counts[tag].n += m.n;
        if (!m.n) seen.set(at + 'measured nothing', 'no card was found in the tool');
        for (const [rule, el, note] of m.fails) seen.set(at + rule + ' ' + el, note);
        for (const x of fit.pass) { const [el, rest] = x.split(' (')[0].split(' > '); seen.set(at + 'clipped ' + el + '>' + (rest || '').replace(/ /g, '.'), x); }
      } }
    await p.close();
  };
  await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); }));
  const exp = new Map(rows(EXPECTED)), fresh = [...seen.keys()].filter(k => !exp.has(k)).sort(), fixed = [...exp].filter(([k]) => !seen.has(k)).sort((a, c) => a[1] - c[1]);
  for (const size of SIZES) { const tag = size.join('x'), mine = fresh.filter(k => k.split(' ')[2] === tag), c = counts[tag]; ok(tag + ': ' + c.n + ' measurements in ' + c.states + ' tool states, and no failure that is not listed as expected', mine.length === 0, mine.length + ' new'); }
  for (const k of fresh) ok('new failure: ' + k, false, seen.get(k));
  for (const [k, n] of fixed) ok('expected failure now passes, delete line ' + n + ' of tests/pdf-editor-layout-expected.txt: ' + k, false);
  ok('every failure listed in tests/pdf-editor-layout-expected.txt still fails', fixed.length === 0);
  ok(exp.size + ' expected failures listed, ' + [...seen.keys()].filter(k => exp.has(k)).length + ' still failing', true);
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
