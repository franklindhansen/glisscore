// Noise sample and Emulator cards have no state line (the buttons, chip, tool light and Removal card already say it), and Learn noise is a loading-bar button like Auto.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-state-line-gone.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, n = sr * 12; let seed = 9; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const wav = Buffer.alloc(44 + n * 2); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round((0.1 * Math.sin(2 * Math.PI * 330 * i / sr) * Math.sin(Math.PI * i / n) + 0.01 * (rnd() - 0.5)) * 32767), 44 + i * 2);
const file = path.join(os.tmpdir(), 'kf-state-line.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    const o = {}; aeTool('noise'); await sleep(400);
    AE.nsel = { a: 1, b: 3 }; aeRefresh(); await sleep(100);
    const btn = document.querySelector('#aeNrLearn'); o.start = { txt: btn.textContent, loading: btn.classList.contains('loading') };
    const t0 = performance.now(), seen = []; btn.click();
    for (let i = 0; i < 600 && (i < 3 || AE.nrLearning); i++) { await sleep(10); seen.push({ loading: btn.classList.contains('loading'), txt: btn.textContent, p: btn.style.getPropertyValue('--p'), dis: btn.disabled, line: !!document.querySelector('.ae-state') }); }
    o.took = performance.now() - t0; o.seen = seen; await sleep(300);
    o.end = { txt: btn.textContent, loading: btn.classList.contains('loading'), p: btn.style.getPropertyValue('--p'), profile: !!AE.d.fx.noise.profile };
    o.nrLine = !!document.querySelector('#aeNrSample .ae-state'); aeTool('emu'); await sleep(500); o.emLine = !!document.querySelector('#aeEmCard .ae-state'); o.anyLine = !!document.querySelector('.ae-state');
    return o;
  });
  ok('Learn noise is a loading-bar button: while it works it shows "Processing N%" with a bar', r.seen.length && r.seen.some(f => f.loading && /^Processing \d+%$/.test(f.txt) && f.p !== '') && r.seen.every(f => f.dis || !f.loading), JSON.stringify(r.seen.slice(0, 3)));
  ok('it holds the bar for at least 400ms, then goes back to a normal button with the noise learned', r.took >= 400 && r.end.profile && !r.end.loading && r.end.p === '' && /Learn again/.test(r.end.txt), JSON.stringify({ took: Math.round(r.took), end: r.end }));
  ok('no state line shows while it learns', r.seen.every(f => !f.line));
  ok('the Noise sample card has no state line', !r.nrLine);
  ok('the Emulator card has no state line', !r.emLine && !r.anyLine);
  ok('no errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.unlinkSync(file);
})();
