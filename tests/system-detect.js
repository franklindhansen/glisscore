// Systems: finding each system on a page, at 1,600 dots wide, with the work done off the page's own thread. Checks a piano-trio page (three systems of two staves joined by bar lines),
// a text page and a blank page (none), a tilted page (leveled for the measuring only), a staff that lost a line, a short last system with specks of dust, and a dense page of solo staves;
// then the run itself: the named page first, pages kept, only the unfinished ones on a second run, and Stop ending the worker at once.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/system-detect.js
const { chromium } = require('playwright-core');
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const PW = 595, PH = 842;
// a page of staves; each system is { y (top line, from the top of the page), staves: [offsets from y], d, x0, x1, join }
function drawPage(doc, font, spec) {
  const page = doc.addPage([PW, PH]), a = (spec.tilt || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const T = (x, y) => { const X = x - PW / 2, Y = (PH - y) - PH / 2; return { x: PW / 2 + X * c - Y * s, y: PH / 2 + X * s + Y * c }; };
  const line = (x0, y0, x1, y1, t) => page.drawLine({ start: T(x0, y0), end: T(x1, y1), thickness: t, color: rgb(0, 0, 0) });
  (spec.texts || []).forEach(([txt, x, y, sz]) => { const p = T(x, y); page.drawText(txt, { x: p.x, y: p.y, size: sz, font }); });
  (spec.systems || []).forEach(sy => {
    sy.staves.forEach((off, si) => {
      for (let k = 0; k < 5; k++) { if (sy.skip && sy.skip[0] === si && sy.skip[1] === k) continue; line(sy.x0, sy.y + off + k * sy.d, sy.x1, sy.y + off + k * sy.d, spec.lw || 0.7); }
    });
    const top = sy.y + sy.staves[0], bot = sy.y + sy.staves[sy.staves.length - 1] + 4 * sy.d;
    [sy.x0, (sy.x0 + sy.x1) / 2, sy.x1].forEach(x => { sy.staves.forEach(off => line(x, sy.y + off, x, sy.y + off + 4 * sy.d, 0.8)); if (sy.join !== false && x === sy.x0) line(x, top, x, bot, 0.9); });
    // a few notes, so the staves are not bare
    sy.staves.forEach(off => { for (let k = 0; k < 8; k++) { const p = T(sy.x0 + 20 + k * (sy.x1 - sy.x0 - 40) / 8, sy.y + off + (k % 5) * sy.d); page.drawEllipse({ x: p.x, y: p.y, xScale: sy.d * 0.6, yScale: sy.d * 0.45, color: rgb(0, 0, 0) }); } });
  });
  (spec.specks || []).forEach(([x, y]) => { const p = T(x, y); page.drawRectangle({ x: p.x, y: p.y, width: 1.2, height: 1.2, color: rgb(0, 0, 0) }); });
}
const trio = (extra = {}) => ({ texts: [['Piano Trio', 220, 60, 28]], systems: [0, 1, 2].map(k => ({ y: 130 + k * 230, staves: [0, 62], d: 7, x0: 50, x1: 545 })), ...extra });
(async () => {
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
  drawPage(doc, font, trio());                                                                          // 0: three systems, each of two staves
  drawPage(doc, font, { texts: [['Notes on the performance', 60, 100, 18], ['Take the first movement at a steady pace.', 60, 140, 12], ['Repeat as marked.', 60, 160, 12]] });          // 1: text only
  doc.addPage([PW, PH]);                                                                                // 2: blank
  drawPage(doc, font, trio({ tilt: 1.2 }));                                                             // 3: tilted
  drawPage(doc, font, trio({ systems: trio().systems.map((s, k) => k === 0 ? { ...s, skip: [0, 2] } : s) }));          // 4: the first staff lost its middle line
  drawPage(doc, font, { systems: [0, 1, 2].map(k => ({ y: 110 + k * 250, staves: [0, 62], d: 7, x0: 50, x1: k === 2 ? 300 : 545 })), specks: [[12, 30], [20, 400], [570, 120], [580, 600], [300, 300], [300, 560], [30, 780], [560, 800]] });          // 5: short last system and dust
  drawPage(doc, font, { systems: [0, 1, 2, 3, 4, 5, 6, 7].map(k => ({ y: 60 + k * 95, staves: [0], d: 5, x0: 50, x1: 545, join: false })) });          // 6: eight solo staves, small
  drawPage(doc, font, trio({ tilt: -4.5 }));                                                            // 7: tilted well past the usual
  drawPage(doc, font, trio({ lw: 0.3 }));                                                               // 8: very thin staff lines
  const bytes = Buffer.from(await doc.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'staves.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(() => S.pdf && S.pdf.keep.length === 9, null, { timeout: 60000 }); await p.waitForTimeout(800);
  const find = i => p.evaluate(async i => { const t = performance.now(), r = await sysDetectPage(i); return { r, ms: performance.now() - t }; }, i);
  const near = (a, b, e) => Math.abs(a - b) <= e;
  const fr = (y0, y1) => [y0 / PH, y1 / PH];

  // the trio page
  const t = await find(0), S0 = t.r.systems;
  ok('the trio page gives three systems', S0.length === 3 && t.r.staves === 6, JSON.stringify(t.r.staves) + ' staves, ' + S0.length + ' systems');
  const want = k => fr(130 + k * 230, 130 + k * 230 + 62 + 28);
  ok('each system holds both of its staves', S0.length === 3 && S0.every((s, k) => s.top <= want(k)[0] + 0.001 && s.bottom >= want(k)[1] - 0.001), JSON.stringify(S0.map(s => [s.top.toFixed(3), s.bottom.toFixed(3)])));
  ok('systems do not overlap and stay near their staves', S0.every((s, k) => (!k || S0[k - 1].bottom <= s.top + 0.0005) && s.top >= want(k)[0] - 0.09 && s.bottom <= want(k)[1] + 0.09));
  ok('the title above the first system is left out', S0[0] && S0[0].top > 78 / PH, S0[0] && S0[0].top.toFixed(3));
  ok('the left and right ink edges match the music', S0.every(s => near(s.left, 50 / PW, 0.012) && near(s.right, 545 / PW, 0.012)), JSON.stringify(S0.map(s => [s.left.toFixed(3), s.right.toFixed(3)])));
  ok('a page takes under 4s', t.ms < 4000, Math.round(t.ms) + 'ms');

  // no staves, no systems
  ok('a text page gives none', (await find(1)).r.systems.length === 0);
  ok('a blank page gives none', (await find(2)).r.systems.length === 0);

  // a tilt of 1.2 degrees
  const tl = (await find(3)).r;
  ok('a tilted page still gives its three systems, each holding its staves', tl.systems.length === 3 && tl.systems.every((s, k) => s.top <= want(k)[0] + 0.012 && s.bottom >= want(k)[1] - 0.012), JSON.stringify(tl.systems.map(s => [s.top.toFixed(3), s.bottom.toFixed(3)])));
  ok('the tilt is reported and the page is not changed', near(Math.abs(tl.tilt), 1.2, 0.4) && await p.evaluate(() => S.pdf.gen === SYS.gen), 'tilt ' + tl.tilt);
  const big = (await find(7)).r;
  ok('a page tilted 4.5 degrees still gives its three systems', big.systems.length === 3 && near(Math.abs(big.tilt), 4.5, 0.5), big.systems.length + ' systems, tilt ' + big.tilt);
  const thin = (await find(8)).r;
  ok('very thin staff lines are still found', thin.systems.length === 3 && thin.staves === 6, thin.systems.length + ' systems, ' + thin.staves + ' staves');
  // a rough scan, made directly: salt-and-pepper noise, pieces missing from the staff lines, and a 2.5 degree tilt turned into the picture
  const rough = await p.evaluate(() => {
    const w = 1600, h = 2263, ink = new Uint8Array(w * h); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sys = [0, 1, 2].map(k => ({ y: 350 + k * 620 }));
    sys.forEach(s => { [0, 165].forEach(off => { for (let k = 0; k < 5; k++) { const y = s.y + off + k * 19; for (let x = 135; x < 1465; x++) { if (rnd() < 0.0035) x += 6 + (rnd() * 10 | 0); else ink[y * w + x] = 1; ink[(y + 1) * w + x] = rnd() < 0.8 ? 1 : 0; } } for (const x of [135, 800, 1465]) for (let y = s.y + off; y <= s.y + off + 76; y++) ink[y * w + x] = ink[y * w + x + 1] = 1; }); for (let y = s.y; y <= s.y + 165 + 76; y++) ink[y * w + 135] = ink[y * w + 136] = 1; });
    for (let i = 0; i < w * h; i++) if (rnd() < 0.006) ink[i] = 1;
    const a = 2.5 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x]) { const X = x - w / 2, Y = y - h / 2, nx = Math.round(X * c - Y * s + w / 2), ny = Math.round(X * s + Y * c + h / 2); if (nx >= 0 && nx < w && ny >= 0 && ny < h) out[ny * w + nx] = 1; }
    const t = peTilt({ w, h, ink: out, n: out.reduce((q, v) => q + v, 0) });
    const r = sysDetectCore(out, w, h, t.deg, [60, 100, w - 60, h - 100]); return { r, deg: t.deg };
  });
  ok('a rough scan (noise, broken lines, 2.5 degrees) gives its three systems', rough.r.systems.length === 3 && rough.r.staves === 6, JSON.stringify({ n: rough.r.systems.length, st: rough.r.staves, deg: rough.deg }));
  ok('its edges are still true to the music', rough.r.systems.length === 3 && rough.r.systems.every(s => near(s.left, 135 / 1600, 0.03) && near(s.right, 1465 / 1600, 0.03)), JSON.stringify(rough.r.systems.map(s => [s.left.toFixed(3), s.right.toFixed(3)])));
  // one lost line
  const dr = (await find(4)).r;
  ok('a staff with one line lost is still a staff', dr.systems.length === 3 && dr.staves === 6, dr.systems.length + ' systems, ' + dr.staves + ' staves');
  // the short last system, with dust
  const sh = (await find(5)).r.systems;
  ok('dust in the margins and between systems makes no extra system', sh.length === 3, String(sh.length));
  ok('dust does not move the left and right edges', sh.length === 3 && sh.every(s => near(s.left, 50 / PW, 0.012)) && near(sh[0].right, 545 / PW, 0.012) && near(sh[1].right, 545 / PW, 0.012), JSON.stringify(sh.map(s => [s.left.toFixed(3), s.right.toFixed(3)])));
  ok('the short last system ends where its music ends', sh.length === 3 && near(sh[2].right, 300 / PW, 0.015), JSON.stringify(sh));
  // eight small solo staves, not joined
  const so = (await find(6)).r.systems;
  ok('small solo staves are one system each', so.length === 8, String(so.length));
  ok('no overlap between neighbors', so.every((s, k) => !k || so[k - 1].bottom <= s.top + 0.0005));

  // the run: the named page first, kept results, a second run with nothing to do
  const run1 = await p.evaluate(async () => {
    SYS.byPage.clear(); const seen = [], scans = []; const orig = window.peScan; window.peScan = function (i, ...r) { scans.push(i); return orig.call(this, i, ...r); };
    const res = await sysDetectAll({ first: 4, onProgress: (d, n, i) => seen.push([d, n, i]) });
    const again = scans.length; const res2 = await sysDetectAll({ onProgress: () => {} });
    window.peScan = orig; return { res, seen, scans, again, res2, after: scans.length, size: SYS.byPage.size };
  });
  ok('every page is found, and the named page goes first', run1.res === true && run1.size === 9 && run1.scans[0] === 4 && run1.seen[1][2] === 4, JSON.stringify(run1.seen));
  ok('progress counts up to the page total', run1.seen[run1.seen.length - 1][0] === 9 && run1.seen[run1.seen.length - 1][1] === 9);
  ok('a second run finds the work done and draws nothing', run1.res2 === true && run1.after === run1.again);
  // Stop: the worker ends at once, the pages found stay, and only the rest is done on the next run
  const st = await p.evaluate(async () => {
    SYS.byPage.clear(); let stopped = false; const scans = []; const orig = window.peScan; window.peScan = function (i, ...r) { scans.push(i); return orig.call(this, i, ...r); };
    const job = sysDetectAll({ first: 0, onProgress: (d) => { if (d === 2 && !stopped) { stopped = true; SYS.stop(); } } });
    const res = await job; const kept = SYS.byPage.size, worker = SYS.w; const n1 = scans.length;
    const res2 = await sysDetectAll({}); window.peScan = orig; return { res, kept, worker: !!worker, res2, rest: scans.length - n1, size: SYS.byPage.size };
  });
  ok('Stop ends the run, and the worker with it', st.res === false && st.worker === false, JSON.stringify(st));
  ok('the pages found before Stop are kept', st.kept >= 1 && st.kept < 9, String(st.kept));
  ok('the next run does only the pages left', st.res2 === true && st.size === 9 && st.rest <= 9 - st.kept + 1, JSON.stringify(st));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
