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
  // the spacing read in every state: the gap between cards, the space at the top and bottom of each card, and each footer row's space above and below its switch
  const spaceOf = () => {
    const R = e => e.getBoundingClientRect(), rnd = v => Math.round(v * 10) / 10;
    const shown = e => { for (let n = e; n && n.id !== 'audioDlg'; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || n.inert || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (n.matches('.fa:not(.open)>.fa-in, .eq-fold.shut, .im-view.off')) return false; } return true; };
    const pane = document.querySelector('.ae-pane:not([hidden])');
    const cards = [...pane.querySelectorAll('.ae-card, .sp-card, .lv-meter')].filter(c => shown(c) && !c.parentElement.closest('.ae-card, .sp-card'));
    const nm = c => c.id || c.className.split(' ')[0];
    const out = { cards: [], gaps: [], foot: [] };
    for (const c of cards) {
      const r = R(c), cs = getComputedStyle(c), inner = { t: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), b: r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) };
      let top = Infinity, bot = -Infinity;
      for (const k of c.children) { if (!shown(k) || getComputedStyle(k).position === 'absolute') continue; const kr = R(k); if (kr.height < 1) continue; top = Math.min(top, kr.top); bot = Math.max(bot, kr.bottom); }
      out.cards.push({ id: nm(c), cls: c.className, h: rnd(r.height), top: rnd(top - inner.t), bottom: rnd(inner.b - bot), foot: !!c.querySelector('.foot-row') });
    }
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const a = R(cards[i]), b = R(cards[j]), hO = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top), vO = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (hO > 0 && vO <= 0) out.gaps.push(nm(cards[i]) + '|' + nm(cards[j]) + ' side ' + rnd(Math.max(a.left, b.left) - Math.min(a.right, b.right)));
      if (vO > 0 && hO <= 0) out.gaps.push(nm(cards[i]) + '|' + nm(cards[j]) + ' stack ' + rnd(Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)));
    }
    for (const row of pane.querySelectorAll('.foot-row')) { if (!shown(row)) continue; const card = row.closest('.ae-card'), cs = getComputedStyle(card), sw = row.querySelector('.switch') || row, rr = R(row), sr = R(sw), cr = R(card);
      out.foot.push({ id: row.id || row.className, above: rnd(sr.top - rr.top), below: rnd(cr.bottom - parseFloat(cs.borderBottomWidth) - sr.bottom) }); }
    // what the ticket asks per tool: the content's left inset, a heading's offset from its card's top, the Level meter's bar and scale sizes, Emulate against the note, Fades' end labels against the picture, and the Mains hum sub-line
    const inset = c => { const k = [...c.children].find(k => shown(k) && R(k).width > 0 && getComputedStyle(k).position !== 'absolute'); return k ? rnd(R(k).left - R(c).left) : null; };
    out.inset = cards.map(c => ({ id: nm(c), v: inset(c) }));
    const hOff = (sel, h) => { const c = document.querySelector(sel); if (!c || !shown(c)) return null; const hh = c.querySelector(h); return hh ? rnd(R(hh).top - R(c).top) : null; };
    out.heads = { normalize: hOff('#aeNormCard', 'h4'), removal: hOff('#aeNrCtl', 'h4'), width: hOff('#aeWidthCard', 'h4'), gain: hOff('#aeGainCard', 'h4'), length: hOff('#aeFadeLenCard', 'h4') };
    const el = s => document.querySelector(s);
    if (shown(el('#aeMeter'))) out.meter = { track: rnd(R(el('#aeMeter .lv-track')).height), scale: rnd(R(el('#aeMeter .lv-scale')).height), bottom: rnd(R(el('#aeMeter')).bottom), paneBottom: rnd(R(pane).bottom), cardsBottom: rnd(Math.max(...cards.map(c => R(c).bottom))) };
    if (shown(el('#aeEmGo'))) out.emulate = { go: rnd(R(el('#aeEmGo')).bottom), note: rnd(R(el('.em-view .em-note')).bottom) };
    if (shown(el('#aeFadeLenField .sl-ends'))) out.fades = { labels: rnd(R(el('#aeFadeLenField .sl-ends')).bottom), picture: rnd(R(el('.fd-shape canvas')).bottom) };
    return out;
  };
  const sweep = {}, heights = [680, 720, 760, 800, 900];
  const [floor, chrome] = (await (async () => { const p = await b.newPage(); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); const v = await p.evaluate(() => { const c = getComputedStyle(document.documentElement); return c.getPropertyValue('--ae-floor') + ',' + c.getPropertyValue('--ae-chrome'); }); await p.close(); return v; })()).split(',').map(parseFloat);
  await Promise.all(heights.map(async h => {
    const out = sweep[h] = { frames: [], pass: [], body: [], level: [], notes: [], space: [], uig: [], hum: null, narrowFoot: [] };
    const mk = async file => { const p = await b.newPage({ viewport: { width: 1440, height: h } }); p.setDefaultTimeout(90000); p.on('pageerror', e => errs.push('1440x' + h + ': ' + e.message));
      await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/' + file);
      await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500); return p; };
    const look = async (p, label) => { const f = await p.evaluate(frame), m = await p.evaluate(fitMeasure, { card: '.ae-card, .nr-stage', body: '.ae-pbody', root: '.ae-pane:not([hidden])' });
      out.frames.push({ label, ...f }); m.pass.forEach(x => out.pass.push(label + ': ' + x)); if (!f.scrolls) m.body.forEach(x => out.body.push(label + ': ' + x));
      out.space.push({ label, ...(await p.evaluate(spaceOf)) });
      const g = await p.evaluate(() => uiGuard.scan().map(x => x.join(' '))); g.forEach(x => out.uig.push(label + ': ' + x));
      return { f, m }; };
    const p = await mk('loud.mp3'), tools = ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu'];
    for (const t of tools) { await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(700); await look(p, t);
      if (t === 'imager') out.imager = await p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { balBottom: r('#aeBalCard').bottom, scopeBottom: r('.im-scope').bottom, widthTop: r('#aeWidthCard').top, scopeTop: r('.im-scope').top, widthH: r('#aeWidthCard').height, balH: r('#aeBalCard').height }; });
      if (t === 'noise') out.noisePad = await p.evaluate(() => [getComputedStyle(document.querySelector('#aeNrCtl')).padding, getComputedStyle(document.querySelector('#aeGainCard')).padding]); }
    await p.evaluate(() => aeTool('noise')); await p.waitForTimeout(500);
    await p.evaluate(async () => { document.querySelector('#aeNrFind').click(); await sleep(100); for (let i = 0; i < 600 && AE.nrAutoBusy; i++) await sleep(25); await sleep(300); }); await look(p, 'noise found by Auto');
    // the Mains hum row: the switch and the card hold their places from idle, through busy, to done, and back off
    out.hum = await p.evaluate(async () => { const pos = () => { const s = document.querySelector('#aeNrHum').getBoundingClientRect(), c = document.querySelector('#aeNrSample').getBoundingClientRect(), r = document.querySelector('#aeNrHumRow').getBoundingClientRect(); return { sw: Math.round(s.top * 10) / 10, card: Math.round(c.height * 10) / 10, row: Math.round(r.height * 10) / 10, sub: document.querySelector('#aeNrHumVal').textContent }; };
      aeTool('noise'); await sleep(300); const rec = { idle: pos() }; document.querySelector('#aeNrHum').click(); await sleep(60); rec.busy = pos(); for (let i = 0; i < 400 && AE.humBusy; i++) await sleep(25); await sleep(300); rec.done = pos();
      document.querySelector('#aeNrHum').click(); await sleep(300); rec.off = pos(); return rec; });
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
  // cards are 10px apart in both directions, every card has equal space at its top and bottom (within 4px) unless a footer row pins to its bottom, and each footer row's space above and below its switch is equal (within 1px)
  for (const h of heights) { const sp = sweep[h].space, tag = '1440x' + h + ': ';
    const gaps = sp.flatMap(f => f.gaps.filter(g => Math.abs(+g.split(' ').pop() - 10) > 0.6).map(g => f.label + ': ' + g));
    ok(tag + 'every tool: cards are 10px apart, side by side and top to bottom', !gaps.length, gaps.slice(0, 4).join(' | '));
    // reserved: the 12px gap under Spectra's Select row and under the EQ band's row is the space held for a closed fold (Reduce by, Dynamic), so those two keep their rows and stay unticked in the ticket
    const reserved = c => /sp-sel|aeEqBand/.test(c.id + ' ' + c.cls);
    const edge = sp.flatMap(f => f.cards.filter(c => !c.foot && !reserved(c) && Math.abs(c.top - c.bottom) > 4).map(c => f.label + ': ' + c.id + ' top ' + c.top + ' bottom ' + c.bottom));
    ok(tag + 'every tool: a card has the same space at its top and bottom (4px at most), or a footer row pins to its bottom', !edge.length, edge.slice(0, 5).join(' | '));
    const foot = sp.flatMap(f => f.foot.filter(x => Math.abs(x.above - x.below) > 1).map(x => f.label + ': ' + x.id + ' above ' + x.above + ' below ' + x.below));
    ok(tag + 'footer rows: the space above each switch and below it is equal (1px)', !foot.length, foot.slice(0, 5).join(' | '));
  }
  // the Imager at phone and narrow widths: Center low notes' row may wrap, and its switch keeps equal space above and below
  const narrowFoot = [];
  for (const [w, h] of [[390, 800], [700, 900]]) { const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(90000);
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
    await p.evaluate(() => aeTool('imager')); await p.waitForTimeout(800);
    narrowFoot.push({ w, sp: await p.evaluate(spaceOf) }); await p.close(); }
  for (const h of heights) { const o = sweep[h], sp = o.space, tag = '1440x' + h + ': ';
    const ins = sp.flatMap(f => f.inset.filter(x => x.v !== null && Math.abs(x.v - 17) > 0.6).map(x => f.label + ': ' + x.id + ' ' + x.v));
    ok(tag + 'one padding: every tool card starts its content 17px from its left edge (the card padding and border)', !ins.length, ins.slice(0, 5).join(' | '));
    const plain = sp.flatMap(f => [f.heads.gain, f.heads.length].filter(v => v !== null && Math.abs(v - 13) > 1));
    const seg = sp.flatMap(f => ['normalize', 'removal', 'width'].map(k => [f.label, k, f.heads[k]]).filter(([, , v]) => v !== null && Math.abs(v - 13) > 1).map(([l, k, v]) => l + ': ' + k + ' ' + v));
    ok(tag + 'a heading beside a segmented control sits as far from its card\'s top as a plain heading (13px)', !seg.length && !plain.length, seg.slice(0, 5).join(' | ') + (plain.length ? ' plain ' + plain.join(',') : ''));
    const lv = sp.filter(f => f.meter), lvBad = lv.filter(f => Math.abs(f.meter.track - 14) > 0.5 || Math.abs(f.meter.scale - 16) > 0.5 || Math.abs(f.meter.bottom - f.meter.cardsBottom) > 1);
    ok(tag + 'Level: the bar keeps 14px and its scale 16px, and the Meter ends on the cards\' bottom line', lv.length > 0 && !lvBad.length, JSON.stringify(lv.map(f => f.meter)).slice(0, 300));
    const em = sp.filter(f => f.emulate);
    ok(tag + 'Emulator: Emulate sits level with the bottom of the graph card\'s note', em.length > 0 && em.every(f => Math.abs(f.emulate.go - f.emulate.note) <= 1), JSON.stringify(em.map(f => f.emulate)).slice(0, 200));
    const fd = sp.filter(f => f.fades);
    ok(tag + 'Fades, Length: its end labels end on the bottom line of the Shape picture', fd.length > 0 && fd.every(f => Math.abs(f.fades.labels - f.fades.picture) <= 1), JSON.stringify(fd.map(f => f.fades)).slice(0, 200));
    const curve = sp.flatMap(f => f.cards.filter(c => c.id === 'aeShapeCard' && Math.abs(c.top - c.bottom) > 1).map(c => f.label + ' ' + c.top + '/' + c.bottom));
    ok(tag + 'Fades, Curve: the row is centered in its card', !curve.length, curve.slice(0, 3).join(' | '));
    const hm = o.hum, moved = Object.entries(hm).filter(([k, x]) => Math.abs(x.sw - hm.idle.sw) > 1 || Math.abs(x.card - hm.idle.card) > 1 || Math.abs(x.row - hm.idle.row) > 1).map(([k]) => k);
    ok(tag + 'Mains hum: the switch, its row, and the card hold their places from idle through busy and done, and back off', !moved.length, JSON.stringify(hm).slice(0, 400) + (moved.length ? ' moved: ' + moved.join(',') : ''));
    ok(tag + 'uiGuard reports nothing in any tool or state', !o.uig.length, o.uig.slice(0, 4).join(' | '));
  }
  for (const n of narrowFoot) { const bad = n.sp.foot.filter(x => Math.abs(x.above - x.below) > 1);
    ok('Imager at ' + n.w + 'px: the footer row (Center low notes) keeps equal space above and below its switch', n.sp.foot.length > 0 && !bad.length, JSON.stringify(n.sp.foot)); }
  const feet = new Set(sweep[heights[0]].space.flatMap(f => f.foot.map(x => x.id)));
  ok('footer rows: Mains hum, Noise only, Limiter, and Center low notes all use the footer row', ['aeNrHumRow', 'nr-listen', 'aeLimRow', 'aeBassCard'].every(id => [...feet].some(x => x.includes(id))), [...feet].join(', '));
  const ih = heights.map(h => sweep[h].imager.widthH.toFixed(1) + '/' + sweep[h].imager.balH.toFixed(1));
  ok('Imager: Width and Balance keep their natural height at every screen height', new Set(ih).size === 1, ih.join(' '));
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
