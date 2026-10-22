// A button that shows progress keeps one width for every text it can carry, so a changing number never makes it shift: the intro's Open audio button
// (Open audio, Loading…, Loading 0%-100%, Open editor), and the Audio Editor's and PDF Editor's Processing buttons.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/loading-widths.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.waitForTimeout(1500);
  const r = await p.evaluate(() => { const el = document.querySelector('#btnAudio2'), w = new Set([el.offsetWidth]); for (const pc of [null, 0, 1, 7, 11, 14, 33, 77, 99, 100]) { setBusy('Listening…', 'audio', 'x.mp3', pc == null ? null : pc / 100); w.add(el.offsetWidth); } setBusy(''); w.add(el.offsetWidth); return [...w]; });
  ok('the intro button keeps one width from Open audio through Loading 0-100%', r.length === 1, JSON.stringify(r));
  const q = await p.evaluate(() => { const b = document.createElement('button'); b.className = 'btn small primary'; document.body.appendChild(b); b.textContent = 'Crop'; btnHold(b, ['Crop', 'Processing 100%']); const w = new Set(); b.classList.add('loading'); for (const pc of [0, 1, 8, 11, 44, 100]) { b.textContent = 'Processing ' + pc + '%'; w.add(b.offsetWidth); } b.classList.remove('loading'); b.textContent = 'Crop'; w.add(b.offsetWidth); b.remove(); return [...w]; });
  ok('a tool button held with btnHold does not change width from its name through Processing 100%', q.length === 1, JSON.stringify(q));
  ok('no page errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
