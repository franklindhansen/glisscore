// Video, System layout: the canvas splits into selector | preview, with a divider, presets, and the playhead and selector linked.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-canvas.js
const { chromium } = require('playwright-core');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
function staffPage(doc, n) {
  const page = doc.addPage([PW, PH]);
  for (let k = 0; k < n; k++) {
    const y = 110 + k * 250;
    for (const off of [0, 62]) for (let j = 0; j < 5; j++) page.drawLine({ start: { x: 50, y: PH - (y + off + j * 7) }, end: { x: 545, y: PH - (y + off + j * 7) }, thickness: 0.7 });
    [50, 300, 545].forEach(x => page.drawLine({ start: { x, y: PH - y }, end: { x, y: PH - (y + 62 + 28) }, thickness: 0.9 }));
    for (let q = 0; q < 8; q++) page.drawEllipse({ x: 70 + q * 60, y: PH - (y + (q % 5) * 7), xScale: 4, yScale: 3 });
  }
}
(async () => {
  const doc = await PDFDocument.create(); staffPage(doc, 3); staffPage(doc, 2); staffPage(doc, 1); staffPage(doc, 3);           // 9 systems on 4 pages
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 4, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const pick = (name, v) => p.evaluate(([name, v]) => { const r = document.querySelector('input[name=' + name + '][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, [name, v]);
  const geo = () => p.evaluate(() => { const w = document.querySelector('#stageWrap'), sel = document.querySelector('#sysSel'), d = document.querySelector('#sysDiv'), st = document.querySelector('#stage'), r = e => e.getBoundingClientRect(), wr = r(w);
    return { hidden: sel.hidden, wrap: [wr.width, wr.height], sel: [r(sel).width, r(sel).height], selX: r(sel).left - wr.left, selY: r(sel).top - wr.top, div: [r(d).left - wr.left, r(d).top - wr.top, r(d).width, r(d).height], st: [r(st).left - wr.left, r(st).top - wr.top, r(st).width, r(st).height], dh: d.hidden, pressed: [...document.querySelectorAll('#sysPresets button')].map(x => x.getAttribute('aria-pressed')) }; });
  const near = (a, b, e = 3) => Math.abs(a - b) <= e;
  const hist = () => p.evaluate(() => document.querySelector('#bUndo').disabled);
  await pick('pageLayout', 'spread'); await p.waitForTimeout(300);
  let g = await geo();
  ok('Spread and Single page show no selector or presets', g.hidden && await p.evaluate(() => document.querySelector('#sysPresets').hidden));
  await pick('pageLayout', 'system'); await p.evaluate(() => sysDetectAll()); await p.waitForTimeout(1500);
  g = await geo();
  ok('System splits the stage with the preview wide (selector 0.3)', !g.hidden && near(g.sel[0], 0.3 * (g.wrap[0] - 2), 4) && near(g.sel[1], g.wrap[1] - 2), JSON.stringify(g));
  ok('the preview sits right of the divider and inside the stage', g.st[0] >= g.div[0] + g.div[2] - 1 && g.st[0] + g.st[2] <= g.wrap[0] && g.pressed[2] === 'true', JSON.stringify(g));
  ok('there is no Edit systems button', await p.evaluate(() => !document.querySelector('#spMark')));
  const undoBefore = await hist();
  const dv = await p.evaluate(() => { const r = document.querySelector('#sysDiv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(dv[0], dv[1]); await p.mouse.down(); await p.mouse.move(dv[0] + 150, dv[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
  const g2 = await geo();
  ok('the divider drags', g2.sel[0] > g.sel[0] + 120, JSON.stringify([g.sel[0], g2.sel[0]]));
  await p.mouse.dblclick(...(await p.evaluate(() => { const r = document.querySelector('#sysDiv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }))); await p.waitForTimeout(900);
  const g3 = await geo();
  ok('a double-click glides it back to half and half', near(g3.sel[0], (g3.wrap[0] - 2) / 2, 3), JSON.stringify([g.sel[0], g3.sel[0]]));
  ok('the split is not a History step', (await hist()) === undoBefore);
  for (const [id, f] of [['spSel', 0.7], ['spPrev', 0.3]]) { await p.click('#' + id); await p.waitForTimeout(800); g = await geo(); ok('preset ' + id + ' gives the selector ' + f, near(g.sel[0], f * (g.wrap[0] - 2), 4) && g.pressed[['spSel', 'spEq', 'spPrev', 'spOnly'].indexOf(id)] === 'true', JSON.stringify(g)); }
  await p.click('#spOnly'); await p.waitForTimeout(800); g = await geo();
  ok('Preview only hides the selector and gives the preview the stage', g.hidden && g.dh && g.st[2] > 700, JSON.stringify(g));
  await p.click('#spEq'); await p.waitForTimeout(800);
  // linked both ways
  const at = i => p.evaluate(i => { const t = i === 0 ? S.vStart : S.turns[i - 1] - refOffset() + flipDur() + 0.01; Transport.seek(t); return t; }, i);
  await at(4); await p.waitForTimeout(500);
  let s = await p.evaluate(() => ({ pg: document.querySelector('#selPg').textContent, key: SEL.key, prev: document.querySelector('#selPrev').disabled, next: document.querySelector('#selNext').disabled }));
  ok('moving the playhead changes the selector\'s page and system', s.pg === 'Page 2' && s.key === 100001 + 1 - 1 + 0 || s.key === 1 + 100000, JSON.stringify(s));
  const box = await p.evaluate(() => { const cv = document.querySelector('#selCv'), r = cv.getBoundingClientRect(), geo = SEL.geo, sy = SYS.byPage.get(0).systems[2]; return { x: r.left + ((geo.ox + geo.u * geo.pa / 2) / cv.width) * r.width, y: r.top + ((geo.oy + geo.u * (sy.top + sy.bottom) / 2) / cv.height) * r.height }; });
  await p.evaluate(() => { Transport.seek(S.turns[3] - refOffset() + flipDur() + 0.01); }); await p.waitForTimeout(500);
  const box0 = await p.evaluate(() => { const cv = document.querySelector('#selCv'), r = cv.getBoundingClientRect(), geo = SEL.geo, sy = SYS.byPage.get(geo.idx).systems[0]; return { x: r.left + ((geo.ox + geo.u * geo.pa / 2) / cv.width) * r.width, y: r.top + ((geo.oy + geo.u * (sy.top + sy.bottom) / 2) / cv.height) * r.height, idx: geo.idx }; });
  await p.mouse.click(box0.x, box0.y); await p.waitForTimeout(500);
  ok('clicking a system jumps the playhead to it', await p.evaluate(() => sysPage(SEL.key) === 1 && sysNo(SEL.key) === 0 && Math.abs(S.time - (S.turns[2] - refOffset() + flipDur())) < 0.1), JSON.stringify(await p.evaluate(() => [SEL.key, S.time])));
  await p.click('#selNext'); await p.waitForTimeout(500);
  ok('Next page moves to the next page', await p.evaluate(() => sysPage(SEL.key) === 2 && document.querySelector('#selPg').textContent === 'Page 3'));
  await p.click('#selPrev'); await p.click('#selPrev'); await p.waitForTimeout(500);
  ok('Previous page stops at the first, with the button greyed', await p.evaluate(() => sysPage(SEL.key) === 0 && document.querySelector('#selPrev').disabled));
  // the frame guide: the neighbors inside the frame are masked, the music inside is shown
  await p.evaluate(() => { Transport.seek(S.vStart); const a = document.querySelector('#aspect'); a.value = '9:16'; a.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(900);          // a tall frame reaches the neighbors
  const fr = await p.evaluate(() => {
    const cv = document.querySelector('#selCv'), geo = SEL.geo, { W, H } = outputSize(), f = sysFit(SEL.key, W, H), pa = geo.pa, box = f.box, nb = SYS.byPage.get(geo.idx).systems[1];
    const fw = W / f.s, fh = H / f.s, fx = (box.left + box.right) / 2 * pa - fw / 2, fy = (box.top + box.bottom) / 2 - fh / 2, px = (x, y) => Array.from(cv.getContext('2d').getImageData(Math.round(geo.ox + x * geo.u), Math.round(geo.oy + y * geo.u), 1, 1).data);
    const rowSpread = (y0, y1) => { const v = []; for (let y = y0; y < y1; y += 0.004) for (let x = box.left * pa + 0.02; x < box.right * pa - 0.02; x += 0.01) v.push(px(x, y)[0]); return Math.max(...v) - Math.min(...v); };
    const ys = (nb.top + nb.bottom) / 2, inFrame = nb.top > fy && nb.bottom < fy + fh;
    return { inFrame, aspect: fw / fh, want: W / H, mask: rowSpread(nb.top, nb.bottom), ink: rowSpread(box.top, box.bottom), pastEdge: fx < 0 ? px(fx / 2, 0.5).join() : 'none' };
  });
  if (process.env.SHOTS) { await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/stage.png' }); await p.locator('#selCv').screenshot({ path: process.env.SHOTS + '/sel.png' }); }
  ok('the frame has the video\'s shape', Math.abs(fr.aspect - fr.want) < 1e-6, JSON.stringify(fr));
  ok('a neighbor inside the frame is glass, and the selected music is shown', fr.inFrame && fr.mask < 64 && fr.ink > 150, JSON.stringify(fr));
  // the Preview frame: rigid, the page is sized once, and every system's frame fits the pane
  const sizes = [];
  for (const [pg, no] of [[0, 0], [0, 2], [1, 0], [3, 0]]) {
    const key = await p.evaluate(([pg, no]) => { const r = SYS.byPage.get(pg); const k = sysKey(pg, Math.min(no, r.systems.length - 1)); Transport.seek(selTimeOf(k)); return k; }, [pg, no]); await p.waitForTimeout(500);
    sizes.push(await p.evaluate(() => { const g = SEL.geo, m = 1; return { u: g.u, fits: (g.ox + g.fx * g.u) >= -m && (g.oy + g.fy * g.u) >= -m && (g.ox + (g.fx + g.fw) * g.u) <= g.w + m && (g.oy + (g.fy + g.fh) * g.u) <= g.h + m }; }));
  }
  ok('the page keeps one size from system to system', sizes.every(q => Math.abs(q.u - sizes[0].u) < 1e-6), JSON.stringify(sizes));
  ok('the whole Preview frame is inside the pane for the top and bottom systems', sizes.every(q => q.fits), JSON.stringify(sizes));
  const edge = await p.evaluate(() => { const g = SEL.geo, cv = document.querySelector('#selCv'), r = cv.getBoundingClientRect(), k = r.width / cv.width; return { x: r.left + (g.ox + (g.fx + g.fw / 2) * g.u) * k, y: r.top + (g.oy + g.fy * g.u) * k, h: S.history.length, box: JSON.stringify(g.box) }; });
  await p.mouse.move(edge.x, edge.y); await p.mouse.down(); await p.mouse.move(edge.x, edge.y + 12, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  ok('the frame edge is not a handle', await p.evaluate(e => S.history.length === e.h && JSON.stringify(SEL.geo.box) === e.box && !('oy' in SEL.geo.box), edge));
  ok('the cursor over the frame edge is not a resize', await p.evaluate(() => document.querySelector('#selCv').style.cursor !== 'ew-resize'));
  await p.evaluate(() => Transport.seek(S.vStart)); await p.waitForTimeout(500);
  // zoom and pan in the selector
  await p.click('#szIn'); await p.waitForTimeout(500);
  let z = await p.evaluate(() => [SZS.z, SZ.z, document.querySelector('#szFit').disabled]);
  ok('Zoom works in the selector and leaves the preview alone', z[0] > 1 && z[1] === 1 && z[2] === false, JSON.stringify(z));
  const c = await p.evaluate(() => { const r = document.querySelector('#selCv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  if (process.env.SHOTS) await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/zoomed.png' });
  await p.mouse.move(c[0], c[1]); await p.mouse.wheel(-60, -20); await p.waitForTimeout(100);          // a drag marks now, so a zoomed page pans by scrolling
  ok('scrolling pans the selector', await p.evaluate(() => SZS.x > 30 && SZS.y > 5), JSON.stringify(await p.evaluate(() => [SZS.x, SZS.y])));
  await p.mouse.move(c[0], c[1]); await p.keyboard.down('Space'); await p.mouse.down(); await p.mouse.move(c[0] + 40, c[1] + 10, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Space'); await p.waitForTimeout(100);
  const sp = await p.evaluate(() => [SZS.x, SZS.y, SEL.mark.space, Transport.playing === true]);
  ok('Space-drag pans the selector, marks nothing, and does not play', sp[0] > 60 && !sp[2] && !sp[3] && await p.evaluate(() => SYS.byPage.get(0).systems.length) === 3, JSON.stringify(sp));
  ok('a pan does not move the playhead', await p.evaluate(() => sysPage(SEL.key) === 0 && sysNo(SEL.key) === 0));
  await p.click('#szFit'); await p.waitForTimeout(500);
  ok('Fit puts the selector back', await p.evaluate(() => SZS.z === 1 && SZS.x === 0));
  // narrow: stacked
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
  if (process.env.SHOTS) await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/phone.png' });
  g = await geo();
  ok('a narrow window stacks the halves, selector above', near(g.sel[0], g.wrap[0] - 2) && near(g.sel[1], (g.wrap[1] - 2) / 2) && g.selY < 3 && g.st[1] >= g.div[1] + g.div[3] - 1, JSON.stringify(g));
  ok('the divider turns and the glyphs rotate', g.div[3] === 7 && g.div[2] > 300 && await p.evaluate(() => getComputedStyle(document.querySelector('#sysPresets svg')).transform !== 'none'), JSON.stringify(g.div));
  ok('nothing is cut off at phone width', await p.evaluate(() => { const w = document.querySelector('#stageWrap').getBoundingClientRect(), bad = [...document.querySelectorAll('#stageStrip, .sys-nav, #stage')].filter(e => { const r = e.getBoundingClientRect(); return r.right > w.right + 1 || r.left < w.left - 1 || r.bottom > w.bottom + 1; }); return !bad.length && document.documentElement.scrollWidth <= innerWidth; }));
  await p.click('#spOnly'); await p.waitForTimeout(800);
  ok('Preview only fills the phone stage', await p.evaluate(() => document.querySelector('#sysSel').hidden && document.querySelector('#stage').offsetHeight > 300));
  await pick('pageLayout', 'single'); await p.waitForTimeout(600);
  ok('leaving System takes the split away', await p.evaluate(() => document.querySelector('#sysSel').hidden && document.querySelector('#sysPresets').hidden && document.querySelector('#stageWrap').style.paddingTop === ''));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
