// Background and Ink color are one field each (swatch, name, hex, chevron) that opens a menu of named colors and a picker.
// A listed color shows its name; the picker or a typed hex shows Custom, and the swatch and hex follow; a saved color that is not listed reopens as Custom; the keyboard opens, walks, picks, and closes.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-color-select.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const FX = process.env.S || 'tests/fixtures';
const load = async p => { await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.setInputFiles('#audioIn', FX + '/loud.mp3'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(1200); };
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const read = (p, k) => p.evaluate(key => { const r = document.querySelector('#' + key + 'Sel'); return { name: r.querySelector('.csel-name').textContent, hex: r.querySelector('.csel-hex').value, sw: getComputedStyle(r.querySelector('.csel-sw')).backgroundColor, set: S.set[key], open: !r.querySelector('.csel-menu').hidden }; }, k);
const rgb = h => { const n = parseInt(h.slice(1), 16); return 'rgb(' + [n >> 16, (n >> 8) & 255, n & 255].join(', ') + ')'; };
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const dark of [false, true]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 1400 }, colorScheme: dark ? 'dark' : 'light' }); p.on('pageerror', e => errs.push(e.message));
    await load(p);
    await p.evaluate(() => { const i = document.querySelector('#invert'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(500);
    const tag = dark ? ' (dark)' : '';
    ok('the old menu and the separate swatch and hex row are gone' + tag, !(await p.$('#bgPreset, #inkPreset, #bgColor, #inkColor, .colorrow')));
    for (const [key, listed] of [['bg', ['Black', '#000000']], ['ink', ['White', '#ffffff']]]) {
      const open = '#' + key + 'Open', area = '#' + key + 'Sel .csel-area', hue = '#' + key + 'Sel .csel-hue', hex = '#' + key + 'Hex';
      await p.click(open); await p.waitForTimeout(250);
      await p.click('#' + key + 'Sel li[data-v="' + listed[1].toUpperCase() + '"]'); await p.waitForTimeout(150);
      let s = await read(p, key); ok(key + ': a listed color shows its name, hex, and swatch' + tag, s.name === listed[0] && s.hex === listed[1] && s.sw === rgb(listed[1]) && s.set === listed[1] && !s.open, JSON.stringify(s));
      await p.click(open); await p.waitForTimeout(250);
      const r = await p.locator(area).boundingBox(); await p.mouse.click(r.x + r.width * 0.5, r.y + r.height * 0.4); await p.waitForTimeout(150);
      s = await read(p, key); ok(key + ': the picker turns the name to Custom, and the hex, swatch, and the video follow' + tag, s.name === 'Custom' && /^#[0-9a-f]{6}$/.test(s.hex) && s.hex === s.set && s.sw === rgb(s.set), JSON.stringify(s));
      const before = s.set, hr = await p.locator(hue).boundingBox(); await p.mouse.click(hr.x + hr.width * 0.6, hr.y + hr.height / 2); await p.waitForTimeout(150);
      s = await read(p, key); ok(key + ': the hue strip changes the color' + tag, s.set !== before && s.name === 'Custom', before + ' to ' + s.set);
      await p.click(hex, { clickCount: 3 }); await p.keyboard.type('#123456'); await p.waitForTimeout(150);
      s = await read(p, key); ok(key + ': a typed hex is used and reads Custom' + tag, s.set === '#123456' && s.name === 'Custom' && s.sw === rgb('#123456'), JSON.stringify(s));
      await p.click(hex, { clickCount: 3 }); await p.keyboard.type(listed[1]); await p.waitForTimeout(150);
      s = await read(p, key); ok(key + ': a typed hex that is on the list shows its name' + tag, s.name === listed[0], JSON.stringify(s));
      await p.evaluate(k => { document.activeElement.blur(); S.set[k] = '#abcdef'; syncControls(); }, key); s = await read(p, key);
      ok(key + ': a saved color that is not listed reopens as Custom with its hex' + tag, s.name === 'Custom' && s.hex === '#abcdef' && s.sw === rgb('#abcdef'), JSON.stringify(s));
      await p.focus(open); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(250);
      s = await read(p, key); const first = await p.evaluate(() => document.activeElement.dataset.v);
      await p.keyboard.press('ArrowDown'); const second = await p.evaluate(() => document.activeElement.dataset.v);
      ok(key + ': ArrowDown opens the menu and walks the colors' + tag, s.open && first && second && first !== second, first + ' then ' + second);
      await p.keyboard.press('Enter'); await p.waitForTimeout(150); s = await read(p, key);
      ok(key + ': Enter picks the focused color and closes' + tag, !s.open && s.set === second.toLowerCase() && (await p.evaluate(() => document.activeElement.id)) === key + 'Open', JSON.stringify(s));
      await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.waitForTimeout(150); s = await read(p, key);
      ok(key + ': Escape closes the menu' + tag, !s.open);
    }
    await p.close();
  }
  { const p = await b.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); await load(p);
    await p.click('#bgOpen'); await p.waitForTimeout(100); const d = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#bgSel .csel-menu')).animationDuration));
    ok('reduced motion: the menu opens without a glide', d <= 0.01, d + 's'); await p.close(); }
  ok('No page errors', !errs.length, errs[0] || '');
  await b.close();
})();
