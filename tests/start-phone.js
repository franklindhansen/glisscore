// On a phone, with audio loaded, the Score video card's icon and name sit on the same lines as the audio card's and its button sits directly under its name; the desktop start screen is unchanged (the button stays at the bottom of the card).
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/start-phone.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0', FX = process.env.S || 'tests/fixtures';
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [w, h, phone] of [[390, 844, true], [1280, 800, false]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.setInputFiles('#audioIn', FX + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(1500);
    const m = await p.evaluate(() => { const r = e => e.getBoundingClientRect(), s = document.querySelector('#scScore'), a = document.querySelector('#scAudio'); return { ic: [r(s.querySelector('.sc-ic')).top, r(a.querySelector('.sc-ic')).top], h3: [r(s.querySelector('h3')).top, r(a.querySelector('h3')).top], btnGap: r(s.querySelector('.row')).top - r(s.querySelector('h3')).bottom, audioGap: r(a.querySelector('.row')).top - r(a.querySelector('h3')).bottom, bottom: r(s).bottom - r(s.querySelector('.row')).bottom }; });
    if (phone) { ok('phone: the icons and names share their lines', Math.abs(m.ic[0] - m.ic[1]) <= 1 && Math.abs(m.h3[0] - m.h3[1]) <= 1, JSON.stringify(m)); ok('phone: the Score video button sits directly under its name, as the audio card\'s does', Math.abs(m.btnGap - m.audioGap) <= 1, JSON.stringify(m)); }
    else ok('desktop: the Score video button stays at the bottom of its card', m.btnGap > m.audioGap + 4 || m.bottom <= 24, JSON.stringify(m));
    await p.close();
  }
  ok('no page errors', !errs.length, errs[0] || ''); await b.close();
})();
