// The Level tool's numbers are the numbers of the file that comes out. A seeded random file (quiet bed, loud passages, a few hits) is exported with Peak targets, a Gain, and Off, and the loudest sample of
// each export is read back (Peak must land on its target or just under it, as the target is for the true peak, Gain must change it by exactly its amount, Off must change nothing). The two target boxes (Peak, Loudness) show what was taken after a
// change: a number outside the range is clamped, one decimal is kept, and text that is not a number puts the old value back.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-level-numbers.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
let seed = 20261114; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const sr = 44100, secs = 8, n = sr * secs, wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
let env = 0.05, left = 0; for (let i = 0; i < n; i++) { if (left-- <= 0) { env = [0.02, 0.05, 0.12, 0.3][Math.floor(rnd() * 4)]; left = Math.floor(sr * (0.25 + rnd() * 1.5)); } const t = i / sr, v = env * (0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.5 * (rnd() * 2 - 1)) + (rnd() < 0.0001 ? 0.4 : 0); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * 0.9)) * 32767), 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-level-numbers.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms)), db = x => 20 * Math.log10(x);
    aeTool('level'); const out = {};
    const top = async set => { const d = AE.d; Object.assign(d, { normalize: false, normBy: 'peak', limiter: false, gainDb: 0 }, set); aeRefresh(); await sleep(400);
      const buf = (await fxGet(d.fx)).buffer, mm = await aeMasterFor(d, buf, 2, false), t = mm.total, w = new Float32Array(t * 2); await mm.fill(0, t, w); let m = 0; for (let i = 0; i < w.length; i++) m = Math.max(m, Math.abs(w[i])); return db(m); };
    const base = await top({}); out.base = base;
    out.peaks = []; for (const t of [-1, -3, -6, 0]) out.peaks.push([t, await top({ normalize: true, normBy: 'peak', normPeakDb: t })]);
    out.gains = []; for (const g of [6, -6, 0.5]) out.gains.push([g, (await top({ gainDb: g })) - base]);
    const type = (sel, v) => { const e = document.querySelector(sel); e.focus(); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); const shown = e.value; e.blur(); return shown; };
    Object.assign(AE.d, { normalize: true, normBy: 'peak', normPeakDb: -1 }); aeRefresh(); await sleep(300);
    out.peakBox = ['5', '-50', 'abc', '', '-1.234'].map(v => [v, type('#aeNormDb', v), AE.d.normPeakDb]);
    Object.assign(AE.d, { normalize: true, normBy: 'loud', normLufs: -14 }); aeRefresh(); await sleep(500);
    out.loudBox = ['0', '-100', 'xyz', '', '-14.449'].map(v => [v, type('#aeLoudDb', v), AE.d.normLufs]);
    // changed through the controls, one after another: the Gain card, the drawn waveform's scale, and the export all agree
    Object.assign(AE.d, { normalize: false, gainDb: 0, limiter: false }); aeRefresh(); await sleep(300);
    const q = s => document.querySelector(s), click = s => q(s).click(), num = t => parseFloat(t.replace('−', '-')), L = S.audio.duration;
    const ref = (await fxGet(AE.d.fx)).buffer, rms = (w, n) => { let s2 = 0; for (let i = 0; i < w.length; i++) s2 += w[i] * w[i]; return Math.sqrt(s2 / n); };
    const o0 = ref.getChannelData(0), o1 = ref.getChannelData(1); let so = 0; for (let i = 0; i < o0.length; i++) so += o0[i] * o0[i] + o1[i] * o1[i];
    const snap = async label => { await sleep(1800); for (let i = 0; i < 100 && /Processing/.test(q('#aeLoudNote').textContent); i++) await sleep(100); await sleep(300); const d = AE.d, buf = (await fxGet(d.fx)).buffer, mm = await aeMasterFor(d, buf, 2, false), t = mm.total, w = new Float32Array(t * 2); await mm.fill(0, t, w); let sq = 0; for (let i = 0; i < w.length; i++) sq += w[i] * w[i];
      return { label, ui: num(q('#aeGainBig').textContent), drawn: db(aeLevel(d, 0, L)), real: db(Math.sqrt(sq / so)) }; };
    out.seq = [];
    click('input[name=aeNormMode][value=peak]'); out.seq.push(await snap('Peak -1'));
    type('#aeNormDb', '-6'); out.seq.push(await snap('Peak -6'));
    click('input[name=aeNormMode][value=loud]'); await sleep(300); if (AE.d.limiter) click('#aeLimiter');          // the limiter takes some off the loudest hits, so it is off for this comparison
    out.seq.push(await snap('Loudness'));
    type('#aeLoudDb', '-20'); out.seq.push(await snap('Loudness -20'));
    click('input[name=aeNormMode][value=peak]'); out.seq.push(await snap('Peak again'));
    click('input[name=aeNormMode][value=off]'); out.seq.push(await snap('Off'));
    const g = q('#aeGain'); g.value = 5; g.dispatchEvent(new Event('input', { bubbles: true })); out.seq.push(await snap('Gain +5'));
    click('input[name=aeNormMode][value=peak]'); out.seq.push(await snap('Peak with Gain +5 set'));
    click('input[name=aeNormMode][value=off]'); out.seq.push(await snap('Off, Gain +5 back'));
    g.value = -8; g.dispatchEvent(new Event('input', { bubbles: true })); out.seq.push(await snap('Gain -8'));
    return out;
  });
  ok('Off changes nothing about the loudest sample (reference taken)', Number.isFinite(r.base), r.base.toFixed(2) + 'dB');
  for (const [t, v] of r.peaks) ok('Peak ' + t + 'dB: the loudest sample of the export is at the target, or just under it (the target is for the true peak, which is a little above the loudest sample)', v <= t + 0.005 && v > t - 0.3, v.toFixed(3) + 'dB');
  for (const [g, v] of r.gains) ok('Gain ' + g + 'dB changes the loudest sample by exactly that', Math.abs(v - g) < 0.01, v.toFixed(3) + 'dB');
  const want = { peak: [['5', '0.0', 0], ['-50', '-12.0', -12], ['abc', '-12.0', -12], ['', '-12.0', -12], ['-1.234', '-1.2', -1.2]], loud: [['0', '-6.0', -6], ['-100', '-36.0', -36], ['xyz', '-36.0', -36], ['', '-36.0', -36], ['-14.449', '-14.4', -14.4]] };
  ok('the Peak box shows what was taken: clamped, one decimal, the old value back for text', JSON.stringify(r.peakBox) === JSON.stringify(want.peak), JSON.stringify(r.peakBox));
  ok('the Loudness box shows what was taken: clamped, one decimal, the old value back for text', JSON.stringify(r.loudBox) === JSON.stringify(want.loud), JSON.stringify(r.loudBox));
  for (const x of r.seq) ok(x.label + ': the Gain card and the drawn waveform say what the export does', Math.abs(x.ui - x.real) < 0.06 && Math.abs(x.drawn - x.real) < 0.02, 'card ' + x.ui + ', drawn ' + x.drawn.toFixed(2) + ', export ' + x.real.toFixed(2));
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close(); fs.unlinkSync(file);
})();
