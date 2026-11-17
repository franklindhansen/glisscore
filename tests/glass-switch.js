// Glass that full screen switches on or off only changes how much it blurs, never between none and a blur (--glass-off). Safari paints an element at half strength for good when it gains a blur
// while a fade of its own opacity is running, which left the Audio Editor's tools looking switched off in full screen. Both editors, entering and leaving full screen, light and dark.
// The timeline and the Audio Editor's tool window hold menus and tips that a blur would trap under their neighbors, so they switch from none, and their own opacity is never faded while they do.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/glass-switch.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const FX = process.env.S || 'tests/fixtures', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
const EXEMPT = ['.app .timeline', '#audioDlg .ae-main'];
const glass = (root, exempt) => { const out = {}; let n = 0; for (const e of document.querySelectorAll(root + ', ' + root + ' *')) { const k = e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + [...e.classList].join('.') + ':' + (n++); out[k] = { bf: getComputedStyle(e).backdropFilter, free: exempt.some(q => e.matches(q)) }; } return out; };
const flips = (a, b) => Object.keys(a).filter(k => b[k] && !a[k].free && (a[k].bf === 'none') !== (b[k].bf === 'none')).map(k => k + ' ' + a[k].bf + ' → ' + b[k].bf);
(async () => {
  const br = await chromium.launch(), errs = [];
  for (const dark of [false, true]) {
    const p = await br.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); const tag = dark ? ' (dark)' : '';
    await p.goto(URL); await p.setInputFiles('#audioIn', FX + '/stereo.wav'); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(800);
    const read = (root) => p.evaluate(([root, ex, fn]) => (0, eval)('(' + fn + ')')(root, ex), [root, EXEMPT, glass.toString()]);
    // the video editor
    const v0 = await read('.app'); await p.evaluate(() => setFull(true)); await p.waitForTimeout(1200); const v1 = await read('.app');
    let f = flips(v0, v1); ok('video full screen: no glass switches from none' + tag, !f.length, f.slice(0, 5).join(' | '));
    ok('video full screen: the transport and timeline are glass in full screen' + tag, await p.evaluate(() => ['.transport', '.timeline'].every(q => getComputedStyle(document.querySelector('.app ' + q)).backdropFilter.includes('blur(2'))));
    await p.evaluate(() => setFull(false)); await p.waitForTimeout(1200); const v2 = await read('.app'); f = flips(v1, v2); ok('leaving video full screen: no glass switches to none' + tag, !f.length, f.slice(0, 5).join(' | '));
    // the Audio Editor
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(900);
    const a0 = await read('#audioDlg'); await p.evaluate(() => aeFs(true)); await p.waitForTimeout(1500); const a1 = await read('#audioDlg');
    f = flips(a0, a1); ok('Audio Editor full screen: no glass switches from none' + tag, !f.length, f.slice(0, 5).join(' | '));
    ok('Audio Editor full screen: the head buttons are glass' + tag, await p.evaluate(() => getComputedStyle(document.querySelector('#audioDlg .ed-head .btn-group')).backdropFilter.includes('blur(2')));
    const dim = await p.evaluate(() => { const eff = e => { let o = 1; for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; }; return { undo: eff(document.querySelector('#aeUndo')), want: +getComputedStyle(document.documentElement).getPropertyValue('--inactive') }; });
    ok('Audio Editor full screen: a switched-off button group is dimmed once, not twice' + tag, Math.abs(dim.undo - dim.want) < 0.01, JSON.stringify(dim));
    await p.evaluate(() => aeFs(false)); await p.waitForTimeout(1500); const a2 = await read('#audioDlg'); f = flips(a1, a2); ok('leaving Audio Editor full screen: no glass switches to none' + tag, !f.length, f.slice(0, 5).join(' | '));
    await p.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await br.close();
})();
