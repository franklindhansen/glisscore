// Main view and Audio Editor layout: the full screen button never sits on the preview picture at small window sizes; dragging a page turn while the video plays
// leaves the playhead and the playback alone (paused, the playhead still goes to the marker); the Audio Editor's controls share two heights (small 28px, medium 34px).
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/stage-and-controls.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const errs = [];
  const open = async (w, h, audio) => { const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 0); if (audio) { await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); } await p.waitForTimeout(1200); return p; };
  // full screen button
  const bad = [];
  for (const [w, h] of [[1300, 800], [1000, 640], [820, 560], [700, 500], [560, 640], [390, 800], [1000, 420], [1300, 440]]) {
    const p = await open(w, h, true), r = await p.evaluate(() => { const f = document.querySelector('#btnFull').getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return { hit: f.left < s.right && f.right > s.left && f.top < s.bottom && f.bottom > s.top, f: [f.left, f.top, f.right, f.bottom].map(Math.round), s: [s.left, s.top, s.right, s.bottom].map(Math.round) }; });
    if (r.hit) bad.push(w + 'x' + h + ' ' + JSON.stringify(r)); await p.close();
  }
  ok('The full screen button never overlaps the preview picture', !bad.length, bad.join(' | '));
  // page turn drag while playing
  { const p = await open(1300, 800, true), K = '__keyframes';
    const r = await p.evaluate(async K => {
      const { S, TL, Transport, t2x } = window[K]; if (S.turns.length < 1) return { none: true };
      const sleep = ms => new Promise(r => setTimeout(r, ms)); S.time = Math.max(S.vStart, S.turns[0] - 0.5); Transport.play(); await sleep(300);
      const rc = TL.canvas.getBoundingClientRect(), x = rc.left + t2x(S.turns[0]), y = rc.top + rc.height * 0.6; return { x, y, t0: S.turns[0], playing: Transport.playing };
    }, K);
    if (r.none) ok('Dragging a page turn while the video plays leaves the video alone', false, 'no turns in the test score');
    else {
      await p.mouse.move(r.x, r.y); await p.mouse.down(); await p.mouse.move(r.x + 30, r.y, { steps: 4 }); await p.waitForTimeout(150);
      const mid = await p.evaluate(K => ({ playing: window[K].Transport.playing, t: window[K].S.time, turn: window[K].S.turns[0] }), K); await p.mouse.up(); await p.waitForTimeout(200);
      const end = await p.evaluate(K => ({ playing: window[K].Transport.playing }), K);
      ok('Dragging a page turn while the video plays: the marker moves, the video keeps playing and the playhead stays on the video', mid.playing && end.playing && mid.turn !== r.t0 && Math.abs(mid.t - mid.turn) > 0.02, JSON.stringify({ r: [r.t0], mid, end }));
      await p.evaluate(K => window[K].Transport.pause(), K); await p.waitForTimeout(100);
      const q = await p.evaluate(K => { const { S, TL, t2x } = window[K], rc = TL.canvas.getBoundingClientRect(); return { x: rc.left + t2x(S.turns[0]), y: rc.top + rc.height * 0.6 }; }, K);
      await p.mouse.move(q.x, q.y); await p.mouse.down(); await p.mouse.move(q.x + 25, q.y, { steps: 4 }); await p.waitForTimeout(100);
      const pz = await p.evaluate(K => ({ t: window[K].S.time, turn: window[K].S.turns[0] }), K); await p.mouse.up();
      ok('Paused, the playhead still goes to the marker while it is dragged', Math.abs(pz.t - pz.turn) < 0.005, JSON.stringify(pz));
    }
    await p.close(); }
  // Audio Editor control heights
  { const p = await open(1300, 900, true); await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(900);
    const h = await p.evaluate(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)), out = {}; aeTool('eq'); await sleep(800);
      const ht = s => Math.round(document.querySelector(s).getBoundingClientRect().height * 10) / 10;
      out.eqTop = ['#aeEqPreset', '.band-pill', '#aeBandPlace', '#aeAutoBtn', '#aeMatchBtn'].map(ht); out.eqBand = ['#aeBandHear', '#aeBandDyn', '#aeBandType', '#aeBandF'].map(ht);
      aeTool('noise'); await sleep(800); out.noise = ['#aeNrFind', '#aeNrHand', '#aeNrLearn'].map(ht); out.noiseSeg = ht('#aeNrMode');
      aeTool('level'); await sleep(800); out.level = [ht('#aeNormMode'), ht('#aeLoudPreset')]; aeTool('fades'); await sleep(800); out.fades = [ht('#aeFadeSide'), ht('#aeFadeShape')]; return out; });
    ok('The EQ toolbar and band row controls are all 28px, + and − included', h.eqTop.every(v => v === 28) && h.eqBand.every(v => v === 28), JSON.stringify(h));
    ok('Noise reduction buttons are 28px and its method choice 34px', h.noise.every(v => v === 28) && h.noiseSeg === 34, JSON.stringify(h));
    ok('Stand-alone segmented controls and menus are 34px', h.level.every(v => v === 34) && h.fades.every(v => v === 34), JSON.stringify(h));
    await p.close(); }
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
