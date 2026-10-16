// Dynamic EQ bands in the app: the Dynamic button and its Threshold and Range, a recording held in memory playing through the live EQ (the audio thread's own copy of the same function),
// the same sound from memory and from the disk store, Auto threshold, saved settings, and the types that cannot be dynamic.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-dynamic.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
// stereo 48kHz 24-bit: a 6kHz tone whose level follows amp(t) in both channels (right a tenth of the left when 'skew')
function wav(secs, amp, skew) { const sr = 48000, n = sr * secs, ch = 2, bytes = Buffer.alloc(44 + n * ch * 3); bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + n * ch * 3, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(ch, 22); bytes.writeUInt32LE(sr, 24); bytes.writeUInt32LE(sr * ch * 3, 28); bytes.writeUInt16LE(ch * 3, 32); bytes.writeUInt16LE(24, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * ch * 3, 40);
  for (let i = 0; i < n; i++) { const v0 = amp(i / sr) * Math.sin(2 * Math.PI * 6000 * i / sr); for (let c = 0; c < ch; c++) { const v = Math.round(v0 * (skew && c ? 0.1 : 1) * 8388607) & 0xffffff, o = 44 + (i * ch + c) * 3; bytes[o] = v & 255; bytes[o + 1] = (v >> 8) & 255; bytes[o + 2] = (v >> 16) & 255; } } return bytes; }
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), errs = [];
  const open = async (disk, buffer) => { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk);
    await p.setInputFiles('#audioIn', { name: 'tone.wav', mimeType: 'audio/wav', buffer }); await p.waitForFunction(() => S.audio); await p.waitForTimeout(900); await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, b64: btoa(s) }; }; }); return p; };
  // 12s: quiet (0.01) for the first 8s, loud (0.3) after
  const steps = t => t < 8 ? 0.01 : 0.3, m = await open(0, wav(12, steps));
  const ui = await m.evaluate(async () => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 6000, g: 0, q: 2, on: true }, { type: 'highpass', f: 80, g: 0, q: 0.71, on: true }]; }); AE.band = 0; aeEqPanel(); await sleep(300);
    const btn = document.querySelector('#aeBandDyn'), fold = document.querySelector('#aeBandDynFold'), o = { off: btn.getAttribute('aria-pressed') === 'false' && !fold.classList.contains('open') };
    btn.click(); await sleep(900); o.on = btn.getAttribute('aria-pressed') === 'true' && fold.classList.contains('open') && !!AE.d.fx.eq.bands[0].dyn; o.def = JSON.stringify(AE.d.fx.eq.bands[0].dyn).slice(0, 40);
    const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('#aeBandThr', -22); set('#aeBandRange', -10); await sleep(200); const d = AE.d.fx.eq.bands[0].dyn; o.vals = d.thr === -22 && d.range === -10 && /22/.test(document.querySelector('#aeBandThrVal').textContent) && /10/.test(document.querySelector('#aeBandRangeVal').textContent);
    AE.band = 1; aeEqPanel(); await sleep(200); o.hp = document.querySelector('#aeBandDyn').disabled && !fold.classList.contains('open'); AE.band = 0; aeEqPanel(); await sleep(200);
    return o; });
  ok('the Dynamic button opens Threshold and Range, which change the band; a high-pass cannot be dynamic', ui.off && ui.on && ui.vals && ui.hp, JSON.stringify(ui));
  const norm = await m.evaluate(() => { const f = fxNorm({ eq: { on: true, bands: [{ type: 'peaking', f: 500, g: 2, q: 1, on: true, dyn: { thr: -300, range: 99 } }, { type: 'highpass', f: 90, g: 0, q: 0.7, on: true, dyn: { thr: -20, range: -5 } }, { type: 'peaking', f: 800, g: 0, q: 1, on: true, dyn: { thr: 'x', range: -4 } }] } }); return f.eq.bands.map(x => x.dyn ? [x.dyn.thr, x.dyn.range] : null); });
  ok('saved settings keep a dynamic band within range, and a high-pass loses it', JSON.stringify(norm) === JSON.stringify([[-80, 24], null, [-30, -4]]), JSON.stringify(norm));
  // Auto threshold: loud for a fifth of the time, so the threshold lands just under the loud level (0.3 = −10.5dB in the band)
  const auto = await m.evaluate(async () => { aeFx(fx => { fx.eq.bands = [{ type: 'peaking', f: 6000, g: 0, q: 2, on: true }]; }); AE.band = 0; aeEqPanel(); document.querySelector('#aeBandDyn').click(); await sleep(2500); return AE.d.fx.eq.bands[0].dyn; });
  ok('Auto sets the threshold where the loud part of the band begins', auto && auto.thr >= -17 && auto.thr <= -11, JSON.stringify(auto));
  // Auto works as Balance's Auto does: pressed when the threshold is the measured one, pressing it again puts the slider back, moving the slider lets it go; while it reads, the button is a loading bar
  const au = await m.evaluate(async () => { aeFx(fx => { fx.eq.bands = [{ type: 'peaking', f: 6000, g: 0, q: 2, on: true }]; }); AE.band = 0; aeEqPanel(); await sleep(200);
    const btn = document.querySelector('#aeBandThrAuto'), o = {}; let sawBar = false; const watch = setInterval(() => { if (btn.classList.contains('loading') && /Processing \d+%/.test(btn.textContent) && btn.style.getPropertyValue('--p')) sawBar = true; }, 5);
    document.querySelector('#aeBandDyn').click(); await sleep(2500); clearInterval(watch); o.bar = sawBar; o.end = !btn.classList.contains('loading') && btn.textContent === 'Auto';
    const d = () => AE.d.fx.eq.bands[0].dyn, pressed = () => btn.getAttribute('aria-pressed') === 'true' && btn.classList.contains('on');
    o.on = pressed() && d().thr === d().auto && d().prev === -30; const measured = d().thr;
    const sl = document.querySelector('#aeBandThr'); sl.value = -40; sl.dispatchEvent(new Event('input', { bubbles: true })); sl.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200); o.freed = !pressed() && d().thr === -40;
    btn.click(); await sleep(2500); o.again = pressed() && d().thr === measured && d().prev === -40;
    btn.click(); await sleep(300); o.back = !pressed() && d().thr === -40 && d().auto === undefined; return o; });
  ok('Auto threshold: a loading bar while it reads; pressed when set, the slider goes back when it is pressed again, moving the slider lets it go', au.bar && au.end && au.on && au.freed && au.again && au.back, JSON.stringify(au));
  // the live EQ (audio thread): the loud part is turned down by the range, the quiet part is not
  const live = await m.evaluate(async () => { aeFx(fx => { fx.eq.on = true; fx.eq.auto = false; fx.eq.bands = [{ type: 'peaking', f: 6000, g: 0, q: 2, on: true, dyn: { thr: -30, range: -8 } }]; }); await sleep(300);
    AE.pos = 0; document.querySelector('#aePlay').click(); await sleep(800); const ac = AE.g.context;
    const code = "registerProcessor('rec7', class extends AudioWorkletProcessor { process(i) { if (i[0] && i[0][1]) { let a = 0, c = 0; for (let k = 0; k < i[0][0].length; k++) { a += i[0][0][k] ** 2; c += i[0][1][k] ** 2; } this.port.postMessage({ f: currentFrame, l: a / i[0][0].length, r: c / i[0][1].length }); } return true; } });";
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec7', { numberOfInputs: 1, numberOfOutputs: 0 }), got = []; rec.port.onmessage = e => got.push(e.data); AE.g.connect(rec);
    await sleep(1500); const quiet = got.slice(-200); AE.pos = 8.3; AE.seek && AE.seek(8.3); return { n: got.length, quiet: 10 * Math.log10(quiet.reduce((s, g) => s + g.l, 0) / quiet.length) }; });
  ok('a quiet tone through the live dynamic band stays at its own level', live.n > 50 && Math.abs(live.quiet - 20 * Math.log10(0.01 / Math.SQRT2)) < 0.3, JSON.stringify(live));
  await m.evaluate(() => document.querySelector('#aePlay').click()).catch(() => {}); await m.close();
  // loud all the way: the live band against the same sound with the band set to the full range
  const all = wav(4, () => 0.3), ml = await open(0, all);
  const lv = await ml.evaluate(async () => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.auto = false; fx.eq.bands = [{ type: 'peaking', f: 6000, g: 0, q: 2, on: true, dyn: { thr: -30, range: -8 } }]; }); await sleep(300); document.querySelector('#aePlay').click(); await sleep(900); const ac = AE.g.context;
    const code = "registerProcessor('rec8', class extends AudioWorkletProcessor { process(i) { if (i[0] && i[0][1]) { let a = 0; for (let k = 0; k < i[0][0].length; k++) a += i[0][0][k] ** 2; this.port.postMessage(a / i[0][0].length); } return true; } });";
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec8', { numberOfInputs: 1, numberOfOutputs: 0 }), got = []; rec.port.onmessage = e => got.push(e.data); AE.g.connect(rec); await sleep(1200); document.querySelector('#aePlay').click();
    return { n: got.length, db: 10 * Math.log10(got.reduce((s, g) => s + g, 0) / got.length) - 10 * Math.log10(0.3 * 0.3 / 2) }; });
  ok('a loud tone through the live dynamic band comes down by the range on the audio thread', lv.n > 50 && Math.abs(lv.db + 8) < 0.3, JSON.stringify(lv)); await ml.close();
  // memory and the disk store export the same sound with dynamic bands (some below, some above their thresholds)
  const mix = t => (t < 1 ? 0.01 : t < 2 ? 0.1 : t < 3 ? 0.3 : 0.02), A = wav(5, mix);
  const exp = async disk => { const p = await open(disk, A); await p.evaluate(async () => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.auto = false; fx.eq.bands = [{ type: 'peaking', f: 6000, g: 1, q: 2, on: true, dyn: { thr: -25, range: -9 } }, { type: 'highshelf', f: 3000, g: 0, q: 0.71, on: true, dyn: { thr: -20, range: 4 }, place: 'mid' }]; }); S.set.audioFormat = 'wav24'; window.__saved = null; });
    for (let i = 0; i < 80; i++) { if (await p.evaluate(() => !!fxPeek(AE.d.fx))) break; await p.waitForTimeout(250); } await p.evaluate(() => aeExport()); for (let i = 0; i < 120; i++) { if (await p.evaluate(() => !!window.__saved)) break; await p.waitForTimeout(250); } const r = await p.evaluate(() => window.__saved); await p.close(); return r; };
  const fa = await exp(0), fb = await exp(1);
  if (fa && fb) { const x = Buffer.from(fa.b64, 'base64'), y = Buffer.from(fb.b64, 'base64'); let worst = 0, moved = 0; for (let i = 44; i + 2 < x.length && i + 2 < y.length; i += 3) { const v = k => ((k[i] | (k[i + 1] << 8) | (k[i + 2] << 16)) << 8 >> 8) / 8388608; worst = Math.max(worst, Math.abs(v(x) - v(y))); }
    ok('the disk store and memory export the same sound with dynamic bands', x.length === y.length && worst < 1e-6, x.length + ' / ' + y.length + ' bytes, worst ' + worst.toExponential(2)); } else ok('exports made', false);
  console.log(errs.length ? 'FAIL page errors: ' + errs.join('; ') : 'PASS no page errors'); await b.close(); process.exit(0);
})();
