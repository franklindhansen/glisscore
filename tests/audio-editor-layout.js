// Audio Editor layout at four window sizes, across all six tools: nothing scrolls sideways (the dialog, the page, or the tool), and on a window wide enough for two columns the tool window keeps one
// height from tool to tool and the dialog itself never scrolls. The sizes run side by side in one script, so it adds almost no time to a full run.
// Add SHOTS=1 to also save a screenshot of each tool window (t-<size>-<tool>.png) to look at: the numbers do not catch everything.
// The fit sweep (1440px wide, heights 680 to 900px): every module, and in Level, Noise reduction, and EQ the states that change a card, checked for the dialog inside the screen, a status bar ending at the window's bottom,
// no content passing its card's padding box, no card passing the body, and (Level) the True peak and every card keeping their place with and without clipping. Under 806px tall (the waveform's 170px and the tool's floor no longer fit) the tool body
// scrolls inside the window, and the pictures keep the sizes they have on a tall screen, so there a card may pass the body (it is reached by scrolling) but nothing may pass its own card.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-layout.js
const { chromium } = require('playwright-core');
const { fitMeasure } = require('./lib/fit-measure.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  await Promise.all([[390, 800], [700, 900], [900, 600], [1280, 800]].map(async ([w, h]) => {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(w + ': ' + e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
    const rows = {};
    for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level']) {
      await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(800);
      rows[t] = await p.evaluate(() => { const win = document.querySelector('#aeWin').getBoundingClientRect(), pane = document.querySelector('.ae-pane:not([hidden])'), dlg = document.querySelector('#audioDlg .dlg');
        return { win: Math.round(win.height), pane: pane.scrollWidth - pane.clientWidth, dlgX: dlg.scrollWidth - dlg.clientWidth, docX: document.documentElement.scrollWidth - innerWidth, dlgY: dlg.scrollHeight - dlg.clientHeight }; });
      if (process.env.SHOTS) await p.locator('#aeWin').screenshot({ path: 't-' + w + 'x' + h + '-' + t + '.png' });
    }
    const tag = w + 'x' + h + ': ', all = Object.entries(rows), wide = w >= 700;
    const sideways = all.filter(([, r]) => r.pane > 1 || r.dlgX > 1 || r.docX > 1).map(([t, r]) => t + ' ' + JSON.stringify(r));
    ok(tag + 'no tool scrolls sideways (dialog, page, or tool)', !sideways.length, sideways.join(' | '));
    if (wide) {
      const hs = all.map(([, r]) => r.win);
      ok(tag + 'the tool window keeps one height across all six tools', Math.max(...hs) - Math.min(...hs) <= 1, JSON.stringify(Object.fromEntries(all.map(([t, r]) => [t, r.win]))));
      const tall = all.filter(([, r]) => r.dlgY > 1).map(([t, r]) => t + ' ' + r.dlgY);
      ok(tag + 'the dialog itself does not scroll', !tall.length, tall.join(', '));
    }
    await p.close();
  }));
  // ----- the fit sweep -----
  const frame = () => ({ vh: innerHeight, dlg: (r => ({ top: r.top, bottom: r.bottom }))(document.querySelector('#audioDlg .dlg').getBoundingClientRect()),
    btns: ['#aeDone', '#aeCancel'].map(id => ({ t: id, bottom: document.querySelector(id).getBoundingClientRect().bottom, top: document.querySelector(id).getBoundingClientRect().top })),
    win: document.querySelector('#aeWin').getBoundingClientRect().bottom, stat: document.querySelector('.ae-stat').getBoundingClientRect().bottom, statH: document.querySelector('.ae-stat').getBoundingClientRect().height, statFrac: [...document.querySelectorAll('.ae-stat, .ae-stat *')].filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && (Math.abs(r.top - Math.round(r.top)) > 0.03 || Math.abs(r.height - Math.round(r.height)) > 0.03); }).length,
    body: document.querySelector('.ae-pbody').clientHeight, scrolls: document.querySelector('.ae-pbody').scrollHeight - document.querySelector('.ae-pbody').clientHeight, railScrolls: document.querySelector('.ae-rail').scrollHeight - document.querySelector('.ae-rail').clientHeight,
    wave: document.querySelector('.ae-wave').getBoundingClientRect().height });
  const sweep = {}, heights = [680, 720, 760, 800, 900];
  const [floor, chrome] = (await (async () => { const p = await b.newPage(); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); const v = await p.evaluate(() => { const c = getComputedStyle(document.documentElement); return c.getPropertyValue('--ae-floor') + ',' + c.getPropertyValue('--ae-chrome'); }); await p.close(); return v; })()).split(',').map(parseFloat);
  await Promise.all(heights.map(async h => {
    const out = sweep[h] = { frames: [], pass: [], body: [], level: [], notes: [] };
    const mk = async file => { const p = await b.newPage({ viewport: { width: 1440, height: h } }); p.setDefaultTimeout(90000); p.on('pageerror', e => errs.push('1440x' + h + ': ' + e.message));
      await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/' + file);
      await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500); return p; };
    const look = async (p, label) => { const f = await p.evaluate(frame), m = await p.evaluate(fitMeasure, { card: '.ae-card, .nr-stage', body: '.ae-pbody', root: '.ae-pane:not([hidden])' });
      out.frames.push({ label, ...f }); m.pass.forEach(x => out.pass.push(label + ': ' + x)); if (!f.scrolls) m.body.forEach(x => out.body.push(label + ': ' + x)); return { f, m }; };
    const p = await mk('loud.mp3'), tools = ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu'];
    for (const t of tools) { await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(700); await look(p, t);
      if (t === 'imager') out.imager = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { balBottom: r('#aeBalCard').bottom, scopeBottom: r('.im-scope').bottom, widthTop: r('#aeWidthCard').top, scopeTop: r('.im-scope').top, widthH: r('#aeWidthCard').height, balH: r('#aeBalCard').height }; });
      if (t === 'noise') out.noisePad = await p.evaluate(() => [getComputedStyle(document.querySelector('#aeNrCtl')).padding, getComputedStyle(document.querySelector('#aeGainCard')).padding]); }
    await p.evaluate(() => aeTool('noise')); await p.waitForTimeout(500);
    await p.evaluate(async () => { document.querySelector('#aeNrFind').click(); await sleep(100); for (let i = 0; i < 600 && AE.nrAutoBusy; i++) await sleep(25); await sleep(300); }); await look(p, 'noise found by Auto');
    await p.evaluate(() => aeTool('eq')); await p.waitForTimeout(600); await p.evaluate(() => document.querySelector('#aeMatchBtn').click()); await p.waitForTimeout(900); await look(p, 'EQ Match open');
    await p.close();
    const q = await mk('f32over.wav'); await q.evaluate(() => aeTool('level')); await q.waitForTimeout(700);
    const setMode = v => q.evaluate(v => { const r = document.querySelector('input[name=aeNormMode][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    const setGain = g => q.evaluate(g => { const e = document.querySelector('#aeGain'); e.value = g; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, g);
    const setLim = on => q.evaluate(on => { const e = document.querySelector('#aeLimiter'); if (e.checked !== on) { e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); } }, on);
    const states = [['Normalize Off, gain 0', async () => { await setMode('off'); await setGain(0); }], ['Normalize Off, gain −6', () => setGain(-6)], ['Normalize Off, gain +6', () => setGain(6)],
      ['Loudness, limiter on', async () => { await setGain(0); await setMode('loud'); await setLim(true); }], ['Loudness, limiter off', () => setLim(false)], ['Peak', () => setMode('peak')]];
    for (const [label, go] of states) { await go(); await q.waitForTimeout(1500);
      const { m } = await look(q, 'Level: ' + label), more = await q.evaluate(() => ({ clip: document.querySelector('#aeClip').classList.contains('on'), peakLeft: document.querySelector('#aeMeter .lv-read span').getBoundingClientRect().left, noteRows: [...document.querySelectorAll('#aeSum b')].length }));
      out.level.push({ label, clip: more.clip, peakLeft: more.peakLeft, cards: Object.fromEntries(m.cards.map(c => [c.id, c.h])) }); }
    out.strip = await q.evaluate(() => { const e = document.querySelector('#aeSum'), cols = getComputedStyle(e).gridTemplateColumns.split(' ').map(parseFloat); return { cols, title: e.title, foot: !!document.querySelector('.lv-foot'), clipNote: !!document.querySelector('#aeClipNote, #aeLoudPk') }; });
    out.guard = await q.evaluate(() => { const c = document.querySelector('#aeGainCard'); c.style.height = '80px'; c.style.flex = 'none'; const r = uiGuard.scan().filter(x => x[1] === 'card').map(x => x[2]); c.style.height = ''; c.style.flex = ''; return r; });
    await q.close();
  }));
  for (const h of heights) { const o = sweep[h], tag = '1440x' + h + ': ', main = o.frames[0], short = h < floor + 170 + chrome + 32;          // what the dialog needs: the floor, the picture at its one size (170px), and the rest of the dialog
    const outside = o.frames.filter(f => f.dlg.top < -0.5 || f.dlg.bottom > f.vh + 0.5 || f.btns.some(x => x.bottom > f.vh || x.top < 0)).map(f => f.label + ' dlg ' + f.dlg.top.toFixed(0) + '→' + f.dlg.bottom.toFixed(0));
    ok(tag + 'the dialog is inside the screen, with Cancel and Done in view, in every state', !outside.length, outside.slice(0, 3).join(' | '));
    const stat = o.frames.filter(f => Math.abs(f.stat - (f.win - 1)) > 0.5 || f.statH !== 28 || f.statFrac).map(f => f.label + ' stat ' + f.stat.toFixed(1) + ' win ' + f.win.toFixed(1) + ' h ' + f.statH);
    ok(tag + 'the status bar is 28px, its content sits on whole pixels, and it ends at the window\'s bottom edge, with no blank under it', !stat.length, stat.slice(0, 3).join(' | '));
    if (!short) { const sc = o.frames.filter(f => f.scrolls > 1 || f.railScrolls > 1 || Math.abs(f.body - floor) > 0.5).map(f => f.label + ' body ' + f.body + ' scrolls ' + f.scrolls + '/' + f.railScrolls); ok(tag + 'the tool body is exactly its floor (' + floor + 'px), and neither it nor the tool list scrolls', !sc.length, sc.slice(0, 3).join(' | ')); }
    else ok(tag + 'on a screen this short the tool body is shorter than its tool and scrolls inside the window', o.frames.every(f => f.body < floor && f.body >= 180), 'body ' + main.body);
    ok(tag + 'the waveform is 170px, whatever the screen', o.frames.every(f => Math.abs(f.wave - 170) < 0.5), o.frames.map(f => f.wave).join(','));
    ok(tag + 'no content passes its card\'s padding box (every module and state)', !o.pass.length, o.pass.slice(0, 4).join(' | '));
    ok(tag + 'no card passes the tool body', !o.body.length, o.body.slice(0, 4).join(' | '));
    ok(tag + 'Imager: the scope card and the two control cards start and end on the same lines', Math.abs(o.imager.balBottom - o.imager.scopeBottom) < 1 && Math.abs(o.imager.widthTop - o.imager.scopeTop) < 1, JSON.stringify(o.imager));
    ok(tag + 'Noise reduction: the Removal card takes the shared card padding', o.noisePad[0] === o.noisePad[1], o.noisePad.join(' vs '));
    ok(tag + 'Level: the summary strip is two even columns, its tooltip reads "Measured after every module.", and the clip note, the peak line, and the foot note are gone', o.strip.cols.length === 2 && Math.abs(o.strip.cols[0] - o.strip.cols[1]) < 0.6 && o.strip.title === 'Measured after every module.' && !o.strip.foot && !o.strip.clipNote, JSON.stringify(o.strip));
    ok(tag + 'uiGuard reports a card whose content passes its padding box', o.guard.length === 1 && /aeGainCard/.test(o.guard[0]), JSON.stringify(o.guard));
    const lv = o.level, pl = lv.map(l => l.peakLeft), ids = Object.keys(lv[0].cards), moved = ids.filter(id => lv.some(l => Math.abs(l.cards[id] - lv[0].cards[id]) > 0.5));
    ok(tag + 'Level: the Clip pill shows in some states and not in others, so the comparison means something', lv.some(l => l.clip) && lv.some(l => !l.clip), lv.map(l => l.label + '=' + l.clip).join(', '));
    ok(tag + 'Level: True peak keeps its place whether or not Clip shows', Math.max(...pl) - Math.min(...pl) < 0.5, pl.map(v => v.toFixed(1)).join(', '));
    ok(tag + 'Level: no card changes height when a pill, note, or fold appears', !moved.length && ids.length >= 3, moved.join(', ') + ' ' + JSON.stringify(lv.map(l => l.cards)).slice(0, 300)); }
  const ih = heights.map(h => sweep[h].imager.widthH.toFixed(1) + '/' + sweep[h].imager.balH.toFixed(1));
  ok('Imager: Width and Balance keep their natural height at every screen height', new Set(ih).size === 1, ih.join(' '));
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
