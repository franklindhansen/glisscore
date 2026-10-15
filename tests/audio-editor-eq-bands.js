// EQ bands: a high-pass or low-pass can be 12, 24 or 48dB per octave (the curve drawn and the sound made both follow), and Listen plays only the part of the sound the chosen band works on
// without touching the settings or what is exported. In memory and on the disk store.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-bands.js [folder for screenshots]
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures', shots = process.argv[2];
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message)); const tag = disk ? 'store: ' : 'memory: ';
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1000);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      const o = {}, at = (c, f) => { let i = 0; while (i < 239 && eqAxis[i] < f) i++; return c[i]; }, vis = id => { const e = document.querySelector(id); return !e.hidden && e.getBoundingClientRect().width > 0; };
      aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 1000, g: 4, q: 1, on: true }, { type: 'highpass', f: 200, g: 0, q: 0.71, on: true }]; }); AE.band = 0; aeEqPanel(); await sleep(200);
      o.bell = { width: vis('#aeBandQField'), slope: vis('#aeBandSField') };
      AE.band = 1; aeEqPanel(); await sleep(200); o.cut = { width: vis('#aeBandQField'), slope: vis('#aeBandSField'), checked: document.querySelector('input[name=aeBandSlope]:checked').value };
      o.drop = {}; for (const s of ['12', '24', '48']) { document.querySelector('input[name=aeBandSlope][value="' + s + '"]').click(); await sleep(150); const c = eqCurve([AE.d.fx.eq.bands[1]]); o.drop[s] = [at(c, 100), at(c, 200), at(c, 800)].map(v => +v.toFixed(1)); o['saved' + s] = AE.d.fx.eq.bands[1].slope; }
      // the sound follows: a 100Hz tone through the 48dB filter, from the same code the export runs
      { const sr = 48000, n = sr, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 100 * i / sr); const ch = KFX.chain({ key: 't', sr, ch: 1, frames: n, read: async (a, m) => [x.subarray(a, a + m)] }, { noise: null, axis: [], edits: [], tools: [{ k: 'eq', bands: [AE.d.fx.eq.bands[1]], auto: false }] }, null), y = (await ch.read(0, n, true)).chans[0]; let e = 0; for (let i = n / 2; i < n; i++) e += y[i] * y[i]; o.tone = 10 * Math.log10(e / (n / 2) * 2); }
      const norm = fxNorm(AE.d.fx); o.kept = norm.eq.bands[1].slope; o.bellHasNone = !('slope' in norm.eq.bands[0]);
      document.querySelector('#aeBandType').value = 'peaking'; document.querySelector('#aeBandType').dispatchEvent(new Event('change', { bubbles: true })); await sleep(150); o.cleared = !('slope' in AE.d.fx.eq.bands[1]); document.querySelector('#aeUndo').click(); await sleep(200); o.undone = AE.d.fx.eq.bands[1].slope;
      // Listen
      const before = JSON.stringify(AE.d.fx), hear = () => aeHearFx().eq.bands.map(x => [x.type, x.f, x.slope]);
      document.querySelector('#aePlay').click(); await sleep(900);
      document.querySelector('#aeBandHear').click(); await sleep(700); o.hearCut = hear(); o.pressed = document.querySelector('#aeBandHear').getAttribute('aria-pressed'); o.playing1 = AE.playing;
      AE.band = 0; aeEqPanel(); aeLive(); await sleep(500); o.hearBell = hear();
      aeFx(fx => { fx.eq.bands[0].f = 2000; }, true); await sleep(400); o.hearMoved = hear(); AE.sliding = false;
      o.same = JSON.stringify(Object.assign(JSON.parse(JSON.stringify(AE.d.fx)), {})) !== before && AE.d.fx.eq.bands[0].f === 2000 && AE.d.fx.eq.bands.length === 2;
      aeTool('level'); await sleep(300); o.otherTool = aeHearFx() === AE.d.fx; aeTool('eq'); await sleep(200);
      document.querySelector('#aeBandHear').click(); await sleep(500); o.off = aeHearFx() === AE.d.fx; o.playing2 = AE.playing; document.querySelector('#aePlay').click(); await sleep(200);
      return o;
    });
    ok(tag + 'a bell shows Width, a high-pass shows Slope in its place', r.bell.width && !r.bell.slope && !r.cut.width && r.cut.slope && r.cut.checked === '12', JSON.stringify([r.bell, r.cut]));
    ok(tag + 'the curve falls 12, 24 or 48dB per octave below the corner and stays flat above it', Math.abs(r.drop['12'][0] + 12.3) < 1 && Math.abs(r.drop['24'][0] + 24.1) < 1 && Math.abs(r.drop['48'][0] + 48.2) < 1.2 && [r.drop['12'], r.drop['24'], r.drop['48']].every(d => Math.abs(d[1] + 3) < 0.4 && Math.abs(d[2]) < 0.3), JSON.stringify(r.drop));
    ok(tag + 'the sound follows (a 100Hz note through the 48dB high-pass at 200Hz)', Math.abs(r.tone + 48.2) < 0.3, r.tone.toFixed(2) + 'dB (an ideal filter gives −48.2dB)');
    ok(tag + 'the slope is kept with the band, only on a high-pass or low-pass, and comes back with Undo', r.saved12 === undefined && r.saved24 === 24 && r.saved48 === 48 && r.kept === 48 && r.bellHasNone && r.cleared && r.undone === 48, JSON.stringify([r.saved12, r.saved24, r.saved48, r.kept, r.cleared, r.undone]));
    ok(tag + 'Listen plays what a high-pass takes away, and the stretch around a bell, following the band as it moves', r.pressed === 'true' && JSON.stringify(r.hearCut) === '[["lowpass",200,48]]' && r.hearBell.length === 2 && r.hearBell[0][0] === 'highpass' && r.hearBell[0][1] < 1000 && r.hearBell[1][1] > 1000 && r.hearMoved[0][1] > r.hearBell[0][1], JSON.stringify([r.hearCut, r.hearBell, r.hearMoved]));
    ok(tag + 'Listen changes only what plays: off in another tool, off again on a second press, playback carries on', r.otherTool && r.off && r.playing1 && r.playing2, JSON.stringify([r.otherTool, r.off, r.playing1, r.playing2]));
    ok(tag + 'no page errors', !errs.length, errs.join('; '));
    if (shots && disk) for (const [w, name] of [[1300, 'wide'], [760, 'narrow']]) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(500); for (const [i, kind] of [[0, 'bell'], [1, 'cut']]) { await p.evaluate(k => { AE.band = k; AE.eqListen = k === 1; aeEqPanel(); }, i); await p.waitForTimeout(300); await (await p.$('#aeEqBand')).screenshot({ path: shots + '/eqband-' + name + '-' + kind + '.png' }); } }
    await p.close();
  }
  await b.close();
})();
