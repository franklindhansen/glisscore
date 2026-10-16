// Mains hum row when there is no hum: no "Off" sub-line before a press, a press takes at least 400ms like any other, and "No hum found" stays in the row (said once, no toast) until the next press.
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
    aeTool('noise'); await sleep(300); const small = document.querySelector('#aeNrHumVal'), o = {};
    o.before = { txt: small.textContent, shown: getComputedStyle(small).display !== 'none' };
    const t0 = performance.now(); document.querySelector('#aeNrHum').click(); await sleep(60); for (let i = 0; i < 400 && AE.humBusy; i++) await sleep(10); o.took = performance.now() - t0;
    await sleep(100); o.after = small.textContent; o.toast = /No steady mains hum/.test(document.body.innerText);
    await sleep(6000); o.later = small.textContent; o.laterShown = getComputedStyle(small).display !== 'none';
    document.querySelector('#aeNrHum').click(); await sleep(60); o.again = small.textContent; return o;
  });
  ok('before a press the Mains hum row has no sub-line', !r.before.txt && !r.before.shown, JSON.stringify(r.before));
  ok('a press with no hum takes at least 400ms', r.took >= 400, r.took.toFixed(0) + 'ms');
  ok('it says "No hum found" in the row and nowhere else', r.after === 'No hum found' && !r.toast, JSON.stringify({ after: r.after, toast: r.toast }));
  ok('the message is still there 6s later', r.later === 'No hum found' && r.laterShown, r.later);
  ok('the next press replaces it with the working line', /Looking for a hum/.test(r.again), r.again);
  ok('no errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.unlinkSync(file);
})();
