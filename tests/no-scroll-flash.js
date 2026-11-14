// Switching tools must never flash a scroll bar: a box that scrolls only when its tool is taller than its window has no overflow while the tools slide past each other.
// For each screen size, every tool is opened in turn and, on every frame of the slide, each box that can scroll is checked; one that has nothing to scroll before and after the switch must have nothing to scroll during it.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/no-scroll-flash.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 22050, n = sr * 3, wav = Buffer.alloc(44 + n * 4); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { const v = Math.round(6000 * Math.sin(i / sr * 2 * Math.PI * 220)); wav.writeInt16LE(v, 44 + i * 4); wav.writeInt16LE(Math.round(v * 0.8), 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-scroll-flash.wav'); fs.writeFileSync(file, wav);
const watch = `(root, steps) => new Promise(async res => {
  const z = ms => new Promise(r => setTimeout(r, ms)), scrollers = () => [...document.querySelectorAll(root + ' *')].filter(e => { const c = getComputedStyle(e); return /auto|scroll/.test(c.overflowY + c.overflowX) && c.display !== 'none'; });
  const over = e => e.scrollHeight > e.clientHeight + 0.5 || e.scrollWidth > e.clientWidth + 0.5, key = e => e.id || e.className || e.tagName, bad = new Set();
  for (const step of steps) {
    const before = new Set(scrollers().filter(over)); let run = true, seen = new Set();
    const loop = () => { if (!run) return; scrollers().filter(over).forEach(e => seen.add(e)); requestAnimationFrame(loop); }; loop();
    await step(); await z(1000); run = false; const after = new Set(scrollers().filter(over));
    seen.forEach(e => { if (!before.has(e) && !after.has(e)) bad.add(key(e)); });
  }
  res([...bad]);
})`;
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [w, h] of [[1440, 900], [1440, 790], [1440, 760], [1100, 780], [1300, 700]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1000);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(800);
    const bad = await p.evaluate(`(${watch})('#audioDlg', ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu', 'noise', 'level'].map(t => () => aeTool(t)))`);
    ok('Audio Editor at ' + w + 'x' + h + ': switching tools never shows a scroll bar that is not needed', !bad.length, bad.join(', '));
    await p.close();
  }
  for (const [w, h] of [[1440, 900], [1300, 700]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', 'tests/fixtures/score.pdf'); await p.waitForTimeout(2000);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500);
    const bad = await p.evaluate(`(${watch})('#pdfDlg', ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm', 'pages'].map(t => () => peTool(t)))`);
    ok('PDF Editor at ' + w + 'x' + h + ': switching tools never shows a scroll bar that is not needed', !bad.length, bad.join(', '));
    await p.close();
  }
  ok('no script errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
