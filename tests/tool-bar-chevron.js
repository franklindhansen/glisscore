// The narrow tool bar in the PDF Editor and the Audio Editor: the panels' fold chevron, the tool's name in a panel heading's type, then the tool's button(s) on the right; no "Tool" word and no old arrow.
// The chevron points right when closed and down when open, and sits within 0.5px of the middle of the name's capitals, closed and open, light and dark. The panel headings' chevrons are unchanged.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/tool-bar-chevron.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
// the name's capital middle, in page pixels
const capMid = sel => { const n = document.querySelector(sel), cs = getComputedStyle(n), r = n.getBoundingClientRect(), c = document.createElement('canvas').getContext('2d'); c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily; const m = c.measureText('H'), lh = parseFloat(cs.lineHeight) || r.height; const base = r.top + (r.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent; return base - m.actualBoundingBoxAscent / 2; };
// the chevron's ink: the first run of ink columns from the left in a screenshot of the bar (2x), its vertical middle in page pixels
const inkMid = async (p, clip, dark) => { const buf = await p.screenshot({ clip }); return p.evaluate(async ([b64, dark, y0]) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height, ink = i => { const g = (d[i] + d[i + 1] + d[i + 2]) / 3; return dark ? g > 110 : g < 170; };
  let x0 = null; const ys = []; for (let xx = 0; xx < W; xx++) { const col = []; for (let yy = 2; yy < H - 2; yy++) if (ink((yy * W + xx) * 4)) col.push(yy); if (col.length && x0 === null) x0 = xx; if (x0 !== null) { if (!col.length) break; ys.push(...col); } }
  return ys.length ? y0 + (Math.min(...ys) + Math.max(...ys)) / 2 / (W / img.width * 2 > 0 ? 2 : 2) : null; }, [buf.toString('base64'), dark, clip.y]); };
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const dark of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 700, height: 800 }, deviceScaleFactor: 2, colorScheme: dark ? 'dark' : 'light' }), p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); if (dark) await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.keep.length > 0); await p.setInputFiles('#audioIn', FX + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(600);
    const L = dark ? 'dark: ' : 'light: ';
    for (const ed of ['pdf', 'audio']) {
      if (ed === 'pdf') { await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500); await p.evaluate(() => peTool('crop')); } else { await p.evaluate(() => { $('#pdfDlg').hidden || $('#peCancel') && $('#peCancel').click(); }); await p.waitForTimeout(600); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(900); await p.evaluate(() => aeTool('eq')); }
      await p.waitForTimeout(900);
      const cur = ed === 'pdf' ? '#peRailCur' : '#aeRailCur', name = ed === 'pdf' ? '#peRailName' : '#aeRailName', bar = ed === 'pdf' ? '.pe-rail-bar' : '.ae-rail-bar', E = L + (ed === 'pdf' ? 'PDF Editor' : 'Audio Editor') + ': ';
      const st = await p.evaluate(([cur, name, bar]) => { const c = document.querySelector(cur), n = document.querySelector(name), btns = Array.from(document.querySelector(bar).querySelectorAll('.btn, .ae-abs')).filter(e => e.offsetParent), cn = n.getBoundingClientRect(), pc = getComputedStyle(c, '::before');
        return { text: c.textContent.trim(), span: c.querySelectorAll('span').length, svg: c.querySelectorAll('svg').length, chev: pc.content !== 'none' && pc.display !== 'none', chevX: c.getBoundingClientRect().left, nameX: cn.left, btnX: btns.map(e => Math.round(e.getBoundingClientRect().left)), nameR: cn.right, size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight, ref: getComputedStyle(document.querySelector('.group .fold-btn')).fontSize, gap: getComputedStyle(c).columnGap }; }, [cur, name, bar]);
      ok(E + 'no "Tool" word and no old arrow', st.span === 0 && st.svg === 0 && !/^Tool/.test(st.text), JSON.stringify({ text: st.text, span: st.span, svg: st.svg }));
      ok(E + 'order: chevron, name, then the button(s) on the right', st.chev && st.nameX > st.chevX && st.btnX.length > 0 && st.btnX.every(x => x >= st.nameR), JSON.stringify(st.btnX) + ' name ends ' + Math.round(st.nameR));
      ok(E + 'the name is in a panel heading\'s type, 8px after the chevron', st.size === st.ref && st.weight === '600' && st.gap === '8px', st.size + ' ' + st.weight + ' ' + st.gap);
      for (const opened of [false, true]) {
        if (opened) { await p.click(cur); await p.waitForTimeout(800); }
        const tf = await p.evaluate(cur => getComputedStyle(document.querySelector(cur), '::before').transform, cur), m = tf.match(/matrix\(([^)]+)\)/), v = m ? m[1].split(',').map(Number) : [];
        ok(E + 'the chevron points ' + (opened ? 'down' : 'right') + ' when ' + (opened ? 'open' : 'closed'), opened ? v[1] > 0 : v[1] < 0, tf);
        const clip = await p.evaluate(bar => { const r = document.querySelector(bar).getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.x) - 8), y: Math.floor(r.y), width: Math.min(Math.ceil(r.width) + 16, 680), height: Math.ceil(r.height) }; }, bar);
        const ink = await inkMid(p, clip, dark), cap = await p.evaluate(`(${capMid})(${JSON.stringify(name)})`);
        ok(E + 'the chevron\'s centre is within 0.5px of the name\'s capitals (' + (opened ? 'open' : 'closed') + ')', ink != null && Math.abs(ink - cap) <= 0.5, 'chevron ' + (ink && ink.toFixed(2)) + ', capitals ' + cap.toFixed(2));
      }
      if (ed === 'pdf') await p.evaluate(() => { const c = $('#peCancel'); c && c.click(); });
    }
    // the panel headings' chevrons: right when folded (a quarter turn off down), the same 6px box and 1.6px borders
    await p.evaluate(() => { const a = $('#aeClose') || $('#aeDone'); a && a.click(); }); await p.waitForTimeout(500);
    const ph = await p.evaluate(() => { const out = []; document.querySelectorAll('.panel .group[data-sum]').forEach(g => { const b = g.querySelector('.fold-btn'), s = getComputedStyle(b, '::before'); out.push({ open: b.getAttribute('aria-expanded'), collapsed: g.classList.contains('collapsed'), tf: s.transform, w: s.width, bw: s.borderRightWidth, op: s.opacity, off: g.classList.contains('off') }); }); return out; });
    ok(L + 'panel headings: 6px chevron with its borders', ph.length >= 6 && ph.every(q => q.w === '6px' && parseFloat(q.bw) >= 1), JSON.stringify(ph[0]));
    ok(L + 'panel headings: open points down, folded points right, as before', ph.every(q => { const v = (q.tf.match(/matrix\(([^)]+)\)/) || [0, ''])[1].split(',').map(Number); return q.collapsed || q.off ? v[1] < 0 : v[1] > 0; }), JSON.stringify(ph.map(q => q.collapsed ? 'r' : 'd')));
    await ctx.close();
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
