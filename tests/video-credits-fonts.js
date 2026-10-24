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
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
