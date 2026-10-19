// /about, /how-it-works and /support open the app with that dialog showing; closing returns to "/". Support is also in the Settings menu; _redirects ships with the deploy.
// The static server here has no rewrite, so the check plays the part of the _redirects file: the three paths answer with index.html.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/site-pages.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const base = 'http://localhost:' + (process.env.PORT || 8123);
const root = __dirname + '/../';
(async () => {
  const red = fs.readFileSync(root + '_redirects', 'utf8'), dep = fs.readFileSync(root + 'deploy.sh', 'utf8'), html = fs.readFileSync(root + 'index.html', 'utf8');
  for (const path of ['/about', '/how-it-works', '/support']) ok('_redirects rewrites ' + path + ' to /', new RegExp('^' + path + '\\s+/\\s+200\\s*$', 'm').test(red));
  ok('deploy.sh lists _redirects and checks it live', /FILES=\([^)]*_redirects/.test(dep.replace(/\n\s+/g, ' ')));
  const b = await chromium.launch(), errs = [];
  const open = async (w, path) => {
    const p = await b.newPage({ viewport: { width: w, height: 800 } }); p.on('pageerror', e => errs.push(e.message));
    await p.route(base + path, rt => rt.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await p.route(base + path + '?*', rt => rt.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await p.goto(base + path); await p.waitForTimeout(600); return p;
  };
  const vis = (p, id) => p.evaluate(id => { const e = document.querySelector(id); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, id);
  const dlgs = ['#aboutDlg', '#howDlg', '#supportDlg'];
  for (const [path, id] of [['/about', '#aboutDlg'], ['/how-it-works', '#howDlg'], ['/support', '#supportDlg']]) {
    for (const how of ['button', 'backdrop', 'escape']) {
      const p = await open(1280, path);
      const shown = await Promise.all(dlgs.map(d => vis(p, d)));
      ok(path + ': only ' + id + ' is showing', dlgs.every((d, i) => shown[i] === (d === id)), shown.join());
      if (how === 'button') await p.click(id + ' .btn.primary'); else if (how === 'backdrop') await p.mouse.click(5, 5); else await p.keyboard.press('Escape');
      await p.waitForTimeout(500);
      ok(path + ' closed by ' + how + ': the app shows and the address is /', !(await vis(p, id)) && new URL(p.url()).pathname === '/', p.url());
      await p.close();
    }
  }
  let p = await open(390, '/support');
  const g = await p.evaluate(() => { const d = document.querySelector('#supportDlg .dlg'), a = [...d.querySelectorAll('a')].map(x => x.href);
    return { text: d.textContent, links: a, pageX: document.documentElement.scrollWidth - innerWidth, inside: [...d.querySelectorAll('a,button')].every(x => x.getBoundingClientRect().right <= d.getBoundingClientRect().right + 0.5) }; });
  ok('Support has the agreed words', g.text.includes('glisscore is free, open source, and made by one person (a composer who should probably be writing music).') && g.text.includes('There’s no pressure: supporting unlocks nothing, and the app is the same for everyone.') && g.text.includes('If this site fits your needs, my music might too.'), g.text.slice(0, 80));
  ok('Support links to Ko-fi and no one else’s sponsor page', g.links.includes('https://ko-fi.com/franklindhansen') && !g.links.some(l => /sponsors/.test(l)), g.links.join(' '));
  ok('phone width: Support fits, nothing sideways', g.pageX <= 0 && g.inside);
  await p.close();
  p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/index.html?disk=0'); await p.waitForTimeout(300);
  ok('a normal load shows no dialog', !(await Promise.all(dlgs.map(d => vis(p, d)))).some(Boolean));
  await p.evaluate(() => document.querySelector('#btnSettings').click()); await p.evaluate(() => document.querySelector('#menuSupport').click()); await p.waitForTimeout(400);
  ok('Settings → Support opens Support', await vis(p, '#supportDlg'));
  await p.close();
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
