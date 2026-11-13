// Shared by tests/text-spacing.js: the in-page scan of one screen. It reads the gaps and sizes of every title block, subtitle, label, note, and heading on show and returns what breaks the spacing rules.
// The roles are classes: .t-block (title, then .t-sub), .t-sub (subtitle), .t-note (note), .t-head (heading of a card or group); a label is a .t-lbl or the label / .lbl of a .field.
exports.textScan = function (where) {
  const root = getComputedStyle(document.documentElement), tok = n => parseFloat(root.getPropertyValue(n)), T = { sub: tok('--gap-sub'), label: tok('--gap-label'), head: tok('--gap-head'), set: tok('--gap-set'), field: tok('--gap-field') };
  const bad = [], n = { block: 0, sub: 0, note: 0, label: 0, head: 0, set: 0 }, near = (a, b, e = 0.6) => Math.abs(a - b) <= e, frac = v => Math.abs(v - Math.round(v)) > 0.03;
  const name = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ' "' + (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18) + '"';
  const shown = e => { if (!e.isConnected) return false; for (let x = e; x && x !== document.documentElement; x = x.parentElement) { const s = getComputedStyle(x); if (x.hidden || x.inert || s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; if (x.matches('.fa:not(.open)>.fa-in, .eq-fold.shut, .line-fold:not(.open)>.fa-in, .im-view.off, [aria-hidden=true]:not(svg)')) return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const prevEl = e => { let p = e.previousElementSibling; while (p && !shown(p)) p = p.previousElementSibling; return p; };
  const nextEl = e => { let p = e.nextElementSibling; while (p && !shown(p)) p = p.nextElementSibling; return p; };
  const below = (a, b) => b.top >= a.bottom - 0.5 && b.left < a.right && b.right > a.left;          // b sits under a
  const mg = (e, k) => e.matches('input[type=range], .eq-lbl') ? Math.min(0, parseFloat(getComputedStyle(e)[k]) || 0) : 0;          // a slider and a label whose box is trimmed to what is drawn (by a negative margin) are measured to the edge of what is drawn: the box less its negative margin
  const gap = (a, b, want, what, e, tol) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); if (!below(ra, rb)) return false; const g = (rb.top - mg(b, 'marginTop')) - (ra.bottom + mg(a, 'marginBottom')); if (!near(g, want, tol)) bad.push(where + ': ' + what + ' of ' + name(e) + ' is ' + g.toFixed(2) + 'px, not ' + want + 'px'); return true; };
  // title blocks
  document.querySelectorAll('.t-block').forEach(b => { if (!shown(b)) return; n.block++; const kids = [...b.children].filter(shown), title = kids[0], sub = kids.find(k => k.matches('.t-sub')), br = b.getBoundingClientRect();
    if (frac(br.top) || frac(br.height)) bad.push(where + ': the title block ' + name(b) + ' is on a half pixel (top ' + br.top.toFixed(2) + ', height ' + br.height.toFixed(2) + ')');
    if (!sub) return; gap(title, sub, T.sub, 'the gap from the title to its subtitle', b, 0.05);
    if (b.matches('.tool')) { const tr = title.getBoundingClientRect(), sr = sub.getBoundingClientRect(); if (!near(tr.height, 20, 0.05) || !near(sr.height, 16, 0.05)) bad.push(where + ': the tool head ' + name(b) + ' is ' + tr.height + ' + ' + sr.height + 'px of text lines, not 20 + 16'); }
    else if (b.closest('.hist-top')) { /* the History picker's own title size */ }
    else { const h = title.querySelector('h2, h3') || title, fs = parseFloat(getComputedStyle(h).fontSize); if (h.matches('h2') && fs !== 24) bad.push(where + ': the window title ' + name(h) + ' is ' + fs + 'px, not 24px'); } });
  // subtitles: every one is a .t-sub, 13px on a 16px line
  document.querySelectorAll('.t-sub, .ed-lead, .ae-sub, .pe-sub, .hist-sub, .how-lead').forEach(e => { if (!shown(e)) return; n.sub++; const s = getComputedStyle(e);
    if (!e.matches('.t-sub')) bad.push(where + ': the subtitle ' + name(e) + ' does not use the shared .t-sub');
    else if (parseFloat(s.fontSize) !== 13 || parseFloat(s.lineHeight) !== 16) bad.push(where + ': the subtitle ' + name(e) + ' is ' + s.fontSize + ' / ' + s.lineHeight + ', not 13px / 16px'); });
  // notes: 12px on a 16px line, --gap-label under what they explain, on the same left edge
  document.querySelectorAll('.t-note, .vq-note, .lv-note, .em-note, .bal-say, .em-say, .hint:not(.tl-bar .hint)').forEach(e => { if (!shown(e) || !(e.textContent || '').trim()) return; n.note++; const s = getComputedStyle(e);
    if (!e.matches('.t-note')) { bad.push(where + ': the note ' + name(e) + ' does not use the shared .t-note'); return; }
    if (parseFloat(s.fontSize) !== 12 || parseFloat(s.lineHeight) !== 16) bad.push(where + ': the note ' + name(e) + ' is ' + s.fontSize + ' / ' + s.lineHeight + ', not 12px / 16px');
    const p = prevEl(e); if (p && !e.matches('[data-flow]')) { const ra = p.getBoundingClientRect(), rb = e.getBoundingClientRect(); if (below(ra, rb)) { gap(p, e, T.label, 'the gap from what it explains to the note', e, 0.6); const lead = e.parentElement && [...e.parentElement.children].find(shown); if (lead && !near(lead.getBoundingClientRect().left, rb.left, 0.6)) bad.push(where + ': the note ' + name(e) + ' does not share the left edge of ' + name(lead) + ' (' + lead.getBoundingClientRect().left.toFixed(1) + ' vs ' + rb.left.toFixed(1) + ')'); } } });
  // labels above their controls
  document.querySelectorAll('.field, .eq-cell, .mt-body').forEach(f => { if (!shown(f)) return; const l = [...f.children].find(c => shown(c) && c.matches('label, .lbl, .eq-lbl, .mt-title, .t-lbl')); if (!l || (l.tagName === 'LABEL' && l.matches('.check, .check-row'))) return; const k = nextEl(l); if (!k) return; n.label++;
    const s = getComputedStyle(l); if (parseFloat(s.fontSize) !== 13) bad.push(where + ': the label ' + name(l) + ' is ' + s.fontSize + ', not 13px');
    if (gap(l, k, T.label, 'the gap from the label to its control', l, 0.6)) { const a = l.getBoundingClientRect(), b = k.getBoundingClientRect(); if (!near(a.left, b.left, 0.6)) bad.push(where + ': the label ' + name(l) + ' and its control do not share a left edge (' + a.left.toFixed(1) + ' vs ' + b.left.toFixed(1) + ')'); } });
  // headings of cards and groups
  // Outside an Audio Editor card, the heading to its content is --gap-head. A heading row directly inside an Audio Editor card (.ae-card > .t-head) follows the balanced-body rule instead (the spec's "The balanced body"): the body is centered
  // between the heading row's lowest visible edge and the next line, so the space under the heading row is whatever that leaves, never less than --gap-set. The balance itself is measured by tests/lib/layout-lines.js (body-balance); here the least space is asserted.
  document.querySelectorAll('.t-head').forEach(h => { if (!shown(h)) return; const k = nextEl(h); if (!k) return; n.head++;
    if (h.parentElement.matches('.ae-card')) { const ra = h.getBoundingClientRect(), rb = k.getBoundingClientRect(); if (below(ra, rb) && rb.top - mg(k, 'marginTop') - (ra.bottom + mg(h, 'marginBottom')) < T.set - 0.6) bad.push(where + ': the space under the heading row of ' + name(h) + ' is ' + (rb.top - mg(k, 'marginTop') - (ra.bottom + mg(h, 'marginBottom'))).toFixed(2) + 'px, less than the ' + T.set + 'px a card keeps under it at the least'); return; }
    gap(h, k, T.head, 'the gap from the heading to its content', h, 0.6); });
  // one setting to the next
  document.querySelectorAll('.field').forEach(f => { if (!shown(f)) return; const k = nextEl(f); if (!k || !k.matches('.field') || !below(f.getBoundingClientRect(), k.getBoundingClientRect())) return; if (f.closest('.tag-grid, .tl-bar')) return;
    const want = f.closest('.ae-card, .eq-band, .eq-match, .pe-top') ? T.set : T.field; if (k.matches('.sub, #firstAloneField, #inkField')) return; n.set++; const pv = e => parseFloat(getComputedStyle(e).paddingBottom), pt = e => parseFloat(getComputedStyle(e).paddingTop), g = (k.getBoundingClientRect().top + pt(k)) - (f.getBoundingClientRect().bottom - pv(f)); if (!near(g, want, 0.6)) bad.push(where + ': the gap from ' + name(f) + ' to the next setting is ' + g.toFixed(2) + 'px, not ' + want + 'px'); });
  return { bad, n, T };
};
