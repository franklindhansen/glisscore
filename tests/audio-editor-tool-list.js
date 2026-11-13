// The Audio Editor's tool list: the order of the tools (Noise reduction, Spectra, In, EQ, Imager, Fades, Level, Out, spare room, a hairline, Emulator) with no headings; the cable from In to Out only,
// while Noise reduction and Spectra keep their lights; the highlight hugging each name with the same space before and after it; the Emulator pinned to the list's bottom with its name centered between its hairline
// and the list's border at every list height; the Emulator dimmed like any tool that does nothing (light and dark); the Beta chip as its own element with the same space each side of its word, in the list and in the head;
// "Emulator (beta)" nowhere; every tool subtitle in both editors the short command from the spec's table. Edges come from the shared helper tests/lib/measure.js (font metrics, never a marker element).
// Run through tests/run-all.sh.
const { chromium } = require('playwright-core');
const { install } = require('./lib/measure.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const SUBS = { noise: 'Banish hiss, hum, or room tone.', spec: 'Heal or turn down a blip, a hum, or a squeak you can see.', eq: 'Shape the tone, band by band.', imager: 'Widen, narrow, or re-center the sound.', fades: 'Ease the start and end.', level: 'Set the finished audio\'s volume.', emu: 'Borrow the sound of another recording.' };
const PDF_SUBS = { Arrange: 'Drag to reorder. Click a page to leave it out.', Clean: 'Whiten the paper and take the specks out of scans.', 'Re-kilter': 'Level tilted, slanted, and curved scans.', Crop: 'Find the music on the ticked pages and trim the extra margins.', Dim: 'Visually soften music before or after a repeat.', 'Split spreads': 'Split two-page spreads into single pages.', 'Re-size': 'Fit every page to one size.', Watermark: 'Print text across the pages you pick.' };
const ORDER = ['noise', 'spec', 'in', 'eq', 'imager', 'fades', 'level', 'out', 'emu'];
const SIZES = [[1440, 900], [1440, 1100], [1440, 760], [1040, 700], [390, 800], 'full'];
const url = '/index.html?disk=0', base = () => 'http://localhost:' + (process.env.PORT || 8123) + url;
(async () => {
  const b = await chromium.launch(), errs = [], fails = [], seen = [];
  const chk = (tag, name, cond, info) => { seen.push(tag + name); if (!cond) fails.push(tag + name + ' — ' + info); ok(tag + name, cond, cond ? '' : info); };
  const one = async size => {
    const full = size === 'full', [w, h] = full ? [1440, 900] : size, tag = (full ? 'full screen' : w + 'x' + h) + ': ', narrow = !full && w <= 760;
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push(tag + e.message); });
    await p.goto(base()); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/stereo.wav'); await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer);
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400); if (full) { await p.click('#aeFull'); await p.waitForTimeout(900); }
    await p.evaluate(install);
    if (narrow) { await p.click('#aeRailCur'); await p.waitForTimeout(700); }
    // the order, top to bottom, and no headings
    const o = await p.evaluate(() => {
      const rail = document.querySelector('#aeRailIn'), at = e => e.getBoundingClientRect().top, items = [...rail.querySelectorAll('.ae-tool, .ae-end')].map(e => ({ k: e.dataset.tool || (e.id === 'aeJackIn' ? 'in' : 'out'), y: at(e) })).sort((a, c) => a.y - c.y);
      const apart = rail.querySelector('.ae-apart'), cs = getComputedStyle(apart), out = document.querySelector('#aeJackOut').getBoundingClientRect();
      return { order: items.map(i => i.k), headings: rail.querySelectorAll('.ae-rail-h').length, text: /Processing|Output/.test(rail.innerText), hair: parseFloat(cs.borderTopWidth), hairBelowOut: apart.getBoundingClientRect().top >= out.bottom - 0.5, apartHasOnlyEmu: apart.querySelectorAll('.ae-tool').length === 1 && apart.querySelector('.ae-tool').dataset.tool === 'emu' };
    });
    chk(tag, 'the list reads Noise reduction, Spectra, In, EQ, Imager, Fades, Level, Out, then Emulator', o.order.join() === ORDER.join(), o.order.join());
    chk(tag, 'the list has no headings', o.headings === 0 && !o.text, JSON.stringify({ n: o.headings, text: o.text }));
    chk(tag, 'the Emulator is the last row, alone under a hairline that sits under Out', o.hair === 1 && o.hairBelowOut && o.apartHasOnlyEmu, JSON.stringify(o));
    // the highlight hugs each name: the button is the highlight, the same space before and after the letters
    const hug = await p.evaluate(() => [...document.querySelectorAll('#aeRailIn .ae-tool')].map(t => { const l = __mk.letters(t.querySelector('.ae-tn')), r = t.getBoundingClientRect(); return { k: t.dataset.tool, before: +(l.left - r.left).toFixed(2), after: +(r.right - l.right).toFixed(2) }; }));
    chk(tag, 'the highlight has the same space before and after every name, within 0.5px', hug.length === 7 && hug.every(x => Math.abs(x.before - x.after) <= 0.5), JSON.stringify(hug));
    const sel = await p.evaluate(async () => { const out = []; for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu']) { aeTool(t); await sleep(650); const s = document.querySelector('#aeRailSel').getBoundingClientRect(), r = document.querySelector('#aeRail .ae-tool.on').getBoundingClientRect(); out.push({ t, dx: +(s.left - r.left).toFixed(2), dy: +(s.top - r.top).toFixed(2), dw: +(s.width - r.width).toFixed(2), dh: +(s.height - r.height).toFixed(2) }); } return out; });
    chk(tag, 'the selection highlight is the tool button, tool by tool', sel.every(x => Math.abs(x.dx) <= 0.5 && Math.abs(x.dy) <= 0.5 && Math.abs(x.dw) <= 0.5 && Math.abs(x.dh) <= 0.5), JSON.stringify(sel));
    // the badge has no fixed width: it is as wide as its words, at the row's right end
    const bd = await p.evaluate(() => { const e = document.querySelector('#aeImBadge'); e.textContent = 'x'; const a = e.getBoundingClientRect(); e.textContent = 'Curve + 3 bands'; const c = e.getBoundingClientRect(), row = e.closest('.ae-proc').getBoundingClientRect(); e.textContent = ''; return { a: a.width, c: c.width, gap: row.right - c.right }; });
    chk(tag, 'the badge is as wide as its words and sits at the row\'s right end', bd.c > bd.a + 20 && bd.gap < 6, JSON.stringify(bd));
    // the Emulator's name between its hairline and the list's border (scrolled to the bottom when the list scrolls), and the Beta chip
    if (!narrow) {
      await p.evaluate(() => { const r = document.querySelector('#aeRail'); r.scrollTop = r.scrollHeight; for (const e of document.querySelectorAll('#aeRail, #aeRailBody, #aeRailIn')) e.scrollTop = e.scrollHeight; });
      await p.waitForTimeout(100);
      const c = await p.evaluate(() => { const rail = document.querySelector('#aeRail'), cs = getComputedStyle(rail), ap = document.querySelector('.ae-apart'), l = __mk.letters(document.querySelector('.ae-tool[data-tool=emu] .ae-tn')), a = ap.getBoundingClientRect(), r = rail.getBoundingClientRect(); const line = a.top + parseFloat(getComputedStyle(ap).borderTopWidth), edge = r.bottom - parseFloat(cs.borderBottomWidth); return { above: +(l.capTop - line).toFixed(2), below: +(edge - l.base).toFixed(2), railH: r.height, pinned: +(edge - parseFloat(cs.paddingBottom) - document.querySelector('.ae-tool[data-tool=emu]').closest('.ae-proc').getBoundingClientRect().bottom).toFixed(2) }; });
      chk(tag, 'the Emulator\'s name is centered between its hairline and the list\'s border, within 0.5px', Math.abs(c.above - c.below) <= 0.5, JSON.stringify(c));
      chk(tag, 'the Emulator row is pinned to the list\'s bottom (nothing between its row and the list\'s padding)', Math.abs(c.pinned) <= 0.5, JSON.stringify(c));
    }
    const ch = await p.evaluate(() => { const c = document.querySelector('#aeRailIn .beta-chip'), l = __mk.letters(c), r = c.getBoundingClientRect(), tool = document.querySelector('.ae-tool[data-tool=emu]').getBoundingClientRect(), n = __mk.letters(document.querySelector('.ae-tool[data-tool=emu] .ae-tn')), cs = getComputedStyle(c); return { before: +(l.left - r.left).toFixed(2), after: +(r.right - l.right).toFixed(2), own: !c.closest('.ae-tool') && !c.closest('output') && c.textContent === 'Beta', after_name: r.left >= tool.right - 0.5, rights: [...document.querySelectorAll('#aeRailIn .ae-proc:not([data-tool=emu])')].map(row => { const o = row.querySelector('.ae-badge'); return o ? +(r.right - o.getBoundingClientRect().right).toFixed(2) : null; }).filter(v => v !== null), shown: (() => { const e = document.querySelector('#aeEmBadge'), before = c.getBoundingClientRect().right; e.textContent = '100%'; const after = c.getBoundingClientRect().right, bx = e.getBoundingClientRect(); e.textContent = ''; return { moved: +(after - before).toFixed(2), beside: bx.right <= c.getBoundingClientRect().left + 0.5 }; })(), mid: +(((l.capTop + l.base) / 2) - ((n.capTop + n.base) / 2)).toFixed(2), px: cs.width }; });
    chk(tag, 'the Beta chip is its own element at the row\'s right end, on the right line of every row\'s readout, with the same space each side of its word, on the name\'s middle', ch.own && ch.after_name && ch.rights.length === 6 && ch.rights.every(d => Math.abs(d) <= 0.5) && Math.abs(ch.shown.moved) <= 0.5 && ch.shown.beside && Math.abs(ch.before - ch.after) <= 0.5 && Math.abs(ch.mid) <= 0.5, JSON.stringify(ch));
    // the head: the chip follows the name and is only there for the Emulator
    const hd = await p.evaluate(async () => { const res = {}; for (const t of ['eq', 'emu']) { aeTool(t); await sleep(700); const bar = !__mk.shown(document.querySelector('#aePaneTitle')), c = document.querySelector(bar ? '#aeRailBeta' : '#aePaneBeta'), h = document.querySelector(bar ? '#aeRailName' : '#aePaneTitle'), cr = c.getBoundingClientRect(); const shown = __mk.shown(c); res[t] = { shown, title: h.textContent, bar }; if (shown) { const l = __mk.letters(c), hl = __mk.letters(h); Object.assign(res[t], { before: +(l.left - cr.left).toFixed(2), after: +(cr.right - l.right).toFixed(2), afterName: cr.left >= h.getBoundingClientRect().right - 0.5, mid: +(((l.capTop + l.base) / 2) - ((hl.capTop + hl.base) / 2)).toFixed(2) }); } } return res; });
    chk(tag, 'the head (or the bar over the list, where the head moves into it) shows the Beta chip after "Emulator" only, evenly padded and on the name\'s middle', !hd.eq.shown && hd.emu.shown && hd.emu.title === 'Emulator' && hd.emu.afterName && Math.abs(hd.emu.before - hd.emu.after) <= 0.5 && Math.abs(hd.emu.mid) <= 1, JSON.stringify(hd));
    // "Emulator (beta)" appears nowhere (the list, the head, the drop-down's name, the status line, and the History steps)
    const nb = await p.evaluate(async () => { aeTool('emu'); await sleep(500); const names = [document.querySelector('#audioDlg').innerText, document.querySelector('#aeRailName').textContent]; AE.undo.push(aeCopy(AE.d)); AE.d.bp = Object.assign({}, AE.d.bp || {}, { emu: true }); aeHistOpen(true); const history = document.querySelector('#aeHistList').textContent; aeHistOpen(false); aeUndo(); return { any: names.concat(history).some(t => /\(beta\)/i.test(t)), history, drop: document.querySelector('#aeRailName').textContent }; });
    chk(tag, 'the words "Emulator (beta)" appear nowhere; the drop-down and the History steps say Emulator', !nb.any && nb.history.includes('Bypassed Emulator') && nb.drop === 'Emulator', JSON.stringify(nb));
    // every tool subtitle
    const subs = await p.evaluate(async () => { const out = {}; for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu']) { aeTool(t); await sleep(650); out[t] = document.querySelector('#aePaneSub').textContent; } return out; });
    chk(tag, 'every Audio Editor subtitle is the short command from the spec', Object.keys(SUBS).every(k => subs[k] === SUBS[k]), JSON.stringify(subs));
    if (tag.startsWith('1440x900') || narrow) {
      // the cable runs from In to Out only; Noise reduction and Spectra are lit and have no cable
      const cab = await p.evaluate(async () => {
        aeTool('eq'); AE.d.fx.noise.on = true; AE.d.fx.spec.on = true; AE.d.fx.imager.on = true; AE.d.fx.eq.on = true; AE.d.fx.eq.curve = Array.from(eqAxis, () => 3); AE.d.audioFades = true; AE.d.gainDb = 3; aeToolsRefresh(); if (innerWidth <= 760) aeRailOpen(true); await sleep(2200);
        const root = document.querySelector('#aeRailIn').getBoundingClientRect(), svg = document.querySelector('#aeWires'), c = e => { const r = document.querySelector(e).getBoundingClientRect(); return [(r.left + r.right) / 2 - root.left, (r.top + r.bottom) / 2 - root.top]; };
        const plugs = [...svg.querySelectorAll('.w-plug:not(.drag)')].map(e => [+e.getAttribute('cx'), +e.getAttribute('cy')]), near = (a, b) => Math.abs(a[0] - b[0]) < 1.5 && Math.abs(a[1] - b[1]) < 1.5;
        let top = Infinity, bottom = -Infinity; for (const e of svg.querySelectorAll('path')) { const bb = e.getBBox(); top = Math.min(top, bb.y); bottom = Math.max(bottom, bb.y + bb.height); }
        const inY = c('#aeJackIn i')[1], outY = c('#aeJackOut i')[1], led = id => document.querySelector(id).classList.contains('on');
        return { top: +(top - inY).toFixed(1), bottom: +(bottom - outY).toFixed(1), plugged: ['#aeEqLed', '#aeImLed', '#aeFdLed', '#aeLvLed'].map(id => plugs.some(p => near(p, c(id)))), unplugged: ['#aeNrLed', '#aeSpLed'].map(id => !plugs.some(p => near(p, c(id)))), lit: ['#aeNrLed', '#aeSpLed', '#aeEqLed', '#aeImLed', '#aeFdLed', '#aeLvLed'].map(led), n: plugs.length };
      });
      chk(tag, 'the cable runs from In to Out only: it starts at In and ends at Out, plugging EQ, Imager, Fades, and Level', Math.abs(cab.top) <= 0.5 && Math.abs(cab.bottom) <= 0.5 && cab.plugged.every(Boolean), JSON.stringify(cab));
      chk(tag, 'Noise reduction and Spectra keep their lights and have no cable', cab.lit.every(Boolean) && cab.unplugged.every(Boolean), JSON.stringify(cab));
    }
    if (tag.startsWith('1440x900')) {
      const help = await p.evaluate(() => { const d = [...document.querySelectorAll('.how-d')].find(e => e.querySelector('summary').textContent === 'How the Audio Editor works'); return { headings: [...d.querySelectorAll('h4')].map(e => e.textContent), buttons: [...d.querySelectorAll('.hb')].map(e => e.textContent) }; });
      chk(tag, 'the help dialog says Learn and Emulator', help.headings.includes('Emulator') && !help.headings.some(t => /\(beta\)/i.test(t)) && help.buttons.includes('Learn') && !help.buttons.includes('Learn noise'), JSON.stringify(help));
      // the Emulator's row is dimmed like any tool that does nothing, and lit when its result is applied; in light and dark
      for (const theme of ['light', 'dark']) {
        await p.evaluate(t => { document.documentElement.setAttribute('data-theme', t); }, theme); await p.waitForTimeout(500);
        const d = await p.evaluate(async () => { AE.d.fx.eq.on = false; aeTool('level'); aeToolsRefresh(); await sleep(700); const row = k => document.querySelector('#aeRail .ae-proc[data-tool=' + k + ']'), tn = k => getComputedStyle(row(k).querySelector('.ae-tn')); return { cls: row('emu').classList.contains('off'), emu: [+tn('emu').opacity, tn('emu').color], idle: [+tn('eq').opacity, tn('eq').color], lit: [+tn('fades').opacity, tn('fades').color], eqOff: row('eq').classList.contains('off'), fdOff: row('fades').classList.contains('off') }; });
        chk(tag, 'the Emulator row carries the same off look as an idle tool while nothing is applied, and a lit tool does not (' + theme + ')', d.cls && d.eqOff && !d.fdOff && d.emu[0] < 1 && d.emu[0] === d.idle[0] && d.emu[1] === d.idle[1] && d.lit[0] === 1, JSON.stringify(d));
      }
    }
    await p.close();
  };
  const queue = [...SIZES]; await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); }));
  // the PDF Editor's subtitles
  { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push('pdf: ' + e.message); });
    await p.goto(base()); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 0); await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(600);
    const got = await p.evaluate(async () => { const out = {}; for (const pt of document.querySelectorAll('#pdfDlg .pe-pt')) out[pt.querySelector('h3').textContent] = pt.querySelector('.pe-sub').textContent; return out; });
    chk('', 'every PDF Editor subtitle is the short command from the spec', Object.keys(PDF_SUBS).every(k => got[k] === PDF_SUBS[k]), JSON.stringify(got));
    await p.evaluate(() => peTool('crop')); await p.waitForTimeout(700); const crop = await p.evaluate(() => document.querySelector('#peCropSub').textContent);
    chk('', 'Crop\'s subtitle on show is the table\'s, as the editor draws it', crop.startsWith(PDF_SUBS.Crop), crop);
    await p.close(); }
  chk('', 'no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
