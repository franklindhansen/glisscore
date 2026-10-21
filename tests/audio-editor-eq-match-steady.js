// EQ Match: loading a reference does not change the graph's height, nor the card's on a wide screen (on a phone the two buttons wrap, so the card is taller; the reference chip is as tall as one row of buttons), and Turn into bands on a flat match says so and keeps the match as it is.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-match-steady.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [w, h] of [[1280, 800], [390, 800]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav'); await p.waitForFunction(() => S.audio && S.audio.buffer);
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(800); await p.evaluate(() => aeTool('eq')); await p.waitForTimeout(500);
    await p.click('#aeMatchBtn'); await p.waitForTimeout(800);
    const size = () => p.evaluate(() => ({ card: document.querySelector('#aeMatch').getBoundingClientRect().height, step: document.querySelector('#aeRefStep').getBoundingClientRect().height, graph: document.querySelector('#aeEqCv') ? document.querySelector('#aeEqCv').getBoundingClientRect().height : 0 }));
    const empty = await size(); await p.setInputFiles('#aeRefIn', process.env.S + '/loud.mp3'); await p.waitForFunction(() => AE.match && AE.match.ref); await p.waitForTimeout(500);
    const loaded = await size(), tag = w + 'x' + h + ': ';
    ok(tag + 'a reference arriving does not change the EQ Match card or the graph', (w < 700 || Math.abs(empty.card - loaded.card) < 0.5) && Math.abs(empty.graph - loaded.graph) < 0.5, JSON.stringify({ empty, loaded }));
    const flat = await p.evaluate(async () => { AE.d.fx.eq.curve = new Array(AE.d.fx.eq.curve.length).fill(0); aeFx(() => {}); document.querySelector('#aeRefBands').click(); await new Promise(r => setTimeout(r, 400)); return { bands: AE.d.fx.eq.bands.length, curve: !!AE.d.fx.eq.curve, open: AE.matchOpen, toast: [...document.querySelectorAll('.toast, #toast')].map(t => t.textContent).join('|') }; });
    ok(tag + 'Turn into bands on a flat match says so and keeps the match', flat.bands === 0 && flat.curve && flat.open && /already flat/.test(flat.toast), JSON.stringify(flat));
    await p.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
