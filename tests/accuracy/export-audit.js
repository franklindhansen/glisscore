const { chromium } = require('playwright-core'); const fs = require('fs'); const cp = require('child_process');
const SP = process.argv[2]; const disk = process.argv[3] || '1';
const out = [];
const rep = (n, pass, i) => console.log((pass ? 'PASS ' : 'FAIL ') + n + ' — ' + i);
const meas = f => { const e = cp.spawnSync('ffmpeg', ['-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const s = e.slice(e.lastIndexOf('Summary')); const g = r => { const m = s.match(r); return m ? +m[1] : NaN; }; return { lufs: g(/I:\s+(-?[\d.]+) LUFS/), tp: g(/Peak:\s+(-?[\d.]+) dBFS/) }; };
const rms = f => { const e = cp.spawnSync('ffmpeg', ['-i', f, '-af', 'astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const m = [...e.matchAll(/RMS level dB:\s+(-?[\d.]+)/g)]; return +m[m.length - 1][1]; };
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async file => { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); p.errs = []; p.on('pageerror', e => p.errs.push(String(e).slice(0, 200)));
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', SP + '/' + file); await p.waitForFunction(() => S.audio, null, { timeout: 30000 });
    await p.waitForFunction(() => S.audio.buffer ? (tpGet(S.audio.buffer, S.audio.peaks), TPK.get(S.audio.buffer).tp) : S.audio.tp, null, { timeout: 30000 }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, b64: btoa(s) }; }; }); return p; };
  const run = async (p, draft, format, fxf, tag) => {
    await p.evaluate(({ draft, format, fxf }) => { window.__saved = null; Object.assign(AE.d, { normalize: false, limiter: false, gainDb: 0, vStart: 0, vEndSet: null }, draft); S.set.audioFormat = format; S.set.audioRate = 0; aeFx(fx => { fx.eq.on = false; fx.eq.bands = []; if (fxf) eval('(' + fxf + ')')(fx); }); aeRefresh(); }, { draft, format, fxf });
    for (let i = 0; i < 80; i++) { const r = await p.evaluate(() => { const d = AE.d, i = aeLoudInfo(d); return { fx: fxActive(d.fx, fxChannels()).length ? !!fxPeek(d.fx) : true, loud: !d.normalize || d.normBy !== 'loud' || (i && i.ready) }; }); if (r.fx && r.loud) break; await p.waitForTimeout(250); }
    await p.evaluate(() => aeExport()); for (let i = 0; i < 160; i++) { if (await p.evaluate(() => !!window.__saved)) break; await p.waitForTimeout(250); }
    const s = await p.evaluate(() => window.__saved); const f = SP + '/o/' + tag + '.' + s.name.split('.').pop(); fs.writeFileSync(f, Buffer.from(s.b64, 'base64')); return f; };
  const m = await open('mix.wav');
  const src = meas(SP + '/mix.wav'); console.log('source mix', JSON.stringify(src));
  let f = await run(m, {}, 'wav24', null, 'plain'); let r = cp.spawnSync('ffmpeg', ['-i', SP + '/mix.wav', '-i', f, '-filter_complex', '[0][1]amerge,pan=mono|c0=c0-c2', '-f', 'null', '-'], { encoding: 'utf8' });
  const diff = cp.spawnSync('ffmpeg', ['-i', SP + '/mix.wav', '-i', f, '-filter_complex', '[0]aformat=channel_layouts=stereo[a];[1]aformat=channel_layouts=stereo[b];[a][b]anullsink'], { encoding: 'utf8' });
  const nul = cp.spawnSync('ffmpeg', ['-i', SP + '/mix.wav', '-i', f, '-filter_complex', '[0]asplit[a1][a2];[1]aformat=sample_fmts=s32[b];[a1]aformat=sample_fmts=s32[a];[a][b]amerge=inputs=2,pan=stereo|c0=c0-c2|c1=c1-c3,astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const nm = [...nul.matchAll(/Peak level dB:\s+(-?[\d.inf]+)/g)]; rep('plain export is a null test vs source (peak of difference)', nm.length && (nm[nm.length - 1][1] === '-inf' || +nm[nm.length - 1][1] < -135), nm.map(x => x[1]).join(','));
  for (const L of [-23, -16, -14]) { f = await run(m, { normalize: true, normBy: 'loud', normLufs: L, limiter: true }, 'wav24', null, 'loud' + L); const q = meas(f); rep('loudness ' + L + ' LUFS with limiter', Math.abs(q.lufs - L) <= 0.3 && q.tp <= -0.99, JSON.stringify(q)); }
  for (const P of [-1, -3, -6]) { f = await run(m, { normalize: true, normBy: 'peak', normPeakDb: P }, 'wav24', null, 'peak' + P); const q = meas(f); rep('peak ' + P + ' dB', Math.abs(q.tp - P) <= 0.15, JSON.stringify(q)); }
  f = await run(m, { gainDb: 6 }, 'wav24', null, 'gain6'); rep('gain +6dB', Math.abs(meas(f).lufs - src.lufs - 6) < 0.05, meas(f).lufs + ' vs ' + (src.lufs + 6));
  await m.close();
  for (const [file, fr, g, q] of [['t1k.wav', 1000, 6, 1], ['t1k.wav', 1000, -6, 1], ['t100.wav', 100, 6, 1], ['t100.wav', 1000, 6, 1]]) {
    const p = await open(file); const base = rms(SP + '/' + file);
    f = await run(p, {}, 'wav24', `fx => { fx.eq.bands = [{ type: 'peaking', f: ${fr}, g: ${g}, q: ${q}, on: true }]; fx.eq.on = true; }`, 'eq' + file + fr + g);
    const d = rms(f) - base; const want = fr === (file === 't1k.wav' ? 1000 : 100) ? g : 0; rep('EQ peaking ' + g + 'dB @' + fr + 'Hz on ' + file + ' (expect ' + want.toFixed(1) + ')', Math.abs(d - want) < (want ? 0.15 : 0.3), 'change ' + d.toFixed(3) + 'dB'); await p.close(); }
  // shelves / HP
  for (const [type, fr, g, file, want] of [['highpass', 200, 0, 't100.wav', null], ['lowshelf', 200, 6, 't100.wav', 6], ['highshelf', 4000, 6, 't1k.wav', 0]]) {
    const p = await open(file); const base = rms(SP + '/' + file);
    f = await run(p, {}, 'wav24', `fx => { fx.eq.bands = [{ type: '${type}', f: ${fr}, g: ${g}, q: 0.71, on: true }]; fx.eq.on = true; }`, 'eqb' + type); const d = rms(f) - base;
    rep('EQ ' + type + ' ' + fr + 'Hz on ' + file, want === null ? d < -6 : Math.abs(d - want) < 0.3, 'change ' + d.toFixed(2) + 'dB'); await p.close(); }
  console.log(JSON.stringify(Object.keys(fs.readdirSync(SP + '/o'))).length ? 'done' : ''); await b.close();
})();
