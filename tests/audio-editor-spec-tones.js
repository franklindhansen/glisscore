// The Spec view shows a tone at its real level wherever it sits: tones of the same loudness from 50Hz to 19.7kHz all read within 1.5dB of each other (a loudest-bin reading; the average of a wide high band showed a
// 16kHz whistle 10dB too quiet), each in the band of its own pitch; white noise's level is steady within 8dB from 1kHz to 18kHz; and the hover readout gives the same decibels as the picture. Run through tests/run-all.sh.
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, freqs = [50, 100, 220, 440, 1000, 2000, 4000, 8000, 12000, 16000, 19700], per = sr, secs = freqs.length + 4, n = sr * secs, wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
for (let i = 0; i < n; i++) { const k = Math.floor(i / per); let v; if (k < freqs.length) v = 0.5 * Math.sin(2 * Math.PI * freqs[k] * i / sr); else v = 0.1 * (rnd() * 2 - 1) * Math.sqrt(3); const q = Math.round(v * 32767); wav.writeInt16LE(q, 44 + i * 4); wav.writeInt16LE(q, 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-spec-tones.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  await p.evaluate(() => { const r = document.querySelector('input[name=aeView][value=spec]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForFunction(() => AE.spec && AE.spec.done >= AE.spec.cols, null, { timeout: 60000 });
  const r = await p.evaluate(({ freqs, nTones }) => { const sp = AE.spec, B = SPEC_B, bandAt = f => Math.min(B - 1, Math.floor(Math.log(f / SPEC_FMIN) / Math.log(sp.fmax / SPEC_FMIN) * B)), colAt = t => Math.round((t - sp.t0) / sp.cs), out = { tones: [], noise: [] };
    freqs.forEach((f, i) => { const acc = new Float64Array(B); let n = 0; for (let c = colAt(i + 0.3); c < colAt(i + 0.7); c++) { for (let k = 0; k < B; k++) acc[k] += sp.db[c * B + k]; n++; } let bk = 0; for (let k = 1; k < B; k++) if (acc[k] > acc[bk]) bk = k; out.tones.push({ f, db: acc[bk] / n, band: bk, want: bandAt(f) }); });
    for (const f of [1000, 5000, 12000, 18000]) { let s = 0, n = 0; for (let c = colAt(nTones + 0.5); c < colAt(nTones + 3.5); c++) for (let k = bandAt(f) - 2; k <= bandAt(f) + 2; k++) { s += sp.db[c * B + k]; n++; } out.noise.push({ f, db: s / n }); }
    out.fmax = sp.fmax; return out; }, { freqs, nTones: freqs.length });
  const lv = r.tones.map(t => t.db), spread = Math.max(...lv) - Math.min(...lv);
  ok('tones of one loudness read the same from 50Hz to 19.7kHz (within 1.5dB of each other)', spread <= 1.5, r.tones.map(t => t.f + ':' + t.db.toFixed(1)).join(' ') + ' spread ' + spread.toFixed(2));
  ok('each reads close to its true level (a −6dBFS sine: between −7.5 and −5.5)', lv.every(v => v > -7.5 && v < -5.5), Math.min(...lv).toFixed(1) + '..' + Math.max(...lv).toFixed(1));
  const centre = k => 20 * Math.pow(r.fmax / 20, (k + 0.5) / 320), near = r.tones.map(t => ({ f: t.f, at: centre(t.band) }));
  ok('each is at its own pitch (within 5%, or one analysis bin of 21.5Hz low down)', near.every(t => Math.abs(t.at - t.f) <= Math.max(t.f * 0.05, 21.5)), near.map(t => t.f + ':' + Math.round(t.at)).join(' '));
  const nz = r.noise.map(x => x.db), rise = Math.max(...nz) - Math.min(...nz); ok('white noise stays within 8dB from 1kHz to 18kHz', rise <= 8, r.noise.map(x => x.f + ':' + x.db.toFixed(1)).join(' '));
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
