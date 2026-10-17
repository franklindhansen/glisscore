// The EQ presets follow the rules: a high-pass of 30Hz or higher (all but the repair "Reduce harshness"), no gain past 3dB, bells no narrower than Q 1,
// and the tone bands of each (what the filters really make, the high-pass left out) never move the sound more than 3.5dB; choosing one puts its bands in and nothing else.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-presets.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  const r = await p.evaluate(() => { window.AE = window.AE || {}; return EQ_PRESETS.map(([name, bands]) => { const cv = eqResp({ sampleRate: 48000 }, eqBandsOf([name, bands.filter(x => x[0] !== 'highpass')]), eqAxis); return { name, hp: (bands.find(x => x[0] === 'highpass') || [])[1] || 0, gain: Math.max(...bands.map(x => Math.abs(x[2]))), bellQ: Math.min(...bands.filter(x => x[0] === 'peaking').map(x => x[3])), move: Math.max(...Array.from(cv, Math.abs)), n: bands.length }; }); });
  for (const x of r) ok(x.name + ': ' + (x.name === 'Reduce harshness' ? 'no high-pass, ' : 'high-pass at ' + x.hp + 'Hz, ') + 'biggest gain ' + x.gain + 'dB, widest-narrowest bell Q ' + x.bellQ + ', curve moves at most ' + x.move.toFixed(1) + 'dB',
    (x.name === 'Reduce harshness' ? x.hp === 0 : x.hp >= 30) && x.gain <= 3 && x.bellQ >= 0.7 && x.bellQ <= 1 && x.move <= 3.5);
  ok('no page errors', !errs.length, errs.join('; '));
  await b.close();
})();
