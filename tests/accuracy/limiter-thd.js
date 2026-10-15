const { chromium } = require('playwright-core'); const fs = require('fs'); const SP = process.argv[2];
(async () => { const b = await chromium.launch();
 for (const [file, over] of [['b60.wav', 0], ['b60.wav', 3], ['b60.wav', 6], ['imd.wav', 3], ['imd.wav', 6]]) {
  const p = await b.newPage(); p.setDefaultTimeout(120000); await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#audioIn', SP + '/' + file); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, b64: btoa(s) }; }; });
  // a target that makes the sound this many dB over the ceiling if only gain were applied: measure first
  const tgt = await p.evaluate(async over => { const d = AE.d, m = await loudEnsure(d); const pk = Math.max(...Array.from(aeLevelPeaks(d))); const gToCeil = -1.15 - 20 * Math.log10(pk); return m.I + gToCeil + over; }, over);
  await p.evaluate(t => { window.__saved = null; Object.assign(AE.d, { normalize: true, normBy: 'loud', normLufs: t, limiter: true }); S.set.audioFormat = 'wav24'; aeRefresh(); }, tgt);
  for (let i = 0; i < 100; i++) { const r = await p.evaluate(() => { const i = aeLoudInfo(AE.d); return i && i.ready && (!AE.d.limiter || i.lim); }); if (r) break; await p.waitForTimeout(300); }
  await p.evaluate(() => aeExport()); for (let i = 0; i < 120 && !(await p.evaluate(() => !!window.__saved)); i++) await p.waitForTimeout(250);
  const s = await p.evaluate(() => window.__saved); fs.writeFileSync(SP + '/o/lt_' + file.replace('.wav', '') + over + '.wav', Buffer.from(s.b64, 'base64')); await p.close(); }
 await b.close(); })();
