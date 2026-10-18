// Dropping a dragged page: the held page lands and gives a small press, and the pages it passed slide to their new places on the same clock.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-drop-motion.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const mk = await PDFDocument.create(); for (let i = 0; i < 5; i++) mk.addPage([612, 792]).drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(.8, 0, 0) });
  const pdf = Buffer.from(await mk.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', { name: 'red.pdf', mimeType: 'application/pdf', buffer: pdf }); await p.waitForFunction(() => S.pdf);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200);
  const at = id => p.evaluate(id => { const r = document.querySelector('#peGrid .page-card[data-id="' + id + '"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 3, r.x]; }, id);
  const from = await at(3), to = await at(0);
  await p.mouse.move(from[0], from[1]); await p.mouse.down(); await p.mouse.move(to[2] + 8, to[1], { steps: 12 }); await p.mouse.up();
  const just = await p.evaluate(() => {
    const ghost = document.querySelector('.pe-ghost'), gan = ghost ? ghost.getAnimations() : [];
    const slid = [...document.querySelectorAll('#peGrid .page-card')].filter(c => c.getAnimations().some(a => a.effect && a.effect.getKeyframes().some(k => /translate3d\(-?[\d.]+px/.test(k.transform || '')))).length;
    return { ghost: !!ghost, dur: gan[0] ? gan[0].effect.getTiming().duration : null, frames: gan[0] ? gan[0].effect.getKeyframes().length : 0, slid, slides: document.querySelectorAll('.pe-pos.slide').length };
  });
  ok('the held page lands with a press (four keyframes, 300ms)', just.ghost && just.dur === 300 && just.frames === 4, JSON.stringify(just));
  ok('the pages it passed slide to their places on the same clock', just.slid >= 2, JSON.stringify(just));
  ok('their numbers slide with their pages', just.slides >= 2, String(just.slides));
  await p.waitForTimeout(1500);          // the numbers slide one at a time, so the last one lands after the page
  const after = await p.evaluate(() => ({ order: PE.d.order.join(), ghost: !!document.querySelector('.pe-ghost'), held: !!document.querySelector('.pe-hole'), slides: document.querySelectorAll('.pe-pos.slide').length, nums: [...document.querySelectorAll('#peGrid .page-card .pe-pos')].map(e => e.textContent.trim()).join() }));
  ok('the order is the new one and the ghost is gone', after.order.split(',')[0] === '3' && !after.ghost && !after.held, JSON.stringify(after));
  ok('every number has landed on its new digit', after.slides === 0 && after.nums === '1,2,3,4,5', JSON.stringify(after));
  ok('no script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
