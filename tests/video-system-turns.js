// Video, System layout: the loading hold (empty page lane, no handles), the removed wipe code, a few pages found again after an edit, system turns as ticks that zoom reveals and that drag, group, push, space evenly, and go to the end like any turn, and the selector's outlines and reading-order numbers.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-turns.js
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
  await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4, null, { timeout: 60000 }); await p.waitForTimeout(1200);

  // while finding: nothing is drawn in the page lane and there are no handles
  const held = await p.evaluate(() => {
    const calls = { n: 0 }, ctx = new Proxy({}, { get: (t, k) => k === 'canvas' ? document.createElement('canvas') : (...a) => { calls.n++; }, set: () => true });
    const saved = SYS.prog; SYS.prog = { done: 1, total: 4 };
    const o = window.roundRect; window.roundRect = (...a) => { calls.n++; }; drawSysBlocks(ctx); drawHandles(ctx); window.roundRect = o; SYS.prog = saved; return calls.n;
  });
  ok('while finding the page lane and the handles draw nothing', held === 0, String(held));
  ok('the wipe, sweep, pop, and Stop code is gone', await p.evaluate(() => ['WIPE', 'sysWipeStart', 'sysWipeStep', 'wipeProg', 'sysPop', 'drawWipedThumb', 'drawSysSweep', 'sysStopRun'].every(n => typeof window[n] === 'undefined')));

  // a page edited: the same pill with the real count, then one reveal
  await p.evaluate(() => { const o = SYS.run; SYS.run = function (m, k) { const t = SYS.token; return new Promise(r => setTimeout(r, 600)).then(() => t === SYS.token ? o.call(SYS, m, k) : null); }; });
  await p.evaluate(() => { const r = recipeOf(); r.slots[1].crop = [0, 0, 1, 0.95]; setRecipe(r); rebuildSpreads(false); });
  await p.waitForTimeout(250);
  const pill = await p.evaluate(() => ({ on: document.querySelector('#sysFind').classList.contains('on'), t: document.querySelector('#sysFindT').textContent, kept: [...SYS.byPage.keys()].sort().join() }));
  ok('an edited page shows the same pill with the real count', pill.on && pill.t === 'Finding systems… 3 of 4' && pill.kept === '0,2,3', JSON.stringify(pill));
  await p.waitForFunction(() => !SYS.prog, null, { timeout: 30000 });
  ok('then the timeline comes back with one reveal', await p.evaluate(() => !!(TL.rv && TL.rv.blocks) || rvProgress('blocks') <= 1));
  await p.evaluate(() => { const o = SYS.run; SYS.run = o; }); await p.waitForTimeout(800);

  // system turns: ticks at Fit, handles when zoomed; every turn works as before
  const info = await p.evaluate(() => { const inner = []; for (let i = 0; i < S.turns.length; i++) { const t = sysTurnInfo(i); if (t && t.inner) inner.push(i); } return { inner, n: S.turns.length }; });
  ok('the score has system turns inside its pages', info.inner.length >= 4, JSON.stringify(info));
  const zoom = () => p.evaluate(() => { S.pxPerSec = Math.max(S.pxPerSec, 60); const t = S.turns[2]; TL.scroller.scrollLeft = Math.max(0, (t - tlLo()) * S.pxPerSec + TL_ROOM - 300); TL.staticDirty = TL.overlayDirty = true; });
  await zoom(); await p.waitForTimeout(400);
  const geo = i => p.evaluate(i => { const r = TL.canvas.getBoundingClientRect(); return { x: r.left + t2x(shownTurn(i)), y: r.top + TL.trackY + TL.trackH / 2 }; }, i);
  const turns = () => p.evaluate(() => ({ t: S.turns.slice(), ph: S.ph.slice(), h: S.history.length, sel: (TL.sel || []).slice() }));
  const drag = async (i, dx) => { const g = await geo(i); await p.mouse.move(g.x, g.y); await p.mouse.down(); for (let s = 1; s <= 10; s++) await p.mouse.move(g.x + dx * s / 10, g.y); await p.mouse.up(); await p.waitForTimeout(200); };
  const i0 = info.inner[0]; let t0 = await turns();
  await drag(i0, 40);
  let t1 = await turns();
  ok('dragging a system turn moves it, in one History step', t1.t[i0] > t0.t[i0] + 0.1 && t1.h === t0.h + 1, JSON.stringify([t0.t[i0], t1.t[i0], t0.h, t1.h]));
  const gap = await p.evaluate(() => minGap ? minGap() : 1).catch(() => 1);
  await drag(i0, 2000);
  let t2 = await turns();
  ok('dragging it into the next turn pushes that one along', t2.t[i0 + 1] > t1.t[i0 + 1] + 0.05 && t2.t.every((t, i) => !i || t >= t2.t[i - 1]), JSON.stringify([t1.t.slice(i0, i0 + 3), t2.t.slice(i0, i0 + 3)]));
  await p.evaluate(() => undo()); await p.evaluate(() => undo()); await p.waitForTimeout(200);
  await p.evaluate(([a, c]) => { TL.sel = [a, c]; TL.overlayDirty = true; }, [info.inner[0], info.inner[1]]);
  t0 = await turns(); await drag(info.inner[0], 30); t1 = await turns();
  ok('a group of selected system turns moves together', t1.t[info.inner[0]] > t0.t[info.inner[0]] + 0.05 && t1.t[info.inner[1]] > t0.t[info.inner[1]] + 0.05, JSON.stringify([t0.t, t1.t]));
  await p.evaluate(() => { undo(); TL.sel = []; });
  await p.click('#bSpace'); await p.waitForTimeout(400);
  const sp = await turns(); const gaps = sp.t.slice(1, -0 || undefined).map((t, i) => t - sp.t[i]);
  ok('Space turns evenly gives every stop the same share', Math.max(...gaps) - Math.min(...gaps) < 0.02, JSON.stringify(gaps));
  await p.evaluate(() => { Transport.seek(S.turns[3] + 0.5); }); await p.waitForTimeout(300);
  const before = await turns(); await p.click('#bToEnd'); await p.waitForTimeout(500); const after = await turns();
  ok('Turns to end moves the turns after the playhead, system turns included', after.t.slice(4).every((t, i) => t >= before.t[4 + i] - 1e-6) && after.ph.slice(4).some(Boolean) && Math.abs(after.t[3] - before.t[3]) < 1e-6, JSON.stringify([before.t, after.t]));
  await p.evaluate(() => undo()); await p.waitForTimeout(200);

  // the selector: outlines, the current one bright, the others faint, each numbered
  await p.evaluate(() => Transport.seek(S.vStart)); await p.waitForTimeout(700);
  const sel = await p.evaluate(() => {
    const cv = document.querySelector('#selCv'), g = SEL.geo, ctx = cv.getContext('2d'), list = SYS.byPage.get(g.idx).systems, out = [];
    const px = (x, y) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data);
    list.forEach((s, n) => {
      const top = g.oy + s.top * g.u, left = g.ox + s.left * g.pa * g.u, edge = px(left + g.pa * g.u * 0.3, top + 0.5 * g.k * 0.75);
      let blue = 0; for (let y = top; y < top + 22 * g.k; y += 2) for (let x = left - 30 * g.k; x < left + 30 * g.k; x += 2) { const q = px(x, y); if (q[2] - q[0] > 40) blue++; }
      out.push({ n, edge: Math.min(...[0, 1, 2].map(d => px(left + g.pa * g.u * 0.3, top + d)[0])), blue });
    });
    return { out, key: SEL.key, box: SEL.geo.box === list[0] };
  });
  ok('every Selection is outlined, and the current one is the brightest', sel.out.length === 3 && sel.out[0].edge < sel.out[1].edge && sel.out[0].edge < sel.out[2].edge && sel.out.every(o => o.edge < 250), JSON.stringify(sel));
  ok('every Selection carries a reading-order number badge', sel.out.every(o => o.blue > 15), JSON.stringify(sel.out));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
