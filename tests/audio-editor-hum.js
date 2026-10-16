// Mains hum in the noise tool: Remove finds a steady 60Hz hum with its overtones and takes them out (narrow notches ahead of the noise reduction), stays solid, and pressing it again puts the sound back.
// A made recording: notes over a little hiss, with a hum at 60.03Hz and three of its multiples. Checked in memory and on the disk store, with no noise learned and with Auto's profile as well;
// the hum must go down by 30dB or more in what is exported, the music must keep its level, and both stores must give the same samples. A recording with no hum must say so and change nothing.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-hum.js   (SHOTS=folder also saves pictures of the panel)
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, secs = 24, n = sr * secs; let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const music = new Float32Array(n); { const scale = [196, 220, 262, 294, 330, 392, 440, 523]; let t = 0; while (t < n - sr) { const dur = Math.round((0.3 + rnd() * 0.8) * sr); for (let v = 0; v < 2; v++) { const f0 = scale[Math.floor(rnd() * scale.length)], amp = 0.05 + rnd() * 0.05; for (let i = 0; i < dur && t + i < n; i++) { const tt = i / sr, env = Math.min(1, tt * 60) * Math.min(1, (dur - i) / (0.05 * sr)); let s = 0; for (let h = 1; h <= 8; h++) s += Math.sin(2 * Math.PI * f0 * h * tt + h) / h; music[t + i] += amp * env * s; } } t += Math.round(dur * 1.2); } }
const write = (name, hum) => { const wav = Buffer.alloc(44 + n * 4); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { let h = 0; if (hum) for (const [k, a] of [[1, 0.006], [2, 0.003], [3, 0.004], [5, 0.002]]) h += a * Math.sin(2 * Math.PI * 60.03 * k * i / sr + k); const v = music[i] + h; wav.writeInt16LE(Math.round((v + 0.001 * gauss()) * 32767), 44 + i * 4); wav.writeInt16LE(Math.round((v * 0.9 + 0.001 * gauss()) * 32767), 46 + i * 4); }
  const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, wav); return f; };
