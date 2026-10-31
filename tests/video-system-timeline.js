// Video, System layout: the timeline follows the systems (one block and one turn each), switching layouts is one History step, and Start/End credits.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-timeline.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function staffPage(doc, n) {
  const page = doc.addPage([PW, PH]);
  for (let k = 0; k < n; k++) {
    const y = 110 + k * 250;
    for (const off of [0, 62]) for (let j = 0; j < 5; j++) page.drawLine({ start: { x: 50, y: PH - (y + off + j * 7) }, end: { x: 545, y: PH - (y + off + j * 7) }, thickness: 0.7 });
    [50, 300, 545].forEach(x => page.drawLine({ start: { x, y: PH - y }, end: { x, y: PH - (y + 62 + 28) }, thickness: 0.9 }));
    for (let q = 0; q < 8; q++) page.drawEllipse({ x: 70 + q * 60, y: PH - (y + (q % 5) * 7), xScale: 4, yScale: 3 });
  }
}
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); staffPage(doc, 1); staffPage(doc, 3);           // 9 systems on 4 pages
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const pick = (name, v) => p.evaluate(([name, v]) => { const r = document.querySelector('input[name=' + name + '][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, [name, v]);
  const st = () => p.evaluate(() => ({ n: S.spreads.length, t: S.turns.length, lay: S.set.pageLayout, at: S.set.creditsAt, keys: S.spreads.map(s => s[1]), card: S.spreads.map(s => s[1] === CARD ? (s.startCredits ? 's' : s.credits ? 'e' : '?') : '.').join('') }));
  const toast = () => p.evaluate(() => { const t = document.querySelector('#toast'); return t.classList.contains('show') ? t.textContent : ''; });
  await p.evaluate(() => { S.set.creditsOn = true; S.credits.title = 'Piece'; S.credits.titleEdited = true; syncCredits(); });
  await p.evaluate(() => { S.turns = S.turns.map(t => t); S.turnsEdited = true; });
  const before = await st();
  await pick('pageLayout', 'system'); await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
  let s = await st();
  ok('System gives one entry per system and one for the end credits', s.lay === 'system' && s.n === 10 && s.card[9] === 'e', JSON.stringify(s));
  ok('the turn count follows the systems', s.t === 9, String(s.t));
  ok('entries run in reading order', JSON.stringify(s.keys.slice(0, 9).map(k => [k % 100000, Math.floor(k / 100000)])) === JSON.stringify([[0,0],[0,1],[0,2],[1,0],[1,1],[2,0],[3,0],[3,1],[3,2]].map(a => [a[0], a[1]])), JSON.stringify(s.keys));
  ok('turns are spaced evenly and the hand edit is said', await p.evaluate(() => { const g = S.turns.slice(1, -1).map((t, i) => t - S.turns[i]); return Math.max(...g) - Math.min(...g) < 0.05 && !S.turnsEdited; }) && /turns/i.test(await toast()), await toast());
  await p.evaluate(() => document.querySelector('#bUndo').click()); await p.waitForTimeout(600);
  s = await st();
  ok('one Undo restores the layout and the turns', s.lay === 'spread' && s.n === before.n && s.t === before.t, JSON.stringify([s.lay, s.n, s.t]));
  await p.evaluate(() => document.querySelector('#bRedo').click()); await p.waitForTimeout(600);
  // Start
  await pick('creditsAt', 'start'); await p.waitForTimeout(500); s = await st();
  ok('Start in System is a centered card before the first system', s.at === 'start' && s.n === 10 && s.card[0] === 's' && s.t === 9 && s.keys[0] === -2, JSON.stringify(s));
  ok('Start has no teal marker', await p.evaluate(() => !creditsAtEnd() && !creditsEarlyOn()));
  ok('the card shows from the first frame until the first turn, which then covers it', await p.evaluate(() => { const a = frameState(S.vStart), b = frameState(S.turns[0] - refOffset() - 0.01), c = frameState(S.turns[0] - refOffset() + flipDur() + 0.01); return a.spread === 0 && a.flip == null && b.spread === 0 && b.flip == null && c.spread === 1 && c.flip == null; }));
  ok('playing and scrubbing land on each system in order, like spreads', await p.evaluate(() => S.spreads.every((sp, i) => { const t = i === 0 ? S.vStart : S.turns[i - 1] - refOffset() + flipDur() + 0.01, f = frameState(t), mid = i === 0 ? null : frameState(S.turns[i - 1] - refOffset() + flipDur() / 2); return f.spread === i && f.flip == null && (!mid || (mid.spread === i - 1 && mid.flip > 0 && mid.flip < 1)); })));
  await p.evaluate(() => { const r = document.querySelector('input[name=creditsAt][value=end]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(500); s = await st();
  ok('back to End: the card is last again with the same turn count', s.card[9] === 'e' && s.card[0] === '.' && s.t === 9, JSON.stringify(s));
  await pick('creditsAt', 'start'); await p.waitForTimeout(400);
  await pick('pageLayout', 'single'); await p.waitForTimeout(600); s = await st();
  ok('System to Single page with Start moves the credits to End with the toast', s.at === 'end' && s.lay === 'single' && s.n === 5 && /Credits moved to the end\. Start requires Spread layout\./.test(await toast()), JSON.stringify(s) + await toast());
  // one system
  const one = await PDFDocument.create(); staffPage(one, 1); const ob = Buffer.from(await one.save());
  await p.setInputFiles('#pdfIn', { name: 'one.pdf', mimeType: 'application/pdf', buffer: ob }); await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 1, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { S.set.creditsOn = true; S.credits.title = 'Piece'; S.credits.titleEdited = true; S.set.creditsAt = 'start'; }); await pick('pageLayout', 'system'); await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1200); s = await st();
  ok('Start works with one system', s.at === 'start' && s.n === 2 && s.t === 1 && s.card === 's.', JSON.stringify(s));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
