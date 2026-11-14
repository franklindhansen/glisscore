// A slider never moves or changes size when its number changes (99% to 100%, 5% to 60%, Off to 3dB): every slider shown in every Audio Editor tool (and in the Imager's Frequency view) and in every PDF Editor tool is set to its smallest, a tenth, middle,
// ninetieth, and largest value, and its track's left edge, width, top, and height must be the same each time. No slider is named, so a new one is covered the moment it exists. Run through tests/run-all.sh.
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const url = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0', FIX = process.env.S || 'tests/fixtures';
// sets every visible slider under 'scope' through five values; returns each slider's name, how many it measured, and any change in its track
const sweep = async (p, scope) => p.evaluate(async scope => {
  const sleep = ms => new Promise(r => setTimeout(r, ms)), out = [];
  // only sliders a person can see: a view that is laid out but hidden (the Imager's Frequency sliders while Overall shows) is measured when it is showing
  for (const el of [...document.querySelectorAll(scope + ' input[type=range]')].filter(e => e.offsetParent !== null && e.getBoundingClientRect().width > 0 && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))) {
    const min = +el.min, max = +el.max, orig = el.value, seen = [], at = () => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join(); };
    for (let i = 0, last = ''; i < 40 && at() !== last; i++) { last = at(); await sleep(150); }          // first the tool's own switch animation is allowed to finish: only what a new value does is being measured
    for (const v of [min, min + (max - min) * 0.1, (min + max) / 2, min + (max - min) * 0.9, max]) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(300); const r = el.getBoundingClientRect(); seen.push([+r.left.toFixed(2), +r.width.toFixed(2), +r.top.toFixed(2), +r.height.toFixed(2)]); }
    el.value = orig; el.dispatchEvent(new Event('input', { bubbles: true })); await sleep(150);
    out.push({ id: el.id || el.getAttribute('aria-label') || '?', n: seen.length, moved: [0, 1, 2, 3].some(k => new Set(seen.map(s => s[k])).size > 1), seen: seen.map(s => s.join(',')).join(' | ') });
  }
  return out;
}, scope);
(async () => {
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push(e.message); });
  await p.goto(url); await p.setInputFiles('#audioIn', FIX + '/stereo.wav'); await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.setInputFiles('#pdfIn', FIX + '/score.pdf'); await p.waitForFunction(() => S.pdf && S.pdf.n > 0);
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(700);
  let total = 0;
  for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level', 'emu']) {
    await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(700);
    if (t === 'imager') { const r = await sweep(p, '#audioDlg'); total += r.length; for (const s of r) ok('Audio Editor ' + t + ': ' + s.id + ' holds still', !s.moved, s.seen);
      await p.click('input[name=aeWidthMode][value=bands]', { force: true }); await p.waitForTimeout(700); const r2 = await sweep(p, '#audioDlg'); total += r2.length; for (const s of r2) ok('Audio Editor imager (Frequency): ' + s.id + ' holds still', !s.moved, s.seen); await p.click('input[name=aeWidthMode][value=all]', { force: true }); await p.waitForTimeout(500); continue; }
    const r = await sweep(p, '#audioDlg'); total += r.length; for (const s of r) ok('Audio Editor ' + t + ': ' + s.id + ' holds still', !s.moved, s.seen);
  }
  await p.evaluate(() => closeAudioEditor()); await p.waitForTimeout(500); await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500);
  for (const t of ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm']) { await p.evaluate(t => peTool(t), t); await p.waitForTimeout(700); const r = await sweep(p, '#pdfDlg'); total += r.length; for (const s of r) ok('PDF Editor ' + t + ': ' + s.id + ' holds still', !s.moved, s.seen); }
  ok('the sweep reached the sliders (an empty sweep proves nothing)', total >= 14, total + ' sliders measured');
  ok('no page errors', !errs.length, errs.join('; ')); await b.close();
})();
