// The one measuring helper every layout check uses (audio-editor-grid-lines.js, audio-editor-layout.js), proved against a screenshot's pixels by audio-editor-measure.js.
// Run it in the page: await p.evaluate(install); it sets window.__mk, and later p.evaluate calls read it. Nothing here names a card or a tool.
//   __mk.letters(el)   the letters of the first line of el's own text: { capTop, base, left, right } (page y, and x of the text's advance box)
//   __mk.thumb(input)  a slider's thumb: the input's center line plus and minus 9px (the thumb with its ring): { top, bottom, cx, left, right }
//   __mk.box(el)       a button's or choice's border box: { top, bottom, left, right }
//   __mk.ink(el)       what a person sees of el: the thumb of a slider, the border box of a control (or a canvas, an image, a bar), else its letters
//   __mk.inkOf(root, skip)  the top and bottom of everything visible in root (skip is a function that leaves out parts)
//   __mk.shown(el)     true when el is on screen (not hidden, inert, transparent, or in a shut fold)
// Letter edges come from font metrics, never from a marker element put into the text (inside a flex box a marker becomes its own box and reports the box's top, not the text's baseline):
//   baseline = the top of the text's inline box (its line box top, as the browser lays it out) + the font's ascent (canvas fontBoundingBoxAscent, from the text's computed font)
//   cap top  = baseline - the cap height (canvas actualBoundingBoxAscent of "H")
exports.install = function () {
  const R = e => e.getBoundingClientRect(), cv = document.createElement('canvas').getContext('2d'), THUMB = 9;
  const shown = (e, top) => {
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (n.hidden || n.inert || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
      if (n.matches('.fa:not(.open)>.fa-in, .eq-fold.shut, .im-view.off, .line-fold:not(.open)>.fa-in')) return false;
      if (n === top) break;
    }
    if (getComputedStyle(e).display === 'contents') return true;          // a wrapper with no box of its own is shown when what it holds is
    const r = R(e); return r.width > 0 && r.height > 0;
  };
  const metrics = (el, ch) => { const cs = getComputedStyle(el); cv.font = [cs.fontStyle, cs.fontWeight, cs.fontSize, cs.fontFamily].join(' '); cv.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing; return cv.measureText(ch); };
  const textNodes = el => { const out = [], walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) { if (c.textContent.trim()) out.push(c); } else if (c.nodeType === 1 && !c.matches('svg, canvas, .tip, .sr-only, [aria-hidden=true]') && shown(c)) walk(c); } }; walk(el); return out; };
  // the letters of the first line of an element's own text (its direct text first; a text inside a child only when there is none)
  const letters = el => {
    const direct = [...el.childNodes].filter(c => c.nodeType === 3 && c.textContent.trim()), nodes = direct.length ? direct : textNodes(el);
    if (!nodes.length) return null;
    const node = nodes[0], rg = document.createRange(); rg.selectNodeContents(node);
    const rects = [...rg.getClientRects()].filter(r => r.width > 0), first = rects[0] || R(node.parentElement), host = node.parentElement;
    const asc = metrics(host, 'H').fontBoundingBoxAscent, cap = metrics(host, 'H').actualBoundingBoxAscent;
    const base = first.top + asc;
    return { capTop: base - cap, base, left: first.left, right: first.right, el: host };
  };
  const thumb = input => { const r = R(input), cy = (r.top + r.bottom) / 2, w = parseFloat(getComputedStyle(input, '::-webkit-slider-thumb').width) || 16, v = (input.value - (input.min || 0)) / ((input.max || 100) - (input.min || 0));
    const cx = r.left + w / 2 + v * (r.width - w); return { top: cy - THUMB, bottom: cy + THUMB, cx, left: cx - THUMB, right: cx + THUMB }; };
  const box = el => { const r = R(el); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
  // a button with a border or a fill is a control; a button with neither is only its letters (a scale label)
  const chrome = el => { const cs = getComputedStyle(el); return ['Top', 'Left', 'Bottom', 'Right'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none' && !/rgba?\(\s*0,\s*0,\s*0,\s*0\)/.test(cs['border' + s + 'Color'])) || (!/rgba\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(cs.backgroundColor)) || cs.backgroundImage !== 'none'; };
  const isControl = el => el.matches('.seg, select, input:not([type=range]):not([type=hidden]), .switch, canvas, img, svg') || (el.matches('button, .btn') && chrome(el));
  const ink = el => {
    if (el.matches('input[type=range]')) { const t = thumb(el); return { top: t.top, bottom: t.bottom, left: t.left, right: t.right, kind: 'thumb' }; }
    if (isControl(el)) return { ...box(el), kind: 'box' };
    const l = letters(el); return l ? { top: l.capTop, bottom: l.base, left: l.left, right: l.right, kind: 'letters' } : null;
  };
  const filled = el => { const cs = getComputedStyle(el); return !/rgba\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none'); };
  const SKIP = '.tip, .info-i, .lv-hold, .lv-orig, .lv-fill, .lv-zone, .lv-ceil, .mt-spin, .im-view.off, .sr-only, option, script, style';
  // the top and bottom of everything a person sees in root: letters (cap top to baseline), the border box of a control, a slider's thumb, a bar or picture with a fill or border
  const inkOf = (root, skip) => {
    let top = Infinity, bottom = -Infinity, n = 0, fills = false;
    const take = i => { if (!i) return; top = Math.min(top, i.top); bottom = Math.max(bottom, i.bottom); n++; };
    const walk = e => {
      for (const c of e.children) {
        if (c.matches(SKIP) || (skip && skip(c)) || !shown(c) || (getComputedStyle(c).position === 'absolute' && e === root)) continue;          // a part laid over the whole root (a progress bar) is not seen as part of it; a label placed inside a part (a scale's numbers) is
        if (c.matches('input[type=range]') || isControl(c)) { if (c.matches('canvas')) fills = true; take(ink(c)); continue; }
        const direct = [...c.childNodes].some(x => x.nodeType === 3 && x.textContent.trim()), before = n;
        if (direct) take(ink(c));
        if (direct && !isControl(c) && c.children.length === 0 && filled(c)) take(box(c));          // a text on a fill or a border of its own (a step's number in its circle, a chip) is seen as that shape
        if (c.children.length) walk(c);
        if (n === before) { const cs = getComputedStyle(c); if (R(c).width >= 1 && R(c).height >= 1 && (!/rgba\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || parseFloat(cs.borderTopWidth) > 0)) take(box(c)); }          // a bar or a picture with a fill or a border (a track whose parts are left out above is still the bar)
      }
    };
    walk(root);
    return n ? { top, bottom, n, fills } : null;
  };
  window.__mk = { R, shown, letters, thumb, box, ink, inkOf, isControl, chrome, SKIP, THUMB };
};
