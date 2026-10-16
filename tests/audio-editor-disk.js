// The Audio Editor and the video player on a recording kept on the disk store (?disk=1), set against the same recording held in memory.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-disk.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const results = [];
const ok = (name, pass, info = '') => { results.push((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); console.log(results[results.length - 1]); };
const near = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async (disk, file, pdf) => {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push('PAGEERR ' + (e.stack || e).toString().slice(0, 300))); p.on('console', m => { if (m.type() === 'error') p.errs.push('CONSOLE ' + m.text().slice(0, 300)); });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html' + (disk === null ? '' : '?disk=' + disk));
    if (pdf) { await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); }
    await p.setInputFiles('#audioIn', FX + '/' + file); await p.waitForFunction(() => S.audio, null, { timeout: 30000 });
    await p.waitForFunction(() => S.audio.buffer ? (tpGet(S.audio.buffer, S.audio.peaks), TPK.get(S.audio.buffer).tp) : S.audio.tp, null, { timeout: 30000 }); await p.waitForTimeout(300);
    return p;
  };
  const editor = async p => { await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700); };
  const settle = async (p, want) => { for (let i = 0; i < 60; i++) { const r = await p.evaluate(() => { const d = AE.d, i = aeLoudInfo(d); return { ready: fxActive(d.fx, fxChannels()).length ? !!fxPeek(d.fx) : true, loud: !d.normalize || d.normBy !== 'loud' || (i && i.ready && (!d.limiter || !!i.lim)) }; }); if (r.ready && r.loud) break; await p.waitForTimeout(300); } await p.waitForTimeout(400); };
  const snap = p => p.evaluate(() => { const d = AE.d, pk = aePeaks(d), c = document.getElementById('aeCanvas'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < x.length; i += 7) h = (h * 31 + x[i]) >>> 0; return { info: aeLoudInfo(d), G: aeLevel(d, 0, S.audio.duration), n: pk.length, sum: Array.from(pk).reduce((a, v) => a + v, 0), hash: h }; });

  // 1: what the load gives
  let m = await open(0, 's24.wav'), d = await open(1, 's24.wav');
  const sm = await m.evaluate(() => ({ buffer: !!S.audio.buffer, dur: S.audio.duration, peaks: Array.from(S.audio.peaks), mx: S.audio.peakMax, chips: document.querySelector('[data-audio]').textContent.length > 0 }));
  const sd = await d.evaluate(() => ({ disk: S.audio.disk, buffer: !!S.audio.buffer, dur: S.audio.duration, sr: S.audio.sr, ch: S.audio.ch, frames: S.audio.frames, peaks: Array.from(S.audio.peaks), mx: S.audio.peakMax, tp: !!S.audio.tp }));
  ok('memory is the default and keeps its buffer', sm.buffer);
  ok('?disk=1: a disk recording with no buffer, and its shape', sd.disk && !sd.buffer && sd.sr === 48000 && sd.ch === 2 && sd.frames === 240000, JSON.stringify({ sr: sd.sr, ch: sd.ch, frames: sd.frames }));
  ok('the waveform peaks are the same as the memory ones', sm.peaks.length === sd.peaks.length && sm.peaks.every((v, i) => v === sd.peaks[i]) && sm.mx === sd.mx && sm.dur === sd.dur);
  ok('the true peaks arrive in the background', sd.tp);

  // 2: the editor, level and waveform, set against memory
  await editor(m); await editor(d);
  const scen = [['plain', {}], ['peak −3dB', { normalize: true, normBy: 'peak', normPeakDb: -3 }], ['loudness −16', { normalize: true, normBy: 'loud', normLufs: -16 }], ['loudness −14 with the limiter', { normalize: true, normBy: 'loud', normLufs: -14, limiter: true }]];
  for (const [name, dd] of scen) {
    for (const p of [m, d]) { await p.evaluate(x => { Object.assign(AE.d, { normalize: false, limiter: false }, x); aeRefresh(); }, dd); await settle(p); }
    const a = await snap(m), c = await snap(d), same = JSON.stringify(a.info) === JSON.stringify(c.info);
    const li = a.info && a.info.lim && c.info && c.info.lim, close = !a.info || (near(a.info.I, c.info.I, 1e-9) && near(a.info.g, c.info.g, 1e-6) && (!li || near(a.info.lim.I, c.info.lim.I, 1e-6)));
    ok('level numbers: ' + name, a.n === c.n && near(a.G, c.G, 1e-6) && (same || close), 'gain ' + a.G.toFixed(5) + ' / ' + c.G.toFixed(5));
    ok('waveform picture: ' + name, a.hash === c.hash && near(a.sum, c.sum, 1e-9));
  }
  // an EQ band: the waveform follows the processed sound
  for (const p of [m, d]) { await p.evaluate(() => { AE.d.normalize = false; AE.d.limiter = false; aeFx(fx => { fx.eq.bands = [{ type: 'peaking', f: 800, g: 5, q: 1, on: true }]; fx.eq.on = true; }); }); await settle(p); await p.waitForTimeout(1500); }
  { const a = await snap(m), c = await snap(d); ok('EQ band: the waveform peaks follow the processed sound', a.n === c.n && near(a.sum, c.sum, 2e-4), a.sum.toFixed(3) + ' / ' + c.sum.toFixed(3)); }
  ok('no errors in either editor', m.errs.length === 0 && d.errs.length === 0, m.errs.concat(d.errs).join(' | '));

  // 3: playing in the editor, a change of settings while it plays, Bypass, stop
  await d.evaluate(() => { aeFx(fx => { fx.eq.bands = []; fx.eq.on = false; }); AE.d.normalize = false; AE.d.limiter = false; aeRefresh(); });
  await d.click('#aePlay'); await d.waitForTimeout(1200);
  const p1 = await d.evaluate(() => ({ playing: AE.playing, pos: AE.pos, dh: !!AE.dh, gaps: AE.dh && AE.dh.gaps() }));
  ok('the editor plays from the store', p1.playing && p1.dh && p1.pos > 0.5 && p1.gaps === 0, JSON.stringify(p1));
  await d.evaluate(() => aeFx(fx => { fx.eq.bands = [{ type: 'peaking', f: 1000, g: 6, q: 1, on: true }]; fx.eq.on = true; })); await d.waitForTimeout(900);
  await d.evaluate(() => { aeTool('eq'); aeToggleBypass(); }); await d.waitForTimeout(600);
  const p2 = await d.evaluate(() => ({ playing: AE.playing, pos: AE.pos, bypass: aeBpAny(), gaps: AE.dh && AE.dh.gaps() }));
  ok('a change of settings and Bypass while it plays: it plays on, no gaps', p2.playing && p2.bypass && p2.pos > p1.pos + 0.8 && p2.gaps === 0, JSON.stringify(p2));
  await d.click('#aePlay'); await d.waitForTimeout(200);
  ok('stop lets go of the player', await d.evaluate(() => !AE.playing && !AE.dh && !AE.starting));
  await d.click('#aePlay'); await d.click('#aePlay'); await d.waitForTimeout(500);
  ok('play then stop at once leaves nothing playing', await d.evaluate(() => !AE.playing && !AE.dh && !AE.starting));
  ok('no errors while playing', d.errs.length === 0, d.errs.join(' | '));

  // 4: what is not on the store yet says so
  await d.evaluate(() => { aeToggleBypass(); }); await d.click('#aeView >> text=Spec'); await d.waitForTimeout(300);
  const g1 = await d.evaluate(() => ({ view: AE.view, toast: (document.querySelector('.toast') || {}).textContent }));
  ok('the spectrogram opens for a stored recording (the full comparison is audio-editor-spec-disk.js)', g1.view === 'spec', g1.view);
  await d.evaluate(() => { window.saveFile = async (blob, name) => { window.__saved = { name, size: blob.size }; }; S.set.audioFormat = 'wav24'; aeExport(); }); await d.waitForFunction(() => window.__saved, null, { timeout: 20000 });
  ok('export writes a file from the store (the full comparison is audio-editor-export-disk.js)', await d.evaluate(() => /Audio\.wav$/.test(__saved.name) && __saved.size > 1e6), JSON.stringify(await d.evaluate(() => __saved)));
  ok('no page errors from the guards', d.errs.length === 0, d.errs.join(' | '));

  // 5: noise learning and the stereo picture read from the store
  await d.evaluate(() => { AE.nsel = { a: 0.2, b: 1.4 }; aeNrLearn(); }); await d.waitForTimeout(1500);
  await m.evaluate(() => { AE.nsel = { a: 0.2, b: 1.4 }; aeNrLearn(); }); await m.waitForTimeout(1500);
  const np = [await m.evaluate(() => AE.d.fx.noise.profile), await d.evaluate(() => AE.d.fx.noise.profile)];
  ok('noise learned from the store equals the memory one', !!np[0] && !!np[1] && np[0].length === np[1].length && np[0].every((v, i) => v === np[1][i]));
  for (const p of [m, d]) { await p.evaluate(() => { aeFx(fx => { fx.eq.bands = []; fx.eq.on = false; }); }); await settle(p); await p.waitForTimeout(1500); }
  { const a = await snap(m), c = await snap(d); ok('noise reduction: the waveform peaks follow the cleaned sound', a.n === c.n && near(a.sum, c.sum, 1e-6), a.sum.toFixed(4) + ' / ' + c.sum.toFixed(4)); }
  await d.click('#aePlay'); await d.waitForTimeout(1000); ok('with noise reduction on, the disk player plays (it does not wait for a cleaned copy)', await d.evaluate(() => AE.playing && !!AE.dh && AE.pos > 0.3)); await d.click('#aePlay');
  { // listening to the noise alone: the same samples as memory's
    const mem = await m.evaluate(async () => { const r = await nrGet(AE.d.fx.noise, true), x = r.buffer.getChannelData(0); return Array.from(x.subarray(20000, 60000)); });
    const dsk = await d.evaluate(async () => { DISK.fxUse(AE.d.fx, { listen: true }); await new Promise(r => setTimeout(r, 200)); const r = await DISK.render(20000, 40000, true); DISK.fxUse(AE.d.fx); return Array.from(r.chans[0]); });
    let worst = 0, mxv = 0; for (let i = 0; i < mem.length; i++) { worst = Math.max(worst, Math.abs(mem[i] - dsk[i])); mxv = Math.max(mxv, Math.abs(mem[i])); }
    ok('Noise only: the removed sound is the same as in memory', mem.length === dsk.length && mxv > 1e-4 && worst < 1e-5, 'worst ' + worst.toExponential(2) + ', loudest ' + mxv.toExponential(2)); }
  { await d.evaluate(() => { AE.pos = 0; }); await d.click('#aePlay'); await d.waitForTimeout(800); await d.evaluate(() => { const c = document.querySelector('#aeNrListen'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await d.waitForTimeout(900);
    const x = await d.evaluate(() => ({ playing: AE.playing, listen: AE.nrListen, sig: DISK.fxSigP.includes('"listen":true'), gaps: AE.dh && AE.dh.gaps() })); await d.click('#aePlay'); await d.waitForTimeout(200);
    ok('Noise only while it plays: the player switches to the noise alone and carries on', x.playing && x.listen && x.sig && x.gaps === 0, JSON.stringify(x)); await d.evaluate(() => { const c = document.querySelector('#aeNrListen'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); }); }
  await d.evaluate(() => aeTool('imager')); await m.evaluate(() => aeTool('imager')); await d.waitForTimeout(900);
  const lr = [await m.evaluate(() => AE.lr), await d.evaluate(() => AE.lr)];
  ok('the stereo picture (left against right) equals the memory one', !!lr[0] && !!lr[1] && near(lr[0].db, lr[1].db, 1e-9) && near(lr[0].ldb, lr[1].ldb, 1e-9), JSON.stringify(lr[1]));
  ok('no page errors', d.errs.length === 0 && m.errs.length === 0, d.errs.concat(m.errs).join(' | '));
  await m.close(); await d.close();

  // 6: the video player
  const v = await open(1, 's24.wav', true);
  const st = () => v.evaluate(() => ({ t: S.time, playing: Transport.playing, dh: !!Transport.dh }));
  await v.click('#bPlay'); await v.waitForTimeout(1500); const a1 = await st(); await v.waitForTimeout(1000); const a2 = await st();
  ok('the video plays the sound from the store, and the clock follows it', a1.playing && a1.dh && a1.t > 1 && near(a2.t - a1.t, 1, 0.12), a1.t.toFixed(2) + ' → ' + a2.t.toFixed(2));
  await v.evaluate(() => Transport.seek(2)); await v.waitForTimeout(700); const a3 = await st();
  ok('a jump while it plays carries on from there', a3.playing && a3.t > 2.4 && a3.t < 3.2, a3.t.toFixed(2));
  await v.click('#bPlay'); await v.waitForTimeout(200); ok('pause lets go', !(await st()).playing && !(await st()).dh);
  await v.evaluate(() => { S.time = -1; }); await v.click('#bPlay'); await v.waitForTimeout(400); const a4 = await st();
  ok('before the audio starts the clock runs and waits', a4.playing && !a4.dh && a4.t < 0 && a4.t > -1, a4.t.toFixed(2));
  await v.waitForTimeout(1900); const a5 = await st(); ok('then the sound starts at its beginning', a5.dh && a5.t > 0.4 && a5.t < 1.5, a5.t.toFixed(2));
  await v.waitForFunction(() => !Transport.playing, null, { timeout: 10000 }); ok('it stops at the end', (await st()).t >= 4.9);
  await v.evaluate(() => startExport()); await v.waitForFunction(() => !EXP.running, null, { timeout: 60000 });
  { const x = await v.evaluate(() => ({ blob: !!EXP.blob, msg: document.querySelector('#expMsg').textContent })); ok('the video export runs on the store, or says the fast export is needed (this Chromium has no H.264 encoder)', x.blob || /needs the fast export/.test(x.msg), x.msg); }
  ok('no page errors while playing the video', v.errs.length === 0, v.errs.join(' | '));
  await v.evaluate(() => removeAudio()); await v.waitForTimeout(500);
  ok('removing the audio frees the store', await v.evaluate(() => DISK.meta === null && !S.audio));
  await v.close();

  // 7: other kinds of file
  for (const [file, ch, rate] of [['mono.wav', 1, 48000], ['s24.wav', 2, 48000], ['surround.wav', 2, 48000]]) {
    const p = await open(1, file); await editor(p); await p.waitForTimeout(500);
    const r = await p.evaluate(() => ({ disk: S.audio.disk, ch: S.audio.ch, sr: S.audio.sr })); await p.evaluate(() => aeTool('imager')); await p.waitForTimeout(700);
    ok(file + ' on the store: ' + ch + ' channel(s) at ' + rate + 'Hz, the editor opens', r.disk && r.ch === ch && r.sr === rate && p.errs.length === 0, JSON.stringify(r) + p.errs.join(' | '));
    await p.close();
  }
  { const p = await open(1, 'loud.mp3'); ok('an MP3 goes to the store (the full comparison is mp3-disk.js)', await p.evaluate(() => !!S.audio.disk && !S.audio.buffer)); await p.close(); }
  { const p = await open(null, 's24.wav'); ok('no switch given: the disk store', await p.evaluate(() => !!S.audio.disk && !S.audio.buffer)); await p.close(); }
  console.log('\n' + results.filter(r => r.startsWith('PASS')).length + ' PASS, ' + results.filter(r => r.startsWith('FAIL')).length + ' FAIL');
  await b.close();
})();
