// Video: Wrap's physical shadow. One rule for every piece of paper: a point at height h lands on the background shifted along the light and softened in proportion to h; at h=0 it is the
// Score shadow. Seam: pixels of a rendered frame (previewR.render, then the canvas), compared against the same frame with the Shadows switch off, and the old shadow (previewR.wrapShadow = 'classic').
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-wrap-shadow.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const MODEL = process.env.MODEL || 'physical';          // MODEL=classic runs the same checks on the old shadow
const K = '__keyframes', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
  // a light background with the score shadow on, then the default black, are both judged; the numbers below use the light one
  await p.evaluate(([K, MODEL]) => { const s = window[K].S.set; Object.assign(s, { pageLayout: 'single', transition: 'flip', turnStyle: 'wrap', fadeStyle: 'black', bg: '#e6e6e6', scoreAmt: 70, scoreSoft: 50, turnShadow: 60, turnSoft: 50, shadowsOn: true }); window[K].previewR.wrapShadow = MODEL; }, [K, MODEL]);
  await p.waitForTimeout(500);
  // render a frame, then read named probes: [x, y] in units of the page (x from the page's left edge in page widths, y from the page's top in page heights); a probe is the mean of a small patch
  const shot = (t, probes, model, extra) => p.evaluate(async ([K, t, probes, model, extra]) => {
    const kf = window[K], r = kf.previewR, S = kf.S; if (model) r.wrapShadow = model; if (extra) Object.assign(S.set, extra);
    const st = kf.frameState(t); st.fade = 1;
    for (let n = 0; n < 40; n++) { r.render(st); if (!r.pending.size) break; await new Promise(res => setTimeout(res, 50)); } r.render(st);
    const c = r.canvas, o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.drawImage(c, 0, 0);
    const lay = r.lay, out = probes.map(([u, v]) => { const px = Math.round(lay.cx + u * lay.pw), py = Math.round(lay.y0 + v * lay.ph), q = 3, d = x.getImageData(px - q, py - q, 2 * q + 1, 2 * q + 1).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); });
    const N = r.N, M = r.M, row = Math.floor(M / 2) * (N + 1); let mid = row;          // the sheet's height over the page's middle, and where its free edge is
    for (let i = 0; i <= N; i++) if (Math.abs(r.world[(row + i) * 3] - 0.5 * lay.pw) < Math.abs(r.world[mid * 3] - 0.5 * lay.pw)) mid = row + i;
    let xMax = -9; for (let i = 0; i <= N; i++) xMax = Math.max(xMax, r.world[(row + i) * 3] / lay.pw);
    const free = { xMax, x: r.world[(row + N) * 3] / lay.pw, z: r.world[(row + N) * 3 + 2] / lay.pw, zMid: r.world[mid * 3 + 2] / lay.pw, xMid: r.world[mid * 3] / lay.pw };
    return { out, free, pw: lay.pw };
  }, [K, t, probes, model, extra]);
  const turn = await p.evaluate(K => ({ s: window[K].S.turns[0] - refOffset(), D: flipDur() }), K);
  // a time while the sheet is standing up with its free edge still over the page: found by scanning the turn
  let lift = null;
  for (let i = 1; i <= 80 && !lift; i++) { const t = turn.s + turn.D * i / 160, f = (await shot(t, [])).free; if (f.zMid > 0.15 && Math.abs(f.xMid - 0.5) < 0.05) lift = { t, f }; }
  ok('the turn has a moment with the sheet standing up over the page', !!lift, JSON.stringify(lift));
  if (lift) {
    // a standing sheet's shadow is wider and softer than a flat one, so it reaches below the page's bottom edge further than the page's own shadow does (displacement along the light shows on the page, below)
    const probe = [[0.5, 1.022]], rest = (await shot(turn.s - 0.05, probe, null, { scoreSoft: 0 })).out[0], up = (await shot(lift.t, probe)).out[0];          // a hard page shadow barely reaches the probe, so the sheet's shows
    await shot(lift.t, [], null, { scoreSoft: 50 });
    ok('a standing sheet\'s shadow is soft: it spreads further below the page than the page\'s own', up < rest - 6, 'rest ' + rest.toFixed(1) + ' standing ' + up.toFixed(1));
  }

  // at rest and at the end of the turn the new shadow is the old drop shadow, at the same Score shadow settings
  const rim = [[1.03, 0.5], [1.06, 0.5], [0.5, 1.012], [0.5, 1.02], [-0.02, 0.5]];
  for (const [name, f] of [['the start of a turn', 0.01], ['the end of a turn', 0.99]]) {
    const a = (await shot(turn.s + turn.D * f, rim, 'classic')).out, c = (await shot(turn.s + turn.D * f, rim, 'physical')).out, d = Math.max(...a.map((v, i) => Math.abs(v - c[i])));
    ok('at ' + name + ' the shadow matches the current drop shadow', d <= 8, 'worst ' + d.toFixed(1) + ' classic ' + a.map(v => v.toFixed(0)) + ' new ' + c.map(v => v.toFixed(0)));
  }
  // the Shadows switch and the Score shadow's strength still control it
  const flat = (await shot(lift.t, [[0.5, 1.012], [1.03, 0.5]], 'physical', { shadowsOn: false })).out; await shot(lift.t, [], null, { shadowsOn: true });
  ok('with Shadows off nothing darkens the background', flat.every(v => v >= 229), flat.map(v => v.toFixed(0)));
  const none = (await shot(lift.t, [[0.5, 1.012], [1.03, 0.5]], null, { scoreAmt: 0 })).out; await shot(lift.t, [], null, { scoreAmt: 70 });
  ok('with the Score shadow at 0 the background is not darkened', none.every(v => v >= 229), none.map(v => v.toFixed(0)));
  // no frame-to-frame jump anywhere in the turn: the background's shadow (below the page, left of the hinge) and the shade on the page and on the sheet (against the same frame with Shadows off)
  const bgp = [], pgp = []; for (let u = -0.1; u <= 1.101; u += 0.1) bgp.push([u, 1.015]); for (let v = 0.1; v <= 0.91; v += 0.2) bgp.push([1.03, v]); for (let u = 0.1; u <= 0.91; u += 0.1) pgp.push([u, 0.93]);
  const all = bgp.concat(pgp), shade = [], bare = [];
  for (let i = 0; i <= 80; i++) {
    const t = turn.s + turn.D * i / 80, lit = (await shot(t, all, 'physical', { shadowsOn: true })).out, un = (await shot(t, all, null, { shadowsOn: false })).out;
    shade.push(lit.map(v => v)); bare.push(un);
  }
  await shot(turn.s, [], null, { shadowsOn: true });
  // a sheet sweeping past makes any one pixel change fast, so what is judged is the average change over a ring of probes (a pop would move them all) and the worst single one is only kept loose
  const change = (ks, clear) => { let sum = 0, n = 0, w = 0; ks.forEach(k => shade.slice(1).forEach((r, i) => { if (!clear(bare[i][k]) || !clear(bare[i + 1][k])) return; const d = Math.abs(r[k] - shade[i][k]); sum += d; n++; w = Math.max(w, d); })); return { mean: sum / Math.max(1, n), w }; };
  const cb = change(bgp.map((_, k) => k), v => Math.abs(v - 230) < 1.5), cp = change(pgp.map((_, k) => bgp.length + k), v => v > 253);
  ok('the background\'s shadow never jumps between frames of the turn', cb.mean < 3 && cb.w < 70, 'mean step ' + cb.mean.toFixed(2) + ', worst ' + cb.w.toFixed(1));
  ok('the shade on the page never jumps between frames of the turn', cp.mean < 4 && cp.w < 50, 'mean step ' + cp.mean.toFixed(2) + ', worst ' + cp.w.toFixed(1));

  // the page: a sheet above it shades it, and the closer the sheet the darker; a sheet behind it puts no shadow on it
  const ratio = async (t, probes, extra) => { const lit = (await shot(t, probes, null, { shadowsOn: true, ...extra })).out, un = (await shot(t, probes, null, { shadowsOn: false })).out; await shot(t, [], null, { shadowsOn: true }); return lit.map((v, k) => ({ r: v / Math.max(1, un[k]), un: un[k] })); };
  let low = null, high = null;          // the sheet's free edge just off the page (close), and well above it
  for (let i = 1; i <= 160 && !(low && high); i++) { const t = turn.s + turn.D * i / 320, f = (await shot(t, [])).free; if (!low && f.z > 0.05 && f.z < 0.14 && f.x > 0.3 && f.x < 0.95) low = { t, f }; if (!high && f.z > 0.28 && f.z < 0.34 && f.x > 0.2 && f.x < 0.7) high = { t, f }; }
  ok('the turn has a moment with the sheet close above the page and one with it high', !!(low && high), JSON.stringify({ low, high }));
  if (low && high) {
    const near = async m => { const d = 0.05, q = await ratio(m.t, [[m.f.xMax + d, 0.93]]); return q[0]; };
    const a = await near(low), c = await near(high);
    ok('the page darkens beside a standing sheet', a.un > 240 && c.un > 240 && c.r < 0.97, 'close ' + a.r.toFixed(3) + ' (bare ' + a.un.toFixed(0) + ') high ' + c.r.toFixed(3) + ' (bare ' + c.un.toFixed(0) + ')');
    ok('the page is darker the closer the sheet is (contact darkening)', a.r < c.r - 0.03, 'close ' + a.r.toFixed(3) + ' high ' + c.r.toFixed(3));
  }
  const pr = []; for (let u = 0.15; u <= 0.96; u += 0.1) pr.push([u, 0.93]);
  const gone = [0.85, 0.9, 0.95].map(f => turn.s + turn.D * f); let darkest = 1;
  for (const t of gone) (await ratio(t, pr)).forEach(q => { if (q.un > 253) darkest = Math.min(darkest, q.r); });
  ok('a sheet behind the page puts no shadow on it', darkest > 0.985, 'darkest ' + darkest.toFixed(3));
  // the crease along the hinge is not Turn shadow, so Turn shadow at 60 is judged against the same frame at 0
  const ts = async (t, probes) => { const on = (await shot(t, probes, null, { turnShadow: 60 })).out, off = (await shot(t, probes, null, { turnShadow: 0 })).out; await shot(t, [], null, { turnShadow: 60 }); return on.map((v, k) => v / Math.max(1, off[k])); };
  const sd = await ts(turn.s + turn.D * 0.7, [[-0.02, 0.5], [-0.1, 0.5]]);
  ok('the sheet is darkest at the page\'s edge once behind it, softening away', sd[0] < 0.97 && sd[0] < sd[1] - 0.05, 'at the edge ' + sd[0].toFixed(3) + ' away ' + sd[1].toFixed(3));
  if (high) { const q = await ts(high.t, [[high.f.xMax + 0.05, 0.93]]); ok('Turn shadow at 0 takes the sheet\'s shade off the page', q[0] < 0.97, 'at 60 the page is ' + q[0].toFixed(3) + ' of its shade at 0'); }
  // Peel and Spread are not touched: the same frames, whichever Wrap shadow is chosen
  const same = async (extra, f) => { const probes = []; for (let u = -0.1; u <= 1.1; u += 0.1) for (let v = 0.1; v <= 1.05; v += 0.15) probes.push([u, v]); const a = (await shot(turn.s + turn.D * f, probes, 'classic', extra)).out, c = (await shot(turn.s + turn.D * f, probes, 'physical')).out; return Math.max(...a.map((v, i) => Math.abs(v - c[i]))); };
  ok('Peel frames are the same with either Wrap shadow', (await same({ turnStyle: 'peel' }, 0.4)) === 0);
  await p.evaluate(K => { const s = window[K].S.set; s.pageLayout = 'spread'; }, K); await p.waitForTimeout(500);
  const t2 = await p.evaluate(K => ({ s: window[K].S.turns[0] - refOffset(), D: flipDur() }), K);
  { const probes = []; for (let u = -1; u <= 1.1; u += 0.1) for (let v = 0.1; v <= 1.05; v += 0.15) probes.push([u, v]); const a = (await shot(t2.s + t2.D * 0.4, probes, 'classic')).out, c = (await shot(t2.s + t2.D * 0.4, probes, 'physical')).out; ok('Spread frames are the same with either Wrap shadow', Math.max(...a.map((v, i) => Math.abs(v - c[i]))) === 0); }
  await p.evaluate(K => { const s = window[K].S.set; s.pageLayout = 'single'; s.turnStyle = 'wrap'; }, K); await p.waitForTimeout(500);
  if (process.env.SHOTS) for (const [tag, bg] of [['light', '#e6e6e6'], ['black', '#000000']]) for (const model of ['physical', 'classic']) {          // frame strips to judge by eye: SHOTS=<folder>
    await shot(turn.s, [], model, { bg });
    for (let i = 0; i < 12; i++) {
      const url = await p.evaluate(async ([K, t]) => { const r = window[K].previewR, st = window[K].frameState(t); st.fade = 1; for (let n = 0; n < 40; n++) { r.render(st); if (!r.pending.size) break; await new Promise(res => setTimeout(res, 50)); } r.render(st); return r.canvas.toDataURL('image/png'); }, [K, turn.s + turn.D * (i + 0.5) / 12]);
      require('fs').writeFileSync(process.env.SHOTS + '/' + tag + '-' + model + '-' + String(i).padStart(2, '0') + '.png', Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  await shot(turn.s, [], MODEL, { bg: '#e6e6e6' });
  // the sheet shows no faint line: along a row inside the sheet its brightness changes gently, with no step of a level or two from one pixel to the next (the eye picks out a slanted line of those)
  const stepAlong = t => p.evaluate(async ([K, t]) => {
    const kf = window[K], r = kf.previewR, st = kf.frameState(t); st.fade = 1; for (let n = 0; n < 40; n++) { r.render(st); if (!r.pending.size) break; await new Promise(res => setTimeout(res, 50)); } r.render(st);
    const c = r.canvas, o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d'); x.drawImage(c, 0, 0);
    const lay = r.lay, h = 60, w = Math.round(0.5 * lay.pw), x0 = Math.round(lay.cx - 0.5 * lay.pw), y0 = Math.round(lay.y0 + 0.55 * lay.ph), d = x.getImageData(x0, y0, w, h).data, m = [];
    for (let i = 0; i < w; i++) { let s = 0; for (let j = 0; j < h; j++) s += d[(j * w + i) * 4]; m.push(s / h); }
    const hinge = w - Math.round(0.12 * lay.pw); let first = m.findIndex(v => v > 240); if (first < 0) return 0;          // the sheet starts where it turns bright; its edge and the page's shadow beside the hinge are left out
    let worst = 0; for (let i = first + 12; i < hinge - 1; i++) if (m[i] > 240 && m[i - 1] > 240 && m[i + 1] > 240) worst = Math.max(worst, Math.abs(m[i + 1] - m[i - 1]) / 2);
    return worst;
  }, [K, t]);
  const steps = []; for (const f of [0.61, 0.62, 0.63]) steps.push(await stepAlong(turn.s + turn.D * f));
  ok('the sheet behind the page has no faint line across it', Math.max(...steps) < 0.25, 'steepest change per pixel ' + steps.map(v => v.toFixed(2)));

  // the shadow picture is released with the renderer, and when the frame changes size
  const rel = await p.evaluate(K => { const r = window[K].previewR, gl = r.gl, old = r.shT && r.shT.a.t; r.resize(r.W - 2, r.H); const gone = !!old && !gl.isTexture(old) && r.shT === null; return { had: !!old, gone }; }, K);
  ok('the shadow picture is released when the frame is resized', rel.had && rel.gone, JSON.stringify(rel));
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
