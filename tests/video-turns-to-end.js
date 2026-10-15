// Video editor: "Turns to end" packs every page turn after the playhead against the end of the video at the least gap, keeping their order; with credits the credits turn stays and the packed turns finish one gap before it; the moved turns become dashed; Tap a Turn then places them in order; the button is greyed with a reason when no turn lies after the playhead; one undo restores them; the toast counts them.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-turns-to-end.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 16; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-turns-to-end.pdf'); fs.writeFileSync(pdf, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf);
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const near = (a, b) => Math.abs(a - b) < 0.02;
  const read = () => p.evaluate(K => { const k = window[K]; return { turns: k.S.turns.slice(), ph: k.S.ph.slice(), n: k.S.history.length, ve: k.vEnd(), ce: k.S.creditsEnd, dis: document.querySelector('#bToEnd').disabled, tip: document.querySelector('#bToEnd').title, hint: document.querySelector('#tlHint').textContent, toast: (document.querySelector('.toast, #toast') || {}).textContent || '' }; }, K);
  const setup = (turns, ph, time) => p.evaluate(([K, turns, ph, time]) => { const k = window[K]; k.S.turns = turns.slice(); k.S.ph = ph.slice(); k.S.history.length = 0; k.S.time = time; k.onTurnsChanged(); }, [K, turns, ph, time]);
  const press = async () => { await p.click('#bToEnd'); await p.waitForTimeout(150); };
  const r0 = await read(); const n = r0.turns.length, vs = await p.evaluate(K => window[K].S.vStart, K);
  const D = await p.evaluate(K => window[K].turnGap(), K), off = await p.evaluate(K => window[K].refOffset(), K);
  ok('the score has at least six turns', n >= 6, String(n));
  const base = Array.from({ length: n }, (_, i) => vs + 3 + i * 2), ph = base.map(() => false), last = r0.ve;

  // credits off: the playhead between turns 2 and 3
  await setup(base, ph, base[2] + 1);
  let r = await read();
  ok('the button is live when turns lie after the playhead', r.dis === false, r.tip);
  await press(); r = await read();
  ok('turns up to the playhead stay', r.turns.slice(0, 3).every((t, i) => near(t, base[i])), JSON.stringify(r.turns));
  ok('the later turns keep their order at the least gap', r.turns.slice(3).every((t, i, a) => i === 0 || near(t - a[i - 1], D)) && near(r.turns[3] - r.turns[2], D) === (r.turns[3] - r.turns[2] < D + 0.02), JSON.stringify(r.turns));
  ok('the last turn sits at the end of the video', near(r.turns[n - 1], r0.ve - D + off), r.turns[n - 1] + ' vs ' + (r0.ve - D + off));
  ok('moved turns are dashed, the others keep their state', r.ph.slice(3).every(Boolean) && r.ph.slice(0, 3).every(v => !v), JSON.stringify(r.ph));
  ok('the hint line counts them', r.hint.startsWith((n - 3) + ' page turns still need placing'), r.hint);
  ok('one History step', r.n === 1, String(r.n));
  ok('the toast says how many moved', r.toast.includes((n - 3) + ' turns moved to the end'), r.toast);

  // Tap a Turn places the next one in order without pushing the rest
  await p.evaluate(([K, t]) => { const k = window[K]; k.S.time = t; k.Transport.now = () => t; k.tapTurn(); }, [K, base[2] + 2.5]);
  r = await read();
  ok('Tap a Turn places the next moved turn and leaves the others', r.ph[3] === false && r.ph.slice(4).every(Boolean), JSON.stringify(r.ph));

  // undo
  await setup(base, ph, base[2] + 1); await press();
  await p.evaluate(() => undo()); r = await read();
  ok('one undo restores the turns and their states', r.turns.every((t, i) => near(t, base[i])) && r.ph.every(v => !v), JSON.stringify(r.turns));

  // playhead at several spots
  for (const k of [0, 3, n - 3]) {
    await setup(base, ph, base[k] + 0.5); await press(); r = await read();
    const mv = n - 1 - k;
    ok('playhead after turn ' + (k + 1) + ': exactly ' + mv + ' turns move', r.ph.filter(Boolean).length === mv && r.turns.slice(0, k + 1).every((t, i) => near(t, base[i])), JSON.stringify(r.ph));
  }

  // nothing after the playhead
  await setup(base, ph, base[n - 1] + 0.5); r = await read();
  ok('greyed when no turn lies after the playhead, with the reason', r.dis === true && /after the playhead/i.test(r.tip), r.dis + ' ' + r.tip);

  // credits on
  await p.evaluate(K => { const k = window[K]; Object.assign(k.S.set, { creditsOn: true, creditsEarly: true, creditsWithLast: false }); k.S.credits.title = 'Test'; k.syncCredits(); }, K);
  const c = await read(); const m = c.turns.length;
  const cb = Array.from({ length: m }, (_, i) => vs + 3 + i * 2); cb[m - 1] = c.turns[m - 1];
  await setup(cb, cb.map(() => false), cb[1] + 1); const ce0 = (await read()).ce;
  await press(); r = await read();
  ok('credits: the credits turn does not move', near(r.turns[m - 1], cb[m - 1]), r.turns[m - 1] + ' vs ' + cb[m - 1]);
  ok('credits: the packed turns end one gap before the credits turn', near(r.turns[m - 1] - r.turns[m - 2], D) && r.turns[m - 2] >= cb[m - 2] - 0.001, JSON.stringify(r.turns.slice(-3)));
  ok('credits: the credits turn is not dashed and the credits end marker is unchanged', r.ph[m - 1] === false && r.ph.slice(2, m - 1).every(Boolean) && r.ce === ce0, JSON.stringify(r.ph) + ' ' + r.ce + ' vs ' + ce0);
  await setup(cb, cb.map(() => false), cb[m - 2] + 0.5); r = await read();
  ok('credits: greyed when only the credits turn lies after the playhead', r.dis === true, r.tip);

  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
