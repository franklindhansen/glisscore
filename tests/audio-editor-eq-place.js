// EQ bands that work on the mid or the side: the panel's Stereo | Mid | Side choice, the same sound from the app's own sums, the browser's filters, the live audio thread and the disk store,
// Listen on a mid or side band, a mono recording, and the curves drawn.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-eq-place.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
// 3s stereo, 48kHz, 24-bit: 1kHz the same in both channels (mid) and 3kHz opposite in the two (side)
function wav(ch, secs) { const sr = 48000, n = sr * (secs || 3), bytes = Buffer.alloc(44 + n * ch * 3); bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + n * ch * 3, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(ch, 22); bytes.writeUInt32LE(sr, 24); bytes.writeUInt32LE(sr * ch * 3, 28); bytes.writeUInt16LE(ch * 3, 32); bytes.writeUInt16LE(24, 34); bytes.write('data', 36); bytes.writeUInt32LE(n * ch * 3, 40);
  for (let i = 0; i < n; i++) { const m = 0.2 * Math.sin(2 * Math.PI * 1000 * i / sr), s = 0.2 * Math.sin(2 * Math.PI * 3000 * i / sr); for (let c = 0; c < ch; c++) { const v = Math.round((ch === 1 ? m : c ? m - s : m + s) * 8388607) & 0xffffff, o = 44 + (i * ch + c) * 3; bytes[o] = v & 255; bytes[o + 1] = (v >> 8) & 255; bytes[o + 2] = (v >> 16) & 255; } } return bytes; }
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), errs = [];
  const open = async (disk, ch, secs) => { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:8123/index.html?disk=' + disk);
    await p.setInputFiles('#audioIn', { name: 'tones.wav', mimeType: 'audio/wav', buffer: wav(ch, secs) }); await p.waitForFunction(() => S.audio); await p.waitForTimeout(900); await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, b64: btoa(s) }; }; }); return p; };
  const BANDS = [{ type: 'peaking', f: 1000, g: 6, q: 1, on: true, place: 'mid' }, { type: 'peaking', f: 3000, g: -5, q: 1.2, on: true, place: 'side' }, { type: 'highpass', f: 60, g: 0, q: 0.71, on: true }];
  const m = await open(0, 2);
  // the panel
  const ui = await m.evaluate(async () => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 1000, g: 3, q: 1, on: true }]; }); AE.band = 0; aeEqPanel(); await sleep(300);
    const seg = document.querySelector('#aeBandPlace'), vis = !seg.hidden && seg.offsetWidth > 0, r = v => document.querySelector('input[name=aeBandPlace][value=' + v + ']');
    const o = { vis, start: r('st').checked }; r('side').click(); await sleep(200); o.side = AE.d.fx.eq.bands[0].place === 'side' && r('side').checked; r('mid').click(); await sleep(100); o.mid = AE.d.fx.eq.bands[0].place === 'mid'; r('st').click(); await sleep(100); o.st = AE.d.fx.eq.bands[0].place === undefined;
    r('side').click(); await sleep(100); aeUndo && aeUndo(); await sleep(200); o.undo = AE.d.fx.eq.bands[0].place === undefined && r('st').checked; return o; });
  ok('the panel offers Stereo, Mid and Side for the selected band, and Undo takes a change back', ui.vis && ui.start && ui.side && ui.mid && ui.st && ui.undo, JSON.stringify(ui));
  // settings saved and loaded keep the place
  const keep = await m.evaluate(() => { const f = fxNorm({ eq: { on: true, bands: [{ type: 'peaking', f: 500, g: 2, q: 1, on: true, place: 'side' }, { type: 'peaking', f: 600, g: 2, q: 1, on: true, place: 'bogus' }] } }); return [f.eq.bands[0].place, f.eq.bands[1].place]; });
  ok('a band keeps its place in a saved settings file, and an unknown place becomes Stereo', keep[0] === 'side' && keep[1] === undefined, JSON.stringify(keep));
  // the app's own sums against the browser's filters (the silent renderer, given the same numbers), for a recording held in memory
  const cmp = await m.evaluate(async bands => { aeFx(fx => { fx.eq.on = true; fx.eq.auto = true; fx.eq.bands = bands; }); const fx = fxClone(AE.d.fx); FXC.clear();
    const a = await fxGet(fx); FXC.clear(); const c = await fxGet(fx, { browser: true }); FXC.clear();
    let worst = 0, ref = 0; for (let ch = 0; ch < 2; ch++) { const x = a.buffer.getChannelData(ch), y = c.buffer.getChannelData(ch); for (let i = 0; i < x.length; i++) { worst = Math.max(worst, Math.abs(x[i] - y[i])); ref = Math.max(ref, Math.abs(x[i])); } } return { worst, ref }; }, BANDS);
  ok('the app’s own sums and the browser’s filters give the same sound with bands on the mid and the side', cmp.worst < 3e-4 && cmp.ref > 0.1, JSON.stringify(cmp));
  // what the audio thread plays: the level of the mid tone and the side tone out of the live EQ, against the curve
  const live = await m.evaluate(async bands => { aeFx(fx => { fx.eq.on = true; fx.eq.auto = false; fx.eq.bands = bands; }); await sleep(200);
    document.querySelector('#aePlay').click(); await sleep(900); const ac = AE.g.context, made = AE.ph && AE.chain && typeof window.eqNode === 'undefined' ? 1 : 0;          // the bands are worked out inside the player
    const code = "registerProcessor('rec2', class extends AudioWorkletProcessor { process(i) { if (i[0] && i[0][1]) this.port.postMessage({ l: i[0][0].slice(), r: i[0][1].slice() }); return true; } });";
    await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec2', { numberOfInputs: 1, numberOfOutputs: 0 }), got = []; rec.port.onmessage = e => got.push(e.data); AE.chain.output.connect(rec); await sleep(900); document.querySelector('#aePlay').click();
    const L = [], R = []; got.forEach(g => { L.push(...g.l); R.push(...g.r); }); const sr = ac.sampleRate, lv = (x, f) => { let a = 0, b = 0, w = 0; for (let i = 0; i < x.length; i++) { const h = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / x.length); a += h * x[i] * Math.sin(2 * Math.PI * f * i / sr); b += h * x[i] * Math.cos(2 * Math.PI * f * i / sr); w += h; } return 20 * Math.log10(2 * Math.hypot(a, b) / w + 1e-12); };          // a Hann window, so a loud tone does not leak into the other tone's reading
    const M = L.map((v, i) => (v + R[i]) / 2), Sd = L.map((v, i) => (v - R[i]) / 2);
    const want = (f, part) => bands.filter(b => b.on && (!b.place || b.place === part)).reduce((t, b) => t + KFX.eqSections(b, sr).reduce((u, c) => u + 20 * Math.log10(KFX.bqMag(c, f, sr)), 0), 0);
    return { made, n: L.length, mid: lv(M, 1000) - lv(M.map(() => 0).map((_, i) => 0.2 * Math.sin(2 * Math.PI * 1000 * i / sr)), 1000), side: lv(Sd, 3000) - lv(Sd.map((_, i) => 0.2 * Math.sin(2 * Math.PI * 3000 * i / sr)), 3000), wm: want(1000, 'mid'), ws: want(3000, 'side'), leakM: lv(M, 3000), leakS: lv(Sd, 1000) }; }, BANDS);
  ok('a recording in memory plays the mid and the side through their own bands on the audio thread', live.made >= 1 && live.n > 20000 && Math.abs(live.mid - live.wm) < 0.15 && Math.abs(live.side - live.ws) < 0.15 && live.leakM < -110 && live.leakS < -110, JSON.stringify(live));
  // Listen on a mid or side band
  const hear = await m.evaluate(() => { AE.band = 0; AE.eqListen = true; aeEqPanel(); const a = aeHearFx().eq; AE.band = 1; const b = aeHearFx().eq; AE.band = 2; const c = aeHearFx().eq; AE.eqListen = false; return [a.solo, a.bands.every(x => x.place === 'mid'), b.solo, b.bands.every(x => x.place === 'side'), c.solo]; });
  ok('Listen on a mid band plays only the mid, on a side band only the side, on a stereo band the whole sound', hear[0] === 'mid' && hear[1] && hear[2] === 'side' && hear[3] && hear[4] === undefined, JSON.stringify(hear));
  // the curves drawn
  const cv = await m.evaluate(() => { const b = AE.d.fx.eq.bands; return { split: eqSplit(b), mid: Math.round(eqCurve(b, x => x.place !== 'side')[120] * 100) / 100, side: Math.round(eqCurve(b, x => x.place !== 'mid')[120] * 100) / 100, all: Math.round(eqCurve(b)[120] * 100) / 100 }; });
  ok('with bands on the mid and the side the EQ draws a curve for each', cv.split && cv.mid !== cv.side, JSON.stringify(cv));
  // Listen: switching between solo'd bands, between Stereo, Mid and Side, and moving a solo'd band while it plays must never click, drop out or ring.
  // With pure tones the biggest step from one sample to the next is known (the tones' own slopes: about 0.1 for 1kHz and 3kHz at 0.2 with these small gains), so a jump shows as well over that
  const swap = async (disk, label) => { const p = await open(disk, 2, 16);
    const r = await p.evaluate(async bands => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.bands = bands; }); AE.band = 0; aeEqPanel(); await sleep(300); document.querySelector('#aePlay').click(); await sleep(1000); const ac = AE.g.context;
      const code = "registerProcessor('rec5', class extends AudioWorkletProcessor { process(i) { if (i[0] && i[0][1]) this.port.postMessage({ l: i[0][0].slice(), r: i[0][1].slice() }); return true; } });";
      await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec5', { numberOfInputs: 1, numberOfOutputs: 0 }), got = []; rec.port.onmessage = e => got.push(e.data); AE.g.connect(rec);
      const sel = i => { AE.band = i; aeEqPanel(); aeLive(); }, ev = [() => { AE.eqListen = true; aeEqPanel(); aeLive(); }, () => sel(1), () => sel(2), () => sel(0), () => aeFx(fx => { fx.eq.bands[0].place = 'side'; }), () => aeFx(fx => { delete fx.eq.bands[0].place; }), () => aeFx(fx => { fx.eq.bands[0].place = 'mid'; }), () => sel(1), () => sel(0), () => { AE.eqListen = false; aeEqPanel(); aeLive(); }, () => { AE.eqListen = true; aeEqPanel(); aeLive(); }];
      let step = 0, bad = 0, prevL = null, prevR = null; const t0 = got.length; for (const f of ev) { f(); await sleep(450); }
      for (let k = 0; k < 40; k++) { aeFx(fx => { fx.eq.bands[0].f = 500 + k * 50; fx.eq.bands[0].g = 6 - k * 0.25; }, true); await sleep(20); } await sleep(300); AE.eqListen = false; document.querySelector('#aePlay').click();
      let peak = 0; for (let g = t0; g < got.length; g++) for (const ch of ['l', 'r']) { const x = got[g][ch]; let pv = ch === 'l' ? prevL : prevR; for (let i = 0; i < x.length; i++) { const v = x[i]; if (!(Math.abs(v) < 10)) bad++; if (pv !== null) step = Math.max(step, Math.abs(v - pv)); peak = Math.max(peak, Math.abs(v)); pv = v; } if (ch === 'l') prevL = pv; else prevR = pv; }
      return { step, peak, bad, blocks: got.length - t0, gaps: AE.dh ? AE.dh.gaps() : 0 }; }, [{ type: 'peaking', f: 1000, g: 2, q: 1, on: true, place: 'mid' }, { type: 'peaking', f: 3000, g: -2, q: 1.2, on: true, place: 'side' }, { type: 'peaking', f: 2000, g: 2, q: 1, on: true }]);
    ok(label + ': switching solo\'d bands and places and moving one never clicks or drops out', r.step < 0.12 && r.peak < 0.5 && r.bad === 0 && r.blocks > 100 && r.gaps === 0, JSON.stringify(r)); await p.close(); };
  await swap(0, 'in memory'); await swap(1, 'on the disk store');
  // a change of Listen on the disk store is heard at once (the EQ runs live on the page, as for a recording in memory, so nothing is made over)
  { const p = await open(1, 2, 16); const r = await p.evaluate(async bands => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.bands = bands; }); AE.band = 0; aeEqPanel(); await sleep(300); document.querySelector('#aePlay').click(); await sleep(1000); const ac = AE.g.context;
      const code = "registerProcessor('rec6', class extends AudioWorkletProcessor { process(i) { if (i[0] && i[0][1]) { let m = 0; const a = i[0][0]; for (let k = 0; k < a.length; k++) m = Math.max(m, Math.abs(a[k])); this.port.postMessage({ f: currentFrame, m }); } return true; } });";
      await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec6', { numberOfInputs: 1, numberOfOutputs: 0 }), got = []; rec.port.onmessage = e => got.push(e.data); AE.g.connect(rec); await sleep(300);
      const f0 = got[got.length - 1].f; AE.eqListen = true; aeEqPanel(); aeLive(); await sleep(900); const hit = got.find(g => g.f >= f0 && g.m < 0.25); document.querySelector('#aePlay').click(); return { lag: hit ? Math.round((hit.f - f0) / ac.sampleRate * 1000) : null }; }, BANDS.slice(0, 2));
    ok('Listen on the disk store is heard within 80ms', r.lag !== null && r.lag < 80, JSON.stringify(r)); await p.close(); }
  // export from the memory and from the disk store give the same file
  const d = await open(1, 2);
  const run = async p => { await p.evaluate(async bands => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.auto = true; fx.eq.bands = bands; }); S.set.audioFormat = 'wav24'; window.__saved = null; }, BANDS);
    for (let i = 0; i < 80; i++) { if (await p.evaluate(() => fxActive(AE.d.fx, fxChannels()).length ? !!fxPeek(AE.d.fx) : true)) break; await p.waitForTimeout(250); } await p.evaluate(() => aeExport()); for (let i = 0; i < 120; i++) { if (await p.evaluate(() => !!window.__saved)) break; await p.waitForTimeout(250); } return p.evaluate(() => window.__saved); };
  const fa = await run(m), fb = await run(d);
  if (fa && fb) { const x = Buffer.from(fa.b64, 'base64'), y = Buffer.from(fb.b64, 'base64'); let worst = 0; for (let i = 44; i + 2 < x.length && i + 2 < y.length; i += 3) { const v = k => ((k[i] | (k[i + 1] << 8) | (k[i + 2] << 16)) << 8 >> 8) / 8388608; worst = Math.max(worst, Math.abs(v(x) - v(y))); } ok('the disk store and memory export the same sound with bands on the mid and the side', x.length === y.length && worst < 3e-4, x.length + ' / ' + y.length + ' bytes, worst ' + worst.toExponential(2)); } else ok('exports made', false);
  await d.close();
  // a mono recording: no choice offered
  const mo = await open(0, 1); const mu = await mo.evaluate(async () => { aeTool('eq'); aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 1000, g: 3, q: 1, on: true }]; }); AE.band = 0; aeEqPanel(); await sleep(300); return document.querySelector('#aeBandPlace').hidden; });
  ok('a mono recording has no Stereo | Mid | Side choice', mu === true); await mo.close();
  await m.close(); await b.close();
  console.log(errs.length ? 'FAIL page errors: ' + errs.join('; ') : 'PASS no page errors'); process.exit(0);
})();
