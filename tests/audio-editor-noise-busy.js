// The Noise pane while it works: Remove hum is held while the removal runs (after a Natural or Classic switch), learning the same stretch again leaves no bar behind,
// a slider runs the removal once (it reports its start twice), after it is let go, and the Manual hint is gone once a stretch is picked (and sits on the waveform's center line).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-noise-busy.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1100, height: 800 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', 'tests/fixtures/loud.mp3'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    const o = {}, q = s => document.querySelector(s), settle = async () => { for (let i = 0; i < 200 && (i < 4 || AE.nrBusy || AE.nrLearning || AE.nrAutoBusy || AE.humBusy); i++) await sleep(50); await sleep(500); };
    // one press, one wait: the pill comes on once, its share only goes up, and when it goes the sound is ready
    const watch = async act => { const bar = q('#aeNrProgBar'), ons = []; let prev = bar.classList.contains('on'), last = 0, back = 0; const mo = new MutationObserver(() => { const on = bar.classList.contains('on'); if (on && !prev) ons.push(1); prev = on; }); mo.observe(bar, { attributes: true, attributeFilter: ['class'] });
      const tick = setInterval(() => { if (AE.nrTarget < last - 0.02 && prev) back++; if (prev) last = AE.nrTarget; }, 20); act(); await sleep(200); for (let i = 0; i < 300 && (prev || AE.nrBusy || AE.nrLearning || AE.nrAutoBusy || AE.humBusy); i++) await sleep(50); await sleep(400); clearInterval(tick); mo.disconnect();
      const nz = AE.d.fx.noise; return { times: ons.length, back, ready: !!nrPeek(nz, false) || !nrReady(nz) }; };
    aeTool('noise'); await sleep(300); o.wFirst = await watch(() => q('#aeNrLearn').click());          // the very first Learn on a new recording (Auto)
     q('input[name=aeNrMethod][value=manual]').click(); await sleep(300);
    AE.nsel = null; aeRefresh(); await sleep(100); o.hintOn = AE.nsArm && !AE.nsel; AE.nsel = { a: 0.2, b: 1.6 }; aeRefresh(); await sleep(200); o.hintGone = !(AE.nsArm && !AE.nsel && !AE.nsDrag);
    for (let k = 0; k < 3; k++) { q('#aeNrLearn').click(); await settle(); o['relearn' + k] = { busy: AE.nrBusy, bar: q('#aeNrProgBar').classList.contains('on'), sum: Array.from(AE.d.fx.noise.profile).reduce((a, c) => a + c, 0) }; }
    q('input[name=aeNrMode][value=classic]').click(); await sleep(20); o.humHeld = q('#aeNrHum').disabled && q('#aeNrListen').disabled; await settle(); o.humFree = !q('#aeNrHum').disabled;
    const t0 = performance.now(), runs = [], was = NRJ.onProg; NRJ.onProg = v => { if (v === 0) runs.push(Math.round(performance.now() - t0)); was(v); };
    const el = q('#aeNrRed'), set = v => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    for (const v of [6, 9, 12, 15]) { set(v); await sleep(350); } o.runsWhileHeld = runs.length; el.dispatchEvent(new Event('change', { bubbles: true })); await settle(); o.runsAfter = runs.length; o.bar = q('#aeNrProgBar').classList.contains('on');
    { const n = { ...AE.d.fx.noise, reduction: 7 }; nrGet(n, false, { preview: true }).catch(() => {}); } o.offRan = !!NRJ.pv; set(0); await sleep(60); o.offStopped = !NRJ.pv && !AE.nrBusy && !q('#aeNrProgBar').classList.contains('on'); set(12); el.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    q('input[name=aeNrMethod][value=manual]').click(); AE.nsel = { a: 0.3, b: 1.9 }; aeRefresh(); await sleep(200); o.wLearn = await watch(() => q('#aeNrLearn').click());
    AE.nsel = { a: 0.2, b: 1.2 }; aeRefresh(); await sleep(200); o.wLearn2 = await watch(() => q('#aeNrLearn').click());
    { const before = JSON.stringify(AE.d.fx.noise), nsel0 = JSON.stringify(AE.nsel); q('input[name=aeNrMethod][value=auto]').click(); await sleep(400); o.autoClick = { same: before === JSON.stringify(AE.d.fx.noise), kept: nsel0 === JSON.stringify(AE.nsel), idle: !AE.nrBusy && !q('#aeNrProgBar').classList.contains('on') }; }          // choosing Auto only changes the choice
    q('input[name=aeNrMethod][value=auto]').click(); await sleep(200); o.wAuto = await watch(() => q('#aeNrLearn').click()); o.wMode = await watch(() => q('input[name=aeNrMode][value=natural]').click());
    return o;
  });
  ok('the Manual hint shows until a stretch is picked, then goes', r.hintOn && r.hintGone, JSON.stringify([r.hintOn, r.hintGone]));
  ok('learning the same stretch again gives the same noise and leaves no bar', [0, 1, 2].every(k => !r['relearn' + k].busy && !r['relearn' + k].bar && r['relearn' + k].sum === r.relearn0.sum), JSON.stringify([r.relearn0, r.relearn1, r.relearn2]));
  ok('Remove hum and Output noise are held while the removal runs, then free', r.humHeld && r.humFree, JSON.stringify([r.humHeld, r.humFree]));
  ok('a slider runs the removal once (it reports its start twice), after it is let go', r.runsWhileHeld === 0 && r.runsAfter > 0 && r.runsAfter <= 2 && !r.bar, JSON.stringify([r.runsWhileHeld, r.runsAfter, r.bar]));
  ok('Reduction moved to Off stops a running removal at once and ends its bar', r.offRan && r.offStopped, JSON.stringify([r.offRan, r.offStopped]));
  ok('each Learn shows its wait once, going only up, and the sound is ready when it ends', ['wFirst', 'wLearn', 'wLearn2', 'wAuto', 'wMode'].every(k => r[k].times === 1 && r[k].back === 0 && r[k].ready), JSON.stringify([r.wFirst, r.wLearn, r.wLearn2, r.wAuto, r.wMode]));
  ok('choosing Auto after a hand-picked Learn changes nothing: same noise, the stretch stays, no processing', r.autoClick.same && r.autoClick.kept && r.autoClick.idle, JSON.stringify(r.autoClick));
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
