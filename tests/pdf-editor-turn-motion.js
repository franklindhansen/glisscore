// PDF Editor, turning a page (Rotate on a card): the card's tool bar (Open, Rotate, Repeat) stays put through the turn and after it,
// the turning picture stays inside its own card (it never lands on the next card), and the turn starts from the page's old shape.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-turn-motion.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf(name, n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) { const pg = doc.addPage([612, 792]); for (let y = 700; y > 100; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 80, y: y - k * 7 }, end: { x: 530, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await doc.save()); return f;
}
(async () => {
  const A = await makePdf('kf-turn-motion.pdf', 8);
  const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', A); await p.waitForFunction(() => S.pdf && S.pdf.n === 8); await p.waitForTimeout(1500);
  await p.evaluate(() => openPdfEditor()); await p.waitForFunction(() => document.querySelectorAll('#peGrid .page-card:not(.loading)').length === 8); await p.waitForTimeout(800);

  const card = '#peGrid .page-card[data-id="0"]';
  await p.hover(card); await p.waitForTimeout(500);
  const rest = await p.evaluate(sel => { const c = document.querySelector(sel), r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }; return { card: r(c), canvas: r(c.querySelector('canvas')), tools: r(c.querySelector('.pe-tools')), next: r(document.querySelector('#peGrid .page-card[data-id="1"] canvas')) }; }, card);

  // sample every frame of the turn: the card's own rectangles, the bar and the neighbour
  await p.evaluate(sel => { window.__s = []; window.__go = true; const r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const f = t => { const c = document.querySelector(sel); window.__s.push({ t: performance.now(), card: r(c), canvas: r(c.querySelector('canvas')), tools: r(c.querySelector('.pe-tools')), next: r(document.querySelector('#peGrid .page-card[data-id="1"] canvas')) }); if (window.__go) requestAnimationFrame(f); }; f(); }, card);
  await p.evaluate(() => { window.__clickAt = performance.now(); });
  await p.click(card + ' [data-act="rot"]');
  await p.waitForTimeout(900);
  await p.evaluate(() => { window.__go = false; });
  const s = await p.evaluate(() => window.__s);
  const after = s[s.length - 1];
  const near = (a, b, tol) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;

  // 1. the tool bar does not move, during the turn or after it
  const barMoved = Math.max(...s.map(f => Math.max(Math.abs(f.tools.x - rest.tools.x), Math.abs(f.tools.y - rest.tools.y))));
  ok('The tool bar stays where it is through the turn', barMoved <= 1, 'largest move ' + barMoved.toFixed(1) + 'px; bar at ' + rest.tools.x.toFixed(0) + ',' + rest.tools.y.toFixed(0) + ' then ' + after.tools.x.toFixed(0) + ',' + after.tools.y.toFixed(0));

  // 2. the turning picture stays in its own card's column: no frame where it spills onto the next card
  const spill = Math.max(...s.map(f => Math.max(f.canvas.x + f.canvas.w - (f.card.x + f.card.w), f.card.x - f.canvas.x, 0)));
  const hits = s.filter(f => f.canvas.x + f.canvas.w > f.next.x + 0.5).length;
  ok('The turning picture stays inside its card', spill <= 1 && hits === 0, 'widest spill ' + spill.toFixed(1) + 'px; frames touching the next card ' + hits + ' of ' + s.length);

  // 3. the turn starts from the page as it was (same box), and ends as the turned page (landscape, in the card)
  const first = s[0];
  ok('The turn starts from the page\'s old shape', near(first.canvas, rest.canvas, 3), 'rest ' + JSON.stringify(rest.canvas) + ' first frame ' + JSON.stringify(first.canvas));
  ok('The turned page ends landscape inside its card', after.canvas.w > after.canvas.h && after.canvas.x >= after.card.x - 1 && after.canvas.x + after.canvas.w <= after.card.x + after.card.w + 1, JSON.stringify(after.canvas));

  // 4. the next card does not move
  const nextMoved = Math.max(...s.map(f => Math.max(Math.abs(f.next.x - rest.next.x), Math.abs(f.next.y - rest.next.y))));
  ok('The next card does not move', nextMoved <= 1, 'largest move ' + nextMoved.toFixed(1) + 'px');

  // 5. the picture snaps: it reaches its final place within 300ms of the click, and nothing moves after that (no settling tail)
  const clickAt = await p.evaluate(() => window.__clickAt);
  const same = (a, b) => Math.abs(a.x - b.x) <= .5 && Math.abs(a.y - b.y) <= .5 && Math.abs(a.w - b.w) <= .5 && Math.abs(a.h - b.h) <= .5;
  let settle = s.length - 1; while (settle > 0 && same(s[settle - 1].canvas, after.canvas) && same(s[settle - 1].card, after.card)) settle--;
  const settledAt = s[settle].t - clickAt;
  const movedFirst = s.findIndex(f => !same(f.canvas, rest.canvas) || !same(f.card, rest.card)), startedAt = s[Math.max(0, movedFirst)].t - clickAt;
  ok('The turn snaps into place within 350ms, with no settling after', settledAt <= 350 && settledAt > 0, 'starts ' + Math.round(startedAt) + 'ms, final place reached at ' + Math.round(settledAt) + 'ms after the click');

  ok('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL script — ' + e.message); process.exit(1); });
