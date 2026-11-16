// The video settings panel's lines, measured on the page (not read from the style sheet) at the sizes the panel takes: beside the picture (1440x900, 1100x800), under it at tablet width (820x900, 600x900), and on a phone (390x844).
// Every distance is the token it comes from, and the list of known failures is empty:
//   group      the first thing in a group sits --gap-group under the divider above it, and the last thing --gap-group over the divider below it
//   heading    a group's heading row has --gap-card under it before the first setting
//   label      a label sits --gap-label above its control
//   settings   one setting stands --gap-field from the next
//   note       a note sits --gap-label under the control it explains
//   side       every control stands on the panel's one left line and one right line (a sub-setting is indented by --sub-indent, and its right line is the same)
//   fades      the Fades group: Apply to, Length (the label with its value, the slider with its end words), Curve (the label, the picture, the choice pinned under the picture, as the Audio Editor's Shape), Fade to
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-panel-lines.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1', FX = process.env.S || 'tests/fixtures';
const SIZES = [[1440, 900], [1100, 800], [820, 900], [600, 900], [390, 844]];
const lines = () => {
  const px = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), R = e => e.getBoundingClientRect();
  const T = { group: px('--gap-group'), card: px('--gap-card'), label: px('--gap-label'), field: px('--gap-field'), indent: px('--sub-indent'), head: px('--gap-head') };
  const shown = e => { for (let n = e; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; if (n.matches('.fa:not(.open)>.fa-in, .line-fold:not(.open)>.fa-in')) return false; } const r = R(e); return r.width > 0 && r.height > 0; };
  const panel = document.querySelector('.panel');
  const bad = [], near = (a, b) => Math.abs(a - b) <= 0.6, name = e => e.id || (e.className && String(e.className).split(' ')[0]) || e.tagName, put = (m, e) => bad.push(m + ' (' + name(e) + ')');
  // groups: the divider above and below
  const groups = [...panel.querySelectorAll('.group')].filter(shown);
  for (const g of groups) {
    const kids = [...g.children].filter(shown), r = R(g), cs = getComputedStyle(g);
    if (!kids.length) continue;
    const first = R(kids[0]), last = R(kids[kids.length - 1]), bb = parseFloat(cs.borderBottomWidth);
    if (!near(first.top - r.top, T.group)) put('group top ' + (first.top - r.top).toFixed(1) + ' not ' + T.group, g);
    if (!near(r.bottom - bb - last.bottom, T.group)) put('group bottom ' + (r.bottom - bb - last.bottom).toFixed(1) + ' not ' + T.group, g);
  }
  // a label above its control, and a setting from the next
  for (const f of panel.querySelectorAll('.field')) {
    if (!shown(f) || f.closest('.sub') && false) continue;
    const kids = [...f.children].filter(shown), lbl = kids.find(k => k.matches('.lbl, label:not(.check)')), ctl = lbl && kids[kids.indexOf(lbl) + 1];
    if (lbl && ctl && ctl.matches('.seg, input[type=range], select, input[type=text], textarea, .combo, .line-row, .btn, .lv-big, .fade-shape') && !f.matches(':has(>.line-row)')) {
      const d = R(ctl).top - R(lbl).bottom; if (!near(d, T.label) && !ctl.matches('.lv-big')) put('label to control ' + d.toFixed(1) + ' not ' + T.label, f);
    }
  }
  const body = [...panel.querySelectorAll('.group-body, #fadeBody, .group')].filter(shown);
  for (const b of body) {
    const fs = [...b.children].filter(c => shown(c) && c.matches(':scope > .field:not(.sub):not(.fade-pair), :scope > .field.fade-pair'));
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
  for (const e of panel.querySelectorAll('.group .seg, .group input[type=range], .group select, .group .btn.wide, .group .fade-shape, .group .combo, .group textarea, .group input[type=text]')) {
    if (!shown(e)) continue; const r = R(e), sub = e.closest('.sub, #firstAloneField, #inkField'), gr = R(e.closest('.group'));          // a group's box is the panel's content lines (centered at most 560px wide where the panel is under the picture)
    if (!sub && !near(r.left, gr.left)) put('left line ' + (r.left - gr.left).toFixed(1), e);
    if (!near(r.right, gr.right) && r.width > 40) put('right line ' + (r.right - gr.right).toFixed(1), e);
  }
  // the Fades group
  const fb = document.querySelector('#fadeBody');
  if (fb && shown(fb)) {
    const side = R(document.querySelector('#fadeSide')), lenL = R(document.querySelector('#fadeLenLbl')), big = document.querySelector('#fadeLenVal'), bigR = R(big), sl = R(document.querySelector('#fadeLen')),
      shapeL = R(document.querySelector('#fadeShapeLbl')), cv = R(document.querySelector('#fadeCv')), cur = R(document.querySelector('#fadeShape')), to = R(document.querySelector('[name=fadeStyle]').closest('.seg'));
    if (!(big.parentElement === document.querySelector('#fadeLenLbl') && lenL.bottom <= sl.top + 0.5)) bad.push('Length: the value is not in the label row above the slider');
    if (big.getBoundingClientRect().height > lenL.height + 0.5) bad.push('Length: the value is bigger than its label row');
    if (!(shapeL.bottom <= cv.top + 0.5 && cv.bottom <= cur.top + 0.5)) bad.push('Curve: the label, the picture, and the choice are not in that order');
    if (!near(cur.top - cv.bottom, T.label)) bad.push('Curve: the choice is ' + (cur.top - cv.bottom).toFixed(1) + ' under the picture, not ' + T.label);
    if (!near(cv.left, cur.left) || !near(cv.right, cur.right)) bad.push('Curve: the picture and the choice are not on the same lines');
    if (!(side.bottom < lenL.top && sl.bottom < shapeL.top && cur.bottom < to.top)) bad.push('Fades: the four parts are not stacked in order');
  }
  return { bad, groups: groups.length, w: innerWidth, h: innerHeight };
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
    }
  }
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})();
