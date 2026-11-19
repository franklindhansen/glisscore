// PDF Editor page range: Shift-click a run of pages, and the Pages field (the PDF's own page numbers, as ranges) in Arrange and in the tools that tick.
// Run with the app served (PORT, default 8123):  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-page-range.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const d = await PDFDocument.create(); for (let i = 0; i < 12; i++) d.addPage([612, 792]); const f = path.join(os.tmpdir(), 'kf-range.pdf'); fs.writeFileSync(f, await d.save());
  const b = await chromium.launch(), errs = [];
  const open = async w => { const p = await b.newPage({ viewport: { width: w, height: 900 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message + ' @ ' + String(e.stack).split('\n').slice(1, 4).join(' | '))); p.on('requestfailed', r => errs.push('request failed: ' + r.url() + ' ' + (r.failure() || {}).errorText)); p.on('response', r => { if (r.status() >= 400) errs.push('response ' + r.status() + ': ' + r.url()); }); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', f); await p.waitForTimeout(1500); await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(700); return p; };
  const p = await open(1300);
  const field = () => p.inputValue('#pePages'), count = () => p.textContent('#peCount'), steps = () => p.evaluate(() => PE.undo.length);
  const act = () => p.evaluate(() => PE.d.order.filter(id => !PE.d.slots[id].x).map(id => PE.d.slots[id].src + 1).join(','));
  const card = n => '#peGrid .page-card:nth-child(' + n + ') .pe-thumb';
  const type = async t => { await p.fill('#pePages', t); await p.press('#pePages', 'Enter'); await p.waitForTimeout(250); };
  ok('Arrange: the field shows every page as one range', (await field()) === '1-12', await field());
  ok('the field has the name Pages and no visible label', await p.evaluate(() => $('#pePages').getAttribute('aria-label') === 'Pages' && !document.querySelector('label[for=pePages]')));
  ok('the field sits between the count and Select all', await p.evaluate(() => { const c = $('#peCount').getBoundingClientRect(), f = $('#pePages').getBoundingClientRect(), a = $('#peAll').getBoundingClientRect(); return c.right <= f.left + 1 && f.right <= a.left + 1 && Math.abs(f.height - 30) < 0.5; }));
  // Shift-click
  await p.click(card(2)); await p.waitForTimeout(300); await p.click(card(5), { modifiers: ['Shift'] }); await p.waitForTimeout(400);
  ok('Shift-click: every page from the first click to the second takes the first click\'s state', (await act()) === '1,6,7,8,9,10,11,12', await act());
  ok('the field follows', (await field()) === '1, 6-12', await field());
  ok('the count follows', (await count()) === '8 / 12 pages active', await count());
  ok('Shift-click is one History step (the first click was one)', (await steps()) === 2, await steps() + '');
  await p.click(card(4), { modifiers: ['Shift'] }); await p.waitForTimeout(300);
  ok('Shift-click again from the same page runs to the new one', (await act()) === '1,6,7,8,9,10,11,12');
  await p.click('#peUndo'); await p.waitForTimeout(400);
  ok('Undo takes the whole run back at once', (await act()) === '1,2,3,4,5,6,7,8,9,10,11,12' || (await act()) === '1,3,4,5,6,7,8,9,10,11,12', await act());
  await p.evaluate(() => peReset()); await p.waitForTimeout(300);
  // the field
  const s0 = await steps();
  await type('3-5, 9'); ok('Typing "3-5, 9" makes exactly those pages active', (await act()) === '3,4,5,9', await act());
  ok('it is one History step', (await steps()) === s0 + 1, s0 + ' → ' + (await steps()));
  ok('the field shows the ranges', (await field()) === '3-5, 9', await field());
  await type('3-5, 9'); ok('typing the same pages makes no step', (await steps()) === s0 + 1);
  await type('2–4'); ok('an en dash is accepted', (await act()) === '2,3,4', await act());
  await type(' 1 , 7-8 '); ok('spaces are allowed', (await act()) === '1,7,8', await act());
  const st = await steps(), cur = await act(), originalCount = await count();
  for (const [t, why] of [['13', 'a number past the last page'], ['abc', 'text it cannot read'], ['5-2', 'a backwards range'], ['', 'nothing'], ['1,,3', 'a stray comma'], ['0', 'page 0']]) {
    await type(t);
    ok('"' + t + '" (' + why + ') changes nothing, restores the field, and says why', (await act()) === cur && (await steps()) === st && (await field()) === '1, 7-8' && (await count()) === originalCount && await p.evaluate(() => $('#peToast').classList.contains('show') && $('#peToast').textContent.length > 8), await count());
  }
  await p.fill('#pePages', '9'); await p.press('#pePages', 'Escape'); await p.waitForTimeout(200);
  ok('Escape puts the field back and keeps the editor open', (await field()) === '1, 7-8' && await p.evaluate(() => !$('#pdfDlg').hidden));
  await p.click('#peUndo'); await p.waitForTimeout(300); ok('Undo: the field follows', (await field()) === '2-4', await field());
  await p.click('#peRedo'); await p.waitForTimeout(300); ok('Redo: the field follows', (await field()) === '1, 7-8', await field());
  await p.click('#peAll'); await p.waitForTimeout(300); ok('Select all: the field follows', (await field()) === '1-12', await field());
  // a number names every copy
  await p.evaluate(() => peReset()); await p.evaluate(() => peAct('dup', PE.d.order[2])); await p.waitForTimeout(600);
  await type('3'); ok('a number names every copy of that page', await p.evaluate(() => PE.d.order.filter(id => !PE.d.slots[id].x).every(id => PE.d.slots[id].src === 2) && PE.d.order.filter(id => !PE.d.slots[id].x).length === 2));
  await type('1-12'); ok('and the field reads "1-12" with the repeat counted once', (await field()) === '1-12', await field());
  await p.evaluate(() => peReset()); await p.waitForTimeout(300);
  // the numbers do not shift when pages are left out
  await type('1-4'); await type('3-4'); ok('page numbers do not shift when pages are left out', (await act()) === '3,4' && (await field()) === '3-4', await act());
  await p.evaluate(() => peReset()); await p.waitForTimeout(300);
  // tools that tick
  for (const m of ['clean', 'skew', 'crop', 'split', 'wm']) {
    await p.evaluate(m => peTool(m), m); await p.waitForTimeout(800);
    ok(m + ': the Pages field shows', await p.isVisible('#pePages'));
    const ticked = () => p.evaluate(() => PE.d.order.filter(id => peCan(id) && peTicked(id)).map(id => PE.d.slots[id].src + 1).join(','));
    if (m === 'split') { await p.evaluate(() => { PE.splitSel = new Set(PE.d.order); peState(); }); }
    await type('2-4, 9');
    ok(m + ': typing sets exactly those pages ticked', (await ticked()) === '2,3,4,9', await ticked());
    ok(m + ': the field and count follow', (await field()) === '2-4, 9' && (await count()).startsWith('4 / 12'), (await field()) + ' / ' + (await count()));
    await p.click(card(6)); await p.waitForTimeout(200); await p.click(card(8), { modifiers: ['Shift'] }); await p.waitForTimeout(300);
    ok(m + ': Shift-click ticks the run', (await ticked()) === '2,3,4,6,7,8,9' || (await ticked()) === '2,3,4,9', await ticked());
    await p.click('#peNone'); await p.waitForTimeout(200); ok(m + ': Deselect all empties the field', (await field()) === '', await field());
  }
  await p.evaluate(() => { peTool('pages'); }); await p.waitForTimeout(600);
  for (const m of ['dim', 'resize']) { await p.evaluate(m => peTool(m), m); await p.waitForTimeout(700); ok(m + ': no Pages field is shown', !(await p.isVisible('#pePages'))); }
  await p.evaluate(() => peTool('pages')); await p.waitForTimeout(600);
  await p.evaluate(() => { PE.busy = true; peState(); }); ok('the field is disabled while a tool is working', await p.isDisabled('#pePages')); await p.evaluate(() => { PE.busy = false; peState(); });
  await p.close();
  // narrow
  for (const w of [393, 375, 320]) {
    const q = await open(w);
    const m = await q.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(), bar = r('#peBar'), c = r('#peCount'), f = r('#pePages'), a = r('#peAll'), n = r('#peNone'); return { txt: $('#peCount').textContent, bh: bar.height, ok: c.right <= f.left + 1 && f.right <= a.left + 1 && a.right <= n.left + 1 && n.right <= bar.right + 1 && c.left >= bar.left, cw: c.width, sw: document.documentElement.scrollWidth <= innerWidth, line: Math.abs(c.top + c.height / 2 - (f.top + f.height / 2)) < 3 }; });
    ok(w + 'px: the count is shortened to "12 / 12"', m.txt === '12 / 12', m.txt);
    ok(w + 'px: the bar is one row, nothing overlaps', m.bh < 56 && m.ok && m.line, JSON.stringify(m));
    await q.close();
  }
  ok('no page errors', !errs.length, errs.join(' | ').slice(0, 200));
  await b.close();
})().catch(e => { console.log('FAIL crashed — ' + e.message); process.exit(1); });
