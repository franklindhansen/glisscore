// Page turns you moved come back when a score is loaded again: after a replace, after Remove, and even when a one-page score is opened in between.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-turns.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function mk(name, n) { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([612, 792]); const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await d.save()); return f; }
(async () => {
  const A = await mk('kf-turns-a.pdf', 6), B = await mk('kf-turns-b.pdf', 6), One = await mk('kf-turns-one.pdf', 1);
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html');
  const load = async f => { await p.setInputFiles('#pdfIn', f); await p.waitForTimeout(1500); };
  const st = () => p.evaluate(() => ({ t: S.turns.map(x => +x.toFixed(2)), e: S.turnsEdited })), mine = '3,4.7,6.4';
  await load(A); await p.evaluate(() => { S.turns = S.turns.map((t, i) => 3 + i * 1.7); S.turnsEdited = true; onTurnsChanged(); });
  await load(B); let s = await st(); ok('Another score of the same length keeps the turns', s.t.join() === mine && s.e, JSON.stringify(s));
  await p.evaluate(() => removePdf()); await load(A); s = await st(); ok('Remove, then open a score: the turns come back', s.t.join() === mine && s.e, JSON.stringify(s));
  await p.evaluate(() => removePdf()); await load(One); await p.evaluate(() => removePdf()); await load(B); s = await st(); ok('A one-page score in between does not lose them', s.t.join() === mine && s.e, JSON.stringify(s));
  await p.evaluate(() => removePdf()); await load(One); await load(B); s = await st(); ok('Nor does opening a one-page score over another', s.t.join() === mine && s.e, JSON.stringify(s));
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
