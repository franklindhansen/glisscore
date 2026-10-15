/* Tools on the disk store, run in Chromium: a recording made here (so it is the same every time) is loaded the usual way and into the disk store, and for a set of tool settings
   the store's result (audio-fx.js) is checked two ways. Against today's whole-file result (fxGet): noise reduction and Spectra must give every sample the same; EQ and Imager
   come within a stated distance (today's are the browser's own filters, which round their memory as they go; these keep full precision, and the gap is that rounding).
   And against itself: read in order in uneven blocks, read at far-off places with exact set (from the start, then again from checkpoints), every sample must be the same as
   one pass over the whole recording; read at far-off places without exact (a short run-in), it must come within a hair.
   Level, fades, the limiter, loudness and the waveform heights are set against the app's own whole-file code run on the same processed sound: every number and sample must be the same. */
const { chromium } = require('playwright-core');
const results = [];
const ok = (name, pass, info = '') => { results.push((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const dB = v => v > 0 ? (20 * Math.log10(v)).toFixed(1) + 'dB' : 'none';
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1040, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8123/index.html?disk=0'); await p.waitForFunction(() => window.__keyframes);
  /* a recording: 1.5s of hiss alone (for the noise profile), then notes that move between left and right over the hiss */
  const make = (sr, ch, secs) => p.evaluate(async ({ sr, ch, secs }) => {
    const n = sr * secs, il = new Float32Array(n * ch); let seed = 12345; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296 - 0.5);
    for (let i = 0; i < n; i++) {
      const t = i / sr, on = t > 1.5 ? 1 : 0, env = 0.5 + 0.5 * Math.sin(t * 1.7), x = on * (0.3 * env * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1000 * t + 3 * Math.sin(t)) + 0.1 * (1 - env) * Math.sin(2 * Math.PI * 5200 * t) + 0.25 * Math.sin(2 * Math.PI * 61 * t)) + (Math.abs(t - 12.3) < 0.015 || Math.abs(t - 27) < 0.015 ? 0.9 * Math.sin(2 * Math.PI * 3000 * t) : 0);          // and two short loud bursts, for the limiter
      for (let c = 0; c < ch; c++) il[i * ch + c] = x * (c ? 0.4 + 0.5 * Math.sin(t * 0.9) : 0.9) + 0.02 * rnd() + (c ? 0.1 * on * Math.sin(2 * Math.PI * 3300 * t) : 0);
    }
    const h = new DataView(new ArrayBuffer(44)), put = (o, s) => { for (let i = 0; i < 4; i++) h.setUint8(o + i, s.charCodeAt(i)); };
    put(0, 'RIFF'); h.setUint32(4, 36 + il.byteLength, true); put(8, 'WAVE'); put(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 3, true); h.setUint16(22, ch, true); h.setUint32(24, sr, true); h.setUint32(28, sr * ch * 4, true); h.setUint16(32, ch * 4, true); h.setUint16(34, 32, true); put(36, 'data'); h.setUint32(40, il.byteLength, true);
    const file = new File([h.buffer, il], 'made ' + sr + ' ' + ch + '.wav');
    await loadAudio(file); const m = await DISK.importFile(file, { piece: 100003 });
    const chans = () => Array.from({ length: ch }, (_, c) => new Float32Array(S.audio.buffer.getChannelData(c)));
    const profile = NR.nrLearn(chans(), sr, 0, Math.floor(1.4 * sr), Array.from(eqAxis));
    const diff = (ref, r, o) => { for (let c = 0; c < ref.length; c++) { const x = ref[c], y = r.chans[c]; for (let i = 0; i < y.length; i++) { const d = Math.abs(x[r.start + i] - y[i]); if (d > 0) { o.bad++; if (d > o.max) o.max = d; } } } o.n += r.chans[0].length; if (!r.exact) o.loose++; };
    const fresh = async fx => { await DISK.fx(fxNorm({})); await DISK.fx(fx); };
    /* one set of tools, compared every way */
    window.T = async raw => {
      const fx = fxNorm(Object.assign({}, raw, raw.noise ? { noise: Object.assign({ on: true, profile }, raw.noise) } : {})), whole = (FXC.clear(), await fxGet(fx, { browser: true })), today = Array.from({ length: ch }, (_, c) => whole.buffer.getChannelData(c)), N = m.frames;
      const mk = () => ({ max: 0, bad: 0, n: 0, loose: 0 }), out = { today: mk(), seq: mk(), far: mk(), again: mk(), runIn: mk() }, places = [0.93, 0.31, 0.72, 0.5, 0.11, 0.999].map(f => Math.floor(f * (N - 20000)));
      await fresh(fx); const t = performance.now(), one = await DISK.render(0, N, true), ref = one.chans; out.speed = Math.round(N / m.sr / ((performance.now() - t) / 1000)); diff(today, one, out.today);
      await fresh(fx); for (let at = 0; at < N; at += 70001) diff(ref, await DISK.render(at, 70001, true), out.seq);
      await fresh(fx); const t0 = performance.now(); for (const at of places) diff(ref, await DISK.render(at, 30011, true), out.far); out.farMs = Math.round(performance.now() - t0);
      const t1 = performance.now(); for (const at of places) diff(ref, await DISK.render(at + 77, 30011, true), out.again); out.againMs = Math.round(performance.now() - t1);
      await fresh(fx); for (const at of places) diff(ref, await DISK.render(at, 30011, false), out.runIn);
      return out;
    };
    /* level, fades, limiter and loudness on the store, each set against the app's own whole-file code run on the very same processed sound (so every number and sample must be the same) */
    window.L = async (raw, vs, ve, target) => {
      const fx = fxNorm(Object.assign({}, raw, raw.noise ? { noise: Object.assign({ on: true, profile }, raw.noise) } : {})), N = m.frames, out = {}, same = (a, b) => { if (a.length !== b.length) return -1; let bad = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) bad++; return bad; };
      await fresh(fx); const one = await DISK.render(0, N, true), buf = new AudioBuffer({ length: N, numberOfChannels: ch, sampleRate: sr }); one.chans.forEach((x, c) => buf.copyToChannel(x, c));
      let ticks = 0; const t0 = performance.now(), sc = await DISK.scan({ onProgress: () => ticks++ }), cp = calcPeaks(buf), tp = await tpCompute(buf); out.scan = { peaks: same(sc.peaks, cp.peaks), tp: same(sc.tp, tp), max: sc.peakMax === cp.peakMax, copy: sc.copy, ticks, ms: Math.round(performance.now() - t0) };
      let bad = 0; for (const at of [0, 123457, N - 50000]) { const r = await DISK.render(at, 50000, false); for (let c = 0; c < ch; c++) bad += same(r.chans[c], one.chans[c].subarray(at, at + r.chans[c].length)); if (!r.exact) bad++; } out.copyBad = bad;
      const d = { vStart: vs, vEndSet: ve, audioFades: true, audioFadeLen: 1.5, audioFadeShape: 'natural', normLufs: target }, fade = t => aeF(d, vs, ve, t), meas = async mm => { const r = await LU.measure((pos, len, o) => mm.fill(pos, len, o), mm.total, mm.sr, ch); r.gr = mm.reduction(); return r; }, eq = (a, b) => ['I', 'LRA', 'M', 'S', 'steps', 'g', 'gr'].every(k => a[k] === b[k]), near = (a, b) => a.steps === b.steps && [['I', 0.01], ['LRA', 0.05], ['M', 0.01], ['S', 0.01], ['gr', 0.05]].every(([k, lim]) => Math.abs(a[k] - b[k]) <= lim) && Math.abs(20 * Math.log10(a.g / b.g)) <= 0.01;
      const l0 = await meas(masterMaker(buf, ch, vs, ve, 1, fade)), l1 = await DISK.loud(d); out.loud = { ok: eq(Object.assign({ g: 0, gr: 0 }, l0), Object.assign({ g: 0, gr: 0 }, l1)), I: l1.I, LRA: l1.LRA };
      const cap = Math.pow(10, 24 / 20); let g = Math.min(cap, Math.pow(10, (d.normLufs - l0.I) / 20)), r0 = null, prev = null, passes = 0;
      for (let k = 0; k < 4; k++) { r0 = await meas(masterMaker(buf, ch, vs, ve, g, fade, { limit: LIM_CEIL })); r0.g = g; passes++; if (prev && g > prev.g && r0.I - prev.I < LIM_WORTH * 20 * Math.log10(g / prev.g)) { r0 = prev; break; } const off = d.normLufs - r0.I; if (!isFinite(off) || Math.abs(off) < 0.05 || g >= cap) break; prev = r0; g = Math.min(cap, g * Math.pow(10, off / 20)); }
      const t1 = performance.now(), r1 = await DISK.limit(d); out.limit = { ok: r1.part === 1 ? eq(r0, r1) : near(r0, r1), off: Math.abs(r0.I - r1.I), part: r1.part, g: r1.g, I: r1.I, gr: r1.gr, passes, ms: Math.round(performance.now() - t1) };
      const spec = DISK.spec(d, r1.g, { limit: LIM_CEIL - LIM_GUARD, clamp: true }), mm = masterMaker(buf, ch, vs, ve, r1.g, fade, { clamp: true, limit: LIM_CEIL }), ref = new Float32Array(65536 * ch); let mb = 0, total = 0, pk = 0;
      for (let pos = 0, q = 0; pos < mm.total; q++) { const len = Math.min(q % 2 ? 65536 : 50001, mm.total - pos), a = ref.subarray(0, len * ch); mm.fill(pos, len, a); const r = await DISK.master(spec, pos, len); mb += same(r.data, a); for (const v of a) if (Math.abs(v) > pk) pk = Math.abs(v); pos += len; total = r.total; }
      const mj = masterMaker(buf, ch, vs, ve, r1.g, fade, { clamp: true, limit: LIM_CEIL }), at = Math.floor(mm.total * 0.6), a = new Float32Array(30000 * ch); mj.fill(at, 30000, a); mb += same((await DISK.master(spec, at, 30000)).data, a);
      out.master = { bad: mb, total, want: mm.total, peak: pk }; return out;
    };
    const src = await DISK.read(0, m.frames), same = { max: 0, bad: 0, n: 0, loose: 0 }; diff(chans(), Object.assign(src, { exact: true }), same);
    return { frames: m.frames, appFrames: S.audio.buffer.length, same };
  }, { sr, ch, secs });
  const bands = [{ type: 'highpass', f: 35, q: 0.71 }, { type: 'lowshelf', f: 120, g: 3.5, q: 1 }, { type: 'peaking', f: 1000, g: -6.3, q: 4.2 }, { type: 'peaking', f: 30, g: 8, q: 18 }, { type: 'notch', f: 3300, q: 12 }, { type: 'highshelf', f: 8000, g: -4.1, q: 1 }, { type: 'lowpass', f: 15000, q: 1.3 }];
  const noise = { reduction: 14, sensitivity: 60, smoothing: 70 }, edits = secs => [{ a: 0, b: 0.03, f0: 500, f1: 4000, mode: 'heal' }, { a: 10.2, b: 10.25, f0: 800, f1: 6000, mode: 'heal' }, { a: 20, b: 26, f0: 950, f1: 1050, mode: 'heal' }, { a: 30, b: 31, f0: 2000, f1: 9000, mode: 'cut', db: 30 }, { a: secs - 0.04, b: secs + 2, f0: 100, f1: 12000, mode: 'heal' }];
  /* near: how far from today's result is allowed, as a sample value (0 = every sample the same) */
  const RUNIN = 1e-5, EQ = 1e-4, IM = 3.2e-6;          // -80dB with the hardest EQ bands (30Hz, Q 18), -110dB for the Imager
  const run = async (name, raw, near) => {
    const r = await p.evaluate(raw => window.T(raw), raw);
    ok(name + ': against today\'s result', r.today.max <= near && r.today.n > 0, (near ? 'largest difference ' + dB(r.today.max) : r.today.bad + ' of ' + r.today.n + ' frames differ') + ', ' + r.speed + 'X real time');
    for (const [k, label] of [['seq', 'read in order'], ['far', 'far-off places, exact, from the start'], ['again', 'the same places again, from checkpoints']]) ok(name + ': ' + label, r[k].bad === 0 && r[k].loose === 0 && r[k].n > 0, r[k].bad + ' of ' + r[k].n + ' frames differ' + (k === 'again' ? ' (' + r.againMs + 'ms, first time ' + r.farMs + 'ms)' : ''));
    ok(name + ': far-off places with a run-in', r.runIn.max <= RUNIN, 'largest difference ' + dB(r.runIn.max) + ', ' + r.runIn.loose + ' of 6 marked not exact');
  };
  /* a far loudness target makes the limiter work all the way through (every number must be the same as the app's); a near one only at the bursts, where the quick way is used
     (the limiter run over those stretches alone) and must land within 0.01 LU of the app's whole run */
  const level = async (name, raw, vs, ve, target = -6) => {
    const r = await p.evaluate(([raw, vs, ve, target]) => window.L(raw, vs, ve, target), [raw, vs, ve, target]);
    ok(name + ': waveform heights and true peaks of the processed sound', r.scan.peaks === 0 && r.scan.tp === 0 && r.scan.max, JSON.stringify(r.scan));
    ok(name + ': ' + (r.scan.copy ? 'the processed copy on disk reads back the same' : 'no copy is made when nothing changes the sound'), r.copyBad === 0, r.copyBad + ' differ');
    ok(name + ': loudness of the kept part with fades', r.loud.ok, r.loud.I.toFixed(2) + ' LUFS, range ' + r.loud.LRA.toFixed(1));
    ok(name + ': volume for the loudness target through the limiter', r.limit.ok && r.limit.gr < -1 && (target > -10 ? r.limit.passes > 1 && r.limit.part === 1 : r.limit.part < 0.3), 'gain ' + (r.limit.g >= 1 ? '+' : '') + (20 * Math.log10(r.limit.g)).toFixed(2) + 'dB lands on ' + r.limit.I.toFixed(2) + ' LUFS, limiter takes off up to ' + (-r.limit.gr).toFixed(1) + 'dB, ' + r.limit.passes + ' passes in ' + r.limit.ms + 'ms, ' + (r.limit.part === 1 ? 'the whole recording through the limiter' : Math.round(r.limit.part * 100) + '% of it through the limiter, ' + r.limit.off.toFixed(4) + ' LU from the whole run'));
    ok(name + ': final samples (level, fades, limiter), in order and after a jump', r.master.bad === 0 && r.master.total === r.master.want && r.master.peak > 0.5 && r.master.peak <= 1, r.master.bad + ' of ' + r.master.total + ' frames differ, highest sample ' + dB(r.master.peak));
  };
  let m = await make(44100, 2, 40);
  await level('Level, no tools', {}, 3.2, 31.7);
  await level('Level, kept part runs past both ends', {}, -0.5, 40.7);
  ok('made recording: the store holds the same samples as the app', m.frames === m.appFrames && m.same.bad === 0 && m.same.n === m.frames, JSON.stringify(m));
  await run('Noise reduction', { noise }, 0);
  await run('Spectra', { spec: { edits: edits(40) } }, 0);
  await run('Noise reduction and Spectra', { noise, spec: { edits: edits(40) } }, 0);
  await run('EQ, every kind of band, auto gain', { eq: { on: true, auto: true, bands } }, EQ);
  await run('Imager, width', { imager: { on: true, width: 140 } }, IM);
  await run('Imager, balance and center low notes', { imager: { on: true, width: 100, monoBass: 120, bal: -2.5 } }, IM);
  await run('Imager, three zones', { imager: { on: true, width: 120, monoBass: 400, bw: [80, 130, 160], bal: 1.5 } }, IM);
  await run('Everything, Imager before EQ', { order: ['imager', 'eq'], noise, spec: { edits: edits(40) }, eq: { on: true, bands: bands.slice(0, 4) }, imager: { on: true, width: 160, monoBass: 90, bw: [100, 120, 70] } }, EQ);
  await level('Level, limiter only at the bursts', {}, 3.2, 31.7, -13);
  await level('Level, limiter only at the bursts, every tool', { noise, spec: { edits: edits(40) }, eq: { on: true, bands: bands.slice(0, 4) }, imager: { on: true, width: 160, monoBass: 90, bw: [100, 120, 70] } }, 0, 40, -13.5);
  await level('Level, every tool', { noise, spec: { edits: edits(40) }, eq: { on: true, bands: bands.slice(0, 4) }, imager: { on: true, width: 160, monoBass: 90, bw: [100, 120, 70] } }, 3.2, 31.7);
  m = await make(48000, 1, 30);
  ok('mono recording: the store holds the same samples as the app', m.frames === m.appFrames && m.same.bad === 0, JSON.stringify(m));
  await run('Mono: noise reduction and Spectra', { noise, spec: { edits: edits(30) } }, 0);
  await run('Mono: everything', { noise, spec: { edits: edits(30) }, eq: { on: true, auto: true, bands } }, EQ);
  await level('Mono: level, every tool', { noise, spec: { edits: edits(30) }, eq: { on: true, auto: true, bands } }, 2, 28.5);
  /* playback from the tools: what the player puts out must be the tools' sound, sample for sample across the joins; and when a setting changes while it plays, the old sound carries on
     to the changeover, the new sound follows it, and between them lies only the short ease from one to the other */
  const play = await p.evaluate(async () => {
    const sr = 48000, N = fxNorm, fxA = N({ eq: { on: true, bands: [{ type: 'peaking', f: 800, g: 6, q: 2 }] } }), fxB = N({ eq: { on: true, bands: [{ type: 'peaking', f: 800, g: -9, q: 2 }, { type: 'highpass', f: 200, q: 0.71 }] } }), from = 300000, span = 8 * sr, out = {};
    const whole = async f => { await DISK.fx(N({})); await DISK.fx(f); return (await DISK.render(0, 1440000, true)).chans[0]; }, A = await whole(fxA), B = await whole(fxB);
    const run = async change => {
      await DISK.fx(N({})); await DISK.fx(fxA); const oc = new OfflineAudioContext(1, span + sr, sr), h = await DISK.play(oc, from, oc.destination, { fx: true, chunk: 70001, ahead: Infinity, once: true, end: from + span, echo: true }); let cut = -1;
      if (change) oc.suspend(2).then(async () => { await DISK.fx(fxB); cut = await h.refresh(); oc.resume(); });
      await oc.startRendering(); for (let k = 0; k < 40 && !h.ended(); k++) await new Promise(r => setTimeout(r, 50));
      const y = new Float32Array(span); let got = 0; for (const blk of h.heard()) { y.set(blk[0].subarray(0, Math.min(blk[0].length, span - got)), got); got += blk[0].length; }
      return { y, got, cut, gaps: h.gaps() };
    };
    const a = await run(false); let bad = 0; for (let i = 0; i < span; i++) if (a.y[i] !== A[from + i]) bad++; out.plain = { bad, got: a.got, gaps: a.gaps };
    const b = await run(true), c = b.cut - from; let before = 0, after = 0, mid = 0; for (let i = 0; i < span; i++) { if (i < c) { if (b.y[i] !== A[from + i]) before++; } else if (i >= c + 1024) { if (b.y[i] !== B[from + i]) after++; } else { const lo = Math.min(A[from + i], B[from + i]) - 1e-6, hi = Math.max(A[from + i], B[from + i]) + 1e-6; if (b.y[i] < lo || b.y[i] > hi) mid++; } }
    out.change = { before, after, mid, cut: c, got: b.got, at: (c / sr).toFixed(2) }; return out;
  });
  ok('Playback from the tools: every sample in place across the joins', play.plain.bad === 0 && play.plain.got === 8 * 48000 && play.plain.gaps === 0, JSON.stringify(play.plain));
  ok('A setting changed while playing: old sound up to the changeover, new sound after it, an ease between', play.change.before === 0 && play.change.after === 0 && play.change.mid === 0 && play.change.cut > 2 * 48000 && play.change.cut < 2.5 * 48000 && play.change.got === 8 * 48000, JSON.stringify(play.change));
  await p.evaluate(() => DISK.remove());
  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await b.close();
  if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
})().catch(e => { console.log('TEST CRASH', e.message); process.exit(1); });
