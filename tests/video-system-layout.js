// Video: the System choice in Page layout. It sits after Single page, is one History step, folds away First page alone and the center fold shading,
// keeps their saved choices for Spread, and comes back through settings export and import. Spread and Single page are checked in video-single-page.js.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-system-layout.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
  const S = (f, arg) => p.evaluate(([K, f, arg]) => { const s = window[K].S; return eval('(' + f + ')')(s, arg); }, [K, String(f), arg]);
  const pick = v => p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const settle = () => p.waitForTimeout(700);
  const hidden = sel => p.evaluate(sel => document.querySelector(sel).hidden || !document.querySelector(sel).offsetParent || document.querySelector(sel).getBoundingClientRect().height < 2, sel);

  ok('the choice reads Spread, Single page, System', await p.evaluate(() => [...document.querySelectorAll('input[name=pageLayout]')].map(r => r.parentElement.textContent.trim()).join('|')) === 'Spread|Single page|System');
  const before = await S(s => ({ turns: s.turns.length, hist: s.history.length }));
  await pick('system'); await settle();
  const sy = await S(s => ({ set: s.set.pageLayout, spreads: s.spreads.map(x => x.join(',')), turns: s.turns.length, hist: s.history.length, n: s.pdf.keep.length }));
  ok('System is chosen and saved', sy.set === 'system' && await p.evaluate(() => document.querySelector('input[name=pageLayout][value=system]').checked));
  ok('it is one History step', sy.hist === before.hist + 1, JSON.stringify([before.hist, sy.hist]));
  ok('one entry per page for now, and the turns follow', sy.spreads.length === sy.n && sy.turns === sy.n - 1, JSON.stringify(sy));
  ok('First page alone folds away', await hidden('#firstAloneField'));
  ok('the center fold shading folds away', await hidden('#centerFold'));
  ok('the counter reads "System 1 / 3"', await p.evaluate(() => document.querySelector('#spreadNow').textContent) === 'System 1 / 3');

  await p.evaluate(() => document.querySelector('#bUndo').click()); await settle();
  ok('one undo returns to Spread', await S(s => s.set.pageLayout) === 'spread');
  ok('First page alone is back with its saved choice', !(await hidden('#firstAloneField')) && await S(s => s.set.firstAlone) === true);

  await pick('system'); await settle();
  ok('the choice is written by settings export and accepted by import', await p.evaluate(() => buildExport('settings').includes('"pageLayout": "system"') || buildExport('settings').includes('"pageLayout":"system"')) && await p.evaluate(() => IO_CHOICES.pageLayout.includes('system')));
  await pick('single'); await settle();
  ok('switching System to Single page keeps one entry per page', await S(s => s.spreads.length === s.pdf.keep.length && s.set.pageLayout === 'single'));
  await pick('spread'); await settle();
  ok('Spread is unchanged: two spreads', (await S(s => s.spreads.map(x => x.join(',')))).join('|') === '-1,0|1,2');
  ok('the three choices fit the panel on one row', await p.evaluate(() => { const g = document.querySelector('#pagesField .seg'), l = [...g.querySelectorAll('label')].map(x => x.getBoundingClientRect()); return g.scrollWidth <= g.clientWidth + 1 && l.every(r => r.height === l[0].height && r.top === l[0].top); }));
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
