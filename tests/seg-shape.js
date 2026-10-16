// Segmented controls take the button group's shape: one outline, a 2px inset, a 9px group corner and a 7px pill corner, in every instance (including the ones that restyle .seg). The pill sits exactly on the selected option, inside the inset.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/seg-shape.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [label, scheme, width] of [['laptop light', 'light', 1280], ['laptop dark', 'dark', 1280], ['phone', 'light', 390]]) {
    const p = await b.newPage({ viewport: { width, height: width < 600 ? 800 : 900 }, colorScheme: scheme }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
    await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
    await p.evaluate(() => aeTool('fades')); await p.waitForTimeout(800);
    const all = await p.evaluate(() => [...document.querySelectorAll('.seg')].map(s => { const c = getComputedStyle(s), pl = s.querySelector('.seg-pill'), pc = pl && getComputedStyle(pl); return { id: s.id || s.className, pad: [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].join(' '), r: c.borderTopLeftRadius, pr: pc ? pc.borderTopLeftRadius : null, pt: pc ? pc.top : null, pb: pc ? pc.bottom : null, bd: c.borderTopWidth }; }));
    const bad = all.filter(s => s.pad !== '2px 2px 2px 2px' || s.r !== '9px' || s.pr !== '7px' || s.pt !== '2px' || s.pb !== '2px' || s.bd !== '1px');
    ok(label + ': every segmented control has the 2px inset, a 9px corner and a 7px pill corner (' + all.length + ' of them)', all.length > 20 && !bad.length, JSON.stringify(bad.slice(0, 3)));
    const geo = await p.evaluate(() => [...document.querySelectorAll('.seg')].filter(s => s.offsetWidth).map(s => {
      const on = s.querySelector('label:has(input:checked)'), pl = s.querySelector('.seg-pill'); if (!on) return null;
      const pr = pl.getBoundingClientRect(), lr = on.getBoundingClientRect(), sr = s.getBoundingClientRect();
      return { id: s.id || s.className, dl: Math.abs(pr.left - lr.left), dw: Math.abs(pr.width - lr.width), inT: pr.top - sr.top, inB: sr.bottom - pr.bottom, op: pl.style.opacity, clip: [...s.querySelectorAll('label')].some(l => l.scrollWidth > l.clientWidth + 1) };
    }).filter(Boolean));
    const off = geo.filter(g => g.dl > 1 || g.dw > 1 || g.op !== '1' || g.inT < 2.5 || g.inB < 2.5);
    ok(label + ': the pill sits on the selected option, inside the inset (' + geo.length + ' visible)', geo.length >= 3 && !off.length, JSON.stringify(off.slice(0, 3)));
    if (width > 760) {
      const hs = await p.evaluate(() => { const h = e => e && Math.round(e.getBoundingClientRect().height * 10) / 10; return { view: h(document.querySelector('#aeView')), trim: h([...document.querySelectorAll('.ae-bar .btn')].find(b => /Trim silence/.test(b.textContent))) }; });
      ok(label + ': Wave | Spec is as tall as Trim silence beside it', hs.view && hs.view === hs.trim, JSON.stringify(hs));
    }
    ok(label + ': no label is cut off', !geo.some(g => g.clip), JSON.stringify(geo.filter(g => g.clip).map(g => g.id)));
    if (width < 600) {
      const over = [];
      for (const t of ['fades', 'eq', 'imager', 'level', 'noise', 'spec', 'emu']) {
        await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(500);
        over.push(...await p.evaluate(t => [...document.querySelectorAll('.seg')].filter(s => s.offsetWidth && s.scrollWidth > s.clientWidth + 1).map(s => t + ':' + (s.id || s.className) + ' ' + s.scrollWidth + '>' + s.clientWidth), t));
      }
      ok(label + ': no segmented control is wider than its box in any tool', !over.length, over.join(', '));
    }
    await p.close();
  }
  ok('No page errors', !errs.length, errs[0] || '');
  await b.close();
})();
