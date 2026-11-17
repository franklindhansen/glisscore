// Video fades: the picture on the stage really is as bright as the Fades panel's length says (measured from the pixels, while scrubbing and while playing), for Auto (1.0s on a long video), 2.0s, and 0.5s.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-fades-render.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
function wav(sec) { const n = 8000 * sec, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i * 0.05)), 44 + i * 2); return b; }
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2);
  await p.setInputFiles('#audioIn', { name: 'long.wav', mimeType: 'audio/wav', buffer: wav(24) }); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(1200);
  const box = await p.locator('#stage').boundingBox();
  const mean = async () => { const buf = await p.screenshot({ clip: { x: box.x + box.width * .35, y: box.y + box.height * .3, width: box.width * .3, height: box.height * .4 } }); return p.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4) / 255; }, buf.toString('base64')); };
  await p.evaluate(K => window[K].Transport.seek(5), K); await p.waitForTimeout(400); const full = await mean();
  const scrub = async t => { const pt = await p.evaluate(([K, t]) => { const { TL, t2x } = window[K], r = TL.canvas.getBoundingClientRect(); return { x: r.left + t2x(t), y: r.top + TL.rulerH / 2 }; }, [K, t]); await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(400); };
  const math = () => p.evaluate(K => { const k = window[K]; return { t: k.S.time, f: k.frameState(k.S.time).fade }; }, K);
  ok('Auto is 1.0s on a 24s video', (await p.evaluate(() => document.querySelector('#fadeLenVal').textContent)).startsWith('Auto · 1.0s'));
  await p.locator('#fadeLen').scrollIntoViewIfNeeded();
  for (const [label, v] of [['Auto 1.0s', null], ['2.0s', 20], ['0.5s', 5]]) {
    if (v != null) { await p.evaluate(v => { const r = document.querySelector('#fadeLen'); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }, v); await p.waitForTimeout(300); }
    let worst = 0, seen = [];
    for (const t of [0.5, 0.75, 1.5]) { await scrub(t); const m = await math(); const shown = (await mean()) / full; worst = Math.max(worst, Math.abs(shown - m.f)); seen.push(m.t.toFixed(2) + ':' + shown.toFixed(2) + '/' + m.f.toFixed(2)); }
    ok(label + ': scrubbing, the picture is as bright as the fade says', worst < 0.04, seen.join(' '));
  }
  await p.evaluate(() => { const r = document.querySelector('#fadeLen'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  await p.evaluate(K => { window[K].Transport.seek(0); window[K].Transport.play(); }, K); let worst = 0, seen = [];
  for (let i = 0; i < 6; i++) { const shown = (await mean()) / full, m = await math(); worst = Math.max(worst, Math.abs(shown - m.f)); seen.push(m.t.toFixed(2) + ':' + shown.toFixed(2) + '/' + m.f.toFixed(2)); }
  ok('2.0s: playing, the picture rises over two seconds in step with the fade', worst < 0.12 && seen.length === 6, seen.join(' '));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
