// PDF Editor: Crop with Auto starts out working and greyed the moment it opens, and Manual frees the pages at once.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-crop-start.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  await p.evaluate(() => { PE.raw = new Map(); window.__gate = new Promise(r => { window.__open = r; }); const raw = peRawBox; peRawBox = async sl => { await window.__gate; return raw(sl); }; });          // nothing is read until the gate opens
  const state = () => p.evaluate(() => ({ waiting: $('#peWin').classList.contains('waiting'), events: getComputedStyle(document.querySelector('#peGrid .page-card')).pointerEvents, btn: $('#peCropAuto').textContent.trim() }));
  await p.evaluate(() => peTool('crop'));
  const first = await state();
  ok('Auto opens already working and greyed, with no wait for the first look', first.waiting && first.events === 'none', JSON.stringify(first));
  await p.evaluate(() => document.querySelector('input[name=peCropMode][value=hand]').click()); await p.waitForTimeout(60);
  const hand = await state();
  ok('Manual frees the pages at once', !hand.waiting && hand.events !== 'none', JSON.stringify(hand));
  await p.evaluate(() => document.querySelector('input[name=peCropMode][value=auto]').click()); await p.waitForTimeout(60);
  const back = await state();
  ok('Auto again starts out working and greyed', back.waiting && back.events === 'none', JSON.stringify(back));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
