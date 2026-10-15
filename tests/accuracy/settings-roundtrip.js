const { chromium } = require('playwright-core');
(async () => { const b = await chromium.launch(); const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
 await p.goto('http://localhost:8123/index.html'); await p.waitForTimeout(800);
 const r = await p.evaluate(async () => {
  const K = window.__keyframes, S = K.S, out = { missing: [], diff: [] };
  // a different valid value for every setting
  const alt = {}; for (const k of Object.keys(DEFAULTS)) { if (k === 'audioKey' || k === 'fx') continue; const d = DEFAULTS[k];
    if (typeof d === 'boolean') alt[k] = !d; else if (IO_CHOICES[k]) alt[k] = IO_CHOICES[k].find(c => String(c) !== String(d)); else if (k === 'audioFadeOutLen') alt[k] = 1.25;
    else if (typeof d === 'number' && IO_RANGES[k]) { const [lo, hi] = IO_RANGES[k]; alt[k] = Math.abs(d - lo) > Math.abs(d - hi) ? lo : hi; if (alt[k] === d) alt[k] = (lo + hi) / 2; }
    else if (/^tag[A-Z]/.test(k)) alt[k] = 'x' + k; else if (k === 'bg' || k === 'ink') alt[k] = '#123456'; else if (typeof d === 'number') alt[k] = d + 1; else if (typeof d === 'string') alt[k] = k === 'creditsFont' ? '' : d; else alt[k] = d; }
  alt.fx = fxClone(FX_DEFAULT); alt.fx.eq = { on: true, bands: [{ type: 'peaking', f: 800, g: 4, q: 1.2, on: true }, { type: 'highshelf', f: 6000, g: -3, q: 0.7, on: true }], lin: true, auto: false };
  alt.fx.imager = { on: true, width: 130, monoBass: 120, bw: [80, 110, 140], bal: -20 }; alt.fx.noise = { on: true, profile: null, reduction: 18, sensitivity: 60, smoothing: 40, dur: 0 };
  Object.assign(S.set, alt);
  const text = buildExport('settings'); const was = JSON.parse(JSON.stringify(S.set));
  Object.assign(S.set, JSON.parse(JSON.stringify(DEFAULTS)), { audioKey: '' }); S.set.fx = fxClone(FX_DEFAULT);
  await importSettings(new File([text], 'x.txt'));
  const now = JSON.parse(JSON.stringify(S.set));
  for (const k of Object.keys(DEFAULTS)) { if (k === 'audioKey') continue; const a = JSON.stringify(was[k]), c = JSON.stringify(now[k]); if (a !== c) { if (k === 'fx') { let i = 0; while (a[i] === c[i]) i++; out.diff.push('fx first differs at: ' + a.slice(Math.max(0, i - 40), i + 80) + '  ->  ' + c.slice(Math.max(0, i - 40), i + 80)); } else out.diff.push(k + ': ' + a + ' -> ' + c); } }
  out.keys = Object.keys(JSON.parse(text).settings).length; out.ioChoicesKeys = Object.keys(IO_CHOICES); return out; });
 console.log(JSON.stringify(r, null, 1).slice(0, 2500)); console.log('errors', errs); await b.close(); })();
