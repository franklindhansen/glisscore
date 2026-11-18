// Toasts: no toast( or peToast( call passes a number; a short message stays --toast-ms, a longer one grows by --toast-word-ms a word up to --toast-long-ms, an error stays --toast-long-ms;
// both toast elements (the main one and the PDF Editor's) follow the same timing.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/toast-timing.js
const { chromium } = require('playwright-core'), fs = require('fs');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const bad = []; for (const f of fs.readdirSync('js').filter(n => n.endsWith('.js'))) fs.readFileSync('js/' + f, 'utf8').split('\n').forEach((l, i) => { const re = /\b(?:toast|peToast)\((?:[^()]|\([^()]*(?:\([^()]*\)[^()]*)*\))*,\s*(?:\d|TOAST_)/g; if (re.test(l)) bad.push(f + ':' + (i + 1)); });
  ok('no toast( or peToast( call passes a number', bad.length === 0, bad.join(' '));
  const b = await chromium.launch(), errs = []; const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.keep.length > 0); await p.waitForTimeout(800);
  const tk = await p.evaluate(() => { const cs = getComputedStyle(document.documentElement), g = n => parseFloat(cs.getPropertyValue(n)); return { ms: g('--toast-ms'), long: g('--toast-long-ms'), word: g('--toast-word-ms') }; });
  ok('the three tokens are 2800ms, 5000ms, and 120ms', tk.ms === 2800 && tk.long === 5000 && tk.word === 120, JSON.stringify(tk));
  const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' '), len = (n, k) => p.evaluate(([m, k]) => toastMs(m, k), [words(n), k]);
  ok('a short message stays --toast-ms', (await len(5)) === 2800 && (await len(8)) === 2800, '' + (await len(8)));
  ok('each word past a short message adds --toast-word-ms', (await len(18)) === 2800 + 10 * 120, '' + (await len(18)));
  ok('a long message is capped at --toast-long-ms', (await len(60)) === 5000, '' + (await len(60)));
  ok('an error stays --toast-long-ms, even when short', (await len(3, 'long')) === 5000);
  const timed = (fire, sel) => p.evaluate(async ([fire, sel]) => { const el = document.querySelector(sel); eval(fire); const t0 = performance.now(); while (el.classList.contains('show') && performance.now() - t0 < 9000) await new Promise(r => setTimeout(r, 20)); return performance.now() - t0; }, [fire, sel]);
  const t1 = await timed("toast('Saved.')", '#toast'); ok('the main toast really goes after --toast-ms', Math.abs(t1 - 2800) < 250, Math.round(t1) + 'ms');
  const t2 = await timed("toast('Saved.', 'long')", '#toast'); ok('the main toast for an error really goes after --toast-long-ms', Math.abs(t2 - 5000) < 250, Math.round(t2) + 'ms');
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1000);
  const t3 = await timed("peToast('Found two pages.')", '#peToast'); ok('the PDF Editor\'s toast follows the same timing', Math.abs(t3 - 2800) < 250, Math.round(t3) + 'ms');
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
