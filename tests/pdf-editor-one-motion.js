// PDF Editor, the large view moves as one motion: opening a page, stepping to a page of another shape, and a page that is still loading. The box glides from the shape it had to the next page's shape,
// the picture that was on show leaves as it was (never stretched into the new shape), no stale picture shows while the next one loads, and the next picture shows only once the box has its shape.
// With reduced motion the new shape is there at once. A frame record is taken each frame.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-one-motion.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const record = (p, act, slow, ms) => p.evaluate(({ act, slow, ms }) => new Promise(res => {
  const q = s => document.querySelector(s), out = [], r = e => { const x = e.getBoundingClientRect(); return { w: x.width, h: x.height }; }, keep = window.renderPdfPage;
  if (slow) window.renderPdfPage = async (...a) => { await new Promise(r => setTimeout(r, slow)); return keep(...a); };
  const t0 = performance.now(); eval(act);
  (function f() { const t = performance.now() - t0, pg = q('#peCropPg'), cv = q('#peCropCv'), v = q('#peCropView'), g = q('.pe-ghost');
    out.push({ t, pg: r(pg), loading: pg.classList.contains('loading'), cv: { w: cv.width, h: cv.height, o: +getComputedStyle(cv).opacity }, vo: +getComputedStyle(v).opacity, ghost: g ? Object.assign(r(g), { o: +getComputedStyle(g).opacity }) : null, anims: pg.getAnimations().length });
    if (t < ms) requestAnimationFrame(f); else { window.renderPdfPage = keep; res(out); } })();
}), { act, slow, ms });
(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 3; i++) { const pg = doc.addPage(i === 1 ? [792, 612] : [612, 792]); for (let y = 700; y > 100; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 80, y: y - k * 7 }, end: { x: 530, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), 'kf-one-motion.pdf'); fs.writeFileSync(f, await doc.save());
  const b = await chromium.launch(); const errs = [];
  for (const calm of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: calm ? 'reduce' : 'no-preference' }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', f); await p.waitForFunction(() => S.pdf && S.pdf.n === 3); await p.waitForTimeout(800);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(500); await p.evaluate(() => peTool('crop')); await p.waitForTimeout(900);
    const T = (calm ? 'reduced motion, ' : '');
    await p.evaluate(() => peOneOpen(PE.d.order[0])); await p.waitForTimeout(900);
    const shape = await p.evaluate(() => { const x = document.querySelector('#peCropPg').getBoundingClientRect(); return [x.width, x.height]; });
    const step = await record(p, 'peOneStep(1)', 0, 700), end = step[step.length - 1], asp0 = shape[0] / shape[1], asp1 = end.pg.w / end.pg.h;
    ok(T + 'stepping to a page of another shape: the new shape is reached', Math.abs(asp1 - 792 / 612) < 0.03 && Math.abs(asp0 - 612 / 792) < 0.03, JSON.stringify({ asp0, asp1 }));
    if (calm) {
      ok(T + 'the new shape is there at once, with nothing gliding', Math.abs(step[0].pg.w - end.pg.w) < 1.5 && step.every(x => x.anims === 0 && !x.ghost), JSON.stringify({ first: step[0].pg.w, end: end.pg.w }));
    } else {
      const span = end.pg.w - shape[0], prog = x => (x.pg.w - shape[0]) / span;
      ok(T + 'the box starts from the shape it had and glides one way', Math.abs(prog(step[0])) < 0.25 && step.every((x, i) => !i || x.pg.w >= step[i - 1].pg.w - 0.5), JSON.stringify({ first: Math.round(prog(step[0]) * 100) + '%' }));
      ok(T + 'it ends exactly at the page\'s shape and nothing moves after', Math.abs(end.pg.w - step[step.length - 3].pg.w) < 0.5 && end.anims === 0, JSON.stringify({ end: end.pg }));
      const gh = step.filter(x => x.ghost);
      ok(T + 'the picture that was on show leaves in its own shape, fading out, while the box changes', gh.length > 3 && gh.every(x => Math.abs(x.ghost.w / x.ghost.h - asp0) < 0.02) && gh.every((x, i) => !i || x.ghost.o <= gh[i - 1].ghost.o + 0.01), gh.length + ' frames, ' + JSON.stringify(gh[0] && gh[0].ghost));
      const squeezed = step.filter(x => !x.loading && x.cv.o > 0.05 && x.cv.h && Math.abs(x.cv.w / x.cv.h - x.pg.w / x.pg.h) > 0.04);
      ok(T + 'no picture is ever shown stretched into a shape that is not its own', !squeezed.length, squeezed.length + ' frame(s), e.g. ' + JSON.stringify(squeezed[0]));
      const early = step.filter(x => x.cv.o > 0.05 && !x.loading && Math.abs(x.pg.w - end.pg.w) > 1.5);
      ok(T + 'the new picture shows only once the box has its shape', !early.length, early.length + ' frame(s), e.g. ' + JSON.stringify(early[0] && { t: Math.round(early[0].t), w: early[0].pg.w }));
    }
    await p.evaluate(() => peOneClose()); await p.waitForTimeout(600);
    const slow = await record(p, 'peOneOpen(PE.d.order[2])', 500, 1100), sEnd = slow[slow.length - 1];
    const stale = slow.filter(x => x.loading && x.cv.o > 0.05 && (x.cv.w !== 300 || x.cv.h !== 150));
    ok(T + 'a page still loading shows no picture of another page', !stale.length, stale.length + ' frame(s), e.g. ' + JSON.stringify(stale[0]));
    ok(T + 'the page loads into a box of its own shape and the picture arrives whole', Math.abs(sEnd.pg.w / sEnd.pg.h - 612 / 792) < 0.03 && sEnd.cv.w === 2165 && !sEnd.loading, JSON.stringify({ end: sEnd.pg, cv: sEnd.cv }));
    if (!calm) ok(T + 'opening fades and scales in from nothing and ends at full size', slow[0].vo < 0.2 && sEnd.vo === 1, JSON.stringify({ first: slow[0].vo, end: sEnd.vo }));
    else ok(T + 'opening is there at once', slow[0].vo === 1, JSON.stringify({ first: slow[0].vo }));
    await ctx.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
