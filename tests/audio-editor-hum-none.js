// Remove hum when there is no hum: the wait pill shows over the graph like any other wait, a press takes at least 400ms, and "No hum found" comes as a toast with the switch left off.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-hum-none.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, n = sr * 12; let seed = 9; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const wav = Buffer.alloc(44 + n * 2); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round((0.1 * Math.sin(2 * Math.PI * 330 * i / sr) * Math.sin(Math.PI * i / n) + 0.002 * (rnd() - 0.5)) * 32767), 44 + i * 2);
const file = path.join(os.tmpdir(), 'kf-hum-none.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    aeTool('noise'); await sleep(300); const sw = document.querySelector('#aeNrHum'), pill = document.querySelector('#aeNrProgBar'), o = {};
    o.oldRow = !!document.querySelector('#aeNrHumRow, #aeNrHumVal, #aeNrHumBar');
    const t0 = performance.now(); sw.click(); await sleep(80); o.pill = pill.classList.contains('on'); o.pillText = pill.textContent.replace(/\s+/g, ' ').trim(); o.held = sw.disabled;
    for (let i = 0; i < 400 && AE.humBusy; i++) await sleep(10); o.took = performance.now() - t0;
    await sleep(150); o.pillGone = !pill.classList.contains('on'); o.toast = /No hum found/.test(document.body.innerText); o.on = sw.checked; o.hum = AE.d.fx.noise.hum; o.free = !sw.disabled;
    return o;
  });
  ok('the old Mains hum row (its sub-line and bar) is gone', !r.oldRow);
  ok('a press with no hum shows the same wait pill over the graph as every other wait, and holds the switch still meanwhile', r.pill && /^Processing/.test(r.pillText) && r.held, JSON.stringify({ pill: r.pill, text: r.pillText, held: r.held }));
  ok('a press with no hum takes at least 400ms', r.took >= 400, r.took.toFixed(0) + 'ms');
  ok('it then says "No hum found" in a toast, the pill is gone, and the switch is off and free again', r.pillGone && r.toast && !r.on && !r.hum && r.free, JSON.stringify(r));
  ok('no errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.unlinkSync(file);
})();
