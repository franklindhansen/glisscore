// PDF Editor, Clean: whitens the paper (White) or levels it to the scan's own tone (Page color), and takes out specks that touch nothing
// while keeping staff lines, notes and dots; the choices are written onto the ticked pages by the Clean button, can be taken away by pressing a chosen one again, and survive the saved list.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-clean.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf() {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) { const pg = doc.addPage([612, 792]); for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 60, y: 600 - k * 8 }, end: { x: 550, y: 600 - k * 8 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), 'kf-clean-test.pdf'); fs.writeFileSync(f, await doc.save()); return f;
}
(async () => {
  const file = await makePdf(), b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', file); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
  // the worker on a made scan: cream paper with a shadow on the left, staff lines, a note head, a staccato dot, dust
  const r = await p.evaluate(async () => {
    const W = 1200, H = 1600, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d', { alpha: false });
    const grad = x.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, 'rgb(205,195,170)'); grad.addColorStop(0.3, 'rgb(240,232,208)'); grad.addColorStop(1, 'rgb(240,232,208)'); x.fillStyle = grad; x.fillRect(0, 0, W, H);
    x.fillStyle = '#111'; for (let k = 0; k < 5; k++) x.fillRect(100, 600 + k * 14, 1000, 2);
    x.beginPath(); x.ellipse(400, 640, 12, 9, -0.3, 0, 7); x.fill(); x.fillRect(411, 600, 2, 40);       // note head and stem
    x.beginPath(); x.arc(700, 740, 4, 0, 7); x.fill();                                                  // a dot of its own, like a staccato (6px across at this size)
    x.fillStyle = '#222'; [[300, 900], [520, 1100], [880, 1250], [150, 1400]].forEach(([a, c]) => x.fillRect(a, c, 2, 2)); x.fillRect(600, 1000, 1, 1);          // dust (the light setting works in proportion to the page, so at this size it takes a single dot)
    const at = (cv, a, c) => { const d = cv.getContext('2d').getImageData(a, c, 1, 1).data; return [d[0], d[1], d[2]]; };
    const run = async (bg, sp) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(cv, 0, 0); await pdfCleanCanvas(c, bg, sp, [0, 0, W, H]); return c; };
    const w = await run(1, 2), pc = await run(2, 2), none = await run(0, 0), only = await run(0, 1);
    return { paperL: at(w, 30, 30), paperR: at(w, 1150, 1500), pcL: at(pc, 30, 30), pcR: at(pc, 1150, 1500), dustW: at(w, 301, 901), dustOrig: at(cv, 301, 901), line: at(w, 600, 601), note: at(w, 400, 640), dot: at(w, 700, 740), same: at(none, 301, 901), dustLight: at(only, 600, 1000), dotOrig: at(cv, 600, 1000), paperOnly: at(only, 30, 30), paperOrig: at(cv, 30, 30) };
  });
  const near = (a, c, t) => a.every((v, i) => Math.abs(v - c[i]) <= t), dark = a => a[0] < 90;
  ok('White: the shaded left and the far corner of the paper both come out white', near(r.paperL, [255, 255, 255], 4) && near(r.paperR, [255, 255, 255], 4), JSON.stringify([r.paperL, r.paperR]));
  ok('Page color: the shaded side is brought up to the paper tone, and it is not white', near(r.pcL, r.pcR, 10) && r.pcR[2] < 235 && r.pcR[0] > 220, JSON.stringify([r.pcL, r.pcR]));
  ok('Strong takes out a dust speck and leaves a staff line, a note head and a dot of its own', !dark(r.dustW) && r.dustOrig[0] < 90 && dark(r.line) && dark(r.note) && dark(r.dot), JSON.stringify({ dust: r.dustW, line: r.line, note: r.note, dot: r.dot }));
  ok('Nothing chosen leaves the page as it was; Specks alone leave the paper alone', near(r.same, r.dustOrig, 0) && near(r.paperOnly, r.paperOrig, 2) && dark(r.dotOrig) && !dark(r.dustLight), JSON.stringify({ same: r.same, paperOnly: r.paperOnly, paperOrig: r.paperOrig, dustLight: r.dustLight, dotOrig: r.dotOrig }));
  // the tool
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500);
  const order = await p.evaluate(() => peOrder());
  ok('Clean is in the tool list ahead of Re-kilter', order.join() === 'pages,clean,skew,crop,dim,split,resize,wm', order.join());
  await p.evaluate(() => peTool('clean')); await p.waitForTimeout(900);
  const a = await p.evaluate(() => ({ mode: PE.mode, ticks: document.querySelector('#peGrid').classList.contains('ticks'), go: !document.querySelector('#peCleanGo').disabled, clear: !document.querySelector('#peCleanClear').disabled, bg: PE.cl.bg, sp: PE.cl.sp, labels: [...document.querySelectorAll('#peViewClean .seg label')].map(l => l.textContent).join('|') }));
  ok('Clean opens with White and Light chosen, Clean ready and Revert greyed out', a.mode === 'clean' && a.ticks && a.go && !a.clear && a.bg === 1 && a.sp === 1 && a.labels === 'White|Page color|Light|Strong', JSON.stringify(a));
  await p.click('label:has(input[name=peClSp][value="1"])'); await p.waitForTimeout(100);
  const t = await p.evaluate(() => ({ sp: PE.cl.sp, checked: !!document.querySelector('input[name=peClSp]:checked') }));
  ok('Pressing the chosen Specks choice again takes the choice away', t.sp === 0 && !t.checked, JSON.stringify(t));
  await p.click('label:has(input[name=peClSp][value="2"])'); await p.click('#peCleanGo'); await p.waitForTimeout(900);
  const c = await p.evaluate(() => ({ slots: PE.d.order.map(id => [PE.d.slots[id].bg, PE.d.slots[id].sp].join()).join('|'), go: !document.querySelector('#peCleanGo').disabled, clear: !document.querySelector('#peCleanClear').disabled, tag: document.querySelector('.page-card .pe-lvl').textContent, shown: getComputedStyle(document.querySelector('.page-card .pe-lvl')).opacity, list: JSON.stringify(recipeToList(PE.d)) }));
  ok('Clean writes the choices onto every ticked page, greys itself out, and the pages say Cleaned', c.slots === '1,2|1,2|1,2' && !c.go && c.clear && c.tag === 'Cleaned' && c.shown === '1', JSON.stringify(c));
  const back = await p.evaluate(() => { const r = recipeFromList(JSON.parse(JSON.stringify(recipeToList(PE.d))), 3, null); return r && r.slots.map(s => s.bg + ',' + s.sp).join('|'); });
  ok('The choices survive the saved list', back === '1,2|1,2|1,2', back);
  await p.evaluate(() => { const id = PE.d.order[0]; PE.one = id; peState(); }); await p.waitForFunction(() => PE.rawOne); await p.waitForTimeout(800);
  const o = await p.evaluate(() => ({ one: document.querySelector('#peWin').classList.contains('one'), wipe: document.querySelector('#peWin').classList.contains('wipe'), side: document.querySelector('#peSideB').textContent, w: document.querySelector('#peCropCv').width > 100 }));
  ok('A page opens large with the original beside the cleaned page', o.one && o.wipe && o.side === 'Cleaned' && o.w, JSON.stringify(o));
  await p.evaluate(() => peOneClose()); await p.click('#peCleanClear'); await p.waitForTimeout(500);
  const z = await p.evaluate(() => PE.d.order.map(id => [PE.d.slots[id].bg, PE.d.slots[id].sp].join()).join('|'));
  ok('Revert takes the cleaning off the ticked pages', z === '0,0|0,0|0,0', z);
  await p.evaluate(() => { PE.d.order.forEach(id => { PE.d.slots[id].bg = 1; PE.d.slots[id].sp = 1; }); });
  const blob = await p.evaluate(async () => { const bl = await buildPdfBlob(PE.d), buf = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < Math.min(buf.length, 400000); i++) s += String.fromCharCode(buf[i]); return { size: bl.size, jpeg: (s.match(/DCTDecode/g) || []).length }; });
  ok('The export draws cleaned pages as pictures', blob.jpeg === 3, JSON.stringify(blob));
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
