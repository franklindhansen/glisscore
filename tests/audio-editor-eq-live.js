// The live EQ for a recording held in memory: it plays through the EQ's own filters inside the player on the audio thread (nothing is read back from the browser's audio path), and a band moved a long way while it plays neither clicks nor breaks the sound.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-live.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => { const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(60000);
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#audioIn', 'tests/fixtures/s24.wav'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(800); await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.auto = true; fx.eq.bands = [{ type: 'peaking', f: 9000, g: 9, q: 1.2, on: true }, { type: 'highshelf', f: 12000, g: -5, q: 0.71, on: true }, { type: 'highpass', f: 60, g: 0, q: 0.71, on: true }]; }); await sleep(300);
    const curve = eqCurve(AE.d.fx.eq.bands), at = f => { let i = 0; while (i < 239 && eqAxis[i] < f) i++; return curve[i]; };
    let made = 0, posted = 0;
    document.querySelector('#aePlay').click(); await sleep(900); const ac = AE.g.context, live = !!AE.ph && !!AE.chain && typeof window.eqNode === 'undefined' && typeof window.limNode === 'undefined';          // the filters are in the player: no worklet of their own reads the sound
    { const pp = AE.ph.post; AE.ph.post = m => { if (m.chain !== undefined) made++; if (m.upd) posted++; pp(m); }; }          // made: the filters were made again; posted: new numbers for the same filters
    // record what comes out of the chain with a recorder worklet
    const code = "registerProcessor('rec', class extends AudioWorkletProcessor { constructor() { super(); this.n = 0; } process(i) { if (i[0] && i[0][0]) this.port.postMessage({ at: currentFrame, l: i[0][0].slice() }); return true; } });";
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec', { numberOfInputs: 1, numberOfOutputs: 0 }), got = []; rec.port.onmessage = e => got.push(e.data); AE.chain.output.connect(rec);
    const t0 = aeNow(); await sleep(700); const worst0 = got.reduce((m, g) => Math.max(m, ...g.l.map(Math.abs)), 0);
    // move a band a long way while it plays: the largest step from one sample to the next must stay like the music's own
    let step0 = 0; got.forEach(g => { for (let i = 1; i < g.l.length; i++) step0 = Math.max(step0, Math.abs(g.l[i] - g.l[i - 1])); }); got.length = 0;
    for (let k = 0; k < 20; k++) { aeFx(fx => { fx.eq.bands[0].f = 9000 - k * 400; fx.eq.bands[0].g = 9 - k; }, true); await sleep(25); } await sleep(200);
    let step1 = 0, nan = 0; got.forEach(g => { for (let i = 1; i < g.l.length; i++) { const d = Math.abs(g.l[i] - g.l[i - 1]); if (!(d >= 0)) nan++; if (d > step1) step1 = d; } });
    const stillLive = made === 0 && posted >= 10; document.querySelector('#aePlay').click();
    return { live, stillLive, made, posted, worst0, step0, step1, nan, c9k: at(9000), c15k: at(15000), blocks: got.length };
  });
  ok('a recording in memory plays through the EQ\'s own filters on the audio thread', r.live && r.stillLive && r.worst0 > 0.001, JSON.stringify(r));
  ok('moving a band while it plays neither clicks nor breaks the sound', r.nan === 0 && r.blocks > 10 && r.step1 < Math.max(0.05, r.step0 * 3), 'largest sample-to-sample step ' + r.step0.toFixed(4) + ' before, ' + r.step1.toFixed(4) + ' while moving');
  ok('no page errors', !errs.length, errs.join('; ')); await b.close(); })();
