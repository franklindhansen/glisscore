// The first time the Audio Editor opens it settles with no motion of its own: nothing inside the Noise reduction pane or the tool list moves, resizes, or fades once the window is up (from 120ms after the click), the same as on the second open.
// Positions are taken relative to the window, so the window's own entrance (it fades and drifts in) is left out. Run through tests/run-all.sh.
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push(e.message); });
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/stereo.wav'); await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.waitForTimeout(1200);
  const watch = () => p.evaluate(async () => {
    const nm = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\s+/).slice(0, 2).join('.');
    const snap = () => { const W = document.querySelector('#aeWin').getBoundingClientRect(), o = new Map(); for (const e of document.querySelectorAll('#aePaneNoise *, #aeRail *')) { const r = e.getBoundingClientRect(); if (!r.width && !r.height) continue; o.set(e, [r.left - W.left, r.top - W.top, r.width, r.height, +getComputedStyle(e).opacity]); } return o; };
    const t0 = performance.now(), frames = []; openAudioEditor();
    await new Promise(res => { const step = () => { frames.push([performance.now() - t0, snap()]); if (frames.length < 60) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    const late = frames.filter(f => f[0] >= 120), moved = new Map();
    for (let i = 1; i < late.length; i++) for (const [e, s] of late[i][1]) { const q = late[i - 1][1].get(e); if (!q) continue; const d = Math.max(Math.abs(s[0] - q[0]), Math.abs(s[1] - q[1]), Math.abs(s[2] - q[2]), Math.abs(s[3] - q[3]), Math.abs(s[4] - q[4]) * 40); if (d > 0.5) moved.set(nm(e), Math.max(moved.get(nm(e)) || 0, +d.toFixed(1))); }
    return { frames: late.length, moved: [...moved].slice(0, 8).map(m => m.join(' ')).join(', ') };
  });
  const first = await watch(); ok('the first open: nothing in the Noise pane or the tool list moves after the window is up', first.frames > 10 && !first.moved, JSON.stringify(first));
  await p.evaluate(() => closeAudioEditor()); await p.waitForTimeout(900);
  const second = await watch(); ok('the second open: the same', second.frames > 10 && !second.moved, JSON.stringify(second));
  ok('no page errors', !errs.length, errs.join('; ')); await b.close();
})();
