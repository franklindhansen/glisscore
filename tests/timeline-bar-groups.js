// Timeline bar: Undo, Redo and History share one pill; Space turns evenly and Turns to end share another; Fit and the zoom slider sit outside both; History still opens upward; no sideways scroll on a phone.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/timeline-bar-groups.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 8; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-bar-groups.pdf'); fs.writeFileSync(pdf, await doc.save());
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf);
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500);
  const read = () => p.evaluate(() => {
    const g = id => document.querySelector(id), box = el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const un = g('#bUndo').closest('.btn-group'), tu = g('#bSpace').closest('.btn-group');
    return { un: !!un, tu: !!tu, same1: un && un === g('#bRedo').closest('.btn-group') && un === g('#bHist').closest('.btn-group'), same2: tu && tu === g('#bToEnd').closest('.btn-group'), two: un !== tu,
      fitOut: !g('#bFit').closest('.btn-group') && !g('#zoom').closest('.btn-group'),
      titles: ['#bUndo', '#bRedo', '#bHist', '#bSpace', '#bToEnd'].map(s => g(s).title).every(Boolean),
      corner: un ? getComputedStyle(un).borderRadius : '', un1: un ? box(un) : null, tu1: tu ? box(tu) : null, hist: box(g('#bHist')), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  const d = await read();
  ok('Undo, Redo and History share one container', d.un && d.same1);
  ok('Space turns evenly and Turns to end share another', d.tu && d.same2 && d.two);
  ok('Fit and Zoom sit outside both', d.fitOut);
  ok('The buttons keep their titles', d.titles);
  ok('The group corner is the control corner plus the gap', await p.evaluate(() => { const e = document.querySelector('.btn-group'); if (!e) return false; const r = parseFloat(getComputedStyle(e).borderTopLeftRadius), c = parseFloat(getComputedStyle(document.querySelector('#bUndo')).borderTopLeftRadius), gp = parseFloat(getComputedStyle(e).paddingLeft); return Math.abs(r - (c + gp)) < 0.6; }));
  ok('Undo is greyed until there is a step', await p.evaluate(() => document.querySelector('#bUndo').disabled));
  await p.evaluate(K => { const k = window[K]; k.S.turns = k.S.turns.slice(); }, K);
  // History opens upward
  await p.evaluate(() => { const h = document.querySelector('#bHist'); h.disabled = false; h.click(); }); await p.waitForTimeout(500);
  const up = await p.evaluate(() => { const pop = document.querySelector('#mHist'), h = document.querySelector('#bHist').getBoundingClientRect(), r = pop.getBoundingClientRect(); return { open: !pop.hidden, above: r.bottom <= h.top + 1 }; });
  ok('History opens upward', up.open && up.above, JSON.stringify(up));
  await p.evaluate(() => { document.querySelector('#bHist').click(); });
  // phone
  for (const w of [390, 360]) {
    await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(400);
    const r = await read();
    const sameRow = r.un1 && Math.abs(r.un1.t - r.hist.t) < r.un1.b - r.un1.t;
    ok('Phone ' + w + ': no sideways scroll', r.sw <= r.cw, r.sw + ' vs ' + r.cw);
    ok('Phone ' + w + ': the history pill holds one row and the turn tools sit below it', sameRow && r.tu1 && r.tu1.t >= r.un1.b - 1, JSON.stringify({ un: r.un1, tu: r.tu1 }));
  }
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
