// Video: History records every output setting. Each change to a setting that alters the video makes one named step (a slider drag makes one); the playhead, zoom and
// panels make none. Undo and redo restore the setting and its control; Restore defaults and importing settings are each one step.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-history-settings.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
  const n = () => p.evaluate(K => window[K].S.history.length, K);
  const set = k => p.evaluate(([K, k]) => window[K].S.set[k], [K, k]);
  const names = async () => { await p.evaluate(() => { const l = document.querySelector('#mHist'); if (l.hidden) document.querySelector('#bHist').click(); }); const t = await p.evaluate(() => [...document.querySelectorAll('#mHistList .hs-n')].map(e => e.textContent)); await p.keyboard.press('Escape'); return t; };
  const undo = () => p.evaluate(() => document.querySelector('#bUndo').click()), redo = () => p.evaluate(() => document.querySelector('#bRedo').click());
  const wait = ms => p.waitForTimeout(ms);
  // a slider drag: press, several moves, release
  const drag = (id, vals) => p.evaluate(async ([id, vals]) => {
    const r = document.getElementById(id); r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const v of vals) { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(f => setTimeout(f, 20)); }
    r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, vals]);
  const click = (id) => p.evaluate(id => { const e = document.querySelector(id); e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); e.click(); e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, id);

  const h0 = await n();
  // the playhead, zoom and panels make no step
  await p.evaluate(K => { const w = window[K]; w.Transport.seek ? w.Transport.seek(w.S.vStart + 1) : (w.S.time = w.S.vStart + 1); }, K);
  await p.evaluate(() => document.querySelectorAll('.group > button, .grp-head').forEach(e => e.click())); await wait(300);
  ok('the playhead and panels make no step', (await n()) === h0, 'steps ' + (await n()));

  // a slider drag is one step, named for the setting
  const m0 = await set('margin');
  await drag('margin', [4, 5, 6, 7]); await wait(900);
  ok('a Margin drag is one step', (await n()) === h0 + 1 && (await set('margin')) === 7, 'steps ' + (await n()) + ', margin ' + (await set('margin')));
  ok('the step is named Margin', (await names()).includes('Margin'), JSON.stringify(await names()));
  await undo(); await wait(300);
  ok('Undo restores the margin and its slider', (await set('margin')) === m0 && (await p.evaluate(() => +document.querySelector('#margin').value)) === m0);
  await redo(); await wait(300);
  ok('Redo puts it back', (await set('margin')) === 7 && (await p.evaluate(() => +document.querySelector('#margin').value)) === 7);
  await undo(); await wait(300);

  // other settings: transition, aspect, invert, colors, fades
  await p.evaluate(() => { document.querySelector('#aspect').value = '4:3'; document.querySelector('#aspect').dispatchEvent(new Event('change', { bubbles: true })); }); await wait(900);
  ok('Aspect is one step, named Aspect', (await set('aspect')) === '4:3' && (await names()).includes('Aspect'), JSON.stringify(await names()));
  await undo(); await wait(300);
  ok('Undo restores Aspect and its control', (await set('aspect')) === '16:9' && (await p.evaluate(() => document.querySelector('#aspect').value)) === '16:9');
  await p.evaluate(() => { const r = document.querySelector('input[name=transition][value=slide]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(900);
  ok('Transition is one step, named Transition', (await set('transition')) === 'slide' && (await names()).includes('Transition'), JSON.stringify(await names()));
  await undo(); await wait(300);
  ok('Undo restores Transition and its control', (await set('transition')) === 'flip' && (await p.evaluate(() => document.querySelector('input[name=transition]:checked').value)) === 'flip');
  await p.evaluate(() => { const r = document.querySelector('input[name=fadeStyle][value=score]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await wait(900);
  ok('a Fades change is one step, named Fades', (await set('fadeStyle')) === 'score' && (await names()).includes('Fades'), JSON.stringify(await names()));
  await undo(); await wait(300);

  // two changes at once read "+ 1 more"
  await click('#invert'); await wait(900);
  const inv = await names();
  ok('Invert colors is one step; the colors it moves read "+ N more"', (await set('invert')) === true && /^Invert( \+ \d+ more)?$/.test(inv[0]), JSON.stringify(inv));
  await undo(); await wait(300);
  ok('Undo restores Invert and the colors it moved', (await set('invert')) === false && (await set('bg')) === '#000000' && (await p.evaluate(() => document.querySelector('#invert').checked)) === false);

  // the playhead moving between changes makes no step
  const before = await n();
  await p.evaluate(K => { const w = window[K]; w.S.time = w.S.vStart + 2; }, K); await wait(200);
  ok('moving the playhead adds nothing', (await n()) === before);

  // the 60-step limit
  for (let i = 0; i < 70; i++) { await p.evaluate(v => { const r = document.querySelector('#margin'); r.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, 1 + (i % 9)); await wait(15); }
  ok('settings steps keep the 60-step limit', (await n()) === 60, 'steps ' + (await n()));

  // Restore defaults is one step
  await p.evaluate(K => { window[K].S.history.length = 0; document.querySelector('#bUndo').disabled = false; }, K);
  await drag('margin', [8]); await wait(900);
  const a = await n();
  await p.evaluate(K => window[K].restoreDefaults(), K); await wait(500);
  ok('Restore defaults is one step', (await n()) === a + 1, 'steps ' + a + ' to ' + (await n()));
  await undo(); await wait(300);
  ok('Undo of Restore defaults brings the settings back', (await set('margin')) === 8);

  // importing settings is one step
  const file = JSON.stringify({ glisscore: 1, settings: { margin: 2, aspect: '1:1' } });
  const c = await n();
  await p.setInputFiles('#settingsIn', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(file) }).catch(() => {});
  await wait(1200);
  ok('importing settings is one step', (await set('aspect')) === '1:1' && (await n()) === c + 1, 'steps ' + c + ' to ' + (await n()) + ', aspect ' + (await set('aspect')));
  await undo(); await wait(300);
  ok('Undo of an import restores the settings', (await set('aspect')) === '16:9' && (await set('margin')) === 8);

  // Restore defaults with nothing to change adds no step and keeps Redo
  await p.evaluate(K => window[K].restoreDefaults(), K); await wait(400);
  await drag('margin', [6]); await wait(900); await undo(); await wait(300);
  const hasRedo = await p.evaluate(K => window[K].S.redo.length, K);
  ok('Undo leaves a step to redo', hasRedo === 1, String(hasRedo));
  await p.evaluate(K => window[K].restoreDefaults(), K); await wait(300);   // margin is already the default again after the undo, so nothing changes
  ok('Restore defaults that changes nothing keeps Redo', (await p.evaluate(K => window[K].S.redo.length, K)) === 1);
  // every setting has a name in History
  ok('every output setting has a History name', await p.evaluate(() => Object.keys(outSet()).every(k => HS_GROUPS.some(g => g[1].includes(k)))));
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
