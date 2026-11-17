// Video, System layout: the timeline follows the systems (one block and one turn each), switching layouts is one History step, and Start/End credits.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-timeline.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
const lum = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
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
  const blk = await p.evaluate(() => sysBlocks().map(q => ({ page: q.page, n: q.n, w: q.b - q.a })));
  ok('the timeline holds one block per page, then one for the credits', blk.length === 5 && JSON.stringify(blk.slice(0, 4).map(q => q.n)) === '[3,2,1,3]' && blk[4].page === null && blk[4].n === 1, JSON.stringify(blk));
  ok('a block is as wide as its number of systems', Math.abs(blk[1].w / blk[2].w - 2) < 0.15, JSON.stringify(blk.map(q => q.w)));
  const kinds = await p.evaluate(() => S.turns.map((_, i) => sysTurnInfo(i).inner));
  ok('the turns inside a page are system turns, the others page turns, and none follows the last system', kinds.filter(Boolean).length === 5 && kinds.length === 9 && kinds.slice(-1)[0] === false && await p.evaluate(() => sysTurnInfo(S.turns.length) === null), JSON.stringify(kinds));
  // a system turn is a tick until its cell is wide enough, or it is hovered
  const hs = await p.evaluate(() => {
    const vw0 = TL.vw, pps0 = S.pxPerSec, n = pps => { S.pxPerSec = pps; TL.vw = 1e7; TL.hover = -1; const o = window.roundRect; let c = 0; window.roundRect = (...a) => { c++; return o(...a); }; try { drawHandles(document.createElement('canvas').getContext('2d')); } finally { window.roundRect = o; TL.vw = vw0; S.pxPerSec = pps0; } return c; };
    const small = n(1), big = n(400); return { small, big, sys: S.spreads.filter((s, i) => sysTurnInfo(i) && sysTurnInfo(i).inner).length };
  });
  ok('system turns draw no handle at a narrow zoom and show them zoomed in', hs.big > hs.small, JSON.stringify(hs));
  ok('the skinny handle can be grabbed as easily as the page handle', await p.evaluate(() => { const i = sysTurnInfo(0).inner ? 0 : -1, x = t2x(shownTurn(i)), y = TL.trackY + TL.trackH / 2; return i === 0 && hitTurn({ x: x + 6, y }) === 0 && hitTurn({ x: x - 6, y }) === 0; }));
  ok('every page and system is drawn, with the playhead in a cell, without errors', await p.evaluate(() => { S.time = (S.spreads.length ? spreadBounds(1)[0] + 0.1 : 0); TL.staticDirty = true; drawTimeline(); return true; }) && errs.length === 0, errs.join('; '));
  const css = require('fs').readFileSync(__dirname + '/../style.css', 'utf8');
  ok('--turn-sys is in all three theme blocks, and a system turn has no band color', (css.match(/--turn-sys:/g) || []).length === 3 && !css.includes('--turn-sys-soft') && css.includes('--turn-sys:#8690a6'));
  ok('the page and system handles pass 3:1 against the block in both themes', [['#d97706', '#ffffff'], ['#bf6500', '#ffffff'], ['#f59e3b', '#252b37'], ['#d97706', '#252b37']].every(([f, g]) => contrast(f, g) >= 3), [contrast('#d97706', '#ffffff'), contrast('#bf6500', '#ffffff'), contrast('#f59e3b', '#252b37'), contrast('#d97706', '#252b37')].map(v => v.toFixed(2)).join(' '));
  const keep = await p.evaluate(async () => {
    const R = window.__keyframes.previewR; S.time = S.vStart; drawStage(); await R.ensure([S.spreads[0][1]]);
    const idx = S.spreads[0][1], before = R.tex.get(idx) && R.tex.get(idx).t; if (!before) return { none: true };
    S.set.margin = S.set.margin + 2; R.checkSize(R.layout());
    return { same: R.tex_(idx) === before, gone: !R.tex.has(idx), notReady: R.notReady.has(idx) };
  });
  ok('moving the margin keeps showing the old sheet until the new one arrives', keep.same && keep.gone && keep.notReady, JSON.stringify(keep));
  const live = await p.evaluate(async () => {
    const R = window.__keyframes.previewR, idx = S.spreads[0][1], o = window.sysSheet; let calls = 0, now = 0, max = 0; window.sysSheet = (...a) => { calls++; max = Math.max(max, ++now); return o(...a).finally(() => now--); };
    for (let i = 0; i < 8; i++) { S.set.margin = 3 + i % 4; R.prefetch([idx]); R.checkSize(R.layout()); await new Promise(r => setTimeout(r, 15)); }
    S.set.margin = 6; await R.ensure([idx]); window.sysSheet = o;
    return { has: R.tex.has(idx), key: R.sizeKey.includes('6,false,'), max };
  });
  ok('dragging the margin keeps up with one render at a time per page, and ends on the final margin', live.has && live.key && live.max === 1, JSON.stringify(live));
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
  // a cover
  const cov = await PDFDocument.create(); cov.addPage([PW, PH]); staffPage(cov, 1); staffPage(cov, 1); const cb = Buffer.from(await cov.save());
  await p.evaluate(() => { S.set.creditsOn = false; }); await p.setInputFiles('#pdfIn', { name: 'cover.pdf', mimeType: 'application/pdf', buffer: cb });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 3, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
  const cv = await p.evaluate(() => sysBlocks().map(q => ({ n: q.n, w: q.b - q.a })));
  ok('a page with no systems gets the same share as one system', cv.length === 3 && cv[0].n === 1 && Math.abs(cv[0].w / cv[1].w - 1) < 0.15, JSON.stringify(cv));
  ok('the turns stay in order', await p.evaluate(() => S.turns.every((t, i) => !i || t > S.turns[i - 1]) && S.turns.length === 2));
  const lab = await p.evaluate(() => { const o = []; for (let i = 0; i < S.spreads.length; i++) o.push(infoParts(i, S.spreads.length).map(q => q[1]).join('')); return o; });
  ok('the label reads System N / M · p. N, and Page 1 / 3 on a page with no systems', lab[0] === 'Page 1 / 3' && /^System 2 \/ 3 · p\. 2$/.test(lab[1]), JSON.stringify(lab));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
