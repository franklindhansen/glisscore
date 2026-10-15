const { chromium } = require('playwright-core'); const fs = require('fs'); const cp = require('child_process'); const SP = process.argv[2];
const rms = f => { const e = cp.spawnSync('ffmpeg', ['-i', f, '-af', 'astats=metadata=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const m = [...e.matchAll(/RMS level dB:\s+(-?[\d.]+)/g)]; return +m[m.length - 1][1]; };
// residual after removing the fundamental with a narrow notch, in dB relative to the tone
const resid = (f, hz) => { const e = cp.spawnSync('ffmpeg', ['-i', f, '-af', `bandreject=f=${hz}:width_type=q:w=30,astats=metadata=0`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr; const m = [...e.matchAll(/RMS level dB:\s+(-?[\d.]+)/g)]; return +m[m.length - 1][1]; };
(async () => { const b = await chromium.launch(); 
 for (const [file, hz] of [['s15k.wav', 15000], ['s21k.wav', 21000]]) for (const [fmt, rate] of [['wav24', 44100], ['wav24', 96000], ['wav', 44100]]) {
  const p = await b.newPage(); p.setDefaultTimeout(30000); await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#audioIn', SP + '/' + file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, b64: btoa(s) }; }; });
  await p.evaluate(({ fmt, rate }) => { Object.assign(AE.d, { normalize: false, limiter: false, gainDb: 0 }); S.set.audioFormat = fmt; S.set.audioRate = rate; aeRefresh(); }, { fmt, rate }); await p.waitForTimeout(500);
  await p.evaluate(() => aeExport()); for (let i = 0; i < 100 && !(await p.evaluate(() => !!window.__saved)); i++) await p.waitForTimeout(250);
  const s = await p.evaluate(() => window.__saved); const f = SP + '/o/rs_' + file + rate + fmt + '.wav'; fs.writeFileSync(f, Buffer.from(s.b64, 'base64'));
  const lvl = rms(f) - rms(SP + '/' + file), r = resid(f, hz) - rms(f); console.log(file, rate, fmt, 'level change', lvl.toFixed(3) + 'dB', 'residual (noise+distortion+alias) vs tone', r.toFixed(1) + 'dB'); await p.close(); }
 await b.close(); })();
