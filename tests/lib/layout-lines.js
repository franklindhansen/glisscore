// The layout rules of an Audio Editor tool window, read from the page by audio-editor-grid-lines.js: run it in the page after p.evaluate(install) from tests/lib/measure.js.
//   const m = await p.evaluate(lines, { main: true })     ->  { n: how many things were measured, fails: [[rule, element, note], ...], heights: { card: height } }
// Nothing here names a tool or a card: the cards are the .ae-card inside the tool pane on show, so a new card is measured the moment it exists. Every letter, button, and slider edge comes from the shared helper (__mk).
// The rules (the spec's Testing Decisions):
//   heading-top        the heading's letters (cap top) sit 21px under the card's top edge
//   head-ctl-height    a choice or button on the heading row is 30px tall
//   head-ctl-center    ... centered on the heading's letters (the middle of the cap height)
//   head-ctl-right     ... and the row's last one ends on the card's right content line
//   body-balance       the body (letters, control edges, slider thumbs) has equal space above, from the heading row's lowest visible edge, and below, to the footer row's line or the card's bottom edge
//   heading-gap        a display or list starts at least --gap-set below its heading row's lowest visible edge
//   card-gap           two cards side by side or one above the other are --gap-card apart
//   scale-gap          the labels under a slider and the numbers under a bar start --scale-gap under the visible bar or track
//   mid-tick           the middle label of a three-label scale is centered under the thumb at the middle value
//   label-row          a label beside a switch is centered on it; beside a control with words it shares its baseline
//   label-size         ... and it is 13px
//   slider-word        a word beside a slider (an end label, a label, a value) has its letters' middle on the slider's line, within 0.5px
//   left-line, right-line   cards that share a row start on the tool window's left line and end on its right line, and so do the tool's name and buttons in the head (the status bar's content starts on the left line)
//   picture-border    a picture (canvas or image) in a card has no border of its own
//   clipped            nothing passes its card's padding box, and nothing in the tool scrolls sideways
//   scroll             (main size) the tool body, the dialog, and the page do not scroll
// A pane on the tool grid (.tool-grid) also keeps the grid rules: grid-edge, row-top, row-bottom, row-heading, row-body, row-gap, card-padding, part-edge, first-part, last-part, row-controls.
// A column of stacked cards in a .tool-group is one unit of its row (every card spans the column, the grid's row gap apart); a card inside a .card-fold is a grid card while it shows; a picture part may run exactly on the card's border lines.
exports.lines = function (ctx) {
  const mk = window.__mk, R = mk.R, near = (a, b, t = 0.5) => Math.abs(a - b) <= t + 1e-6, f = v => (Math.round(v * 10) / 10).toString();
  const fails = [], out = { n: 0, fails, heights: {} };
  const chk = (rule, el, pass, note) => { out.n++; if (!pass) fails.push([rule, el, note]); };
  const name = e => e.id ? e.id : (typeof e.className === 'string' && e.className.trim() ? e.className.trim().split(/\s+/).slice(0, 3).join('.') : e.tagName.toLowerCase());
  const root = getComputedStyle(document.documentElement), tok = k => parseFloat(root.getPropertyValue(k));
  const SEL = Object.assign({ pane: '.ae-pane:not([hidden])', card: '.ae-card', head: '.ae-phead', body: '.ae-pbody' }, ctx.sel || {});          // where the tool pane, its cards, its heading bar, and its body are: the Audio Editor's by default, another editor's through ctx.sel
  const pane = document.querySelector(SEL.pane);
  const cards = [...pane.querySelectorAll(SEL.card)].filter(c => mk.shown(c) && !c.parentElement.closest(SEL.card));
  const noBody = c => c.querySelector('.sp-list, .nr-stage, .im-scope, canvas');          // a picture or a list that takes the rest of the card has no body to center
  const mid = l => (l.capTop + l.base) / 2;
  const inner = c => { const r = R(c), cs = getComputedStyle(c), n = k => parseFloat(cs[k]); return { bt: r.top + n('borderTopWidth'), bb: r.bottom - n('borderBottomWidth'), t: r.top + n('borderTopWidth') + n('paddingTop'), b: r.bottom - n('borderBottomWidth') - n('paddingBottom'), l: r.left + n('borderLeftWidth') + n('paddingLeft'), r: r.right - n('borderRightWidth') - n('paddingRight') }; };
  for (const c of cards) {
    const cn = name(c), cr = R(c), ci = inner(c); out.heights[cn] = Math.round(cr.height * 10) / 10;
    // the heading row: the first part of the card, its text, and the choices and buttons on it
    const row = c.querySelector(':scope > .t-head, :scope > h4'), text = row && mk.shown(row) ? (row.matches('h4') ? row : row.querySelector('h4') || row) : null, hl = text ? mk.letters(text) : null;
    let ctrls = [], headBottom = null;
    if (hl) {
      chk('heading-top', cn, near(hl.capTop - cr.top, 21), 'the heading letters start ' + f(hl.capTop - cr.top) + 'px under the card\'s top, not 21');
      ctrls = [...c.querySelectorAll('.btn, .seg, select')].filter(e => mk.shown(e) && !e.closest('.foot-row, .sp-list') && !e.parentElement.closest('.seg') && Math.abs((R(e).top + R(e).bottom) / 2 - mid(hl)) <= 20);
      for (const e of ctrls) {
        const r = R(e), en = name(e);
        chk('head-ctl-height', cn + '>' + en, near(r.height, 30), 'is ' + f(r.height) + 'px tall, not 30');
        chk('head-ctl-center', cn + '>' + en, near((r.top + r.bottom) / 2, mid(hl)), 'its center is ' + f((r.top + r.bottom) / 2 - mid(hl)) + 'px off the heading letters\' middle');
      }
      if (ctrls.length) { const last = ctrls.reduce((a, e) => R(e).right > R(a).right ? e : a); chk('head-ctl-right', cn + '>' + name(last), near(R(last).right, ci.r), 'ends ' + f(R(last).right - ci.r) + 'px from the card\'s right content line'); }
      headBottom = Math.max(hl.base, ...(row.classList.contains('hang') ? [] : [...row.querySelectorAll('.btn, .seg, select')].filter(e => mk.shown(e) && !e.parentElement.closest('.seg')).map(e => R(e).bottom)));          // a row marked hang ends at its letters: its choice hangs into the body, which is balanced from the letters          // the row's lowest visible edge: a choice or button that wrapped onto the row's second line counts too
    }
    // a picture in a card has no border of its own: the card's line is the only one
    for (const pic of c.querySelectorAll('canvas, img')) if (mk.shown(pic)) chk('picture-border', cn + '>' + name(pic), ['Top', 'Right', 'Bottom', 'Left'].every(s => parseFloat(getComputedStyle(pic)['border' + s + 'Width']) === 0), 'has a border of its own inside the card');
    // A display or list fills its available space rather than centering its ink. Measure its first in-flow content box, so a centered empty-list note cannot hide a list touching the heading.
    if (noBody(c) && headBottom != null) {
      const first = [...c.children].find(e => e !== row && mk.shown(e) && !e.matches('.tip,.nr-prog,.foot-row') && !['absolute', 'fixed'].includes(getComputedStyle(e).position));
      if (first) { const gap = R(first).top - headBottom; chk('heading-gap', cn, gap >= tok('--gap-set') - 0.5, 'space under the heading row ' + f(gap) + 'px, less than ' + tok('--gap-set')); }
    }
    // the balanced body
    if (!noBody(c)) {
      const hasLine = e => { const cs = getComputedStyle(e); return (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') || /inset\s+0px\s+1px\s+0px\s+0px|0px\s+1px\s+0px\s+0px\s+inset/.test(cs.boxShadow); };          // a line on a part's top: its border, or the 1px inset line the footer rows draw (it takes no room)
      const isFoot = e => e.matches('.foot-row') || (e.parentElement === c && e !== row && !mk.isControl(e) && hasLine(e));          // a footer row: the shared one, or any last part of the card that has a line on its top
      const body = mk.inkOf(c, e => e === row || ctrls.some(k => k === e || k.contains(e)) || isFoot(e)), foot = [...c.children].filter(e => isFoot(e) && mk.shown(e)).concat([...c.querySelectorAll('.foot-row')].filter(e => mk.shown(e) && e.parentElement !== c)).map(R).sort((a, b) => a.top - b.top)[0];
      const nnote = c.querySelector('.lv-noterow .lv-note'); if (body && nnote && mk.shown(nnote.parentElement)) { const was = nnote.textContent; if (!was) nnote.textContent = 'Ag'; const ni = mk.inkOf(nnote.parentElement, () => false); nnote.textContent = was; if (ni) body.bottom = Math.max(body.bottom, ni.bottom); }          // a note's row is always there (so a note appearing moves nothing) and is part of the body even when it holds no words
      const bigOwn = c.querySelector(':scope>.lv-big');          // a big number that is the card's own part (Gain) is centered between the heading and the slider; the slider sits on the card's bottom as the last part does
      if (bigOwn && mk.shown(bigOwn)) { const bi = mk.inkOf(bigOwn, () => false), fi = mk.inkOf(c.querySelector(':scope>.field'), () => false);
        if (bi && fi && headBottom != null) { const above = bi.top - headBottom, below = fi.top - bi.bottom; chk('body-balance', cn, near(above, below) && Math.min(above, below) >= tok('--gap-set') - 0.5, 'space above the big number ' + f(above) + 'px, below ' + f(below) + 'px; at least ' + tok('--gap-set') + 'px on each side'); } }
      else       if (body) { const above = body.top - (headBottom != null ? headBottom : ci.bt), line = foot ? foot.top : ci.bb, below = line - body.bottom;
        const least = c.querySelector('.im-view.row3-set') ? tok('--gap-set') - tok('--gap-sub') : tok('--gap-set'); chk('body-balance', cn, near(above, below) && Math.min(above, below) >= least - 0.5, 'space above the body ' + f(above) + 'px, below ' + f(below) + 'px; at least ' + least + 'px on each side'); }
    }
  }
  // gaps between neighbors
  const gap = tok('--gap-card');
  for (let i = 0; i < cards.length; i++) for (let j = 0; j < cards.length; j++) {
    if (i === j) continue; const a = R(cards[i]), b = R(cards[j]), between = k => cards.some((c, x) => x !== i && x !== j && (() => { const m = R(c); return k === 'side' ? m.left >= a.right - 0.5 && m.right <= b.left + 0.5 && m.top < Math.min(a.bottom, b.bottom) && m.bottom > Math.max(a.top, b.top) : m.top >= a.bottom - 0.5 && m.bottom <= b.top + 0.5 && m.left < Math.min(a.right, b.right) && m.right > Math.max(a.left, b.left); })());
    const hO = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top), vO = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    if (hO > 1 && b.left >= a.right - 0.5 && !between('side')) chk('card-gap', name(cards[i]) + '|' + name(cards[j]), near(b.left - a.right, gap), 'side by side ' + f(b.left - a.right) + 'px apart, not ' + gap);
    if (vO > 1 && b.top >= a.bottom - 0.5 && !between('stack')) chk('card-gap', name(cards[i]) + '|' + name(cards[j]), near(b.top - a.bottom, gap), 'one above the other ' + f(b.top - a.bottom) + 'px apart, not ' + gap);
  }
  // scales under a slider or a bar
  const headGap = tok('--scale-gap'), setGap = headGap - (tok('--thumb') - tok('--track')) / 2;          // a bar's numbers start --scale-gap under the bar; a slider's start that much under its track, which is less under its thumb (the thumb hangs below the track)
  for (const sc of pane.querySelectorAll('.sl-ends, .lv-scale')) {
    if (!mk.shown(sc)) continue; const host = sc.parentElement;
    if (sc.matches('.sl-ends')) {
      const sl = host.querySelector('input[type=range]'); if (!sl) continue; const t = mk.thumb(sl), labs = [...sc.children].filter(e => mk.shown(e)), ls = labs.map(e => mk.letters(e)).filter(Boolean); if (!ls.length) continue;
      chk('scale-gap', name(sl), near(Math.min(...ls.map(l => l.capTop)) - t.bottom, setGap), 'the labels start ' + f(Math.min(...ls.map(l => l.capTop)) - t.bottom) + 'px under the slider\'s thumb, not ' + setGap);
      const lo = +sl.min, hi = +sl.max, midV = (lo + hi) / 2, m = labs.find(e => e.dataset.v !== undefined && +e.dataset.v === midV);
      if (m && labs.length === 3) { const w = parseFloat(getComputedStyle(sl, '::-webkit-slider-thumb').width) || 16, r = R(sl), cx = r.left + w / 2 + 0.5 * (r.width - w), mark = !m.textContent.trim() && m.firstElementChild, ml = mark ? R(mark) : mk.letters(m);          // a drawn tick (a mark with no text) is measured by its own box
        chk('mid-tick', name(sl), ml && near((ml.left + ml.right) / 2, cx), 'the middle label is centered ' + (ml ? f((ml.left + ml.right) / 2 - cx) : '?') + 'px off the thumb at the middle value'); 
        if (mark) { const capTop = Math.min(...ls.map(l => l.capTop)); chk('mid-tick', name(sl) + '.ends', near(ml.bottom, capTop), 'the tick ends ' + f(ml.bottom - capTop) + 'px off the line where the labels\' letters start'); } }
    } else {
      const bar = host.querySelector('.lv-track'); if (!bar) continue; const ls = mk.inkOf(sc);
      if (ls) chk('scale-gap', name(bar), near(ls.top - R(bar).bottom, headGap), 'the numbers start ' + f(ls.top - R(bar).bottom) + 'px under the bar, not ' + headGap);
    }
  }
  // a middle tick under a slider with its words beside it (.sl-in): centered under the thumb at the middle value, and wholly under the thumb, never touching it
  for (const tk of pane.querySelectorAll('.sl-in > .tick')) {
    const sl = tk.parentElement.querySelector('input[type=range]'); if (!sl || !mk.shown(sl)) continue; const mark = tk.firstElementChild || tk, mr = R(mark), r = R(sl), t = mk.thumb(sl);
    chk('mid-tick', name(sl), mr.height >= 1 && near((mr.left + mr.right) / 2, r.left + r.width / 2), 'the tick is centered ' + f((mr.left + mr.right) / 2 - (r.left + r.width / 2)) + 'px off the thumb at the middle value');
    chk('mid-tick', name(sl) + '.clear', mr.top >= t.bottom, 'the tick starts ' + f(mr.top - t.bottom) + 'px under the thumb (it must not touch it)');
    const nx = tk.parentElement.nextElementSibling;          // numbers under the tick row: the tick ends above their letters
    if (nx && nx.matches('.sl-ends')) { const ls = [...nx.children].filter(e => mk.shown(e)).map(e => mk.letters(e)).filter(Boolean); if (ls.length) { const top = Math.min(...ls.map(l => l.capTop)); const bot = Math.max(...ls.map(l => l.base)), side = Math.min(...ls.map(l => Math.min(Math.abs(l.left - mr.right), Math.abs(mr.left - l.right)))); chk('mid-tick', name(sl) + '.above-numbers', mr.top >= top - 0.5 && mr.bottom <= bot + 0.5 && side >= 2, 'the tick must sit in the numbers\' row (top ' + f(mr.top - top) + 'px, bottom ' + f(mr.bottom - bot) + 'px off the letters) and clear of them by 2px (' + f(side) + 'px)'); } }
  }
  // one look for scales and readouts: every end word and number scale is --scale-fs, regular weight, tabular; every value readout is regular weight
  for (const e of pane.querySelectorAll('.sl-end:not(.tick), .lv-scale span')) { if (!mk.shown(e)) continue; const c = getComputedStyle(e);
    chk('scale-style', name(e.closest('.field, .lv-meter, .ae-card') || e) + '>' + e.textContent.trim(), near(parseFloat(c.fontSize), tok('--scale-fs')) && c.fontWeight === '400' && c.fontVariantNumeric.includes('tabular-nums'), 'it is ' + c.fontSize + ' at weight ' + c.fontWeight + ', not ' + tok('--scale-fs') + 'px regular tabular'); }
  for (const e of pane.querySelectorAll('output:not(.lv-big), .bm-val, .head-note')) { if (!mk.shown(e) || !e.textContent.trim()) continue; const c = getComputedStyle(e); chk('scale-style', name(e) + '.readout', c.fontWeight === '400' && near(parseFloat(c.fontSize), tok('--value-fs')), 'a value readout is ' + c.fontSize + ' at weight ' + c.fontWeight + ', not ' + tok('--value-fs') + 'px regular'); }
  // one inactive level: whatever is dimmed (a card, field, slider, or switch that does not apply) is dimmed by --inactive in all, never stacked; user-set values are ink, measured readings are muted
  const eff = e => { let o = 1; for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }, inact = parseFloat(root.getPropertyValue('--inactive'));
  for (const e of pane.querySelectorAll('.dim, .none, input[type=range]:disabled, input.switch:disabled, .btn:disabled, .icon-btn:disabled')) { if (!mk.shown(e) || e.closest('.ae-proc, .im-view.off, [hidden]')) continue; const o = eff(e); chk('inactive', name(e), Math.abs(o - inact) < 0.01 || Math.abs(o - 1) < 0.01 && e.matches('input') && e.closest('.dim, .none'), 'it shows at ' + o.toFixed(2) + ' of full strength, not ' + inact); }
  for (const e of pane.querySelectorAll('output:not(.lv-big), .bm-val, .head-note')) { if (!mk.shown(e) || !e.textContent.trim()) continue; const c = getComputedStyle(e).color, reading = e.matches('.bm-val, .head-note'), sw = k => { const i = document.createElement('i'); i.style.color = 'var(' + k + ')'; document.body.appendChild(i); const v = getComputedStyle(i).color; i.remove(); return v; }; chk('value-color', name(e), c === sw(reading ? '--muted' : '--ink'), reading ? 'a measured reading is not muted' : 'a value the user sets is not ink'); }
  // a word beside a slider (an end label, a label, a value) has its letters' middle on the slider's line, the middle of its track and thumb
  for (const sl of pane.querySelectorAll('input[type=range]')) {
    if (!mk.shown(sl)) continue; const t = mk.thumb(sl), cy = (t.top + t.bottom) / 2, sr = R(sl), row = sl.closest('.sl-row') || sl.parentElement;          // the slider's own row (a .sl-row, or the element that holds it)
    for (const e of row.querySelectorAll('*')) {
      if (!mk.shown(e) || !e.childNodes.length || ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) || e.closest('.t-head, .tip, .seg, select, .bal-meter') || (e.closest('button') && !e.closest('.sl-end'))) continue;          // a button other than an end label is a control with rules of its own
      const r = R(e); if (r.right > sr.left + 0.5 && r.left < sr.right - 0.5) continue;          // beside the slider, not above or under it
      const l = mk.letters(e); if (!l || l.base < t.top || l.capTop > t.bottom) continue;          // only words on the slider's line
      chk('slider-word', name(sl) + '>' + name(e), near((l.capTop + l.base) / 2, cy), 'its letters\' middle is ' + f((l.capTop + l.base) / 2 - cy) + 'px off the slider\'s line');
    }
  }
  // rows of a label and a control
  for (const rowEl of pane.querySelectorAll('.foot-row, .im-listen, label:has(> input.switch)')) {
    if (!mk.shown(rowEl)) continue; const lab = [...rowEl.querySelectorAll('span, label')].find(e => mk.shown(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !e.closest('.seg, .btn')) || (rowEl.matches('label') ? rowEl : null);
    const sw = rowEl.querySelector('input.switch'), ctl = rowEl.querySelector('.seg, select, .btn'); const ll = lab && mk.letters(lab); if (!ll) continue;
    if (sw && mk.shown(sw) && !ctl) { const r = R(sw); chk('label-row', name(sw), near(mid(ll), (r.top + r.bottom) / 2), 'the label is centered ' + f(mid(ll) - (r.top + r.bottom) / 2) + 'px off its switch'); }
    else if (ctl && mk.shown(ctl)) { const w = ctl.matches('.seg') ? ctl.querySelector('span') : ctl, cl = w && mk.letters(w); if (cl) chk('label-row', name(ctl), near(ll.base, cl.base), 'the label\'s baseline is ' + f(ll.base - cl.base) + 'px off the control\'s words'); }
    if (ctl || sw) chk('label-size', name(sw || ctl), parseFloat(getComputedStyle(lab).fontSize) === 13, 'the label is ' + getComputedStyle(lab).fontSize + ', not 13px');
  }
  // shared left and right lines: cards that stand in one row start on the window's left line and end on its right line
  if (cards.length) {
    const L = Math.min(...cards.map(c => R(c).left)), Rt = Math.max(...cards.map(c => R(c).right)), ps = getComputedStyle(pane), pr = R(pane);
    const wl = pr.left + parseFloat(ps.borderLeftWidth) + parseFloat(ps.paddingLeft), wr = pr.right - parseFloat(ps.borderRightWidth) - parseFloat(ps.paddingRight);
    chk('left-line', name(pane), near(L, wl), 'the cards start at ' + f(L) + ', the tool window\'s left line is ' + f(wl));
    chk('right-line', name(pane), near(Rt, wr), 'the cards end at ' + f(Rt) + ', the tool window\'s right line is ' + f(wr));
    const lap = (a, b) => Math.min(R(a).bottom, R(b).bottom) - Math.max(R(a).top, R(b).top) > 1;
    for (const c of cards) {
      const hasLeft = cards.some(o => o !== c && R(o).right <= R(c).left + 0.5 && lap(o, c)), hasRight = cards.some(o => o !== c && R(o).left >= R(c).right - 0.5 && lap(o, c));
      chk('left-line', name(c), hasLeft || near(R(c).left, L), 'starts ' + f(R(c).left - L) + 'px off the shared left line'); chk('right-line', name(c), hasRight || near(R(c).right, Rt), 'ends ' + f(R(c).right - Rt) + 'px off the shared right line'); }
  }
  // the tool window's one left and one right line: the tool's name and buttons in the head (the status bar's content starts on the left line) sit on the same lines as the cards
  if (cards.length) { const L = Math.min(...cards.map(c => R(c).left)), Rt = Math.max(...cards.map(c => R(c).right)), head = document.querySelector(SEL.head), stat = document.querySelector('.ae-stat');
    if (head && mk.shown(head)) { const kids = [...head.children].filter(e => mk.shown(e)), first = kids[0], last = kids[kids.length - 1];
      if (first) chk('left-line', 'head', near(R(first).left, L), 'the tool\'s name starts at ' + f(R(first).left) + ', the cards\' left line is ' + f(L));
      if (last) chk('right-line', 'head', near(R(last).right, Rt), 'the tool\'s buttons end at ' + f(R(last).right) + ', the cards\' right line is ' + f(Rt)); }
    if (stat && mk.shown(stat)) { const kids = [...stat.children].filter(e => mk.shown(e)), first = kids[0], last = kids[kids.length - 1];
      if (first) chk('left-line', 'status', near(R(first).left, L), 'the status text starts at ' + f(R(first).left) + ', the cards\' left line is ' + f(L));
      /* the status line holds only what runs, on the left: nothing sits at its right end */ } }
  // scrolling
  chk('clipped', name(pane) + '.sideways', pane.scrollWidth - pane.clientWidth <= 1, 'the tool scrolls sideways by ' + (pane.scrollWidth - pane.clientWidth) + 'px');
  if (ctx.main) { const pb = document.querySelector(SEL.body), dlg = document.querySelector('#audioDlg .dlg'), de = document.documentElement;
    chk('scroll', 'tool-body', pb.scrollHeight - pb.clientHeight <= 1, 'the tool body scrolls by ' + (pb.scrollHeight - pb.clientHeight) + 'px');
    chk('scroll', 'dialog', dlg.scrollHeight - dlg.clientHeight <= 1 && dlg.scrollWidth - dlg.clientWidth <= 1, 'the dialog scrolls by ' + (dlg.scrollHeight - dlg.clientHeight) + 'px down and ' + (dlg.scrollWidth - dlg.clientWidth) + 'px across');
    chk('scroll', 'page', de.scrollHeight - innerHeight <= 1 && de.scrollWidth - innerWidth <= 1, 'the page scrolls'); }
  // the tool grid's own rules (a pane laid out on .tool-grid)
  for (const g of pane.querySelectorAll('.tool-grid')) {
    const gs = getComputedStyle(g), colGap = parseFloat(gs.columnGap), rowGap = parseFloat(gs.rowGap), gc = [...g.querySelectorAll(':scope > .ae-card, :scope > .tool-group > .ae-card, :scope > .card-fold > * > .ae-card, :scope > .tool-group > .card-fold > * > .ae-card')].filter(c => mk.shown(c));          // a card inside a fold (.card-fold) is a card of the grid while it shows
    const box = c => { const cs = getComputedStyle(c); return { ...inner(c), pad: cs.padding, sub: cs.gridTemplateRows.indexOf('subgrid') === 0 }; };
    const parts = c => [...c.children].filter(e => mk.shown(e) && getComputedStyle(e).position !== 'absolute' && !e.matches('.tip'));
    const hbase = c => { const h = c.querySelector('h4'), l = h && mk.letters(h); return l ? l.base : null; };
    // A column of cards stacked in a group (Width over Balance) stands in its row as one unit beside a taller card: the unit keeps the row rules, and inside it every card spans the column and the cards are the grid's row gap apart.
    const cols = [...g.querySelectorAll(':scope > .tool-group')].map(grp => gc.filter(c => grp.contains(c)).sort((a, b) => R(a).top - R(b).top)).filter(cs => cs.length > 1 && cs.every(c => near(R(c).left, R(cs[0]).left) && near(R(c).right, R(cs[0]).right)));
    for (const cs of cols) for (let k = 1; k < cs.length; k++) { const d = R(cs[k]).top - R(cs[k - 1]).bottom; chk('row-gap', name(cs[k]) + '.above', near(d, rowGap), 'is ' + f(d) + 'px under the card above it, not ' + rowGap); }
    const colOf = c => cols.find(cs => cs.includes(c)), unitOf = c => colOf(c) ? colOf(c)[0] : c;
    const UR = u => { const cs = colOf(u); if (!cs) return R(u); const rs = cs.map(R); return { left: Math.min(...rs.map(q => q.left)), right: Math.max(...rs.map(q => q.right)), top: Math.min(...rs.map(q => q.top)), bottom: Math.max(...rs.map(q => q.bottom)) }; };
    const units = gc.filter(c => unitOf(c) === c);
    const rows = []; for (const c of [...units].sort((a, b) => UR(a).top - UR(b).top || UR(a).left - UR(b).left)) { const rw = rows.find(w => UR(w[0]).top < UR(c).bottom - 1 && UR(c).top < UR(w[0]).bottom - 1); if (rw) rw.push(c); else rows.push([c]); }
    rows.forEach((rw, i) => {
      rw.sort((a, b) => UR(a).left - UR(b).left); const a = rw[0], z = rw[rw.length - 1];
      for (const u of rw) for (const c of colOf(u) || []) { chk('grid-edge', name(c) + '.left', a !== u || near(R(c).left, R(g).left), 'does not start at the grid\'s left edge'); chk('grid-edge', name(c) + '.right', z !== u || near(R(c).right, R(g).right), 'does not end at the grid\'s right edge'); }
      chk('grid-edge', name(a) + '.left', near(UR(a).left, R(g).left), 'does not start at the grid\'s left edge'); chk('grid-edge', name(z) + '.right', near(UR(z).right, R(g).right), 'does not end at the grid\'s right edge');
      for (const c of rw.slice(1)) {
        chk('row-top', name(c), near(UR(c).top, UR(a).top), 'starts ' + f(UR(c).top - UR(a).top) + 'px off ' + name(a)); chk('row-bottom', name(c), near(UR(c).bottom, UR(a).bottom), 'ends ' + f(UR(c).bottom - UR(a).bottom) + 'px off ' + name(a));
        const la = hbase(a), lc = hbase(c); if (la != null && lc != null) chk('row-heading', name(c), near(la, lc, 1), 'its heading is ' + f(lc - la) + 'px from the heading of ' + name(a));
        if (!colOf(a) && !colOf(c) && box(a).sub && box(c).sub) { const pa = parts(a)[1], pc = parts(c)[1], top = e => { const l = !e.children.length && e.textContent.trim() ? mk.letters(e) : null; return l ? l.capTop : R(e).top; }; if (pa && pc) chk('row-body', name(c), near(top(pa), top(pc)), 'its body starts ' + f(top(pc) - top(pa)) + 'px from the body of ' + name(a)); } }          // a text part starts where its letters do (its box carries the font's leading in a browser that cannot trim text)
      for (let k = 1; k < rw.length; k++) chk('row-gap', name(rw[k - 1]) + '|' + name(rw[k]), near(UR(rw[k]).left - UR(rw[k - 1]).right, colGap), 'are ' + f(UR(rw[k]).left - UR(rw[k - 1]).right) + 'px apart, not ' + colGap);
      if (i) { const d = UR(a).top - Math.max(...rows[i - 1].map(c => UR(c).bottom)); chk('row-gap', name(a) + '.above', near(d, rowGap), 'is ' + f(d) + 'px under the row above, not ' + rowGap); } });
    if (gc.length) { const side = c => { const cs = getComputedStyle(c); return [cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '); }, sides = side(gc[0]), headed = c => { const h = c.querySelector(':scope > .t-head, :scope > h4'); return !!h && mk.shown(h); };
      for (const c of gc) { const b = box(c), ps = parts(c), top = tok('--gap-set') + (headed(c) ? tok('--gap-head') : 0), want = top + 'px ' + sides; chk('card-padding', name(c), parseFloat(getComputedStyle(c).paddingTop) === top && side(c) === sides, 'has padding ' + b.pad + ', not ' + want + ' (the top is ' + tok('--gap-set') + 'px, and ' + (tok('--gap-set') + tok('--gap-head')) + 'px under a heading row; the sides and bottom are the first card\'s)'); if (!ps.length) continue;
        // a picture may run edge to edge instead (the EQ graph): exactly on the card's border lines, both sides, and, as the last part, to the bottom border
        const cs = getComputedStyle(c), cr = R(c), bl = cr.left + parseFloat(cs.borderLeftWidth), br = cr.right - parseFloat(cs.borderRightWidth), bleeds = e => !!(e.matches('canvas') || e.querySelector(':scope > canvas')) && !e.querySelector('.btn, .seg, select, input') && near(R(e).left, bl) && near(R(e).right, br);
        for (const e of ps) { const r = R(e); chk('part-edge', name(c) + '>' + name(e), (near(r.left, b.l) && near(r.right, b.r)) || bleeds(e), 'runs ' + f(r.left - b.l) + ' and ' + f(r.right - b.r) + 'px off the card\'s edges'); }
        chk('first-part', name(c), near(R(ps[0]).top, b.t), 'the first part starts ' + f(R(ps[0]).top - b.t) + 'px off the top content edge');
        const lp = ps.reduce((x, e) => R(e).bottom > R(x).bottom ? e : x), last = R(lp).bottom; chk('last-part', name(c), near(last, b.b) || (bleeds(lp) && near(last, b.bb)), 'the last part ends ' + f(last - b.b) + 'px off the bottom content edge'); } }
    for (const rw of g.querySelectorAll('.lv-loud, .lv-target')) { if (!mk.shown(rw)) continue; const cs = [...rw.querySelectorAll('select, input[type=number]')].filter(e => mk.shown(e)).filter((e, i, all) => all.every(o => R(o).top < R(e).bottom && R(e).top < R(o).bottom));
      for (const e of cs.slice(1)) { const a = R(cs[0]), r = R(e); chk('row-controls', name(e), near(a.height, r.height) && near(a.top, r.top), 'is ' + f(r.height) + 'px tall at ' + f(r.top) + ', #' + cs[0].id + ' is ' + f(a.height) + 'px at ' + f(a.top)); } }
  }
  return out;
};
