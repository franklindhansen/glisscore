// The Credits panel's font controls: each line's Aa button opens that line's font row (font, B, I) and is lit when the line has settings of its own; a line uses its own font, else the shared Font, else the default;
// the font list shows the default first; work saved with "Different font for each line" (saved settings or an imported file) keeps looking the same.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-credits-fonts.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
(async () => {
  const b = await chromium.launch(), errs = [];
  const open = async saved => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }), p = await ctx.newPage(); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
    if (saved) await p.addInitScript(s => { try { localStorage.setItem('glisscore.settings', s); } catch (e) {} }, JSON.stringify(saved));
    await p.goto(URL); await p.waitForTimeout(900); return p;
  };
  const set = p => p.evaluate(K => { const s = window[K].S.set; return { font: s.creditsFont, t: s.credTitleFont, l2: s.credL2Font, l3: s.credL3Font, each: 'creditsFontEach' in s }; }, K);

  // saved with the switch ON: the line fonts stay, the shared font is cleared (a line without one was drawn in the default)
  let p = await open({ creditsOn: true, creditsFontEach: true, creditsFont: 'Lora', credL2Font: 'Cinzel' }), s = await set(p);
  ok('switch on: line font kept, shared font cleared, key gone', s.l2 === 'Cinzel' && s.font === '' && !s.each, JSON.stringify(s));
  ok('and the line draws in its own font, another line in the default', await p.evaluate(() => lineStyle('L2').font === 'Cinzel' && lineStyle('L3').font === ''));
  await p.context().close();
  // saved with the switch OFF: the shared font stays, the line fonts (which were ignored) are cleared
  p = await open({ creditsOn: true, creditsFontEach: false, creditsFont: 'Lora', credL2Font: 'Cinzel' }); s = await set(p);
  ok('switch off: shared font kept, line fonts cleared, key gone', s.font === 'Lora' && s.l2 === '' && !s.each, JSON.stringify(s));
  ok('and every line draws in the shared font', await p.evaluate(() => ['Title', 'L2', 'L3'].every(k => lineStyle(k).font === 'Lora')));
  await p.context().close();

  p = await open(); await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#creditsOn').click()); await p.waitForTimeout(900);
  const aa = k => p.evaluate(k => { const a = document.querySelector('#cred' + k + 'Aa'), f = document.querySelector('#cred' + k + 'Fold'); return { open: a.getAttribute('aria-expanded'), lit: a.hasAttribute('data-own'), fold: f.classList.contains('open'), inert: f.firstElementChild.inert }; }, k);
  let a = await aa('L2'); ok('a line starts shut and unlit', a.open === 'false' && !a.lit && !a.fold && a.inert, JSON.stringify(a));
  await p.click('#credL2Aa'); await p.waitForTimeout(700); a = await aa('L2'); ok('Aa opens the line row', a.open === 'true' && a.fold && !a.inert, JSON.stringify(a));
  const sz = await p.evaluate(() => { const r = e => document.querySelector(e).getBoundingClientRect(); return { aaW: r('#credTitleAa').width, aaH: r('#credTitleAa').height, boxH: r('#credTitle').height }; });
  ok('Aa is 36px wide and as tall as its text box', Math.abs(sz.aaW - 36) < 0.5 && Math.abs(sz.aaH - sz.boxH) < 0.5, JSON.stringify(sz));
  await p.click('#credL2I'); a = await aa('L2'); ok('Bold or Italic lights Aa', a.lit);
  ok('Italic is that line only', await p.evaluate(() => lineStyle('L2').i && !lineStyle('L3').i && !lineStyle('Title').i));
  await p.click('#credL2I'); a = await aa('L2'); ok('Aa goes dark when the line has nothing of its own', !a.lit);
  await p.click('#credL2Aa'); await p.waitForTimeout(700); a = await aa('L2'); ok('Aa shuts the row again', a.open === 'false' && !a.fold && a.inert);

  // each line's own font list drops below its row (the row does not clip it), says no Default, and picks a font for that line
  for (const k of ['Title', 'L2', 'L3']) {
    await p.click('#cred' + k + 'Aa'); await p.waitForTimeout(900);
    await p.evaluate(k => document.querySelector('#cred' + k + 'Font').focus(), k); await p.waitForTimeout(400);
    const r = await p.evaluate(k => { const l = document.querySelector('#cred' + k + 'FontList'), c = document.querySelector('#cred' + k + 'FontBox'), lr = l.getBoundingClientRect(), cr = c.getBoundingClientRect(), fold = document.querySelector('#cred' + k + 'Fold > .fa-in'), el = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2); return { first: l.children[0].textContent, below: lr.top >= cr.bottom - 1, tall: lr.height > 100, clip: getComputedStyle(fold).overflow, hit: !!(el && l.contains(el)), box: cr.height > 20 }; }, k);
    ok(k + ': the font list drops below the font box and is not clipped', r.below && r.tall && r.clip === 'visible' && r.hit && r.box, JSON.stringify(r));
    ok(k + ': the font list names the default without the word Default', r.first === 'Hanken Grotesk', r.first);
    await p.evaluate(k => document.querySelector('#cred' + k + 'FontList li:nth-child(2)').click(), k);
    await p.waitForFunction(k => window.__keyframes.S.set['cred' + k + 'Font'], k, { timeout: 15000 }).catch(() => {});          // the name is looked up on Google Fonts first, which can take a moment
    ok(k + ': picking from the list sets that line only', await p.evaluate(k => { const S = window.__keyframes.S.set; return S['cred' + k + 'Font'] === document.querySelector('#cred' + k + 'Font').value && !!S['cred' + k + 'Font'] && ['Title', 'L2', 'L3'].filter(o => o !== k).every(o => !S['cred' + o + 'Font']); }, k));
    await p.evaluate(k => { document.querySelector('#cred' + k + 'Font').focus(); }, k); await p.waitForTimeout(300);
    await p.evaluate(k => document.querySelector('#cred' + k + 'FontList li:first-child').click(), k);
    await p.waitForFunction(k => !window.__keyframes.S.set['cred' + k + 'Font'], k, { timeout: 15000 }).catch(() => {});
    ok(k + ': picking the first item puts the line back on the shared font', await p.evaluate(k => !window.__keyframes.S.set['cred' + k + 'Font'], k));
    await p.evaluate(() => document.activeElement.blur()); await p.click('#cred' + k + 'Aa'); await p.waitForTimeout(800);
  }

  // the list shows the default first; picking it clears the font
  await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = 'Lora'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('#credFont').dispatchEvent(new Event('focus'))); await p.waitForTimeout(300);
  const first = await p.evaluate(() => document.querySelector('#credFontList li:first-child').textContent);
  ok('the font list starts with the default', first === 'Hanken Grotesk (Default)', first);
  await p.evaluate(() => document.querySelector('#credFontList li:first-child').click()); await p.waitForTimeout(700);
  ok('picking the default clears the font', (await set(p)).font === '' && await p.evaluate(() => document.querySelector('#credFont').value === ''));
  ok('the empty font box shows the default name and the hint', await p.evaluate(() => { const e = document.querySelector('#credFontBox .ph'); return getComputedStyle(e).display !== 'none' && e.textContent === 'Hanken Grotesk · Any Google Font'; }));

  // an imported file made with the switch on
  const file = { glisscore: 1, settings: { creditsOn: true, creditsFontEach: true, creditsFont: 'Lora', credTitleFont: 'Cinzel' } };
  await p.evaluate(async f => { await importSettings(new File([JSON.stringify(f)], 'x.txt')); }, file); await p.waitForTimeout(500); s = await set(p);
  ok('an imported file with the switch on keeps its line fonts', s.t === 'Cinzel' && s.font === '' && !s.each, JSON.stringify(s));
  // the folded Credits row shows the lines you filled in (a blank line is skipped), every one of them, and says Empty when there is nothing
  const fold = async open => { await p.evaluate(open => { const g = document.querySelector('.group[data-sum="credits"]'); if (g.classList.contains('collapsed') === open) g.querySelector('.fold-btn').click(); }, open); await p.waitForTimeout(700); };
  const sumOf = async (t, a, c) => { await fold(true); await p.fill('#credTitle', t); await p.fill('#credL2', a); await p.fill('#credL3', c); await fold(false); return p.evaluate(() => document.querySelector('.group[data-sum="credits"] .group-sum').textContent); };
  ok('the folded row shows the lines you wrote with no Title or Line 2 words', (await sumOf('Moonlight', '', 'Conductor')) === 'Moonlight · Conductor');
  const lng = await sumOf('The Complete Piano Sonatas of Ludwig van Beethoven', 'Performed by the Illustrious Musicians of the Royal Orchestra', 'C. Conductorson, conductor and artistic director');
  ok('three long lines are each shortened, so all three still show', lng.split(' · ').length === 3 && lng.split(' · ').every(x => x.length > 3), lng);
  ok('with nothing written it says Empty', (await sumOf('', '', '')) === 'Empty');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
