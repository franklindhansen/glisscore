// Zoom and fit for the video stage: one glass strip (Out, In, Fit, a divider, and the full screen button) at the bottom right of the stage; In, Out, Fit, the keys, Cmd/Ctrl-scroll,
// and a pinch zoom the picture with a transform; a drag pans once zoomed; Out and Fit are greyed at 1x; zoom resets on full screen and on a page-size change, and is never saved.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-stage-zoom.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const FX = process.env.S || 'tests/fixtures', K = '__keyframes';
(async () => {
  const b = await chromium.launch(), errs = [];
  const open = async (VW, VH, opt = {}) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: VW, height: VH } }, opt)), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
    await p.waitForFunction(() => window.__keyframes.S.pdf && window.__keyframes.duration() > 2); await p.waitForTimeout(900);
    await p.evaluate(() => { const a = document.querySelector('.app'); a.requestFullscreen = undefined; a.webkitRequestFullscreen = undefined; });
    return p;
  };
  const Z = p => p.evaluate(K => { const z = window[K].stageZoom, m = new DOMMatrix(getComputedStyle(document.querySelector('#stage')).transform); return { z: z.z, x: z.x, y: z.y, sx: m.a, tx: m.e, ty: m.f }; }, K);
  const dis = p => p.evaluate(() => ['#szOut', '#szFit', '#szIn'].map(s => document.querySelector(s).disabled));
  { const p = await open(1300, 900);
    const s = await p.evaluate(() => { const st = document.querySelector('.stage-strip'), w = document.querySelector('#stageWrap').getBoundingClientRect(), r = st.getBoundingClientRect(), bs = [...st.children].map(c => c.id || c.className), full = document.querySelector('#btnFull').getBoundingClientRect(), z = document.querySelector('#szIn').getBoundingClientRect();
      return { kids: bs, right: w.right - r.right, bottom: w.bottom - r.bottom, fh: full.height, zh: z.height, fullIn: st.contains(document.querySelector('#btnFull')), fit: document.querySelector('#szFit').textContent.trim() }; });
    ok('The strip holds Out, In, Fit, a divider, and the full screen button, at the bottom right', JSON.stringify(s.kids) === JSON.stringify(['szOut', 'szIn', 'szFit', 'stage-div', 'btnFull']) && s.fullIn && s.fit === 'Fit' && s.right > 4 && s.right < 20 && s.bottom > 4 && s.bottom < 20, JSON.stringify(s));
    ok('The full screen button and the zoom buttons share one height', s.fh === s.zh, JSON.stringify(s));
    ok('Out and Fit are greyed at 1x', JSON.stringify(await dis(p)) === '[true,true,false]', JSON.stringify(await dis(p)));
    await p.click('#szIn'); await p.waitForTimeout(500); let z = await Z(p);
    ok('In zooms the picture with a transform, and Out and Fit wake', z.z > 1.5 && Math.abs(z.sx - z.z) < 0.01 && JSON.stringify(await dis(p)) === '[false,false,false]', JSON.stringify(z));
    ok('The canvas is never resized by zoom (no CSS zoom)', await p.evaluate(() => getComputedStyle(document.querySelector('#stage')).zoom === '1'));
    const before = await Z(p), box = await p.evaluate(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.move(box.x - 60, box.y - 30, { steps: 5 }); await p.mouse.up(); z = await Z(p);
    ok('Dragging pans when zoomed', z.x < before.x - 40 && z.y < before.y - 15, JSON.stringify([before, z]));
    await p.click('#szFit'); await p.waitForTimeout(500); z = await Z(p);
    ok('Fit returns to 1x, centered', z.z === 1 && Math.abs(z.tx) < 0.5 && Math.abs(z.ty) < 0.5 && Math.abs(z.sx - 1) < 0.01, JSON.stringify(z));
    await p.mouse.move(box.x, box.y); await p.keyboard.press('+'); await p.waitForTimeout(500); z = await Z(p); const k1 = z.z;
    await p.keyboard.press('-'); await p.waitForTimeout(500); z = await Z(p); const k2 = z.z;
    await p.keyboard.press('+'); await p.keyboard.press('+'); await p.waitForTimeout(500); await p.keyboard.press('0'); await p.waitForTimeout(500); z = await Z(p);
    ok('The keys +, -, and 0 zoom in, out, and to Fit', k1 > 1.5 && k2 === 1 && z.z === 1, JSON.stringify([k1, k2, z.z]));
    await p.evaluate(() => { const s = document.querySelector('#stage'), r = s.getBoundingClientRect(); s.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); }); await p.waitForTimeout(200); z = await Z(p);
    ok('Ctrl-scroll zooms (what a trackpad pinch sends)', z.z > 1.3, JSON.stringify(z));
    await p.evaluate(() => { const s = document.querySelector('#stage'), r = s.getBoundingClientRect(); s.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, metaKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); }); await p.waitForTimeout(200); z = await Z(p);
    ok('Cmd-scroll zooms out', z.z === 1, JSON.stringify(z));
    const pps = () => p.evaluate(K => window[K].S.pxPerSec, K), wheel = sel => p.evaluate(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(); e.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true })); }, sel);
    const pps0 = await pps(); await wheel('#stage'); await p.waitForTimeout(300); z = await Z(p); const pps1 = await pps();
    ok('A pinch over the picture zooms the picture and leaves the timeline alone', z.z > 1.2 && pps1 === pps0, JSON.stringify([z.z, pps0, pps1]));
    await wheel('.tl-scroll'); await p.waitForTimeout(300); const z2 = await Z(p), pps2 = await pps();
    ok('A pinch over the timeline zooms the timeline and leaves the picture alone', pps2 !== pps1 && z2.z === z.z, JSON.stringify([z2.z, z.z, pps1, pps2]));
    await p.click('#szFit'); await p.waitForTimeout(500);
    await p.click('#szIn'); await p.waitForTimeout(500);
    const saved = await p.evaluate(K => JSON.stringify(window[K].S.set) + JSON.stringify(localStorage), K);
    ok('Zoom is not part of the saved settings', !/stageZoom|"zm"|szZoom/.test(saved));
    await p.evaluate(K => window[K].enterFull(), K); await p.waitForTimeout(900); z = await Z(p);
    ok('Zoom resets to Fit on full screen', z.z === 1 && Math.abs(z.sx - 1) < 0.01, JSON.stringify(z));
    await p.mouse.move(600, 400); await p.mouse.move(640, 420); await p.waitForTimeout(900);
    const fsGeo = () => p.evaluate(() => { const s = document.querySelector('#stageStrip'), t = document.querySelector('.timeline'), a = document.querySelector('.app'), sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect(); return { vis: getComputedStyle(s).display !== 'none' && +getComputedStyle(s).opacity > .9, gap: tr.top - sr.bottom, bottom: innerHeight - sr.bottom, min: a.classList.contains('fs-min'), kids: [...s.children].map(k => k.id || k.className) }; });
    let g = await fsGeo();
    ok('In full screen the zoom strip hovers just above the timeline bar', g.vis && g.gap >= 4 && g.gap <= 14 && g.kids.join() === 'szOut,szIn,szFit,stage-div,btnFull', JSON.stringify(g));
    await p.evaluate(() => document.querySelector('.app').classList.add('fs-min')); await p.mouse.move(620, 410); await p.waitForTimeout(1000); g = await fsGeo();
    ok('When the bar is hidden the strip drops to where the bar was', g.min && g.bottom < 40, JSON.stringify(g));
    await p.evaluate(() => document.querySelector('.app').classList.remove('fs-min')); await p.waitForTimeout(700);
    await p.evaluate(K => window[K].exitFull(), K); await p.waitForTimeout(900);
    await p.click('#szIn'); await p.waitForTimeout(500);
    await p.selectOption('#aspect', '1:1'); await p.waitForTimeout(600); z = await Z(p);
    ok('Zoom resets to Fit when the page size changes', z.z === 1, JSON.stringify(z));
    await p.close(); }
  { const p = await open(1300, 900, { reducedMotion: 'reduce' }); await p.click('#szIn'); const z = await Z(p), tr = await p.evaluate(() => document.querySelector('#stage').style.transition);
    ok('With reduced motion, zoom is instant', z.z > 1.5 && Math.abs(z.sx - z.z) < 0.01 && tr.startsWith('none'), JSON.stringify([z, tr]));
    await p.close(); }
  { const p = await open(1300, 900); await p.click('#szIn'); const tr = await p.evaluate(() => document.querySelector('#stage').style.transition);
    ok('Otherwise, zoom glides', /transform/.test(tr), tr); await p.close(); }
  // small stages: the strip never covers the picture
  for (const [VW, VH] of [[1040, 700], [700, 600], [390, 800], [1040, 420]]) for (const scheme of ['light', 'dark']) {
    const p = await open(VW, VH, { colorScheme: scheme }); await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const s = document.querySelector('.stage-strip').getBoundingClientRect(), c = document.querySelector('#stage').getBoundingClientRect(), w = document.querySelector('#stageWrap').getBoundingClientRect();
      return { hit: s.left < c.right && s.right > c.left && s.top < c.bottom && s.bottom > c.top, inside: s.left >= w.left - 0.5 && s.right <= w.right + 0.5 && s.top >= w.top - 0.5 && s.bottom <= w.bottom + 0.5, over: document.documentElement.scrollWidth > innerWidth }; });
    ok(VW + 'x' + VH + ' ' + scheme + ': the strip sits inside the stage and never covers the picture at 1x', !r.hit && r.inside && !r.over, JSON.stringify(r)); await p.close();
  }
  ok('No script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
