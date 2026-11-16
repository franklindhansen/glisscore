// The Custom choice: in a choice that has one (Watermark's Direction, Re-size's sizes), clicking Custom slides the highlight onto it and the word turns into a blank to type in, in its own place.
// The value typed is kept; choosing another option turns the blank back into the word, and clicking Custom again shows the value. An empty blank left behind returns to the choice before it.
// Every choice without a Custom option is compared with tests/seg-plain-expected.json (written the first time this runs), so nothing about them changes.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/seg-custom.js
const { chromium } = require('playwright-core'), fs = require('fs'), path = require('path');
const FX = process.env.S || 'tests/fixtures', BASE = path.join(__dirname, 'seg-plain-expected.json');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html';
async function open(b, w, h, tool) {
  const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(900);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(700); if (tool) { if (await p.isVisible('#peRailCur')) { await p.click('#peRailCur'); await p.waitForTimeout(500); } await p.click('#peRail .pe-tab[data-tool=' + tool + ']'); await p.waitForTimeout(600); }
  return p;
}
// every choice without a Custom option: its markup and the computed look of the control and its options
const plainSnap = () => [...document.querySelectorAll('.seg')].filter(s => !s.querySelector('.cu') && !s.querySelector('input[name=peWmAngle]')).map(s => {
  const key = (s.querySelector('input') || {}).name || s.id || s.getAttribute('aria-label'), cs = getComputedStyle(s), pick = (c, ks) => ks.map(k => c[k]).join(' ');
  return { key, html: s.innerHTML.replace(/<i class="seg-pill"[^>]*><\/i>/, ''), seg: pick(cs, ['display', 'height', 'padding', 'borderRadius', 'borderWidth', 'gridAutoColumns']), labels: [...s.querySelectorAll('label')].map(l => pick(getComputedStyle(l), ['display', 'padding', 'fontSize', 'fontWeight', 'color', 'textAlign', 'whiteSpace', 'justifyContent'])) };
});
(async () => {
  const b = await chromium.launch();
  // 1. choices without Custom do not change
  { const p = await open(b, 1440, 900, 'wm'), now = await p.evaluate(plainSnap);
    if (!fs.existsSync(BASE)) { fs.writeFileSync(BASE, JSON.stringify(now, null, 1) + '\n'); ok('choices without Custom: baseline written (' + now.length + ' choices)', true); }
    else { const was = JSON.parse(fs.readFileSync(BASE, 'utf8')), diff = [];
      for (const w of was) { const n = now.find(x => x.key === w.key); if (!n) diff.push(w.key + ' is gone'); else for (const k of ['html', 'seg', 'labels']) if (JSON.stringify(n[k]) !== JSON.stringify(w[k])) diff.push(w.key + ' ' + k); }
      ok('choices without Custom are unchanged (' + was.length + ' choices)', !diff.length && now.length === was.length, diff.slice(0, 6).join('; ')); }
    await p.close(); }
  // 2. Watermark's Direction
  { const p = await open(b, 1440, 900, 'wm'), lab = 'label:has(input[name=peWmAngle][value=custom])';
    const st = () => p.evaluate(l => { const L = document.querySelector(l), pill = L.closest('.seg').querySelector('.seg-pill'), r = L.getBoundingClientRect(), pr = pill.getBoundingClientRect(), f = L.querySelector('.cu-field input'), w = L.querySelector('.cu-word');
      return { open: L.classList.contains('open'), pillOn: Math.abs(pr.left - r.left) < 1.5 && Math.abs(pr.width - r.width) < 1.5, focused: document.activeElement === f, val: f && f.value, word: w && getComputedStyle(w).opacity, field: f && getComputedStyle(L.querySelector('.cu-field')).opacity, checked: document.querySelector('input[name=peWmAngle]:checked').value, angle: PE.d.wm.angle, width: r.width }; }, lab);
    const s0 = await st(); await p.click(lab); await p.waitForTimeout(700); const s1 = await st();
    ok('clicking Custom slides the highlight onto it and opens an empty blank with the cursor in it', s1.open && s1.pillOn && s1.focused && s1.val === '' && s1.checked === 'custom' && s1.angle === s0.angle && +s1.word < 0.05 && +s1.field > 0.95, JSON.stringify(s1));
    ok('the Custom cell keeps its width when it opens', Math.abs(s1.width - s0.width) < 0.5, s0.width + ' → ' + s1.width);
    await p.keyboard.type('4'); await p.keyboard.type('5'); await p.waitForTimeout(150); const s2 = await st();
    ok('typing 45 keeps Custom chosen while typing', s2.checked === 'custom' && s2.open && s2.angle === 45, JSON.stringify(s2));
    await p.fill(lab + ' .cu-field input', '30'); await p.keyboard.press('Enter'); await p.waitForTimeout(500); const s3 = await st();
    ok('typing 30 and pressing Enter sets the angle to 30 and keeps Custom showing 30', s3.angle === 30 && s3.checked === 'custom' && s3.open && s3.val === '30' && !s3.focused, JSON.stringify(s3));
    await p.click('label:has(input[name=peWmAngle][value="45"])'); await p.waitForTimeout(700); const s4 = await st();
    ok('choosing Diagonal turns the blank back into the word Custom', !s4.open && s4.checked === '45' && s4.angle === 45 && +s4.word > 0.95 && +s4.field < 0.05, JSON.stringify(s4));
    await p.click(lab); await p.waitForTimeout(700); const s5 = await st();
    ok('clicking Custom again shows the remembered 30 and applies it', s5.open && s5.val === '30' && s5.angle === 30 && s5.checked === 'custom', JSON.stringify(s5));
    await p.click('label:has(input[name=peWmAngle][value="0"])'); await p.waitForTimeout(500); await p.evaluate(() => peUndo()); await p.waitForTimeout(500); const s6 = await st();
    ok('undo back to 30 shows Custom with 30', s6.angle === 30 && s6.checked === 'custom' && s6.open && s6.val === '30', JSON.stringify(s6));
    await p.evaluate(() => peUndo()); await p.waitForTimeout(500); const s7 = await st();
    ok('undo back to 45 shows Diagonal', s7.angle === 45 && s7.checked === '45' && !s7.open, JSON.stringify(s7));
    await p.evaluate(() => { PE.wmDeg = null; }); await p.click(lab); await p.waitForTimeout(500); await p.click('#peWmText'); await p.waitForTimeout(600); const s8 = await st();
    ok('an empty blank left behind returns to the choice before it and changes nothing', s8.checked === '45' && !s8.open && s8.angle === 45, JSON.stringify(s8));
    await p.focus('input[name=peWmAngle][value="0"]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500); const s9 = await st();
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(500); const s10 = await st();
    ok('arrow keys still move across the choices: onto Custom opens it without taking the cursor, and back off again', s9.checked === 'custom' && s9.open && !s9.focused && s10.checked === '0' && !s10.open, JSON.stringify([s9, s10]));
    ok('no page errors', !p.errs.length, p.errs.join('; ')); await p.close(); }
  // 2a. the highlight glides onto Custom as onto any choice (it is never put there at once)
  { const p = await open(b, 1440, 900, 'wm');
    const g = await p.evaluate(async () => { const l = document.querySelector('label:has(input[name=peWmAngle][value=custom])'), sg = l.closest('.seg'), pill = sg.querySelector('.seg-pill'), x = () => pill.getBoundingClientRect().left - sg.getBoundingClientRect().left;
      const a = x(); l.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); l.click(); await new Promise(r => setTimeout(r, 60)); const m = x(); await new Promise(r => setTimeout(r, 800)); return { a, m, e: x() }; });
    ok('the highlight slides onto Custom instead of jumping there', g.m > g.a + 5 && g.m < g.e - 5, JSON.stringify(g)); await p.close(); }
  // 2b. Re-size's Custom size card
  { const p = await open(b, 1440, 900, 'resize'), tile = '#peRzGrid .rz-opt[data-k=custom]';
    const st = () => p.evaluate(t => { const T = document.querySelector(t), r = T.getBoundingClientRect(), wd = T.querySelector('.cu-word'), f = T.querySelector('.cu-field'), W = $('#peRzW'), H = $('#peRzH'), fr = f.getBoundingClientRect();
      return { open: T.classList.contains('open'), pressed: T.getAttribute('aria-pressed'), w: W.value, h: H.value, focus: document.activeElement && document.activeElement.id, word: getComputedStyle(wd).opacity, field: getComputedStyle(f).opacity, width: T.offsetWidth, inside: fr.left >= r.left - 0.5 && fr.right <= r.right + 0.5, pend: PE.rzPend ? [PE.rzPend.w, PE.rzPend.h] : null, out: !!document.querySelector('#peRzCustom') }; }, tile);
    const s0 = await st(); await p.click(tile); await p.waitForTimeout(700); const s1 = await st();
    ok('Re-size: clicking Custom turns the card into two empty blanks in its own place, the cursor in the width', s1.open && s1.pressed === 'true' && s1.w === '' && s1.h === '' && s1.focus === 'peRzW' && +s1.word < 0.05 && +s1.field > 0.95 && !s1.out, JSON.stringify(s1));
    ok('Re-size: the card keeps its width and the blanks fit inside it', Math.abs(s0.width - s1.width) < 0.5 && s1.inside, s0.width + ' → ' + s1.width);
    await p.keyboard.type('7'); await p.keyboard.press('Tab'); const tabbed = await p.evaluate(() => document.activeElement.id); await p.keyboard.type('10'); await p.keyboard.press('Enter'); await p.waitForTimeout(500); const s2 = await st();
    ok('Re-size: Tab moves from width to height, and 7 × 10 is picked and stays showing', tabbed === 'peRzH' && s2.pend && s2.pend[0] === 7 && s2.pend[1] === 10 && s2.open, JSON.stringify([tabbed, s2]));
    await p.click('#peRzGrid .rz-opt[data-k=letter]'); await p.waitForTimeout(700); const s3 = await st();
    ok('Re-size: choosing Letter turns the card back into the word Custom', !s3.open && s3.pressed === 'false' && +s3.word > 0.95, JSON.stringify(s3));
    await p.click(tile); await p.waitForTimeout(700); const s4 = await st();
    ok('Re-size: clicking Custom again shows 7 × 10 and picks it', s4.open && s4.w === '7' && s4.h === '10' && s4.pend && s4.pend[0] === 7, JSON.stringify(s4));
    await p.evaluate(() => { PE.rzMem = null; }); await p.click('#peRzGrid .rz-opt[data-k=orig]'); await p.waitForTimeout(300); await p.click(tile); await p.waitForTimeout(400); await p.click('#peViewResize .pe-sub'); await p.waitForTimeout(600); const s5 = await st();
    ok('Re-size: empty blanks left behind return to the size before', !s5.open && s5.pressed === 'false' && !s5.pend, JSON.stringify(s5));
    await p.focus(tile); await p.keyboard.press('Enter'); await p.waitForTimeout(500); const s6 = await st();
    ok('Re-size: Enter on the Custom card opens it too', s6.open && s6.focus === 'peRzW', JSON.stringify(s6));
    ok('Re-size: no page errors', !p.errs.length, p.errs.join('; ')); await p.close(); }
  // 3. narrow windows: the open blank is not cut off and the cell does not widen
  for (const [w, h] of [[390, 800], [360, 800]]) {
    const p = await open(b, w, h, 'wm'), lab = 'label:has(input[name=peWmAngle][value=custom])';
    const m = () => p.evaluate(l => { const L = document.querySelector(l), f = L.querySelector('.cu-field'), r = L.getBoundingClientRect(), fr = f.getBoundingClientRect(), wd = L.querySelector('.cu-word');
      return { w: r.width, inside: fr.left >= r.left - 0.5 && fr.right <= r.right + 0.5, wordFits: wd.scrollWidth <= Math.ceil(wd.getBoundingClientRect().width) + 0.5 && wd.getBoundingClientRect().right <= r.right + 0.5 }; }, lab);
    const a = await m(); await p.click(lab); await p.fill(lab + ' .cu-field input', '-180'); await p.waitForTimeout(600); const c = await m();
    ok(w + 'px: the word and the open blank (-180°) fit inside the Custom cell, which keeps its width', a.wordFits && c.inside && Math.abs(a.w - c.w) < 0.5, JSON.stringify([a, c]));
    await p.close(); }
  await b.close();
})();
