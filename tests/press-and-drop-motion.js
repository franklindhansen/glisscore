// Press feedback and the drop veil. The stage zoom and full screen buttons and the segmented control options press in (scale .97) while held,
// and the drop veil fades in and out instead of appearing in one frame. With reduced motion, the press stays still and the veil snaps.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/press-and-drop-motion.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
  const press = async (p, sel) => {
    const box = await p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }, sel);
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(250);
    const t = await p.evaluate(s => getComputedStyle(document.querySelector(s)).transform, sel); await p.mouse.up(); await p.waitForTimeout(250); return t;
  };
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const calm of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: calm ? 'reduce' : 'no-preference' }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    const tag = calm ? 'reduced motion: ' : '';
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf');
    await p.waitForFunction(() => window.__keyframes.S.pdf && window.__keyframes.duration() > 2); await p.waitForTimeout(800);

    // the drop veil: hidden at rest, visible while a file is dragged over the window
    const veil = () => p.evaluate(() => { const v = getComputedStyle(document.querySelector('.dropveil')); return { op: +v.opacity, vis: v.visibility }; });
    ok(tag + 'drop veil hidden at rest', (await veil()).vis === 'hidden');
    await p.evaluate(() => document.body.classList.add('dragging'));
    await p.waitForTimeout(50);
    const mid = await veil();
    await p.waitForTimeout(400);
    const end = await veil();
    ok(tag + 'drop veil shows while dragging', end.op === 1 && end.vis === 'visible', JSON.stringify(end));
    if (!calm) ok('drop veil fades in, not in one frame', mid.op > 0 && mid.op < 1, JSON.stringify(mid));
    await p.evaluate(() => document.body.classList.remove('dragging'));
    await p.waitForTimeout(50);
    const out = await veil();
    if (!calm) ok('drop veil fades out (still visible for a moment)', out.op > 0 && out.vis === 'visible', JSON.stringify(out));
    await p.waitForTimeout(400);
    ok(tag + 'drop veil hidden again after the drag', (await veil()).vis === 'hidden');

    // press feedback: zoom in holds at scale .97 while the mouse is down
    const fsT = await press(p, '#btnFull');
    if (calm) ok(tag + 'full screen button does not move on press', fsT === 'none', fsT);
    else ok('full screen button presses in (scale .97)', fsT.includes('0.97'), fsT);
    await p.evaluate(() => document.querySelector('#btnFull').click()); await p.waitForTimeout(600);
    await p.evaluate(() => document.querySelector('#btnFull').click()); await p.waitForTimeout(600);

    // segmented control: the pressed option steps in
    const segSel = await p.evaluate(() => { const l = [...document.querySelectorAll('.seg label')].find(x => x.offsetParent && x.getBoundingClientRect().width > 0); if (!l) return null; l.setAttribute('data-press', '1'); return '.seg label[data-press]'; });
    if (segSel) {
      const st = await press(p, segSel);
      if (calm) ok(tag + 'segmented option does not move on press', st === 'none', st);
      else ok('segmented option presses in (scale .97)', st.includes('0.97'), st);
    }
    // info icons press in too (the transition is set for the press, so it does not wait on the hover spring)
    if (!calm) {
      await p.evaluate(() => { const i = [...document.querySelectorAll('.info-i')].find(x => x.offsetParent && x.getBoundingClientRect().width > 0); i.setAttribute('data-press', '1'); });
      const ii = await press(p, '.info-i[data-press]');
      ok('info icon presses in (scale .92)', ii.includes('0.92'), ii);
    }
    // PDF Editor: the zoom buttons press in too
    await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
    await p.evaluate(() => { peTool('crop'); }); await p.waitForTimeout(600);
    await p.evaluate(() => { peOneOpen(PE.d.order[0]); }); await p.waitForTimeout(800);
    await p.evaluate(() => { const b = document.querySelector('#peZmIn'); b.setAttribute('data-press', '1'); });
    // the zoom strip sits over the picture, so the press is forced on the button itself (a mouse press here lands on the canvas beneath it)
    const cdp = await ctx.newCDPSession(p); await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 }), { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#peZmIn' });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
    await p.waitForTimeout(400);
    const pe = await p.evaluate(() => getComputedStyle(document.querySelector('#peZmIn')).transform);
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
    if (calm) ok(tag + 'PDF Editor zoom button does not move on press', pe === 'none', pe);
    else ok('PDF Editor zoom button presses in (scale .97)', pe.includes('0.97'), pe);
    await ctx.close();
  }
  // Audio Editor: a tool in the list presses in
  {
    const ctx = await b.newContext({ viewport: { width: 1040, height: 900 } }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/stereo.wav');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = [...document.querySelectorAll('.ae-tool')].find(x => x.offsetParent && x.getBoundingClientRect().width > 0); t.setAttribute('data-press', '1'); });
    const at = await press(p, '.ae-tool[data-press]');
    ok('Audio Editor tool presses in (scale .98)', at.includes('0.98'), at);
    await ctx.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
