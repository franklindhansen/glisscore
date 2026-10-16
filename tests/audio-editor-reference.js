// The built-in Wind ensemble reference (Presets > Match a reference), EQ and Imager by the app's own sums for a recording held in memory (set against the browser's render),
// and a loudness target the limiter cannot reach. In memory and on the disk store. Makes its own test sound (a loud low note with noise).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-reference.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
function wav() {
  const sr = 48000, n = sr * 8, b = Buffer.alloc(44 + n * 4); let s = 7, lp = 0;
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const w = s / 2147483647 * 2 - 1; lp += (w - lp) * 0.15; const l = 0.5 * Math.sin(2 * Math.PI * 60 * i / sr) + 0.2 * lp + 0.03 * w, r = 0.5 * Math.sin(2 * Math.PI * 60 * i / sr + 0.4) + 0.2 * lp - 0.03 * w; b.writeInt16LE(Math.round(l * 32767), 44 + i * 4); b.writeInt16LE(Math.round(r * 32767), 46 + i * 4); }
  const f = path.join(os.tmpdir(), 'glisscore-reference-check.wav'); fs.writeFileSync(f, b); return f;
}
(async () => {
  const file = wav(), b = await chromium.launch();
  for (const disk of [0, 1]) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message)); const tag = disk ? 'store: ' : 'memory: ';
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio && (S.audio.buffer || S.audio.disk)); await p.waitForTimeout(1000);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const m = await p.evaluate(async () => {
      const s = document.querySelector('#aeEqPreset'); s.value = 'ref:Wind ensemble'; s.dispatchEvent(new Event('change', { bubbles: true })); for (let i = 0; i < 200 && !(AE.match && AE.match.target); i++) await sleep(50); await sleep(200);
      return { groups: [...s.querySelectorAll('optgroup')].map(g => g.label + ' ' + g.children.length), open: !document.querySelector('#aeMatch').hidden, name: document.querySelector('#aeRefName').textContent, curve: AE.d.fx.eq.curve || null, bands: AE.d.fx.eq.bands.length, follow: (c => { const r = eqCurveOf([]); let w = 0; for (let i = 0; i < 240; i++) w = Math.max(w, Math.abs(r[i] - c[i])); return w; })(AE.d.fx.eq.curve || []), old: EQ_PRESETS.some(q => /Wind ensemble/.test(q[0])), zone: (z => z && z.lo.length === 240 && z.hi.length === 240 && z.lo.every((v, i) => v <= 0.001 && z.hi[i] >= -0.001) && Math.max(...z.hi) > 1 && Math.min(...z.lo) < -1 && z.lo[0] === 0 && z.hi[239] === 0)(AE.match.zone), low: AE.match.target[0], high: AE.match.target[239], worst: Math.max(...(AE.d.fx.eq.curve || [0]).map(Math.abs)), toBands: (() => { aeMatchToBands(); return { n: AE.d.fx.eq.bands.length, curve: !!AE.d.fx.eq.curve, open: !document.querySelector('#aeMatch').hidden }; })() };
    });
    ok(tag + 'Presets lists the reference apart from the starting points, and the old Wind ensemble presets are gone', m.groups.length === 2 && !m.old, m.groups.join(', '));
    ok(tag + 'choosing Wind ensemble opens EQ Match on it and makes a free curve the filters follow, with the bands left alone', m.open && m.name === 'Wind ensemble' && m.curve && m.curve.length === 240 && m.bands === 0 && m.worst <= 12 && m.follow < 2, JSON.stringify({ n: m.curve && m.curve.length, bands: m.bands, follow: m.follow }));
    ok(tag + 'Turn into bands replaces the curve with up to 8 bands and closes EQ Match', m.toBands.n > 0 && m.toBands.n <= 8 && !m.toBands.curve && !m.toBands.open, JSON.stringify(m.toBands));
    ok(tag + 'the built-in reference shows the spread of the six recordings as a zone, narrowing to nothing at the far ends', m.zone === true);
    ok(tag + 'the built-in reference asks nothing at the far ends (20Hz, 20kHz)', m.low === 0 && m.high === 0);
    if (!disk) {
      const d = await p.evaluate(async () => {
        const fx = AE.d.fx; fx.imager.on = true; fx.imager.width = 140; fx.imager.bw = [60, 100, 130]; FXC.clear(); const a = await fxGet(fx); FXC.clear(); const c = await fxGet(fx, { browser: true }); let mx = 0, pk = 0;
        for (let ch = 0; ch < 2; ch++) { const x = a.buffer.getChannelData(ch), y = c.buffer.getChannelData(ch); for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i] - y[i]); if (v > mx) mx = v; if (Math.abs(y[i]) > pk) pk = Math.abs(y[i]); } } FXC.clear(); return { mx, pk, tools: fxActive(fx, 2).join('+') };
      });
      ok(tag + 'EQ and Imager by the app\'s own sums give what the browser\'s render gives', d.mx / d.pk < 1e-4, 'largest difference ' + (20 * Math.log10(d.mx / d.pk + 1e-12)).toFixed(0) + 'dB under the peak (' + d.tools + ')');
    }
    const l = await p.evaluate(async () => { aeFx(fx => { fx.eq.on = false; fx.imager.on = false; }); Object.assign(AE.d, { normalize: true, normBy: 'loud', normLufs: -3, limiter: true }); aeRefresh(); const r = await limEnsure(AE.d); aeRefresh(); await sleep(300); const n = document.querySelector('.lv-note.warn'); return { I: r.I, short: r.short, gr: r.gr, note: n ? n.textContent : '' }; });
    ok(tag + 'a loudness target out of reach stops short and the note says so', l.short === true && l.I < -3.1 && /Limiter at its limit/.test(l.note), JSON.stringify(l));
    const l2 = await p.evaluate(async () => { AE.d.normLufs = -16; aeRefresh(); const r = await limEnsure(AE.d); return { I: r.I, short: r.short }; });
    ok(tag + 'a target within reach lands on it', Math.abs(l2.I + 16) < 0.1 && !l2.short, JSON.stringify(l2));
    ok(tag + 'no page errors', !errs.length, errs.join('; ')); await p.close();
  }
  await b.close(); fs.unlinkSync(file);
})();
