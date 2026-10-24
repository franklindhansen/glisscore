// The glisscore wordmark starts over: with nothing loaded it reloads at once; with a score or audio loaded it asks first, and Cancel keeps the work.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/start-over-warning.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__mark = 1; });
  await p.click('.brand .home'); await p.waitForTimeout(900);
  ok('nothing loaded: starts over without asking', await p.evaluate(() => !window.__mark) && await p.evaluate(() => document.querySelector('#warnDlg').hidden));
  await p.waitForTimeout(500);
  await p.setInputFiles('#pdfIn', (process.env.S || 'tests/fixtures') + '/score.pdf'); await p.waitForFunction(K => window[K].S.pdf, K, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__mark = 1; });
  await p.click('.brand .home'); await p.waitForTimeout(400);
  const w = await p.evaluate(() => ({ hidden: document.querySelector('#warnDlg').hidden, title: document.querySelector('#warnTitle').textContent, yes: document.querySelector('#warnYes').textContent, no: document.querySelector('#warnNo').textContent }));
  ok('a score loaded: asks first', !w.hidden && w.title === 'Start over?' && w.yes === 'Start over' && w.no === 'Cancel', JSON.stringify(w));
  await p.click('#warnNo'); await p.waitForTimeout(900);
  ok('Cancel keeps the work', await p.evaluate(K => !!window.__mark && !!window[K].S.pdf, K));
  await p.click('.brand .home'); await p.waitForTimeout(400); await p.click('#warnYes'); await p.waitForTimeout(1200);
  ok('Start over reloads', await p.evaluate(() => !window.__mark));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
