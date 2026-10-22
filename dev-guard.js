// Development only: loaded by index.html on localhost and never uploaded (it is not in deploy.sh's list).
/* UI guard (localhost only): reports a button that breaks the design language. A button is never taller than one line of its own text,
   keeps its width while it shows progress, and is no wider than its text unless a minimum width holds it on purpose. Reports are page errors, so every check that watches for them sees them. */
window.uiGuard = (() => {
  const seen = new Set(), name = b => b.id ? '#' + b.id : (b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 24);
  function scan() {
    const out = [];
    document.querySelectorAll('.btn').forEach(b => {
      if (!b.offsetParent) return; const cs = getComputedStyle(b), w = b.offsetWidth, h = b.offsetHeight; if (!w || !h || cs.visibility === 'hidden') return;          // a button that is not shown breaks nothing
      const pad = k => parseFloat(cs['padding' + k]) + parseFloat(cs['border' + k + 'Width']), one = Math.max(Math.max(parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3, b.querySelector('svg') ? 16 : 0) + pad('Top') + pad('Bottom'), parseFloat(cs.minHeight) || 0);          // a minimum height is the size class's own height
      if (b.textContent.trim() && h > one * 1.5 + 2) out.push([b, 'tall', name(b) + ' is ' + h + 'px tall, but one line of its text is ' + Math.round(one) + 'px']);
      if (b.classList.contains('loading')) { if (b._gw != null && Math.abs(w - b._gw) > 0.5) out.push([b, 'width', name(b) + ' changed width from ' + b._gw + 'px to ' + w + 'px while showing progress']); b._gw = w; } else b._gw = null;
      if (!b.classList.contains('loading') && !(parseFloat(cs.minWidth) > 0) && !b.style.width && !(b.parentElement && w >= b.parentElement.clientWidth * 0.9)) {          // a button that fills its row is full width on purpose
        const r = document.createRange(); r.selectNodeContents(b); const inner = r.getBoundingClientRect().width / ((b.getBoundingClientRect().width / w) || 1), extra = (w - inner) / 2 - pad('Left');
        if (inner > 0 && extra > 4 && cs.flexGrow === '0' && b.parentElement && getComputedStyle(b.parentElement).display !== 'grid') out.push([b, 'inset', name(b) + ' has ' + Math.round(extra) + 'px more space beside its text than its padding allows']);
      }
    });
    return out;
  }
  const on = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (on) { let t = 0; const run = () => { t = 0; scan().forEach(([b, k, msg]) => { const key = k + msg; if (!seen.has(key)) { seen.add(key); reportError(new Error('UI guard: ' + msg)); } }); }, later = () => { if (!t) t = setTimeout(run, 300); };
    new MutationObserver(later).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] }); window.addEventListener('resize', later); document.addEventListener('fullscreenchange', later); }
  return { scan };
})();
