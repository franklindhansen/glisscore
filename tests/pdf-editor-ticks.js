// Ticks and counts in the PDF Editor: the corner tick is always visible (no hover) in Arrange and in the tick tools, left-out pages are dimmed with a crossed-eye badge, counts read "X / X".
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-ticks.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const d = await PDFDocument.create(); for (let i = 0; i < 4; i++) d.addPage([612, 792]); const f = path.join(os.tmpdir(), 'kf-ticks.pdf'); fs.writeFileSync(f, await d.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', f); await p.waitForTimeout(1500);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(600);
  const look = () => p.evaluate(() => [...document.querySelectorAll('#peGrid .page-card')].map(c => { const t = c.querySelector('.tick'), s = getComputedStyle(t), e = c.querySelector('.pe-hid'); return { op: +s.opacity, tf: s.transform, hid: !!e && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0, cv: +getComputedStyle(c.querySelector('canvas')).opacity }; }));
  const count = () => p.evaluate(() => $('#peCount').textContent);
  await p.mouse.move(5, 5);
  let l = await look();
  ok('Arrange shows every tick with no hover', l.every(x => x.op === 1 && x.tf === 'none'), JSON.stringify(l[0]));
  ok('Arrange count reads "X / X pages active"', (await count()) === '4 / 4 pages active', await count());
  await p.evaluate(() => peAct('toggle', PE.d.order[1])); await p.waitForTimeout(700); await p.mouse.move(5, 5);
  l = await look();
  ok('A left-out page is dimmed and carries the crossed-eye badge', l[1].hid && l[1].cv < 1 && !l[0].hid, JSON.stringify(l[1]));
  ok('Its tick still shows, unticked', l[1].op === 1);
  ok('Count follows', (await count()) === '3 / 4 pages active', await count());
  const modes = {}; for (const m of ['clean', 'skew', 'crop', 'split', 'wm']) { await p.evaluate(m => { peTool(m); }, m); await p.waitForTimeout(700); await p.mouse.move(5, 5); const x = await look(), c = await count(); modes[m] = { x, c }; }
  for (const m of ['clean', 'crop', 'wm']) ok(m + ': ticks show with no hover, same as Arrange', modes[m].x.filter((_, i) => i !== 1).every(t => t.op === 1 && t.tf === 'none'), JSON.stringify(modes[m].x[0]));
  ok('Tool counts read "X / X selected"', /^\d+ \/ \d+ selected$/.test(modes.clean.c), modes.clean.c);
  ok('The hidden page keeps its badge in a tool', modes.clean.x[1].hid, JSON.stringify(modes.clean.x[1]));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
