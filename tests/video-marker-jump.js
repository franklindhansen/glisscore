// Video editor: Option+Left and Option+Right (Alt on Windows) jump the playhead to the previous or next marker, playing or paused; nothing happens past the ends; the Keyboard shortcuts list has the line.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-marker-jump.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const turns = await p.evaluate(K => { const s = window[K].S; s.turns = [s.vStart + 3, s.vStart + 6, s.vStart + 9]; return s.turns.slice(); }, K);
  const vs = await p.evaluate(K => window[K].S.vStart, K), ve = await p.evaluate(K => window[K].vEnd(), K);
  ok('the score has at least two markers', turns.length >= 2, JSON.stringify(turns));
  const at = t => p.evaluate(([K, t]) => { window[K].Transport.seek(t); }, [K, t]);
  const now = () => p.evaluate(K => window[K].Transport.now(), K);
  const key = k => p.keyboard.press('Alt+' + k);
  const near = (a, b) => Math.abs(a - b) < 0.05;
  // paused
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await at(vs); await key('ArrowRight'); ok('paused: Right from the start goes to the first marker', near(await now(), turns[0]), String(await now()));
  await key('ArrowRight'); ok('paused: Right again goes to the second marker', near(await now(), turns[1]), String(await now()));
  await key('ArrowLeft'); ok('paused: Left goes back to the first marker', near(await now(), turns[0]), String(await now()));
  await at((turns[0] + turns[1]) / 2); await key('ArrowLeft'); ok('paused: Left between markers goes to the one before', near(await now(), turns[0]), String(await now()));
  await at(vs); await key('ArrowLeft'); ok('paused: Left before the first marker does nothing', near(await now(), vs), String(await now()));
  const last = turns[turns.length - 1];
  await at(last); await key('ArrowRight'); const afterLast = await now();
  ok('paused: Right on the last marker goes nowhere but the end, or stays', near(afterLast, last) || near(afterLast, ve), String(afterLast));
  // the credits end is a marker too
  const ce = await p.evaluate(K => { const s = window[K].S; s.set.creditsOn = true; s.credits.title = 'Test'; s.set.creditsEarly = true; s.creditsEnd = Math.min(s.turns[s.turns.length - 1] + 6, window[K].vEnd() - 0.5); return s.creditsEnd; }, K);
  ok('credits end set up', ce != null, String(ce));
  if (ce != null) { await at(last); await key('ArrowRight'); ok('the credits end is the marker after the last turn', near(await now(), ce), String(await now())); await key('ArrowRight'); ok('nothing happens past the credits end', near(await now(), ce), String(await now())); }
  // playing: the playhead jumps and keeps playing
  await at(vs); await p.evaluate(K => window[K].Transport.play(), K); await p.waitForTimeout(300);
  await key('ArrowRight'); await p.waitForTimeout(100);
  const pl = await p.evaluate(K => ({ t: window[K].Transport.now(), on: window[K].Transport.playing }), K);
  ok('playing: Right jumps to the first marker and keeps playing', pl.on && pl.t >= turns[0] - 0.05 && pl.t < turns[0] + 0.8, JSON.stringify(pl));
  await p.evaluate(K => window[K].Transport.pause(), K);
  // plain arrows still move 1s
  await at(vs + 1); await p.keyboard.press('ArrowRight'); ok('plain Right still moves 1s', near(await now(), vs + 2), String(await now()));
  // the shortcuts list
  await p.evaluate(() => document.querySelector('#menuKeys').click());
  const txt = await p.evaluate(() => [...document.querySelectorAll('#keysList dt')].map(d => d.textContent));
  ok('the shortcuts list has "Jump to next or previous marker"', txt.includes('Jump to next or previous marker'), txt.join('|'));
  const dd = await p.evaluate(() => { const dt = [...document.querySelectorAll('#keysList dt')].find(d => d.textContent === 'Jump to next or previous marker'); return dt ? dt.nextElementSibling.textContent.replace(/\s+/g, ' ').trim() : ''; });
  ok('its keys read Option or Alt, then the arrows', /^(Option|Alt) ← →$/.test(dd), dd);
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
