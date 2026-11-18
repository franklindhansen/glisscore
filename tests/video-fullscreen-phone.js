// Phone full screen matches desktop full screen: the stage fills the screen, the picture sits inside the safe area, the glass controls float over it, the zoom strip is fully on screen just above the play bar
// (editor shown or hidden), Hide editor leaves only the play bar, and leaving full screen restores the phone layout. At 390 x 844, 440 x 956, and 844 x 390.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-fullscreen-phone.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [vw, vh] of [[390, 844], [440, 956], [844, 390]]) for (const lay of ['spread', 'system']) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.keep.length > 0);
    await p.setInputFiles('#audioIn', FX + '/stereo.wav'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(600);
    if (lay === 'system') { await p.evaluate(() => { const r = document.querySelector('input[name=pageLayout][value=system]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForFunction(() => !SYS.prog && SYS.byPage.size >= 2); }
    await p.waitForTimeout(800);
    const box = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right, shown: getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }; }, s);
    const normal = await box('#stageWrap'), L = vw + 'x' + vh + ' ' + lay + ': ';
    // a phone with a notch: the safe area is simulated through the tokens the layout reads
    await p.evaluate(() => $('#btnFull').click()); await p.waitForTimeout(1600);
    await p.evaluate(([t, bt, l, r]) => { const a = document.querySelector('.app'); a.style.setProperty('--fs-top', t + 'px'); a.style.setProperty('--fs-bottom', bt + 'px'); a.style.setProperty('--fs-left', l + 'px'); a.style.setProperty('--fs-right', r + 'px'); layoutStage(); stageDirty = true; }, vw > vh ? [0, 21, 47, 47] : [47, 34, 0, 0]); await p.waitForTimeout(600);
    const inset = vw > vh ? { t: 0, b: 21, l: 47, r: 47 } : { t: 47, b: 34, l: 0, r: 0 };
    for (const hidden of [false, true]) {
      if (hidden) { await p.evaluate(() => setEditorHidden(true)); await p.waitForTimeout(1000); }
      const w = await box('#stageWrap'), cv = await box(lay === 'system' ? '#stage' : '#stage'), strip = await box('#stageStrip'), tr = await box('#transport'), tl = await box('.timeline'), E = L + (hidden ? 'editor hidden: ' : 'editor shown: ');
      ok(E + 'the stage fills the screen', Math.abs(w.w - vw) < 1 && Math.abs(w.h - vh) < 1, JSON.stringify([w.x, w.y, w.w, w.h]));
      ok(E + 'the picture is inside the safe area', cv.y >= inset.t - 0.5 && cv.b <= vh - inset.b + 0.5 && cv.x >= inset.l - 0.5 && cv.r <= vw - inset.r + 0.5, JSON.stringify([cv.x, cv.y, cv.r, cv.b]));
      const tight = vw > vh && !hidden;          // a phone on its side with the 262px timeline up: the play bar is within 35px of the top, so there is no room above it (accepted: the strip stays on the screen, at the top)
      ok(E + (tight ? 'the zoom strip is fully on screen' : 'the zoom strip is fully on screen, above the play bar'), strip.shown && strip.y >= 0 && strip.b <= vh && strip.r <= vw - inset.r + 0.5 && (tight || strip.b <= tr.y + 0.5), JSON.stringify([strip.y, strip.b, tr.y]));
      if (!hidden) ok(E + 'the play bar sits over the picture (floating, not below it)', tr.y < cv.b || cv.b > vh - 400, JSON.stringify([tr.y, cv.b]));
      if (hidden) ok(E + 'only the play bar is left (the timeline is hidden)', !(await p.evaluate(() => { const t = document.querySelector('.timeline'), cs = getComputedStyle(t); return cs.visibility !== 'hidden' && +cs.opacity > 0 && t.getBoundingClientRect().top < innerHeight; })) , JSON.stringify([tl.y, tl.shown]));
      if (hidden && !(vw > vh)) ok(E + 'the picture keeps its size', Math.abs(cv.w - (await box('#stage')).w) < 1);
    }
    await p.evaluate(() => $('#btnFull').click()); await p.waitForTimeout(1400);
    const back = await box('#stageWrap'); ok(L + 'leaving full screen restores the phone layout', Math.abs(back.h - normal.h) < 1 && Math.abs(back.w - normal.w) < 1, JSON.stringify([normal.w, normal.h, back.w, back.h]));
    await ctx.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
