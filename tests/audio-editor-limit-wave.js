// The waveform shows the sound that comes out. With a loudness target and the limiter on, the picture is drawn from the limiter's own output (how much it takes off every 10ms),
// so it matches the export and never shows the red clip marks; with the limiter off, sound that goes over full scale still shows them.
// A quiet tone with a few loud hits is used, so the volume the target asks for pushes the hits well past the ceiling and the limiter takes seconds to let go after each
// (the disk store measures only the stretches the limiter works on, and has to follow it until it has let go). Checked in memory and on the disk store.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-limit-wave.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, secs = 12, n = sr * secs, wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { const t = i / sr, hit = [2.2, 5.1, 5.6, 9.3].some(h => t >= h && t < h + 0.12), v = (hit ? 0.8 : 0.06) * Math.sin(2 * Math.PI * 330 * t) + 0.02 * Math.sin(2 * Math.PI * 1900 * t); wav.writeInt16LE(Math.round(v * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(v * 0.9 * 32767), 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-limit-wave.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ', p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      const red = () => { aeDraw(); const cv = AE.baseW, d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 110 && d[i + 2] < 110 && d[i + 3] > 200) k++; return k; };
      aeTool('level'); const d = AE.d; d.normalize = true; d.normBy = 'loud'; d.normLufs = -9; d.normPreset = 'custom'; d.limiter = true; aeRefresh();
      const ch = 2, mm = S.audio.disk ? await aeMasterDisk(d, ch, false, null) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false), total = mm.total, want = new Float32Array(total * ch); await mm.fill(0, total, want);          // the export's samples
      aeRefresh(); await sleep(700); const l = limPeek(d), g = aeLevel(d, 0, S.audio.duration), shown = aeShownPeaks(d), raw = aePeaks(d), per = mm.sr / 100; let worst = 0, over = 0, rawOver = 0, top = 0;
      for (let j = 1; j + 1 < Math.min(shown.length, Math.floor(total / per)); j++) { let m = 0; for (let c = 0; c < ch; c++) for (let k = Math.round(j * per); k < Math.round((j + 1) * per); k++) m = Math.max(m, Math.abs(want[c * total + k])); worst = Math.max(worst, Math.abs(shown[j] * g - m)); top = Math.max(top, shown[j] * g); if (shown[j] * g > 1) over++; if (raw[j] * g > 1) rawOver++; }
      await sleep(400); const redOn = red(); d.limiter = false; aeRefresh(); await sleep(700); const redOff = red();
      return { part: l && l.part, g, worst, over, rawOver, top, ceil: Math.pow(10, LIM_CEIL / 20), redOn, redOff };
    });
    ok(tag + 'the volume for the target pushes the hits past full scale, and the limiter works on part of the sound only', r.rawOver > 20 && r.g > 1.5 && (r.part == null || (r.part > 0 && r.part < 1)), JSON.stringify({ g: r.g, over: r.rawOver, part: r.part }));
    ok(tag + 'the heights drawn are the heights of the export, every 10ms', r.worst < 0.004 && r.over === 0 && r.top <= r.ceil, 'worst ' + r.worst.toFixed(5) + ', highest ' + r.top.toFixed(4) + ' (ceiling ' + r.ceil.toFixed(4) + ')');
    ok(tag + 'no red clip marks with the limiter on; they show when it is off and the sound goes over', r.redOn === 0 && r.redOff > 0, r.redOn + ' red pixels on, ' + r.redOff + ' off');
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close(); fs.unlinkSync(file);
})();
