// Video editor: shift-click toggles a page turn in a selection; a box dragged across the track selects the turns inside it; dragging a selected handle moves the group rigidly and pushes the turns outside it; the group stops at the ends of the video; one undo restores the drag; clicking empty track clears the selection; a plain drag on one turn is unchanged.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-turn-select.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 16; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-turn-select.pdf'); fs.writeFileSync(pdf, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf);
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const near = (a, b) => Math.abs(a - b) < 0.02;
  const nearAll = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));
  const read = () => p.evaluate(K => { const k = window[K]; return { turns: k.S.turns.slice(), ph: k.S.ph.slice(), sel: (k.TL.sel || []).slice().sort((a, b) => a - b), vs: k.S.vStart, ve: k.vEnd(), n: k.S.history.length }; }, K);
  const setup = (turns, ph) => p.evaluate(([K, turns, ph]) => { const k = window[K]; k.S.turns = turns.slice(); k.S.ph = ph.slice(); k.S.history.length = 0; k.TL.sel = []; k.onTurnsChanged(); }, [K, turns, ph]);
  const geo = t => p.evaluate(([K, t]) => { const k = window[K], r = k.TL.canvas.getBoundingClientRect(); return { x: r.left + k.t2x(t), y: r.top + k.TL.trackY + k.TL.trackH / 2 }; }, [K, t]);
  const click = async (t, shift) => { const g = await geo(t); if (shift) await p.keyboard.down('Shift'); await p.mouse.click(g.x, g.y); if (shift) await p.keyboard.up('Shift'); };
  const drag = async (t0, t1) => {
    const a = await geo(t0), z = await geo(t1);
    await p.mouse.move(a.x, a.y); await p.mouse.down();
    for (let s = 1; s <= 12; s++) await p.mouse.move(a.x + (z.x - a.x) * s / 12, a.y);
    await p.mouse.up();
  };
  const r0 = await read(); const n = r0.turns.length, D = 1, vs = r0.vs;
  ok('the score has at least six turns', n >= 6, String(n));
  const base = Array.from({ length: n }, (_, i) => vs + 3 + i * 2);
  const ph = base.map((_, i) => i % 2 === 0);

  // selecting
  await setup(base, ph);
  await click(base[1], true); await click(base[3], true);
  let r = await read();
  ok('shift-click adds turns to the selection', r.sel.join() === '1,3', r.sel.join());
  await click(base[1], true);
  r = await read();
  ok('shift-click on a selected turn removes it', r.sel.join() === '3', r.sel.join());
  ok('selecting changes no turn and adds no History step', nearAll(r.turns, base) && r.n === 0, r.n + ' ' + JSON.stringify(r.turns));
  await click(base[2] + 1, false);                                  // empty track between turns 2 and 3 (a turn is 2 s apart)
  r = await read();
  ok('clicking empty track clears the selection', r.sel.length === 0, r.sel.join());
  await drag(base[1] - 1, base[3] + 1);
  r = await read();
  ok('a box dragged across the track selects the turns inside it', r.sel.join() === '1,2,3', r.sel.join());
  ok('the box moves no turn', nearAll(r.turns, base) && r.n === 0, r.n + ' ' + JSON.stringify(r.turns));

  // group drag: turns 1..3 selected, dragged 1 s forward: the gaps inside hold, 4.. are pushed only as needed
  await drag(base[2], base[2] + 3);
  r = await read();
  const want = base.slice(); for (const i of [1, 2, 3]) want[i] = base[i] + 3;
  for (let j = 4; j < n; j++) want[j] = Math.max(base[j], want[j - 1] + D);
  ok('group: the whole group moves by the drag and keeps its gaps', nearAll(r.turns.slice(1, 4), want.slice(1, 4)), JSON.stringify(r.turns));
  ok('group: the turns ahead are pushed only as far as needed', nearAll(r.turns, want), JSON.stringify(r.turns) + ' vs ' + JSON.stringify(want));
  ok('group: the turn before the group stays', near(r.turns[0], base[0]), JSON.stringify(r.turns));
  ok('group: the least gap holds everywhere', r.turns.every((t, i) => i === 0 || t - r.turns[i - 1] >= D - 0.001), JSON.stringify(r.turns));
  ok('group: the selection stays', r.sel.join() === '1,2,3', r.sel.join());
  ok('group: the group becomes placed; pushed turns keep their state', [1, 2, 3].every(i => r.ph[i] === false) && r.ph.slice(4).join() === ph.slice(4).join() && r.ph[0] === ph[0], JSON.stringify(r.ph) + ' was ' + JSON.stringify(ph));
  ok('group: the drag is one History step', r.n === 1, String(r.n));
  await p.evaluate(() => undo());
  r = await read();
  ok('group: one undo restores every turn and state', nearAll(r.turns, base) && r.ph.join() === ph.join(), JSON.stringify(r.turns));

  // group drag backward pushes the turns behind it
  await setup(base, ph);
  await click(base[3], true); await click(base[4], true);
  await drag(base[3], base[3] - 2.6);
  r = await read();
  const back = base.slice(); back[3] = base[3] - 2.6; back[4] = base[4] - 2.6;
  for (let j = 2; j >= 0; j--) back[j] = Math.min(base[j], back[j + 1] - D);
  ok('group backward: the group moves and the turns behind are pushed', nearAll(r.turns, back), JSON.stringify(r.turns) + ' vs ' + JSON.stringify(back));

  // the ends of the video
  await setup(base, ph);
  await drag(base[1] - 1, base[2] + 1);                             // selects 1 and 2
  await drag(base[1], vs - 8);
  r = await read();
  ok('start: the group stops where its first turn reaches the start; the turn before is packed against it', r.turns[0] >= vs - 0.001 && near(r.turns[1] - r.turns[0], D) && near(r.turns[2] - r.turns[1], base[2] - base[1]), JSON.stringify(r.turns.slice(0, 4)));
  await setup(base, ph);
  await drag(base[n - 3] - 1, base[n - 2] + 1);                     // selects the 2 before the last
  await drag(base[n - 3], r0.ve + 8);
  r = await read();
  const top = r0.ve - D + 1;
  ok('end: nothing leaves the video and the least gap holds', r.turns.every(t => t <= top + 0.001) && r.turns.every((t, i) => i === 0 || t - r.turns[i - 1] >= D - 0.001), JSON.stringify(r.turns.slice(-4)) + ' top ' + top);
  ok('end: the group keeps its gap and the last turn is packed after it', near(r.turns[n - 2] - r.turns[n - 3], base[n - 2] - base[n - 3]) && near(r.turns[n - 1], top), JSON.stringify(r.turns.slice(-3)));

  // a plain drag on one unselected turn is unchanged, and clears the selection
  await setup(base, ph);
  await click(base[4], true);
  await drag(base[0], base[1] + 0.4);
  r = await read();
  const one = base.slice(); one[0] = base[1] + 0.4; one[1] = one[0] + D;
  for (let j = 2; j < n; j++) one[j] = Math.max(base[j], one[j - 1] + D);
  ok('single: a plain drag on one turn works as before', nearAll(r.turns, one) && r.ph[0] === false, JSON.stringify(r.turns));
  ok('single: a plain drag on an unselected turn clears the selection', r.sel.length === 0, r.sel.join());

  // the selection is not kept when the turns change
  await setup(base, ph);
  await click(base[2], true);
  await p.evaluate(K => { const k = window[K]; k.S.turns = k.S.turns.slice(0, -1); k.S.ph = k.S.ph.slice(0, -1); k.onTurnsChanged(); }, K);
  r = await read();
  ok('the selection is dropped when a turn is added or removed', r.sel.length === 0, r.sel.join());

  // drawing: a selected handle looks different from an unselected one
  await setup(base, base.map(() => false));
  const px = async () => { const g = await geo(base[2]); return p.evaluate(([K, x, y]) => { const k = window[K], r = k.TL.canvas.getBoundingClientRect(); k.TL.hover = -1; const c = k.TL.canvas.getContext('2d'), d = k.TL.dpr || 1; return Array.from(c.getImageData(Math.round((x - r.left - 12) * d), Math.round((y - r.top - 18) * d), Math.round(24 * d), Math.round(36 * d)).data).join(); }, [K, g.x, g.y]); };
  await p.mouse.move(5, 5); await p.waitForTimeout(400);
  const plain = await px();
  await click(base[2], true); await p.mouse.move(5, 5); await p.waitForTimeout(600);
  const sel = await px();
  ok('a selected handle is drawn differently from an unselected one', plain !== sel);
  for (const scheme of ['light', 'dark']) {
    await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(500);
    await setup(base, base.map(() => false)); await p.mouse.move(5, 5); await p.waitForTimeout(500);
    const a = await px(); await click(base[2], true); await p.mouse.move(5, 5); await p.waitForTimeout(600); const c = await px();
    ok('selected handle differs in ' + scheme, a !== c);
  }

  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
