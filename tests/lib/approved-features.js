// The features of a tool window that the approved pictures are compared on, read from the page (run it in the page after p.evaluate(install) from tests/lib/measure.js):
//   const f = await p.evaluate(features)   ->  [{ key, kind, y, x0, x1 }, ...]   y is the row, from the top of the dialog's border box
//   head:<TEXT>     the heading's letters (cap top) of a card; its x range is the letters' width
//   ctl:<TEXT>      the top of a choice or button on that heading's row (its border box); x range is its width
//   scale:<card>    the cap top of the numbers or end labels under the card's slider or bar; x range is the first label's width
//   frame-top:<card>, frame-bottom:<card>   the Fades picture's frame lines (the row of each line), read from the canvas's pixels
//   steps:<card>    the middle of the buttons on a card's row of steps (Noise sample's Select row): the middle of the lowest top and the highest bottom
//   last:<card>     the bottom of the lowest ink in a card (its last line)
//   gap:<card>      the distance from a slider's thumb (or a bar's bottom) to the first number or label under it, with the distance it must be in `want`
//   top:<card>, bottom:<card>   a card's border box top and bottom
// Nothing here names a tool: every card in the tool pane on show is read, so a new card is covered when it exists.
exports.features = function () {
  const mk = window.__mk, R = mk.R, dlg = R(document.querySelector('#audioDlg .dlg')), out = [], y = v => Math.round((v - dlg.top) * 100) / 100, x = v => Math.round((v - dlg.left) * 100) / 100;
  const pane = document.querySelector('.ae-pane:not([hidden])');
  const cards = [...pane.querySelectorAll('.ae-card')].filter(c => mk.shown(c) && !c.parentElement.closest('.ae-card'));
  for (const c of cards) {
    const id = c.id || c.className.trim().split(/\s+/).slice(0, 3).join('.'), cr = R(c);
    out.push({ key: 'top:' + id, kind: 'top', card: id, y: y(cr.top), x0: x(cr.left), x1: x(cr.right) }, { key: 'bottom:' + id, kind: 'bottom', card: id, y: y(cr.bottom), x0: x(cr.left), x1: x(cr.right) });
    const h = c.querySelector(':scope > .t-head h4, :scope > h4'); if (h && mk.shown(h)) {
      const l = mk.letters(h), name = h.textContent.trim().toUpperCase(); out.push({ key: 'head:' + name, kind: 'head', card: id, y: y(l.capTop), x0: x(l.left), x1: x(l.right) });
      const mid = (l.capTop + l.base) / 2, ctl = [...c.querySelectorAll('.btn, .seg, select')].find(e => mk.shown(e) && !e.closest('.foot-row, .sp-list') && !e.parentElement.closest('.seg') && Math.abs((R(e).top + R(e).bottom) / 2 - mid) <= 20);
      if (ctl) out.push({ key: 'ctl:' + name, kind: 'ctl', card: id, y: y(R(ctl).top), x0: x(R(ctl).left), x1: x(R(ctl).right) });
    }
    const st = c.querySelector(':scope > .mt-steps'); if (st && mk.shown(st)) {          // a row of steps: the middle of its buttons
      const bs = [...st.querySelectorAll('.btn')].filter(e => mk.shown(e)).map(R); if (bs.length) out.push({ key: 'steps:' + id, kind: 'steps', card: id, y: y((Math.min(...bs.map(r => r.top)) + Math.max(...bs.map(r => r.bottom))) / 2) });
    }
    const ink = mk.inkOf(c, e => e.matches('.t-head')); if (ink) out.push({ key: 'last:' + id, kind: 'last', card: id, y: y(ink.bottom) });          // the card's last line: the bottom of its lowest ink
    const cv = c.querySelector('#aeFadeCv'); if (cv && mk.shown(cv)) {          // the Fades picture's frame: its top and bottom lines, read from the canvas's own pixels at its left edge, where the curves do not reach
      const g = cv.getContext('2d'), px = g.getImageData(3, 0, 1, cv.height).data, rows = []; for (let r = 0; r < cv.height; r++) if (px[r * 4 + 3] > 0) rows.push(r);
      if (rows.length >= 2) { const k = R(cv); out.push({ key: 'frame-top:' + id, kind: 'frame', card: id, y: y(k.top + rows[0]), x0: x(k.left), x1: x(k.right) }, { key: 'frame-bottom:' + id, kind: 'frame', card: id, y: y(k.top + rows[rows.length - 1]), x0: x(k.left), x1: x(k.right) }); }
    }
    const sc = c.querySelector('.sl-ends, .lv-scale'); if (sc && mk.shown(sc)) {
      const labs = [...sc.children].filter(e => mk.shown(e)), ls = labs.map(e => mk.letters(e)).filter(Boolean);
      const top = ls.length ? Math.min(...ls.map(l => l.capTop)) : null, host = sc.parentElement, sl = host.querySelector('input[type=range]'), bar = host.querySelector('.lv-track');
      if (ls.length && sl && sc.matches('.sl-ends')) out.push({ key: 'gap:' + id, kind: 'gap', want: 12, y: Math.round((top - mk.thumb(sl).bottom) * 100) / 100 });          // the numbers start --gap-set under the slider's thumb
      if (ls.length && bar && sc.matches('.lv-scale')) out.push({ key: 'gap:' + id, kind: 'gap', want: 8, y: Math.round((top - R(bar).bottom) * 100) / 100 });          // and --gap-head under a bar
      if (ls.length) out.push({ key: 'scale:' + id, kind: 'scale', card: id, y: y(Math.min(...ls.map(l => l.capTop))), x0: x(ls[0].left), x1: x(ls[0].right) });
    }
  }
  return out;
};
