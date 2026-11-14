// The space around the cards in an Audio Editor tool window, and the pictures' grid lines.
// 1) The space between the top of the tool window and the first card equals the space between the last card and the status bar, in every tool, at every window height: 12px each on a window tall enough for the tool (796px), down to 6px each when the window is up to 12px shorter.
//    Shorter than that the tool scrolls and a card is cut off at the bottom.
// 2) In dark mode the scope's grid lines and the EQ's grid lines can be told apart from the fill behind them, as they can in light mode.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-edge-space.js
const { chromium } = require('playwright-core');
const { install } = require('./lib/measure.js');          // text is centered by its letters (cap top to baseline), measured by the shared helper
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const b = await chromium.launch(), errs = [], heights = [900, 800, 796, 790, 785, 770, 760, 740];
  const open = async (w, h, theme) => { const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(90000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); if (theme) await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500); await p.evaluate(install); return p; };
  const measure = () => {
    const R = e => e.getBoundingClientRect(), shown = e => { for (let n = e; n && n.id !== 'audioDlg'; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || n.inert || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (n.matches('.fa:not(.open)>.fa-in, .eq-fold.shut, .im-view.off')) return false; } return true; };
    const pane = document.querySelector('.ae-pane:not([hidden])'), body = document.querySelector('.ae-pbody'), br = R(body);
    const cards = [...pane.querySelectorAll('.ae-card, .sp-card, .lv-meter, .eq-top, .nr-stage')].filter(c => shown(c) && R(c).height > 1 && !c.parentElement.closest('.ae-card, .sp-card'));
    return { body: Math.round(br.height), top: Math.round((Math.min(...cards.map(c => R(c).top)) - br.top) * 10) / 10, bottom: Math.round((R(document.querySelector('.ae-stat')).top - Math.max(...cards.map(c => R(c).bottom))) * 10) / 10 };
  };
  await Promise.all(heights.map(async h => {
    const p = await open(1440, h), bad = [], rows = {};
    for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu']) {
      await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(700); const m = rows[t] = await p.evaluate(measure);
      const equal = Math.abs(m.top - m.bottom) <= 1, cut = m.bottom < 0 && m.top <= 6.5;
      if (!(equal || cut)) bad.push(t + ' ' + JSON.stringify(m)); if (h >= 796 && !(m.top === 12 && m.bottom === 12)) bad.push(t + ' (tall window) ' + JSON.stringify(m));
    }
    ok(h + 'px tall: the space above the first card equals the space below the last, in every tool', !bad.length, bad.join(' | ')); await p.close();
  }));
  // the grid lines in both themes
  for (const theme of ['light', 'dark']) {
    const p = await open(1440, 900, theme);
    await p.evaluate(() => aeTool('imager')); await p.waitForTimeout(800);
    const sc = await p.evaluate(() => { const cv = document.querySelector('#aeScope'), c = cv.getContext('2d'), k = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight, R = Math.min(W, H) / 2 - 18;
      const px = (x, y) => Array.from(c.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data), on = px(W / 2, H / 2 - R / 2), off = px(W / 2 + 12, H / 2 - R / 2); return { on, off, d: [0, 1, 2].reduce((s, i) => s + Math.abs(on[i] - off[i]), 0) }; });
    ok(theme + ': the scope\'s grid line can be told from its fill', sc.d >= 8, JSON.stringify(sc));
    await p.evaluate(() => aeTool('eq')); await p.waitForTimeout(800);
    const eq = await p.evaluate(() => { const cv = document.querySelector('#aeEqCv'), c = cv.getContext('2d'), k = cv.width / cv.clientWidth, W = cv.clientWidth, H = cv.clientHeight, x = Math.round(eqFx(1000, W)), y = Math.round(H * 0.15);
      const px = (xx, yy) => Array.from(c.getImageData(Math.round(xx * k), Math.round(yy * k), 1, 1).data), on = px(x + 0.4, y), off = px(x + 9, y); return { on, off, d: [0, 1, 2].reduce((s, i) => s + Math.abs(on[i] - off[i]), 0) }; });
    ok(theme + ': the EQ\'s grid line can be told from its fill', eq.d >= 6, JSON.stringify(eq)); await p.close();
  }
  // every switch lines up with its label, and Mains hum is the same size as Noise only, with and without its result showing
  { const p = await open(1440, 900);
    const sw = await p.evaluate(async () => { const bad = [], rows = {};
      const align = () => { for (const s of document.querySelectorAll('input.switch')) { const r = s.getBoundingClientRect(); if (r.width < 2 || !s.offsetParent) continue; const row = s.closest('label, .foot-row') || s.parentElement, sp = [...row.querySelectorAll('span')].find(e => e.textContent.trim() && !e.contains(s) && e.getBoundingClientRect().height > 0); if (!sp) continue;
        const l = __mk.letters(sp), d = Math.abs((r.top + r.bottom) / 2 - (l.capTop + l.base) / 2); if (d > 1) bad.push((s.id || '?') + ' off by ' + d.toFixed(1)); } };
      for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu']) { aeTool(t); await new Promise(r => setTimeout(r, 500)); align(); if (t === 'noise') {
        const hum = document.querySelector('#aeNrHum').closest('label'), only = document.querySelector('.nr-listen'); rows.idle = [Math.round(hum.getBoundingClientRect().height * 10) / 10, Math.round(only.getBoundingClientRect().height * 10) / 10];
        const a = getComputedStyle(hum.querySelector('span')), c = getComputedStyle(only.querySelector('span')); if (a.fontSize !== c.fontSize || a.fontWeight !== c.fontWeight) bad.push('Remove hum text differs from Output noise'); } }
      return { bad, rows }; });
    ok('every switch is centered on its label, in every tool', !sw.bad.length, sw.bad.join(', '));
    ok('Remove hum is as tall as Output noise', Object.values(sw.rows).every(([a, c]) => Math.abs(a - c) <= 0.5), JSON.stringify(sw.rows)); await p.close(); }
  // pieces that belong together are lined up: headings, their (i) and control, step numbers with their first line, a slider with its value and its end labels, and the Meter's bar with its scale
  { const p = await open(1440, 900); const bad = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), q = s => document.querySelector(s), R = e => e.getBoundingClientRect(), cy = e => { const r = R(e); return (r.top + r.bottom) / 2; }, txt = e => { const l = __mk.letters(e); return (l.capTop + l.base) / 2; }, bad = [];
      const same = (n, a, b, tol = 1) => { if (a == null || b == null || Math.abs(a - b) > tol) bad.push(n + ' ' + (a && a.toFixed(1)) + ' vs ' + (b && b.toFixed(1))); };
      aeTool('level'); await w(600); same('Normalize heading and its (i)', txt(q('#aeNormCard h4')), cy(q('#aeNormCard .info-i'))); same('Normalize heading and its control', txt(q('#aeNormCard h4')), cy(q('#aeNormMode'))); same('Gain heading and Normalize heading', txt(q('#aeGainCard h4')), txt(q('#aeNormCard h4')));
      const gap = (a, b) => R(b).top - R(a).bottom; { const g = gap(q('#aeMeter .lv-track'), q('#aeMeter .lv-scale')); if (g < 0 || g > 10) bad.push('the Meter scale is ' + g.toFixed(1) + 'px under its bar'); const g2 = R(q('#aeGainField .sl-ends')).top - R(q('#aeGain')).bottom; if (Math.abs(g2 - 1) > 0.5) bad.push('the Gain labels are ' + g2.toFixed(1) + 'px under the slider, not 1 (2 under its thumb, 8 under its track, like the Meter)'); }
      aeTool('imager'); await w(600); same('Width heading and its control', txt(q('#aeWidthCard h4')), cy(q('#aeWidthMode'))); same('Width value and its slider', cy(q('#aeWidthVal')), cy(q('#aeWidth'))); if (R(q('#aeWidthVal')).right < R(q('#aeWidth')).right) bad.push('the Width value is not at the end of the slider row');
      aeTool('noise'); await w(600);  same('Removal heading and its control', txt(q('#aeNrCtl h4')), cy(q('#aeNrMode')));
      aeTool('emu'); await w(600); for (const st of document.querySelectorAll('#aePaneEmu .mt-step, #aeEmCard .mt-step')) { const n = st.querySelector('.mt-n'), t = st.querySelector('.mt-title'); if (n && t && R(t).height > 0) same('Emulator step ' + n.textContent + ' number and title', cy(n), txt(t)); }
      return bad; });
    ok('headings, step numbers, slider values, end labels, and the Meter scale are lined up with what they belong to', !bad.length, bad.join(' | ')); await p.close(); }
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
