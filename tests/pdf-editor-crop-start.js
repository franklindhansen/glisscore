// PDF Editor: Crop with Auto starts out working and greyed the moment it opens (frame by frame: no frame shows the pages at full strength), and Manual frees the pages at once and reads no more.
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

  // frame by frame: the first frames after Crop is pressed (from a cold open and from another tool, 3 and 60 pages) all show the pages greyed, with the pill
  const frames = (p, from) => p.evaluate(async from => {
    PE.raw = new Map(); if (from) { peTool(from); await new Promise(r => setTimeout(r, 700)); }
    const inactive = +getComputedStyle(document.documentElement).getPropertyValue('--inactive'), rows = []; let on = true;
    const tick = () => { if (!on) return; const g = $('#peGrid'); rows.push({ w: $('#peWin').classList.contains('waiting'), o: +getComputedStyle(g).opacity, ev: getComputedStyle(g.querySelector('.page-card')).pointerEvents, pill: !!document.querySelector('#pdfDlg .wait-pill.on') }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick); peTool('crop'); await new Promise(r => setTimeout(r, 400)); on = false; return { inactive, rows: rows.slice(0, 30) };
  }, from);
  for (const n of [3, 60]) for (const from of ['', 'pages', 'clean']) {
    const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.setDefaultTimeout(30000); q.on('pageerror', e => errs.push(e.message));
    await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await q.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await q.waitForFunction(() => S.pdf && S.pdf.n >= 2); await q.waitForTimeout(800);
    await q.evaluate(() => openPdfEditor()); await q.waitForTimeout(500);
    await q.evaluate(n => { const d = PE.d; while (d.order.length < n) { const sl = d.slots[d.order[d.order.length % 3]]; d.slots.push({ src: sl.src, rot: 0, x: false, c: true, crop: null, dim: null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' }); d.order.push(d.slots.length - 1); } peRender(false); const raw = peRawBox; peRawBox = async sl => { await new Promise(r => setTimeout(r, 150)); return raw(sl); }; }, n); await q.waitForTimeout(600);
    const f = await frames(q, from), bad = f.rows.filter(r => !r.w || r.o > f.inactive + 0.02 || r.ev !== 'none' || !r.pill);
    ok('Crop in Auto, ' + n + ' pages, from ' + (from || 'a cold open') + ': all ' + f.rows.length + ' first frames are greyed with the pill', f.rows.length >= 20 && bad.length === 0, bad.length ? JSON.stringify(bad[0]) + ' of ' + bad.length : '');
    await q.close();
  }
  // every page already read: reopening Crop dims nothing at any frame
  { const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.setDefaultTimeout(30000);
    await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await q.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await q.waitForFunction(() => S.pdf && S.pdf.n >= 2); await q.waitForTimeout(800);
    await q.evaluate(() => openPdfEditor()); await q.waitForTimeout(500); await q.evaluate(async () => { peTool('crop'); for (let i = 0; i < 400 && (PE.cropReading || PE.busy); i++) await sleep(25); await sleep(500); peTool('pages'); await sleep(500); });
    const rows = await q.evaluate(async () => { const out = []; let on = true; const tick = () => { if (!on) return; out.push([$('#peWin').classList.contains('waiting'), +getComputedStyle($('#peGrid')).opacity]); requestAnimationFrame(tick); }; requestAnimationFrame(tick); peTool('crop'); await sleep(400); on = false; return out; });
    ok('Crop again with every page read: no frame is greyed', rows.length > 10 && rows.every(r => !r[0] && r[1] === 1), JSON.stringify(rows.find(r => r[0] || r[1] !== 1) || ''));
    await q.close(); }
  // Manual stops the read at once: no page is read after the switch; Auto again resumes from its first frame; a tool switch and Undo leave nothing stale
  { const q = await b.newPage({ viewport: { width: 1300, height: 900 } }); q.setDefaultTimeout(30000);
    await q.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await q.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await q.waitForFunction(() => S.pdf && S.pdf.n >= 2); await q.waitForTimeout(800);
    await q.evaluate(() => openPdfEditor()); await q.waitForTimeout(500);
    const r = await q.evaluate(async () => {
      PE.raw = new Map(); let calls = 0; const raw = peRawBox; peRawBox = async sl => { calls++; await new Promise(r => setTimeout(r, 120)); return raw(sl); };
      peTool('crop'); await sleep(200); const before = calls; document.querySelector('input[name=peCropMode][value=hand]').click();
      const f0 = { w: $('#peWin').classList.contains('waiting'), ev: getComputedStyle(document.querySelector('#peGrid .page-card')).pointerEvents };
      await sleep(700); const after = calls;
      document.querySelector('input[name=peCropMode][value=auto]').click(); const g0 = { w: $('#peWin').classList.contains('waiting'), o: +getComputedStyle($('#peGrid')).opacity, ev: getComputedStyle(document.querySelector('#peGrid .page-card')).pointerEvents };
      await new Promise(r => requestAnimationFrame(r)); const g1 = +getComputedStyle($('#peGrid')).opacity; peTool('pages'); await sleep(600);
      return { before, after, f0, g0, g1, stale: $('#peWin').classList.contains('waiting'), pill: !!document.querySelector('#pdfDlg .wait-pill.on'), inactive: +getComputedStyle(document.documentElement).getPropertyValue('--inactive') };
    });
    ok('Manual frees the pages in the same frame', !r.f0.w && r.f0.ev !== 'none', JSON.stringify(r.f0));
    ok('no page is read after Manual is chosen (at most the one already being read)', r.after - r.before <= 1, JSON.stringify({ before: r.before, after: r.after }));
    ok('Auto again is greyed from its first frame', r.g0.w && r.g0.ev === 'none' && r.g0.o <= r.inactive + 0.02 && r.g1 <= r.inactive + 0.02, JSON.stringify(r.g0));
    ok('switching tools mid-read leaves no stale grey or pill', !r.stale && !r.pill, JSON.stringify({ stale: r.stale, pill: r.pill }));
    await q.close(); }
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
