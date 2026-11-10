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
  ok('System splits the stage half and half (selector 0.5)', !g.hidden && near(g.sel[0], 0.5 * (g.wrap[0] - 2), 4) && near(g.sel[1], g.wrap[1] - 2), JSON.stringify(g));
  ok('the preview sits right of the divider and inside the stage', g.st[0] >= g.div[0] + g.div[2] - 1 && g.st[0] + g.st[2] <= g.wrap[0] && g.pressed[1] === 'true', JSON.stringify(g));
  ok('there is no Edit systems button', await p.evaluate(() => !document.querySelector('#spMark')));
  const undoBefore = await hist();
  const preset = async id => { await p.hover('#spCur'); await p.waitForTimeout(260); await p.click('#' + id); await p.waitForTimeout(100); };
  const dv = await p.evaluate(() => { const r = document.querySelector('#sysDiv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(dv[0], dv[1]); await p.mouse.down(); await p.mouse.move(dv[0] + 150, dv[1], { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(400);
  const g2 = await geo();
  ok('the divider drags', g2.sel[0] > g.sel[0] + 120, JSON.stringify([g.sel[0], g2.sel[0]]));
  await p.mouse.dblclick(...(await p.evaluate(() => { const r = document.querySelector('#sysDiv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }))); await p.waitForTimeout(900);
  const g3 = await geo();
  ok('a double-click glides it back to half and half', near(g3.sel[0], (g3.wrap[0] - 2) / 2, 3), JSON.stringify([g.sel[0], g3.sel[0]]));
  ok('the split is not a History step', (await hist()) === undoBefore);
  for (const [id, f] of [['spSel', 0.7], ['spPrev', 0.3]]) { await preset(id); await p.waitForTimeout(800); g = await geo(); ok('preset ' + id + ' gives the selector ' + f + ' (never narrower than its two strips)', near(g.sel[0], Math.max(f * (g.wrap[0] - 2), id === 'spPrev' ? await p.evaluate(() => SPLIT.navW + 20) : 0), 4) && g.pressed[['spSel', 'spEq', 'spPrev', 'spOnly'].indexOf(id)] === 'true', JSON.stringify(g)); }
  await preset('spOnly'); await p.waitForTimeout(800); g = await geo();
  ok('Preview only hides the selector and gives the preview the stage', g.hidden && g.dh && g.st[2] > 700, JSON.stringify(g));
  await preset('spEq'); await p.waitForTimeout(800);
  const spGeo = () => p.evaluate(() => { const r = e => document.querySelector(e).getBoundingClientRect(), st = r('#sysPresets'), z = r('#stageStrip'), w = r('#stageWrap'), fly = getComputedStyle(document.querySelector('#spFly')), cur = document.querySelector('#spCur'); return { top: st.top - w.top, right: w.right - st.right, bottom: z.bottom, stBottom: st.bottom, zTop: z.top, vis: fly.visibility, op: +fly.opacity, exp: cur.getAttribute('aria-expanded'), open: document.querySelector('#sysPresets').classList.contains('open'), label: cur.getAttribute('aria-label') }; });
  await p.mouse.move(5, 5); await p.waitForTimeout(400);
  let s0 = await spGeo();
  ok('the preset strip sits at the top right, above the zoom strip', s0.top < 20 && s0.right < 20 && s0.stBottom < s0.zTop, JSON.stringify(s0));
  ok('the four presets are folded into one icon until hovered', s0.vis === 'hidden' && !s0.open && s0.exp === 'false', JSON.stringify(s0));
  await p.hover('#spCur'); await p.waitForTimeout(400); s0 = await spGeo();
  ok('hovering the icon unfolds the presets', s0.vis === 'visible' && s0.op === 1 && s0.exp === 'true', JSON.stringify(s0));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); s0 = await spGeo();
  ok('Escape folds them', !s0.open && s0.vis === 'hidden', JSON.stringify(s0));
  await p.mouse.move(5, 5); await p.waitForTimeout(300);
  await p.focus('#spCur'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  ok('the icon opens from the keyboard', (await spGeo()).open);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('Enter'); await p.waitForTimeout(900); s0 = await spGeo();
  ok('choosing a preset folds the strip and the icon names it', !s0.open && /^View: Selector focus$/.test(s0.label), JSON.stringify(s0));
  await preset('spEq'); await p.waitForTimeout(800);
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
  // the page is plain: no Preview frame, no glass, no dimming
  await p.evaluate(() => { Transport.seek(S.vStart); }); await p.waitForTimeout(700);
  const pl = await p.evaluate(() => {
    const cv = document.querySelector('#selCv'), geo = SEL.geo, pa = geo.pa, ctx = cv.getContext('2d'), px = (x, y) => Array.from(ctx.getImageData(Math.round(geo.ox + x * geo.u), Math.round(geo.oy + y * geo.u), 1, 1).data), r = SYS.byPage.get(geo.idx).systems, nb = r[1];
    const rowSpread = (y0, y1) => { const v = []; for (let y = y0; y < y1; y += 0.004) for (let x = nb.left * pa + 0.02; x < nb.right * pa - 0.02; x += 0.01) v.push(px(x, y)[0]); return Math.max(...v) - Math.min(...v); };
    const corner = px(0.02 * pa, 0.01), inner = px(pa - 0.02 * pa, 0.99);
    return { corner, inner, ink: rowSpread(nb.top, nb.bottom), fits: geo.ox >= 0 && geo.oy >= 0 && geo.ox + pa * geo.u <= geo.w + 1 && geo.oy + geo.u <= geo.h + 1, margin: Math.min(geo.ox, geo.oy) > 6 };
  });
  if (process.env.SHOTS) { await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/stage.png' }); }
  ok('the page is plain: white paper, a neighbor system as sharp as the current one, nothing dimmed', pl.corner[0] > 240 && pl.inner[0] > 240 && pl.ink > 150, JSON.stringify(pl));
  ok('the page fits its pane with a small margin', pl.fits && pl.margin, JSON.stringify(pl));
  const sizes = [];
  for (const [pg, no] of [[0, 0], [0, 2], [1, 0], [3, 0]]) {
    await p.evaluate(([pg, no]) => { const r = SYS.byPage.get(pg); Transport.seek(selTimeOf(sysKey(pg, Math.min(no, r.systems.length - 1)))); }, [pg, no]); await p.waitForTimeout(500);
    sizes.push(await p.evaluate(() => { const g = SEL.geo; return { u: g.u, ox: g.ox, oy: g.oy }; }));
  }
  ok('the page keeps one size and place from system to system', sizes.every(q => Math.abs(q.u - sizes[0].u) < 1e-6 && Math.abs(q.ox - sizes[0].ox) < 1e-6), JSON.stringify(sizes));
  // Systems | Full page
  await p.evaluate(() => Transport.seek(S.vStart)); await p.waitForTimeout(500);
  const strip = await p.evaluate(() => ({ seg: [...document.querySelectorAll('#selMode label')].map(l => l.title), checked: document.querySelector('input[name=selMode]:checked').value, again: document.querySelector('#spAgain').getAttribute('aria-label'), inStrip: !!document.querySelector('.sys-nav #selMode') && !!document.querySelector('.sys-nav #spAgain') && !document.querySelector('.sys-tools #spAgain') }));
  ok('the selector strip holds Systems | Full page and Detect again', strip.seg.join() === 'Systems,Full page' && strip.checked === 'systems' && strip.again === 'Detect again' && strip.inStrip, JSON.stringify(strip));
  const h0 = await p.evaluate(() => ({ h: S.history.length, n: S.spreads.length }));
  await p.click('#selMode label:has(input[value=full])'); await p.waitForTimeout(500);
  const f1 = await p.evaluate(() => ({ h: S.history.length, n: S.spreads.length, full: SYS.byPage.get(0).full, label: document.querySelector('#spreadNow').textContent, list: SEL.geo.box && SYS.byPage.get(0).systems.length }));
  ok('Full page makes the page one stop and one History step', f1.n === h0.n - 2 && f1.h === h0.h + 1 && f1.full && /^Page 1 \/ 4$/.test(f1.label) && f1.list === 0, JSON.stringify([h0, f1]));
  await p.click('#selMode label:has(input[value=systems])'); await p.waitForTimeout(500);
  const f2 = await p.evaluate(() => ({ n: S.spreads.length, full: SYS.byPage.get(0).full, sys: SYS.byPage.get(0).systems.length }));
  ok('Systems brings back what was found', f2.n === h0.n && !f2.full && f2.sys === 3, JSON.stringify(f2));
  await p.click('#selMode label:has(input[value=full])'); await p.waitForTimeout(300); await p.click('#bUndo'); await p.waitForTimeout(500);
  ok('Undo goes back to Systems', await p.evaluate(() => !SYS.byPage.get(0).full && SYS.byPage.get(0).systems.length === 3 && S.spreads.length === 9));
  ok('the split is saved with the settings', await p.evaluate(() => typeof S.set.sysSplit === 'number' && JSON.parse(localStorage.getItem('glisscore.settings')).sysSplit === S.set.sysSplit));
  const nf = await p.evaluate(async () => {                       // a page where nothing is found starts on Full page; Systems lets the user mark by hand; leaving it with none returns to Full page
    const o = SYS.run; SYS.run = async () => ({ systems: [], staves: 0, d: 0 }); await sysRedetect(1); SYS.run = o;
    const out = { start: !!SYS.byPage.get(1).full };
    sysSetFull(1, false); out.sys = !SYS.byPage.get(1).full && SYS.byPage.get(1).systems.length === 0;
    await sysMark(1, 0.2, 0.4); out.marked = !SYS.byPage.get(1).full && SYS.byPage.get(1).systems.length === 1;
    sysRemove(1, SYS.byPage.get(1).systems[0]); out.back = !!SYS.byPage.get(1).full && SYS.byPage.get(1).systems.length === 0;
    return out;
  });
  ok('a page with nothing found starts on Full page, can be marked by hand, and returns to Full page when left with none', nf.start && nf.sys && nf.marked && nf.back, JSON.stringify(nf));
  { const gd = await p.evaluate(() => (window.uiGuard && uiGuard.report ? uiGuard.report() : [])); ok('uiGuard reports nothing', !gd.length, JSON.stringify(gd)); }
  ok('the system-less wording is gone', await p.evaluate(() => !MSG.text['sys.pageNone'] && !MSG.text['sys.pageFinding']));
  await p.evaluate(() => Transport.seek(S.vStart)); await p.waitForTimeout(500);
  // zoom and pan in the selector
  await p.click('#selZIn'); await p.waitForTimeout(500);
  let z = await p.evaluate(() => [SZS.z, SZ.z, document.querySelector('#selZFit').disabled]);
  ok('The selector\'s own zoom strip zooms the selector and leaves the preview alone', z[0] > 1 && z[1] === 1 && z[2] === false, JSON.stringify(z));
  const c = await p.evaluate(() => { const r = document.querySelector('#selCv').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  if (process.env.SHOTS) await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/zoomed.png' });
  await p.mouse.move(c[0], c[1]); await p.mouse.wheel(-60, -20); await p.waitForTimeout(100);          // a drag marks now, so a zoomed page pans by scrolling
  ok('scrolling pans the selector', await p.evaluate(() => SZS.x > 30 && SZS.y > 5), JSON.stringify(await p.evaluate(() => [SZS.x, SZS.y])));
  await p.mouse.move(c[0], c[1]); await p.keyboard.down('Space'); await p.mouse.down(); await p.mouse.move(c[0] + 40, c[1] + 10, { steps: 5 }); await p.mouse.up(); await p.keyboard.up('Space'); await p.waitForTimeout(100);
  const sp = await p.evaluate(() => [SZS.x, SZS.y, SEL.mark.space, Transport.playing === true]);
  ok('Space-drag pans the selector, marks nothing, and does not play', sp[0] > 60 && !sp[2] && !sp[3] && await p.evaluate(() => SYS.byPage.get(0).systems.length) === 3, JSON.stringify(sp));
  ok('a pan does not move the playhead', await p.evaluate(() => sysPage(SEL.key) === 0 && sysNo(SEL.key) === 0));
  await p.click('#selZFit'); await p.waitForTimeout(500);
  ok('Fit puts the selector back', await p.evaluate(() => SZS.z === 1 && SZS.x === 0));
  await p.click('#szIn'); await p.waitForTimeout(500);
  const zz = await p.evaluate(() => { const r = q => document.querySelector(q).getBoundingClientRect(), n = r('.sys-nav'), s = r('#selZoom'), pane = r('#sysSel'), pv = r('#stageStrip'); return { prev: SZ.z, sel: SZS.z, selDis: document.querySelector('#selZOut').disabled, gap: s.left - n.right, same: Math.abs(n.bottom - s.bottom) < 1 && n.right <= s.left, right: Math.round(pane.right - s.right), bottom: Math.round(pane.bottom - s.bottom), inPane: s.left >= pane.left && s.right <= pane.right, prevInPreview: pv.left >= pane.right }; });
  ok('the preview\'s strip zooms the preview only, and the selector has its own strip at its bottom right beside the page strip', zz.prev > 1 && zz.sel === 1 && zz.selDis && (zz.gap >= 0 && zz.same) && zz.right <= 12 && zz.bottom <= 12 && zz.inPane && zz.prevInPreview, JSON.stringify(zz));
  await p.click('#szFit'); await p.waitForTimeout(400);
  await p.mouse.move(c[0], c[1]); await p.keyboard.press('='); await p.waitForTimeout(400);
  ok('the + key zooms the picture the pointer is over', await p.evaluate(() => SZS.z > 1 && SZ.z === 1));
  await p.keyboard.press('0'); await p.waitForTimeout(400);
  ok('both pictures are back at Fit', await p.evaluate(() => SZS.z === 1 && SZ.z === 1), JSON.stringify(await p.evaluate(() => [SZS.z, SZ.z, szOverPrev])));
  // Hide and back glide: the picture and the selector change a little each frame, never a jump when the selector goes or comes
  await p.evaluate(() => { window.__w = []; const f = () => { window.__w.push([document.querySelector('#stage').offsetWidth, document.querySelector('#sysSel').hidden ? 0 : document.querySelector('#sysSel').offsetWidth]); window.__raf = requestAnimationFrame(f); }; f(); });
  await preset('spOnly'); await p.waitForTimeout(900); await preset('spEq'); await p.waitForTimeout(900);
  const gl = await p.evaluate(() => { cancelAnimationFrame(window.__raf); const w = window.__w.map(q => q[1]); let last = 0, first = 0, seenZero = false; for (const v of w) { if (v === 0) seenZero = true; else if (!seenZero) last = v; else if (!first) first = v; } const l = w.filter(v => v > 0 && !seenZero); return { last: Math.min(...w.slice(0, w.indexOf(0)).filter(v => v > 0)), first, zero: w.indexOf(0) >= 0 }; });
  ok('hiding the selector narrows it all the way before it goes, and showing it widens from nothing', gl.zero && gl.last < 60 && gl.first < 60, JSON.stringify(gl));
  // narrow: stacked
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
  if (process.env.SHOTS) await p.locator('#stageWrap').screenshot({ path: process.env.SHOTS + '/phone.png' });
  g = await geo();
  ok('a narrow window stacks the halves, selector above', near(g.sel[0], g.wrap[0] - 2) && near(g.sel[1], (g.wrap[1] - 2) / 2) && g.selY < 3 && g.st[1] >= g.div[1] + g.div[3] - 1, JSON.stringify(g));
  ok('the divider turns and the glyphs rotate', g.div[3] === 7 && g.div[2] > 300 && await p.evaluate(() => getComputedStyle(document.querySelector('#sysPresets svg')).transform !== 'none'), JSON.stringify(g.div));
  ok('nothing is cut off at phone width', await p.evaluate(() => { const w = document.querySelector('#stageWrap').getBoundingClientRect(), bad = [...document.querySelectorAll('#stageStrip, .sys-nav, #stage')].filter(e => { const r = e.getBoundingClientRect(); return r.right > w.right + 1 || r.left < w.left - 1 || r.bottom > w.bottom + 1; }); return !bad.length && document.documentElement.scrollWidth <= innerWidth; }));
  await preset('spOnly'); await p.waitForTimeout(800);
  ok('Preview only fills the phone stage', await p.evaluate(() => document.querySelector('#sysSel').hidden && document.querySelector('#stage').offsetWidth > 350));
  await pick('pageLayout', 'single'); await p.waitForTimeout(600);
  ok('leaving System takes the split away', await p.evaluate(() => document.querySelector('#sysSel').hidden && document.querySelector('#sysPresets').hidden && document.querySelector('#stageWrap').style.paddingTop === ''));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
