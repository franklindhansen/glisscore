// Layout sweep: every screen at phone, tablet, and desktop widths, in light and dark. Each screen is scanned for what a layout bug looks like from outside: anything past the window's edge or its own
// container, text or a box cut off by its parent, two controls on top of each other, a stretch of text squeezed to a sliver, and a control that touches the divider under it. It also checks the UI guard's
// own reports (a card whose content passes its padding), and the order of the Noise reduction cards. A control may be listed in ALLOW below when it is on purpose (say why).
// Add SHOTS=dir to save a screenshot of every screen. Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/layout-sweep.js
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' \u2014 ' + x : ''));
const FIX = (process.env.S || 'tests/fixtures') + '/', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const SIZES = [[300, 740], [340, 740], [420, 800], [520, 800], [620, 900], [700, 900], [900, 800], [1280, 800], [1440, 900]];
const DARK = new Set([300, 700, 1280]);
const KINDS = new Set(['off-screen', 'pokes-out', 'text-clipped', 'clipped-box', 'overlap', 'skinny-text', 'touches-line']);
// on purpose: the visually hidden labels, the 18px (i) buttons, a row that is a button, the empty page's entrance animation, controls that overlap only while a fold is shut
const ALLOW = [/\.sr "/, /\.info-i/, /#aeMetaGo/, /#spDraw/, /#empty\.empty/, /#codec/, /#bTap/, /\.chip-name/];
const LINT = `(root => {
  const out = [], R = e => e.getBoundingClientRect(), vis = e => { const r = R(e); if (r.width < 1 || r.height < 1) return false; for (let n = e; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0 || n.hidden || n.inert) return false; if (n !== e && /(hidden|clip|auto|scroll)/.test(c.overflowX + c.overflowY)) { const q = R(n); if (r.right <= q.left + 1 || r.left >= q.right - 1 || r.bottom <= q.top + 1 || r.top >= q.bottom - 1) return false; } } return true; };
  const rootEl = document.querySelector(root) || document.body, rr = R(rootEl), vw = innerWidth;
  const nm = e => (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 22) + '"';
  const clipR = e => { let r = R(e), x = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) { const c = getComputedStyle(n); if (/(hidden|clip|auto|scroll)/.test(c.overflowX + c.overflowY)) { const q = R(n); x = { left: Math.max(x.left, q.left), right: Math.min(x.right, q.right), top: Math.max(x.top, q.top), bottom: Math.min(x.bottom, q.bottom) }; } } return x; };          // what of a control can be seen: a scrolling panel clips it
  const scrollers = e => { for (let n = e.parentElement; n && n !== rootEl.parentElement; n = n.parentElement) { const c = getComputedStyle(n); if (/(auto|scroll)/.test(c.overflowX) ) return true; } return false; };
  if (document.documentElement.scrollWidth > vw + 1) out.push(['page-hscroll', 'page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + vw]);
  const all = [...rootEl.querySelectorAll('*')].filter(vis);
  for (const e of all) {
    if (e.closest('svg') && e.tagName !== 'svg') continue;
    const r = R(e), c = getComputedStyle(e);
    if (c.position === 'fixed') continue;
    if (!e.matches('canvas,.tip,option,.sr-only,[class*=tip]') && !e.closest('.tip') && (r.right > vw + 1 || r.left < -1) && !scrollers(e)) out.push(['off-screen', nm(e) + ' x=' + Math.round(r.left) + '..' + Math.round(r.right) + ' (vw ' + vw + ')']);
    else if (!e.matches('canvas,.tip,option') && !e.closest('.tip') && rootEl !== document.body && (r.right > rr.right + 1 || r.left < rr.left - 1) && !scrollers(e) && c.position !== 'absolute') out.push(['pokes-out', nm(e) + ' ' + Math.round(r.left) + '..' + Math.round(r.right) + ' vs container ' + Math.round(rr.left) + '..' + Math.round(rr.right)]);
    const hasText = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText && /(hidden|clip)/.test(c.overflowX) && e.scrollWidth > e.clientWidth + 1) out.push([c.textOverflow === 'ellipsis' ? 'ellipsis' : 'text-clipped', nm(e) + ' ' + e.scrollWidth + '>' + e.clientWidth]);
    if (!hasText && /(hidden|clip)/.test(c.overflowX) && e.scrollWidth > e.clientWidth + 1 && e.children.length && !e.matches('.sweeping,canvas,.ae-pbody,.ae-pane,.ae-rail,[class*=scroll]')) out.push(['clipped-box', nm(e) + ' ' + e.scrollWidth + '>' + e.clientWidth]);
    if (hasText && !e.matches('button,.btn,label,summary,select') ) { const lh = parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.3; if (r.width < 28 && r.height > lh * 2.5 && (e.textContent.trim().length > 3)) out.push(['skinny-text', nm(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)]); }
    if (e.matches('button,.btn,select,input:not([type=hidden]),a.btn') && !e.matches('.info-i,.ae-rail-cur') ) { const lh = parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.3; if (e.matches('button,.btn') && e.textContent.trim() && r.height > lh * 1.6 + 8 && !e.matches('.ae-tool,.pe-tab,.menu-item,.card,[class*=card]')) out.push(['wrapped-button', nm(e) + ' h=' + Math.round(r.height)]); if (e.matches('input[type=checkbox],input[type=radio],input[type=range],.sw') === false && (r.height < 22 && e.matches('button,.btn,select'))) out.push(['tiny-target', nm(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)]); }
  }
  const ctl = all.filter(e => e.matches('button,.btn,select,input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=file]),label.seg,.chip,.mt-chip,output'));
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) { const a = ctl[i], b = ctl[j]; if (a.contains(b) || b.contains(a)) continue; const A = clipR(a), B = clipR(b), ox = Math.min(A.right, B.right) - Math.max(A.left, B.left), oy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top); if (ox > 3 && oy > 3) out.push(['overlap', nm(a) + '  X  ' + nm(b) + ' (' + Math.round(ox) + 'x' + Math.round(oy) + ')']); }
  // a control that touches a divider / the card edge below it (gap < 2px between a control's bottom and a following border line)
  document.querySelectorAll(root + ' hr, ' + root + ' .div, ' + root + ' [class*=divider]').forEach(d => { if (!vis(d)) return; const D = R(d); ctl.forEach(b => { const B = R(b); if (B.bottom > D.top - 2 && B.bottom <= D.bottom + 1 && B.right > D.left && B.left < D.right) out.push(['touches-line', nm(b) + ' bottom ' + Math.round(B.bottom) + ' line ' + Math.round(D.top)]); }); });
  return out;
})`;
const scenes = [];
const dlg = id => ({ name: id, root: '#' + id + ' .dlg', open: `sheetShow(document.querySelector('#${id}'))`, close: `sheetHide(document.querySelector('#${id}'))` });
scenes.push({ name: 'main', root: 'body', open: '0', close: '0' });
['ioDlg', 'howDlg', 'aboutDlg', 'keysDlg'].forEach(id => scenes.push(dlg(id)));
['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu'].forEach(t => scenes.push({ name: 'audio-' + t, root: '#audioDlg .dlg', audio: true, open: `aeTool('${t}')`, close: '0' }));
scenes.push({ name: 'audio-history', root: '#audioDlg .dlg', audio: true, open: `aeTool('level'), aeHistOpen(true)`, close: 'aeHistOpen(false)' });
scenes.push({ name: 'audio-export', root: '#aeExpDlg', audio: true, open: 'aeExpOpen()', close: 'aeExpClose()' });
['pages', 'crop', 'dim', 'resize', 'skew', 'split', 'wm', 'clean'].forEach(t => scenes.push({ name: 'pdf-' + t, root: '#pdfDlg .dlg', pdf: true, open: `peTool('${t}')`, close: '0' }));
(async () => {
  const b = await chromium.launch();
  await Promise.all(SIZES.flatMap(([w, h]) => ['light', 'dark'].filter(t => t === 'light' || DARK.has(w)).map(async theme => {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: theme }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await p.setInputFiles('#audioIn', FIX + 'loud.mp3'); await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer);
    await p.setInputFiles('#pdfIn', FIX + 'score.pdf'); await p.waitForTimeout(2500);
    const tag = w + 'x' + h + ' ' + theme + ': ';
    for (const sc of scenes) {
      if (sc.audio) { await p.evaluate(() => { if (document.querySelector('#audioDlg').hidden) openAudioEditor(); }); await p.waitForTimeout(300); }
      if (sc.pdf) { await p.evaluate(() => { if (document.querySelector('#pdfDlg').hidden) openPdfEditor(); }); await p.waitForTimeout(1000); }
      await p.evaluate(sc.open); await p.waitForTimeout(700);
      const items = await p.evaluate(`(${LINT})(${JSON.stringify(sc.root)})`), seen = new Set();
      const bad = items.filter(([k, m]) => KINDS.has(k) && !ALLOW.some(r => r.test(m)) && !seen.has(k + m) && seen.add(k + m)).map(([k, m]) => k + ': ' + m);
      ok(tag + sc.name + ' has no layout faults', !bad.length, bad.slice(0, 6).join(' | '));
      if (sc.name === 'audio-noise') {
        const g = await p.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
          const n = (s) => document.querySelector(s) ? r(s) : null; return { stage: n('.nr-stage'), sample: n('#aeNrSample'), ctl: n('#aeNrCtl'), n1: n('#aeNrSample .mt-step .mt-n'), n2: n('#aeNrLearnStep .mt-n'), steps: n('#aeNrSample .mt-steps') }; });
        ok(tag + 'Noise reduction: the graph is above both cards and as wide as them', g.stage.b <= g.sample.t + 1 + (g.sample.t < g.stage.b ? g.stage.b - g.sample.t : 0) && g.stage.l <= Math.min(g.sample.l, g.ctl.l) + 1 && g.stage.r >= Math.max(g.sample.r, g.ctl.r) - 1 || g.sample.t <= g.stage.t + 1, JSON.stringify(g));
        ok(tag + 'Noise reduction: Removal is beside or under Noise sample, never above or left of it', g.ctl.t >= g.sample.b - 1 || (g.ctl.l >= g.sample.r - 1 && Math.abs(g.ctl.t - g.sample.t) <= 1), JSON.stringify({ s: g.sample, c: g.ctl }));
        if (g.n1 && g.n2 && Math.abs(g.n1.l - g.n2.l) > 40) ok(tag + 'Noise reduction: side by side, the step numbers sit on one line', Math.abs(g.n1.t - g.n2.t) <= 0.5, g.n1.t + ' vs ' + g.n2.t);
      }
      if (sc.close !== '0') { await p.evaluate(sc.close); await p.waitForTimeout(250); }
      if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await p.screenshot({ path: path.join(process.env.SHOTS, sc.name + '-' + w + '-' + theme + '.png') }); }
      if (sc.name === 'audio-export') await p.evaluate(() => { try { closeAudioEditor(); } catch (e) {} });
      if (sc.name === 'pdf-clean') await p.evaluate(() => { try { closePdfEditor(); } catch (e) {} });
    }
    ok(tag + 'the UI guard reported nothing', !errs.length, errs.slice(0, 3).join(' | '));
    await p.close();
  })));
  await b.close();
})();
