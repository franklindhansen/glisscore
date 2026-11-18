// The score's and the audio's chips in the header: glyph, the file's name without its extension, and one quiet word (the format), then the editor glyph; no page count and no length.
// An edited file shows a small dot just left of the editor glyph (the score when pages were removed or changed, the audio when its settings, trim, or fades differ from the start), and the chip names it for a screen reader.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/file-chips.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 1);
  await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.duration > 0); await p.waitForTimeout(1500);
  const read = () => p.evaluate(() => { const g = k => { const c = document.querySelector('.chip[data-k=' + k + ']'); if (!c) return null; const q = s => c.querySelector(s), r = e => e && e.getBoundingClientRect(), dot = r(q('.chip-dot')), ed = r(q('.chip-edit')), cr = r(c);
    return { name: q('.chip-name').textContent, meta: q('.chip-meta') && q('.chip-meta').textContent, text: c.textContent.trim(), dot: !!dot, dotLeft: dot && ed ? dot.right <= ed.left + 0.5 : null, dotInside: dot ? dot.left >= cr.left && dot.right <= cr.right : null, dotSize: dot && dot.width, edLeft: ed && ed.left, label: q('.chip-main').getAttribute('aria-label'), sw: c.scrollWidth, cw: c.clientWidth }; }; return { pdf: g('pdf'), audio: g('audio'), n: document.querySelectorAll('.chip').length }; });
  let c = await read();
  ok('the score chip says its name without the extension, and "PDF"', /^score$/.test(c.pdf.name) && c.pdf.meta === 'PDF', JSON.stringify([c.pdf.name, c.pdf.meta]));
  ok('the score chip shows no page count', !/pp|\d/.test(c.pdf.meta || '') && !/\bpp\b|of \d|edited/i.test(c.pdf.text), c.pdf.text);
  ok('the audio chip says its name without the extension, and its format', c.audio.name === 'loud' && c.audio.meta === 'MP3', JSON.stringify([c.audio.name, c.audio.meta]));
  ok('the audio chip shows no length', !/\d:\d\d/.test(c.audio.text), c.audio.text);
  ok('neither chip shows the dot at first', !c.pdf.dot && !c.audio.dot, JSON.stringify([c.pdf.dot, c.audio.dot]));
  await p.evaluate(() => { S.pdf.keep = S.pdf.keep.slice(1); S.set.gainDb = 3; setChips(); }); await p.waitForTimeout(400);
  const e = await read();
  ok('an edited score shows the dot, left of the editor glyph and inside the chip', e.pdf.dot && e.pdf.dotLeft && e.pdf.dotInside, JSON.stringify([e.pdf.dot, e.pdf.dotLeft, e.pdf.dotInside]));
  ok('an edited audio shows the dot, left of the editor glyph and inside the chip', e.audio.dot && e.audio.dotLeft && e.audio.dotInside, JSON.stringify([e.audio.dot, e.audio.dotLeft, e.audio.dotInside]));
  ok('the dot is small', e.pdf.dotSize <= 8 && e.audio.dotSize <= 8, e.pdf.dotSize + ' ' + e.audio.dotSize);
  ok('the chips name the edit for a screen reader', /edited/.test(e.pdf.label) && /edited/.test(e.audio.label), e.pdf.label + ' | ' + e.audio.label);
  // every part sits on the chip's one middle line: the two glyphs, the dot, the format, and (trimmed to its lowercase body) the name
  const A = await p.evaluate(() => ['pdf', 'audio'].map(k => { const c = document.querySelector('.chip[data-k=' + k + ']'), m = e => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; }, cr = c.getBoundingClientRect(), mid = cr.top + cr.height / 2, q = s => c.querySelector(s);
    return { k, glyph: m(q('.chip-icon svg')) - mid, edit: m(q('.chip-edit svg')) - mid, dot: m(q('.chip-dot')) - mid, meta: m(q('.chip-meta')) - mid, name: m(q('.chip-name')) - mid, svgTop: [q('.chip-icon svg'), q('.chip-edit svg')].map(e => e.getBoundingClientRect().top % 1) }; }));
  ok('the glyphs, the dot, and the format share the chip\'s middle line (within 0.25px)', A.every(a => Math.abs(a.glyph) <= 0.25 && Math.abs(a.edit) <= 0.25 && Math.abs(a.dot) <= 0.25 && Math.abs(a.meta) <= 0.25), JSON.stringify(A));
  ok('the name stands on the format\'s baseline (within 0.25px) and its middle is within 1px of the chip\'s line, where the browser trims text', await p.evaluate(() => ['pdf', 'audio'].every(k => { const c = document.querySelector('.chip[data-k=' + k + ']'), n = c.querySelector('.chip-name'), m = c.querySelector('.chip-meta'), cr = c.getBoundingClientRect(), base = e => { const r = e.getBoundingClientRect(); return r.bottom - parseFloat(getComputedStyle(e).paddingBottom); }, mid = (n.getBoundingClientRect().top + n.getBoundingClientRect().bottom) / 2 - (cr.top + cr.height / 2); return Math.abs(base(n) - base(m)) <= 0.25 && Math.abs(mid) <= 1; })));
  ok('the glyphs sit on whole pixels', A.every(a => a.svgTop.every(t => Math.abs(t) < 0.05 || Math.abs(t - 1) < 0.05)), JSON.stringify(A.map(a => a.svgTop)));
  await p.evaluate(() => { S.set.gainDb = 0; setChips(); }); await p.waitForTimeout(300);
  ok('putting the audio back clears its dot', !(await read()).audio.dot);
  // a long name is cut with an ellipsis and the chip still fits its row
  await p.evaluate(() => { S.audio.name = 'A very long recording name that goes on and on for a rehearsal of the fourth symphony, take two.wav'; setChips(); }); await p.waitForTimeout(300);
  const L = await p.evaluate(() => { const c = document.querySelector('.chip[data-k=audio]'), n = c.querySelector('.chip-name'), h = document.querySelector('#chips').getBoundingClientRect(), r = c.getBoundingClientRect(); return { cut: n.scrollWidth > n.clientWidth, meta: c.querySelector('.chip-meta').textContent, inside: r.right <= h.right + 0.5 || getComputedStyle(document.querySelector('#chips')).overflow !== 'visible', w: r.width }; });
  ok('a long name is cut, the format stays, and the chip is no wider than its limit', L.cut && L.meta === 'WAV' && L.w <= 320.5, JSON.stringify(L));
  ok('no script errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
