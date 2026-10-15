// PDF Editor, Add pages: works after any edit sequence, on scans and on pages of different sizes, and says why when it cannot.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-add-pages.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function mk(name, sizes) { const d = await PDFDocument.create(); sizes.forEach(s => d.addPage(s)); const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await d.save()); return f; }
(async () => {
  const A = await mk('kf-add-a.pdf', [[612, 792], [612, 792], [612, 792], [612, 792]]);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html');
  const open = async (f, n) => { await p.setInputFiles('#pdfIn', f); await p.waitForFunction(n => S.pdf && S.pdf.n === n, n); await p.waitForTimeout(1500); await p.evaluate(() => openPdfEditor()); await p.waitForFunction(() => PE.d); await p.waitForTimeout(500); };
  const idle = () => p.waitForFunction(() => !PE.busy, null, { timeout: 60000 });
  const addState = () => p.evaluate(() => ({ busy: !!PE.busy, go: !$('#peAddGo').disabled, at: !$('#peAddAt').disabled, n: S.pdf.n, line: $('#peAddStatus').textContent }));

  // 1. after hiding pages, Clean and Re-kilter, Add pages is reachable and works
  await open(A, 4);
  await p.evaluate(() => { peAct('toggle', 1); });                                           // hide a page
  await p.evaluate(() => peTool('clean')); await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector('#peAll').click(); }); await p.evaluate(() => peCleanGo()); await idle();
  await p.evaluate(() => peTool('skew')); await p.waitForTimeout(500);
  await p.evaluate(() => { document.querySelector('#peAll').click(); }); await p.evaluate(() => peSkewGo()); await idle(); await p.waitForTimeout(400);
  await p.evaluate(() => peTool('pages')); await p.waitForTimeout(500);
  const s1 = await addState();
  ok('After hide, Clean and Re-kilter the editor is not busy and the position dropdown is reachable', !s1.busy && s1.go && s1.at, JSON.stringify(s1));
  await p.evaluate(() => $('#peAddGo').click()); await p.waitForFunction(() => !PE.busy && S.pdf.n === 5);
  const s2 = await addState();
  ok('Add page then adds a page, and the dropdown stays reachable', s2.n === 5 && s2.at && s2.go && s2.line === '', JSON.stringify(s2));

  // 2. pages of different sizes add without error, and a blank page is made like the page before it
  const M = await mk('kf-add-mixed.pdf', [[612, 792], [792, 1224], [595, 842], [1775, 2268]]), IMP = await mk('kf-add-imp.pdf', [[1224, 1584], [300, 400]]);
  await p.evaluate(() => closePdfEditor()); await p.waitForTimeout(400); await open(M, 4);
  const sizeOf = i => p.evaluate(async i => { const pg = await S.pdf.doc.getPage(i + 1), v = pg.getViewport({ scale: 1 }); return [Math.round(v.width), Math.round(v.height)]; }, i);
  const add = async (at) => { const n0 = await p.evaluate(() => S.pdf.n); await p.selectOption('#peAddAt', at); await p.evaluate(() => $('#peAddGo').click()); await p.waitForFunction(n => !PE.busy && (S.pdf.n > n || $('#peAddStatus').textContent), n0); return addState(); };
  const ids = await p.evaluate(() => PE.d.order.slice());
  let r = await add(String(ids[1]));                                                       // after the tabloid page
  ok('A blank page after a tabloid page adds without a message', r.n === 5 && r.line === '', JSON.stringify(r));
  ok('The blank page is the size of the page before it', (await sizeOf(4)).join() === '792,1224', (await sizeOf(4)).join());
  r = await add('end');
  ok('A blank page after the last (very large) page adds without a message', r.n === 6 && r.line === '', JSON.stringify(r));
  ok('That blank page is the size of the last page', (await sizeOf(5)).join() === '1775,2268', (await sizeOf(5)).join());
  await p.evaluate(() => document.querySelector('input[name=peAddKind][value=pdf]').click()); await p.selectOption('#peAddAt', 'start'); await p.setInputFiles('#peAddIn', IMP);
  await p.waitForFunction(() => !PE.busy && (S.pdf.n > 6 || $('#peAddStatus').textContent));
  r = await addState();
  ok('Importing a PDF with other sizes adds all its pages without a message', r.n === 8 && r.line === '' && r.at && r.go, JSON.stringify(r));
  ok('The imported pages keep their own sizes', (await sizeOf(6)).join() === '1224,1584' && (await sizeOf(7)).join() === '300,400', (await sizeOf(6)).join() + ' ' + (await sizeOf(7)).join());

  // 3. when an import cannot work, the line says which cause: locked or unreadable (and the editor is free again)
  const bad = path.join(os.tmpdir(), 'kf-add-bad.pdf'); fs.writeFileSync(bad, 'this is not a pdf at all');
  const lockedBytes = Buffer.from(Buffer.from(await PDFDocument.create().then(async d => { d.addPage([612, 792]); return d.save({ useObjectStreams: false }); })).toString('latin1').replace(/trailer\s*<</, 'trailer\n<< /Encrypt << /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -4 >>'), 'latin1'), locked = path.join(os.tmpdir(), 'kf-add-locked.pdf'); fs.writeFileSync(locked, lockedBytes);
  const tryImport = async f => { const n0 = await p.evaluate(() => S.pdf.n); await p.evaluate(() => $('#peAddStatus').textContent = ''); await p.setInputFiles('#peAddIn', f); await p.waitForFunction(() => !PE.busy && $('#peAddStatus').textContent, null, { timeout: 20000 }).catch(() => {}); const r = await addState(); r.same = r.n === n0; r.err = await p.evaluate(() => $('#peAddStatus').classList.contains('err')); return r; };
  r = await tryImport(bad);
  ok('An unreadable file says it is not a readable PDF, in red, and adds nothing', /not a readable PDF/i.test(r.line) && r.err && r.same && r.at && r.go, JSON.stringify(r));
  r = await tryImport(locked);
  ok('A locked file says it is locked, in red, and adds nothing', /locked/i.test(r.line) && !/read/i.test(r.line) && r.err && r.same && r.at && r.go, JSON.stringify(r));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
