// The noise tool's Auto: one press works the noise out from the whole recording (no quiet gap to find, no Learn), and Natural then cleans it in two sizes of slice.
// A made recording is used: notes that never stop over steady hiss, with one second of hiss alone at the very end to measure by. Checked in memory and on the disk store:
// Auto sets a profile and stays pressed, Trim silence then judges the cleaned sound, pressing it again puts back what was there, the hiss goes down by nearly the Reduction asked for, the music keeps its level, and both stores give the same samples.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-noise-auto.js   (SHOTS=folder also saves pictures of the panel)
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, secs = 30, n = sr * secs, x = new Float32Array(n); let seed = 99; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
{ const scale = [196, 220, 262, 294, 330, 392, 440, 523, 659, 784]; let t = 0; while (t < (secs - 1) * sr) { const dur = Math.round((0.3 + rnd() * 0.8) * sr); for (let v = 0; v < 3; v++) { const f0 = scale[Math.floor(rnd() * scale.length)], amp = 0.04 + rnd() * 0.05; for (let i = 0; i < dur && t + i < (secs - 1) * sr; i++) { const tt = i / sr, env = Math.min(1, tt * 60) * Math.min(1, (dur - i) / (0.05 * sr)); let s = 0; for (let h = 1; h <= 10; h++) s += Math.sin(2 * Math.PI * f0 * h * tt + h) / Math.pow(h, 1.2); x[t + i] += amp * env * s; } } t += Math.round(dur * 0.95); } }
const wav = Buffer.alloc(44 + n * 4); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { const l = x[i] + 0.006 * gauss(), r = x[i] * 0.8 + 0.006 * gauss(); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-noise-auto.wav'); fs.writeFileSync(file, wav);
// Noise sample's steps on a recording too short for a whole-recording reading (the fixture): the wording, the pressed buttons, the "Too short" note, and one width for the three buttons
async function steps(b) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(800);
  await p.evaluate(() => { openAudioEditor(); aeTool('noise'); }); await p.waitForTimeout(800);
  const press = () => p.evaluate(() => ['#aeNrFind', '#aeNrHand'].map(s => document.querySelector(s).getAttribute('aria-pressed')).join());          // "auto,manual"
  const g = await p.evaluate(() => { const r = document.querySelector('#aeCanvas').getBoundingClientRect(); return { y: r.y, h: r.height }; });
  const timeX = t => p.evaluate(t => document.querySelector('#aeCanvas').getBoundingClientRect().x + aeX(t), t);
  const drag = async (a, z) => { const xa = await timeX(a), xz = await timeX(z), y = g.y + g.h / 2; await p.mouse.move(xa, y); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(xa + (xz - xa) * i / 8, y); await p.mouse.up(); await p.waitForTimeout(150); };
  const widths = () => p.evaluate(() => ['#aeNrFind', '#aeNrHand', '#aeNrLearn'].map(s => document.querySelector(s).getBoundingClientRect().width));
  // the wording
  const w0 = await p.evaluate(() => ({ title: document.querySelector('#aeNrSample .mt-title').textContent, btns: ['#aeNrFind', '#aeNrHand', '#aeNrLearn'].map(s => document.querySelector(s).textContent), selTxt: !!document.querySelector('#aeNrSelTxt'), old: /Select noise|Learn noise|selected/.test(document.querySelector('#aeNrSample').textContent) }));
  ok('short recording: the steps read Select, Auto, Manual, and Learn, and the selection length text is gone', w0.title === 'Select' && w0.btns.join() === 'Auto,Manual,Learn' && !w0.selTxt && !w0.old, JSON.stringify(w0));
  // one width, before and while Auto works
  const wa = await widths(), seen = [];
  await p.evaluate(() => document.querySelector('#aeNrFind').click()); for (let i = 0; i < 30; i++) { seen.push(await widths()); await p.waitForTimeout(40); } await p.waitForFunction(() => !AE.nrAutoBusy); await p.waitForTimeout(700);
  ok('short recording: Auto, Manual, and Learn are one width before and while Auto works', [...wa, ...seen.flat()].every(x => Math.abs(x - wa[0]) < 0.6) && wa[0] >= 100, JSON.stringify({ wa, spread: Math.max(...seen.flat()) - Math.min(...seen.flat()) }));
  // Auto on a short recording only picks a stretch: it is pressed, the stretch is orange, and Manual is not
  const a1 = await p.evaluate(() => { const s = AE.nsel, cv = document.querySelector('#aeCanvas'), k = cv.width / cv.clientWidth, px = (t, y) => { const d = cv.getContext('2d').getImageData(Math.round(aeX(t) * k), Math.round(y * k), 1, 1).data; return [d[0], d[1], d[2]]; }; const mid = s && (s.a + s.b) / 2; return { sel: !!s, by: AE.nsBy, inside: s && px(mid, 90), outside: s && px(Math.max(0, s.a - 0.4), 90), profile: !!AE.d.fx.noise.profile }; });
  const orange = c => c && c[0] - c[2] > 18, st1 = await press();
  ok('short recording: Auto is pressed after it picks a stretch, the stretch is orange on the waveform, and Manual is not pressed', a1.sel && a1.by === 'auto' && !a1.profile && st1 === 'true,false' && orange(a1.inside) && !orange(a1.outside), JSON.stringify({ a1, st1 }));
  await p.evaluate(() => document.querySelector('#aeNrFind').click()); await p.waitForTimeout(300);
  const a2 = await p.evaluate(() => ({ sel: !!AE.nsel, on: document.querySelector('#aeNrFind').getAttribute('aria-pressed') }));
  ok('short recording: pressing the pressed Auto puts back what was there (nothing selected, Auto not pressed)', !a2.sel && a2.on === 'false', JSON.stringify(a2));
  // Manual: pressed while armed, and after a drag while that selection stands
  await p.click('#aeNrHand'); const m1 = await press(); await drag(1.0, 1.8); const m2 = await press(), sel = await p.evaluate(() => ({ by: AE.nsBy, len: AE.nsel && +(AE.nsel.b - AE.nsel.a).toFixed(2), armed: AE.nsArm, learnDis: document.querySelector('#aeNrLearn').disabled }));
  ok('Manual is pressed while armed, and stays pressed after a drag while that selection stands', m1 === 'false,true' && m2 === 'false,true' && sel.by === 'hand' && sel.len > 0.7 && !sel.armed && !sel.learnDis, JSON.stringify({ m1, m2, sel }));
  await p.click('#aeNrLearn'); await p.waitForFunction(() => !AE.nrLearning && AE.d.fx.noise.profile); await p.waitForTimeout(900);
  const l1 = await p.evaluate(() => ({ learn: document.querySelector('#aeNrLearn').textContent, chip: document.querySelector('#aeNrChipTxt').textContent, hand: document.querySelector('#aeNrHand').getAttribute('aria-pressed'), auto: document.querySelector('#aeNrFind').getAttribute('aria-pressed') }));
  ok('after learning from a hand selection: the step reads Learn again, and Manual stays pressed while the selection stands', l1.learn === 'Learn again' && /Learned/.test(l1.chip) && l1.hand === 'true' && l1.auto === 'false', JSON.stringify(l1));
  await p.evaluate(() => document.querySelector('#aeNrFind').click()); await p.waitForFunction(() => !AE.nrAutoBusy); await p.waitForTimeout(400);
  const a3 = await press(), by3 = await p.evaluate(() => AE.nsBy);
  ok('Auto after a hand selection takes the pressed look, and Manual lets go', a3 === 'true,false' && by3 === 'auto', a3 + ' ' + by3);
  // the "Too short" note: a drag under 0.3s, on the waveform's center line in the waveform, the spectrogram, and full screen; trim stops use the same place
  const note = () => p.evaluate(() => { const n = document.querySelector('#aeStopNote'), cv = document.querySelector('#aeCanvas'), bar = document.querySelector('#audioDlg .ae-bar'), full = document.querySelector('#audioDlg').classList.contains('afull'), inset = full ? 0 : (bar && bar.offsetHeight ? bar.offsetHeight + 8 : 0), top = cv.getBoundingClientRect().top, Hc = Math.max(60, cv.clientHeight - inset), want = top + AE_RULER + (Hc - AE_RULER) / 2 - 2, r = n.getBoundingClientRect(); return { hidden: n.hidden, text: n.textContent, op: +getComputedStyle(n).opacity, off: (r.top + r.bottom) / 2 - want }; });
  const short = async tag => {
    await p.click('#aeNrHand'); await drag(0.5, 0.6); await p.waitForTimeout(700); const n = await note(), l = await p.evaluate(() => ({ dis: document.querySelector('#aeNrLearn').disabled, hand: document.querySelector('#aeNrHand').getAttribute('aria-pressed') }));
    ok(tag + ': a drag under 0.3s shows "Too short. Select at least 0.3s." on the waveform\'s center line, and Learn stays off', !n.hidden && n.text === 'Too short. Select at least 0.3s.' && n.op > 0.9 && Math.abs(n.off) <= 0.5 && l.dis && l.hand === 'true', JSON.stringify({ n, l }));
    await p.evaluate(() => { aeStopClear(); }); await p.waitForTimeout(500);
    await p.evaluate(() => aeTrimSaid('start', { turn: 2, t: 1 })); await p.waitForTimeout(700); const t = await note();
    ok(tag + ': a trim stop shows its note in the same place', !t.hidden && /Page turn 2/.test(t.text) && Math.abs(t.off) <= 0.5, JSON.stringify(t)); await p.evaluate(() => { aeStopClear(); }); await p.waitForTimeout(500);
  };
  await short('waveform');
  await p.evaluate(() => { const r = document.querySelector('input[name=aeView][value=spec]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(900); await short('spectrogram');
  await p.click('#aeFull'); await p.waitForTimeout(1200); await short('full screen');
  ok('no page errors (the button guard reports through them)', errs.length === 0, errs.join(' | ')); await p.close();
}
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), cut = [];
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ', p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      const find = document.querySelector('#aeNrFind'), w3 = () => ['#aeNrFind', '#aeNrHand', '#aeNrLearn'].map(q => document.querySelector(q).getBoundingClientRect().width), w = () => w3(); const press = async () => { document.querySelector('#aeNrFind').click(); await sleep(60); const bar = document.querySelector('#aeNrFind').classList.contains('loading'); (window.__wBusy = window.__wBusy || []).push(w3()); for (let i = 0; i < 400 && AE.nrAutoBusy; i++) await sleep(25); await sleep(150); return bar; };
      aeTool('noise'); await sleep(300); const o = {}; o.w0 = w3(); o.r0 = aeSilenceRange(); o.bar = await press(); const nz = AE.d.fx.noise; o.auto = !!nz.auto && !!nz.profile; o.on = document.querySelector('#aeNrFind').getAttribute('aria-pressed') === 'true'; o.chip = document.querySelector('#aeNrChipTxt').textContent; o.sel = !!AE.nsel;
      await press(); o.back = !AE.d.fx.noise.profile && document.querySelector('#aeNrFind').getAttribute('aria-pressed') !== 'true'; await press(); o.again = !!AE.d.fx.noise.auto;
      aeFx(fx => { fx.noise.reduction = 18; }); const d = AE.d, ch = 2, grab = async () => { const mm = S.audio.disk ? await aeMasterDisk(d, ch, false, null) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false), w = new Float32Array(mm.total * ch); await mm.fill(0, mm.total, w); return { w, total: mm.total, sr: mm.sr }; };
      const t0 = performance.now(), y = await grab(); o.ms = Math.round(performance.now() - t0); await fxGet(d.fx); o.r1 = aeSilenceRange(); aeFx(fx => { fx.noise.reduction = 0; }); const u = await grab(), sr = y.sr, rms = (g, a, b) => { let s = 0; for (let i = Math.round(a * sr); i < Math.round(b * sr); i++) s += g.w[i] * g.w[i]; return 10 * Math.log10(s / ((b - a) * sr) + 1e-20); };
      o.wBusy = window.__wBusy; o.hiss = rms(u, 29.3, 29.9) - rms(y, 29.3, 29.9); o.music = rms(y, 5, 25) - rms(u, 5, 25); o.cut = Array.from(y.w.subarray(Math.round(12 * sr), Math.round(12 * sr) + 4000)); return o;
    });
    cut.push(r.cut);
    ok(tag + 'Auto, Manual, and Learn share one width, held for "Processing 100%" from the first layout, so none changes width when one starts to work', r.w0[0] >= 100 && [...r.w0, ...r.wBusy.flat()].every(x => Math.abs(x - r.w0[0]) < 0.6), JSON.stringify({ before: r.w0, whileBusy: r.wBusy }));
    ok(tag + 'Auto shows its bar, sets a profile from the whole recording and stays pressed, with nothing left selected', r.bar && r.auto && r.on && r.chip === 'Whole recording' && !r.sel, JSON.stringify({ bar: r.bar, auto: r.auto, on: r.on, chip: r.chip }));
    ok(tag + 'pressing Auto again puts back what was there; once more measures again', r.back && r.again);
    ok(tag + 'with Reduction at 18dB the hiss goes down by nearly that, and the music keeps its level', r.hiss > 14 && r.hiss < 19 && Math.abs(r.music) < 0.6, 'hiss down ' + r.hiss.toFixed(1) + 'dB, music ' + r.music.toFixed(2) + 'dB, ' + r.ms + 'ms for 30s');
    ok(tag + 'Trim silence looks at the cleaned sound: the second of hiss at the end, too loud to count as silence before, is trimmed once the noise is down', r.r0 && r.r0[1] > 29.9 && r.r1 && r.r1[1] > 28.9 && r.r1[1] < 29.6, JSON.stringify([r.r0, r.r1]));
    if (process.env.SHOTS) { await p.evaluate(() => { aeFx(fx => { fx.noise.reduction = 12; }); }); await p.waitForTimeout(2500); for (const [w, h] of [[1040, 820], [700, 900], [390, 800]]) { await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(process.env.SHOTS, 'nr-' + (disk ? 'disk' : 'mem') + '-' + w + '.png') }); } }
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await steps(b);
  let worst = 0; for (let i = 0; i < cut[0].length; i++) worst = Math.max(worst, Math.abs(cut[0][i] - cut[1][i]));
  ok('memory and the disk store clean the recording to the same samples', worst < 2e-4, 'worst ' + worst.toExponential(2));
  await b.close(); fs.unlinkSync(file);
})();
