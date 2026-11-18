// PDF Editor: the number circle under each page, and the tag beside it ("2" for a page from another place, the copy glyph and "1" for a repeat, with no brackets): the tag's digit is on the circle's center line, and it fits on the smallest card. Its digits sit on the circle's center line (equal room above and below, measured on the drawn pixels at 8x),
// every number of the same length is the same width (tabular figures), and the digits sit within half a pixel of the middle sideways (a tabular 1 has more room on its left, so a number with a 1 may be up to a pixel off).
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-number-chip.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 8 }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.waitForTimeout(800);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200);
  const rows = await p.evaluate(async () => {
    const host = document.querySelector('#peWin'), box = document.createElement('div'); box.style.cssText = 'position:fixed;left:20px;top:20px;z-index:9999;background:#fff;padding:10px;display:flex;flex-wrap:wrap;gap:10px;width:700px'; host.appendChild(box);
    const chips = []; for (let n = 1; n <= 99; n++) { const w = document.createElement('div'); w.className = 'pe-foot'; w.style.cssText = 'width:auto;flex:none'; const s = document.createElement('span'); s.className = 'pe-pos'; s.textContent = n; w.appendChild(s); box.appendChild(w); chips.push(s); }
    await document.fonts.ready; await new Promise(r => setTimeout(r, 300)); return chips.map(c => { const r = c.getBoundingClientRect(); return [c.textContent, r.left, r.top, r.width, r.height]; }); });
  const bb = await p.evaluate(() => { const r = document.querySelector('#peWin > div:last-child').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const shot = await p.screenshot({ clip: { x: 20, y: 20, width: 720, height: bb[3] + 20 } });
  const out = await p.evaluate(async ([b64, rows]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const k = img.width / 720, c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const res = [];
    for (const [n, l, t, w, h] of rows) { const X0 = Math.round((l - 20) * k), Y0 = Math.round((t - 20) * k), W = Math.round(w * k), H = Math.round(h * k), d = x.getImageData(X0, Y0, W, H).data; let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const i = (yy * W + xx) * 4; if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90) { minx = Math.min(minx, xx); maxx = Math.max(maxx, xx); miny = Math.min(miny, yy); maxy = Math.max(maxy, yy); } }
      res.push({ n, w: +w.toFixed(1), h: +h.toFixed(1), dx: ((minx + maxx) / 2 - W / 2) / k, dy: ((miny + maxy) / 2 - H / 2) / k }); }
    return res; }, [shot.toString('base64'), rows]);
  ok('every number sits on the circle\'s center line (within 0.5px)', out.length === 99 && out.every(o => Math.abs(o.dy) <= 0.5), 'worst ' + Math.max(...out.map(o => Math.abs(o.dy))).toFixed(2) + 'px');
  ok('every circle is 20px tall, and all numbers of one length are one width', new Set(out.map(o => o.h)).size === 1 && out[0].h === 20 && new Set(out.filter(o => o.n.length === 1).map(o => o.w)).size === 1 && new Set(out.filter(o => o.n.length === 2).map(o => o.w)).size === 1, JSON.stringify([...new Set(out.map(o => o.w))]));
  ok('numbers without a 1 sit within 0.5px of the middle sideways', out.filter(o => !o.n.includes('1')).every(o => Math.abs(o.dx) <= 0.5), 'worst ' + Math.max(...out.filter(o => !o.n.includes('1')).map(o => Math.abs(o.dx))).toFixed(2) + 'px');
  ok('numbers with a 1 sit within a pixel of the middle (the tabular 1)', out.filter(o => o.n.includes('1')).every(o => Math.abs(o.dx) <= 1), 'worst ' + Math.max(...out.filter(o => o.n.includes('1')).map(o => Math.abs(o.dx))).toFixed(2) + 'px');
  // the tag beside the bubble: its digit and the bubble's digit share one center line, at the smallest size too
  await p.evaluate(() => { const d = PE.d; [0, 1, 2].forEach(i => d.slots.push({ src: i, rot: 0, x: false, c: true, crop: null, dim: null, skew: 0, vskew: 0, warp: 0, bg: 0, sp: 0, half: '' })); d.order = [1, 0, 2, 3, 4, 5]; document.querySelector('#peWin > div:last-child').remove(); peRender(false); });
  await p.waitForTimeout(1200);
  for (const v of [-50, 0]) {
    await p.evaluate(v => { const z = document.querySelector('#pdfDlg .pe-zoom-in'); z.value = v; z.dispatchEvent(new Event('input', { bubbles: true })); }, v); await p.waitForTimeout(1000);
    const feet = await p.evaluate(() => Array.from(document.querySelectorAll('#peGrid .page-card')).slice(0, 5).filter(c => !c.querySelector('.num').classList.contains('same')).map(c => { const f = c.querySelector('.pe-foot').getBoundingClientRect(), pos = c.querySelector('.pe-pos').getBoundingClientRect(), nm = c.querySelector('.num'), n = nm.getBoundingClientRect(); return { t: nm.textContent.trim(), clipped: nm.scrollWidth > nm.clientWidth + 0.5 || n.right > c.getBoundingClientRect().right, f: [f.left, f.top, f.width, f.height], pos: [pos.left, pos.top, pos.width, pos.height], n: [n.left, n.top, n.width, n.height] }; }));
    const shots = []; for (const f of feet) shots.push((await p.screenshot({ clip: { x: f.f[0] - 2, y: f.f[1] - 2, width: f.f[2] + 4, height: f.f[3] + 4 } })).toString('base64'));
    const res = await p.evaluate(async ([feet, shots]) => { const o = []; for (let i = 0; i < feet.length; i++) { const f = feet[i], img = new Image(); img.src = 'data:image/png;base64,' + shots[i]; await img.decode(); const k = img.width / (f.f[2] + 4), c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const mid = (l, t, w, h, thr) => { const X0 = Math.max(0, Math.round((l - f.f[0] + 2) * k)), Y0 = Math.max(0, Math.round((t - f.f[1] + 2) * k)), W = Math.round(w * k), H = Math.round(h * k), d = x.getImageData(X0, Y0, Math.min(W, img.width - X0), Math.min(H, img.height - Y0)).data; let a = 1e9, b = -1; for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const j = (yy * W + xx) * 4; if (d[j] < thr && d[j + 1] < thr && d[j + 2] < thr) { a = Math.min(a, yy); b = Math.max(b, yy); } } return (a + b) / 2 / k; };
      o.push({ t: f.t, clipped: f.clipped, diff: mid(f.n[0] + f.n[2] * 0.3, f.f[1], f.n[2] * 0.4, f.f[3], 160) - mid(f.pos[0], f.pos[1], f.pos[2], f.pos[3], 90) }); } return o; }, [feet, shots]);
    ok('size ' + v + ': the tag\'s digit sits on the bubble\'s center line (within 0.5px)', res.length >= 3 && res.every(r => Math.abs(r.diff) <= 0.5), JSON.stringify(res.map(r => [r.t, +r.diff.toFixed(2)])));
    ok('size ' + v + ': the tag is the bare number, with no brackets', res.length >= 3 && res.every(r => /^\d+$/.test(r.t)), JSON.stringify(res.map(r => r.t)));
    ok('size ' + v + ': the tag fits inside its card', res.every(r => !r.clipped), JSON.stringify(res.map(r => r.clipped)));
  }
  // a book of 100 or more pages: a three-digit position and a three-digit page tag on a repeat must fit the smallest card whole (the footer is filled with those digits, as a real 150-page file would)
  await p.evaluate(() => { const z = document.querySelector('#pdfDlg .pe-zoom-in'); z.value = z.min; z.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(1000);
  const big = await p.evaluate(() => { const c = document.querySelector('#peGrid .page-card'), f = c.querySelector('.pe-foot'), pos = c.querySelector('.pe-pos'), nm = c.querySelector('.num'), out = [];
    for (const [pn, sn, cp] of [['150', '158', true], ['999', '999', true], ['150', '158', false]]) { pos.textContent = pn; nm.innerHTML = (cp ? '<i class="pe-cp" aria-hidden="true">' + peSvg.dup + '</i>' : '') + sn; nm.classList.remove('same'); const fr = f.getBoundingClientRect(), nr = nm.getBoundingClientRect(); out.push({ pos: pn, tag: nm.textContent, clipped: nm.scrollWidth > nm.clientWidth + 0.5, inside: nr.right <= fr.right + 0.5 && nr.left >= fr.left - 0.5, card: Math.round(c.getBoundingClientRect().width) }); } return out; });
  ok('smallest card: a three-digit number and a three-digit page tag on a repeat fit whole', big.every(r => !r.clipped && r.inside), JSON.stringify(big));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
