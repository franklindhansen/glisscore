// While a recording loads with no score open, the Open audio card shows the loading as a bar and carries its own Stop, since there is no loading chip above it.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-load-stop.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => { const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1100, height: 800 } }); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.waitForTimeout(800);
  const r = await p.evaluate(async () => { const o = {}, st = document.querySelector('#btnAudioStop'), card = document.querySelector('#btnAudio2'); o.hiddenAtRest = st.hidden;
    const seq = loadSeq; setBusy('Listening…', 'audio', 'big.wav', 0.4); await sleep(200); o.shown = !st.hidden && card.classList.contains('loading') && /Loading 40%/.test(card.textContent) && st.offsetWidth > 0;
    const a = card.getBoundingClientRect(), s = st.getBoundingClientRect(); o.side = s.left >= a.right - 1 && Math.abs((s.top + s.bottom) / 2 - (a.top + a.bottom) / 2) < 6;
    st.click(); await sleep(300); o.stopped = loadSeq === seq + 1 && !busyMsg && st.hidden && !card.classList.contains('loading') && card.textContent === 'Open audio'; return o; });
  ok('the card shows a Stop beside its loading bar, and Stop ends the loading', r.hiddenAtRest && r.shown && r.side && r.stopped, JSON.stringify(r));
  await p.screenshot({ path: process.argv[2] ? process.argv[2] + '/stop-rest.png' : '/tmp/stop-rest.png' });
  await p.evaluate(() => setBusy('Listening…', 'audio', 'big.wav', 0.6)); await p.waitForTimeout(500); await p.screenshot({ path: process.argv[2] ? process.argv[2] + '/stop-loading.png' : '/tmp/stop-loading.png' });
  ok('no page errors', !errs.length, errs.join('; ')); await b.close(); })();
