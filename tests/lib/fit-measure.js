// Shared by the fit sweeps (audio-editor-layout.js, pdf-editor-fit.js): the in-page measurement, run in the browser with p.evaluate(fitMeasure, { card, body, root }).
// It lists the cards on show with their boxes, the cards that pass the body, and the content that passes its card's padding box.
// Content that is not on show (a shut fold, a hidden or inert part, a tooltip, nothing drawn) is skipped.
exports.fitMeasure = function ({ card: cardSel, body: bodySel, root: rootSel }) {
  const root = document.querySelector(rootSel), body = document.querySelector(bodySel), br = body.getBoundingClientRect(), out = { cards: [], pass: [], body: [] };
  const skip = 'canvas, svg, svg *, option, .lv-hold, .lv-orig, .lv-fill, .lv-zone, .lv-ceil, .mt-spin, .tip, .im-view.off, .sr-only';
  const shown = (e, top) => { for (let n = e; n; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || n.inert || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (n.matches('.fa:not(.open)>.fa-in, .eq-fold.shut, .im-view.off')) return false; if (n === top) break; } return true; };
  root.querySelectorAll(cardSel).forEach(card => {
    if (!shown(card, card)) return; const cr = card.getBoundingClientRect(), cs = getComputedStyle(card), id = card.id || card.className.split(' ').slice(0, 2).join('.');
    if (cr.width < 2 || cr.height < 2) return;
    out.cards.push({ id, h: +cr.height.toFixed(1), top: +cr.top.toFixed(1), bottom: +cr.bottom.toFixed(1), left: +cr.left.toFixed(1) });
    if (cr.top < br.top - 0.5 || cr.bottom > br.bottom + 0.5 || cr.left < br.left - 0.5 || cr.right > br.right + 0.5) out.body.push(id + ' top ' + (cr.top - br.top).toFixed(1) + ' bottom ' + (br.bottom - cr.bottom).toFixed(1));
    const pb = { l: cr.left + parseFloat(cs.borderLeftWidth), r: cr.right - parseFloat(cs.borderRightWidth), t: cr.top + parseFloat(cs.borderTopWidth), b: cr.bottom - parseFloat(cs.borderBottomWidth) };
    card.querySelectorAll('*').forEach(e => {
      if (e.matches(skip)) return;
      const text = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()), leaf = !e.children.length || e.matches('input, select, button, output');
      if (!(text || leaf) || !shown(e, card)) return;
      const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
      if (r.left < pb.l - 0.5 || r.right > pb.r + 0.5 || r.top < pb.t - 0.5 || r.bottom > pb.b + 0.5)
        out.pass.push(id + ' > ' + (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')) + ' (' + (e.textContent || '').trim().slice(0, 14) + ') out by L/R/T/B ' + [pb.l - r.left, r.right - pb.r, pb.t - r.top, r.bottom - pb.b].map(v => v.toFixed(1)).join('/'));
    });
  });
  return out;
};
