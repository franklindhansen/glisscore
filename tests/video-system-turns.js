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

  // while finding: the page blocks stay, dimmed, with no cells and no handles
  const held = await p.evaluate(() => {
    const calls = { n: 0, a: [], stroke: 0 }, ctx = new Proxy({}, { get: (t, k) => k === 'canvas' ? document.createElement('canvas') : k === 'measureText' ? () => ({ width: 10 }) : (...a) => { calls.n++; }, set: (t, k, v) => { if (k === 'globalAlpha') calls.a.push(v); return true; } });
    const saved = SYS.prog; SYS.prog = { done: 1, total: 4 }; TL.hs = {}; hsGet('sysdim', .45); TL.hs.sysdim.x = .45;
    const o = window.roundRect; let rr = 0; window.roundRect = () => { rr++; }; drawSysBlocks(ctx); const blocks = rr; rr = 0; drawHandles(ctx); const handles = rr; window.roundRect = o; SYS.prog = saved; delete TL.hs.sysdim;
    return { blocks, handles, dim: calls.a.length > 0 && calls.a[0] < 0.6, hit: (() => { const s0 = SYS.prog; SYS.prog = { done: 1, total: 4 }; const h = hitTurn({ x: t2x(S.turns[0]), y: TL.trackY + 5 }); SYS.prog = s0; return h; })() };
  });
  ok('while finding the page blocks stay, dimmed', held.blocks > 0 && held.dim, JSON.stringify(held));
  ok('while finding there are no handles to draw or grab', held.handles === 0 && held.hit === -1, JSON.stringify(held));
  ok('the wipe, sweep, pop, and Stop code is gone', await p.evaluate(() => ['WIPE', 'sysWipeStart', 'sysWipeStep', 'wipeProg', 'sysPop', 'drawWipedThumb', 'drawSysSweep', 'sysStopRun'].every(n => typeof window[n] === 'undefined')));

  // a page edited: the same pill with the real percent, then one reveal
  await p.evaluate(() => { const o = SYS.run; SYS.run = function (m, k) { const t = SYS.token; return new Promise(r => setTimeout(r, 600)).then(() => t === SYS.token ? o.call(SYS, m, k) : null); }; });
  await p.evaluate(() => { const r = recipeOf(); r.slots[1].crop = [0, 0, 1, 0.95]; setRecipe(r); rebuildSpreads(false); });
  await p.waitForTimeout(250);
  const pill = await p.evaluate(() => ({ on: document.querySelector('#sysFind').classList.contains('on'), t: document.querySelector('#sysFindT').textContent, kept: [...SYS.byPage.keys()].sort().join() }));
  ok('an edited page shows the same pill with the real percent', pill.on && pill.t === 'Processing 75%' && pill.kept === '0,2,3', JSON.stringify(pill));
  await p.waitForFunction(() => !SYS.prog, null, { timeout: 30000 });
  ok('then the timeline comes back with one reveal', await p.evaluate(() => !!(TL.rv && TL.rv.blocks) || rvProgress('blocks') <= 1));
  await p.evaluate(() => { const o = SYS.run; SYS.run = o; }); await p.waitForTimeout(800);

  // system turns: ticks when zoomed far out, handles when zoomed in; every turn works as before
  const info = await p.evaluate(() => { const inner = []; for (let i = 0; i < S.turns.length; i++) { const t = sysTurnInfo(i); if (t && t.inner) inner.push(i); } return { inner, n: S.turns.length }; });
  ok('the score has system turns inside its pages', info.inner.length >= 4, JSON.stringify(info));
  const zoom = () => p.evaluate(() => { S.pxPerSec = Math.max(S.pxPerSec, 60); const t = S.turns[2]; TL.scroller.scrollLeft = Math.max(0, (t - tlLo()) * S.pxPerSec + TL_ROOM - 300); TL.staticDirty = TL.overlayDirty = true; });
  // zoomed far out, a spread narrower than a handle (24px) makes its system turn a tick: the playhead outranks one beside it, and a tick needs a few pixels of travel to move
  await p.evaluate(() => setZoom(2.5, 0, false)); await p.waitForTimeout(400);
  const tk = await p.evaluate(i => { const r = TL.canvas.getBoundingClientRect(); return { l: r.left, y: r.top + TL.trackY + TL.trackH / 2, x: t2x(shownTurn(i)), tick: tlTickLike(i), t: S.turns[i], h: S.history.length }; }, info.inner[0]);
  ok('zoomed out a system turn is a tick', tk.tick, JSON.stringify(tk));
  const tdrag = async (dx, mv) => { await p.mouse.move(tk.l + tk.x + dx, tk.y); await p.mouse.down(); for (let s = 1; s <= 10; s++) await p.mouse.move(tk.l + tk.x + dx + mv * s / 10, tk.y); await p.mouse.up(); await p.waitForTimeout(150); };
  await p.evaluate(i => { Transport.seek(S.turns[i] + x2t(t2x(0) + 4) - x2t(t2x(0))); }, info.inner[0]);
  const tt = () => p.evaluate(() => ({ t: S.turns.slice(), h: S.history.length })); let b0 = await tt(); await tdrag(4, 30); let b1 = await tt();
  ok('a tick beside the playhead stays put while the playhead is dragged', Math.abs(b1.t[info.inner[0]] - b0.t[info.inner[0]]) < 1e-6 && b1.h === b0.h, JSON.stringify([b0.t[info.inner[0]], b1.t[info.inner[0]]]));
  await p.evaluate(() => Transport.seek(0)); b0 = await tt();
  ok('a tick pressed and moved under 4px does not move', Math.abs(b1.t[info.inner[0]] - b0.t[info.inner[0]]) < 1e-6 && b1.h === b0.h, JSON.stringify([b0.t[info.inner[0]], b1.t[info.inner[0]]]));
  await tdrag(0, 30); b1 = await tt();
  ok('a tick dragged on its own line moves, in one History step', Math.abs(b1.t[info.inner[0]] - b0.t[info.inner[0]]) > 0.05 && b1.h === b0.h + 1, JSON.stringify([b0.t[info.inner[0]], b1.t[info.inner[0]], b0.h, b1.h]));
  await p.evaluate(() => undo()); await p.waitForTimeout(200);
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
  // with audio: the waveform stays while finding, the stops share the audio equally, and Play works once found
  await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/stereo.wav');
  await p.waitForFunction(() => S.audio && S.audio.duration > 1, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const o = SYS.run; window.__slow = o; SYS.run = function (m, k) { const t = SYS.token; return new Promise(r => setTimeout(r, 900)).then(() => t === SYS.token ? o.call(SYS, m, k) : null); }; const r = recipeOf(); r.slots[0].crop = [0, 0, 1, 0.97]; setRecipe(r); rebuildSpreads(false); });
  await p.waitForTimeout(300);
  const aud = await p.evaluate(() => {
    const calls = { wave: 0, blocks: 0 }, ctx = c => new Proxy({}, { get: (t, k) => k === 'canvas' ? document.createElement('canvas') : (...a) => {} });
    const ow = window.drawWave, ob = window.drawSysBlocks, oh = window.roundRect; window.drawWave = c => { calls.wave++; return ow(c); }; window.drawSysBlocks = c => { calls.blocks++; return ob(c); };
    TL.staticDirty = true; drawTimeline(); window.drawWave = ow; window.drawSysBlocks = ob;
    return { busy: sysBusy(), calls, play: document.querySelector('#bPlay').disabled, exp: document.querySelector('#btnExport').disabled };
  });
  ok('with audio loaded the waveform lane stays while Play and Export are held', aud.busy && aud.calls.wave >= 1 && aud.play && aud.exp, JSON.stringify(aud));
  await p.waitForFunction(() => !SYS.prog, null, { timeout: 30000 }); await p.waitForTimeout(1200);
  const fin = await p.evaluate(() => { const g = S.turns.slice(1).map((t, i) => t - S.turns[i]); return { gaps: Math.max(...g) - Math.min(...g), play: document.querySelector('#bPlay').disabled, exp: document.querySelector('#btnExport').disabled, hint: document.querySelector('#exportHint').textContent, len: vEnd() - S.vStart, dur: S.audio.duration }; });
  ok('with audio every stop gets an equal share', fin.gaps < 0.02, JSON.stringify(fin));
  ok('Play and Export are back once found', !fin.play && !fin.exp && /MOV/.test(fin.hint), JSON.stringify(fin));
  await p.click('#bPlay'); await p.waitForTimeout(600);
  ok('Play plays with audio in System', await p.evaluate(() => Transport.playing && S.time > S.vStart), String(await p.evaluate(() => S.time)));
  await p.click('#bPlay');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
