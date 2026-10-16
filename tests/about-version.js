// About shows "Version x.y.z" read from the VERSION file (no second place to edit), small, inside the dialog, nothing scrolling.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/about-version.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const open = async p => { await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.evaluate(() => document.querySelector('#menuAbout').click()); await p.waitForTimeout(500); };
const read = p => p.evaluate(() => { const o = document.querySelector('#aboutDlg'), d = o.querySelector('.dlg'), v = o.querySelector('#aboutVersion');
  return { text: v ? v.textContent.trim() : null, vis: !!v && v.getBoundingClientRect().height > 0, size: v ? parseFloat(getComputedStyle(v).fontSize) : 0,
    inside: !!v && v.getBoundingClientRect().right <= d.getBoundingClientRect().right + 0.5, ov: o.scrollHeight - o.clientHeight, dlg: d.scrollHeight - d.clientHeight }; });
(async () => {
  const b = await chromium.launch(), errs = [];
  const file = fs.readFileSync(__dirname + '/../VERSION', 'utf8').trim();
  ok('VERSION holds a major.minor.patch number', /^\d+\.\d+\.\d+$/.test(file), file);
  let p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(e.message));
  await open(p); let r = await read(p);
  ok('About shows the number from VERSION', r.text === 'Version ' + file, r.text);
  ok('the line is small and inside the dialog, nothing scrolls at 1280x720', r.vis && r.size <= 13 && r.inside && r.ov <= 0 && r.dlg <= 0, JSON.stringify(r));
  await p.close();
  p = await b.newPage({ viewport: { width: 1280, height: 720 } }); p.on('pageerror', e => errs.push(e.message));
  await p.route('**/VERSION*', rt => rt.fulfill({ status: 200, contentType: 'text/plain', body: '9.8.7\n' }));
  await open(p); r = await read(p);
  ok('changing VERSION changes About', r.text === 'Version 9.8.7', r.text);
  await p.close();
  p = await b.newPage({ viewport: { width: 390, height: 800 } }); p.on('pageerror', e => errs.push(e.message));
  await open(p); r = await read(p);
  ok('phone width: the line stays inside the dialog, no sideways scroll', r.inside && (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, JSON.stringify(r));
  await p.close();
  for (const [w, h] of [[1440, 900], [1280, 720], [1040, 700], [700, 900], [390, 800], [320, 568]]) {
    p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', e => errs.push(e.message));
    await open(p);
    const g = await p.evaluate(() => { const q = s => document.querySelector(s).getBoundingClientRect(), d = q('#aboutDlg .dlg'), v = q('#aboutVersion'), l = q('#aboutDlg .row .fine'), last = [...document.querySelectorAll('#aboutDlg .dlg>p')].filter(x => x.id !== 'aboutVersion').pop().getBoundingClientRect();
      return { above: Math.round(v.top - last.bottom), below: Math.round(l.top - v.bottom), left: Math.round(v.left - l.left), inside: v.left >= d.left && v.right <= d.right && l.right <= d.right + 0.5, pageX: document.documentElement.scrollWidth - innerWidth, dlgScroll: document.querySelector('#aboutDlg .dlg').scrollHeight - document.querySelector('#aboutDlg .dlg').clientHeight }; });
    ok(w + 'x' + h + ': the version sits close above the links (gap above it at least the paragraph gap, below it about 8px), aligned, inside, nothing scrolls',
      g.above >= 14 && g.below >= 4 && g.below <= 10 && Math.abs(g.left) <= 1 && g.inside && g.pageX <= 0 && g.dlgScroll <= 0, JSON.stringify(g));
    if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/about-' + w + 'x' + h + '.png' });
    await p.close();
  }
  const cl = fs.readFileSync(__dirname + '/../CHANGELOG.md', 'utf8');
  ok('CHANGELOG.md has an entry for the current version', new RegExp('^.*' + file.replace(/\./g, '\\.') + '.*$', 'm').test(cl));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
