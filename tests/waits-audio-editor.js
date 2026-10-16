// Consistent waits: the Audio Editor's own waits (the Emulator's reading and Emulate button, the noise tool's Auto, Level's loudness reading) all use the one word, "Processing", with "Processing N%" once there is a number, and never show Preparing, Measuring, Working out, Loading or Finding.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/waits-audio-editor.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const STRAY = '/\\b(Preparing|Measuring|Working out|Loading|Finding|Finishing)\\b/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ';
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    // every change on the page is scanned: any text with a stray word, and any text that is a wait, is noted
    await p.evaluate(stray => {
      const bad = new RegExp(stray.slice(1, -1)); window.__stray = new Set(); window.__waits = new Set();
      const scan = () => { for (const el of document.querySelectorAll('#aePaneNoise *, #aePaneLevel *, #aePaneEmu *, .ae-state, .ae-proc *')) { if (el.children.length || !el.offsetParent) continue; const t = el.textContent.trim(); if (bad.test(t)) window.__stray.add(t); if (/^Processing/.test(t)) window.__waits.add(t); } };
      new MutationObserver(scan).observe(document.body, { childList: true, subtree: true, characterData: true }); window.__scan = scan;
    }, STRAY);
    // the Emulator: reading a reference, then Emulate
    await p.evaluate(() => aeTool('emu')); await p.waitForTimeout(500);
    await p.setInputFiles('#aeEmIn', FX + '/s24.wav'); await p.waitForFunction(() => AE.em && AE.em.ref && AE.em.own && !AE.em.busyOwn && !AE.em.busy); await p.waitForTimeout(300);
    await p.evaluate(async () => { document.querySelector('#aeEmGo').click(); for (let i = 0; i < 400 && !emLive(); i++) await sleep(25); });
    // the noise tool's Auto
    await p.evaluate(async () => { aeTool('noise'); await sleep(300); document.querySelector('#aeNrFind').click(); for (let i = 0; i < 400 && AE.nrAutoBusy; i++) await sleep(25); await sleep(150); });
    // Level's loudness reading
    await p.evaluate(async () => { aeTool('level'); await sleep(300); const d = AE.d; d.normalize = true; d.normBy = 'loud'; aeRefresh && aeRefresh(); await sleep(600); });
    const r = await p.evaluate(() => ({ stray: [...window.__stray], waits: [...window.__waits] }));
    ok(tag + 'no "Preparing", "Measuring", "Working out", "Loading", "Finding" or "Finishing" in the Audio Editor\'s waits', r.stray.length === 0, JSON.stringify(r.stray));
    ok(tag + 'the waits that were seen say "Processing"', r.waits.length > 0 && r.waits.every(t => /^Processing( [^%]*…| \d+%|…|\.\.\.)( \d+%)?$/.test(t)), JSON.stringify(r.waits));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
