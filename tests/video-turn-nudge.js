// Video editor: dragging a page turn into the next one pushes it, and the ones behind it, along at the least gap (one flip), forward and backward; the push stops at the ends of the video; pushed turns keep their dashed or solid state; one undo restores the drag; the credits turn and end marker stay valid.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-turn-nudge.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 16; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-turn-nudge.pdf'); fs.writeFileSync(pdf, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf);
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const near = (a, b) => Math.abs(a - b) < 0.02;
  const nearAll = (a, b) => a.length === b.length && a.every((v, i) => near(v, b[i]));
  const read = () => p.evaluate(K => { const k = window[K]; return { turns: k.S.turns.slice(), ph: k.S.ph.slice(), vs: k.S.vStart, ve: k.vEnd(), n: k.S.history.length }; }, K);
  // set the turns and which are still dashed (ph true = not yet placed)
  const setup = (turns, ph) => p.evaluate(([K, turns, ph]) => { const k = window[K]; k.S.turns = turns.slice(); k.S.ph = ph.slice(); k.S.history.length = 0; k.onTurnsChanged(); }, [K, turns, ph]);
  // drag turn i with the mouse to time t (the handle keeps the grab offset, so the end time is exact)
  const drag = async (i, t) => {
    const g = await p.evaluate(([K, i, t]) => { const k = window[K], r = k.TL.canvas.getBoundingClientRect(); return { x0: r.left + k.t2x(k.S.turns[i]), x1: r.left + k.t2x(t), y: r.top + k.TL.trackY + k.TL.trackH / 2 }; }, [K, i, t]);
    await p.mouse.move(g.x0, g.y); await p.mouse.down();
    for (let s = 1; s <= 12; s++) await p.mouse.move(g.x0 + (g.x1 - g.x0) * s / 12, g.y);
    await p.mouse.up();
  };
  const r0 = await read(); const n = r0.turns.length;
  ok('the score has at least five turns', n >= 5, String(n));
  const D = 1, vs = r0.vs;
  const base = Array.from({ length: n }, (_, i) => vs + 3 + i * 2);
  ok('the test turns fit inside the video', base[n - 1] <= r0.ve - 1, JSON.stringify([base[n - 1], r0.ve]));

  // forward: turn 0 dragged onto turn 1 pushes 1 and 2 along; later ones stay
  const phMix = base.map((_, i) => i % 2 === 0);              // 0 dashed, 1 solid, 2 dashed...
  await setup(base, phMix);
  await drag(0, base[1] + 0.4);
  let r = await read();
  const want = base.slice(); want[0] = base[1] + 0.4; want[1] = want[0] + D;
  for (let j = 2; j < n; j++) want[j] = Math.max(base[j], want[j - 1] + D);
  ok('forward: the grabbed turn moves where it was dragged', near(r.turns[0], want[0]), JSON.stringify(r.turns));
  ok('forward: the next turn is pushed one flip ahead of it', near(r.turns[1], want[1]), JSON.stringify(r.turns));
  ok('forward: the whole chain matches (only as far as needed)', nearAll(r.turns, want), JSON.stringify(r.turns) + ' vs ' + JSON.stringify(want));
  ok('forward: the least gap holds between every pair', r.turns.every((t, i) => i === 0 || t - r.turns[i - 1] >= D - 0.001), JSON.stringify(r.turns));
  ok('forward: only the grabbed turn becomes placed; pushed ones keep their state', r.ph[0] === false && r.ph.slice(1).every((v, i) => v === phMix[i + 1]), JSON.stringify(r.ph) + ' was ' + JSON.stringify(phMix));
  ok('forward: the drag and its pushes are one History step', r.n === 1, String(r.n));
  await p.evaluate(() => undo());
  r = await read();
  ok('forward: one undo restores every turn and state', nearAll(r.turns, base) && r.ph.join() === phMix.join(), JSON.stringify(r.turns) + ' ' + JSON.stringify(r.ph));

  // backward: the last turn dragged back onto the one before pushes the chain toward the start
  await setup(base, phMix);
  await drag(n - 1, base[n - 2] - 0.4);
  r = await read();
  const back = base.slice(); back[n - 1] = base[n - 2] - 0.4;
  for (let j = n - 2; j >= 0; j--) back[j] = Math.min(base[j], back[j + 1] - D);
  ok('backward: the chain matches (only as far as needed)', nearAll(r.turns, back), JSON.stringify(r.turns) + ' vs ' + JSON.stringify(back));
  ok('backward: only the grabbed turn becomes placed', r.ph[n - 1] === false && r.ph.slice(0, n - 1).join() === phMix.slice(0, n - 1).join(), JSON.stringify(r.ph));

  // the start: dragging the second turn far to the left pushes the first to the earliest place and the handle stops with it
  await setup(base, phMix);
  await drag(1, vs - 5);
  r = await read();
  ok('start: the first turn stops at the earliest place', r.turns[0] >= vs && near(r.turns[1] - r.turns[0], D), JSON.stringify(r.turns.slice(0, 3)));
  ok('start: nothing goes before the video', r.turns.every(t => t >= vs - 0.001), JSON.stringify(r.turns));
  ok('start: the least gap holds', r.turns.every((t, i) => i === 0 || t - r.turns[i - 1] >= D - 0.001), JSON.stringify(r.turns));

  // the end: dragging the second-to-last turn far to the right packs the last ones against the end
  await setup(base, phMix);
  await drag(n - 2, r0.ve + 5);
  r = await read();
  const top = r0.ve - D + 1;                                                    // the latest the last turn may sit (ref is the end of the turn)
  ok('end: nothing leaves the video', r.turns.every(t => t <= top + 0.001), JSON.stringify(r.turns) + ' top ' + top);
  ok('end: the least gap holds', r.turns.every((t, i) => i === 0 || t - r.turns[i - 1] >= D - 0.001), JSON.stringify(r.turns));
  ok('end: the grabbed handle stops against the one it pushed', near(r.turns[n - 1] - r.turns[n - 2], D), JSON.stringify(r.turns.slice(-3)));

  // credits: the credits turn (the last) is pushed only as far as any turn may go, and the credits end marker stays inside the video after it
  await p.evaluate(K => { const k = window[K]; Object.assign(k.S.set, { creditsOn: true, creditsEarly: true }); k.S.credits.title = 'Test'; k.syncCredits(); }, K);
  const rc = await read(); const m = rc.turns.length;
  const cbase = Array.from({ length: m }, (_, i) => vs + 3 + i * 2);
  await setup(cbase, cbase.map(() => false));
  await p.evaluate(K => { const k = window[K]; k.S.creditsEnd = k.vEnd() - 0.5; k.ensureCreditsEnd(); }, K);
  await drag(m - 2, r0.ve + 5);
  const cr = await p.evaluate(K => { const k = window[K]; return { turns: k.S.turns.slice(), ce: k.S.creditsEnd, ve: k.vEnd() }; }, K);
  ok('credits: the credits turn is pushed no later than any last turn may sit', cr.turns[m - 1] <= cr.ve - D + 1 + 0.001, JSON.stringify(cr.turns.slice(-2)));
  ok('credits: the least gap holds up to the credits turn', cr.turns.every((t, i) => i === 0 || t - cr.turns[i - 1] >= D - 0.001), JSON.stringify(cr.turns));
  ok('credits: the credits end marker stays after the credits turn and inside the video', cr.ce >= cr.turns[m - 1] && cr.ce <= cr.ve + 0.001, JSON.stringify([cr.ce, cr.turns[m - 1], cr.ve]));

  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
