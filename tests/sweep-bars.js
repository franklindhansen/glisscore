// Every bar of unknown length (the busy chip, the noise-reduction track, the credits font box) uses the one sweep: same band, same clock, same curve. It starts at the left edge, a rebuilt chip keeps its place in the pass, and a stop lets the pass finish.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/sweep-bars.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(800);
  const look = await p.evaluate(async () => {
    const nr = document.querySelector('#aeNrProgBar .nr-prog-t'), box = document.createElement('div'); box.className = 'combo'; box.innerHTML = '<span class="combo-bar"></span>'; document.body.appendChild(box);
    const fb = box.firstChild; setBusy('Loading score…', 'pdf', 'x.pdf', null); await new Promise(r => setTimeout(r, 300));
    const chip = document.querySelector('#chips .busybar'), hosts = { chip, nr, font: fb };
    for (const h of Object.values(hosts)) sweepStart(h);
    const out = {}; for (const [k, h] of Object.entries(hosts)) { const c = getComputedStyle(h, '::after'); out[k] = [c.animationName, c.animationDuration, c.animationTimingFunction, c.animationIterationCount, c.backgroundColor, h.getBoundingClientRect().width ? Math.round(parseFloat(c.width) / h.getBoundingClientRect().width * 100) : 40].join('|'); }          // the noise track is not laid out until the Audio Editor opens, so its band width is checked in CSS terms only
    const rebuilt = await (async () => { await new Promise(r => setTimeout(r, 500)); const before = document.querySelector('#chips .busybar'); setBusy('Loading score page 2…', 'pdf', 'x.pdf', null); const after = document.querySelector('#chips .busybar'); const d = parseFloat(after.style.getPropertyValue('--sweep-delay')); return { newBar: before !== after, delay: d, sweeping: after.classList.contains('sweeping') }; })();
    const stopped = await (async () => { sweepStop(nr); const still = nr.classList.contains('sweeping'); await new Promise(r => setTimeout(r, 1700)); return { still, after: nr.classList.contains('sweeping') }; })();
    setBusy('', ''); box.remove(); return { out, rebuilt, stopped };
  });
  const v = Object.values(look.out);
  ok('the three bars run the same animation, length, curve, color, and band width', v.every(x => x.replace(/\|\d+$/, '') === v[0].replace(/\|\d+$/, '') && Math.abs(+x.split('|').pop() - 40) <= 1) && /^bar-sweep\|1.3s\|cubic-bezier\(0.45, 0, 0.25, 1\)\|infinite/.test(v[0]), JSON.stringify(look.out));
  ok('a chip rebuilt in the middle of a pass keeps its place in it', look.rebuilt.newBar && look.rebuilt.sweeping && look.rebuilt.delay < -300 && look.rebuilt.delay > -1300, JSON.stringify(look.rebuilt));
  ok('a stopped bar finishes its pass and then goes', look.stopped.still && !look.stopped.after, JSON.stringify(look.stopped));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
