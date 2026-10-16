// Consistent waits: every moment of an Audio Editor export reads "Processing…" first, then "Processing N%", on the Export audio button and in the progress window. No "Preparing", "Exporting N%", "Measuring" or "Finishing".
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/waits-audio-export.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ';
    const p = await b.newPage({ viewport: { width: 1240, height: 900 } }); p.setDefaultTimeout(15000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => { window.saveFile = async () => { await new Promise(r => setTimeout(r, 600)); }; document.querySelector('[data-audio]').click(); }); await p.waitForTimeout(800);
    // record every text the two places show while the export runs
    await p.evaluate(() => {
      window.__seen = { btn: new Set(), msg: new Set() };
      const note = () => { window.__seen.btn.add(document.querySelector('#aeExport').textContent.trim()); window.__seen.msg.add(document.querySelector('#aeRunMsg').textContent.trim()); };
      new MutationObserver(note).observe(document.querySelector('#aeExport'), { childList: true, subtree: true, characterData: true });
      new MutationObserver(note).observe(document.querySelector('#aeRunMsg'), { childList: true, subtree: true, characterData: true });
    });
    await p.click('#aeExport'); await p.waitForTimeout(300); await p.click('#aeExpGo');
    await p.waitForFunction(() => !AE.exporting, null, { timeout: 15000 }); await p.waitForTimeout(300);
    const seen = await p.evaluate(() => ({ btn: [...window.__seen.btn], msg: [...window.__seen.msg] }));
    const wait = t => /^Processing(…|\.\.\.| \d+%)$/.test(t);          // the button's first moment draws its dots as three plain dots that move
    const strayMsg = seen.msg.filter(t => t && !wait(t) && !/^(The file is in your downloads\.|Nothing was saved\.)$/.test(t));
    const strayBtn = seen.btn.filter(t => t && !wait(t) && !/^Export audio$/.test(t));
    ok(tag + 'the progress window only ever says "Processing…" or "Processing N%"', strayMsg.length === 0 && seen.msg.some(wait), JSON.stringify(seen.msg));
    ok(tag + 'the Export audio button only ever says "Processing…" or "Processing N%" while it works', strayBtn.length === 0 && seen.btn.some(wait), JSON.stringify(seen.btn));
    ok(tag + 'the first moment reads "Processing…"', seen.msg.includes('Processing…'), JSON.stringify(seen.msg));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
