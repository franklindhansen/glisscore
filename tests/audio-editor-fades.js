// Fades: the slider's Both, In, and Out, the two curves (Gradual and Straight), the old curve names mapped, the picture, and the sound the export and the disk store make.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-fades.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
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
  // one curve table: the old curve names are written nowhere but the one mapping, and no picker or import list still offers them
  { const fs = require('fs'), bad = []; for (const f of ['audio-fx.js', 'audio-store-worker.js', 'index.html', ...fs.readdirSync('js').filter(x => x !== 'settings-and-boot.js').map(x => 'js/' + x)]) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (/(["'])(smooth|slow|fast)\1|value="(smooth|slow|fast)"/.test(l) && /shape|curve/i.test(l) && !/FADE_OLD/.test(l)) bad.push(f + ':' + (i + 1)); });
    const io = await p.evaluate(() => [IO_CHOICES.audioFadeShape, IO_CHOICES.fadeShape]);
    ok('smooth, slow, and fast are written nowhere but the one mapping, and both import lists are natural, standard', !bad.length && JSON.stringify(io) === '[["natural","standard"],["natural","standard"]]', bad.join(' ') + JSON.stringify(io)); }
  // the picture, the choice, and the old curve names
  const ui = await p.evaluate(() => {
    const radios = [...document.querySelectorAll('#aeFadeShape label')], seen = [], fx = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { seen.push(String(t)); return fx.call(this, t, ...a); }; aeFadeDraw(); CanvasRenderingContext2D.prototype.fillText = fx;
    const len = document.querySelector('#aeFadeLenCard').getBoundingClientRect(), shp = document.querySelector('#aeFadeCv').closest('.ae-card').getBoundingClientRect(), cv = document.querySelector('#aeFadeCv').getBoundingClientRect(), sg = document.querySelector('#aeFadeShape').getBoundingClientRect(), pane = document.querySelector('#aePaneFades .fd-grid').getBoundingClientRect(), grid = document.querySelector('#aePaneFades .fd-grid');
    return { names: radios.map(l => l.textContent.trim()), values: radios.map(l => l.querySelector('input').value), titles: radios.map(l => l.title || ''), checked: (document.querySelector('input[name=aeFadeShape]:checked') || {}).value, dflt: AE_DEFAULT.audioFadeShape, dd: DEFAULTS.audioFadeShape, labels: seen.filter(t => /IN|OUT/i.test(t)),
      cards: !document.querySelector('#aeShapeCard') && document.querySelectorAll('#aePaneFades .ae-card').length === 2, tg: grid.classList.contains('tool-grid') && getComputedStyle(grid).display === 'grid',
      full: Math.abs(len.height - pane.height) < 1 && Math.abs(shp.height - pane.height) < 1, side: len.right <= shp.left + 1 && Math.abs(len.top - shp.top) < 1, pinned: sg.top >= cv.bottom - 0.5 && Math.abs(shp.bottom - sg.bottom - 13) < 2 };
  });
  ok('the curve choice reads Gradual, Straight (in that order) with no tooltips, and Gradual is the default', JSON.stringify(ui.names) === '["Gradual","Straight"]' && JSON.stringify(ui.values) === '["natural","standard"]' && ui.titles.every(t => !t) && ui.checked === 'natural' && ui.dflt === 'natural' && ui.dd === 'natural', JSON.stringify(ui));
  ok('the picture labels its zones IN and OUT', JSON.stringify(ui.labels) === '["IN","OUT"]', JSON.stringify(ui.labels));
  ok('Fades is two cards (Length and Shape, no Curve card) on the tool grid, both at the pane\'s full height, with the choice pinned under the picture', ui.cards && ui.tg && ui.full && ui.side && ui.pinned, JSON.stringify(ui));
  const map = await p.evaluate(() => {
    const o = {}, c = cleanSettings({ audioFadeShape: 'smooth', fadeShape: 'fast' }), c2 = cleanSettings({ audioFadeShape: 'slow', fadeShape: 'standard' }), c3 = cleanSettings({ audioFadeShape: 'natural', fadeShape: 'bogus' });
    o.imp = [c.audioFadeShape, c.fadeShape, c2.audioFadeShape, c2.fadeShape, c3.audioFadeShape, c3.fadeShape];
    o.fn = ['smooth', 'fast', 'slow', 'standard', 'natural', undefined, null, 'x', 'constructor'].map(v => KFX.fadeShape(v));
    const keep = S.set.audioFadeShape + '|' + S.set.fadeShape, h = snap(); h.set.fadeShape = 'slow'; h.aud.audioFadeShape = 'smooth'; applySnap(h); o.hist = [S.set.audioFadeShape, S.set.fadeShape];
    S.set.audioFadeShape = 'slow'; const d = aeFromApp(); o.draft = d.audioFadeShape;
    S.set.audioFadeShape = keep.split('|')[0]; S.set.fadeShape = keep.split('|')[1]; return o;
  });
  ok('an old curve is mapped on import (Smooth and Fast to Gradual, Slow to Straight, an unknown one to the default)', JSON.stringify(map.imp) === '["natural","natural","standard","standard","natural","natural"]' && JSON.stringify(map.fn) === '["natural","natural","standard","standard","natural","natural","natural","natural","natural"]', JSON.stringify(map));
  ok('and in the Audio Editor\'s draft and on a History restore', map.draft === 'standard' && JSON.stringify(map.hist) === '["natural","standard"]', JSON.stringify(map));
  { const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.on('pageerror', e => errs.push(String(e)));
    await q.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('glisscore.settings', JSON.stringify({ audioFadeShape: 'fast', fadeShape: 'smooth', audioFades: true })); } });
    await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
    const st = await q.evaluate(() => [S.set.audioFadeShape, S.set.fadeShape, S.set.audioFades, document.querySelector('input[name=fadeShape]:checked') && document.querySelector('input[name=fadeShape]:checked').value]);
    ok('settings the browser saved with old curves are mapped at startup', st[0] === 'natural' && st[1] === 'natural' && st[2] === true, JSON.stringify(st));
    const q2 = await q.evaluate(() => { localStorage.setItem('glisscore.settings', JSON.stringify({ audioFadeShape: 'slow', fadeShape: 'slow' })); return 1; }); await q.reload(); const st2 = await q.evaluate(() => [S.set.audioFadeShape, S.set.fadeShape]);
    ok('Slow is Straight at startup', JSON.stringify(st2) === '["standard","standard"]', JSON.stringify(st2));
    await q.evaluate(() => localStorage.removeItem('glisscore.settings')); await q.close(); }
  // a file or History step from before curve settings existed takes the default, even after Straight was chosen
  const missing = await p.evaluate(async () => { S.set.audioFadeShape = S.set.fadeShape = 'standard'; await importSettings({ text: async () => JSON.stringify({ glisscore: 1, settings: { fadeLen: 2 } }) }); const imported = [S.set.audioFadeShape, S.set.fadeShape]; const h = snap(); delete h.set.fadeShape; delete h.aud.audioFadeShape; S.set.audioFadeShape = S.set.fadeShape = 'standard'; applySnap(h); return { imported, history: [S.set.audioFadeShape, S.set.fadeShape] }; });
  ok('missing curves take Gradual on file import and History restore, even after Straight', [...missing.imported, ...missing.history].every(v => v === 'natural'), JSON.stringify(missing));
  // after the glide settles, the picture shows the chosen length
  for (const v of [0.3, 1.0, 1.4]) {
    await pick('both'); await set(v); await p.waitForFunction(w => AE.fadeShown && Math.abs(AE.fadeShown.li - w) < 0.002 && Math.abs(AE.fadeShown.lo - w) < 0.002, v, { timeout: 4000 }).catch(() => {});
    const sh = await p.evaluate(() => { const labels = [], cv = document.querySelector('#aeFadeCv'), c = cv.getContext('2d'), fill = c.fillText; c.fillText = function (text, ...args) { if (/^[0-9.]+s$/.test(text)) labels.push(text); return fill.call(this, text, ...args); }; try { aeFadeDraw(); } finally { c.fillText = fill; } return { labels, want: aeFadeLens(AE.d) }; }); ok('the picture draws ' + v + 's on both ticks once it has settled', sh.labels.length === 2 && sh.labels.every(t => t === v.toFixed(1) + 's') && Math.abs(sh.want[0] - v) < 1e-9, JSON.stringify(sh));
  }
  // the two curves are the two envelopes the player uses
  const cur = await p.evaluate(() => { const out = {}; for (const sp of ['natural', 'standard']) { const d = aeCopy(AE.d); d.audioFades = true; d.audioFadeLen = 1; d.audioFadeOutLen = null; d.audioFadeShape = sp; const vs = d.vStart, e = aeEnd(d); out[sp] = [0, 0.25, 0.5, 0.9].map(x => aeF(d, vs, e, vs + x)); } return out; });
  ok('Gradual rises quickly and settles, Straight is a line', cur.natural.every((v, i) => Math.abs(v - Math.sin([0, 0.25, 0.5, 0.9][i] * Math.PI / 2)) < 1e-9) && cur.standard.every((v, i) => Math.abs(v - [0, 0.25, 0.5, 0.9][i]) < 1e-9), JSON.stringify(cur));
  // when the cards stack, Length comes first and Shape second, with the choice under the picture
  await p.setViewportSize({ width: 430, height: 900 }); await p.waitForTimeout(600);
  const stk = await p.evaluate(() => { const len = document.querySelector('#aeFadeLenCard').getBoundingClientRect(), shp = document.querySelector('#aeFadeCv').closest('.ae-card').getBoundingClientRect(), cv = document.querySelector('#aeFadeCv').getBoundingClientRect(), sg = document.querySelector('#aeFadeShape').getBoundingClientRect(); return { len: [len.left, len.top, len.bottom], shp: [shp.left, shp.top, shp.bottom], under: sg.top >= cv.bottom - 0.5 && sg.bottom <= shp.bottom }; });
  ok('stacked, Length is first and Shape second, with the choice under the picture', stk.len[2] <= stk.shp[1] + 1 && Math.abs(stk.len[0] - stk.shp[0]) < 1 && stk.under, JSON.stringify(stk));
  await p.setViewportSize({ width: 1300, height: 900 }); await p.waitForTimeout(400);
  // the sound itself, for both curves: the exported samples against the envelope, on a recording held in memory and on one held on the disk store
  for (const disk of [0, 1]) {
    const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.setDefaultTimeout(30000); q.on('pageerror', e => errs.push(String(e)));
    await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await q.setInputFiles('#audioIn', FX + '/stereo.wav'); await q.waitForFunction(() => S.audio, null, { timeout: 30000 }); await q.waitForTimeout(1200);
    await q.evaluate(() => openAudioEditor()); await q.waitForTimeout(500);
    for (const shape of ['natural', 'standard']) {
    const r = await q.evaluate(async shape => {
      const mk = async fades => { const d = aeCopy(AE.d); d.audioFades = fades; d.audioFadeLen = 0.5; d.audioFadeOutLen = 1.0; d.audioFadeShape = shape; const dk = !!S.audio.disk, ch = 2;
        const mm = dk ? await aeMasterDisk(d, ch, false, () => {}) : await aeMasterFor(d, (await fxGet(d.fx)).buffer, ch, false, () => {}); const out = new Float32Array(mm.total * ch); await mm.fill(0, mm.total, out); return { out, sr: mm.sr, total: mm.total, d }; };
      const A = await mk(false), B = await mk(true), win = Math.round(A.sr * 0.05), res = []; let worst = 0;
      const e = aeEnd(B.d), vs = B.d.vStart;
      for (let w = 0; w + win <= A.total; w += win) { let a = 0, b = 0; for (let k = w; k < w + win; k++) { a += A.out[k] ** 2; b += B.out[k] ** 2; } const want = aeF(B.d, vs, e, vs + (w + win / 2) / A.sr); if (a > 1e-8) worst = Math.max(worst, Math.abs(Math.sqrt(b / a) - want)); }
      return { worst, dur: A.total / A.sr, first: Math.abs(B.out[0]), lastv: Math.abs(B.out[B.out.length - 2]) };
    }, shape);
    ok((disk ? 'disk store' : 'memory') + ', ' + (shape === 'natural' ? 'Gradual' : 'Straight') + ': exported sound follows the In 0.5s / Out 1.0s envelope', r.worst < 0.06 && r.first < 1e-3 && r.lastv < 1e-3, JSON.stringify(r));
    }
    await q.close();
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})();
