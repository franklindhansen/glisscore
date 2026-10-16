// Consistent waits: the video editor's waits (the export's loudness reading, sound preparing, rendering and finishing, and the credits font box) use the one word, "Processing", and never show Preparing, Measuring, Rendering, Finishing, Loading or Finding.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/waits-video-editor.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => { window.__msgs = new Set(); const el = document.querySelector('#expMsg'); new MutationObserver(() => window.__msgs.add(el.textContent.trim())).observe(el, { childList: true, subtree: true, characterData: true }); });
  // the export, with a loudness target so the reading shows too
  await p.evaluate(() => { S.set.normalize = true; S.set.normBy = 'loud'; startExport(); });
  await p.waitForFunction(() => !EXP.running, null, { timeout: 60000 }); await p.waitForTimeout(300);
  const m = await p.evaluate(() => [...window.__msgs].filter(Boolean)), waits = m.filter(t => /^Processing/.test(t));
  ok('the video export never says Preparing, Measuring, Rendering, Finishing, Loading or Finding', !m.some(t => /\b(Preparing|Measuring|Rendering|Finishing|Loading|Finding)\b/.test(t)), JSON.stringify(m));
  ok('the video export waits say "Processing" or "Processing N%"', waits.length > 0 && waits.every(t => /^Processing( \d+%)?( · about \d+s left)?$|^Processing…$/.test(t)), JSON.stringify(m));
  // the credits font box says it is working in the same word
  const f = await p.evaluate(async () => { const i = document.querySelector('#credFont'), s = document.querySelector('#credFontMsg'); window.resolveGoogleFont = () => new Promise(() => {}); i.value = 'Some Font'; i.dispatchEvent(new Event('input', { bubbles: true })); await sleep(900); return s.textContent; });
  ok('the font box says "Processing…" while it looks the font up', /^Processing…?$/.test(f), JSON.stringify(f));
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
