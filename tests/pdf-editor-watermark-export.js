// Watermark: pages are ticked first (all ticked to begin with), then the Watermark button adds it to the ticked pages only; once it is on, ticks change the pages at once; Remove takes it off.
// Export PDF: the button fills with a percent as it goes, Stop ends it, and edits made while it runs do not reach the file (it works from a copy).
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-watermark-export.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(1200);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800); await p.click('#peRail .pe-tab[data-tool=wm]'); await p.waitForTimeout(700);
  const st = () => p.evaluate(() => ({ on: PE.d.wm.on, nw: PE.d.order.map(id => !!PE.d.slots[id].nw), ticks: [...document.querySelectorAll('#peGrid .page-card')].map(c => c.getAttribute('aria-label').includes('not selected') ? 0 : 1), add: !document.querySelector('#peWmAdd').disabled, addShown: !document.querySelector('#peWmAdd').hidden, rm: !document.querySelector('#peWmRemove').hidden, undo: PE.undo.length }));
  const s0 = await st(); ok('before adding: every page is ticked and the Watermark button is ready', !s0.on && s0.ticks.every(x => x) && s0.add && s0.addShown && s0.undo === 0, JSON.stringify(s0));
  const n = s0.ticks.length; if (n < 2) { ok('the test file has two pages', false, String(n)); await b.close(); return; }
  await p.click('#peGrid .page-card:nth-child(2)'); await p.waitForTimeout(300); const s1 = await st();
  ok('unticking a page before adding changes nothing yet', !s1.on && s1.ticks[1] === 0 && s1.nw.every(x => !x) && s1.undo === 0, JSON.stringify(s1));
  await p.click('#peWmAdd'); await p.waitForTimeout(500); const s2 = await st();
  ok('the Watermark button adds it to the ticked pages only', s2.on && s2.nw[1] === true && s2.nw.filter(x => x).length === 1 && s2.ticks[1] === 0 && s2.ticks[0] === 1 && s2.rm && !s2.addShown, JSON.stringify(s2));
  await p.click('#peGrid .page-card:nth-child(2)'); await p.waitForTimeout(300); const s3 = await st();
  ok('once on, ticking a page puts it back at once', s3.on && s3.nw.every(x => !x) && s3.ticks[1] === 1, JSON.stringify(s3));
  await p.click('#peWmRemove'); await p.waitForTimeout(400); const s4 = await st();
  ok('Remove takes it off and every page is ticked again', !s4.on && s4.ticks.every(x => x) && s4.addShown, JSON.stringify(s4));
  await p.click('#peNone'); await p.waitForTimeout(300); const s5 = await st(); ok('with no page ticked the Watermark button is greyed out', !s5.add && s5.ticks.every(x => !x), JSON.stringify(s5));
  await p.click('#peAll'); await p.waitForTimeout(300);
  // export: each page takes a moment here so the progress can be seen
  await p.evaluate(() => { const orig = loadPdfLib; window.__origLoad = orig; window.loadPdfLib = async () => { const L = await orig(), C = L.PDFDocument.create.bind(L.PDFDocument); L.PDFDocument.create = async () => { const o = await C(), cp = o.copyPages.bind(o); o.copyPages = async (...a) => { await new Promise(r => setTimeout(r, 250)); return cp(...a); }; return o; }; return L; }; });
  const ex = await p.evaluate(async () => {
    const orig0 = window.__origLoad; const orig2 = () => orig0(), out = {}; let blobText = null, pages = 0; window.saveFile = async blob => { blobText = blob.size; pages = (await (await orig2()).PDFDocument.load(new Uint8Array(await blob.arrayBuffer()))).getPageCount(); };
    PE.d.wm.on = true; PE.d.wm.text = 'FIRST'; const btn = document.querySelector('#peExport'), seen = [], iv = setInterval(() => seen.push(btn.textContent + '|' + btn.style.getPropertyValue('--p') + '|' + btn.classList.contains('exporting') + '|' + !document.querySelector('#peExpStop').hidden), 20);
    const run = btn.click(); await new Promise(r => setTimeout(r, 30)); PE.d.wm.text = 'SECOND'; PE.d.order.forEach(id => { PE.d.slots[id].x = id > 0; });          // edits made while it runs
    for (let i = 0; i < 400 && PE.exporting; i++) await new Promise(r => setTimeout(r, 50)); clearInterval(iv);
    out.seen = seen.filter((x, i) => i === 0 || x !== seen[i - 1]).slice(0, 8); out.size = blobText; out.pages = pages; out.after = btn.textContent; out.stopHidden = document.querySelector('#peExpStop').hidden; out.cls = btn.classList.contains('exporting'); return out; });
  ok('the Export PDF button fills with a percent, shows Stop while it runs and is back to normal after', ex.seen.some(x => /Processing( \d+%|\.\.\.|…)/.test(x)) && /true\|true$/.test(ex.seen.find(x => /true\|true$/.test(x)) || '') && ex.after === 'Export PDF' && ex.stopHidden && !ex.cls && ex.size > 0, JSON.stringify(ex));
  const stp = await p.evaluate(async () => { const o = {}; let saved = 0; window.saveFile = async () => { saved++; }; PE.d.order.forEach(id => { PE.d.slots[id].x = false; }); const btn = document.querySelector('#peExport'); btn.click(); await new Promise(r => setTimeout(r, 15)); document.querySelector('#peExpStop').click();
    for (let i = 0; i < 200 && PE.exporting; i++) await new Promise(r => setTimeout(r, 25)); o.saved = saved; o.after = btn.textContent; o.toast = document.querySelector('#toast').textContent; return o; });
  ok('edits made while the export runs do not reach the file (it still has all three pages)', ex.pages === 3, JSON.stringify(ex.pages));
  ok('Stop ends the export without saving and says so', stp.saved === 0 && stp.after === 'Export PDF' && /stopped/i.test(stp.toast), JSON.stringify(stp));
  ok('no page errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
