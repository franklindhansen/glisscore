// Re-size works like Crop and the other tools: picking a paper size only shows the choice, nothing changes and no History step is made until the Re-size button is pressed;
// the button is greyed out when there is nothing to apply, one press is one step, and Undo takes it back.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-resize.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(1200);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800); await p.click('#peRail .pe-tab[data-tool=resize]'); await p.waitForTimeout(900);
  const st = () => p.evaluate(() => ({ undo: PE.undo.length, size: PE.d.size ? [PE.d.size.w, PE.d.size.h] : null, go: !document.querySelector('#peRzGo').disabled, now: document.querySelector('#peRzNew').textContent, sel: Array.from(document.querySelectorAll('.rz-opt[aria-pressed=true]')).map(x => x.dataset.k) }));
  const s0 = await st(); ok('before a choice: no step, Re-size greyed out', s0.undo === 0 && !s0.go && s0.size === null, JSON.stringify(s0));
  await p.click('.rz-opt[data-k=tabloid]'); await p.waitForTimeout(500); const s1 = await st();
  ok('choosing a size changes nothing yet and makes no step, but shows the choice and enables Re-size', s1.undo === 0 && s1.size === null && s1.go && s1.sel[0] === 'tabloid' && /11/.test(s1.now), JSON.stringify(s1));
  await p.click('.rz-opt[data-k=a4]'); await p.waitForTimeout(300); await p.click('.rz-opt[data-k=letter]'); await p.waitForTimeout(300); const s2 = await st();
  ok('changing the choice again is still no step', s2.undo === 0 && s2.size === null && s2.sel[0] === 'letter', JSON.stringify(s2));
  await p.click('.rz-opt[data-k=orig]'); await p.waitForTimeout(300); const s3 = await st(); ok('going back to Original greys Re-size out again', !s3.go && s3.undo === 0, JSON.stringify(s3));
  await p.click('.rz-opt[data-k=tabloid]'); await p.waitForTimeout(300); await p.click('#peRzGo'); await p.waitForTimeout(900); const s4 = await st();
  ok('pressing Re-size applies it as one step and greys the button out', s4.undo === 1 && s4.size && s4.size[0] === 11 && s4.size[1] === 17 && !s4.go && s4.sel[0] === 'tabloid', JSON.stringify(s4));
  await p.click('.rz-opt[data-k=a3]'); await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#peRail .pe-tab[data-tool=pages]').click(); }); await p.waitForTimeout(500); await p.click('#peRail .pe-tab[data-tool=resize]'); await p.waitForTimeout(600); const s5 = await st();
  ok('an unapplied choice is dropped when you change tools', s5.undo === 1 && s5.sel[0] === 'tabloid' && !s5.go, JSON.stringify(s5));
  await p.click('.rz-opt[data-k=custom]'); await p.fill('#peRzW', '7'); await p.fill('#peRzH', '10'); await p.waitForTimeout(300); const s6 = await st();
  ok('a custom size also waits for the button', s6.undo === 1 && s6.go && s6.sel[0] === 'custom', JSON.stringify(s6));
  await p.click('#peRzGo'); await p.waitForTimeout(800); const s7 = await st(); ok('and applies as a step', s7.undo === 2 && s7.size[0] === 7 && s7.size[1] === 10, JSON.stringify(s7));
  await p.evaluate(() => peUndo()); await p.waitForTimeout(500); const s8 = await st(); ok('Undo takes the last size back', s8.undo === 1 && s8.size && s8.size[0] === 11 && !s8.go, JSON.stringify(s8));
  ok('no page errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
