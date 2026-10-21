// /about, /how-it-works and /support open the app with that dialog showing (/support opens About); closing returns to "/". _redirects ships with the deploy.
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
  const dlgs = ['#aboutDlg', '#howDlg'];
  for (const [path, id] of [['/about', '#aboutDlg'], ['/how-it-works', '#howDlg'], ['/support', '#aboutDlg']]) {
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
  for (const w of [1040, 700, 390]) for (const scheme of ['light', 'dark']) {
    const p = await open(w, '/support'); await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(200);
    const g = await p.evaluate(() => { const d = document.querySelector('#aboutDlg .dlg'), r = d.getBoundingClientRect(), a = [...d.querySelectorAll('a')], k = a.filter(x => x.href === 'https://ko-fi.com/franklindhansen');
      return { text: d.textContent, links: a.map(x => x.href), kofi: k.map(x => x.textContent), pageX: document.documentElement.scrollWidth - innerWidth, inside: [...d.querySelectorAll('a,button')].every(x => x.getBoundingClientRect().right <= r.right + 0.5 && x.getBoundingClientRect().left >= r.left - 0.5), fits: r.top >= -0.5 && r.bottom <= innerHeight + 0.5 || d.scrollHeight > d.clientHeight, over: d.scrollWidth - d.clientWidth }; });
    if (w === 1040 && scheme === 'light') {
      ok('About has the support sentences after View the source', g.text.indexOf('View the source') > -1 && g.text.indexOf('View the source') < g.text.indexOf('If it’s useful to you and you’d like to help cover hosting and upkeep, you can buy me a coffee on Ko-fi.') && g.text.includes('There’s no pressure: supporting unlocks nothing, and the app is the same for everyone.'), g.text.slice(0, 80));
      ok('About links to Ko-fi (only the words buy me a coffee on Ko-fi) and no sponsor page', g.kofi.length === 1 && g.kofi[0] === 'buy me a coffee on Ko-fi' && !g.links.some(l => /sponsors/.test(l)), g.kofi.join('|'));
      ok('no Support dialog or menu item remains', await p.evaluate(() => !document.querySelector('#supportDlg') && !document.querySelector('#menuSupport')));
    }
    ok(w + 'px ' + scheme + ': About fits, nothing sideways', g.pageX <= 0 && g.inside && g.over <= 0);
    await p.close();
  }
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '/index.html?disk=0'); await p.waitForTimeout(300);
  ok('a normal load shows no dialog', !(await Promise.all(dlgs.map(d => vis(p, d)))).some(Boolean));
  await p.close();
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
