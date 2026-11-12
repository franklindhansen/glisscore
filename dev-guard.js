// Development only: loaded by index.html on localhost and never uploaded (it is not in deploy.sh's list).
/* UI guard (localhost only): reports a button that breaks the design language. A button is one of the control heights (--h-xs, --h-s, --h-m, --h-l), never taller than one line of its own text,
   keeps its width while it shows progress, is a whole number of pixels tall, and is no wider than its text unless a minimum width holds it on purpose. A card's content stays inside the card's padding box
   (reported only when it stays outside for a moment, so a fold that is still gliding open is not reported). Reports are page errors, so every check that watches for them sees them. */
window.uiGuard = (() => {
  const seen = new Set(), name = b => b.id ? '#' + b.id : (b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 24);
  function scan() {
    const out = [];
    document.querySelectorAll('.btn').forEach(b => {
      if (!b.offsetParent) return; const cs = getComputedStyle(b), w = b.offsetWidth, h = b.offsetHeight; if (!w || !h || cs.visibility === 'hidden') return;          // a button that is not shown breaks nothing
      const pad = k => parseFloat(cs['padding' + k]) + parseFloat(cs['border' + k + 'Width']), one = Math.max(Math.max(parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3, b.querySelector('svg') ? 16 : 0) + pad('Top') + pad('Bottom'), parseFloat(cs.minHeight) || 0);          // a minimum height is the size class's own height
      const scale = ['--h-xs', '--h-s', '--h-m', '--h-l'].map(v => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(v)));
      if (b.textContent.trim() && !b.matches('.panel .btn.primary, .eq-lbl-r .btn, .fs-only') && !scale.some(v => Math.abs((b.parentElement.matches('.btn-group') ? b.parentElement.offsetHeight : h) - v) < 0.6)) out.push([b, 'height', name(b) + ' is ' + h + 'px tall, which is not one of the control heights (' + scale.join(', ') + 'px)']);
      if (b.textContent.trim() && h > one * 1.5 + 2) out.push([b, 'tall', name(b) + ' is ' + h + 'px tall, but one line of its text is ' + Math.round(one) + 'px']);
      if (b.classList.contains('loading')) { if (b._gw != null && Math.abs(w - b._gw) > 0.5) out.push([b, 'width', name(b) + ' changed width from ' + b._gw + 'px to ' + w + 'px while showing progress']); b._gw = w; } else b._gw = null;
      if (!b.classList.contains('loading') && !(parseFloat(cs.minWidth) > 0) && !b.style.width && !(b.parentElement && w >= b.parentElement.clientWidth * 0.9)) {          // a button that fills its row is full width on purpose
        const r = document.createRange(); r.selectNodeContents(b); const inner = r.getBoundingClientRect().width / ((b.getBoundingClientRect().width / w) || 1), extra = (w - inner) / 2 - pad('Left');
        if (inner > 0 && extra > 4 && cs.flexGrow === '0' && b.parentElement && getComputedStyle(b.parentElement).display !== 'grid') out.push([b, 'inset', name(b) + ' has ' + Math.round(extra) + 'px more space beside its text than its padding allows']);
      }
    });
    document.querySelectorAll('.btn, .btn-group, .chip, .seg label, .pe-tab, .ae-tool, select').forEach(b => {          // a control is a whole number of pixels tall: on a half pixel its text sits up to a pixel off center (a line height is a whole number too: set --lh, not line-height)
      if (!b.offsetParent || getComputedStyle(b).visibility === 'hidden') return; const h = parseFloat(getComputedStyle(b).height);
      if (h > 0 && Math.abs(h - Math.round(h)) > 0.03) out.push([b, 'pixel', name(b) + ' is ' + h.toFixed(2) + 'px tall: a control is a whole number of pixels, or its text sits off center']);
    });
    document.querySelectorAll('.ae-card').forEach(card => {          // a card's content passes its padding box: the card was asked to shrink below what it holds
      const cr = card.getBoundingClientRect(); if (cr.width < 2 || cr.height < 2) return; for (let n = card; n; n = n.parentElement) { const c = getComputedStyle(n); if (n.hidden || n.inert || c.display === 'none' || c.visibility === 'hidden' || (n !== card && n.matches('.fa:not(.open)>.fa-in, .eq-fold.shut'))) return; }
      if (card.closest('#audioDlg.afull') || card.closest('.ae-pane[hidden]')) return;          // full screen scrolls its own window
      const cs = getComputedStyle(card), pb = { l: cr.left + parseFloat(cs.borderLeftWidth), r: cr.right - parseFloat(cs.borderRightWidth), t: cr.top + parseFloat(cs.borderTopWidth), b: cr.bottom - parseFloat(cs.borderBottomWidth) };
      for (const e of card.querySelectorAll('*')) {
        if (e.matches('canvas, svg, svg *, option, .tip, .lv-hold, .lv-orig, .lv-fill, .lv-zone, .lv-ceil, .mt-spin, .im-view.off')) continue;
        const text = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); if (!(text || !e.children.length || e.matches('input, select, button, output'))) continue;
        const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue; let hid = false; for (let n = e; n && n !== card; n = n.parentElement) { const c = getComputedStyle(n); if (c.transform !== 'none' || (n.getAnimations && n.getAnimations().length)) { hid = true; break; } if (n.hidden || n.inert || c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05 || n.matches('.fa:not(.open)>.fa-in, .eq-fold.shut')) { hid = true; break; } } if (hid) continue;
        if (r.left < pb.l - 0.5 || r.right > pb.r + 0.5 || r.top < pb.t - 0.5 || r.bottom > pb.b + 0.5) { out.push([card, 'card', 'the card ' + (card.id ? '#' + card.id : card.className) + ' is cut: ' + (e.id ? '#' + e.id : (e.textContent || e.tagName).trim().slice(0, 24)) + ' passes its padding box']); break; }
      }
    });
    return out;
  }
  const firstSeen = new Map();
  const on = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (on) { let t = 0; const run = () => { t = 0; const items = scan(), found = new Set(items.map(([, k, m]) => k + m)); items.forEach(([b, k, msg]) => { const key = k + msg; if (k === 'card') { const now = performance.now(), t0 = firstSeen.get(key); if (t0 == null) { firstSeen.set(key, now); setTimeout(run, 800); return; } if (now - t0 < 700) return; } if (!seen.has(key)) { seen.add(key); reportError(new Error('UI guard: ' + msg)); } }); [...firstSeen.keys()].forEach(k => { if (!found.has(k)) firstSeen.delete(k); }); }, later = () => { if (!t) t = setTimeout(run, 300); };
    new MutationObserver(later).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] }); window.addEventListener('resize', later); document.addEventListener('fullscreenchange', later); }
  return { scan };
})();
