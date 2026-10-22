// The page loads the app's script files in order with no errors: every script tag after audio-fx.js names a file that exists, starts in strict mode,
// and is in the upload list, the wording file loads first, and no app code is left inline. A misplaced file fails here, not in a person's browser.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/split-order.js
const { chromium } = require('playwright-core'), fs = require('fs'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const root = __dirname + '/../', STRICT = "'use strict';\n";
const page = fs.readFileSync(root + 'index.html', 'utf8');
// every script tag after audio-fx.js, in order: a file, or the inline script's text
const tags = []; const re = /<script( src="([^"]+)")?>([\s\S]*?)<\/script>/g; let m, on = false;
while ((m = re.exec(page))) { if (m[2] === 'audio-fx.js') { on = true; continue; } if (on) tags.push(m[2] ? { src: m[2] } : { inline: m[3].trim() }); }
ok('The app is script files only, with no code left inline', tags.length > 1 && tags.every(t => t.src), tags.length + ' tags');
ok('The wording file loads first', tags[0] && tags[0].src === 'js/messages.js', tags[0] && tags[0].src);
ok('Every file script starts with its own strict-mode line', tags.filter(t => t.src).every(t => fs.readFileSync(root + t.src, 'utf8').startsWith(STRICT)));
// the upload list, as deploy.sh builds it
const list = cp.execFileSync('zsh', ['-c', 'cd "' + root + '" && ' + fs.readFileSync(root + 'deploy.sh', 'utf8').split('\n').reduce((o, l) => o.done ? o : { t: o.t + l + '\n', done: /\)$/.test(l) && o.t.includes('FILES=(') }, { t: '' }).t + ' print -l $FILES'], { encoding: 'utf8' }).split('\n');
tags.filter(t => t.src).forEach(t => { ok('Script ' + t.src + ' exists and is in the upload list', fs.existsSync(root + t.src) && list.includes(t.src)); });
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); const errs = [];
  p.on('pageerror', e => errs.push('page: ' + e.message)); p.on('console', c => { if (c.type() === 'error') errs.push('console: ' + c.text()); });
  p.on('requestfailed', r => errs.push('failed: ' + r.url())); p.on('response', r => { if (r.status() >= 400) errs.push(r.status() + ': ' + r.url()); });
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.waitForTimeout(800);
  ok('The page loads with no errors and no failed requests', errs.length === 0, errs.join(' | '));
  ok('The wording is there for the app', await p.evaluate(() => typeof MSG === 'object' && MSG.text && Object.keys(MSG.text).length > 20 && typeof S === 'object'));
  await b.close();
})();
