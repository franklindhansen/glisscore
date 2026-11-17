// The shared Bold and Italic group is as tall as the field beside it (Credits' font box, the PDF Editor's text box); the timeline's zoom has minus and plus beside the slider and Fit; the Audio Editor's Play says Pause while it plays; the file tiles are short with their mark and words on one line.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/shared-format-zoom.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [], K = '__keyframes';
  const p = await b.newPage({ viewport: { width: 1440, height: 1500 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); const F = process.env.S || 'tests/fixtures';
  const tiles = await p.evaluate(() => [...document.querySelectorAll('#fileStatus .st')].map(e => { const r = e.getBoundingClientRect(), i = e.querySelector('.st-ic').getBoundingClientRect(), t = e.querySelector('.st-t').getBoundingClientRect(); return { h: r.height, same: Math.abs((i.top + i.height / 2) - (t.top + t.height / 2)) < 1, gl: i.left - r.left, gr: r.right - t.right }; }));
  ok('the file tiles are short, with the mark and the words on one line', tiles.length === 2 && tiles.every(t => t.h < 40 && t.same), JSON.stringify(tiles));
  ok('each file tile has the same space left and right of its mark and words', tiles.every(t => Math.abs(t.gl - t.gr) < 1.5), JSON.stringify(tiles));
  ok('the zoom buttons are off with nothing loaded', await p.evaluate(() => $('#zoomOut').disabled && $('#zoomIn').disabled));
  await p.setInputFiles('#pdfIn', F + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.setInputFiles('#audioIn', F + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(800);
  const pps = () => p.evaluate(K => window[K].S.pxPerSec, K); const z0 = await pps(); await p.click('#zoomOut'); await p.waitForTimeout(500); const z1 = await pps(); await p.click('#zoomIn'); await p.waitForTimeout(500); const z2 = await pps();
  ok('the timeline zoom has a minus and a plus that move the zoom', z1 < z0 && z2 > z1, JSON.stringify({ z0, z1, z2 }));
  const zr = await p.evaluate(() => { const g = $('.tl-bar .zoom').getBoundingClientRect(), u = $('.tl-bar .hist-wrap').getBoundingClientRect(); return { zh: g.height, uh: u.height, kids: [...document.querySelectorAll('.tl-bar .zoom>*')].filter(e => e.offsetWidth).map(e => { const r = e.getBoundingClientRect(); return Math.round(r.top + r.height / 2); }) }; });
  ok('the zoom group is as tall as the Undo group and its parts share a center line', zr.zh === zr.uh && new Set(zr.kids).size === 1, JSON.stringify(zr));
  // Bold and Italic
  await p.evaluate(() => { document.querySelector('#creditsOn').click(); }); await p.waitForTimeout(900); await p.evaluate(() => document.querySelector('#credTitleAa').click()); await p.waitForTimeout(900);
  const cr = await p.evaluate(() => ['credTitle', 'credL2', 'credL3'].map(k => { const f = document.querySelector('#' + k + 'Font').getBoundingClientRect(), g = document.querySelector('#' + k + 'B').closest('.fmt-group'); if (!g.offsetWidth) return null; const r = g.getBoundingClientRect(); return { f: f.height, g: r.height, ft: f.top, gt: r.top }; }).filter(Boolean));
  ok('Credits: Bold and Italic are one group as tall as the font box and level with it', cr.length >= 1 && cr.every(x => x.f === x.g && x.ft === x.gt), JSON.stringify(cr));
  const before = await p.evaluate(() => document.querySelector('#credTitleB').getAttribute('aria-pressed')); await p.click('#credTitleB'); const after = await p.evaluate(() => document.querySelector('#credTitleB').getAttribute('aria-pressed'));
  ok('Bold toggles', before !== after, before + ' to ' + after);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800); await p.evaluate(() => peTool('wm')); await p.waitForTimeout(500);
  const wm = await p.evaluate(() => { const i = document.querySelector('#peWmText').getBoundingClientRect(), g = document.querySelector('#peViewWm .fmt-group').getBoundingClientRect(); return { i: i.height, g: g.height, it: i.top, gt: g.top }; });
  ok('Watermark: Bold and Italic are one group as tall as the text box and level with it', wm.i === wm.g && wm.it === wm.gt, JSON.stringify(wm));
  await p.evaluate(() => closePdfEditor()); await p.waitForTimeout(400);
  // the Audio Editor's Play label
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(800); const lab = () => p.evaluate(() => $('#aePlay').getAttribute('aria-label'));
  const l0 = await lab(); await p.click('#aePlay'); await p.waitForTimeout(400); const l1 = await lab(); await p.click('#aePlay'); await p.waitForTimeout(300); const l2 = await lab();
  ok('the Audio Editor Play says Pause preview while it plays and Play preview otherwise', l0 === 'Play preview' && l1 === 'Pause preview' && l2 === 'Play preview', JSON.stringify([l0, l1, l2]));
  // the one key cap: the note's Enter, the shortcuts sheet, and the Add page turn button's T all look alike and add no height
  const kc = await p.evaluate(() => { const n = [...document.querySelectorAll('.t-note')].find(e => e.querySelector('kbd')), k = n && n.querySelector('kbd'), sheet = document.querySelector('#keysDlg kbd'), cs = x => { const c = getComputedStyle(x); return [c.fontSize, c.borderBottomWidth, c.borderRadius, c.backgroundColor, c.color, c.paddingTop].join('|'); }; const lh = parseFloat(getComputedStyle(n).lineHeight); return { has: !!k, same: cs(k) === cs(sheet), noteLines: Math.round(n.getBoundingClientRect().height / lh), tbtn: document.querySelector('#bTap').getBoundingClientRect().height, tSame: cs(document.querySelector('#bTap kbd')) === cs(sheet) }; });
  ok('a key named in a note is the same key cap as the shortcuts sheet, and the note keeps its line', kc.has && kc.same && kc.noteLines === 1, JSON.stringify(kc));
  ok('the Add page turn button holds the same key cap and stays 36px tall', kc.tSame && kc.tbtn === 36, JSON.stringify(kc));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
