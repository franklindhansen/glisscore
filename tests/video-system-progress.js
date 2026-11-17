// Video, System layout: the progress line, the Stop button, Export video held back, and the one toast for a tilted page and a two-page scan.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-progress.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function staffPage(doc, n, o = {}) {
  const w = o.w || PW, page = doc.addPage([w, PH]), sl = o.slope || 0;
  for (let k = 0; k < n; k++) {
    const y = 110 + k * 250;
    for (const off of [0, 62]) for (let j = 0; j < 5; j++) { const yy = y + off + j * 7; page.drawLine({ start: { x: 50, y: PH - yy }, end: { x: w - 50, y: PH - (yy + sl * (w - 100)) }, thickness: 0.7 }); }
    [50, 300].forEach(x => page.drawLine({ start: { x, y: PH - y - sl * (x - 50) }, end: { x, y: PH - (y + 90) - sl * (x - 50) }, thickness: 0.9 }));
    for (let q = 0; q < 8; q++) page.drawEllipse({ x: 70 + q * 60, y: PH - (y + (q % 5) * 7) - sl * (q * 60 + 20), xScale: 4, yScale: 3 });
  }
}
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 2); staffPage(doc, 2); staffPage(doc, 2, { slope: 0.03 }); staffPage(doc, 2, { w: 1190 });
  const bytes = Buffer.from(await doc.save());
  const url = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const load = async () => { await p.goto(url); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes }); await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null, { timeout: 60000 }); await p.waitForTimeout(800); };
  const pick = v => p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const st = () => p.evaluate(() => { const f = document.querySelector('#sysFind'), r = f.getBoundingClientRect(), w = document.querySelector('#stageWrap').getBoundingClientRect(); return { pill: f.classList.contains('on') && getComputedStyle(f).visibility === 'visible', text: document.querySelector('#sysFindT').textContent, bar: parseFloat((document.querySelector('#sysFindFill').style.transform.match(/scaleX\(([\d.]+)/) || [0, 0])[1]) > 0 ? '1%' : '0', fills: !!f.querySelector('.wait-bar b') && !f.querySelector('.busybar'), cx: Math.abs(r.left + r.width / 2 - (w.left + w.width / 2)), cy: Math.abs(r.top + r.height / 2 - (w.top + w.height / 2)), exp: document.querySelector('#btnExport').disabled, hint: document.querySelector('#exportHint').textContent, grey: ['bPlay', 'bTap', 'bSpace', 'bToEnd'].every(id => document.querySelector('#' + id).disabled), lay: S.set.pageLayout, found: [...SYS.byPage.keys()], prog: !!SYS.prog, w: SYS.ws.some(Boolean), old: !!document.querySelector('#sysRun, #sysStop') }; });

  await load();
  await p.evaluate(() => { const o = SYS.run; SYS.lanes = () => 1; SYS.run = function (m, k) { const t = SYS.token; return new Promise(r => setTimeout(r, 700)).then(() => t === SYS.token ? o.call(SYS, m, k) : null); }; });
  await pick('system'); await p.waitForTimeout(200);
  await p.evaluate(() => { SYS.stop(); SYS.byPage.clear(); const i = S.spreads.findIndex(sp => sysPage(sp[1]) === 2), [a, z] = spreadBounds(i); S.time = (a + z) / 2; sysKick(); });          // the playhead sits on page 3
  await p.waitForFunction(() => SYS.byPage.size >= 1 && SYS.prog, null, { timeout: 20000 });
  let s = await st();
  ok('one pill reads Processing N% with a bar along its foot', s.pill && s.fills && /^(Processing…|Processing \d+%)$/.test(s.text) && parseInt(s.bar) > 0, JSON.stringify(s));
  ok('the pill sits centered over the whole stage', s.cx < 2 && s.cy < 2, JSON.stringify([s.cx, s.cy]));
  ok('the status line, its bar, and Stop are gone from Page layout', !s.old);
  ok('Export video is greyed with a reason', s.exp && /^Available once systems are found\.$/.test(s.hint), s.hint);
  ok('Play, Add page turn, Space turns evenly, and Turns to end are greyed', s.grey);
  ok('the page under the playhead is found first', s.found.length > 0 && s.found[0] === 2, JSON.stringify(s.found));
  ok('no per-page labels while finding', await p.evaluate(() => !document.querySelector('#stageWaits .pg-wait, #selWaits .pg-wait')));
  const wv = await p.evaluate(() => { let n = -1; const o = window.selMarkPaint; window.selMarkPaint = (g, list, ...r) => { n = list.length; return o(g, list, ...r); }; selPaint(); window.selMarkPaint = o; return { n, found: SYS.byPage.has(2), key: sysPage(SEL.key) }; });
  ok('while finding, the selector waits with the preview: no Selections, though its own page was found', wv.found && wv.key === 2 && wv.n === 0, JSON.stringify(wv));
  ok('the timeline\'s dim is the shared inactive level', await p.evaluate(() => INACTIVE === parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--inactive'))));
  const lane = await p.evaluate(() => ({ busy: sysBusy() }));
  ok('the timeline is held back while finding', lane.busy);
  await pick('spread'); await p.waitForTimeout(500);
  s = await st();
  ok('choosing Spread ends the finding at once: the pill goes and the worker ends', s.lay === 'spread' && !s.prog && !s.w && !s.pill, JSON.stringify(s));
  ok('Export video and the buttons are back', !s.exp && !s.grey, JSON.stringify(s));

  await load();
  await p.evaluate(() => { SYS.lanes = () => 1; });
  await pick('system'); await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4, null, { timeout: 60000 }); await p.waitForTimeout(100);
  const rv = await p.evaluate(() => ({ rv: !!(TL.rv && TL.rv.blocks), pill: document.querySelector('#sysFind').classList.contains('on'), toast: document.querySelector('#toast') ? document.querySelector('#toast').textContent : '' }));
  ok('when finding ends the blocks come in once with the shared reveal, and the pill goes', rv.rv && !rv.pill, JSON.stringify(rv));
  ok('the scan toast takes the place of "4 pages loaded."', /tilted/.test(rv.toast) && !/loaded/.test(rv.toast), rv.toast);
  await p.emulateMedia({ reducedMotion: 'reduce' }); await load(); await pick('system'); await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4, null, { timeout: 60000 });
  ok('reduced motion shows the timeline at once', await p.evaluate(() => !(TL.rv && TL.rv.blocks)));
  await p.emulateMedia({ reducedMotion: 'no-preference' });

  await load();
  await pick('system'); await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4, null, { timeout: 60000 }); await p.waitForTimeout(600);
  const w = await p.evaluate(() => ({ note: !!document.querySelector('#sysNote, #sysTilt, #sysWide, #sysLevel, #sysSplitGo'), toast: document.querySelector('#toast').textContent, exp: document.querySelector('#btnExport').disabled }));
  ok('Page layout has no scan notes and no Re-kilter or Split spreads buttons', !w.note, JSON.stringify(w));
  ok('one toast names the tilted page, then the two-page scan', w.toast === 'Page 3 is tilted, which can clip its systems. Page 4 is a two-page scan, which hides its systems.', w.toast);
  ok('Export video is available once done', !w.exp);
  ok('when finding ends the selector comes up with its Selections', await p.evaluate(() => { let n = -1; const o = window.selMarkPaint; window.selMarkPaint = (g, list, ...r) => { n = list.length; return o(g, list, ...r); }; selPaint(); window.selMarkPaint = o; return n > 0; }));
  const nt = await p.evaluate(() => [sysNote('tilt', [3, 6, 11]), sysNote('wide', [1, 2]), sysNote('tilt', [0, 1, 2, 3, 4, 5, 6])]);
  ok('three pages are listed with the Oxford comma, two with and, more than five are counted', nt[0] === 'Pages 4, 7, and 12 are tilted, which can clip their systems.' && nt[1] === 'Pages 2 and 3 are two-page scans, which hides their systems.' && nt[2] === '7 pages are tilted, which can clip their systems.', JSON.stringify(nt));
  // a few pages found again after an edit: the toast speaks only for those pages
  await p.evaluate(() => { document.querySelector('#toast').textContent = ''; const r = recipeOf(); r.slots[0].crop = [0, 0, 1, 0.95]; setRecipe(r); rebuildSpreads(false); });
  await p.waitForFunction(() => !SYS.prog && SYS.byPage.size === 4, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const again = await p.evaluate(() => document.querySelector('#toast').textContent);
  ok('finding page 1 again says nothing about pages 3 and 4', !/tilted|two-page/.test(again), again);
  const g = await p.evaluate(() => (window.uiGuard && uiGuard.report ? uiGuard.report() : []));
  ok('uiGuard reports nothing', !g.length, JSON.stringify(g));
  ok('no page errors', !errs.length, errs.join('; '));
  await b.close();
})();
