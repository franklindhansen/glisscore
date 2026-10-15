// PDF Editor: Re-kilter remembers the pages it found level, so a greyed Re-kilter button always shows its reason,
// also after switching to another tool and back.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-rekilter-memory.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const d = await PDFDocument.create(); for (let i = 0; i < 3; i++) d.addPage([612, 792]);
  const file = path.join(os.tmpdir(), 'kf-rekilter-memory.pdf'); fs.writeFileSync(file, await d.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  const state = () => p.evaluate(() => ({ off: $('#peSkewGo').disabled, line: $('#peSkewStatus').textContent }));
  const settle = () => p.evaluate(async () => { for (let i = 0; i < 400 && PE.busy; i++) await sleep(25); await sleep(300); });
  await p.evaluate(() => peTool('skew')); await p.waitForTimeout(400);
  const fresh = await state(); ok('Before it runs, Re-kilter is available', !fresh.off, JSON.stringify(fresh));
  await p.evaluate(() => peSkewGo()); await settle();
  const ran = await state(); ok('After finding the pages level, the button is greyed with "Already level."', ran.off && ran.line === 'Already level.', JSON.stringify(ran));
  await p.evaluate(() => peTool('crop')); await p.waitForTimeout(400); await p.evaluate(() => peTool('skew')); await p.waitForTimeout(400);
  const back = await state(); ok('Back from Crop, the greyed button still shows "Already level."', back.off && back.line === 'Already level.', JSON.stringify(back));
  // large view: a page found level says so; a page never tried still points to Re-kilter
  const hint = () => p.evaluate(() => { const h = $('#peOneHint'); return h.classList.contains('on') ? h.textContent : ''; });
  await p.evaluate(() => { PE.skewSeen.delete(PE.d.order[1]); peOneOpen(PE.d.order[0]); }); await p.waitForTimeout(500);
  const tried = await hint(); ok('Large view: a page found level says "Already level"', tried === 'Already level', tried);
  await p.evaluate(() => { peOneClose(); peOneOpen(PE.d.order[1]); }); await p.waitForTimeout(500);
  const never = await hint(); ok('Large view: a page never tried says "Not leveled yet"', /^Not leveled yet/.test(never), never);
  // a change to a page's leveling is a new page: it is forgotten as tried
  await p.evaluate(() => { peOneClose(); }); await p.evaluate(() => peSkewGo()); await settle();
  const again = await state(); ok('Run again: every page is tried, the button is greyed', again.off && again.line === 'Already level.', JSON.stringify(again));
  await p.evaluate(() => { PE.d.slots[PE.d.order[0]].skew = 1; peState(); });
  const edited = await state(); ok('After a page is leveled by hand, Re-kilter is available again and the line goes', !edited.off && edited.line === '', JSON.stringify(edited));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
