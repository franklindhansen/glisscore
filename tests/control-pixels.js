// Every button, choice, tab, and menu on every screen sits on whole pixels: a whole-pixel height and a whole-pixel top. A control on a half pixel draws its text up to a pixel off center
// (the text snaps one way, the box the other), and the same control looks different from its neighbor depending on where it landed. The common causes: a line height that is not a whole number
// (set --lh, not line-height; the page rounds it), an odd-height control centered in an even-height bar, and an odd-height row of padding. Window 1300x900, after the entrance motion has settled.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/control-pixels.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const base = 'http://localhost:' + (process.env.PORT || 8123);
(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i++) { const pg = doc.addPage([595, 842]); for (let k = 0; k < 3; k++) { const y = 90 + k * 185; for (const off of [0, 62]) for (let j = 0; j < 5; j++) pg.drawLine({ start: { x: 50, y: 842 - (y + off + j * 7) }, end: { x: 545, y: 842 - (y + off + j * 7) }, thickness: 0.7 }); [50, 300, 545].forEach(x => pg.drawLine({ start: { x, y: 842 - y }, end: { x, y: 842 - (y + 90) }, thickness: 0.9 })); } }
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const bad = [], seen = new Set(); let total = 0;
  const check = async where => {
    const r = await p.evaluate(() => {
      const out = [], frac = v => Math.abs(v - Math.round(v)) > 0.03;
      document.querySelectorAll('button, .btn, .chip, .sys-pg, label.check, .pe-tab, select, summary, .seg label, .rz-opt, .ae-tool, input[type=text], input[type=number]').forEach(e => {
        const r = e.getBoundingClientRect(); if (r.width < 12 || r.height < 12 || r.height > 70) return;
        for (let n = e; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.5 || n.hidden) return; }
        if (!(r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth)) return; const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (!hit || !(e.contains(hit) || hit.contains(e))) return;
        out.push({ n: 1, k: (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + (e.className + '').split(' ').slice(0, 2).join('.')) + ' "' + (e.textContent || '').trim().slice(0, 16) + '"', y: +r.y.toFixed(2), h: +r.height.toFixed(2), bad: frac(r.y) || frac(r.height) });
      }); return out;
    });
    total += r.length; r.filter(x => x.bad).forEach(x => { if (!seen.has(x.k)) { seen.add(x.k); bad.push(where + ': ' + x.k + ' y=' + x.y + ' h=' + x.h); } });
  };
  await p.goto(base + '/index.html?disk=0'); await p.waitForTimeout(1800); await check('start');
  await p.setInputFiles('#pdfIn', { name: 'a.pdf', mimeType: 'application/pdf', buffer: bytes }); await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4); await p.waitForTimeout(1800);
  await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(1000); await p.mouse.move(2, 2);
  for (const v of ['spread', 'single', 'system']) {
    await p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await p.waitForFunction(() => !(window.SYS && SYS.prog), null, { timeout: 60000 }); await p.waitForTimeout(1500); await check('video ' + v);
  }
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(1000); await check('audio editor');
  for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level']) { await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(1300); await check('audio ' + t); }
  await p.evaluate(() => { const c = document.querySelector('#audioDlg .dlg-close, #audioDlg [data-close], #aeClose'); if (c) c.click(); }); await p.waitForTimeout(500);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200); await check('pdf editor');
  for (const t of ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm']) { await p.evaluate(t => peTool(t), t); await p.waitForTimeout(1400); await check('pdf ' + t); }
  ok('every control on every screen is a whole number of pixels tall and sits on a whole pixel (' + total + ' measured)', !bad.length && total > 300, bad.slice(0, 12).join(' | '));
  const guard = await p.evaluate(() => (window.uiGuard ? uiGuard.scan().map(g => g[2]) : []));
  ok('uiGuard reports nothing on the last screen', !guard.length, guard.join(' | '));
  ok('no page errors', !errs.length, errs.join(' | '));
  await b.close();
})();
