// Video editor: "Turns to end" and "Space turns evenly" change the turn times at once, and the handles are drawn travelling to them on a spring that lands with a small bounce; dragging stays instant; reduced motion snaps; playback keeps running.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-turns-glide.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 16; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-turns-glide.pdf'); fs.writeFileSync(pdf, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf);
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const near = (a, b, e = 0.02) => Math.abs(a - b) < e;
  const setup = (time) => p.evaluate(([K, time]) => { const k = window[K], vs = k.S.vStart; k.S.turns = k.S.turns.map((_, i) => vs + 3 + i * 2); k.S.ph = k.S.turns.map(() => false); k.S.history.length = 0; k.S.time = time; k.onTurnsChanged(); k.TL.glide = null; }, [K, time]);
  // presses a button and samples the drawn time of turn i on every frame for ms
  const sample = (sel, i, ms) => p.evaluate(([K, sel, i, ms]) => new Promise(res => {
    const k = window[K], out = [], t0 = performance.now(); document.querySelector(sel).click();
    const fin = k.S.turns[i], steps = k.S.history.length;
    const f = () => { out.push(k.shownTurn(i)); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res({ out, fin, steps, final: k.S.turns[i] }); };
    requestAnimationFrame(f);
  }), [K, sel, i, ms]);
  const n = await p.evaluate(K => window[K].S.turns.length, K), I = n - 2;

  await setup(0);
  const g = await sample('#bToEnd', I, 1800), s0 = await p.evaluate(K => window[K].S.vStart + 3 + (window[K].S.turns.length - 2) * 2, K);
  ok('the turn times and History step are final the moment the button is pressed', g.steps === 1 && g.final > s0 + 0.5, g.steps + ' ' + g.final + ' vs ' + s0);
  ok('the handle starts near where it was and travels toward the new time', g.out[0] < g.fin - 0.5 && g.out[4] > g.out[0], JSON.stringify(g.out.slice(0, 6)));
  ok('the handle bounces a little past the final time', Math.max(...g.out) > g.fin + 0.002 * (g.fin - g.out[0]) && Math.max(...g.out) < g.fin + 0.06 * (g.fin - g.out[0]), String((Math.max(...g.out) - g.fin) / (g.fin - g.out[0])));
  ok('the handle lands exactly on the final time', near(g.out[g.out.length - 1], g.fin, 1e-6), String(g.out[g.out.length - 1] - g.fin));
  ok('the glide is done within a second', near(g.out[Math.floor(g.out.length * 1000 / 1800)], g.fin, 0.02), '');

  // Space turns evenly glides too
  await setup(0); await p.evaluate(K => window[K].S.turns.splice(0, 1, window[K].S.turns[0] + 4), K);
  await p.evaluate(K => window[K].onTurnsChanged(), K);
  const s = await sample('#bSpace', 0, 1500);
  ok('Space turns evenly glides the same way', Math.abs(s.out[0] - s.fin) > 0.5 && near(s.out[s.out.length - 1], s.fin, 1e-6) && s.steps >= 1, JSON.stringify(s.out.slice(0, 3)) + ' → ' + s.fin);

  // zooming mid-glide does not snap or stall the handles: a read taken just after the zoom is still travelling, and the handle still lands on time
  await setup(0);
  const z = await p.evaluate(([K, I]) => new Promise(res => { const k = window[K]; document.querySelector('#bToEnd').click(); const fin = k.S.turns[I], start = k.shownTurn(I); let before = null, after = null; setTimeout(() => { before = k.shownTurn(I); document.querySelector('#zoom').value = document.querySelector('#zoom').max; document.querySelector('#zoom').dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => { after = k.shownTurn(I); }, 120); }, 100); setTimeout(() => res({ start, before, after, fin, end: k.shownTurn(I) }), 1300); }), [K, I]);
  ok('zooming mid-glide does not snap the handle', z.after !== null && Math.abs(z.after - z.fin) > 0.5 && z.after > z.before && z.before > z.start, JSON.stringify(z));
  ok('zooming mid-glide still lands on time', near(z.end, z.fin, 1e-3), z.end + ' vs ' + z.fin);

  // dragging is not delayed
  await setup(0);
  const d = await p.evaluate(([K, I]) => { const k = window[K]; document.querySelector('#bToEnd').click(); const mid = k.shownTurn(I) !== k.S.turns[I]; k.TL.drag = { kind: 'turn', i: 0, dx: 0, base: k.S.turns.slice(), group: [0], moved: false, rb: [], live: false }; return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => { const r = { mid, now: k.shownTurn(I), fin: k.S.turns[I] }; k.TL.drag = null; res(r); }))); }, [K, I]);
  ok('a drag shows every handle at its true time at once', d.mid && near(d.now, d.fin, 1e-6), JSON.stringify(d));

  // playback keeps running through the press
  await setup(0);
  const pl = await p.evaluate(K => new Promise(async res => { const k = window[K]; await k.Transport.play(); const t0 = k.S.time; document.querySelector('#bToEnd').click(); setTimeout(() => res({ playing: k.Transport.playing, adv: k.S.time - t0 }), 500); }), K);
  ok('pressing the button during playback does not stop the video', pl.playing === true && pl.adv > 0.2, JSON.stringify(pl));
  await p.evaluate(K => window[K].Transport.pause && window[K].Transport.pause(), K);

  // reduced motion snaps
  await p.emulateMedia({ reducedMotion: 'reduce' }); await p.waitForTimeout(100); await setup(0);
  const r = await sample('#bToEnd', I, 300);
  ok('reduced motion snaps the handles to the final times', r.out.every(v => near(v, r.fin, 1e-6)), JSON.stringify(r.out.slice(0, 3)) + ' vs ' + r.fin);
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
