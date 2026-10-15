// A page turn holds the trim handles, and the editor says so on the waveform itself: a note and a dashed line where the turn holds the handle, so it never looks like a fault.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-trim-stop.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
function wav(file, secs) { const sr = 48000, n = sr * secs, b = Buffer.alloc(44 + n * 4); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  let s = 1; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const nz = ((s / 0x7fffffff) - 0.5) * 0.12, t = i / sr, v = Math.sin(2 * Math.PI * 110 * t) * 0.3 + Math.sin(2 * Math.PI * 165.5 * t) * 0.2 + nz; b.writeInt16LE(Math.round(v * 32767), 44 + i * 4); b.writeInt16LE(Math.round((v * 0.9 + nz * 0.5) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, b); }
(async () => {
  const f = path.join(os.tmpdir(), 'kf-trim-stop.wav'); wav(f, 120);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => { S.turns = [30, 90]; document.querySelector('[data-audio]').click(); }); await p.waitForTimeout(1500);
  const g = await p.evaluate(() => { const r = document.querySelector('#aeCanvas').getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, xs: aeX(0), xe: aeX(S.audio.duration), x60: aeX(60) }; });
  await p.mouse.move(g.x + g.xs + 2, g.y); await p.mouse.down(); for (let i = 1; i <= 10; i++) await p.mouse.move(g.x + g.xs + (g.x60 - g.xs) * i / 10, g.y); 
  const a = await p.evaluate(() => { const n = document.querySelector('#aeStopNote'); return { vs: AE.d.vStart, hidden: n.hidden, text: n.textContent, op: getComputedStyle(n).opacity, mark: !!AE.stopMark }; });
  await p.mouse.up();
  ok('the start stops before the first page turn and the waveform says why', a.vs < 30 && a.vs > 25 && !a.hidden && /Page turn 1/.test(a.text) && a.mark, JSON.stringify(a));
  await p.waitForTimeout(5000);
  const z = await p.evaluate(() => ({ hidden: document.querySelector('#aeStopNote').hidden, mark: !!AE.stopMark })); ok('the note goes away by itself', z.hidden && !z.mark, JSON.stringify(z));
  ok('no page errors', errs.length === 0, errs.join(' | ')); fs.unlinkSync(f); await b.close();
})();
