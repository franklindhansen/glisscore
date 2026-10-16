// Video fades: Length with Both, In and Out above one slider, the In and Out switches, the Shape picture and the Curve, and how the picture's opacity follows each curve.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-fades.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async w => { const p = await b.newPage({ viewport: { width: w, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(500); return p; };
  const p = await open(1300);
  const fade = (t) => p.evaluate(([K, t]) => window[K].frameState(t).fade, [K, t]);
  const setSet = o => p.evaluate(([K, o]) => { Object.assign(window[K].S.set, o); }, [K, o]);
  const vs = await p.evaluate(K => window[K].S.vStart, K);
  // a fixed 1.0s fade in, both fades on
  await setSet({ fadesOn: true, fadeIn: true, fadeOut: true, fadeAuto: false, fadeLen: 1, fadeOutLen: 1, fadeSplit: false });
  const smooth = x => x * x * (3 - 2 * x);
  const at = async (shape, x) => { await setSet({ fadeShape: shape }); return fade(vs + x); };
  const near = (a, b) => Math.abs(a - b) < 0.005;
  ok('the default curve is today\'s smooth ease', near(await fade(vs + 0.25), smooth(0.25)) && near(await fade(vs + 0.7), smooth(0.7)));
  ok('Standard is a straight line', near(await at('standard', 0.25), 0.25) && near(await at('standard', 0.7), 0.7));
  ok('Smooth eases in and out', near(await at('smooth', 0.25), smooth(0.25)));
  ok('Natural rises like a quarter of a sine wave', near(await at('natural', 0.25), Math.sin(0.25 * Math.PI / 2)) && near(await at('natural', 0.7), Math.sin(0.7 * Math.PI / 2)));
  ok('every curve starts at 0 and is full after the length', (await Promise.all(['standard', 'smooth', 'natural'].map(async s => (await at(s, 0)) === 0 && (await at(s, 1.5)) === 1))).every(Boolean));
  // the panel
  await p.evaluate(K => { const s = window[K].S.set; delete s.fadeShape; }, K);
  ok('Length has Both, In and Out', await p.evaluate(() => ['both', 'in', 'out'].every(v => document.querySelector('input[name=fadeSide][value=' + v + ']'))));
  ok('Curve has Standard, Smooth and Natural', await p.evaluate(() => ['standard', 'smooth', 'natural'].every(v => document.querySelector('input[name=fadeShape][value=' + v + ']'))));
  ok('a Shape picture is there', await p.evaluate(() => !!document.querySelector('#fadeCv')));
  ok('Fade to stays', await p.evaluate(() => !!document.querySelector('input[name=fadeStyle][value=black]') && !!document.querySelector('input[name=fadeStyle][value=score]')));
  // Length: Both, In and Out above one slider; the slider runs Off, Auto, then 0.2s to 3.0s, and there are no on or off switches
  ok('there are no on or off switches in Fades', await p.evaluate(() => !document.querySelector('#fadesOn, #fadeIn, #fadeOut')));
  const N = sec => Math.round(sec * 10), AUTO = await p.evaluate(() => +document.querySelector('#fadeLen').dataset.default);          // slider positions are tenths of a second: 0 is Off, 2 is 0.2s, 30 is 3.0s, and Auto sits at its own length
  const slide = n => p.evaluate(n => { const r = document.querySelector('#fadeLen'); r.value = n; r.dispatchEvent(new Event('input', { bubbles: true })); }, n);
  const pick = v => p.evaluate(v => { const r = document.querySelector('input[name=fadeSide][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const lens = () => p.evaluate(K => { const s = window[K].S.set; return [s.fadeAuto, s.fadeLen, s.fadeOutLen]; }, K);
  const tail = d => p.evaluate(([K, d]) => window[K].frameState(window[K].vEnd() - d).fade, [K, 0.5]);
  const label = () => p.evaluate(() => document.querySelector('#fadeLenVal').textContent);
  await slide(N(1.2)); let l = await lens(); ok('Both sets one length (1.2s)', l[0] === false && l[1] === 1.2 && l[2] === 1.2, JSON.stringify(l));
  await pick('in'); await slide(N(0.6)); l = await lens(); ok('In changes only the start (0.6s in, 1.2s out)', l[1] === 0.6 && l[2] === 1.2, JSON.stringify(l));
  ok('the picture follows: in is full at 0.6s, out still fading 0.5s from the end', near(await fade(vs + 0.6), 1) && (await tail()) < 0.9);
  await pick('out'); await slide(N(1.7)); l = await lens(); ok('Out changes only the end (1.7s out, 0.6s in)', l[1] === 0.6 && l[2] === 1.7, JSON.stringify(l));
  await pick('both'); await slide(N(1.2)); l = await lens(); ok('Both again makes them one', l[1] === 1.2 && l[2] === 1.2, JSON.stringify(l));
  await p.click('#fadeLenField .sl-end[data-v="0"]'); ok('the Off end under the slider turns the fades off', (await fade(vs)) === 1 && (await label()) === 'Off');
  await p.click('#fadeLenField .sl-end.auto'); ok('the Auto end sets Auto', /^Auto/.test(await label()));
  await slide(AUTO); l = await lens(); ok('the second notch is Auto, as today', l[0] === true && /^Auto/.test(await label()), await label());
  await slide(0); ok('Off on Both: no fade at the start or the end, and the slider says Off', (await fade(vs)) === 1 && (await tail()) === 1 && (await label()) === 'Off', await label());
  await slide(N(1.2)); ok('dragging the slider off Off turns the fades on', (await fade(vs)) === 0 && (await tail()) < 0.9);
  await pick('in'); await slide(0); ok('Off on In turns off only the start', (await fade(vs)) === 1 && (await tail()) < 0.9 && (await label()) === 'Off');
  await pick('out'); ok('Out still shows its own length', (await label()) === '1.2s', await label());
  await pick('both'); await slide(N(1.2)); ok('choosing Both yourself and moving the slider puts both sides on at one length', (await fade(vs)) === 0 && (await tail()) < 0.9);
  await slide(N(0.8)); await pick('both'); await slide(0); await slide(N(1.2));
  ok('Off then back on in Both restores both sides', (await fade(vs)) === 0 && (await tail()) < 0.9);
  // a project saved with the group switch off opens with both sides Off, and keeps its lengths
  await p.evaluate(K => { const s = window[K].S.set; Object.assign(s, { fadesOn: false, fadeIn: true, fadeOut: true, fadeAuto: false, fadeLen: 2, fadeOutLen: 2, fadeSplit: false }); document.querySelector('input[name=fadeShape][value=smooth]').dispatchEvent(new Event('change', { bubbles: true })); }, K);
  ok('a project saved with Fades off shows no fade', (await fade(vs)) === 1 && (await tail()) === 1);
  await pick('in'); await slide(N(1.2)); ok('turning In on keeps Out off', (await fade(vs)) === 0 && (await tail()) === 1);
  await p.evaluate(K => Object.assign(window[K].S.set, { fadesOn: true, fadeIn: true, fadeOut: true, fadeAuto: false, fadeLen: 1, fadeOutLen: 1, fadeSplit: false }), K); await pick('both');
  // the slider's Auto notch sits where its label is, apart from Off, and double-clicking goes back to it smoothly
  { await p.evaluate(K => window[K].restoreDefaults(), K); await p.waitForTimeout(400);
    const pos = () => p.evaluate(AUTO => { const r = document.querySelector('#fadeLen'), rc = r.getBoundingClientRect(), f = (r.value - r.min) / (r.max - r.min), thumb = rc.left + 8 + f * (rc.width - 16), c = s => { const b = document.querySelector('#fadeLenField .sl-end[data-v="' + s + '"]').getBoundingClientRect(); return b.left + b.width / 2; }; return { thumb, off: c(0), auto: c(AUTO), longer: c(30), v: +r.value }; }, AUTO);
    let q = await pos(); ok('after Reset the slider sits on Auto, under its Auto label and well away from Off', Math.abs(q.thumb - q.auto) < 5 && q.auto - q.off > 25 && q.v === AUTO, JSON.stringify(q));
    { const lab = await label(); ok('Auto sits on the scale at the length it works out to, so shorter lengths are to its left and longer ones to its right', /^Auto/.test(lab) && Math.round(parseFloat(lab.slice(5)) * 10) === AUTO && N(0.5) < AUTO && N(2.5) > AUTO, lab + ' @' + AUTO); }
    await slide(N(2.0)); await p.waitForTimeout(100);
    await p.evaluate(() => { const r = document.querySelector('#fadeLen'); window.__seen = []; r.addEventListener('input', () => window.__seen.push(+r.value)); r.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    await p.waitForTimeout(900); q = await pos(); const seen = await p.evaluate(() => window.__seen);
    ok('double-clicking the slider glides back to Auto', q.v === AUTO && seen.length > 4 && seen.some(v => v > AUTO && v < 20), JSON.stringify([q.v, seen.length]));
    ok('and the fade is Auto again', (await label()).startsWith('Auto'), await label());
    const shot = () => p.evaluate(() => document.querySelector('#fadeCv').toDataURL());
    const a0 = await shot(); await slide(N(3.0)); await p.waitForTimeout(60); const a1 = await shot(); await p.waitForTimeout(900); const a2 = await shot(); await p.waitForTimeout(200); const a3 = await shot();
    ok('the Shape picture eases to a new length instead of jumping', a0 !== a1 && a1 !== a2 && a2 === a3);
    await p.evaluate(() => { const r = document.querySelector('input[name=fadeShape][value=natural]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(60); const b1 = await shot(); await p.waitForTimeout(900); const b2 = await shot();
    ok('the Shape picture eases to a new curve', a2 !== b1 && b1 !== b2);
    await p.evaluate(() => { const r = document.querySelector('input[name=fadeShape][value=smooth]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(400);
  }
  // turning one side off must never touch the other side's length, even when the slider is dragged across Auto on its way to Off
  { await p.evaluate(K => window[K].restoreDefaults(), K); await p.waitForTimeout(300);
    await pick('in'); await slide(N(1.5)); await pick('out'); await slide(N(2.0));
    for (const n of [N(1.0), N(0.5), AUTO + 1, AUTO, AUTO - 1, 3, 2, 0]) await slide(n);
    const st = await p.evaluate(K => { const { S, frameState, vEnd } = window[K], s = S.set; return { auto: s.fadeAuto, autoOut: s.fadeAutoOut, len: s.fadeLen, fadeIn: s.fadeIn, fadeOut: s.fadeOut, inAt1: frameState(S.vStart + 1.5).fade, inAt07: frameState(S.vStart + 0.75).fade }; }, K);
    ok('dragging Out across Auto to Off leaves In at 1.5s', st.len === 1.5 && st.auto === false && st.fadeIn && !st.fadeOut && Math.abs(st.inAt1 - 1) < 0.001 && st.inAt07 < 0.9, JSON.stringify(st));
    await pick('in'); ok('and In still reads 1.5s', (await label()) === '1.5s', await label());
    await pick('out'); await slide(N(1.0)); await slide(AUTO); await pick('in'); ok('Out set to Auto on its own leaves In at 1.5s', (await label()) === '1.5s', await label());
    await pick('both'); await slide(0); ok('Both to Off turns both sides off', (await fade(vs)) === 1 && (await tail()) === 1);
    await p.evaluate(K => window[K].restoreDefaults(), K); await p.waitForTimeout(300);
  }
  // the curve buttons set the curve
  await p.evaluate(() => { const r = document.querySelector('input[name=fadeShape][value=natural]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); });
  ok('choosing Natural in the panel sets the curve', await p.evaluate(K => window[K].S.set.fadeShape, K) === 'natural');
  // a saved project from before has no curve: it opens as Smooth with the other fade settings untouched
  const old = await p.evaluate(() => { const o = { fadeIn: true, fadeOut: false, fadeLen: 2, fadeOutLen: 1, fadeSplit: false, fadeAuto: false, fadeStyle: 'score' }; const c = cleanSettings(o); return c; });
  ok('an old saved fade keeps its values and gets no new curve', old.fadeLen === 2 && old.fadeOut === false && old.fadeStyle === 'score' && !('fadeShape' in old), JSON.stringify(old));
  await p.evaluate(K => { const s = window[K].S.set; delete s.fadeShape; Object.assign(s, { fadesOn: true, fadeIn: true, fadeOut: true, fadeAuto: false, fadeLen: 1, fadeSplit: false }); }, K);
  ok('and then fades exactly as before', near(await fade(vs + 0.4), smooth(0.4)));
  // scrubbing: the preview shows the fade under the playhead while it is dragged, and stays there
  { const q = await open(1300);
    await q.evaluate(K => { const s = window[K].S.set; Object.assign(s, { fadesOn: true, fadeIn: true, fadeOut: true, fadeAuto: false, fadeLen: 2, fadeOutLen: 2, fadeSplit: false, fadeShape: 'standard' }); const r = window[K].previewR, o = r.render.bind(r); window.__shown = []; r.render = st => { window.__shown.push(st.fade); return o(st); }; }, K);
    const pos = await q.evaluate(K => { const { S, TL, t2x } = window[K], rc = TL.canvas.getBoundingClientRect(); return { y: rc.top + 12, x0: rc.left + t2x(S.vStart + 0.5), x1: rc.left + t2x(S.vStart + 1.0), x2: rc.left + t2x(S.vStart + 5) }; }, K);
    await q.mouse.move(pos.x0, pos.y); await q.mouse.down(); await q.waitForTimeout(250);
    const a0 = await q.evaluate(() => window.__shown.slice(-1)[0]);
    await q.mouse.move(pos.x1, pos.y, { steps: 5 }); await q.waitForTimeout(250); const a1 = await q.evaluate(() => window.__shown.slice(-1)[0]);
    await q.mouse.up(); await q.waitForTimeout(250); const a2 = await q.evaluate(() => window.__shown.slice(-1)[0]);
    ok('while scrubbing through a fade the preview shows it (0.25 then 0.5)', Math.abs(a0 - 0.25) < 0.03 && Math.abs(a1 - 0.5) < 0.03, JSON.stringify([a0, a1]));
    ok('letting go leaves the preview on that frame', Math.abs(a2 - a1) < 0.001, JSON.stringify([a1, a2]));
    await q.mouse.click(pos.x2, pos.y); await q.waitForTimeout(250);
    ok('scrubbing out of the fade shows the full picture', (await q.evaluate(() => window.__shown.slice(-1)[0])) === 1);
    await q.close(); }
  // Shape, Curve and Fade to fold away when both fades are off, and ease open when either is on
  { await p.evaluate(K => window[K].restoreDefaults(), K); await p.waitForTimeout(400);
    const fold = () => p.evaluate(() => { const f = document.querySelector('#fadeMoreFold'); if (!f) return null; const kids = [...f.querySelectorAll('#fadeCv, input[name=fadeShape], input[name=fadeStyle]')]; return { open: f.classList.contains('open'), inert: f.firstElementChild.inert, all: kids.length, h: Math.round(f.getBoundingClientRect().height), focus: f.contains(document.activeElement) && document.activeElement !== f }; });
    const ons = () => p.evaluate(K => { const s = window[K].S.set; return [s.fadesOn !== false && !!s.fadeIn, s.fadesOn !== false && !!s.fadeOut]; }, K);
    const settle = () => p.waitForTimeout(700);
    await pick('both'); await slide(N(1.2)); await settle(); let f = await fold();
    ok('either side on: Shape, Curve and Fade to are open', f && f.open && !f.inert && f.all >= 6 && f.h > 40, JSON.stringify(f));
    await slide(0); await settle(); f = await fold();
    ok('both sides off: they are folded away, and closed to the keyboard', f && !f.open && f.inert && f.h === 0, JSON.stringify([f, await ons()]));
    await slide(N(1.2)); await settle(); f = await fold(); ok('moving the slider off Off opens them again', f.open && !f.inert && f.h > 40, JSON.stringify(f));
    await pick('in'); await slide(0); await settle(); f = await fold(); const o1 = await ons();
    ok('only In off: they stay open, because Out still uses them', !o1[0] && o1[1] && f.open && !f.inert, JSON.stringify([f, o1]));
    await pick('out'); await slide(0); await settle(); f = await fold();
    ok('then Out off too: they fold', f && !f.open && f.inert, JSON.stringify([f, await ons()]));
    await pick('in'); await slide(N(1.0)); await settle(); f = await fold(); const o2 = await ons();
    ok('only Out off: they stay open', o2[0] && !o2[1] && f.open, JSON.stringify([f, o2]));
    // undo and redo re-read the fades (a Fades change is an Undo step, so undoing it must open the fold again and redoing it fold them)
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    await pick('both'); await slide(N(1.2)); await settle(); await p.evaluate(K => { const k = window[K]; const v = k.S.vStart; k.S.turns = [v + 3, v + 6, v + 9]; k.Transport.seek(v + 4); }, K); await p.keyboard.press('t');
    const nt = await p.evaluate(K => window[K].S.history.length, K); ok('a turn is moved, so there is a step to undo', nt >= 1, String(nt));
    await slide(0); await settle(); f = await fold(); let o3 = await ons();
    ok('turning both fades off folds them', !o3[0] && !o3[1] && !f.open && f.inert, JSON.stringify([f, o3]));
    await p.keyboard.press('Control+z'); await settle(); f = await fold(); o3 = await ons();
    ok('undoing the Fades step opens them', (o3[0] || o3[1]) && f.open && !f.inert, JSON.stringify([f, o3]));
    await p.keyboard.press('Control+Shift+z'); await settle(); f = await fold(); o3 = await ons();
    ok('redoing it folds them', !o3[0] && !o3[1] && !f.open && f.inert, JSON.stringify([f, o3]));
    // a loaded settings file
    const load = o => p.evaluate(async ([K, o]) => { await window[K].importSettings(new File([JSON.stringify({ glisscore: 1, settings: o })], 'x.json')); }, [K, o]);
    await load({ fadeIn: true, fadeOut: true, fadesOn: true }); await settle(); f = await fold(); ok('a settings file with a fade on opens them', f.open && !f.inert, JSON.stringify(f));
    await load({ fadeIn: false, fadeOut: false }); await settle(); f = await fold(); o3 = await ons(); ok('a settings file with both fades off folds them', !o3[0] && !o3[1] && !f.open && f.inert, JSON.stringify([f, o3]));
    await load({ fadeIn: false, fadeOut: true }); await settle(); f = await fold(); ok('a settings file with one fade off leaves them open', f.open, JSON.stringify(f));
    // focus never lands on a folded control: a focused Curve button lets go when the fold closes, and Tab skips the folded controls
    await load({ fadeIn: true, fadeOut: true }); await settle(); await p.focus('input[name=fadeShape][value=standard]');
    await slide(0); await settle(); f = await fold(); ok('closing the fold takes focus out of it', !f.open && !f.focus, JSON.stringify(f));
    await p.focus('#fadeLen'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    ok('Tab from the slider does not stop inside the folded controls', await p.evaluate(() => !document.querySelector('#fadeMoreFold').contains(document.activeElement)));
  }
  // layout: nothing sticks out of the settings column at any width
  await p.close();
  for (const w of [1300, 1000, 760, 390]) {
    const q = await open(w); await q.evaluate(() => { const g = document.querySelector('.group[data-sum=fades]'); g.scrollIntoView(); });
    const r = await q.evaluate(() => { const g = document.querySelector('.group[data-sum=fades]'), gr = g.getBoundingClientRect(), bad = []; g.querySelectorAll('#fadeBody *, .fade-pair *').forEach(el => { if (el.classList.contains('fa-in')) return; const x = el.getBoundingClientRect(); if (x.width && (x.right > gr.right + (el.classList.contains('sl-end') ? 6 : 1) || x.left < gr.left - (el.classList.contains('sl-end') ? 6 : 1))) bad.push(el.id || el.tagName); }); const cv = document.querySelector('#fadeCv').getBoundingClientRect(); return { bad, cv: [Math.round(cv.width), Math.round(cv.height)], page: document.documentElement.scrollWidth <= innerWidth }; });
    ok('Fades fits the column at ' + w + 'px', !r.bad.length && r.cv[0] > 100 && r.cv[1] > 40 && r.page, JSON.stringify(r)); await q.close();
  }
  await b.close();
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
})();
