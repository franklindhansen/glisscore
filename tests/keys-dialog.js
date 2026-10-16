// Keyboard shortcuts dialog: five groups (Playback, Timeline, Editing, Audio Editor, Display), each row's wording and keys as written in the spec,
// every key on its own key cap, Command/Option as symbols on a Mac and Ctrl/Alt elsewhere; no page errors.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/keys-dialog.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const WANT = [
  ['Playback', [['Play / pause', 'Space'], ['Jump to start', 'Enter'], ['Jump 1s', '← →'], ['Jump 5s', 'Shift ← →'], ['Previous / next marker', 'Alt ← →'], ['Add page turn', 'T']]],
  ['Timeline', [['Zoom in / out', 'Mod + −'], ['Fit', 'Mod 0']]],
  ['Editing', [['Undo', 'Mod Z'], ['Redo', 'Shift Mod Z']]],
  ['Audio Editor', [['Bypass', 'B'], ['Hide tools', 'T']]],
  ['Display', [['Full screen', 'F'], ['Exit full screen', 'Esc']]],
];
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const platform of ['MacIntel', 'Win32']) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(pl => Object.defineProperty(navigator, 'platform', { get: () => pl }), platform);
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
    await p.evaluate(() => document.querySelector('#menuKeys').click()); await p.waitForTimeout(400);
    const got = await p.evaluate(() => [...document.querySelectorAll('#keysList section')].map(s => [s.querySelector('h3').textContent.trim(),
      [...s.querySelectorAll('dt')].map(dt => [dt.textContent.trim(), [...dt.nextElementSibling.querySelectorAll('kbd')].map(k => k.textContent.trim())])]));
    const mac = platform === 'MacIntel', norm = k => k === '⌘' || k === 'Ctrl' ? 'Mod' : k === 'Option' || k === 'Alt' ? 'Alt' : k;
    const flat = got.map(([h, rows]) => [h, rows.map(([l, ks]) => [l, ks.map(norm).join(' ')])]);
    ok(platform + ': the groups, rows and keys match the spec', JSON.stringify(flat) === JSON.stringify(WANT), JSON.stringify(flat));
    const caps = got.flatMap(([, rows]) => rows.flatMap(([, ks]) => ks));
    ok(platform + ': Command and Option show as ' + (mac ? 'symbols' : 'Ctrl and Alt'), mac ? caps.includes('⌘') && caps.includes('Option') && !caps.includes('Ctrl') : caps.includes('Ctrl') && caps.includes('Alt') && !caps.includes('⌘'), caps.join(','));
    const lay = await p.evaluate(() => { const o = document.querySelector('#keysDlg'), d = o.querySelector('.dlg'); return { ov: o.scrollHeight - o.clientHeight, dlg: d.scrollHeight - d.clientHeight, right: Math.max(...[...o.querySelectorAll('.keys')].map(k => k.getBoundingClientRect().right)) <= d.getBoundingClientRect().right + 0.5 }; });
    ok(platform + ': nothing cut off or scrolling at 1300x900', lay.ov <= 0 && lay.dlg <= 0 && lay.right, JSON.stringify(lay));
    for (const [w, h] of [[1280, 720], [1040, 700], [700, 900]]) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(300);
      const v = await p.evaluate(() => { const o = document.querySelector('#keysDlg'), d = o.querySelector('.dlg'); return { ov: o.scrollHeight - o.clientHeight, dlg: d.scrollHeight - d.clientHeight, fits: [...o.querySelectorAll('.keys')].every(k => k.scrollWidth <= k.clientWidth + 1 && k.getBoundingClientRect().right <= d.getBoundingClientRect().right + 0.5) }; });
      ok(platform + ': ' + w + 'x' + h + ' nothing cut off or scrolling', v.ov <= 0 && v.dlg <= 0 && v.fits, JSON.stringify(v));
      if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/keys-' + w + 'x' + h + '.png' });
    }
    await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
    const ph = await p.evaluate(() => { const o = document.querySelector('#keysDlg'), d = o.querySelector('.dlg').getBoundingClientRect(); return { fits: [...o.querySelectorAll('.keys')].every(k => k.scrollWidth <= k.clientWidth + 1 && k.getBoundingClientRect().right <= d.right + 0.5), pageX: document.documentElement.scrollWidth - innerWidth }; });
    if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/keys-390x800.png' });
    ok(platform + ': phone width keeps every row inside the window, no sideways scroll', ph.fits && ph.pageX <= 0, JSON.stringify(ph));
    await p.close();
  }
  ok('no page errors', errs.length === 0, errs.join('|'));
  await b.close();
})();
