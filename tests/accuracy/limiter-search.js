const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch(); const p = await b.newPage(); p.setDefaultTimeout(120000);
 await p.goto('http://localhost:8123/index.html?disk=0'); await p.setInputFiles('#audioIn', process.argv[2] + '/mixloud.wav'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(800);
 await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
 const r = await p.evaluate(async target => { const d = AE.d; Object.assign(d, { normalize: true, normBy: 'loud', normLufs: target, limiter: true });
  const m = await loudEnsure(d), buf = (await fxGet(d.fx)).buffer, ch = 2, vs = d.vStart, ve = aeEnd(d); let g = Math.pow(10, (target - m.I) / 20); const log = [];
  for (let k = 0; k < 12; k++) { const mm = masterMaker(buf, ch, vs, ve, g, t => aeF(d, vs, ve, t), { limit: LIM_CEIL }); const r = await LU.measure((pos, len, out) => mm.fill(pos, len, out), mm.total, mm.sr, ch, async () => {}); log.push({ k: k + 1, gainDb: +(20 * Math.log10(g)).toFixed(2), lufs: +r.I.toFixed(2), grDb: +(20 * Math.log10(mm.reduction())).toFixed(2) }); const off = target - r.I; if (Math.abs(off) < 0.05) break; g *= Math.pow(10, off / 20); }
  return log; }, +process.argv[3]);
 console.log(process.argv[3], JSON.stringify(r)); await b.close(); })();
