// The Audio Editor's main view against the owner's approved pictures, at 1440x900 with the stereo fixture. For each tool state that has a picture, the dialog is read through the shared helper
// (tests/lib/approved-features.js) and compared with positions measured once from the picture (a 1000x758 crop of the dialog), recorded in TABLE below as [feature, the picture's row, the layout rules' row]:
//   head, ctl   the heading's letters and the heading-row control, as the distance under the card's own top edge: within 1px of the picture's
//   top, bottom a card's edges: the rules' row (the picture's is recorded beside it, so where the column rule differs from the picture, the difference is visible and intentional)
//   frame       the Fades picture's frame lines: within 1px of the picture's (36px under the heading's letters, 48px above the curve choice)
//   scale       the numbers under a slider or bar: within 1px of the picture's in a card whose height matches the picture's; in a card whose height differs by more than 1px, at the rules' row, with the picture's printed beside it
//   steps       the middle of the buttons on a row of steps (Noise sample's Select row): the rules' row (balanced between the heading and the line above Mains hum), the picture's printed beside it
//   gap         every slider's numbers start 12px under its thumb, every bar's 8px under the bar
// A picture whose tool is not built yet is listed in tests/audio-editor-approved-expected.txt, which may only shrink; its rows go into TABLE with its ticket.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-approved.js
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright-core');
const { install } = require('./lib/measure.js'), { features } = require('./lib/approved-features.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const radio = (name, v) => { const r = document.querySelector('input[name=' + name + '][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); };
const STATES = {
  'noise idle': ['noise', null],
  'spec heal': ['spec', null],
  'imager overall': ['imager', null],
  'imager frequency': ['imager', () => __radio('aeWidthMode', 'bands')],
  'fades idle': ['fades', null],
  'level off': ['level', null],
  'emu idle': ['emu', null],
  'eq idle': ['eq', null],
  'noise selected': ['noise', async () => { document.querySelector('#aeNrFind').click(); await sleep(100); for (let i = 0; i < 600 && AE.nrAutoBusy; i++) await sleep(25); await sleep(500); }],
  'noise learning': ['noise', async () => { document.querySelector('#aeNrFind').click(); await sleep(100); for (let i = 0; i < 600 && AE.nrAutoBusy; i++) await sleep(25); await sleep(500); const l = document.querySelector('#aeNrLearn'); l.disabled = true; l.classList.add('loading'); l.style.setProperty('--p', '60%'); l.textContent = 'Processing 60%'; await sleep(300); }],
  'noise short': ['noise', null, async p => { await p.click('#aeNrHand'); const g = await p.evaluate(() => { const r = document.querySelector('#aeCanvas').getBoundingClientRect(), t = t => r.left + aeX(t); return { y: r.top + r.height / 2, a: t(1.8), z: t(2.0) }; }); await p.mouse.move(g.a, g.y); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(g.a + (g.z - g.a) * i / 8, g.y); await p.mouse.up(); await p.waitForTimeout(300); }],
  'fades length 1': ['fades', async () => { const fl = document.querySelector('#aeFadeLen'); fl.value = 1; fl.dispatchEvent(new Event('input', { bubbles: true })); fl.dispatchEvent(new Event('change', { bubbles: true })); await sleep(1500); aeFadeDraw(); }],
};
// cards side by side whose last lines share one line (Fades: the Length card's slider row ends on the Shape card's choice). Width, Balance, and Fades Length have no scale row: their end words sit beside the track (owner's decision, November 13, 2026), checked by slider-word in audio-editor-grid-lines
const LAST_LINES = ['aeFadeLenCard'], LAST_PAIRS = [['aeFadeLenCard', 'ae-card.fd-shape']];
// what each Noise picture shows on the Select row: Auto pressed, Manual pressed, Learn on or off, and the "Too short" note
const NOISE_SHOWS = { 'noise idle': 'false,false,off,nonote', 'noise selected': 'true,false,on,nonote', 'noise learning': 'true,false,off,nonote', 'noise short': 'false,true,off,note' };
const STEPS = 391;          // the middle of the Select row's buttons, centered between the heading and the line above Mains hum in a 164px card (the picture's card is 158px, so its row is 4px higher)
const TABLE = {
  'noise idle': [
    ['top:aeNrSample', 318, 318],
    ['bottom:aeNrSample', 476, 482],
    ['head:NOISE SAMPLE', 339, 338.98],
    ['steps:aeNrSample', 387, STEPS],
    ['top:aeNrCtl', 486, 492],
    ['bottom:aeNrCtl', 656, 656],
    ['head:3REMOVAL', 507, 512.98],
    ['ctl:3REMOVAL', 495, 502]
  ],
  'spec heal': [
    ['top:ae-card.sp-card.sp-sel', 318, 318],
    ['bottom:ae-card.sp-card.sp-sel', 432, 428],
    ['head:SELECT', 339, 338.98],
    ['top:ae-card.sp-card.sp-lcard', 442, 438],
    ['bottom:ae-card.sp-card.sp-lcard', 656, 656],
    ['head:EDITS', 462, 458.98]
  ],
  'eq idle': [
    ['top:ae-card.eq-main.own-grid', 318, 318],
    ['bottom:ae-card.eq-main.own-grid', 553, 577],
    ['top:aeEqBand', 564, 587],
    ['bottom:aeEqBand', 656, 656]
  ],
  'imager overall': [
    ['top:aeWidthCard', 318, 318],
    ['bottom:aeWidthCard', 493, 487],
    ['head:WIDTH', 339, 338.98],
    ['ctl:WIDTH', 327, 328],
    ['top:aeBalCard', 503, 497],
    ['bottom:aeBalCard', 656, 656],
    ['head:BALANCE', 524, 517.98],
    ['ctl:BALANCE', 512, 507],
    ['top:ae-card.im-scope', 318, 318],
    ['bottom:ae-card.im-scope', 656, 656]
  ],
  'imager frequency': [
    ['top:aeWidthCard', 318, 318],
    ['bottom:aeWidthCard', 493, 487],
    ['head:WIDTH', 339, 338.98],
    ['ctl:WIDTH', 327, 328],
    ['top:aeBalCard', 503, 497],
    ['bottom:aeBalCard', 656, 656],
    ['head:BALANCE', 524, 517.98],
    ['ctl:BALANCE', 512, 507],
    ['top:ae-card.im-scope', 318, 318],
    ['bottom:ae-card.im-scope', 656, 656]
  ],
  'fades idle': [
    ['top:aeFadeLenCard', 318, 318],
    ['bottom:aeFadeLenCard', 656, 656],
    ['head:LENGTH', 339, 338.98],
    ['top:ae-card.fd-shape', 318, 318],
    ['bottom:ae-card.fd-shape', 656, 656],
    ['head:SHAPE', 339.01, 338.98],
    ['frame-top:ae-card.fd-shape', 383, 383],
    ['frame-bottom:ae-card.fd-shape', 561, 561]
  ],
  'level off': [
    ['top:aeNormCard', 318, 318],
    ['bottom:aeNormCard', 487, 482],
    ['head:NORMALIZE', 339, 338.98],
    ['ctl:NORMALIZE', 327, 328],
    ['top:aeGainCard', 318, 318],
    ['bottom:aeGainCard', 487, 482],
    ['head:GAIN', 339, 338.98],
    ['scale:aeGainCard', 460.07, 460.98],
    ['top:aeMeter', 497, 492],
    ['bottom:aeMeter', 656, 656],
    ['head:METER', 518, 512.98],
    ['scale:aeMeter', 576.08, 579.83]
  ],
  'emu idle': [
    ['top:aeEmCard', 318, 318],
    ['bottom:aeEmCard', 656, 656],
    ['top:ae-card.em-view', 318, 318],
    ['bottom:ae-card.em-view', 656, 656],
    ['head:TONE', 339, 338.98]
  ],
  'fades length 1': [
    ['top:aeFadeLenCard', 318, 318],
    ['bottom:aeFadeLenCard', 656, 656],
    ['head:LENGTH', 339, 338.98],
    ['top:ae-card.fd-shape', 318, 318],
    ['bottom:ae-card.fd-shape', 656, 656],
    ['head:SHAPE', 339.01, 338.98],
    ['frame-top:ae-card.fd-shape', 383, 383],
    ['frame-bottom:ae-card.fd-shape', 561, 561]
  ]
};
for (const k of ['noise selected', 'noise learning', 'noise short', 'noise selected dark', 'noise short dark']) TABLE[k] = TABLE['noise idle'];          // the Noise pictures differ from p-noise only on the Select row, so every other row is the idle row
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(90000); p.on('pageerror', e => errs.push(e.message));
  const open = async () => { await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/stereo.wav');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500);
    await p.evaluate(install); await p.evaluate('window.__radio = ' + radio); };
  await open();
  for (const [state, rows] of Object.entries(TABLE)) {
    if (/^noise (selected|learning|short)/.test(state)) await open();          // each Noise picture starts from a fresh editor: a selection or a note from the one before is not part of it
    const [tool, go, drive] = STATES[state.replace(/ dark$/, '')]; await p.emulateMedia({ colorScheme: / dark$/.test(state) ? 'dark' : 'light' }); await p.evaluate(t => aeTool(t), tool); await p.waitForTimeout(800); if (go) { await p.evaluate('(' + go + ')()'); await p.waitForTimeout(900); } if (drive) await drive(p);
    const feats = await p.evaluate(features), gaps = feats.filter(f => f.kind === 'gap'), app = Object.fromEntries(feats.map(f => [f.key, f.y])), pic = Object.fromEntries(rows.map(([k, v]) => [k, v])), bad = [], read = [];
    for (const [key, pv, rv] of rows) {
      if (app[key] === undefined) { bad.push(key + ' is not on the page'); continue; }
      if (key.startsWith('head:') || key.startsWith('ctl:')) {
        // the distance under the card's own top edge: the card is the one whose top edge is the nearest above the feature in the picture
        const tops = rows.filter(([k]) => k.startsWith('top:')).map(([k, v, r]) => ({ k, v, r })).filter(t => t.v <= pv + 0.5).sort((x, y) => y.v - x.v)[0];
        const got = app[key] - app[tops.k], want = pv - tops.v;
        if (Math.abs(got - want) > 1) bad.push(key + ' is ' + got.toFixed(1) + 'px under its card\'s top, the picture has ' + want);
        read.push(key + ' ' + got.toFixed(0) + '/' + want);
      } else if (key.startsWith('scale:')) {
        // a row inside a card follows the picture within 1px when the card's height matches the picture's; in a card whose height differs by more than 1px it follows the rules (exact balance and the 12px or 8px gap, checked here and in audio-editor-grid-lines), and the picture's row is printed beside it
        const id = key.slice(6), onLine = LAST_LINES.includes(id), pt = rows.find(([k]) => k === 'top:' + id), pb = rows.find(([k]) => k === 'bottom:' + id), same = !onLine && Math.abs((app['bottom:' + id] - app['top:' + id]) - (pb[1] - pt[1])) <= 1;
        if (same) { if (Math.abs(app[key] - pv) > 1) bad.push(key + ' is at ' + app[key] + ', the picture has ' + pv + ' and the card is the picture\'s height'); }
        else { if (Math.abs(app[key] - rv) > 0.5) bad.push(key + ' is at ' + app[key] + ', the layout rules put it at ' + rv); read.push(key + ' rule ' + rv + ', picture ' + pv + ' (' + (onLine ? 'the last lines of side-by-side cards share one line' : 'card ' + (app['bottom:' + id] - app['top:' + id]) + 'px, picture ' + (pb[1] - pt[1]) + 'px') + ')'); }
      } else if (key.startsWith('frame-')) {
        if (Math.abs(app[key] - pv) > 1) bad.push(key + ' is at ' + app[key] + ', the picture has ' + pv);
      } else {
        if (Math.abs(app[key] - rv) > 0.5) bad.push(key + ' is at ' + app[key] + ', the layout rules put it at ' + rv + ' (the picture has ' + pv + ')');
      }
    }
    for (const [x, y] of LAST_PAIRS) if (app['last:' + x] !== undefined && app['last:' + y] !== undefined && Math.abs(app['last:' + x] - app['last:' + y]) > 0.5) bad.push('the last lines of ' + x + ' (' + app['last:' + x] + ') and ' + y + ' (' + app['last:' + y] + ') are not on one line');
    for (const g of gaps) if (Math.abs(g.y - g.want) > 0.5) bad.push(g.key + ' starts ' + g.y + 'px under its thumb or bar, not ' + g.want);
    const shows = NOISE_SHOWS[state.replace(/ dark$/, '')];
    if (shows) { const got = await p.evaluate(() => { const n = document.querySelector('#aeStopNote'); return ['#aeNrFind', '#aeNrHand'].map(s => document.querySelector(s).getAttribute('aria-pressed')).join() + ',' + (document.querySelector('#aeNrLearn').disabled ? 'off' : 'on') + ',' + (n && !n.hidden && /Too short/.test(n.textContent) ? 'note' : 'nonote'); }); if (got !== shows) bad.push('the Select row shows ' + got + ', the picture shows ' + shows); }
    ok(state + ': heading letters and heading-row controls sit under their card\'s top as in the picture; card edges and scales are where the layout rules put them', !bad.length, bad.slice(0, 6).join(' | ') || read.join(', '));
  }
  const pending = fs.readFileSync(path.join(__dirname, 'audio-editor-approved-expected.txt'), 'utf8').split('\n').filter(l => l.trim() && l[0] !== '#');
  ok(pending.length + ' approved pictures wait for their tool (tests/audio-editor-approved-expected.txt)', true);
  ok('no errors', errs.length === 0, errs.join(' | ')); await b.close();
})();