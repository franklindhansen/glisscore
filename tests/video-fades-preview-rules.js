// Video fades, the preview's four rules: playing shows the video (fades included); paused after any jump (Enter, back to start, the selector, a marker jump, undo) shows the full picture even after a scrub to 0:00;
// paused where you scrubbed shows the fade there; playback that reaches the end keeps the faded last frame until the playhead moves. Spread, Single page, and System.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-fades-preview-rules.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
function wav(sec) { const n = 8000 * sec, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(i * 0.05)), 44 + i * 2); return b; }
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2);
  await p.setInputFiles('#audioIn', { name: 'a.wav', mimeType: 'audio/wav', buffer: wav(6) }); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(1000);
  const box = await p.locator('#stage').boundingBox();
  const shot = async () => { const d = await p.evaluate(() => { const e = document.querySelector('#sysDiv'); return e && !e.hidden && e.offsetParent ? e.getBoundingClientRect().right : 0; }), x0 = Math.max(box.x + box.width * .3, d + 20), x1 = box.x + box.width * .7; const buf = await p.screenshot({ clip: { x: x0, y: box.y + box.height * .25, width: Math.max(20, x1 - x0), height: box.height * .5 } }); return p.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4) / 255; }, buf.toString('base64')); };
  const scrub = async t => { if (t === 0) { const pt = await p.evaluate(K => { const r = window[K].TL.canvas.getBoundingClientRect(); return { x: r.left + 1, y: r.top + window[K].TL.rulerH / 2 }; }, K); await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(350); return; }  const pt = await p.evaluate(([K, t]) => { const { TL, t2x } = window[K], r = TL.canvas.getBoundingClientRect(); return { x: r.left + t2x(t), y: r.top + TL.rulerH / 2 }; }, [K, t]); await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(350); };
  const key = async k => { await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press(k); await p.waitForTimeout(350); };
  await p.evaluate(K => { const s = window[K].S.set; s.fadesOn = true; s.fadeIn = true; s.fadeOut = true; s.fadeAuto = false; s.fadeAutoOut = false; s.fadeLen = 10; s.fadeSplit = false; s.fadeShape = 'linear'; window[K].S.time = 3; window[K].stageDirty = true; }, K);
  await p.waitForTimeout(300);
  for (const lay of ['spread', 'single', 'system']) {
    await p.evaluate(l => { const r = document.querySelector('input[name=pageLayout][value=' + l + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, lay);
    if (lay === 'system') await p.waitForFunction(() => !SYS.prog && SYS.byPage.size >= new Set(S.pdf.keep).size).catch(() => {});
    await p.waitForTimeout(800);
    await p.evaluate(K => { window[K].Transport.seek(3); }, K); await p.waitForTimeout(400); const full = await shot();
    const L = lay + ': ';
    await scrub(0); const black = await shot();
    ok(L + 'scrubbed to the start, the paused picture is the fade-in frame (black)', black < full * 0.1, black.toFixed(2) + ' of ' + full.toFixed(2));
    await p.evaluate(K => { window[K].Transport.seek(3); }, K); await p.waitForTimeout(300);
    await key('Enter'); const enter = await shot(); ok(L + 'Enter after a scrub to the start and another move shows the full picture', enter > full * 0.9 && (await p.evaluate(K => window[K].S.time === window[K].S.vStart, K)), enter.toFixed(2));
    await scrub(0); await p.evaluate(K => window[K].Transport.seek(2), K); await p.waitForTimeout(250); await p.click('#bStart'); await p.waitForTimeout(350);
    const back = await shot(); ok(L + 'the back-to-start button shows the full picture', back > full * 0.9, back.toFixed(2));
    await scrub(0); await p.evaluate(K => { window[K].Transport.seek(2); window[K].Transport.seek(0); }, K); await p.waitForTimeout(350);
    ok(L + 'any other move to the same time shows the full picture', (await shot()) > full * 0.9);
    await scrub(0.4); const part = await shot(), f = await p.evaluate(K => window[K].frameState(window[K].S.time).fade, K); ok(L + 'a timeline scrub shows the fade at that time', Math.abs(part / full - f) < 0.08 && f < 0.9, part.toFixed(2) + '/' + full.toFixed(2) + ' vs ' + f.toFixed(2));
    await p.evaluate(K => { const k = window[K]; k.Transport.seek(k.duration() - 0.6); k.Transport.play(); }, K);
    await p.waitForFunction(K => !window[K].Transport.playing, K, { timeout: 10000 }); await p.waitForTimeout(500);
    const end = await shot(); ok(L + 'playback reaching the end keeps the faded last frame', end < full * 0.1, end.toFixed(2));
    await p.waitForTimeout(600); ok(L + 'and it stays', (await shot()) < full * 0.1);
    await p.evaluate(K => window[K].Transport.seek(3), K); await p.waitForTimeout(350); ok(L + 'a move after the end shows the full picture', (await shot()) > full * 0.9);
    await p.evaluate(K => { window[K].Transport.seek(0); window[K].Transport.play(); }, K); await p.waitForTimeout(120);
    const pl = await shot(); await p.evaluate(K => window[K].Transport.pause(), K); ok(L + 'playing from the start shows the fade-in', pl < full * 0.9, pl.toFixed(2));
  }
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
