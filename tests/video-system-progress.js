// Video, System layout: the progress line, the Stop button, Export video held back, and the reason lines for a tilted page and a two-page scan.
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
  const st = () => p.evaluate(() => ({ run: !document.querySelector('#sysRun').hidden, text: document.querySelector('#sysRunT').textContent, bar: document.querySelector('#sysBarFill').style.width, exp: document.querySelector('#btnExport').disabled, hint: document.querySelector('#exportHint').textContent, lay: S.set.pageLayout, found: [...SYS.byPage.keys()], prog: !!SYS.prog, w: !!SYS.w }));

  await load();
  await p.evaluate(() => { const o = SYS.run; SYS.run = function (m) { const t = SYS.token; return new Promise(r => setTimeout(r, 700)).then(() => t === SYS.token ? o.call(SYS, m) : null); }; });
  await pick('system'); await p.waitForTimeout(200);
  await p.evaluate(() => { SYS.stop(); SYS.byPage.clear(); const i = S.spreads.findIndex(sp => sysPage(sp[1]) === 2), [a, z] = spreadBounds(i); S.time = (a + z) / 2; sysKick(); });          // the playhead sits on page 3
  await p.waitForTimeout(1200);
  let s = await st();
  ok('the status line reads Finding systems… N of 4 with a bar', s.run && /^Finding systems… \d of 4$/.test(s.text) && parseInt(s.bar) > 0, JSON.stringify(s));
  ok('Export video is greyed with a reason', s.exp && /found/.test(s.hint), s.hint);
  ok('the page under the playhead is found first', s.found.length > 0 && s.found[0] === 2, JSON.stringify(s.found));
  const wp = await p.evaluate(() => ({ on: WIPE.on, front: WIPE.front, own: [...WIPE.own.keys()], p0: wipeProg(0), p2: wipeProg(2) }));
  ok('the wipe waits at the first page not loaded, and the page loaded ahead wipes on its own', wp.on && wp.front === 0 && wp.own.includes(2) && wp.p0 === 0 && wp.p2 > 0, JSON.stringify(wp));
  await p.click('#sysStop'); await p.waitForTimeout(500);
  s = await st();
  ok('Stop returns to the previous layout and ends the worker', s.lay === 'spread' && !s.prog && !s.w && !s.run, JSON.stringify(s));
  ok('Export video is back, and the finished pages are kept', !s.exp && s.found.length >= 1 && s.found.length < 4, JSON.stringify(s));

  await p.emulateMedia({ reducedMotion: 'reduce' }); await load();
  await p.evaluate(() => { const o = SYS.run; SYS.run = function (m) { const t = SYS.token; return new Promise(r => setTimeout(r, 700)).then(() => t === SYS.token ? o.call(SYS, m) : null); }; });
  await pick('system'); await p.waitForFunction(() => SYS.byPage.size >= 1, null, { timeout: 30000 });
  const rm = await p.evaluate(() => { const f = [...SYS.byPage.keys()][0]; return { on: WIPE.on, loaded: wipeProg(f), other: wipeProg([0, 1, 2, 3].find(q => !SYS.byPage.has(q))), pop: sysPop(f, 5) }; });
  ok('reduced motion shows each page clear as it loads, with no wipe', !rm.on && rm.loaded === 1 && rm.other === 0 && rm.pop === 1, JSON.stringify(rm));
  await p.emulateMedia({ reducedMotion: 'no-preference' });

  await load();
  await pick('system'); await p.waitForFunction(() => !SYS.prog && SYS.warn, null, { timeout: 60000 }); await p.waitForTimeout(300);
  const w = await p.evaluate(() => ({ tilt: !document.querySelector('#sysTilt').hidden, tt: document.querySelector('#sysTiltT').textContent, wide: !document.querySelector('#sysWide').hidden, wt: document.querySelector('#sysWide').textContent, exp: document.querySelector('#btnExport').disabled, run: !document.querySelector('#sysRun').hidden }));
  ok('a tilted page gets a reason line with Level these pages', w.tilt && w.tt === '1 page is tilted.', JSON.stringify(w));
  ok('a two-page scan points to Split spreads', w.wide && /Split spreads/.test(w.wt), w.wt);
  ok('Export video is available once done', !w.exp && !w.run);
  await p.waitForFunction(() => !WIPE.on, null, { timeout: 20000 });
  ok('the wipe ends with every block clear and every handle in', await p.evaluate(() => sysBlocks().filter(q => q.page != null).every(q => wipeProg(q.page) === 1 && sysPop(q.page, 3) === 1)));
  const g = await p.evaluate(() => (window.uiGuard && uiGuard.report ? uiGuard.report() : []));
  ok('uiGuard reports nothing', !g.length, JSON.stringify(g));
  const before = await p.evaluate(() => ({ h: S.history.length }));
  await p.click('#sysLevel'); await p.waitForFunction(() => !SYS.leveling, null, { timeout: 60000 }); await p.waitForTimeout(500);
  const after = await p.evaluate(() => ({ h: S.history.length, sk: S.pdf.slots.map(s => s.skew || 0), tilt: !document.querySelector('#sysTilt').hidden }));
  ok('Level these pages levels only the tilted page', after.sk[2] !== 0 && after.sk[0] === 0 && after.sk[1] === 0 && after.sk[3] === 0, JSON.stringify(after.sk));
  ok('it is one History step', after.h === before.h + 1, JSON.stringify([before.h, after.h]));
  ok('the reason line goes once the page is level', !after.tilt);
  await p.click('#bUndo'); await p.waitForTimeout(400);
  ok('Undo brings the tilt back', await p.evaluate(() => (S.pdf.slots[2].skew || 0) === 0));
  ok('no page errors', !errs.length, errs.join('; '));
  await b.close();
})();
