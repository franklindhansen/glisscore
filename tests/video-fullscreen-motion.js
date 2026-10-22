// Video player full screen is one glide in both directions: the picture and its frame travel to the other layout's rectangle, and the old header, settings, bar, and timeline (the timeline's drawing too)
// stay as copies that fade out while the new ones come in, so nothing pops out of the window in a single frame. No copy is left behind, and with reduced motion the layout changes at once with no copies.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-fullscreen-motion.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const record = (p, act) => p.evaluate(act => new Promise(res => {
  const out = [], t0 = performance.now(); eval(act);
  (function f() { const t = performance.now() - t0, w = document.querySelector('#stageWrap').getBoundingClientRect(), gs = [...document.querySelectorAll('.fs-ghost')];
    out.push({ t, w: w.width, ghosts: gs.length, op: gs.map(g => +getComputedStyle(g).opacity), inked: gs.filter(g => g.querySelector('canvas')).every(g => [...g.querySelectorAll('canvas')].some(c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4 * 61) if (d[i]) return true; return false; })) });
    if (t < 900) requestAnimationFrame(f); else res(out); })();
}), act);
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [calm, VW, VH] of [[false, 1300, 900], [false, 900, 600], [true, 1300, 900]]) {
    const ctx = await b.newContext({ viewport: { width: VW, height: VH }, reducedMotion: calm ? 'reduce' : 'no-preference' }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf');
    await p.waitForFunction(() => window.__keyframes.S.pdf && window.__keyframes.duration() > 2); await p.waitForTimeout(1200);
    await p.evaluate(() => { const a = document.querySelector('.app'); a.requestFullscreen = undefined; a.webkitRequestFullscreen = undefined; });          // the browser's own full screen is not under test
    for (const dir of ['in', 'out']) {
      const tag = (calm ? 'reduced motion, ' : '') + VW + 'x' + VH + ' ' + (dir === 'in' ? 'to full screen' : 'back to the window') + ': ';
      const rec = await record(p, "document.querySelector('#btnFull').click()"), seen = rec.filter(r => r.ghosts), last = rec[rec.length - 1];
      const lbl = await p.evaluate(() => document.querySelector('#btnFull').getAttribute('aria-label'));
      ok(tag + 'the full screen button toggles both ways and says what it does next', lbl === (dir === 'in' ? 'Exit full screen' : 'Full screen'), lbl);
      if (calm) { ok(tag + 'no copies and nothing gliding', !seen.length); }
      else {
        const first = rec.find(r => r.ghosts);
        ok(tag + 'the old chrome stays as copies for the first frames (header, settings, bar, and timeline going in; the bar and timeline coming out)', first && first.ghosts >= (dir === 'in' ? 3 : 2) && first.t < 100, JSON.stringify(first && { t: Math.round(first.t), n: first.ghosts }));
        ok(tag + 'the copies carry the timeline\'s drawing (not blank canvases)', seen.every(r => r.inked));
        ok(tag + 'the copies fade out and are gone, none left behind', last.ghosts === 0 && seen.every(r => r.op.every(o => o <= 1.001)) && seen[seen.length - 1].op.every(o => o < 0.5), JSON.stringify({ left: last.ghosts, lastSeen: seen[seen.length - 1] && seen[seen.length - 1].op }));
        const ws = rec.map(r => r.w), span = ws[ws.length - 1] - ws[0], mono = ws.every((v, i) => !i || (v - ws[i - 1]) * Math.sign(span) >= -0.5);
        ok(tag + 'the picture frame moves one way to its final size in steps of under half the way', mono && Math.max(...ws.slice(1).map((v, i) => Math.abs(v - ws[i]))) < Math.abs(span) * 0.5, JSON.stringify({ from: Math.round(ws[0]), to: Math.round(ws[ws.length - 1]) }));
      }
      await p.waitForTimeout(500);
    }
    await ctx.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
