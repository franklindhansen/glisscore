// The sound of the video export (the app's own settings: fades, volume, limiter) from the disk store, set against the same recording in memory: every sample the same.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-audio-disk.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async disk => { const p = await b.newPage(); p.setDefaultTimeout(60000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForFunction(() => S.audio.buffer ? (tpGet(S.audio.buffer, S.audio.peaks), TPK.get(S.audio.buffer).tp) : S.audio.tp); await p.waitForTimeout(500); return p; };
  const m = await open(0), d = await open(1);
  const grab = (p, set) => p.evaluate(async set => {
    Object.assign(S.set, { normalize: false, limiter: false, gainDb: 0, audioFades: true }, set); S.vStart = 0.3; S.vEndSet = null; await fxGet(S.set.fx);
    if (S.set.normalize && S.set.normBy === 'loud') { const da = aeFromApp(); await loudEnsure(da); if (da.limiter) await limEnsure(da); }
    const dk = !!S.audio.disk, sr = audSr(), ch = 2, dur = Math.max(1, duration()), total0 = Math.ceil(dur * sr), gain = audioGain();
    const mm = dk ? await aeMasterDisk(aeFromApp(), ch, false, null, { own: true, total: total0, gain }) : masterMaker(outBuf(), ch, S.vStart, vEnd(), gain, soundFadeAt, { total: total0, limit: limOn(S.set) ? LIM_CEIL : null });
    const out = new Float32Array(mm.total * ch), blk = new Float32Array(sr * ch); for (let pos = 0; pos < mm.total; pos += sr) { const len = Math.min(sr, mm.total - pos); await mm.fill(pos, len, blk); for (let c = 0; c < ch; c++) out.set(blk.subarray(c * len, (c + 1) * len), c * mm.total + pos); }
    let h = 0, pk = 0; for (let i = 0; i < out.length; i++) { h = (h * 31 + Math.round(out[i] * 1e6)) | 0; pk = Math.max(pk, Math.abs(out[i])); } return { total: mm.total, h, pk, gain };
  }, set);
  for (const [name, set] of [['plain', {}], ['peak −3dB', { normalize: true, normBy: 'peak', normPeakDb: -3 }], ['loudness −14 with the limiter', { normalize: true, normBy: 'loud', normLufs: -14, limiter: true }], ['fades off, +2dB', { audioFades: false, gainDb: 2 }]]) {
    const a = await grab(m, set), c = await grab(d, set); ok('video sound, ' + name, a.total === c.total && a.h === c.h, JSON.stringify([a.total, c.total, a.pk.toFixed(5), c.pk.toFixed(5), a.gain.toFixed(4), c.gain.toFixed(4)]));
  }
  ok('no errors', !m.errs.length && !d.errs.length, m.errs.concat(d.errs).join(' | ')); await b.close();
})();
