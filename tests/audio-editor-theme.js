// Theme and dark mode in the Audio Editor and the timeline: changing the theme redraws every picture the editor shows (the waveform, the noise graph, the EQ, the scope, the fade shape, the Emulator's graph) and the timeline in the same task, in both directions, stopped.
// The dividers above Mains hum, Noise only, the Level and Emulator summaries, and Emulator in the tool list, and the unlit lights, use the one hairline token (--hairline).
// The Mains hum divider has a contrast of 1.3 or more against the surface behind it, before and after a noise is learned, in both themes; in light mode the token is no heavier than --line was.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-theme.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const sleep2 = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
// a made recording: a little hiss all through, a 60Hz hum, and tones in bursts, so Auto finds a noise profile in the quiet parts
const sr = 44100, n = sr * 6; let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { const t = i / sr, v = 0.02 * (rnd() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 440 * t) * (Math.floor(t) % 2) + 0.004 * Math.sin(2 * Math.PI * 60 * t); const s = Math.round(Math.max(-1, Math.min(1, v)) * 32767); wav.writeInt16LE(s, 44 + i * 4); wav.writeInt16LE(s, 46 + i * 4); }
const file = path.join(os.tmpdir(), 'kf-theme-noise.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html');
  await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  // helpers that live in the page: a mean brightness of a canvas, and colors as RGB (a surface is the backgrounds beneath an element, composited)
  await p.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = s => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = s; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
    const over = (f, b) => { const a = f[3] / 255; return [0, 1, 2].map(i => f[i] * a + b[i] * (1 - a)); };
    const surf = el => { const st = []; for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) st.push(c); } let b = [255, 255, 255]; for (let i = st.length - 1; i >= 0; i--) b = over(st[i], b); return b; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const mean = cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0, k = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) { s += d[i] + d[i + 1] + d[i + 2]; k++; } return k ? s / (3 * k) : 0; };
    // the theme is set and the picture read in one task: the editor's theme listener runs in the microtask after the change, so the read sees the redraw
    window.flip = async (t, sel, frame) => { document.documentElement.setAttribute('data-theme', t); await Promise.resolve(); if (frame) await new Promise(r => requestAnimationFrame(r)); return sel ? mean(document.querySelector(sel)) : 0; };
    window.K = { rgba, over, surf, ratio, mean };
  });
  const settle = () => p.waitForTimeout(400);
  // 1. every picture of the editor and the timeline is drawn in the new theme as the theme changes, in both directions (stopped): the picture read straight after the change (the timeline: the frame after it)
  // is the one a fresh draw in that theme gives
  const pics = [['wave', null, '#aeCanvas', 'aeDraw()', false], ['noise', 'noise', '#aeNrCv', 'aeToolLive()', false], ['eq', 'eq', '#aeEqCv', 'aeToolLive()', false], ['imager', 'imager', '#aeScope', 'aeToolLive()', false], ['fades', 'fades', '#aeFadeCv', 'aeToolLive()', false], ['emulator', 'emu', '#aeEmCv', 'aeEmDraw()', false], ['timeline', null, '#tl', 'drawTimeline()', true]];
  for (const [name, tool, sel, redraw, frame] of pics) {
    if (tool) { await p.evaluate(t => aeTool(t), tool); await p.waitForTimeout(1500); }
    const seen = [], fresh = [];
    for (const t of ['light', 'dark', 'light', 'dark']) {
      seen.push(await p.evaluate(([t, sel, f]) => flip(t, sel, f), [t, sel, frame]));
      await settle();
      fresh.push(await p.evaluate(([sel, r]) => { eval(r); return K.mean(document.querySelector(sel)); }, [sel, redraw]));
    }
    const span = Math.abs(fresh[0] - fresh[1]), same = seen.every((v, i) => Math.abs(v - fresh[i]) < 0.5);
    ok(name + ': the picture is drawn in the new theme as it changes, light to dark and back', span >= 15 && same, JSON.stringify({ seen: seen.map(v => +v.toFixed(1)), fresh: fresh.map(v => +v.toFixed(1)) }));
  }
  await p.evaluate(() => aeTool('noise')); await settle();
  // 2. the hairline token: the dividers and the unlit light use it, and nothing else
  const tokenOf = () => p.evaluate(() => { const d = document.createElement('div'); d.style.color = 'var(--hairline)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; });
  for (const t of ['light', 'dark']) {
    await p.evaluate(t => flip(t, null), t); await settle();
    const tok = await tokenOf();
    const seen = await p.evaluate(() => ['.nr-hum', '.nr-listen', '.im-low', '.lv-sum', '.ae-procs.ae-apart'].map(s => { const el = document.querySelector(s); if (!el) return 'missing'; const cs = getComputedStyle(el); return parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : (cs.boxShadow.match(/^(color\([^)]*\)|rgba?\([^)]*\))/) || [])[1]; }).concat([getComputedStyle(document.querySelector('#aeRule')).backgroundColor]));
    const led = await p.evaluate(() => getComputedStyle(document.querySelector('#aeLvLed')).backgroundColor);
    ok('the dividers and the unlit light use the hairline token (' + t + ')', seen.every(c => c === tok) && led === tok, JSON.stringify({ tok, seen, led }));
  }
  // 3. the Mains hum divider: at least 1.3 against the surface behind it, before and after a noise is learned, in both themes
  const humRatio = () => p.evaluate(() => {
    const hum = document.querySelector('.nr-hum'), pre = !!document.querySelector('#aeNrGrid.pre');
    const under = pre ? document.querySelector('#aeNrCv').parentElement : hum.parentElement;          // before a noise is learned the sample card is see-through and sits on the noise graph
    const bg = K.surf(under), line = K.over(K.rgba(getComputedStyle(hum).borderTopColor), bg);
    return { pre, r: +K.ratio(line, bg).toFixed(3) };
  });
  const pre = {}, post = {};
  for (const t of ['light', 'dark']) { await p.evaluate(t => flip(t, null), t); await settle(); pre[t] = await humRatio(); }
  await p.evaluate(() => { AE.nsel = { a: 0.2, b: 1.8 }; aeNrLearn(); });          // learn the noise from a stretch of hiss
  await p.waitForFunction(() => !document.querySelector('#aeNrGrid').classList.contains('pre'), null, { timeout: 60000 }).catch(() => {});
  await settle();
  for (const t of ['light', 'dark']) { await p.evaluate(t => flip(t, null), t); await settle(); post[t] = await humRatio(); }
  ok('the Mains hum divider has contrast 1.3 or more before a noise is learned, in both themes', pre.light.pre && pre.dark.pre && pre.light.r >= 1.3 && pre.dark.r >= 1.3, JSON.stringify(pre));
  ok('the Mains hum divider has contrast 1.3 or more after a noise is learned, in both themes', !post.dark.pre && post.light.r >= 1.3 && post.dark.r >= 1.3, JSON.stringify(post));
  // 4. light mode: the token is no heavier than --line was, on each surface it sits on
  await p.evaluate(t => flip(t, null), 'light'); await settle();
  const light = await p.evaluate(() => {
    const d = document.createElement('div'); d.style.color = 'var(--hairline)'; document.body.appendChild(d); const t = K.rgba(getComputedStyle(d).color); d.remove();
    const l = K.rgba(getComputedStyle(document.documentElement).getPropertyValue('--line').trim());
    return [[255, 255, 255], [246, 247, 250], [242, 242, 242]].map(bs => ({ tok: +K.ratio(K.over(t, bs), bs).toFixed(3), line: +K.ratio(K.over(l, bs), bs).toFixed(3) }));
  });
  ok('in light mode the hairline is no heavier than --line on the white, panel, and tinted surfaces', light.every(x => x.tok <= x.line), JSON.stringify(light));
  // 5. the unlit light in the tool list is visible in both themes
  for (const t of ['light', 'dark']) {
    await p.evaluate(t => flip(t, null), t); await settle();
    const r = await p.evaluate(() => { const led = document.querySelector('#aeLvLed'), s = K.surf(led.parentElement), d = document.createElement('div'); d.style.color = 'var(--hairline)'; document.body.appendChild(d); const c = K.over(K.rgba(getComputedStyle(d).color), s); d.remove(); return K.ratio(c, s); });
    ok('the unlit light is 1.3 or more against its surface (' + t + ')', r >= 1.3, r.toFixed(2));
  }
  // 6. the greyed Gain track (Normalize on) is 1.3 or more against its card in both themes; the slider itself is not dimmed as a whole
  await p.evaluate(() => { document.querySelector('#aeLvLed') && aeTool('level'); const r = [...document.querySelectorAll('input[name=aeNormMode]')].find(x => x.value !== 'off'); r.click(); });
  await p.waitForTimeout(600);
  for (const t of ['light', 'dark']) {
    await p.evaluate(t => flip(t, null), t); await settle();
    const r = await p.evaluate(() => {
      const g = document.querySelector('#aeGain'), s = K.surf(g.parentElement), d = document.createElement('div'); d.style.color = 'color-mix(in srgb, var(--ink) 26%, transparent)'; document.body.appendChild(d); const c = K.rgba(getComputedStyle(d).color); d.remove();
      let op = 1; for (let n = g; n; n = n.parentElement) op *= +getComputedStyle(n).opacity;
      return { disabled: g.disabled, inputOpacity: getComputedStyle(g).opacity, ratio: K.ratio(K.over([c[0], c[1], c[2], c[3] * op], s), s) };
    });
    ok('the greyed Gain track is 1.3 or more against its card, and the slider is not dimmed as a whole (' + t + ')', r.disabled && r.inputOpacity === '1' && r.ratio >= 1.3, JSON.stringify(r));
  }
  // 7. the one pressed look: Balance's Auto, a band's Threshold Auto, Noise reduction's Auto, and Auto gain look the same when pressed (a soft accent fill, an accent edge and text), in both themes; solid blue is only the primary button
  for (const t of ['light', 'dark']) {
    await p.evaluate(t => flip(t, null), t); await settle();
    const r = await p.evaluate(() => {
      const ids = ['#aeBalAuto', '#aeBandThrAuto', '#aeNrFind', '#aeAutoBtn'], look = e => { const c = getComputedStyle(e); return [c.backgroundColor, c.borderTopColor, c.color, c.fontWeight].join(' | '); };
      const was = ids.map(i => document.querySelector(i).getAttribute('aria-pressed')); ids.forEach(i => document.querySelector(i).setAttribute('aria-pressed', 'true'));
      const looks = ids.map(i => look(document.querySelector(i))), prim = getComputedStyle(document.querySelector('#aeDone')), solid = prim.backgroundColor;
      ids.forEach((i, k) => { if (was[k] == null) document.querySelector(i).removeAttribute('aria-pressed'); else document.querySelector(i).setAttribute('aria-pressed', was[k]); });
      const accent = K.rgba(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#000');
      return { looks, same: looks.every(l => l === looks[0]), solid, pressedBg: looks[0].split(' | ')[0], pressedText: looks[0].split(' | ')[2], accentOk: K.rgba(looks[0].split(' | ')[2]).join() === accent.join() };
    });
    ok('the four Auto buttons share one pressed look, a soft fill with accent text, not the primary button\'s solid blue (' + t + ')', r.same && r.pressedBg !== r.solid && r.accentOk, JSON.stringify(r));
  }
  {          // a theme change redraws every picture in the same task, stopped or playing, in both directions; the timeline and the PDF Editor's pictures too
    await p.evaluate(() => { openAudioEditor(); }); await settle();
    const spyOn = (names, fn) => p.evaluate(([names, fn]) => {
      const cnt = {}, saved = {}; names.forEach(n => { saved[n] = window[n]; cnt[n] = 0; window[n] = function (...a) { cnt[n]++; return saved[n].apply(this, a); }; });
      try { window[fn](); } finally { names.forEach(n => { window[n] = saved[n]; }); }
      return cnt;
    }, [names, fn]);
    const tools = [['noise', 'aeNrDraw'], ['spec', null], ['eq', 'aeEqDraw'], ['imager', 'aeScopeDraw'], ['fades', 'aeFadeDraw'], ['emu', 'aeEmDraw']];
    const bad = [];
    for (const playing of [false, true]) for (const t of ['light', 'dark']) for (const [tool, own] of tools) {
      await p.evaluate(([tool, playing]) => { if (AE.playing) $('#aePlay').click(); aeTool(tool); if (playing) $('#aePlay').click(); }, [tool, playing]); await sleep2(400);
      await p.evaluate(t => flip(t, null), t); await sleep2(150);
      const cnt = await spyOn(['aeDraw', 'aeEqDraw', 'aeNrDraw', 'aeScopeDraw', 'aeFadeDraw', 'aeEmDraw'], 'readColors');
      if (!(cnt.aeDraw >= 1 && (!own || cnt[own] >= 1))) bad.push(tool + (playing ? ' playing ' : ' stopped ') + t + ' ' + JSON.stringify(cnt));
    }
    ok('the editor\'s pictures redraw in the same task on a theme change, stopped or playing, in both directions, for every tool', bad.length === 0, bad.join('; '));
    await p.evaluate(() => { if (AE.playing) $('#aePlay').click(); closeAudioEditor(); });
    await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf); await settle();
    const pe = await p.evaluate(() => { openPdfEditor(); return true; }); await sleep2(400);
    for (const t of ['light', 'dark']) {
      await p.evaluate(t => flip(t, null), t); await sleep2(100);
      const r = await p.evaluate(() => { TL.staticDirty = false; const cnt = {}, saved = window.peDrawCard; cnt.n = 0; window.peDrawCard = function (...a) { cnt.n++; return saved.apply(this, a); }; try { readColors(); } finally { window.peDrawCard = saved; } return { pe: cnt.n, timeline: TL.staticDirty, accent: PE.accent === TL.C.accent, open: !!PE.d }; });
      ok('the PDF Editor and the timeline redraw on a theme change (' + t + ')', r.pe >= 1 && r.timeline && r.accent, JSON.stringify(r));
    }
  }
  ok('no errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.unlinkSync(file);
})().catch(e => { console.log('FAIL the check ran — ' + e.message); process.exit(1); });
