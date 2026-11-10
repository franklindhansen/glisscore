// Video, a page not ready: in Spread, Single page, and System a page whose picture is still being made shows its softened thumbnail (or dim paper), never a white sheet; the wait pill, with the shared sweep along its foot, comes after 350ms;
// each page of a spread has its own state; the sharp picture fades in only for a page that was shown unready; the selector shows the same look until systems are found.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-page-not-ready.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const open = async (opts = {}) => {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
    await p.waitForFunction(() => window.__keyframes.S.pdf && window.__keyframes.duration() > 2, null, { timeout: 60000 }); await p.waitForTimeout(600);
    // pages named in __block wait at the gate until __release(): their pictures are "still being made"
    await p.evaluate(() => {
      const r = window.__keyframes.previewR, o = r.src.render.bind(r.src); window.__block = new Set(); let open; window.__gate = new Promise(res => { open = res; }); window.__release = () => { window.__block.clear(); open(); };
      r.src.render = (idx, ...a) => window.__block.has(idx) ? window.__gate.then(() => o(idx, ...a)) : o(idx, ...a);
      const os = window.sysSheet; window.sysSheet = (key, ...a) => window.__block.has(key) ? window.__gate.then(() => os(key, ...a)) : os(key, ...a);
    });
    return p;
  };
  const layout = (p, v) => p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const waits = p => p.evaluate(() => [...document.querySelectorAll('#stageWaits .pg-wait:not(.out)')].map(e => {
    const c = document.querySelector('#stage').getBoundingClientRect(), r = e.getBoundingClientRect(), l = e.firstChild, ls = getComputedStyle(l);
    const q = l.getBoundingClientRect();
    return { page: e.dataset.page, text: l.textContent, shown: e.classList.contains('show') && +ls.opacity > 0.5, sweeping: l.lastChild.classList.contains('sweeping'), cx: (r.left + r.width / 2 - c.left) / c.width, pill: [q.left, q.top, q.width, q.height], mid: Math.abs(q.left + q.width / 2 - r.left - r.width / 2), tf: ls.transform };
  }));
  const centerPx = (p, which = 1) => p.evaluate(which => {
    const r = window.__keyframes.previewR, gl = r.gl, lay = r.lay, x = Math.round((which ? lay.cx + lay.pw / 2 : lay.x0 + lay.pw / 2)), y = Math.round(lay.y0 + lay.ph / 2), px = new Uint8Array(4);
    gl.readPixels(x, r.H - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [px[0], px[1], px[2]];
  }, which);
  const notWhite = c => c.every(v => v < 250) && c[0] > 60;
  const pause = ms => new Promise(r => setTimeout(r, ms));

  for (const lay of ['spread', 'single', 'system']) {
    const p = await open(); await layout(p, lay); await p.waitForTimeout(600);
    if (lay === 'system') { await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(400); }
    const n = await p.evaluate(() => Math.min(2, window.__keyframes.S.spreads.length - 1));
    const sp = await p.evaluate(([n]) => { const K = window.__keyframes, { S, Transport, previewR: r } = K; const s = S.spreads[n]; window.__block.clear(); [s[1]].forEach(i => i >= 0 && window.__block.add(i)); r.clearTextures(); Transport.seek(S.turns[n - 1] + 1.3); return s.slice(); }, [n]);
    await p.waitForTimeout(150);
    let w = await waits(p), px = await centerPx(p);
    ok(lay + ': a page being made shows its softened picture, not white', w.length === 1 && notWhite(px), JSON.stringify([w, px]));
    ok(lay + ': no pill or sweep yet at 150ms', w.length === 1 && !w[0].shown && !w[0].sweeping, JSON.stringify(w));
    await p.waitForTimeout(400); w = await waits(p);
    const want = /^Rendering p\. \d+…$/;
    ok(lay + ': the pill shows after about 350ms, with the sweep along its foot', w.length === 1 && w[0].shown && w[0].sweeping && want.test(w[0].text), JSON.stringify(w));
    ok(lay + ': the pill is centered on its page by layout, on whole pixels', w.length === 1 && w[0].tf === 'none' && w[0].mid < 0.51 && w[0].pill.every(v => Math.abs(v - Math.round(v)) < 0.01), JSON.stringify(w));
    if (lay === 'spread') {
      ok('spread: the label sits centered on its own (right-hand) page', w[0].cx > 0.5 && w[0].cx < 0.8, String(w[0].cx));
      ok('spread: the loaded neighbor stays sharp, with no label of its own', await p.evaluate(i => window.__keyframes.previewR.tex.has(i), sp[0]), JSON.stringify(sp));
    }
    // the picture arrives: it fades in over the unfinished one, then the layer is gone
    await p.evaluate(() => window.__release());
    await p.waitForFunction(() => window.__keyframes.previewR.fx.size > 0, null, { polling: 'raf', timeout: 5000 }).then(() => ok(lay + ': the sharp picture cross-fades in when the page arrives', true), () => ok(lay + ': the sharp picture cross-fades in when the page arrives', false));
    await p.waitForTimeout(600);
    ok(lay + ': then the sweep and label are gone and the fade is done', (await waits(p)).length === 0 && (await p.evaluate(() => window.__keyframes.previewR.fx.size)) === 0);
    // moving between ready pages never fades
    const fades = await p.evaluate(async () => {
      const K = window.__keyframes, { S, Transport, previewR: r, frameState } = K; let max = 0;
      for (const m of [1, 2, 1, 0, 1]) { if (!S.spreads[m]) continue; const t = m === 0 ? S.vStart : S.turns[m - 1] + 1.3; S.time = t; const st = frameState(t); st.fade = 1; await r.ensure(pagesFor(st)); r.render(st); max = Math.max(max, r.fx.size, r.notReady.size); }
      return max;
    });
    ok(lay + ': moving between ready pages never fades or waits', fades === 0, String(fades));
    await p.close();
  }

  // a spread: each page has its own state and label
  { const p = await open(); await layout(p, 'spread'); await p.waitForTimeout(600);
    await p.evaluate(() => { const { S, Transport, previewR: r } = window.__keyframes, s = S.spreads[Math.min(2, S.spreads.length - 1)]; [s[0], s[1]].forEach(i => window.__block.add(i)); r.clearTextures(); Transport.seek(S.turns[Math.min(2, S.spreads.length - 1) - 1] + 1.3); });
    await p.waitForTimeout(600); const w = await waits(p);
    ok('spread: both unfinished pages have their own label, each centered on its own page', w.length === 2 && w.every(x => x.shown) && w.some(x => x.cx < 0.5) && w.some(x => x.cx > 0.5) && w[0].page !== w[1].page, JSON.stringify(w));
    await p.close(); }

  // a page too narrow for the page number gets the short wording, and the pill may pass its edges
  { const p = await open(); await layout(p, 'spread'); await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      const host = document.querySelector('#stageWaits'), mk = w => { pgWaitSet(host, [{ id: 'probe', x: 40, y: 40, w, h: 120, text: tx('stage.rendering', { n: 12 }), short: tx('stage.rendering.short'), now: true }]); const e = host.querySelector('.pg-wait[data-page=probe]'), q = e.firstChild.getBoundingClientRect(), b = e.getBoundingClientRect(); return { t: e.firstChild.textContent, mid: Math.abs(q.left + q.width / 2 - b.left - b.width / 2), over: q.width > b.width }; };
      const out = [mk(300), mk(90), mk(40)]; pgWaitSet(host, []); return out;
    });
    ok('a wide page names its page; a narrow one gets the short wording', r[0].t === 'Rendering p. 12…' && r[1].t === 'Rendering…' && r[2].t === 'Rendering…', JSON.stringify(r));
    ok('the pill stays centered when it is wider than its page', r[2].over && r[2].mid < 0.51, JSON.stringify(r));
    await p.close(); }

  // reduced motion holds the sweep still and shortens the fade
  { const p = await open({ reduced: true }); await layout(p, 'spread'); await p.waitForTimeout(600);
    await p.evaluate(() => { const { S, Transport, previewR: r } = window.__keyframes, s = S.spreads[Math.min(2, S.spreads.length - 1)]; window.__block.add(s[1]); r.clearTextures(); Transport.seek(S.turns[Math.min(2, S.spreads.length - 1) - 1] + 1.3); });
    await p.waitForTimeout(500);
    const anim = await p.evaluate(() => { const e = document.querySelector('#stageWaits .pg-wait .wait-bar.sweeping'); return e ? getComputedStyle(e, '::after').animationName : 'missing'; });
    ok('reduced motion: the sweep holds still', anim === 'none', anim);
    await p.evaluate(() => window.__release()); const t0 = Date.now();
    await p.waitForFunction(() => window.__keyframes.previewR.fx.size > 0, null, { polling: 'raf', timeout: 5000 });
    await p.waitForFunction(() => window.__keyframes.previewR.fx.size === 0, null, { polling: 'raf', timeout: 5000 });
    ok('reduced motion: the fade is short', Date.now() - t0 < 250, String(Date.now() - t0));
    await p.close(); }

  // System: the selector shows a softened page, with no label of its own, until systems are found
  { const p = await open(); await layout(p, 'system'); await p.waitForTimeout(600); await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(600);
    const sel = await p.evaluate(() => {
      const key = selCurrent(), idx = sysPage(key); SYS.byPage.delete(idx); SYS.rev++; selSync(true);
      const e = document.querySelector('#selWaits .pg-wait:not(.out)'), cv = document.querySelector('#selCv'), g = cv.getContext('2d'), geo = SEL.geo, px = g.getImageData(Math.round(geo.ox + geo.pa * geo.u / 2), Math.round(geo.oy + geo.u / 2), 1, 1).data;
      return { label: !!e, px: [px[0], px[1], px[2]] };
    });
    ok('the selector shows a softened page with no label of its own until systems are found', !sel.label && notWhite(sel.px), JSON.stringify(sel));
    await p.waitForTimeout(500);
    await p.close(); }

  await b.close();
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
})();
