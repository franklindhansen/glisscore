// Reset to default: a double-click glides a slider back to its default (never to off), in the video settings and in the PDF Editor; Zoom is left alone; reduced motion snaps.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/slider-reset.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async reduced => {
    const c = await b.newContext({ viewport: { width: 1300, height: 900 }, reducedMotion: reduced ? 'reduce' : 'no-preference' }), p = await c.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500); return p;
  };
  // sets a slider off its default, double-clicks it, and reports where it ends and how many input events it fired on the way
  const reset = (p, id, away, wait = 900) => p.evaluate(async ([id, away, wait]) => {
    const r = document.querySelector('#' + id); r.value = away; r.dispatchEvent(new Event('input', { bubbles: true })); const seen = []; r.addEventListener('input', () => seen.push(+r.value));
    r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(f => setTimeout(f, wait)); return { v: +r.value, n: seen.length };
  }, [id, away, wait]);
  let p = await open(false);
  const video = [['bend', 55, 10], ['margin', 3, 8], ['gutter', 35, 90], ['divider', 30, 80], ['turnShadow', 100, 20], ['turnSoft', 50, 5], ['scoreAmt', 0, 70], ['scoreSoft', 50, 95]];
  for (const [id, def, away] of video) { const q = await reset(p, id, away); ok(id + ': a double-click glides back to its default', q.v === def && q.n > 4, JSON.stringify(q)); }
  { const q = await reset(p, 'flipDur', 2.5); ok('flipDur: back to the flip length default (1.0s)', q.v === 1 && q.n > 4, JSON.stringify(q)); }
  { await p.evaluate(K => { window[K].S.set.transition = 'slide'; }, K); await p.evaluate(() => document.querySelector('input[name=transition][value=slide]') && document.querySelector('input[name=transition][value=slide]').click()); await p.waitForTimeout(300);
    const q = await reset(p, 'flipDur', 2.5); ok('with Slide chosen the same slider goes back to the slide length default (0.5s)', q.v === 0.5 && q.n > 4, JSON.stringify(q)); }
  { const z = await p.evaluate(() => { const r = document.querySelector('#zoom'); r.value = 80; r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return +r.value; }); await p.waitForTimeout(600); ok('Zoom is left alone', await p.evaluate(() => +document.querySelector('#zoom').value) === 80 && z === 80); }
  // with a real mouse: click one spot on the track, then double-click another (the click moves the thumb, the double-click sends it home), and it stays home
  await p.evaluate(() => { const t = document.querySelector('input[name=transition][value=flip]'); if (t) t.click(); }); await p.waitForTimeout(300);
  const box = id => p.evaluate(id => { const r = document.querySelector('#' + id); r.scrollIntoView({ block: 'center' }); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; }, id);
  const val = id => p.evaluate(id => +document.querySelector('#' + id).value, id);
  const realMouse = async list => { for (const [id, def] of list) {
    if (id === 'scoreSoft') await p.evaluate(() => { const a = document.querySelector('#scoreAmt'); a.value = 60; a.dispatchEvent(new Event('input', { bubbles: true })); });          // Softness only shows while Strength is on
    await p.evaluate(id => { const r = document.querySelector('#' + id); for (let e = r; e && e !== document.body; e = e.parentElement) { e.hidden = false; if (e.classList.contains('fa') || e.classList.contains('group')) e.classList.add('open'); if (e.tagName === 'DETAILS') e.open = true; } }, id); await p.waitForTimeout(700);
    const vis = await p.evaluate(id => { const r = document.querySelector('#' + id); return r.offsetWidth > 0 && !r.disabled; }, id); if (!vis) { ok(id + ' (real mouse): the slider is visible', false); continue; }
    let bx = await box(id); await p.mouse.click(bx.x + bx.w * 0.2, bx.y); await p.waitForTimeout(250);
    const a = await val(id); await p.mouse.dblclick(bx.x + bx.w * 0.8, bx.y); await p.waitForTimeout(1000);
    const v1 = await val(id); await p.waitForTimeout(600); const v2 = await val(id);
    ok(id + ' (real mouse): a click, then a double-click somewhere else, ends on the default and stays there', a !== def && v1 === def && v2 === def, JSON.stringify({ a, v1, v2 }));
    // a double-click while it is still gliding home starts again from where it is and still ends on the default
    bx = await box(id); await p.mouse.click(bx.x + bx.w * 0.9, bx.y); await p.waitForTimeout(250); await p.mouse.dblclick(bx.x + bx.w * 0.9, bx.y); await p.waitForTimeout(120); await p.mouse.dblclick(bx.x + bx.w * 0.5, bx.y); await p.waitForTimeout(1100);
    ok(id + ' (real mouse): a second double-click in the middle of the glide still ends on the default', await val(id) === def, String(await val(id)));
    // grabbing the thumb in the middle of a glide takes over: the glide stops and the slider stays where it is dragged
    await p.mouse.click(bx.x + bx.w * 0.9, bx.y); await p.waitForTimeout(250); await p.mouse.dblclick(bx.x + bx.w * 0.9, bx.y); await p.waitForTimeout(100);
    await p.mouse.move(bx.x + bx.w * 0.3, bx.y); await p.mouse.down(); await p.mouse.move(bx.x + bx.w * 0.35, bx.y, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(150); const g1 = await val(id); await p.waitForTimeout(700); const g2 = await val(id);
    ok(id + ' (real mouse): a press during the glide stops it and the slider stays where it was put', g1 === g2 && g2 !== def, JSON.stringify({ g1, g2 }));
    await reset(p, id, def, 10);
  } };
  await realMouse([['bend', 55], ['margin', 3], ['turnShadow', 100], ['scoreSoft', 50]]);
  // the PDF Editor
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(600);
  { const q = await reset(p, 'peCropPad', 6); ok('PDF Editor crop margin: glides back to 2%', q.v === 2 && q.n > 4, JSON.stringify(q)); }
  { const q = await reset(p, 'peWmOpacity', 50); ok('PDF Editor watermark opacity: glides back to 20%', q.v === 20 && q.n > 4, JSON.stringify(q)); }
  { await p.waitForTimeout(1200); const steps = await p.evaluate(() => PE.undo.length); await reset(p, 'peWmOpacity', 40, 1200); const n = await p.evaluate(() => PE.undo.length) - steps; ok('a drag away and the glide back are one undo step', n === 1, 'steps ' + n); }
  await p.evaluate(() => peTool('crop')); await p.waitForTimeout(700); await realMouse([['peCropPad', 2]]);
  await p.evaluate(() => peTool('wm')); await p.waitForTimeout(700); await realMouse([['peWmOpacity', 20]]);
  // a slider already at its default does nothing
  { const q = await reset(p, 'peWmOpacity', 20, 300); ok('a slider already on its default stays put', q.v === 20 && q.n <= 1, JSON.stringify(q)); }
  await p.context().close();
  // reduced motion snaps
  p = await open(true);
  { const q = await reset(p, 'bend', 10, 200); ok('with reduced motion the slider snaps back at once', q.v === 55 && q.n <= 3, JSON.stringify(q)); }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