const humFile = write('kf-hum.wav', true), cleanFile = write('kf-nohum.wav', false);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), cut = [];
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ', p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', humFile); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      const press = async id => { document.querySelector(id).click(); await sleep(60); const bar = (id === '#aeNrHum' ? document.querySelector('#aeNrHumRow') : document.querySelector(id)).classList.contains(id === '#aeNrHum' ? 'busy' : 'loading'); for (let i = 0; i < 400 && (AE.humBusy || AE.nrAutoBusy); i++) await sleep(25); await sleep(150); return bar; };
      const d = AE.d, ch = 2, grab = async () => { const mm = S.audio.disk ? await aeMasterDisk(d, ch, false, null) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false), w = new Float32Array(mm.total * ch); await mm.fill(0, mm.total, w); return { w, total: mm.total, sr: mm.sr }; };
      const part = (g, f) => { let c = 0, s = 0; const a = 4 * g.sr, z = 20 * g.sr; for (let i = a; i < z; i++) { c += g.w[i] * Math.cos(2 * Math.PI * f * i / g.sr); s += g.w[i] * Math.sin(2 * Math.PI * f * i / g.sr); } return 2 * Math.hypot(c, s) / (z - a); }, rms = g => { let s = 0; for (let i = 4 * g.sr; i < 20 * g.sr; i++) s += g.w[i] * g.w[i]; return 10 * Math.log10(s); };
      aeTool('noise'); await sleep(300); const o = {}, u = await grab(); o.bar = await press('#aeNrHum'); const hm = AE.d.fx.noise.hum; o.hum = hm; o.on = document.querySelector('#aeNrHum').checked && document.querySelector('#aeNrHumRow').classList.contains('on'); o.val = document.querySelector('#aeNrHumVal').textContent; o.act = fxActive(AE.d.fx, 2);
      const y = await grab(); o.down = Math.min(...[1, 2, 3, 5].map(k => 20 * Math.log10(part(u, 60.03 * k) / (part(y, 60.03 * k) + 1e-9)))); o.music = rms(y) - rms(u); o.cut = Array.from(y.w.subarray(10 * y.sr, 10 * y.sr + 3000));
      await press('#aeNrFind'); aeFx(fx => { fx.noise.reduction = 12; }); const z = await grab(); o.both = Math.min(...[1, 3].map(k => 20 * Math.log10(part(u, 60.03 * k) / (part(z, 60.03 * k) + 1e-9)))); o.cut2 = Array.from(z.w.subarray(10 * z.sr, 10 * z.sr + 3000));
      if (window.SHOT) await window.SHOT();
      await press('#aeNrHum'); o.off = !AE.d.fx.noise.hum && !document.querySelector('#aeNrHum').checked; return o;
    });
    cut.push([r.cut, r.cut2]);
    ok(tag + 'the Mains hum switch shows its bar, finds the hum at 60Hz with its multiples, turns on and says so in words', r.bar && r.hum && Math.abs(r.hum.f - 60.03) < 0.05 && [1, 2, 3, 5].every(h => r.hum.n.includes(h)) && r.on && /^Removed 60Hz/.test(r.val) && r.act[0] === 'noise', JSON.stringify({ bar: r.bar, on: r.on, hum: r.hum, val: r.val, act: r.act }));
    ok(tag + 'in the export the hum is down by 30dB or more and the music keeps its level', r.down > 30 && Math.abs(r.music + 0.07) < 0.25, 'least ' + r.down.toFixed(1) + 'dB, level ' + r.music.toFixed(2) + 'dB');
    ok(tag + 'with a noise profile as well (Auto), the hum is still out', r.both > 30, 'least ' + r.both.toFixed(1) + 'dB');
    ok(tag + 'pressing Remove again puts the sound back', r.off);
    if (process.env.SHOTS) { await p.evaluate(async () => { document.querySelector('#aeNrHum').click(); for (let i = 0; i < 400 && (AE.humBusy || i < 4); i++) await sleep(25); }); await p.waitForTimeout(1500); for (const [w, h] of [[1040, 820], [390, 900]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.SHOTS, 'hum-' + (disk ? 'disk' : 'mem') + '-' + w + '.png') }); } await p.emulateMedia({ colorScheme: 'dark' }); await p.setViewportSize({ width: 1040, height: 820 }); await p.waitForTimeout(600); await p.screenshot({ path: path.join(process.env.SHOTS, 'hum-' + (disk ? 'disk' : 'mem') + '-dark.png') }); await p.emulateMedia({ colorScheme: 'light' }); }
    // a recording with no hum
    await p.evaluate(() => closeAudioEditor && document.querySelector('#aeCancel').click()); await p.waitForTimeout(500); { const y = await p.$('dialog[open] .btn.primary, .ask .btn.primary'); if (y) await y.click().catch(() => {}); }
    const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.setDefaultTimeout(90000); q.on('pageerror', e => errs.push(e.message));
    await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await q.setInputFiles('#audioIn', cleanFile); await q.waitForFunction(() => S.audio); await q.waitForTimeout(1200); await q.evaluate(() => document.querySelector('[data-audio]').click()); await q.waitForTimeout(700);
    const none = await q.evaluate(async () => { aeTool('noise'); await sleep(300); document.querySelector('#aeNrHum').click(); for (let i = 0; i < 400 && (AE.humBusy || i < 4); i++) await sleep(25); await sleep(200); return { hum: AE.d.fx.noise.hum, on: document.querySelector('#aeNrHum').classList.contains('on'), said: document.querySelector('#aeNrHumVal').textContent === 'No hum found' }; });
    ok(tag + 'a recording with no hum: it says so and changes nothing', !none.hum && !none.on && none.said, JSON.stringify(none));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await q.close(); await p.close();
  }
  for (const k of [0, 1]) { let worst = 0; for (let i = 0; i < cut[0][k].length; i++) worst = Math.max(worst, Math.abs(cut[0][k][i] - cut[1][k][i])); ok('memory and the disk store give the same samples' + (k ? ' with the noise turned down too' : ''), worst < 2e-4, 'worst ' + worst.toExponential(2)); }
  await b.close(); fs.unlinkSync(humFile); fs.unlinkSync(cleanFile);
})();
