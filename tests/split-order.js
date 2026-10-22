// The app's script files, in the order the page loads them, must be exactly the old single script (tests/split-baseline/app-script.js),
// apart from the wording block moved to the front and one 'use strict'; first line per file. The page must load with no errors and every
// script it names must exist and be in the upload list.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/split-order.js
const { chromium } = require('playwright-core'), fs = require('fs'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const root = __dirname + '/../', STRICT = "'use strict';\n";
const page = fs.readFileSync(root + 'index.html', 'utf8'), baseline = fs.readFileSync(root + 'tests/split-baseline/app-script.js', 'utf8');
const strip = t => t.startsWith(STRICT) ? t.slice(STRICT.length) : t;
// every script tag after audio-fx.js, in order: a file, or the inline script's text
const tags = []; const re = /<script( src="([^"]+)")?>([\s\S]*?)<\/script>/g; let m, on = false;
while ((m = re.exec(page))) { if (m[2] === 'audio-fx.js') { on = true; continue; } if (on) tags.push(m[2] ? { src: m[2] } : { inline: m[3].replace(/^\n/, '') }); }
const parts = tags.map(t => t.src ? fs.readFileSync(root + t.src, 'utf8') : t.inline);
const joined = parts.map(strip).join('');
const a = baseline.indexOf('/* MESSAGES:BEGIN'), b = baseline.indexOf('/* MESSAGES:END */\n') + '/* MESSAGES:END */\n'.length;
const expected = strip(baseline.slice(a, b) + baseline.slice(0, a) + baseline.slice(b));
const wordsFirst = baseline.slice(a, b) + strip(baseline.slice(0, a) + baseline.slice(b));
const same = joined === wordsFirst;
let at = -1; if (!same) { at = 0; while (at < joined.length && joined[at] === wordsFirst[at]) at++; }
ok('The script files, in load order, are the old script with the wording block first', same, same ? parts.length + ' scripts' : 'first difference at character ' + at + ': ' + JSON.stringify(joined.slice(at, at + 60)) + ' vs ' + JSON.stringify(wordsFirst.slice(at, at + 60)));
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
