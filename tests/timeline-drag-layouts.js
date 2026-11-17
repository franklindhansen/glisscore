// A page turn's handle moves when you press and drag it with the mouse, in Spread, Single page, and System, in the same window sizes the settings panel changes layout at, and after the editors, Restore defaults, and Undo have been used.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-drag-layouts.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 10; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-dragl.pdf'); fs.writeFileSync(pdf, await doc.save());
  const sr = 8000, n = sr * 30, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(60 * Math.sin(i / 20));
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf); await p.setInputFiles('#audioIn', { name: 'a.wav', mimeType: 'audio/wav', buffer: wav });
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.pdf.n >= 10 && window[K].S.audio && window[K].S.audio.buffer, K); await p.waitForTimeout(1500);
  await p.click('#bSpace'); await p.waitForTimeout(400);
  const info = () => p.evaluate(K => { const k = window[K], r = k.TL.canvas.getBoundingClientRect(); return { turns: k.S.turns.slice(), xs: k.S.turns.map(t => k.t2x(t)), left: r.left, top: r.top, trackY: k.TL.trackY, trackH: k.TL.trackH }; }, K);
  const drag = async tag => {
    const a = await info(), i = Math.min(2, a.turns.length - 1), x = a.left + a.xs[i], y = a.top + a.trackY + a.trackH / 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 15, y, { steps: 4 }); await p.mouse.move(x + 45, y, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(150);
    const c = await info(); ok(tag + ': dragging a turn handle moves it', c.turns[i] > a.turns[i] + 0.2, a.turns[i].toFixed(2) + ' to ' + c.turns[i].toFixed(2));
    await p.keyboard.press('Control+z'); await p.waitForTimeout(150);
  };
  const layout = async L => { await p.evaluate(L => { const r = document.querySelector('input[name=pageLayout][value=' + L + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, L); await p.waitForFunction(() => typeof SYS === 'undefined' || !SYS.prog, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1200); await p.click('#bFit').catch(() => {}); await p.waitForTimeout(300); };
  for (const L of ['spread', 'single', 'system']) { await layout(L); await drag(L); }
  await layout('spread');
  for (const w of [1100, 900, 700]) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(500); await drag('window ' + w); }
  await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(400);
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(700); await p.keyboard.press('Escape'); await p.waitForTimeout(700); await drag('after the Audio Editor');
  await p.evaluate(() => restoreDefaults()); await p.waitForTimeout(500); await drag('after Restore defaults');
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
