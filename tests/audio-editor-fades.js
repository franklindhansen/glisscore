// Separate fade in and fade out lengths: the slider's Both, In and Out, the envelope, and the sound the export and the disk store make.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-fades.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8123/index.html?disk=0');
  await p.setInputFiles('#audioIn', FX + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer, null, { timeout: 30000 });
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400); await p.evaluate(() => aeTool('fades')); await p.waitForTimeout(500);
  const set = async v => { await p.evaluate(v => { const r = document.querySelector('#aeFadeLen'); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, v); await p.waitForTimeout(100); };
  const pick = v => p.click('label:has(input[name=aeFadeSide][value=' + v + '])');
  const st = () => p.evaluate(() => ({ on: AE.d.audioFades, i: AE.d.audioFadeLen, o: AE.d.audioFadeOutLen, lens: aeFadeLens(AE.d) }));
  await set(0.6); let s = await st(); ok('Both sets one length', s.on && s.lens[0] === 0.6 && s.lens[1] === 0.6 && s.o === null, JSON.stringify(s));
  await pick('in'); await set(0.2); s = await st(); ok('In changes only the start', s.lens[0] === 0.2 && s.lens[1] === 0.6, JSON.stringify(s));
  await pick('out'); await set(0); s = await st(); ok('Out at 0 leaves the end without a fade', s.on && s.lens[0] === 0.2 && s.lens[1] === 0, JSON.stringify(s));
  const env = await p.evaluate(() => { const d = AE.d, e = aeEnd(d); return [aeF(d, d.vStart, e, d.vStart), aeF(d, d.vStart, e, d.vStart + 0.1), aeF(d, d.vStart, e, e - 0.01), aeF(d, d.vStart, e, (d.vStart + e) / 2)]; });
  ok('envelope: silent at the start, partway in, full at the end (no out fade)', env[0] === 0 && env[1] > 0.1 && env[1] < 1 && env[2] === 1 && env[3] === 1, JSON.stringify(env));
  await set(1.0); s = await st(); ok('Out alone back on', s.lens[0] === 0.2 && s.lens[1] === 1.0);
  await pick('both'); await set(0.4); s = await st(); ok('Both again makes them one', s.lens[0] === 0.4 && s.lens[1] === 0.4 && s.o === null, JSON.stringify(s));
  await set(0); s = await st(); ok('Both at 0 switches the fades off', s.on === false);
  // turning Out off by dragging it down must leave In where it was
  await pick('both'); await set(0.5); await pick('in'); await set(1.2); await pick('out'); await set(2.0);
  for (const v of [1.5, 1.0, 0.5, 0.2, 0.1, 0]) await set(v);
  s = await st(); ok('dragging Out to Off leaves In at 1.2s', s.on && s.lens[0] === 1.2 && s.lens[1] === 0, JSON.stringify(s));
  await pick('in'); await set(0.8); s = await st(); ok('In still moves on its own afterward', s.lens[0] === 0.8 && s.lens[1] === 0, JSON.stringify(s));
  await pick('out'); await set(0.8); s = await st(); ok('Out turned back on at the same length as In stays its own', s.lens[0] === 0.8 && s.lens[1] === 0.8, JSON.stringify(s));
  await pick('in'); await set(0.3); s = await st(); ok('and moving In then leaves Out at 0.8s', s.lens[0] === 0.3 && s.lens[1] === 0.8, JSON.stringify(s));
  await pick('both'); await set(0.8); await pick('in'); await set(0); s = await st(); ok('turning In off from linked lengths leaves Out at 0.8s', s.on && s.lens[0] === 0 && s.lens[1] === 0.8, JSON.stringify(s));
  await pick('out'); await set(0); s = await st(); ok('then Out off too switches the fades off', s.on === false, JSON.stringify(s));
  // the sound itself: the exported samples against the envelope, on a recording held in memory and on one held on the disk store
  for (const disk of [0, 1]) {
    const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.setDefaultTimeout(30000); q.on('pageerror', e => errs.push(String(e)));
    await q.goto('http://localhost:8123/index.html?disk=' + disk); await q.setInputFiles('#audioIn', FX + '/stereo.wav'); await q.waitForFunction(() => S.audio, null, { timeout: 30000 }); await q.waitForTimeout(1200);
    await q.evaluate(() => openAudioEditor()); await q.waitForTimeout(500);
    const r = await q.evaluate(async () => {
      const mk = async fades => { const d = aeCopy(AE.d); d.audioFades = fades; d.audioFadeLen = 0.5; d.audioFadeOutLen = 1.0; d.audioFadeShape = 'smooth'; const dk = !!S.audio.disk, ch = 2;
        const mm = dk ? await aeMasterDisk(d, ch, false, () => {}) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false, () => {}); const out = new Float32Array(mm.total * ch); await mm.fill(0, mm.total, out); return { out, sr: mm.sr, total: mm.total, d }; };
      const A = await mk(false), B = await mk(true), win = Math.round(A.sr * 0.05), res = []; let worst = 0;
      const e = aeEnd(B.d), vs = B.d.vStart;
      for (let w = 0; w + win <= A.total; w += win) { let a = 0, b = 0; for (let k = w; k < w + win; k++) { a += A.out[k] ** 2; b += B.out[k] ** 2; } const want = aeF(B.d, vs, e, vs + (w + win / 2) / A.sr); if (a > 1e-8) worst = Math.max(worst, Math.abs(Math.sqrt(b / a) - want)); }
      return { worst, dur: A.total / A.sr, first: Math.abs(B.out[0]), lastv: Math.abs(B.out[B.out.length - 2]) };
    });
    ok((disk ? 'disk store' : 'memory') + ': exported sound follows the In 0.5s / Out 1.0s envelope', r.worst < 0.06 && r.first < 1e-3 && r.lastv < 1e-3, JSON.stringify(r));
    await q.close();
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})();
