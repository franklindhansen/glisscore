// The video timeline's waveform shows loudness: it is drawn at real level against a fixed full scale, clipped at the top of the lane,
// follows the limiter's shape, and redraws when Done is pressed in the Audio Editor (in memory and on the disk store).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-timeline-loudness.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 22050, secs = 20, n = sr * secs, wav = Buffer.alloc(44 + n * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(0.2 * 32767 * Math.sin(2 * Math.PI * 330 * i / sr)), 44 + i * 2);          // a steady quiet tone, peaking at 0.2
const file = path.join(os.tmpdir(), 'kf-tl-loud.wav'), pdfFile = path.join(os.tmpdir(), 'kf-tl-loud.pdf');
fs.writeFileSync(file, wav);
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 4; i++) doc.addPage([612, 792]); fs.writeFileSync(pdfFile, await doc.save());
  const b = await chromium.launch();
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ', p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#pdfIn', pdfFile); await p.setInputFiles('#audioIn', file);
    await p.waitForFunction(() => S.pdf && S.audio && S.audio.duration > 15); await p.waitForTimeout(1500);
    // the drawn height (in pixels) of the wave at the middle of the lane, read from the timeline's own picture
    await p.evaluate(() => { window.waveH = () => { drawTimelineStatic(); const c = TL.sc, x = Math.round(TL.dpr * TL.vw / 2), y0 = Math.round(TL.dpr * TL.waveY), h = Math.round(TL.dpr * TL.waveH), d = TL.sctx.getImageData(x, y0, 1, h).data, t = document.createElement('canvas').getContext('2d'); t.fillStyle = TL.C.wave; t.fillRect(0, 0, 1, 1); const w = t.getImageData(0, 0, 1, 1).data; let k = 0; for (let i = 0; i < h; i++) if (Math.abs(d[i * 4] - w[0]) < 6 && Math.abs(d[i * 4 + 1] - w[1]) < 6 && Math.abs(d[i * 4 + 2] - w[2]) < 6) k++; return { k, half: TL.dpr * (TL.waveH / 2 - 3) }; }; });
    const done = async set => { await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700); await p.evaluate(set); await p.waitForTimeout(500); await p.click('#aeDone'); await p.waitForTimeout(900); };
    const h0 = await p.evaluate(() => waveH());
    ok(tag + 'a quiet recording looks short, about its real level (0.2 of full scale)', Math.abs(h0.k / (2 * h0.half) - 0.2) < 0.03, JSON.stringify(h0));
    await done(() => { AE.d.gainDb = 6; aeRefresh(); });
    const h1 = await p.evaluate(() => waveH());
    ok(tag + 'after +6dB and Done the wave is about twice as tall', Math.abs(h1.k / h0.k - 1.995) < 0.3, JSON.stringify([h0.k, h1.k]));
    await done(() => { AE.d.gainDb = 16; aeRefresh(); });
    const h2 = await p.evaluate(() => waveH());
    ok(tag + 'a boosted recording clips at the top of the lane, never past it', h2.k > 0.9 * 2 * h2.half && h2.k <= 2 * h2.half + 1, JSON.stringify(h2));
    await done(() => { AE.d.gainDb = 0; AE.d.normalize = true; AE.d.normBy = 'loud'; AE.d.normLufs = -9; AE.d.normPreset = 'custom'; AE.d.limiter = true; aeRefresh(); });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(async () => { const h = waveH(), cap = Math.pow(10, (LIM_CEIL - LIM_GUARD) / 20), g = audioGain(); return { h, cap, g }; });
    ok(tag + 'with the limiter on the wave stays under the limiter\'s ceiling', r.h.k <= r.cap * 2 * r.h.half + 1.5 && r.h.k > 0.2 * 2 * r.h.half, JSON.stringify(r));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close(); fs.unlinkSync(file); fs.unlinkSync(pdfFile);
})();
