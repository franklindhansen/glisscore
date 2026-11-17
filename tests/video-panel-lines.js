// The video settings panel's lines, measured on the page (not read from the style sheet) at the sizes the panel takes: beside the picture (1440x900, 1100x800), under it at tablet width (820x900, 600x900), and on a phone (390x844).
// Every distance is the token it comes from, and the list of known failures is empty:
//   tile       each group is a tile with a line round it, --gap-card from the next; its heading row is as tall as a switch; the whitespace above the heading letters equals the whitespace under the last row (a closed tile is centered on its heading)
//   heading    a group's heading row has --gap-card under it before the first setting
//   label      a label sits --gap-label above its control
//   settings   one setting stands --gap-field from the next
//   note       a note sits --gap-label under the control it explains
//   side       every control stands on the panel's one left line and one right line (a setting that belongs to the one above it stands on the same lines, with no indent or rule line, as the Audio Editor's dependent controls)
//   fades      the Fades group: Apply to, Length (the label with its value, the slider with its end words), Curve (the label, the picture, the choice pinned under the picture, as the Audio Editor's Shape), Fade to
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-panel-lines.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1', FX = process.env.S || 'tests/fixtures';
const SIZES = [[1440, 900], [1100, 800], [820, 900], [600, 900], [390, 844]];
const lines = () => {
  const px = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), R = e => e.getBoundingClientRect();
  const T = { group: px('--gap-group'), card: px('--gap-card'), label: px('--gap-label'), field: px('--gap-field'), head: px('--gap-head'), sw: px('--sw-h') };
  const shown = e => { for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (n.matches('.fa:not(.open)>.fa-in, .line-fold:not(.open)>.fa-in')) return false; } const r = R(e); return r.width > 0 && r.height > 0; };
  const panel = document.querySelector('.panel');
  const bad = [], near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol, name = e => e.id || (e.className && String(e.className).split(' ')[0]) || e.tagName, put = (m, e) => bad.push(m + ' (' + name(e) + ')');
  // tiles: each group is a tile (the card look), --gap-card apart, with the same whitespace above its heading letters as below its last row (or centered on its heading when it is closed)
  const groups = [...panel.querySelectorAll('.group')].filter(shown);
  groups.forEach((g, i) => {
    const r = R(g), cs = getComputedStyle(g), off = g.classList.contains('off'), head = g.querySelector('.group-head') || g.querySelector('h3');
    if (!['Top', 'Right', 'Bottom', 'Left'].every(k => near(parseFloat(cs['border' + k + 'Width']), 1))) put('tile border is not a line on every side', g);
    if (parseFloat(cs.borderTopLeftRadius) < 1) put('tile has no rounded corner', g);
    const nx = groups[i + 1]; if (nx && !near(R(nx).top - r.bottom, T.card)) put('tile to tile ' + (R(nx).top - r.bottom).toFixed(1) + ' not ' + T.card, g);
    if (!near(R(head).height, T.sw)) put('heading row ' + R(head).height.toFixed(1) + ' not ' + T.sw, g);
    const txt = document.createRange(); txt.selectNodeContents(head.querySelector('.fold-btn') || head); const t = txt.getBoundingClientRect();
    const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;margin-top:var(--cut-t)'; (head.querySelector('h3') || head).appendChild(probe); const trim = -parseFloat(getComputedStyle(probe).marginTop); probe.remove();
    const above = t.top - r.top - 1 + trim, body = g.querySelector('.group-body');
    if (off || !body || !shown(body)) { const below = r.bottom - 1 - t.bottom + trim; if (!near(above, below, 1.5)) put('closed tile: ' + above.toFixed(1) + ' above the heading letters, ' + below.toFixed(1) + ' below', g); return; }
    const kids = [...g.children].filter(k => shown(k) && !k.matches('.group-head, h3, .group-sum')), bottom = Math.max(...kids.map(k => R(k).bottom)), below = r.bottom - 1 - bottom;
    if (!near(above, below, 1.5)) put('open tile: ' + above.toFixed(1) + ' above the heading letters, ' + below.toFixed(1) + ' under the last row', g);
  });
  // a label above its control, and a setting from the next
  for (const f of panel.querySelectorAll('.field')) {
    if (!shown(f)) continue;
    const kids = [...f.children].filter(shown), lbl = kids.find(k => k.matches('.lbl, label:not(.check)')), ctl = lbl && kids[kids.indexOf(lbl) + 1];
    if (lbl && ctl && ctl.matches('.seg, input[type=range], select, input[type=text], textarea, .combo, .line-row, .btn, .lv-big, .fade-shape') && !f.matches(':has(>.line-row)')) {
      const mb = Math.min(0, parseFloat(getComputedStyle(lbl).marginBottom) || 0), want = ctl.matches('.seg, select, .combo, .fade-shape') ? T.head : T.label, d = R(ctl).top - (R(lbl).bottom + mb); if (!near(d, want) && !ctl.matches('.lv-big')) put('label to control ' + d.toFixed(1) + ' not ' + want, f);          // the label is trimmed to its letters, so the gap is measured from them
    }
  }
  const body = [...panel.querySelectorAll('.group-body, #fadeBody, .group')].filter(shown);
  for (const b of body) {
    const fs = [...b.children].filter(c => shown(c) && c.matches(':scope > .field:not(.fade-pair), :scope > .field.fade-pair'));
    for (let i = 0; i + 1 < fs.length; i++) {
      const a = fs[i], n = fs[i + 1]; if (a.nextElementSibling !== n) continue;
      const d = R(n).top - R(a).bottom; if (!near(d, T.field) && !near(d, 0) && !(n.matches('.fade-pair') && near(d, T.card))) put('setting to setting ' + d.toFixed(1) + ' not ' + T.field, n);
    }
  }
  // a note under its control
  for (const n of panel.querySelectorAll('.field > .t-note')) {
    if (!shown(n) || !n.textContent.trim()) continue; const prev = [...n.parentElement.children].filter(shown); const c = prev[prev.indexOf(n) - 1]; if (!c) continue;
    const d = R(n).top - R(c).bottom; if (!near(d, T.label)) put('note under control ' + d.toFixed(1) + ' not ' + T.label, n);
  }
  // one left line and one right line
  for (const e of panel.querySelectorAll('.group .seg, .group input[type=range], .group select, .group .btn.wide, .group .fade-shape, .group .combo, .group textarea, .group input[type=text], .group .line-row, .group .line-style, .group .colorrow')) {
    if (!shown(e) || e.matches('.csel-hex') || e.closest('[data-sum=shadows] .sub') || e.closest('.line-row, .line-style, .colorrow') && !e.matches('.line-row, .line-style, .colorrow')) continue;
    // a credits line's box stands on the lines; what sits beside its Aa, Bold, and Italic buttons or a swatch does not
    const r = R(e), g0 = e.closest('.group'), gc = getComputedStyle(g0), gr = { left: R(g0).left + parseFloat(gc.borderLeftWidth) + parseFloat(gc.paddingLeft), right: R(g0).right - parseFloat(gc.borderRightWidth) - parseFloat(gc.paddingRight) };          // a group's box is the panel's content lines (centered at most 560px wide where the panel is under the picture)
    if (!near(r.left, gr.left)) put('left line ' + (r.left - gr.left).toFixed(1), e);
    if (!near(r.right, gr.right) && r.width > 40) put('right line ' + (r.right - gr.right).toFixed(1), e);
  }
  // a setting that belongs to the one above it has no indent, rule line, or frame of its own
  for (const e of panel.querySelectorAll('.sub:not(.field), .line-style')) { const cs = getComputedStyle(e); if (!shown(e)) continue; if (parseFloat(cs.marginLeft) !== 0 || parseFloat(cs.paddingLeft) !== 0 || parseFloat(cs.borderLeftWidth) !== 0) put('a dependent setting is indented or ruled (margin ' + cs.marginLeft + ', padding ' + cs.paddingLeft + ', border ' + cs.borderLeftWidth + ')', e); }
  // Shadows: three parts split by hairlines, each row one line (name, slider, value) on the same columns, --gap-set between rows
  const sh = document.querySelector('[data-sum=shadows]');
  if (sh && shown(sh) && !sh.classList.contains('off')) {
    const rows = [...sh.querySelectorAll('.sub>.field')].filter(shown), set = px('--gap-set'), tok = px('--sh-name'), tv = px('--sh-val');
    const cols = rows.map(f => { const lb = f.querySelector('label'), out = lb.querySelector('output'), rg = f.querySelector('input[type=range]'); const rn = document.createRange(); rn.selectNodeContents(lb.firstChild); return { f, name: rn.getBoundingClientRect(), out: R(out), rg: R(rg), h: R(f).height }; });
    cols.forEach(c => { if (Math.abs((c.name.top + c.name.bottom) / 2 - (c.rg.top + c.rg.bottom) / 2) > 3 || Math.abs((c.out.top + c.out.bottom) / 2 - (c.rg.top + c.rg.bottom) / 2) > 3) put('a Shadows row is not on one line', c.f); });
    if (cols.length > 1) { const l0 = cols[0].rg.left, r0 = cols[0].rg.right, v0 = cols[0].out.right; cols.forEach(c => { if (!near(c.rg.left, l0) || !near(c.rg.right, r0) || !near(c.out.right, v0)) put('Shadows rows are not on the same columns', c.f); }); if (!near(cols[0].rg.left - R(sh.querySelector('.sub')).left, tok + T.head)) put('the name column is ' + (cols[0].rg.left - R(sh.querySelector('.sub')).left - T.head).toFixed(1) + ' wide, not the ' + tok + ' token', cols[0].f); }
    const widest = Math.max(...[...sh.querySelectorAll('.sub>.field>label')].filter(l => shown(l.parentElement)).map(l => { const rn = document.createRange(); rn.selectNodeContents(l.firstChild); return rn.getBoundingClientRect().width; }));
    if (widest > tok + 0.5 || widest < tok - 6) put('the name column (' + tok + 'px) does not fit the longest name (' + widest.toFixed(1) + 'px) closely', sh);
    for (let i = 0; i + 1 < rows.length; i++) if (rows[i].parentElement === rows[i + 1].parentElement && !near(R(rows[i + 1]).top - R(rows[i]).bottom, set)) put('Shadows row to row ' + (R(rows[i + 1]).top - R(rows[i]).bottom).toFixed(1) + ' not ' + set, rows[i + 1]);
    const heads = [...sh.querySelectorAll('.subhead')].filter(shown);
    heads.forEach(h => { const cs = getComputedStyle(h); if (cs.fontSize !== '13px' || cs.fontWeight !== '600' || cs.color !== getComputedStyle(sh.querySelector('h3')).color) put('part heading is ' + cs.fontSize + ' ' + cs.fontWeight, h); if (!near(R(h.nextElementSibling).top - R(h).bottom, set)) put('part heading to first row ' + (R(h.nextElementSibling).top - R(h).bottom).toFixed(1) + ' not ' + set, h); });
    const rules = [...sh.querySelectorAll('#centerFold>.sub, #turnShadowBlock>.sub')].filter(shown);
    rules.forEach(sb => { const nxt = [...sh.querySelectorAll('.subhead')].filter(shown).find(h => R(h).top > R(sb).bottom - 1), cs = getComputedStyle(sb); if (!nxt || !near(R(nxt).top - R(sb).bottom, set) || !near(parseFloat(cs.paddingBottom), set) || !near(parseFloat(cs.borderBottomWidth), 1)) put('hairline: ' + set + ' above, the line, and ' + set + ' below it', sb); });
    const note = sh.querySelector('#scoreHint'); if (note && shown(note)) { const sf = note.previousElementSibling; if (!near(R(note).top - R(sf).bottom, T.head)) put('the note is ' + (R(note).top - R(sf).bottom).toFixed(1) + ' under Softness, not ' + T.head, note); if (note.textContent !== 'Best on a light background with margin.' || R(note).height > 20) put('the note wording or one line', note); }
    const rb = document.getElementById('shadowReset'), tg = sh.querySelector('.switch'), hd = sh.querySelector('h3');
    if (!rb.hidden) { const c = e => (R(e).top + R(e).bottom) / 2; if (!near(c(rb), c(tg), 1) || !near(c(rb), c(hd), 1)) put('Reset, the switch, and the heading are not on one center line', rb); if (R(rb).right > R(tg).left) put('Reset is not left of the switch', rb); }
  }
  // the Fades group
  const fb = document.querySelector('#fadeBody');
  if (fb && shown(fb)) {
    const side = R(document.querySelector('#fadeSide')), lenL = R(document.querySelector('#fadeLenLbl')), big = document.querySelector('#fadeLenVal'), bigR = R(big), sl = R(document.querySelector('#fadeLen')),
      shapeL = R(document.querySelector('#fadeShapeLbl')), cv = R(document.querySelector('#fadeCv')), cur = R(document.querySelector('#fadeShape')), to = R(document.querySelector('[name=fadeStyle]').closest('.seg'));
    if (!(big.parentElement === document.querySelector('#fadeLenLbl') && lenL.bottom <= sl.top + 0.5)) bad.push('Length: the value is not in the label row above the slider');
    if (big.getBoundingClientRect().height > lenL.height + 0.5) bad.push('Length: the value is bigger than its label row');
    if (!(shapeL.bottom <= cv.top + 0.5 && cv.bottom <= cur.top + 0.5)) bad.push('Curve: the label, the picture, and the choice are not in that order');
    if (!near(cur.top - cv.bottom, T.head)) bad.push('Curve: the choice is ' + (cur.top - cv.bottom).toFixed(1) + ' under the picture, not ' + T.head);
    if (!near(cv.left, cur.left) || !near(cv.right, cur.right)) bad.push('Curve: the picture and the choice are not on the same lines');
    if (!(side.bottom < lenL.top && sl.bottom < shapeL.top && cur.bottom < to.top)) bad.push('Fades: the four parts are not stacked in order');
  }
  return { bad, groups: groups.length, w: innerWidth, h: innerHeight };
};
const openDependents = () => {
  const set = (id, v) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  set('invert', true); S.set.bg = '#123456'; S.set.ink = '#345678'; syncControls(); set('creditsOn', true);
  for (const b of document.querySelectorAll('.fmt-btn.aa')) if (b.getAttribute('aria-expanded') !== 'true') b.click();
};
const closeDependents = () => {
  const set = (id, v) => { const e = document.getElementById(id); if (!e) return; if (e.type === 'checkbox') e.checked = v; else e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  for (const b of document.querySelectorAll('.fmt-btn.aa')) if (b.getAttribute('aria-expanded') === 'true') b.click();
  set('invert', false); S.set.bg = '#000000'; syncControls(); set('creditsOn', false);
};
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 0); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  for (const dark of [false, true]) {
    await p.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    for (const [w, h] of SIZES) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300);
      const r = await p.evaluate(lines);
      ok((dark ? 'dark ' : 'light ') + w + 'x' + h + ': the panel keeps its lines (' + r.groups + ' groups)', r.bad.length === 0, [...new Set(r.bad)].slice(0, 8).join(' | '));
      await p.evaluate(openDependents); await p.waitForTimeout(700);          // the dependent settings all showing: Invert colors with its Ink color, both custom color rows, and each credits line's Aa row
      const q = await p.evaluate(lines);
      ok((dark ? 'dark ' : 'light ') + w + 'x' + h + ': the panel keeps its lines with every dependent setting showing (' + q.groups + ' groups)', q.bad.length === 0, [...new Set(q.bad)].slice(0, 8).join(' | '));
      await p.evaluate(closeDependents); await p.waitForTimeout(500);
    }
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})();
