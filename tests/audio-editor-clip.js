// The Clip pill, True peak, and the Level badge follow the level settings at once, in memory and on the disk store. Clipping is said by the pill, the True peak number, and the red Gain number (no note under the meter).
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-clip.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ';
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(15000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    await p.evaluate(() => { document.querySelector('.ae-tool[data-tool=level]').click(); const g = document.querySelector('#aeGain'); g.value = 12; g.dispatchEvent(new Event('input', { bubbles: true })); g.dispatchEvent(new Event('change', { bubbles: true })); });
    const st = () => p.evaluate(() => ({ clip: document.querySelector('#aeClip').classList.contains('on'), gainRed: document.querySelector('#aeGainBig').classList.contains('clip'), noNote: !document.querySelector('#aeClipNote') && !document.querySelector('#aeLoudPk'), badge: document.querySelector('#aeLvBadge').textContent, hold: document.querySelector('#aePeakNow').textContent }));
    await p.click('#aePlay'); await p.waitForTimeout(1200); const a = await st();
    ok(tag + 'gain +12 clips: the Clip pill shows, the Gain number is red, True peak is above zero, badge says +12dB', a.clip && a.gainRed && /^\+/.test(a.hold) && a.badge === '+12dB', JSON.stringify(a));
    ok(tag + 'there is no clip note or Loudness peak line any more', a.noNote);
    await p.evaluate(() => { const r = document.querySelector('input[name=aeNormMode][value=loud]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); { const end = Date.now() + 15000; let good = 0; while (good < 4 && Date.now() < end) { const x = await st(); good = !x.clip && x.badge === '−14.0LUFS' && /^−/.test(x.hold) ? good + 1 : 0; await p.waitForTimeout(150); } }   // sound already queued at the old gain can light the pill again for a moment, so wait until the new state has held for a few reads
    const c = await st(); ok(tag + 'Loudness with the limiter: the pill clears while it plays, the badge shows the target (not "Auto")', !c.clip && c.badge === '−14.0LUFS', JSON.stringify(c));
    ok(tag + 'the held peak starts again with the new level', /^−/.test(c.hold), c.hold);
    await p.evaluate(() => { const r = document.querySelector('input[name=aeNormMode][value=peak]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(700);
    ok(tag + 'Peak shows its ceiling in the badge', /dB$/.test((await st()).badge), (await st()).badge);
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
