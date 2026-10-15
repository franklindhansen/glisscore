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
  const m = await open('mixloud.wav');
  const src = meas(SP + '/mixloud.wav'); console.log('source mix', JSON.stringify(src));
  let f;
  for (const L of [-9, -6]) { f = await run(m, { normalize: true, normBy: 'loud', normLufs: L, limiter: true }, 'wav24', null, 'lim' + L); const q = meas(f); rep('limiter: ' + L + ' LUFS target (unlimited would peak well over 0)', q.tp <= -0.99, JSON.stringify(q)); }
  await m.close();
  await b.close(); })();
