// Bypass works on the open tool alone: the settings that are heard leave out only the bypassed tool, the Emulator's bypass takes out the EQ, the Imager and Level together,
// the volume and the fades are bypassed on their own, and a tool that stops doing anything is let go from the bypassed ones.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-bypass.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const fx = fxClone(FX_DEFAULT); fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 1000, g: 6, q: 1, on: true }]; fx.imager.on = true; fx.imager.width = 150; fx.noise.on = true; fx.noise.hum = { f: 50 }; fx.spec.on = true; fx.spec.edits = [{ x: 1 }];
    AE.d = { fx, gainDb: 3, normalize: false, vStart: 0, vEndSet: null, audioFades: true }; const out = {};
    AE.bp = {}; out.none = aeFxHeard(fx) === fx;
    AE.bp = { eq: true }; { const h = aeFxHeard(fx); out.eq = !h.eq.on && h.imager.on && h.noise.on && h.spec.on && fx.eq.on; }
    AE.bp = { noise: true }; { const h = aeFxHeard(fx); out.noise = !h.noise.on && !h.noise.hum && h.eq.on && h.spec.on; }
    AE.bp = { spec: true }; { const h = aeFxHeard(fx); out.spec = !h.spec.on && !h.spec.edits.length && h.noise.on && fx.spec.edits.length === 1; }
    AE.tool = 'emu'; AE.bp = { eq: true, imager: true, level: true }; out.emu = aeBpTool('emu') && aeBy() === 1; AE.tool = 'noise'; out.other = !aeBpTool('noise') && aeBy() === 0; AE.tool = 'eq'; out.eqBy = aeBy() === 1;
    AE.bp = { level: true }; out.lim = aeLimMsg().lim.on === false;
    return out;
  });
  ok('nothing bypassed: the settings are heard as they are', r.none);
  ok('EQ bypassed: only the EQ goes', r.eq); ok('Noise reduction bypassed: the noise and the hum go, the rest stays', r.noise); ok('Spectra bypassed: its edits go, the noise reduction stays', r.spec);
  ok('the Emulator\'s bypass covers the EQ, the Imager and Level; other tools are not bypassed by it', r.emu && r.other && r.eqBy); ok('Level bypassed: the limiter is off', r.lim);
  {          // the pill shows beside the title of Level, Fades, Spectra and the Emulator, and editing a bypassed tool switches it back on
    const sr = 22050, n = sr * 3, wav = Buffer.alloc(44 + n * 2); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i / sr * 2 * Math.PI * 220)), 44 + i * 2);
    const f = path.join(os.tmpdir(), 'kf-bp.wav'); fs.writeFileSync(f, wav);
    await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio); await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const q = await p.evaluate(async () => {
      const pill = () => +getComputedStyle(document.querySelector('.ae-bypill')).opacity, o = {};
      for (const t of ['level', 'fades']) {
        aeTool(t); await sleep(700); if (t === 'level') AE.d.gainDb = 3; else AE.d.audioFades = true; aeToolsRefresh(); await sleep(100);
        o[t + 'Before'] = pill(); aeToggleBypass(); await sleep(600); o[t + 'On'] = pill() > 0.95 && aeBpTool(t);
        if (t === 'level') { AE.d.gainDb = 4; aeToolsRefresh(); await sleep(600); o.levelEdit = !aeBpTool('level') && pill() < 0.05; }
        else { aeToggleBypass(); await sleep(600); o.fadesOff = !aeBpTool('fades') && pill() < 0.05; }
      }
      aeTool('eq'); await sleep(700); o.eqNone = pill() < 0.05; return o;
    });
    ok('the pill is hidden until Level or Fades is bypassed, then shows beside the title', q.levelBefore < 0.05 && q.levelOn && q.fadesBefore < 0.05 && q.fadesOn, JSON.stringify(q));
    ok('editing a bypassed tool switches it back on and the pill goes', q.levelEdit && q.fadesOff && q.eqNone, JSON.stringify(q));
  }
  ok('no page errors', !errs.length, errs.join('; ')); await b.close(); process.exit(0);
})();
