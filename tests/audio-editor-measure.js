// The measuring helper (tests/lib/measure.js) checked against pixels: it renders plain text, text in a flex box, absolutely positioned text, and a button, takes a screenshot, finds the real ink edges by scanning the pixels,
// and fails when the helper's cap top, baseline, or border box differs from the scanned edge by more than 0.5px. Every layout check measures through this helper, so this is what its numbers are worth.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-measure.js
const { chromium } = require('playwright-core');
const { install } = require('./lib/measure.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const TOL = 0.5;          // painted edges snap to whole pixels, so a box laid out on a fraction of a pixel reads up to half a pixel from its drawn edge; the samples sit on fractions (0.3, 0.4, 0.6) but never on exactly half, where the snap itself is a coin toss
// the scan, run in a blank page: the screenshot's pixels in, each sample's ink edges out (a pixel's darkness is 1 minus its gray)
const scan = async ({ png, jobs }) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const dark = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return 1 - (d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114) / 255; };
  return jobs.map(j => {
    const x0 = Math.floor(j.x0), x1 = Math.ceil(j.x1), y0 = Math.floor(j.y0), y1 = Math.ceil(j.y1);
    let x = j.col;
    if (x == null) { let best = -1; for (let cx = x0; cx < x1; cx++) { let s = 0; for (let y = y0; y < y1; y++) s += dark(cx, y); if (s > best) { best = s; x = cx; } } }      // a glyph: the column with the most ink is a stem of the H
    const pc = []; for (let y = y0; y < y1; y++) pc.push(dark(x, y));
    const full = Math.max(...pc); if (full < 0.2) return { top: null, bottom: null };
    let a = pc.findIndex(v => v > 0.03 * full), z = pc.length - 1; while (z > 0 && pc[z] <= 0.03 * full) z--;
    return { top: y0 + a + (1 - Math.min(1, pc[a] / full)), bottom: y0 + z + Math.min(1, pc[z] / full) };
  });
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 640, height: 740 } });
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.evaluate(install);
  const samples = await p.evaluate(() => {
    const host = document.createElement('div'); host.id = 'mkHost'; host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:720px;background:#fff;color:#000;z-index:2147483000;overflow:hidden;font-family:' + getComputedStyle(document.body).fontFamily;
    const rows = [];
    // each sample: [name, size, offset, markup]; the caps are "H"s, so the cap top and the baseline are flat edges in the pixels
    const defs = [
      ['plain text', 13, 0, s => `<div id="${s}" style="position:absolute;left:20px;top:%Ypx;font-size:13px;line-height:20px">HHHH</div>`],
      ['plain text', 36, 0.4, s => `<div id="${s}" style="position:absolute;left:20px;top:%Ypx;font-size:36px;line-height:1.2">HHHH</div>`],
      ['text in a flex box', 13, 0, s => `<div style="position:absolute;left:20px;top:%Ypx;display:flex;align-items:center;height:35px;font-size:13px"><b id="${s}" style="font-weight:400">HHHH</b><i style="width:30px;height:30px"></i></div>`],
      ['text in a flex box', 36, 0.4, s => `<div style="position:absolute;left:20px;top:%Ypx;display:flex;align-items:center;height:60px;font-size:36px"><span id="${s}">HHHH</span><i style="width:10px;height:50px"></i></div>`],
      ['text with no element of its own in a flex box', 13, 0.3, s => `<div id="${s}" style="position:absolute;left:20px;top:%Ypx;display:flex;align-items:flex-end;height:40px;font-size:13px">HHHH</div>`],
      ['positioned text', 13, 0, s => `<div style="position:absolute;left:20px;top:%Ypx;width:200px;height:50px"><div id="${s}" style="position:absolute;right:30px;bottom:7px;font-size:13px">HHHH</div></div>`],
      ['positioned text', 36, 0.6, s => `<div style="position:absolute;left:20px;top:%Ypx;width:300px;height:60px"><div id="${s}" style="position:absolute;left:10px;bottom:5px;font-size:36px">HHHH</div></div>`],
      ['button', 13, 0, s => `<button id="${s}" type="button" style="all:unset;box-sizing:border-box;position:absolute;left:20px;top:%Ypx;height:30px;width:90px;border:2px solid #000;background:#fff;font:inherit;font-size:13px;text-align:center;line-height:26px">HHHH</button>`],
      ['button', 13, 0.3, s => `<button id="${s}" type="button" style="all:unset;box-sizing:border-box;position:absolute;left:20px;top:%Ypx;height:34px;width:90px;border:2px solid #000;background:#fff;font:inherit;font-size:13px;text-align:center;line-height:30px">HHHH</button>`],
    ];
    let i = 0;
    for (const [name, size, off, mk] of defs) { const id = 'mk' + i, top = 20 + i * 70 + off; i++; host.insertAdjacentHTML('beforeend', mk(id).replace('%Y', top)); rows.push({ name, size, id }); }
    document.body.appendChild(host);
    return rows.map(r => ({ ...r, y: (e => [e.getBoundingClientRect().top, e.getBoundingClientRect().bottom, e.getBoundingClientRect().left, e.getBoundingClientRect().right])(document.getElementById(r.id)) }));
  });
  await p.waitForTimeout(150);
  const shot = (await p.screenshot({ clip: { x: 0, y: 0, width: 640, height: 720 } })).toString('base64');
  const edges = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#mkHost [id^=mk]')].map(e => { const m = window.__mk, i = m.ink(e), l = e.matches('button') ? m.letters(e) : null; return [e.id, { ink: i, letters: l ? { capTop: l.capTop, base: l.base } : null }]; })));
  const q = await b.newPage(); await q.goto('about:blank');
  const jobs = samples.map(s => { const [t, bo, l, r] = s.y, e = edges[s.id], isBtn = s.name === 'button';
    return isBtn ? { x0: l, x1: r, y0: t - 3, y1: bo + 3, col: Math.round(l + 8) } : { x0: l - 2, x1: r + 2, y0: t - 12, y1: bo + 12 }; });
  const found = await q.evaluate(scan, { png: shot, jobs });
  samples.forEach((s, k) => {
    const e = edges[s.id], f = found[k], isBtn = s.name === 'button', label = s.name + ' ' + s.size + 'px (' + s.id + ')';
    if (isBtn) {
      ok('border box: ' + label + ': top and bottom edges match the pixels within ' + TOL + 'px', f.top != null && Math.abs(e.ink.top - f.top) <= TOL && Math.abs(e.ink.bottom - f.bottom) <= TOL, 'helper ' + e.ink.top.toFixed(2) + '/' + e.ink.bottom.toFixed(2) + ' pixels ' + (f.top && f.top.toFixed(2)) + '/' + (f.bottom && f.bottom.toFixed(2)));
    } else {
      ok('letters: ' + label + ': cap top and baseline match the pixels within ' + TOL + 'px', f.top != null && Math.abs(e.ink.top - f.top) <= TOL && Math.abs(e.ink.bottom - f.bottom) <= TOL, 'helper ' + e.ink.top.toFixed(2) + '/' + e.ink.bottom.toFixed(2) + ' pixels ' + (f.top && f.top.toFixed(2)) + '/' + (f.bottom && f.bottom.toFixed(2)));
    }
  });
  await b.close();
})();
