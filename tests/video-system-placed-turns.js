// Video, System layout: turns placed by hand stay put. A PDF Editor edit, undo, and redo of it keep every placed turn (a page found again keeps its turns by order, or by overlap when its number of systems changed, and only new stops are spaced, inside the page's own block); Full page holds a page's turns and brings them back, as one History step each way, saved with the project; Spread and Single page are unchanged.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-placed-turns.js
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
const same = (a, b, e = 1e-6) => a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < e);
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); staffPage(doc, 1); staffPage(doc, 3);           // 9 systems on 4 pages
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const layout = async v => { await p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v); };
  const found = n => p.waitForFunction(n => !SYS.prog && !SYS.job && SYS.byPage.size === n, n, { timeout: 60000 }).then(() => p.waitForTimeout(700));
  await layout('system'); await found(4);
  const st = () => p.evaluate(() => ({ t: S.turns.slice(), ph: S.ph.slice(), e: S.turnsEdited, n: S.spreads.length, h: S.history.length, hold: !!SYS.hold }));
  const place = () => p.evaluate(() => { S.turns = S.turns.map((t, i) => t + (i % 2 ? 0.37 : -0.21)); S.ph = S.ph.map(() => false); S.turnsEdited = true; normalizeTurns(); onTurnsChanged(); });
  const edit = (page, crop) => p.evaluate(([pg, c]) => { pushHistory(); const r = recipeOf(); r.slots[pg].crop = c; setRecipe(r); rebuildSpreads(false); }, [page, crop]);
  const nSys = i => p.evaluate(i => SYS.byPage.get(i).systems.length, i);

  await place(); const T0 = await st();
  ok('nine stops and eight placed turns to start', T0.n === 9 && T0.t.length === 8 && T0.e, JSON.stringify(T0));

  // an edit of page 4 that keeps its three systems: every placed turn stays, the pages not edited exactly
  await edit(3, [0, 0, 1, 0.98]); await p.waitForTimeout(200);
  const mid = await st();
  ok('while page 4 is found again the placed turns are not spaced evenly', mid.e && same(mid.t.slice(0, 6), T0.t.slice(0, 6)), JSON.stringify([T0.t, mid.t]));
  await found(4);
  let A = await st();
  ok('after finding, every placed turn is where it was (same system count)', same(A.t, T0.t) && A.e && A.n === 9 && !A.hold, JSON.stringify([T0.t, A.t]));

  // undo and redo of the edit
  await p.evaluate(() => undo()); await p.waitForTimeout(300); await found(4);
  A = await st(); ok('undo of the edit keeps the placed turns', same(A.t, T0.t) && A.e, JSON.stringify([T0.t, A.t]));
  await p.evaluate(() => redo()); await p.waitForTimeout(300); await found(4);
  A = await st(); ok('redo of the edit keeps the placed turns', same(A.t, T0.t) && A.e, JSON.stringify([T0.t, A.t]));
  await p.evaluate(() => { undo(); }); await p.waitForTimeout(300); await found(4);

  // an edit that changes the number of systems (the finder is made to leave out page 1's last system, as a crop that trims it would): the first two keep their turns, the rest of the video does not move
  await p.evaluate(() => { const o = SYS.run; window.__drop = 0; SYS.run = function (m, k) { return o.call(SYS, m, k).then(r => r && window.__drop && r.systems && r.systems.length > 2 ? Object.assign({}, r, { systems: r.systems.slice(0, 2) }) : r); }; });
  await p.evaluate(() => { window.__drop = 1; }); await edit(0, [0, 0, 1, 0.62]); await found(4);
  A = await st(); const n1 = await nSys(0);
  ok('page 1 now has two systems', n1 === 2 && A.n === 8, n1 + ' systems, ' + A.n + ' stops');
  ok('a page with fewer systems keeps the turn of the one that stays, and the other pages keep theirs', A.e && A.t.length === 7 && Math.abs(A.t[0] - T0.t[0]) < 1e-6 && same(A.t.slice(1), T0.t.slice(2)), JSON.stringify([T0.t, A.t]));
  // and back: the new third system is spaced inside page 1's own block only
  const T1 = A.t; await p.evaluate(() => { window.__drop = 0; }); await edit(0, null); await found(4);
  A = await st(); const n2 = await nSys(0);
  ok('page 1 has three systems again', n2 === 3 && A.n === 9, n2 + ' systems');
  ok('the new stop is spaced inside the block, every other turn stays', A.e && A.t.length === 8 && Math.abs(A.t[0] - T1[0]) < 1e-6 && A.t[1] > T1[0] + 0.05 && A.t[1] < T1[1] - 0.05 && same(A.t.slice(2), T1.slice(1)), JSON.stringify([T1, A.t]));

  // Full page holds a page's turns, and Systems brings them back
  await place(); const T2 = await st(); const hFull0 = T2.h;
  await p.evaluate(() => sysSetFull(0, true)); await p.waitForTimeout(300);
  let F = await st();
  ok('Full page makes page 1 one stop, and the other pages keep their turns', F.n === 7 && F.t.length === 6 && same(F.t, T2.t.slice(2)) && F.h === hFull0 + 1, JSON.stringify([T2.t, F.t, F.h]));
  // the next page's turn is moved in between (later: the held ones still fit)
  await p.evaluate(() => { S.turns[0] += 0.4; normalizeTurns(); onTurnsChanged(); });
  await p.evaluate(() => sysSetFull(0, false)); await p.waitForTimeout(300);
  F = await st();
  ok('Systems brings the page back with its turns where they were, and the next block moved', F.n === 9 && F.t.length === 8 && same(F.t.slice(0, 2), T2.t.slice(0, 2)) && Math.abs(F.t[2] - (T2.t[2] + 0.4)) < 1e-6, JSON.stringify([T2.t, F.t]));
  // moved earlier than they fit: scaled to fit, in order, never closer than the least gap
  await p.evaluate(() => sysSetFull(0, true)); await p.waitForTimeout(300);
  const E = await p.evaluate(() => { const hold = SYS.byPage.get(0).heldTurns; const lo = S.vStart + refOffset(); S.turns[0] = lo + (hold[hold.length - 1].t) * 0.5; normalizeTurns(); onTurnsChanged(); return { next: S.turns[0], lo, gap: turnGap() }; });
  await p.evaluate(() => sysSetFull(0, false)); await p.waitForTimeout(300);
  F = await st();
  ok('turns that no longer fit are scaled in order, never closer than the least gap', F.n === 9 && F.t[1] < F.t[2] && F.t[0] >= E.lo - 1e-6 && F.t.slice(1, 3).every((t, i) => t - F.t[i] >= E.gap - 1e-6) && F.t[1] < E.next + 1e-6, JSON.stringify([E, F.t]));
  // one History step each way
  await p.evaluate(() => sysSetFull(0, true)); await p.waitForTimeout(300);
  const FH = await st(); await p.evaluate(() => undo()); await p.waitForTimeout(300);
  const U = await st();
  ok('undo of Full page brings the turns back, one step', U.n === 9 && same(U.t, F.t) && U.h === FH.h - 1, JSON.stringify([F.t, U.t, FH.h, U.h]));
  await p.evaluate(() => redo()); await p.waitForTimeout(300); await p.evaluate(() => undo()); await p.waitForTimeout(300);
  // saved with the held Selections
  await p.evaluate(() => sysSetFull(0, true)); await p.waitForTimeout(300);
  const sv = await p.evaluate(() => { const l = sysToList(), c = sysListClean(JSON.parse(JSON.stringify(l)), 4), held = SYS.byPage.get(0).heldTurns; return { saved: l[0].ht, cleaned: c && c[0].ht, held }; });
  ok('the held turns are saved with the held Selections and read back clean', sv.saved && sv.saved.length === 2 && JSON.stringify(sv.cleaned) === JSON.stringify(sv.saved), JSON.stringify(sv));
  const rl = await p.evaluate(() => { const l = sysListClean(JSON.parse(JSON.stringify(sysToList())), 4); sysFromList(l); return SYS.byPage.get(0).heldTurns; });
  ok('a saved project brings them back', rl && rl.length === 2, JSON.stringify(rl));
  await p.evaluate(() => sysSetFull(0, false)); await p.waitForTimeout(300);
  ok('a file with no held turns loads as before', await p.evaluate(() => { const l = sysListClean([{ p: 1, t: 0, s: [[0.1, 0.2, 0, 1]], f: 1, h: [[0.1, 0.2, 0, 1]] }], 4); return l && !l[0].ht; }));

  // Spread and Single page are unchanged: a Page layout change still spaces evenly, and no turns are held
  await layout('spread'); await p.waitForTimeout(400);
  const SP = await st();
  ok('Spread spaces the turns evenly again, with nothing held', !SP.e && !SP.hold && SP.t.length === Math.max(0, SP.n - 1), JSON.stringify(SP));
  await p.evaluate(() => { S.turns = S.turns.map(t => t + 0.2); S.turnsEdited = true; normalizeTurns(); });
  const SP0 = await st(); await edit(3, [0, 0, 1, 0.97]); await p.waitForTimeout(500); const SP1 = await st();
  ok('an edit in Spread leaves the placed turns, as before', SP1.e && same(SP1.t, SP0.t) && !SP1.hold, JSON.stringify([SP0.t, SP1.t]));
  await layout('single'); await p.waitForTimeout(400);
  const SG = await st();
  ok('Single page spaces the turns evenly, with nothing held', !SG.e && !SG.hold && SG.t.length === SG.n - 1, JSON.stringify(SG));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
