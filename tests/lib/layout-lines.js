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
//   scale-gap          the labels under a slider start --gap-set under its thumb, and the numbers under a bar --gap-head under it
//   mid-tick           the middle label of a three-label scale is centered under the thumb at the middle value
//   label-row          a label beside a switch is centered on it; beside a control with words it shares its baseline
//   label-size         ... and it is 13px
//   left-line, right-line   cards that share a row start on the tool window's left line and end on its right line, and so do the tool's name and buttons in the head and the status bar's content
//   picture-border    a picture (canvas or image) in a card has no border of its own
//   clipped            nothing passes its card's padding box, and nothing in the tool scrolls sideways
//   scroll             (main size) the tool body, the dialog, and the page do not scroll
// A pane on the tool grid (.tool-grid) also keeps the grid rules: grid-edge, row-top, row-bottom, row-heading, row-body, row-gap, card-padding, part-edge, first-part, last-part, row-controls.
exports.lines = function (ctx) {
  const mk = window.__mk, R = mk.R, near = (a, b, t = 0.5) => Math.abs(a - b) <= t + 1e-6, f = v => (Math.round(v * 10) / 10).toString();
  const fails = [], out = { n: 0, fails, heights: {} };
  const chk = (rule, el, pass, note) => { out.n++; if (!pass) fails.push([rule, el, note]); };
  const name = e => e.id ? e.id : (typeof e.className === 'string' && e.className.trim() ? e.className.trim().split(/\s+/).slice(0, 3).join('.') : e.tagName.toLowerCase());
  const root = getComputedStyle(document.documentElement), tok = k => parseFloat(root.getPropertyValue(k));
  const pane = document.querySelector('.ae-pane:not([hidden])');
  const cards = [...pane.querySelectorAll('.ae-card')].filter(c => mk.shown(c) && !c.parentElement.closest('.ae-card'));
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
      headBottom = Math.max(hl.base, ...[...row.querySelectorAll('.btn, .seg, select')].filter(e => mk.shown(e) && !e.parentElement.closest('.seg')).map(e => R(e).bottom));          // the row's lowest visible edge: a choice or button that wrapped onto the row's second line counts too
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
      if (body) { const above = body.top - (headBottom != null ? headBottom : ci.bt), line = foot ? foot.top : ci.bb, below = line - body.bottom;
        chk('body-balance', cn, near(above, below) && Math.min(above, below) >= tok('--gap-set') - 0.5, 'space above the body ' + f(above) + 'px, below ' + f(below) + 'px; at least ' + tok('--gap-set') + 'px on each side'); }
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
  const setGap = tok('--gap-set'), headGap = tok('--gap-head');
  for (const sc of pane.querySelectorAll('.sl-ends, .lv-scale')) {
    if (!mk.shown(sc)) continue; const host = sc.parentElement;
    if (sc.matches('.sl-ends')) {
      const sl = host.querySelector('input[type=range]'); if (!sl) continue; const t = mk.thumb(sl), labs = [...sc.children].filter(e => mk.shown(e)), ls = labs.map(e => mk.letters(e)).filter(Boolean); if (!ls.length) continue;
      chk('scale-gap', name(sl), near(Math.min(...ls.map(l => l.capTop)) - t.bottom, setGap), 'the labels start ' + f(Math.min(...ls.map(l => l.capTop)) - t.bottom) + 'px under the slider\'s thumb, not ' + setGap);
      const lo = +sl.min, hi = +sl.max, midV = (lo + hi) / 2, m = labs.find(e => e.dataset.v !== undefined && +e.dataset.v === midV);
      if (m && labs.length === 3) { const w = parseFloat(getComputedStyle(sl, '::-webkit-slider-thumb').width) || 16, r = R(sl), cx = r.left + w / 2 + 0.5 * (r.width - w), ml = mk.letters(m);
        chk('mid-tick', name(sl), ml && near((ml.left + ml.right) / 2, cx), 'the middle label is centered ' + (ml ? f((ml.left + ml.right) / 2 - cx) : '?') + 'px off the thumb at the middle value'); }
    } else {
      const bar = host.querySelector('.lv-track'); if (!bar) continue; const ls = mk.inkOf(sc);
      if (ls) chk('scale-gap', name(bar), near(ls.top - R(bar).bottom, headGap), 'the numbers start ' + f(ls.top - R(bar).bottom) + 'px under the bar, not ' + headGap);
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
  // the tool window's one left and one right line: the tool's name and buttons in the head and the status bar's content sit on the same lines as the cards
  if (cards.length) { const L = Math.min(...cards.map(c => R(c).left)), Rt = Math.max(...cards.map(c => R(c).right)), head = document.querySelector('.ae-phead'), stat = document.querySelector('.ae-stat');
    if (head && mk.shown(head)) { const kids = [...head.children].filter(e => mk.shown(e)), first = kids[0], last = kids[kids.length - 1];
      if (first) chk('left-line', 'head', near(R(first).left, L), 'the tool\'s name starts at ' + f(R(first).left) + ', the cards\' left line is ' + f(L));
      if (last) chk('right-line', 'head', near(R(last).right, Rt), 'the tool\'s buttons end at ' + f(R(last).right) + ', the cards\' right line is ' + f(Rt)); }
    if (stat && mk.shown(stat)) { const kids = [...stat.children].filter(e => mk.shown(e)), first = kids[0], last = kids[kids.length - 1];
      if (first) chk('left-line', 'status', near(R(first).left, L), 'the status text starts at ' + f(R(first).left) + ', the cards\' left line is ' + f(L));
      if (last) chk('right-line', 'status', near(R(last).right, Rt), 'the status text ends at ' + f(R(last).right) + ', the cards\' right line is ' + f(Rt)); } }
  // scrolling
  chk('clipped', name(pane) + '.sideways', pane.scrollWidth - pane.clientWidth <= 1, 'the tool scrolls sideways by ' + (pane.scrollWidth - pane.clientWidth) + 'px');
  if (ctx.main) { const pb = document.querySelector('.ae-pbody'), dlg = document.querySelector('#audioDlg .dlg'), de = document.documentElement;
    chk('scroll', 'tool-body', pb.scrollHeight - pb.clientHeight <= 1, 'the tool body scrolls by ' + (pb.scrollHeight - pb.clientHeight) + 'px');
    chk('scroll', 'dialog', dlg.scrollHeight - dlg.clientHeight <= 1 && dlg.scrollWidth - dlg.clientWidth <= 1, 'the dialog scrolls by ' + (dlg.scrollHeight - dlg.clientHeight) + 'px down and ' + (dlg.scrollWidth - dlg.clientWidth) + 'px across');
    chk('scroll', 'page', de.scrollHeight - innerHeight <= 1 && de.scrollWidth - innerWidth <= 1, 'the page scrolls'); }
  // the tool grid's own rules (a pane laid out on .tool-grid)
  for (const g of pane.querySelectorAll('.tool-grid')) {
    const gs = getComputedStyle(g), colGap = parseFloat(gs.columnGap), rowGap = parseFloat(gs.rowGap), gc = [...g.querySelectorAll(':scope > .ae-card, :scope > .tool-group > .ae-card')].filter(c => mk.shown(c));
    const box = c => { const cs = getComputedStyle(c); return { ...inner(c), pad: cs.padding, sub: cs.gridTemplateRows.indexOf('subgrid') === 0 }; };
    const parts = c => [...c.children].filter(e => mk.shown(e) && getComputedStyle(e).position !== 'absolute' && !e.matches('.tip'));
    const hbase = c => { const h = c.querySelector('h4'), l = h && mk.letters(h); return l ? l.base : null; };
    const rows = []; for (const c of [...gc].sort((a, b) => R(a).top - R(b).top || R(a).left - R(b).left)) { const rw = rows.find(w => R(w[0]).top < R(c).bottom - 1 && R(c).top < R(w[0]).bottom - 1); if (rw) rw.push(c); else rows.push([c]); }
    rows.forEach((rw, i) => {
      rw.sort((a, b) => R(a).left - R(b).left); const a = rw[0], z = rw[rw.length - 1];
      chk('grid-edge', name(a) + '.left', near(R(a).left, R(g).left), 'does not start at the grid\'s left edge'); chk('grid-edge', name(z) + '.right', near(R(z).right, R(g).right), 'does not end at the grid\'s right edge');
      for (const c of rw.slice(1)) {
        chk('row-top', name(c), near(R(c).top, R(a).top), 'starts ' + f(R(c).top - R(a).top) + 'px off ' + name(a)); chk('row-bottom', name(c), near(R(c).bottom, R(a).bottom), 'ends ' + f(R(c).bottom - R(a).bottom) + 'px off ' + name(a));
        const la = hbase(a), lc = hbase(c); if (la != null && lc != null) chk('row-heading', name(c), near(la, lc, 1), 'its heading is ' + f(lc - la) + 'px from the heading of ' + name(a));
        if (box(a).sub && box(c).sub) { const pa = parts(a)[1], pc = parts(c)[1], top = e => { const l = !e.children.length && e.textContent.trim() ? mk.letters(e) : null; return l ? l.capTop : R(e).top; }; if (pa && pc) chk('row-body', name(c), near(top(pa), top(pc)), 'its body starts ' + f(top(pc) - top(pa)) + 'px from the body of ' + name(a)); } }          // a text part starts where its letters do (its box carries the font's leading in a browser that cannot trim text)
      for (let k = 1; k < rw.length; k++) chk('row-gap', name(rw[k - 1]) + '|' + name(rw[k]), near(R(rw[k]).left - R(rw[k - 1]).right, colGap), 'are ' + f(R(rw[k]).left - R(rw[k - 1]).right) + 'px apart, not ' + colGap);
      if (i) { const d = R(a).top - Math.max(...rows[i - 1].map(c => R(c).bottom)); chk('row-gap', name(a) + '.above', near(d, rowGap), 'is ' + f(d) + 'px under the row above, not ' + rowGap); } });
    if (gc.length) { const pad = box(gc[0]).pad;
      for (const c of gc) { const b = box(c), ps = parts(c); chk('card-padding', name(c), b.pad === pad, 'has padding ' + b.pad + ', not ' + pad); if (!ps.length) continue;
        for (const e of ps) { const r = R(e); chk('part-edge', name(c) + '>' + name(e), near(r.left, b.l) && near(r.right, b.r), 'runs ' + f(r.left - b.l) + ' and ' + f(r.right - b.r) + 'px off the card\'s edges'); }
        chk('first-part', name(c), near(R(ps[0]).top, b.t), 'the first part starts ' + f(R(ps[0]).top - b.t) + 'px off the top content edge');
        const last = Math.max(...ps.map(e => R(e).bottom)); chk('last-part', name(c), near(last, b.b), 'the last part ends ' + f(last - b.b) + 'px off the bottom content edge'); } }
    for (const rw of g.querySelectorAll('.lv-loud, .lv-target')) { if (!mk.shown(rw)) continue; const cs = [...rw.querySelectorAll('select, input[type=number]')].filter(e => mk.shown(e)).filter((e, i, all) => all.every(o => R(o).top < R(e).bottom && R(e).top < R(o).bottom));
      for (const e of cs.slice(1)) { const a = R(cs[0]), r = R(e); chk('row-controls', name(e), near(a.height, r.height) && near(a.top, r.top), 'is ' + f(r.height) + 'px tall at ' + f(r.top) + ', #' + cs[0].id + ' is ' + f(a.height) + 'px at ' + f(a.top)); } }
  }
  return out;
};
