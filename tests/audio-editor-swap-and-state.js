// Normalize swap motion in the Audio Editor.
// Normalize: going between Peak and Loudness changes only what is shown under the switch: the controls leaving and arriving stay where they are (they fade, and the one leaving is wiped away upward),
// nothing slides down, and the card does not change size.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-swap-and-state.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500);
  await p.evaluate(() => aeTool('level')); await p.waitForTimeout(800);
  const swap = async (from, to) => {
    await p.click('#aeNormMode label:has(input[value=' + from + '])'); await p.waitForTimeout(900);
    return p.evaluate(to => new Promise(res => {
      const q = s => document.querySelector(s), out = [], t0 = performance.now(), top = e => Math.round(e.getBoundingClientRect().top * 10) / 10;
      q('#aeNormMode label:has(input[value=' + to + '])').click();
      (function f() { const t = performance.now() - t0; out.push({ t, card: q('#aeNormCard').getBoundingClientRect().height, peak: top(q('#aeNormTarget')), preset: top(q('#aeLoudPreset')), po: +getComputedStyle(q('#aePeakFold>.fa-in')).opacity, lo: +getComputedStyle(q('#aeLoudFold>.fa-in')).opacity }); if (t < 800) requestAnimationFrame(f); else res(out); })();
    }), to);
  };
  for (const [from, to, arrive, leave] of [['loud', 'peak', 'peak', 'preset'], ['peak', 'loud', 'preset', 'peak']]) {
    const rec = await swap(from, to), end = rec[rec.length - 1], key = { peak: 'po', preset: 'lo' };
    const rest = rec.map(f => f[arrive]).concat(rec.map(f => f[leave]));
    ok(from + ' to ' + to + ': the controls arriving and leaving stay where they are (nothing slides)', Math.max(...rec.map(f => f[arrive])) - Math.min(...rec.map(f => f[arrive])) < 0.6 && Math.max(...rec.map(f => f[leave])) - Math.min(...rec.map(f => f[leave])) < 0.6, JSON.stringify({ arrive: [Math.min(...rec.map(f => f[arrive])), Math.max(...rec.map(f => f[arrive]))], leave: [Math.min(...rec.map(f => f[leave])), Math.max(...rec.map(f => f[leave]))] }));
    ok(from + ' to ' + to + ': the card keeps its size', Math.max(...rec.map(f => f.card)) - Math.min(...rec.map(f => f.card)) < 0.6, JSON.stringify(rec.map(f => f.card).filter((v, i, a) => a.indexOf(v) === i)));
    const k1 = to === 'peak' ? 'po' : 'lo', k0 = to === 'peak' ? 'lo' : 'po';
    ok(from + ' to ' + to + ': the old one fades out and the new one fades in, and it ends with only the new one showing', end[k1] === 1 && end[k0] === 0 && rec[0][k0] > 0.9 && rec[0][k1] < 0.1, JSON.stringify({ start: [rec[0][k0], rec[0][k1]], end: [end[k0], end[k1]] }));
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
