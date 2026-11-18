// PDF Editor, Arrange: dragging a page to a new place is one motion. Every frame from letting go until the pages rest is recorded: each number stays on its bubble's center line
// (the sliding digits are centered by the same rule as the resting ones), the bubble keeps its size the whole time, the bubble and the tag move in small steps (no jump, at
// the start or when the slide ends), and everything rests on the cards' own clock. The page you let go lands itself (no copy is swapped out at the end). The keyboard move
// (Alt and an arrow) follows the same rules.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-swap-motion.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const RECORD = () => { window.__rec = []; const t0 = performance.now(); window.__t0 = t0;
  const go = () => { window.__rec.push({ t: performance.now() - t0, ghost: !!document.querySelector('#pdfDlg .pe-ghost'), c: [...document.querySelectorAll('#peGrid .page-card')].map(c => {
    const p = c.querySelector('.pe-pos'), f = c.querySelector('.pe-foot'), nm = c.querySelector('.num'), fr = f.getBoundingClientRect(), pr = p.getBoundingClientRect(), k = fr.width / f.offsetWidth || 1;
    const cells = p.querySelectorAll('.pe-cell'), ink = [...(cells.length ? cells : [p])].map(e => { const r = document.createRange(); r.selectNodeContents(e); return (r.getBoundingClientRect().top - pr.top) / k; });
    const nr = nm.getBoundingClientRect();
    return { id: c.dataset.id, txt: p.textContent, slide: p.classList.contains('slide'), w: pr.width / k, mid: (pr.left + pr.width / 2 - fr.left) / k, tag: (nr.left - fr.left) / k, ink: Math.max(...ink) - Math.min(...ink) > 0.01 ? null : ink[0] };
  }) }); if (performance.now() - t0 < 1400) requestAnimationFrame(go); }; requestAnimationFrame(go); };
function judge(tag, rec, rest) {
  const ids = rec[0].c.map(c => c.id), last = rec[rec.length - 1];
  const inkBad = [], wBad = [], stepBad = [];
  for (const id of ids) {
    const fr = rec.map(r => r.c.find(c => c.id === id)).filter(Boolean), base = fr[fr.length - 1];
    fr.forEach((c, i) => {
      if (c.ink == null || Math.abs(c.ink - base.ink) > 0.3) inkBad.push(id + '@' + Math.round(rec[i].t) + ':' + c.ink);
      if (Math.abs(c.w - base.w) > 0.3) wBad.push(id + '@' + Math.round(rec[i].t) + ':' + c.w.toFixed(1));
      if (i && rec[i].t - rec[i - 1].t <= 40) { const pc = fr[i - 1]; if (Math.abs(c.mid - pc.mid) > 3 || (Math.abs(c.tag - pc.tag) > 3 && c.tag > 0 && pc.tag > 0)) stepBad.push(id + '@' + Math.round(rec[i].t) + ' mid ' + pc.mid.toFixed(1) + '>' + c.mid.toFixed(1)); }
    });
  }
  ok(tag + 'every number sits on its bubble\'s center line in every frame, sliding or not (within 0.3px of where it rests)', !inkBad.length, inkBad.slice(0, 4).join(' '));
  ok(tag + 'every bubble keeps its size in every frame', !wBad.length, wBad.slice(0, 4).join(' '));
  ok(tag + 'the bubbles and tags move in small steps, never a jump (3px or less a frame)', !stepBad.length, stepBad.slice(0, 4).join(' '));
  const still = rec.findIndex((r, i) => i && rec.slice(i).every(q => !q.ghost && q.c.every((c, k) => !c.slide && Math.abs(c.mid - r.c[k].mid) < 0.05)));
  ok(tag + 'everything rests with the cards (' + rest + 'ms, give or take a busy machine\'s 120ms; the old staggered numbers took 460 to 570ms)', still > 0 && rec[still].t <= rest + 120, 'rest at ' + (still > 0 ? Math.round(rec[still].t) : 'never'));
  return last;
}
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 3); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500);
  const rest = await p.evaluate(() => PE_TURN_MS);
  // drag the first page past the second
  const cs = await p.$$('#peGrid .page-card'), a = await cs[0].boundingBox(), bb = await cs[1].boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 3); await p.mouse.down();
  for (let i = 1; i <= 12; i++) { await p.mouse.move(a.x + a.width / 2 + (bb.x + bb.width * 0.85 - a.x - a.width / 2) * i / 12, a.y + a.height / 3); await p.waitForTimeout(16); }
  await p.waitForTimeout(150);
  await p.evaluate(RECORD); await p.mouse.up(); await p.waitForTimeout(1600);
  let rec = await p.evaluate(() => window.__rec);
  let last = judge('drag: ', rec, rest);
  ok('drag: the numbers and tags end right (1 with tag 2, 2 with tag 1, 3 alone)', JSON.stringify(last.c.map(c => c.txt)) === '["1","2","3"]' && last.c[0].tag > 0 && last.c[1].tag > 0, JSON.stringify(last.c.map(c => [c.txt, +c.tag.toFixed(1)])));
  ok('drag: the page you let go lands itself (no carried copy after the first frame)', rec.slice(1).every(r => !r.ghost));
  // the keyboard move puts the page back: the tags go, and the bubbles glide back to the middle
  await p.evaluate(RECORD); await p.evaluate(() => peMoveBy(+document.querySelector('#peGrid .page-card').dataset.id, 1)); await p.waitForTimeout(1600);
  rec = await p.evaluate(() => window.__rec);
  last = judge('keyboard move back: ', rec, rest);
  const mids = await p.evaluate(() => [...document.querySelectorAll('#peGrid .page-card')].map(c => { const f = c.querySelector('.pe-foot').getBoundingClientRect(), r = c.querySelector('.pe-pos').getBoundingClientRect(); return +(r.left + r.width / 2 - f.left - f.width / 2).toFixed(2); }));
  ok('keyboard move back: every bubble is back in the middle of its footer with no tag, and no fading copy is left', mids.every(m => Math.abs(m) < 0.3) && !(await p.$('.pe-num-out')), JSON.stringify(mids));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
