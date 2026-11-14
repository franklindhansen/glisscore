// One text and spacing system: every screen is opened and the gaps and sizes of its titles, subtitles, labels, notes, and headings are read.
//   title to subtitle = --gap-sub (2px), label to control and control to note = --gap-label (4px), heading to content = --gap-head (8px), one setting to the next = --gap-set (12px, editor cards) or --gap-field (16px, the video panel and windows),
//   every subtitle is 13px on a 16px line, every note is 12px on a 16px line, every title block sits on whole pixels, a tool head is 20 + 2 + 16px, and a window title is Newsreader 24px.
// Then the tooltip rule: every title and tip in the Audio Editor and the PDF Editor is one or two sentences, 90 characters at most, with no semicolon and no parentheses (a shortcut in parentheses at the end is the one exception).
// Window 1300x900, after the entrance motion has settled. SHOW=1 prints what was measured on each screen.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/text-spacing.js
const { chromium } = require('playwright-core');
const { textScan } = require('./lib/text-scan.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const FX = process.env.S || 'tests/fixtures';
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const bad = [], tips = new Map(), total = { block: 0, sub: 0, note: 0, label: 0, head: 0, set: 0 };
  const check = async where => { const r = await p.evaluate(textScan, where); r.bad.forEach(x => bad.push(x)); Object.keys(total).forEach(k => { total[k] += r.n[k]; }); if (process.env.SHOW) console.log(where, JSON.stringify(r.n)); return r; };
  const grab = () => p.evaluate(() => { const out = [], tx = k => (window.tx ? tx(k) : ''); document.querySelectorAll('#audioDlg [title], #pdfDlg [title], #audioDlg .tip, #pdfDlg .tip, #audioDlg [data-why], #pdfDlg [data-why]').forEach(e => { const t = e.matches('.tip') ? (e.dataset.tip && tx(e.dataset.tip)) || e.textContent : e.getAttribute('title') || e.dataset.why; if (t && t.trim()) out.push((e.id ? '#' + e.id : e.className || e.tagName) + '|' + t.trim()); }); return out; });
  const tipsHere = async () => { for (const s of await grab()) { const i = s.indexOf('|'); tips.set(s.slice(i + 1), s.slice(0, i)); } };
  const show = async sel => { await p.evaluate(sel => { const o = document.querySelector(sel); o.hidden = false; o.style.animation = 'none'; const d = o.querySelector('.dlg'); if (d) d.style.animation = 'none'; }, sel); await p.waitForTimeout(250); };
  const hide = sel => p.evaluate(sel => { document.querySelector(sel).hidden = true; }, sel);
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(1800); await check('start');
  await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.keep.length >= 1); await p.waitForTimeout(1500);
  await p.setInputFiles('#audioIn', FX + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(1000); await p.mouse.move(2, 2);
  for (const v of ['spread', 'single', 'system']) {
    await p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await p.waitForFunction(() => !(window.SYS && SYS.prog), null, { timeout: 60000 }); await p.waitForTimeout(1500); await check('video ' + v);
  }
  // every folded group of the video panel opened in turn
  const groups = await p.evaluate(() => [...document.querySelectorAll('.panel .group')].map((g, i) => ({ i, id: g.id || g.dataset.sum || '' })));
  for (const g of groups) { await p.evaluate(i => { const gr = document.querySelectorAll('.panel .group')[i]; if (gr.classList.contains('collapsed')) { const t = gr.querySelector('.group-head, h3'); if (t) t.click(); } }, g.i); await p.waitForTimeout(600); await check('video panel group ' + (g.id || g.i)); }
  for (const [name, sel] of [['History (video)', '#mHistSub'], ['History (Audio Editor)', '#aeHistSub'], ['History (PDF Editor)', '#peHistSub']]) { await p.evaluate(sel => { const h = document.querySelector(sel).closest('.hist'); h.hidden = false; h.style.animation = 'none'; h.style.opacity = '1'; h.style.visibility = 'visible'; h.style.transform = 'none'; }, sel); await p.waitForTimeout(200); await check(name); await p.evaluate(sel => { document.querySelector(sel).closest('.hist').hidden = true; }, sel); }
  for (const [name, sel] of [['About', '#aboutDlg'], ['How it works', '#howDlg'], ['Import/Export', '#ioDlg'], ['Keyboard shortcuts', '#keysDlg'], ['Diagnostics', '#diagDlg'], ['Export audio', '#aeExpDlg'], ['Export video', '#expDlg'], ['Locked PDF', '#pwDlg']]) { await show(sel); await check(name); await hide(sel); }
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(1000); await check('audio editor'); await tipsHere();
  for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu']) { await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(1200); await check('audio ' + t); await tipsHere(); }
  await p.evaluate(() => aeTool('noise')); await p.waitForTimeout(500); await p.evaluate(async () => { document.querySelector('#aeNrLearn').click(); await sleep(100); for (let i = 0; i < 600 && AE.nrAutoBusy; i++) await sleep(25); await sleep(300); }); await check('audio noise found by Auto'); await tipsHere();
  await p.evaluate(() => aeTool('eq')); await p.waitForTimeout(600); await p.evaluate(() => document.querySelector('#aeMatchBtn').click()); await p.waitForTimeout(900); await check('audio EQ Match'); await tipsHere();
  await p.evaluate(() => { aeTool('level'); const r = document.querySelector('input[name=aeNormMode][value=loud]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(1200); await check('audio Level, Loudness'); await tipsHere();
  await p.evaluate(() => { const c = document.querySelector('#aeCancel'); if (c) c.click(); }); await p.waitForTimeout(600);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200); await check('pdf editor'); await tipsHere();
  for (const t of ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm']) { await p.evaluate(t => peTool(t), t); await p.waitForTimeout(1400); await check('pdf ' + t); await tipsHere(); }
  ok('the five spacing tokens are 2, 4, 8, 12, and 16px', (await p.evaluate(textScan, 'tokens')).T && JSON.stringify(Object.values((await p.evaluate(textScan, 'tokens')).T)) === '[2,4,8,12,16]', JSON.stringify((await p.evaluate(textScan, 'tokens')).T));
  const seen = new Set(), uniq = bad.filter(x => { const k = x.replace(/^[^:]*: /, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  uniq.slice(0, 400).forEach(x => ok(x, false));
  ok('every title block, subtitle, label, note, and heading on every screen keeps its gap, size, and left edge (' + Object.entries(total).map(([k, v]) => v + ' ' + k).join(', ') + ' measured)', !uniq.length && total.block > 20 && total.sub > 20 && total.note > 20 && total.label > 40 && total.head > 8 && total.set > 3, uniq.length + ' break the rules');
  const long = [], sem = [], par = [], sent = [];
  for (const [t, where] of tips) { if (t.length > 90) long.push(where + ' (' + t.length + '): ' + t); if (/;/.test(t)) sem.push(where + ': ' + t); if (/[()]/.test(t.replace(/ \([A-Za-z0-9⌘⌥⇧ +/−-]{1,10}\)$/, ''))) par.push(where + ': ' + t); if ((t.match(/[.!?](\s|$)/g) || []).length > 2) sent.push(where + ': ' + t); }
  long.forEach(x => ok('tooltip too long: ' + x, false)); sem.forEach(x => ok('tooltip with a semicolon: ' + x, false)); par.forEach(x => ok('tooltip with parentheses: ' + x, false)); sent.forEach(x => ok('tooltip of three sentences: ' + x, false));
  ok('every Audio Editor and PDF Editor tooltip is 90 characters or fewer (' + tips.size + ' read)', !long.length && tips.size > 60, long.length + ' too long');
  ok('no tooltip holds a semicolon', !sem.length, sem.slice(0, 10).join('\n      '));
  ok('no tooltip holds parentheses, except a shortcut at the end ("Full screen (F)")', !par.length, par.slice(0, 10).join('\n      '));
  ok('every tooltip is one sentence, two at most', !sent.length, sent.slice(0, 10).join('\n      '));
  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})();
