// PDF Editor and main view: History lists the steps by name, goes back and forward, and the PDF's steps show up in the main view's History after Done;
// the tool band has one short size for Arrange to Split and one taller for Re-size and Watermark; Auto takes you back from the page that Manual opened.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-history.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 8; i++) { const pg = doc.addPage([612, 792]); if (i !== 2) for (let y = 700; y > 100; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 70 + i * 3, y: y - k * 7 }, end: { x: 540, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), 'kf-history.pdf'); fs.writeFileSync(f, await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', f); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.pdf && S.pdf.n === 8 && S.audio); await p.waitForTimeout(1000);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
  // the two band sizes
  const hs = {}; for (const t of ['pages', 'clean', 'skew', 'crop', 'split', 'resize', 'wm']) { await p.click('#peRail .pe-tab[data-tool=' + t + ']'); await p.waitForTimeout(900); hs[t] = await p.evaluate(() => Math.round(document.querySelector('#peBand').getBoundingClientRect().height)); }
  ok('Arrange, Clean, Re-kilter, Crop and Split share one head size, Re-size and Watermark a taller one', new Set(['pages', 'clean', 'skew', 'crop', 'split'].map(t => hs[t])).size === 1 && hs.resize === hs.wm && hs.resize > hs.pages + 20, JSON.stringify(hs));
  // Manual and Auto
  await p.click('#peRail .pe-tab[data-tool=crop]'); await p.waitForTimeout(1200);
  await p.click('input[name=peCropMode][value=hand]', { force: true }); await p.waitForTimeout(700); const one1 = await p.evaluate(() => PE.one != null);
  await p.click('input[name=peCropMode][value=auto]', { force: true }); await p.waitForTimeout(700); const one2 = await p.evaluate(() => PE.one != null);
  ok('Manual opens one page; Auto goes back to all the pages', one1 && !one2, JSON.stringify({ one1, one2 }));
  await p.evaluate(() => peOneOpen(PE.d.order[1])); await p.waitForTimeout(600);
  await p.click('input[name=peCropMode][value=hand]', { force: true }); await p.waitForTimeout(400); await p.click('input[name=peCropMode][value=auto]', { force: true }); await p.waitForTimeout(500);
  ok('A page you opened yourself stays open when you pick Auto', await p.evaluate(() => PE.one != null));
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  // Re-kilter greys out once it has looked at every ticked page (these pages are already level)
  await p.click('#peRail .pe-tab[data-tool=skew]'); await p.waitForTimeout(900);
  const before = await p.evaluate(() => ({ go: document.querySelector('#peSkewGo').disabled, steps: PE.undo.length })); await p.click('#peSkewGo'); await p.waitForTimeout(3000);
  const after = await p.evaluate(() => ({ go: document.querySelector('#peSkewGo').disabled, steps: PE.undo.length, label: document.querySelector('#peSkewGo').textContent }));
  ok('Re-kilter on pages that are already level adds no step and greys the button out', !before.go && after.go && after.steps === before.steps && after.label === 'Re-kilter', JSON.stringify({ before, after }));
  await p.click('#peRail .pe-tab[data-tool=crop]'); await p.waitForTimeout(800); await p.click('#peRail .pe-tab[data-tool=skew]'); await p.waitForTimeout(800);
  ok('and it stays grey when you come back to it', await p.evaluate(() => document.querySelector('#peSkewGo').disabled));
  // history
  await p.click('#peRail .pe-tab[data-tool=clean]'); await p.waitForTimeout(900); await p.click('#peCleanGo'); await p.waitForTimeout(700);
  await p.click('#peRail .pe-tab[data-tool=pages]'); await p.waitForTimeout(900); await p.click('#peAddGo'); await p.waitForTimeout(2500);
  ok('History is enabled once there is a step', await p.evaluate(() => !document.querySelector('#peHistBtn').disabled));
  await p.click('#peHistBtn'); await p.waitForTimeout(500);
  const names = await p.evaluate(() => [...document.querySelectorAll('#peHistList .hs-n')].map(e => e.textContent));
  ok('The steps are named, newest first', names.join('|') === 'Inserted 1 page|Clean|Opened', names.join('|'));
  await p.click('#peHistList .hs-row:nth-child(2) .hs-btn'); await p.waitForTimeout(400);
  const sum = await p.evaluate(() => document.querySelector('#peHistSum').textContent); await p.click('#peHistGo'); await p.waitForTimeout(800);
  const st = await p.evaluate(() => ({ n: PE.d.order.length, undo: PE.undo.length, redo: PE.redo.length, open: PE_HIST.isOpen() }));
  ok('Going back to Clean undoes the insert, keeps it to redo, and closes the list', /Undo 1 change/.test(sum) && st.n === 8 && st.undo === 1 && st.redo === 1 && !st.open, JSON.stringify({ sum, st }));
  await p.click('#peHistBtn'); await p.waitForTimeout(400); await p.click('#peHistList .hs-row:nth-child(1) .hs-btn'); await p.waitForTimeout(300); await p.click('#peHistGo'); await p.waitForTimeout(800);
  ok('Going forward again puts the insert back', await p.evaluate(() => PE.d.order.length === 9 && PE.redo.length === 0));
  // main view
  await p.click('#peDone'); await p.waitForTimeout(1500);
  ok('The main view\'s History is enabled after Done', await p.evaluate(() => !document.querySelector('#bHist').disabled));
  await p.click('#bHist'); await p.waitForTimeout(500);
  const mn = await p.evaluate(() => [...document.querySelectorAll('#mHistList .hs-n')].map(e => e.textContent));
  ok('The main History names the PDF Editor\'s changes', /^PDF: /.test(mn[0]) && mn[mn.length - 1] === 'Opened', mn.join('|'));
  await p.click('#mHistList .hs-row:last-child .hs-btn'); await p.waitForTimeout(300); await p.click('#mHistGo'); await p.waitForTimeout(900);
  ok('Going back in the main History brings the pages back as they were', await p.evaluate(() => S.pdf.keep.length === 8 && S.history.length === 0 && S.redo.length === 1), await p.evaluate(() => JSON.stringify({ keep: S.pdf.keep.length, h: S.history.length, r: S.redo.length })));
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
