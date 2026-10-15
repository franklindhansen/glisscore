// What is heard is what is exported, and no part of playback reads sound back from the browser's audio path.
// Safari's fingerprinting protection adds noise to whatever a script reads from the live audio path (an audio worklet's input, an analyser). A limiter or an EQ fed that way puts the noise into the sound,
// so the player takes the samples by message and works out the EQ, the Imager, the volume and the limiter itself. Checked here:
// no audio worklet with an input is made while the editor or the video plays, and the sound the editor plays (EQ, Imager, a loudness target and the limiter on) equals the export sample for sample, in memory and on the disk store.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-play-export.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ';
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { window.READERS = []; const W = window.AudioWorkletNode; window.AudioWorkletNode = function (ctx, name, o) { if (!(ctx instanceof OfflineAudioContext) && (!o || o.numberOfInputs !== 0)) window.READERS.push(name); return new W(ctx, name, o); }; window.AudioWorkletNode.prototype = W.prototype; });          // every worklet made on the live context that takes sound in
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/stereo.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      aeFx(fx => { fx.eq.on = true; fx.eq.auto = true; fx.eq.bands = [{ type: 'peaking', f: 900, g: 5, q: 1, on: true }, { type: 'highshelf', f: 7000, g: -3, q: 0.71, on: true }, { type: 'peaking', f: 2500, g: 4, q: 1.4, on: true, place: 'side' }, { type: 'highpass', f: 50, g: 0, q: 0.71, slope: 24, on: true }];
        fx.imager.on = true; fx.imager.width = 140; fx.imager.monoBass = 120; fx.imager.bal = 1.5; });
      const d = AE.d; d.normalize = true; d.normBy = 'loud'; d.normLufs = -6; d.normPreset = 'custom'; d.limiter = true; aeRefresh(); await sleep(300);
      const ch = 2, mm = S.audio.disk ? await aeMasterDisk(d, ch, false, null) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false), total = mm.total, want = new Float32Array(total * ch); await mm.fill(0, total, want);          // the export's samples
      const gr = aeLevel(d, Math.max(0, d.vStart), Math.min(aeEnd(d), S.audio.duration)); let wpk = 0; for (const v of want) wpk = Math.max(wpk, Math.abs(v));
      AE.pos = Math.max(0, d.vStart); document.querySelector('#aePlay').click(); await new Promise(res => { const t = setInterval(() => { if (AE.playing && AE.ph) { clearInterval(t); res(); } }, 5); });
      const ac = AE.src.context, code = "registerProcessor('rec-out', class extends AudioWorkletProcessor { process(i) { if (i[0] && i[0][1]) this.port.postMessage({ at: currentFrame, l: i[0][0].slice(), r: i[0][1].slice() }); return true; } });";
      await ac.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))); const rec = new AudioWorkletNode(ac, 'rec-out', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' }), got = []; rec.port.onmessage = e => got.push(e.data); AE.src.connect(rec);          // the check's own recorder, on the player's output (this test browser adds nothing to what it reads)
      await sleep(3000); const start = AE.ph.startFrame, gaps = AE.ph.gaps(), D = limNew(ac.sampleRate, 2).delay; document.querySelector('#aePlay').click(); await sleep(200);
      /* a frame the recorder heard at 'at' is the sound's frame at - start, and the limiter holds the sound back by its look-ahead */
      let worst = 0, n = 0, sum = 0, pk = 0; const sr = ac.sampleRate, a = Math.round(0.8 * sr), z = Math.round(3.2 * sr);
      for (const g of got) for (let i = 0; i < g.l.length; i++) { const k = g.at + i - start - D; if (k < a || k >= z || k >= total) continue; const dl = Math.abs(g.l[i] - want[k]), dr = Math.abs(g.r[i] - want[total + k]); worst = Math.max(worst, dl, dr); sum += dl * dl + dr * dr; n += 2; pk = Math.max(pk, Math.abs(g.l[i]), Math.abs(g.r[i])); }
      return { n, worst, rms: Math.sqrt(sum / Math.max(1, n)), pk, wpk, gain: gr, gaps, ceil: Math.pow(10, LIM_CEIL / 20), readers: READERS.filter(x => x !== 'rec-out'), act: fxActive(d.fx, 2), rate: [sr, mm.sr || 0] };
    });
    ok(tag + 'the limiter is working in this check (the volume pushes the sound past the ceiling)', r.wpk <= r.ceil && r.pk > r.ceil * 0.95 && r.act.length === 2, JSON.stringify({ gain: r.gain, exportPeak: r.wpk, heardPeak: r.pk, ceil: r.ceil, act: r.act }));
    ok(tag + 'what plays equals the export sample for sample (EQ, Imager, loudness, limiter)', r.n > 150000 && r.gaps === 0 && r.worst < 2e-5, r.n + ' samples, worst ' + r.worst.toExponential(2) + ', rms ' + r.rms.toExponential(2));
    ok(tag + 'no worklet reads sound back from the browser while the editor plays', r.readers.length === 0, r.readers.join(', '));
    // the video's own player, with a loudness target and the limiter
    await p.evaluate(() => { aeApply(); }); await p.waitForTimeout(500);
    await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(500);
    const v = await p.evaluate(async () => {
      const lim = limOn(S.set); READERS.length = 0; S.time = S.vStart; await Transport.play(); await new Promise(res => { const t = setInterval(() => { if (Transport.dh) { clearInterval(t); res(); } }, 5); });
      const ac = Transport.src.context, rec = new AudioWorkletNode(ac, 'rec-out', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' }), got = []; rec.port.onmessage = e => got.push(e.data); Transport.src.connect(rec);
      await sleep(1500); const t = Transport.now(), gaps = Transport.dh.gaps(); Transport.pause(); await sleep(200); let pk = 0; for (const g of got) for (let i = 0; i < g.l.length; i++) pk = Math.max(pk, Math.abs(g.l[i]), Math.abs(g.r[i]));
      return { lim, t, gaps, pk, ceil: Math.pow(10, LIM_CEIL / 20), readers: READERS.filter(x => x !== 'rec-out') };
    });
    ok(tag + 'the video plays through the same player, limited inside it, with no worklet reading sound back', v.lim && v.t > 1 && v.gaps === 0 && v.pk > v.ceil * 0.7 && v.pk <= v.ceil && v.readers.length === 0, JSON.stringify(v));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
