// PDF Editor, switching tools (Arrange, Clean, Arrange) on a large PDF: cards that did not change are not rebuilt or redrawn; no long frames while the switch runs;
// the head, the pages and the band all move at one speed (~250ms) and one ease.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-tool-switch.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
async function makePdf(name, n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) { const pg = doc.addPage([612, 792]); for (let y = 700; y > 100; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 80, y: y - k * 7 }, end: { x: 530, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), name); fs.writeFileSync(f, await doc.save()); return f;
}
(async () => {
  const A = await makePdf('kf-switch.pdf', 60);
  const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] }), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', A); await p.waitForFunction(() => S.pdf && S.pdf.n === 60); await p.waitForTimeout(1500);
  await p.evaluate(() => openPdfEditor()); await p.waitForFunction(() => document.querySelectorAll('#peGrid .page-card:not(.loading)').length === 60); await p.waitForTimeout(800);

  // unchanged cards stay put: the same elements, and nothing drawn on them
  await p.evaluate(() => {
    document.querySelectorAll('#peGrid .page-card').forEach(c => { c._same = true; });
    window.__drawn = new Set(); const d = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...a) { window.__drawn.add(this.canvas); return d.apply(this, a); };
  });
  for (const tool of ['clean', 'pages']) { await p.click('#peRail .pe-tab[data-tool="' + tool + '"]'); await p.waitForTimeout(900); }
  const r = await p.evaluate(() => ({ kept: Array.from(document.querySelectorAll('#peGrid .page-card')).filter(c => c._same).length, draws: Array.from(window.__drawn).filter(c => c.closest('#peGrid')).length }));
  ok('Arrange to Clean to Arrange keeps every card element', r.kept === 60, JSON.stringify(r));
  ok('Arrange to Clean to Arrange redraws no card', r.draws === 0, JSON.stringify(r));

  // one speed and ease: every animation a switch starts (head, pages, band, divider) shares one duration and one easing
  await p.evaluate(() => { document.querySelectorAll('#peGrid .page-card').forEach(c => c.getAnimations().forEach(a => a.cancel())); });
  await p.evaluate(() => { window.__frames = []; let last = performance.now(); window.__raf = true; const f = t => { window.__frames.push(t - last); last = t; if (window.__raf) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.click('#peRail .pe-tab[data-tool="clean"]');
  const an = await p.evaluate(() => document.getAnimations().filter(a => a.effect.target.closest && a.effect.target.closest('#peBand, #peWin .pe-body, .pe-rule') && !a.effect.target.closest('.pe-tools')).map(a => { const t = a.effect.getTiming(); return { d: t.duration, e: t.easing, who: (a.effect.target.className || a.effect.target.id || a.effect.target.tagName) + '' }; }));
  await p.waitForTimeout(900); await p.evaluate(() => { window.__raf = false; });
  const eases = new Set(an.map(x => x.e)), durs = new Set(an.map(x => x.d));
  ok('A tool switch animates something', an.length > 0, JSON.stringify(an));
  ok('Everything a tool switch moves runs at ~250ms', an.length > 0 && Array.from(durs).every(d => d >= 240 && d <= 260), JSON.stringify(an));
  ok('Everything a tool switch moves uses one ease', an.length > 0 && eases.size === 1, JSON.stringify(Array.from(eases)));

  // frames: no long frame while the switch runs (generous, since this machine is not a phone)
  const fr = await p.evaluate(() => window.__frames.slice(1));
  const worst = Math.max(...fr);
  ok('No long frame while switching tools on a 60-page PDF', worst < 60, 'worst frame ' + Math.round(worst) + 'ms of ' + fr.length);

  // the cards keep one size all the way through: the scrollbar's room is not given up while the pages slide
  for (const tool of ['clean', 'resize', 'pages']) {
    await p.evaluate(() => { window.__w = new Set(); window.__go = true; const f = () => { document.querySelectorAll('#peGrid .page-card').forEach((c, i) => { if (i < 3) window.__w.add(Math.round(c.getBoundingClientRect().width * 10) / 10); }); if (window.__go) requestAnimationFrame(f); }; f(); });
    await p.click('#peRail .pe-tab[data-tool="' + tool + '"]'); await p.waitForTimeout(700); await p.evaluate(() => { window.__go = false; });
    const w = await p.evaluate(() => Array.from(window.__w));
    ok('Cards keep one size while switching to ' + tool, w.length === 1, JSON.stringify(w));
  }

  // the grid keeps its scroll place and its scrollbar through a switch: the thumb does not jump to the top, and the grid's own overflow is never hidden
  await p.evaluate(() => { document.getElementById('peWrap').scrollTop = 600; });
  await p.waitForTimeout(100);
  const before = await p.evaluate(() => document.getElementById('peWrap').scrollTop);
  await p.click('#peRail .pe-tab[data-tool="clean"]');
  let hidden = false; for (let i = 0; i < 20; i++) { await p.waitForTimeout(25); if (await p.evaluate(() => getComputedStyle(document.getElementById('peWrap')).overflowY !== 'auto')) hidden = true; }
  await p.waitForTimeout(600);
  const after = await p.evaluate(() => document.getElementById('peWrap').scrollTop);
  ok('A tool switch keeps the grid scroll place', before > 0 && Math.abs(after - before) <= 2, 'before ' + before + ', after ' + after);
  ok('The grid scroll bar is never hidden during a switch', !hidden);

  // the old head leaves before the new one arrives: the new one is hidden for 40ms, the old one is gone by 140ms (paused, so the timing is exact)
  await p.click('#peRail .pe-tab[data-tool="pages"]');
  const ov = await p.evaluate(() => {
    const view = t => document.querySelector('#peBand .pe-tv[data-tool="' + t + '"]');
    const at = (t, ms) => { const el = view(t), a = el.getAnimations()[0]; if (!a) return null; a.pause(); a.currentTime = ms; return +getComputedStyle(el).opacity; };
    return { newAt10: at('pages', 10), newAt60: at('pages', 60), oldAt100: at('clean', 100), oldAt150: at('clean', 150) };
  });
  ok('The new head is hidden at the start of a switch (no flash)', ov.newAt10 === 0, JSON.stringify(ov));
  ok('The old head is nearly gone by 100ms', ov.oldAt100 !== null && ov.oldAt100 < 0.3, JSON.stringify(ov));
  ok('The old head is gone by 150ms', ov.oldAt150 === 0, JSON.stringify(ov));
  ok('The new head has barely started by 60ms', ov.newAt60 !== null && ov.newAt60 < 0.5, JSON.stringify(ov));
  await p.waitForTimeout(600);

  // a pressed tool tab dips to 0.97, and the selected highlight stays where it is
  const hl = await p.evaluate(() => document.getElementById('peRailSel').getBoundingClientRect().top);
  const box = await p.locator('#peRail .pe-tab[data-tool="resize"]').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(250);
  const sc = await p.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#peRail .pe-tab[data-tool="resize"]')).transform).a);
  const hlDown = await p.evaluate(() => document.getElementById('peRailSel').getBoundingClientRect().top);
  await p.mouse.up(); await p.waitForTimeout(600);
  ok('A pressed tool tab dips to scale 0.97', Math.abs(sc - 0.97) < 0.01, 'scale ' + sc.toFixed(3));
  ok('The selected tool highlight does not move with the press', Math.abs(hlDown - hl) < 1, 'before ' + hl + ', pressed ' + hlDown);

  ok('No page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
