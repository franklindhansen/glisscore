// Every icon the page names loads (200, an image type), /favicon.ico answers in the site root for browsers that ask on their own, and every one is in deploy.sh's upload list.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/site-icons.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), base = 'http://localhost:' + (process.env.PORT || 8123);
  const p = await b.newPage(), html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  await p.route(base + '/about', rt => rt.fulfill({ status: 200, contentType: 'text/html', body: html }));   // the live site's _redirects answers /about with the app; the test server does not
  for (const path of ['/index.html?disk=0', '/about']) {
    await p.goto(base + path);          // /about is answered with the app, so a relative icon path must still resolve from the site root
    const hrefs = await p.evaluate(() => [...document.querySelectorAll('link[rel="icon"],link[rel="apple-touch-icon"]')].map(l => l.getAttribute('href')));
    ok(path + ': the page names five icons', hrefs.length === 5, hrefs.join(', '));
    for (const h of hrefs) {
      const r = await p.request.get(base + '/' + h);
      ok(path + ': ' + h + ' loads as an image', r.status() === 200 && /image\//.test(r.headers()['content-type'] || ''), r.status() + ' ' + r.headers()['content-type']);
    }
  }
  const r = await p.request.get(base + '/favicon.ico');
  ok('/favicon.ico answers from the site root', r.status() === 200);
  const deploy = fs.readFileSync(__dirname + '/../deploy.sh', 'utf8');
  for (const h of ['favicon.ico', 'brand/apple-touch-icon.png', 'brand/favicon-dark.ico', 'brand/favicon-dark.svg', 'brand/favicon-light.svg'])
    ok(h + ' is in the upload list', deploy.includes(h) && fs.existsSync(__dirname + '/../' + h));
  await b.close();
})();
