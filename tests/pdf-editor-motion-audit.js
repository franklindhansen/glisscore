// PDF Editor motion audit: waiting cards share the one loading look (softened paper, one wait pill whose sweep moves by transform only, still with reduced motion), a card that finishes fades in cleanly,
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
  // everything on the grid waits for its picture: the softened paper on every card and one wait pill over the pages, with the shared sweep along its foot
  const wait = p => p.evaluate(() => { document.querySelectorAll('#peGrid .page-card').forEach(c => peLoadOn(c)); });
  const look = p => p.evaluate(() => {
    const inactive = +getComputedStyle(document.documentElement).getPropertyValue('--inactive'), cards = [...document.querySelectorAll('#peGrid .page-card.loading')], pills = [...document.querySelectorAll('#pdfDlg .wait-pill.on')], bar = pills[0] && pills[0].querySelector('.wait-bar');
    const a = bar ? document.getAnimations().filter(x => x.effect && x.effect.target === bar && x.effect.pseudoElement) : [];
    return { inactive, n: cards.length, soft: cards.filter(c => Math.abs(+getComputedStyle(c.querySelector('canvas')).opacity - inactive) < 0.02).length, pills: pills.length, sweeping: !!bar && bar.classList.contains('sweeping'), anims: a.filter(x => x.playState === 'running').length, props: a.flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k).filter(n => !['offset', 'easing', 'composite', 'computedOffset'].includes(n)))), own: document.querySelectorAll('#peGrid .page-card *').length && [...document.querySelectorAll('#peGrid .page-card')].flatMap(c => c.getAnimations({ subtree: true })).filter(x => x.playState === 'running' && !(x instanceof CSSTransition)).length };
  });
  let p = await open(false);
  await wait(p); await p.waitForTimeout(900);
  let bs = await look(p);
  ok('every waiting card shows the softened paper at the shared inactive level', bs.n === 12 && bs.soft === 12, JSON.stringify(bs));
  ok('one wait pill is over the pages, with the shared sweep running', bs.pills === 1 && bs.sweeping && bs.anims >= 1, JSON.stringify(bs));
  ok('the sweep moves only transform, and no card has a loading animation of its own', bs.props.every(n => n === 'transform') && bs.own === 0, JSON.stringify({ props: bs.props, own: bs.own }));
  // a card that finishes fades its picture in over the softened paper, then nothing is left running on it; the pill goes with the last one
  await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card'); peThumbReady(+c.dataset.src); });
  await p.waitForTimeout(120); const midOp = await p.evaluate(() => +getComputedStyle(document.querySelector('#peGrid .page-card canvas')).opacity);
  await p.waitForTimeout(700);
  const done = await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card'); return { op: +getComputedStyle(c.querySelector('canvas')).opacity, anims: c.getAnimations({ subtree: true }).filter(x => x.playState === 'running').length, cls: c.className }; });
  ok('a finished card fades its picture in (not a pop)', midOp > bs.inactive + 0.02 && midOp < 1 && done.op === 1, 'mid ' + midOp.toFixed(2) + ', end ' + done.op);
  ok('and nothing keeps running on it', done.anims === 0 && !/loading/.test(done.cls), JSON.stringify(done));
  await p.evaluate(() => { document.querySelectorAll('#peGrid .page-card').forEach(c => peThumbReady(+c.dataset.src)); }); await p.waitForTimeout(700);
  ok('the pill goes once the last picture is in', await p.evaluate(() => document.querySelectorAll('#pdfDlg .wait-pill.on').length === 0));
  // the large view: the page being drawn is the softened paper with the same pill, and nothing of its own sweeps
  await p.evaluate(() => { peTool('crop'); }); await p.waitForTimeout(900); await p.evaluate(() => peOneOpen(PE.d.order[0])); await p.waitForTimeout(900);
  const pg = await p.evaluate(async () => { const e = document.querySelector('#peCropPg'), inactive = +getComputedStyle(document.documentElement).getPropertyValue('--inactive'); e.classList.add('loading'); peLoadPill(); await new Promise(r => setTimeout(r, 900));
    const r = { op: +getComputedStyle(e).opacity, inactive, own: document.getAnimations().filter(x => x.effect.target === e && x.effect.pseudoElement).length, pill: document.querySelectorAll('#pdfDlg .wait-pill.on').length }; e.classList.remove('loading'); peLoadPill(); return r; });
  ok('the large view shows the softened page with the shared pill and no sweep of its own', Math.abs(pg.op - pg.inactive) < 0.02 && pg.own === 0 && pg.pill === 1, JSON.stringify(pg));
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

  // reduced motion: the sweep is held still
  p = await open(true);
  await wait(p); await p.waitForTimeout(900);
  const calm = await p.evaluate(() => { const bar = document.querySelector('#pdfDlg .wait-pill.on .wait-bar'); return { pill: !!bar, anims: document.getAnimations().filter(a => a.effect && a.effect.pseudoElement && a.playState === 'running').length }; });
  ok('with reduced motion the pill shows and nothing sweeps', calm.pill && calm.anims === 0, JSON.stringify(calm));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
