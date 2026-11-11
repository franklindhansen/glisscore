// Video editor: the playhead can be grabbed on its line anywhere in the timeline, even with a page turn right beside it or under it; grabbing it never moves a turn. A turn still grabs by its own handle, away from the line.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-playhead-grab.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 16; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-playhead-grab.pdf'); fs.writeFileSync(pdf, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf);
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const read = () => p.evaluate(K => { const k = window[K]; return { turns: k.S.turns.slice(), time: k.S.time, n: k.S.history.length }; }, K);
  const geo = () => p.evaluate(K => { const k = window[K], r = k.TL.canvas.getBoundingClientRect(); return { l: r.left, t: r.top, ty: k.TL.trackY, th: k.TL.trackH, px: k.t2x(k.S.time), tx: k.S.turns.map(t => k.t2x(t)) }; }, K);
  const setup = (turns, time) => p.evaluate(([K, turns, time]) => { const k = window[K]; k.S.turns = turns.slice(); k.S.ph = turns.map(() => false); k.S.history.length = 0; k.onTurnsChanged(); k.S.time = time; }, [K, turns, time]);
  const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const dragFrom = async (dx, dy, move) => {
    const g = await geo(), x = g.l + g.px + dx, y = g.t + g.ty + g.th / 2 + dy;
    await p.mouse.move(x, y); await p.mouse.down();
    for (let s = 1; s <= 10; s++) await p.mouse.move(x + move * s / 10, y);
    await p.mouse.up();
  };
  const r0 = await read(), vs = await p.evaluate(K => window[K].S.vStart, K), base = r0.turns.map((_, i) => vs + 3 + i * 2);

  // a turn beside the playhead (about 5px away): dragging the playhead line must not move it
  await setup(base, base[3] - 0.3); let before = await read();
  await dragFrom(0, 0, 60); let r = await read();
  ok('beside a turn: the turns stay put', same(r.turns, before.turns), JSON.stringify(r.turns.slice(2, 5)));
  ok('beside a turn: the playhead followed the drag', r.time > before.time + 0.5, before.time.toFixed(2) + ' → ' + r.time.toFixed(2));
  ok('beside a turn: no History step', r.n === before.n, String(r.n));
  await dragFrom(0, -20, -60); r = await read();
  ok('beside a turn, up the line: the turns stay put and the playhead moves back', same(r.turns, before.turns) && r.time < before.time + 0.5, r.time.toFixed(2));

  // a turn right under the playhead: the line (its middle 2px) is the playhead; the turn's handle grabs away from it
  await setup(base, base[3]); before = await read();
  await dragFrom(0, 0, 60); r = await read();
  ok('under a turn: the line drags the playhead, not the turn', same(r.turns, before.turns) && Math.abs(r.time - before.time) > 0.5, JSON.stringify(r.turns.slice(2, 5)) + ' ' + r.time.toFixed(2));
  await setup(base, base[3]); before = await read();
  await dragFrom(5, 0, 60); r = await read();
  ok('under a turn: the handle beside the line still moves the turn', Math.abs(r.turns[3] - before.turns[3]) > 0.5 && r.n === before.n + 1, JSON.stringify(r.turns.slice(2, 5)));

  // a turn far from the playhead keeps its whole handle
  await setup(base, base[6]); before = await read();
  const g = await geo(); const x3 = g.l + g.tx[3], y = g.t + g.ty + g.th / 2;
  await p.mouse.move(x3, y); await p.mouse.down(); for (let s = 1; s <= 10; s++) await p.mouse.move(x3 + s * 4, y); await p.mouse.up(); r = await read();
  ok('away from the playhead: a turn grabs and moves as before', Math.abs(r.turns[3] - before.turns[3]) > 0.1, r.turns[3].toFixed(2));

  // the empty track still draws a box and a click still moves the playhead
  await setup(base, base[1]); before = await read();
  const g2 = await geo(); const ex = g2.l + g2.px + 40, ey = g2.t + g2.ty + 4;
  await p.mouse.click(ex, ey); r = await read();
  ok('a click on empty track still moves the playhead there', Math.abs(r.time - before.time) > 0.05, r.time.toFixed(2));
  // while the playhead is dragged, the shaded page or system under it follows (it is drawn in the cached layer, which must redraw)
  await setup(base, base[1]); const g4 = await geo();
  await p.evaluate(() => { window.__sd = 0; const f = window.drawTimelineStatic; window.drawTimelineStatic = function () { window.__sd++; return f.apply(this, arguments); }; });
  await p.mouse.move(g4.l + g4.px, g4.t + g4.ty + g4.th / 2 + 20); await p.mouse.down();
  await p.mouse.move(g4.l + g4.px + 40, g4.t + g4.ty + g4.th / 2 + 20, { steps: 8 }); await p.waitForTimeout(150);
  ok('mid-drag the timeline layer redraws so the shading follows', await p.evaluate(() => window.__sd >= 2), String(await p.evaluate(() => window.__sd)));
  await p.mouse.up();
  // hovering the playhead's line lights it up; moving away puts it back
  await setup(base, base[1]); const g3 = await geo();
  await p.mouse.move(g3.l + g3.px, g3.t + g3.ty + g3.th / 2 + 20);
  ok('hovering the playhead lights it up', await p.evaluate(K => !!window[K].TL.hoverPh, K));
  await p.mouse.move(g3.l + g3.px + 60, g3.t + g3.ty + g3.th / 2 + 20);
  ok('moving away turns the light off', await p.evaluate(K => !window[K].TL.hoverPh, K));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
