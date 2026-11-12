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
    AE.tool = 'emu'; AE.bp = { eq: true, imager: true, level: true }; out.emu = !aeBpTool('emu') && aeBy() === 0; AE.tool = 'noise'; out.other = !aeBpTool('noise') && aeBy() === 0; AE.tool = 'eq'; out.eqBy = aeBy() === 1;
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
  {          // the readings at rest read what is heard, through aeHeard: the same draft the player plays
    const r = await p.evaluate(async () => {
      const o = {}, num = s => parseFloat(String(s).replace('−', '-')), eqBands = () => [{ type: 'peaking', f: 1000, g: 18, q: 1, on: true }, { type: 'peaking', f: 3000, g: 18, q: 1, on: true }, { type: 'peaking', f: 6000, g: 18, q: 1, on: true }];
      aeTool('eq'); await sleep(500); AE.bp = {}; AE.d.gainDb = 0; AE.d.normalize = false; AE.d.limiter = false; AE.d.audioFades = false;
      AE.d.fx.eq.on = true; AE.d.fx.eq.bands = eqBands(); aeRefresh(); await sleep(1500);
      o.onPeak = num(AE.ms.text);
      AE.d.fx.eq.on = false; aeRefresh(); await sleep(1500); o.offPeak = num(AE.ms.text);
      AE.d.fx.eq.on = true; AE.d.fx.eq.bands = eqBands(); aeRefresh(); await sleep(1500);
      const key0 = AE.baseWKey; aeToggleBypass(); await sleep(1500);
      o.bypPeak = num(AE.ms.text); o.bypOn = aeBpTool('eq'); o.wave = AE.baseWKey !== key0;
      o.heardSame = aeHeard(AE.d).fx.eq.on === false && AE.d.fx.eq.on === true;
      o.summaryNow = AE.sumIn.busy === false;
      aeToggleBypass(); await sleep(50); o.backInstant = AE.sumIn.busy === false && num(AE.ms.text) === o.onPeak;
      aeToggleBypass(); await sleep(1500);
      o.gainTxt0 = document.querySelector('#aeGainBig').textContent;
      AE.bp = {}; AE.d.fx.eq.on = false; AE.d.fx.eq.bands = [];
      AE.d.gainDb = 12; aeRefresh(); await sleep(400); o.levelOn = AE.G;
      const clipK0 = AE.clipKey; aeTool('level'); await sleep(400); aeToggleBypass(); await sleep(600);
      o.levelG = AE.G; o.levelPeak = num(AE.ms.text); o.gainTxt = document.querySelector('#aeGainBig').textContent; o.netTxt = document.querySelector('#aeNet').textContent;
      o.clipKeyMoved = AE.clipKey !== clipK0; o.limOff = aeLimMsg().lim.on === false;
      AE.bp = {}; AE.d.gainDb = 0; aeRefresh(); await sleep(400);
      aeTool('fades'); AE.d.audioFades = true; AE.d.audioFadeLen = 1; AE.d.audioFadeOutLen = null; aeRefresh(); await sleep(300);
      o.fadesKept = aeFadeLens(AE.d)[0] > 0; aeToggleBypass(); await sleep(1200);
      o.fadesGone = aeFadeLens(aeHeard(AE.d))[0] === 0 && aeFadeLens(AE.d)[0] > 0 && aeFadeFn(aeHeard(AE.d), true).Li < 0.01;          // the envelope glides to nothing (Li eases toward 0)      aeToggleBypass(); AE.d.audioFades = false; aeRefresh(); await sleep(300);
      return o;
    });
    ok('the readings at rest follow the EQ bypass: stopped true peak within 0.5dB of the EQ off', Math.abs(r.bypPeak - r.offPeak) <= 0.5 && r.onPeak - r.offPeak > 1, JSON.stringify(r));
    ok('the waveform picture changes on Bypass', r.wave && r.bypOn, JSON.stringify(r));
    ok('Bypass off is instant: no copy is being made, and the meter shows the same reading', r.backInstant, JSON.stringify(r));
    ok('the Gain number keeps the setting while Level is bypassed, Net gain reads 0dB, and the true peak falls', r.levelG === 1 && r.gainTxt.indexOf('+12') === 0 && /0dB/.test(r.netTxt) && r.levelPeak < 0, JSON.stringify(r));
    ok('a change of bypass moves the Clip key, and Level bypassed takes out its limiter', r.clipKeyMoved && r.limOff, JSON.stringify(r));
    ok('Fades bypassed: the fade envelope leaves the picture, and the setting is kept', r.fadesKept && r.fadesGone, JSON.stringify(r));
  }
  {          // the Emulator's Bypass: greyed unless the Emulator holds its result, and it only bypasses what the Emulator set
    const e = await p.evaluate(async () => {
      const o = {}; aeTool('emu'); await sleep(300); AE.bp = {}; AE.em = { ref: { I: -14, LRA: 6, tone: null, side: null }, result: null };
      AE.d.gainDb = 3; aeRefresh(); await sleep(200); o.notLive = !aeBpTool('emu') && aeBy() === 0 && $('#aeAB').disabled === true;
      AE.d.gainDb = 0; AE.d.fx.eq.on = true; AE.d.fx.eq.bands = [{ type: 'peaking', f: 1000, g: 6, q: 1, on: true }]; AE.em.result = aeCopy(AE.d); aeRefresh(); await sleep(200);
      o.live = emLive(); aeToggleBypass(); await sleep(200);
      o.onlyEmu = !!AE.bp.eq && !AE.bp.level && !AE.bp.imager && aeBpTool('emu') && aeBy() === 1;
      aeToggleBypass(); await sleep(200); o.offEmu = !aeBpTool('emu') && aeBy() === 0;
      AE.em = null; AE.bp = {}; AE.d.fx.eq.on = false; AE.d.fx.eq.bands = []; aeRefresh(); return o;
    });
    ok('the Emulator\'s Bypass is greyed and unpressed unless the Emulator holds its result', e.notLive, JSON.stringify(e));
    ok('the Emulator\'s Bypass bypasses only the tools it set (not Level set by hand)', e.live && e.onlyEmu && e.offEmu, JSON.stringify(e));
  }
  ok('no page errors', !errs.length, errs.join('; ')); await b.close(); process.exit(0);
})();
