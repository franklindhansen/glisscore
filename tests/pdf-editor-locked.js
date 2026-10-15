// Locked and restricted PDFs: the password prompt, Skip, and which buttons stay available (with a visible reason).
// Needs the fixtures:  python3 tests/make-pdf-locked-fixtures.py   (and tests/make-fixtures.py for score.pdf)
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-locked.js
const { chromium } = require('playwright-core'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const fx = n => path.join(__dirname, 'fixtures', n);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html');
  const dlgBtn = name => p.locator('#pwDlg button', { hasText: name });
  const askShown = async () => { try { await p.waitForSelector('#pwDlg:not([hidden])', { timeout: 5000 }); return true; } catch (e) { return false; } };
  const pick = async f => { await p.setInputFiles('#pdfIn', fx(f)); };
  const loaded = async () => { await p.waitForFunction(() => S.pdf, null, { timeout: 15000 }); await p.waitForTimeout(1200); };
  const reasons = () => p.evaluate(() => { openPdfEditor(); return null; }).then(() => p.waitForFunction(() => PE.d)).then(() => p.waitForTimeout(400)).then(() => p.evaluate(() => { peTool('pages'); return null; })).then(() => p.waitForTimeout(500)).then(() => p.evaluate(() => ({ add: !$('#peAddGo').disabled, at: !$('#peAddAt').disabled, exp: !$('#peExport').disabled, lines: [...document.querySelectorAll('#peBand .pe-status, #peCount')].map(e => e.textContent).filter(Boolean).join(' | ') })));

  // 1. a restricted PDF asks for its owner password; Skip opens it read-only
  await pick('pdf-restricted.pdf');
  ok('A restricted PDF asks for its owner password', await askShown());
  ok('The prompt offers Skip', await dlgBtn('Skip').count() === 1 && await dlgBtn('Skip').isVisible());
  await dlgBtn('Skip').click(); await loaded();
  const r1 = await reasons();
  ok('Skip opens it read-only: Add pages and Export are unavailable, each with a reason', !r1.add && !r1.at && !r1.exp && /restricted/i.test(r1.lines), JSON.stringify(r1));

  const toastNow = () => p.evaluate(() => $('#toast').classList.contains('show') ? $('#toast').textContent : '');
  const fresh = async () => { await p.reload(); await p.waitForFunction(() => typeof loadPdf === 'function'); };
  const type = async (pw, btn) => { await p.fill('#pwIn', pw); await p.click('#pwOk'); await p.waitForTimeout(700); };

  // 2. the owner password unlocks it; a wrong one can retry
  await fresh(); await pick('pdf-restricted.pdf'); await askShown();
  await type('nope');
  ok('A wrong owner password says so and the prompt stays for a retry', await p.evaluate(() => getComputedStyle($('#pwDlg')).display !== 'none' && $('#pwErrFold').offsetHeight > 0 && !S.pdf));
  await type('boss'); await loaded();
  const r2 = await reasons();
  ok('The right owner password opens it like an unrestricted PDF', r2.add && r2.at && r2.exp && r2.lines.replace(/[ |]/g, '').match(/restricted|locked/i) === null, JSON.stringify(r2));

  // 3. a PDF that needs a password to open stays locked
  await fresh(); await pick('pdf-user-password.pdf'); await askShown();
  ok('A locked PDF asks for its password with Cancel, not Skip', await dlgBtn('Cancel').isVisible() && await dlgBtn('Skip').isHidden());
  await type('wrong'); await type('open'); await loaded();
  const r3 = await reasons();
  ok('Opened with its password, Add pages and Export stay unavailable, with a reason', !r3.add && !r3.exp && /locked/i.test(r3.lines), JSON.stringify(r3));

  // 4. a certificate-encrypted PDF gets the existing could-not-read message
  await fresh(); await pick('pdf-certificate.pdf'); await p.waitForTimeout(1500);
  ok('A certificate-encrypted PDF shows the could-not-read toast and opens nothing', /Could not read this PDF/.test(await toastNow()) && !(await p.evaluate(() => !!S.pdf)), await toastNow());

  // 5. an unlocked PDF after a locked or restricted one restores everything
  for (const f of ['pdf-restricted.pdf', 'pdf-user-password.pdf']) {
    await fresh(); await pick(f); await askShown();
    if (f === 'pdf-restricted.pdf') await dlgBtn('Skip').click(); else await type('open');
    await loaded(); await reasons();
    await p.evaluate(() => closePdfEditor()); await p.waitForTimeout(400);
    await pick('score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.name === 'score'); await p.waitForTimeout(1200);
    const r5 = await reasons();
    ok('After ' + f + ', loading an unlocked PDF restores Add pages and Export and clears the reasons', r5.add && r5.at && r5.exp && !/Not available/.test(r5.lines), JSON.stringify(r5));
  }

  // 6. a failed Export still shows its toast
  await p.evaluate(() => { window.buildPdfBlob = async () => { throw new Error('boom'); }; });
  await p.evaluate(() => $('#peExport').click()); await p.waitForTimeout(1200);
  ok('A failed Export still shows its toast', /Could not export the PDF/.test(await toastNow()), await toastNow());

  // 7. Export: an encrypted PDF unlocked with its owner password exports readable pages; a plain PDF still exports as live text
  const inspect = (rot) => p.evaluate(async rot => {
    const r = recipeOf(); if (rot) r.slots[0].rot = rot; const blob = await buildPdfBlob(r, null), lib = await getPdfjs(), doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise, out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i), vp = pg.getViewport({ scale: 1 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); await pg.render({ canvasContext: cx, viewport: vp }).promise;
      const d = cx.getImageData(0, 0, cv.width, cv.height).data; let dark = 0; for (let k = 0; k < d.length; k += 4) if (d[k] < 128) dark++;
      out.push({ w: Math.round(vp.width), h: Math.round(vp.height), dark, text: (await pg.getTextContent()).items.map(t => t.str).join('') });
    }
    return out;
  }, rot);
  await fresh(); await pick('pdf-restricted.pdf'); await askShown(); await type('boss'); await loaded();
  const e1 = await inspect();
  ok('An unlocked restricted PDF exports every page, readable (not blank), at the page size', e1.length === 3 && e1.every(x => x.dark > 200 && x.w === 400 && x.h === 560), JSON.stringify(e1.map(x => [x.w, x.h, x.dark])));
  const e3 = await inspect(90);
  ok('A rotated page of an unlocked restricted PDF exports turned and readable', e3[0].w === 560 && e3[0].h === 400 && e3[0].dark > 200 && e3[1].w === 400, JSON.stringify(e3.map(x => [x.w, x.h, x.dark])));
  await fresh(); await pick('score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(1200);
  const e2 = await inspect();
  ok('A plain PDF still exports as live text, not pictures', e2.length === 3 && e2.every((x, i) => x.text === 'Page ' + (i + 1) && x.dark > 200), JSON.stringify(e2.map(x => [x.text, x.dark])));

  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
