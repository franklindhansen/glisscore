// PDF Editor motion audit: the loading sweep is one band across the grid (transform only, every card on one clock, gone with reduced motion), a card that finishes drops out cleanly,
// and switching tools moves only what is designed: no page card moves, and the only layout properties that animate are the head's height and the tool list's highlight.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-motion-audit.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const LAYOUT = /^(width|height|top|left|right|bottom|margin|padding|max-width|max-height|min-width|min-height|inset|gap|flex|grid)/i;
(async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 12; i++) { const pg = doc.addPage([612, 792]); for (let y = 700; y > 100; y -= 70) for (let k = 0; k < 5; k++) pg.drawLine({ start: { x: 80, y: y - k * 7 }, end: { x: 530, y: y - k * 7 }, thickness: 1, color: rgb(0, 0, 0) }); }
  const f = path.join(os.tmpdir(), 'kf-motion-audit.pdf'); fs.writeFileSync(f, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const open = async calm => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: calm ? 'reduce' : 'no-preference' }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', f); await p.waitForFunction(() => S.pdf && S.pdf.n === 12); await p.waitForTimeout(800);
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(900);
    return p;
  };
  // everything on the grid waits for its picture
  const wait = p => p.evaluate(() => { document.querySelectorAll('#peGrid .page-card').forEach(c => peLoadOn(c)); peSheenSync(); });
  // where each card's band is on the grid right now (its place in the card plus the card's place in the grid), and how far into the sweep it is
  const bands = p => p.evaluate(() => {
    const grid = document.querySelector('#peGrid'), g = grid.getBoundingClientRect();
    return [...grid.querySelectorAll('.page-card.loading .pe-sheen')].map(sh => {
      const m = new DOMMatrix(getComputedStyle(sh, '::before').transform), r = sh.getBoundingClientRect(), a = sh.getAnimations({ subtree: true }).filter(x => x.effect.pseudoElement)[0];
      return { gx: r.left - g.left + m.m41, props: a ? a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(n => !['offset', 'easing', 'composite', 'computedOffset'].includes(n))) : null, running: a ? a.playState : null, t: a ? a.currentTime : null, d: a ? getComputedStyle(sh, '::before').animationDuration : null };
    });
  });

  let p = await open(false);
  await wait(p); await p.waitForTimeout(700);
  let bs = await bands(p);
  ok('every waiting card has a sweep', bs.length === 12 && bs.every(x => x.running === 'running'), bs.length + ' cards');
  ok('the sweep moves only transform', bs.every(x => x.props && x.props.every(n => n === 'transform')), JSON.stringify([...new Set(bs.flatMap(x => x.props || []))]));
  ok('all cards are on one clock', Math.max(...bs.map(x => x.t % 2600)) - Math.min(...bs.map(x => x.t % 2600)) < 40 || Math.max(...bs.map(x => x.t % 2600)) - Math.min(...bs.map(x => x.t % 2600)) > 2560, bs.map(x => Math.round(x.t % 2600)).join(','));
  // one band across the grid: at one moment every card's band sits at the same place on the grid (within a few pixels of a frame's travel)
  const spread = Math.max(...bs.map(x => x.gx)) - Math.min(...bs.map(x => x.gx));
  ok('it is one band: every card shows the same place on the grid', spread < 40, 'spread ' + spread.toFixed(1) + 'px');
  const g1 = await bands(p); await p.waitForTimeout(300); const g2 = await bands(p);
  ok('the band travels', g2[0].gx - g1[0].gx > 20 || g2[0].gx - g1[0].gx < -1000, (g2[0].gx - g1[0].gx).toFixed(1) + 'px in 0.3s');
  // a card that finishes drops out: its wash fades, then nothing is left running on it
  await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card'); peThumbReady(+c.dataset.src); });
  const midOp = await p.evaluate(() => +getComputedStyle(document.querySelector('#peGrid .page-card .pe-sheen')).opacity);
  await p.waitForTimeout(700);
  const done = await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card'), s = c.querySelector('.pe-sheen'); return { op: +getComputedStyle(s).opacity, anims: s.getAnimations({ subtree: true }).filter(x => x.playState === 'running').length, cls: c.className }; });
  ok('a finished card fades its wash out (not a pop)', midOp > 0.05 && done.op === 0, 'mid ' + midOp.toFixed(2) + ', end ' + done.op);
  ok('and nothing keeps running on it', done.anims === 0 && !/loading|sheen-out/.test(done.cls), JSON.stringify(done));
  // the large view's sweep is transform only too
  await p.evaluate(() => { peTool('crop'); }); await p.waitForTimeout(900); await p.evaluate(() => peOneOpen(PE.d.order[0])); await p.waitForTimeout(900);
  const pg = await p.evaluate(async () => { const e = document.querySelector('#peCropPg'); e.classList.add('loading'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const a = document.getAnimations().filter(x => x.effect.target === e && x.effect.pseudoElement); const r = { n: a.length, props: a.flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k).filter(n => !['offset', 'easing', 'composite', 'computedOffset'].includes(n)))) }; e.classList.remove('loading'); return r; });
  ok('the large view sweeps with transform only', pg.n === 1 && pg.props.every(n => n === 'transform'), JSON.stringify(pg));
  await p.context().close();

  // switching tools: only the designed motion
  p = await open(false);
  const seen = await p.evaluate(async () => {
    const found = new Map(), cards = new Set(); let stop = false;
    const id = a => { const t = a.effect && a.effect.target; return t ? (t.id ? '#' + t.id : t.className ? '.' + String(t.className).split(' ')[0] : t.tagName) : '?'; };
    (function scan() {
      document.getAnimations().forEach(a => {
        const t = a.effect && a.effect.target; if (!t || !t.closest || !t.closest('#pdfDlg')) return;
        const props = a instanceof CSSTransition ? [a.transitionProperty] : a.effect.getKeyframes().flatMap(k => Object.keys(k).filter(n => !['offset', 'easing', 'composite', 'computedOffset'].includes(n)));
        props.forEach(n => { const k = id(a) + ' ' + n; found.set(k, (found.get(k) || 0) + 1); });
        if (t.closest('.page-card')) cards.add(id(a));
      });
      if (!stop) requestAnimationFrame(scan);
    })();
    for (const tool of ['clean', 'skew', 'split', 'resize', 'wm', 'pages']) { peTool(tool); await new Promise(r => setTimeout(r, 700)); }
    stop = true; return { found: [...found.keys()], cards: [...cards] };
  });
  const layout = seen.found.filter(k => LAYOUT.test(k.split(' ')[1]));
  ok('switching tools moves no page card (only the ticks, the greying and the hover tools change)', seen.cards.every(c => /^(\.pe-tools|CANVAS|\.tick)$/.test(c)), JSON.stringify(seen.cards));
  ok('the only layout properties that animate belong to the head and the tool list highlight', layout.every(k => /^(#peBand height|#peRailSel (width|height))$/.test(k)), JSON.stringify(layout));
  await p.context().close();

  // reduced motion: no sweep
  p = await open(true);
  await wait(p); await p.waitForTimeout(400);
  const calm = await p.evaluate(() => { const s = document.querySelector('#peGrid .pe-sheen'); return { band: getComputedStyle(s, '::before').display, anims: document.getAnimations().filter(a => a.effect.pseudoElement && a.playState === 'running').length }; });
  ok('with reduced motion the band is off and nothing sweeps', calm.band === 'none' && calm.anims === 0, JSON.stringify(calm));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
