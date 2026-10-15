// The noise tool's Auto: one press works the noise out from the whole recording (no quiet gap to find, no Learn), and Natural then cleans it in two sizes of slice.
// A made recording is used: notes that never stop over steady hiss, with one second of hiss alone at the very end to measure by. Checked in memory and on the disk store:
// Auto sets a profile and stays solid, Trim silence then judges the cleaned sound, pressing it again puts back what was there, the hiss goes down by nearly the Reduction asked for, the music keeps its level, and both stores give the same samples.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-noise-auto.js   (SHOTS=folder also saves pictures of the panel)
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, secs = 30, n = sr * secs, x = new Float32Array(n); let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
{ const scale = [196, 220, 262, 294, 330, 392, 440, 523, 659, 784]; let t = 0; while (t < (secs - 1) * sr) { const dur = Math.round((0.3 + rnd() * 0.8) * sr); for (let v = 0; v < 3; v++) { const f0 = scale[Math.floor(rnd() * scale.length)], amp = 0.04 + rnd() * 0.05; for (let i = 0; i < dur && t + i < (secs - 1) * sr; i++) { const tt = i / sr, env = Math.min(1, tt * 60) * Math.min(1, (dur - i) / (0.05 * sr)); let s = 0; for (let h = 1; h <= 10; h++) s += Math.sin(2 * Math.PI * f0 * h * tt + h) / Math.pow(h, 1.2); x[t + i] += amp * env * s; } } t += Math.round(dur * 0.95); } }
const wav = Buffer.alloc(44 + n * 4); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { const l = x[i] + 0.006 * gauss(), r = x[i] * 0.8 + 0.006 * gauss(); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-noise-auto.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), cut = [];
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ', p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      const press = async () => { document.querySelector('#aeNrFind').click(); await sleep(60); const bar = document.querySelector('#aeNrFind').classList.contains('loading'); for (let i = 0; i < 400 && AE.nrAutoBusy; i++) await sleep(25); await sleep(150); return bar; };
      aeTool('noise'); await sleep(300); const o = {}; o.r0 = aeSilenceRange(); o.bar = await press(); const nz = AE.d.fx.noise; o.auto = !!nz.auto && !!nz.profile; o.on = document.querySelector('#aeNrFind').classList.contains('on'); o.chip = document.querySelector('#aeNrChipTxt').textContent; o.sel = !!AE.nsel;
      await press(); o.back = !AE.d.fx.noise.profile && !document.querySelector('#aeNrFind').classList.contains('on'); await press(); o.again = !!AE.d.fx.noise.auto;
      aeFx(fx => { fx.noise.reduction = 18; }); const d = AE.d, ch = 2, grab = async () => { const mm = S.audio.disk ? await aeMasterDisk(d, ch, false, null) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false), w = new Float32Array(mm.total * ch); await mm.fill(0, mm.total, w); return { w, total: mm.total, sr: mm.sr }; };
      const t0 = performance.now(), y = await grab(); o.ms = Math.round(performance.now() - t0); await fxGet(d.fx); o.r1 = aeSilenceRange(); aeFx(fx => { fx.noise.reduction = 0; }); const u = await grab(), sr = y.sr, rms = (g, a, b) => { let s = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) s += g.w[i] * g.w[i]; return 10 * Math.log10(s / ((b - a) * sr) + 1e-20); };
      o.hiss = rms(u, 29.3, 29.9) - rms(y, 29.3, 29.9); o.music = rms(y, 5, 25) - rms(u, 5, 25); o.cut = Array.from(y.w.subarray(Math.round(12 * sr), Math.round(12 * sr) + 4000)); return o;
    });
    cut.push(r.cut);
    ok(tag + 'Auto shows its bar, sets a profile from the whole recording and stays solid, with nothing left selected', r.bar && r.auto && r.on && r.chip === 'Whole recording' && !r.sel, JSON.stringify({ bar: r.bar, auto: r.auto, on: r.on, chip: r.chip }));
    ok(tag + 'pressing Auto again puts back what was there; once more measures again', r.back && r.again);
    ok(tag + 'with Reduction at 18dB the hiss goes down by nearly that, and the music keeps its level', r.hiss > 14 && r.hiss < 19 && Math.abs(r.music) < 0.6, 'hiss down ' + r.hiss.toFixed(1) + 'dB, music ' + r.music.toFixed(2) + 'dB, ' + r.ms + 'ms for 30s');
    ok(tag + 'Trim silence looks at the cleaned sound: the second of hiss at the end, too loud to count as silence before, is trimmed once the noise is down', r.r0 && r.r0[1] > 29.9 && r.r1 && r.r1[1] > 28.9 && r.r1[1] < 29.6, JSON.stringify([r.r0, r.r1]));
    if (process.env.SHOTS) { await p.evaluate(() => { aeFx(fx => { fx.noise.reduction = 12; }); }); await p.waitForTimeout(2500); for (const [w, h] of [[1040, 820], [700, 900], [390, 800]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.SHOTS, 'nr-' + (disk ? 'disk' : 'mem') + '-' + w + '.png') }); } }
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  let worst = 0; for (let i = 0; i < cut[0].length; i++) worst = Math.max(worst, Math.abs(cut[0][i] - cut[1][i]));
  ok('memory and the disk store clean the recording to the same samples', worst < 2e-4, 'worst ' + worst.toExponential(2));
  await b.close(); fs.unlinkSync(file);
})();
