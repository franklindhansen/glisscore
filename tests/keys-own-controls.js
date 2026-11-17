// Keys: Space plays and pauses and the arrows move the playhead, except on a control the person is using (a button, switch, or choice reached with the keyboard keeps its Space; a slider or choice keeps the arrows). A mouse-clicked button does not keep Space. Same in the Audio Editor. Crop in Manual opens a page when you come back to it.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/keys-own-controls.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), errs = [], K = '__keyframes';
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(30000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); const F = process.env.S || 'tests/fixtures';
  await p.setInputFiles('#pdfIn', F + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n >= 2); await p.setInputFiles('#audioIn', F + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(800);
  const st = () => p.evaluate(K => ({ pl: window[K].Transport.playing, t: window[K].S.time, h: window[K].S.history.length }), K);
  const stop = () => p.evaluate(K => { window[K].Transport.pause(); window[K].Transport.seek(0); }, K);
  // a mouse click on a button, then Space: the button has no focus ring, so Space plays
  await p.click('#bTap'); await p.waitForTimeout(100); await p.evaluate(K => window[K].Transport.seek(0), K);
  await p.keyboard.press('Space'); await p.waitForTimeout(200); let s = await st(); ok('after clicking a button with the mouse, Space plays', s.pl, JSON.stringify(s)); await p.keyboard.press('Space'); await p.waitForTimeout(100); await stop();
  // Tab to a button: Space presses it, and does not play
  await p.evaluate(() => document.activeElement.blur()); await p.focus('#bTap'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');          // reached with the keyboard
  const h0 = (await st()).h; await p.keyboard.press('Space'); await p.waitForTimeout(250); s = await st();
  ok('Space on a button reached with the keyboard presses it and does not play', !s.pl && s.h > h0, JSON.stringify({ pl: s.pl, h0, h: s.h }));
  // a switch reached with the keyboard toggles with Space
  await p.focus('#firstAlone'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); const sw0 = await p.evaluate(() => document.querySelector('#firstAlone').checked); await p.keyboard.press('Space'); await p.waitForTimeout(150);
  ok('Space on a switch reached with the keyboard flips it and does not play', (await p.evaluate(() => document.querySelector('#firstAlone').checked)) !== sw0 && !(await st()).pl);
  // arrows on a slider and a choice keep their own job
  await p.locator('#fadeLen').scrollIntoViewIfNeeded(); await p.focus('#fadeLen'); await stop(); const v0 = await p.evaluate(() => +document.querySelector('#fadeLen').value); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100);
  const v1 = await p.evaluate(() => +document.querySelector('#fadeLen').value); s = await st(); ok('an arrow on a slider moves the slider, not the playhead', v1 !== v0 && s.t === 0, JSON.stringify({ v0, v1, t: s.t }));
  await p.focus('input[name=transition][value=flip]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100); s = await st();
  ok('an arrow on a choice moves the choice, not the playhead', (await p.evaluate(() => document.querySelector('input[name=transition]:checked').value)) === 'slide' && s.t === 0);
  await p.evaluate(() => { document.querySelector('input[name=transition][value=flip]').click(); document.activeElement.blur(); });
  await p.mouse.click(600, 300); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(100); s = await st(); ok('with nothing focused, the arrow still moves the playhead', s.t > 0, JSON.stringify(s));
  await stop();
  // the Audio Editor
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(800);
  const ae = () => p.evaluate(() => ({ pl: !!AE.playing, f: !!document.querySelector('#audioDlg').matches(':focus-within') }));
  await p.click('#aeFull'); await p.waitForTimeout(500); await p.click('#aeFull'); await p.waitForTimeout(500);          // a mouse click, then Space
  await p.keyboard.press('Space'); await p.waitForTimeout(250); ok('Audio Editor: after a mouse click, Space plays', (await ae()).pl); await p.keyboard.press('Space'); await p.waitForTimeout(150);
  await p.evaluate(() => document.activeElement.blur()); await p.focus('#aeSilence'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Space'); await p.waitForTimeout(250);
  ok('Audio Editor: Space on a button reached with the keyboard presses it and does not play', !(await ae()).pl);
  await p.evaluate(() => closeAudioEditor()); await p.waitForTimeout(400);
  // a color list's item takes Space and Enter to choose it, and neither plays nor jumps
  for (const key of ['Space', 'Enter']) { await p.evaluate(K => { window[K].Transport.pause(); window[K].Transport.seek(1); }, K); await p.focus('#bgSel .csel-open'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
    const was = await p.evaluate(() => S.set.bg || S.set.background); await p.keyboard.press(key === 'Space' ? 'Space' : 'Enter'); await p.waitForTimeout(250); s = await st();
    ok(key + ' on a color in the list chooses it and does not play or jump', (await p.evaluate(() => S.set.bg || S.set.background)) !== was && !s.pl && s.t === 1, JSON.stringify(s)); }
  // PDF Editor: Crop in Manual opens a page again when you come back to it
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800); await p.evaluate(() => peTool('crop')); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('input[name=peCropMode][value=hand]').click()); await p.waitForTimeout(200);
  const one1 = await p.evaluate(() => PE.one); await p.evaluate(() => peTool('pages')); await p.waitForTimeout(200); await p.evaluate(() => peTool('crop')); await p.waitForTimeout(300);
  const one2 = await p.evaluate(() => PE.one); ok('Crop in Manual opens a page when you come back to it', one1 != null && one2 != null, JSON.stringify({ one1, one2 }));
  await p.evaluate(() => document.querySelector('input[name=peCropMode][value=auto]').click()); await p.waitForTimeout(200);
  ok('Auto closes that page again', (await p.evaluate(() => PE.one)) == null);
  await p.evaluate(() => peTool('pages')); await p.waitForTimeout(150); await p.evaluate(() => peTool('crop')); await p.waitForTimeout(300);
  ok('and Crop in Auto opens no page', (await p.evaluate(() => PE.one)) == null);
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
