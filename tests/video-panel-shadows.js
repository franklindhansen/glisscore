// The video panel's Shadows group and the names the refinements changed: Crease, Shading, Divider, Page turn, Under score, Margin; no Style or Apply to label (the choices keep an accessible name);
// Softness shows only while Strength is above 0; Reset sits in the Shadows heading, shows only while Shadows is on and a slider has moved, and puts everything back; a closed Shadows tile is centered on its heading;
// in Single page the Crease part is closed and nothing else changes name.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-panel-shadows.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0', FX = process.env.S || 'tests/fixtures';
(async () => {
  const b = await chromium.launch(), errs = []; 
  for (const dark of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1440, height: 1400 }, colorScheme: dark ? 'dark' : 'light' }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); const tag = dark ? ' (dark)' : '';
    await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 0); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    const txt = sel => p.evaluate(s => [...document.querySelectorAll(s)].filter(e => (e.closest('.field') || e).offsetParent).map(e => (e.firstChild && e.firstChild.nodeType === 3 ? e.firstChild.textContent : e.textContent).trim().replace(/\s+/g, ' ')), sel);
    const heads = await txt('[data-sum=shadows] .subhead');
    ok('the three parts are named Crease, Page turn, and Under score' + tag, JSON.stringify(heads) === JSON.stringify(['Crease', 'Page turn', 'Under score']), heads.join(', '));
    const labels = await txt('[data-sum=shadows] .sub>.field>label');
    ok('the settings read Shading, Divider, Strength, then Strength (Softness only with Strength above 0)' + tag, JSON.stringify(labels) === JSON.stringify(['Shading', 'Divider', 'Strength', 'Softness', 'Strength']), labels.join(', '));
    ok('Page margin is now Margin' + tag, (await txt('label[for=margin]'))[0] === 'Margin');
    const gone = await p.evaluate(() => ({ style: !document.querySelector('#transLbl'), apply: !document.querySelector('#fadeSideLbl'), t: document.querySelector('input[name=transition]').closest('.seg').getAttribute('aria-label'), f: document.querySelector('#fadeSide').getAttribute('aria-label'), first: document.querySelector('#transLbl, input[name=transition]').closest('.field').firstElementChild.className }));
    ok('the Style and Apply to labels are gone and the choices are still named' + tag, gone.style && gone.apply && gone.t && gone.f && gone.first === 'seg', JSON.stringify(gone));
    const hint = await p.evaluate(() => { document.querySelector('#scoreAmt').value = 40; document.querySelector('#scoreAmt').dispatchEvent(new Event('input', { bubbles: true })); return document.querySelector('#scoreHint').textContent; });
    ok('the note under Under score reads "Best on a light background with margin."' + tag, hint === 'Best on a light background with margin.', hint);
    // Reset
    const st = () => p.evaluate(() => ({ reset: !document.getElementById('shadowReset').hidden, old: document.querySelectorAll('.group-body>#shadowReset, [data-sum=shadows]>.btn').length, g: S.set.gutter, sa: S.set.scoreAmt }));
    await p.evaluate(() => { const g = document.querySelector('#gutter'); g.value = 80; g.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(100);
    let s = await st(); ok('Reset shows once a slider has moved, and the old bottom button is gone' + tag, s.reset && s.old === 0, JSON.stringify(s));
    const where = await p.evaluate(() => { const r = document.getElementById('shadowReset'); return { inHead: !!r.closest('.group-head'), title: r.title, text: r.textContent, before: r.nextElementSibling.matches('.group-toggle') }; });
    ok('Reset is a small button in the heading, left of the switch, with its tooltip' + tag, where.inHead && where.title === 'Reset shadows to defaults' && where.text === 'Reset' && where.before, JSON.stringify(where));
    await p.click('#shadowReset'); await p.waitForTimeout(200); s = await st();
    ok('Reset puts the shadows back and hides itself' + tag, !s.reset && s.g === 35 && s.sa === 0, JSON.stringify(s));
    await p.evaluate(() => { const g = document.querySelector('#gutter'); g.value = 80; g.dispatchEvent(new Event('input', { bubbles: true })); const sw = document.querySelector('#shadowsOn'); sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(700);
    s = await st(); ok('Reset is hidden while Shadows is off' + tag, !s.reset);
    const bal = await p.evaluate(() => { const g = document.querySelector('[data-sum=shadows]'), r = g.getBoundingClientRect(), h = g.querySelector('h3'), rg = document.createRange(); rg.selectNodeContents(h.querySelector('.fold-btn') || h); const t = rg.getBoundingClientRect(); return { above: t.top - r.top, below: r.bottom - t.bottom, off: g.classList.contains('off') }; });
    ok('a closed Shadows tile is centered on its heading' + tag, bal.off && Math.abs(bal.above - bal.below) <= 1, JSON.stringify(bal));
    await p.evaluate(() => { const sw = document.querySelector('#shadowsOn'); sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(700);
    // Credits: the chevron's space is reserved while it is hidden, so the heading does not move when the group opens
    const cx = async () => p.evaluate(() => { const g = document.querySelector('[data-sum=credits]'), t = g.querySelector('.fold-btn'), rg = document.createRange(); rg.selectNodeContents(t); const r = g.getBoundingClientRect(); return { x: rg.getBoundingClientRect().left, y: rg.getBoundingClientRect().top - r.top, off: g.classList.contains('off') }; });
    const c0 = await cx(); await p.evaluate(() => { const sw = document.querySelector('#creditsOn'); sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(800); const c1 = await cx();
    ok('turning Credits on leaves its heading where it was' + tag, c0.off && !c1.off && Math.abs(c0.x - c1.x) <= 0.5 && Math.abs(c0.y - c1.y) <= 4, JSON.stringify([c0, c1]));
    // Single page
    await p.evaluate(() => document.querySelector('input[name=pageLayout][value=single]').click()); await p.waitForTimeout(900);
    const one = await p.evaluate(() => ({ crease: !document.querySelector('#centerFold').offsetParent, heads: [...document.querySelectorAll('[data-sum=shadows] .subhead')].filter(e => e.offsetParent).map(e => e.textContent.trim()) }));
    ok('in Single page the Crease part is closed and the others keep their names' + tag, one.crease && JSON.stringify(one.heads) === JSON.stringify(['Page turn', 'Under score']), JSON.stringify(one));
    await p.close();
  }
  ok('no page errors', !errs.length, errs[0] || ''); await b.close();
})();
