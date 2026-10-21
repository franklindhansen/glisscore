// Video credits at the start: the Credits at choice (Start | End), credits on the left of the opening spread, the dimmed Start with its reason lines and bounce-back,
// the automatic move to End with its toast, the new End wording, and the empty-credits line gone.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-credits-at.js
const { chromium } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes', URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (file, w = 1300, scheme) => {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme || 'light' });
    const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.setInputFiles('#pdfIn', file);
    await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800); return p;
  };
  const twoPage = path.join(os.tmpdir(), 'kf-credits-two.pdf');
  { const d = await PDFDocument.create(); d.addPage([612, 792]); d.addPage([612, 792]); fs.writeFileSync(twoPage, await d.save()); }
  const p = await open(FX + '/score.pdf');
  const S = (f, arg) => p.evaluate(([K, f, arg]) => { const s = window[K].S; return eval('(' + f + ')')(s, arg); }, [K, String(f), arg]);
  const wait = ms => p.waitForTimeout(ms);
  const pick = (name, v) => p.evaluate(([name, v]) => { const r = document.querySelector('input[name=' + name + '][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, [name, v]);
  const sw = (id, on) => p.evaluate(([id, on]) => { const e = document.querySelector(id); e.checked = on; e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, on]);
  const undo = () => p.evaluate(() => document.querySelector('#bUndo').click());
  const toastText = () => p.evaluate(() => { const t = document.querySelector('#toast'); return t.classList.contains('show') ? t.textContent : ''; });
  const setText = () => S(s => { s.credits.title = 'Test piece'; s.credits.titleEdited = true; s.set.creditsOn = true; });
  const resync = async () => { await p.evaluate(() => { syncCredits(); }); await wait(500); };
  const vis = sel => p.evaluate(sel => { const e = document.querySelector(sel); if (!e || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
  const checked = name => p.evaluate(name => { const r = document.querySelector('input[name=' + name + ']:checked'); return r ? r.value : null; }, name);
  const labels = sel => p.evaluate(sel => [...document.querySelectorAll(sel + ' label')].map(l => l.textContent.trim()).join('|'), sel);
  // what the preview draws at t: the left half of the page area against the background
  const look = (t, opts = {}) => p.evaluate(async ([K, t, opts]) => {
    const kf = window[K], r = kf.previewR, st = kf.frameState(t); st.fade = 1;
    await new Promise(res => { r.onUpdate = null; (function wait(n) { r.render(st); if (!r.pending.size || n > 40) res(); else setTimeout(() => wait(n + 1), 50); })(0); });
    r.render(st);
    const c = r.canvas, W = c.width, H = c.height, o = document.createElement('canvas'); o.width = W; o.height = H;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0); const lay = r.lay, bg = kf.S.set.bg;
    const px = (X, Y) => Array.from(x.getImageData(Math.round(X), Math.round(Y), 1, 1).data);
    const d = x.getImageData(Math.round(lay.x0), Math.round(lay.y0), Math.round(lay.cx - lay.x0), Math.round(lay.ph)).data;
    const bgc = [parseInt(bg.slice(1, 3), 16), parseInt(bg.slice(3, 5), 16), parseInt(bg.slice(5, 7), 16)];
    let diff = 0, lighter = 0, darker = 0, n = 0, corner = px(lay.x0 + 3, lay.y0 + 3);
    for (let i = 0; i < d.length; i += 16) { n++; const dd = Math.abs(d[i] - bgc[0]) + Math.abs(d[i + 1] - bgc[1]) + Math.abs(d[i + 2] - bgc[2]); if (dd > 60) { diff++; if (d[i] > bgc[0]) lighter++; else darker++; } }
    return { diff: diff / n, lighter, darker, corner, bgc };
  }, [K, t, opts]);
  const cardSet = async () => { await S(s => { s.set.creditsOn = true; s.set.firstAlone = true; s.credits.title = 'Test piece'; s.credits.titleEdited = true; }); await p.evaluate(() => { applyGroupSwitches(); }); };

  // --- default and settings round trip
  ok('Credits at defaults to End and the End radio is checked', await S(s => s.set.creditsAt) === 'end' && await checked('creditsAt') === 'end');
  ok('Credits at has Start and End', await labels('#creditsAtField .seg') === 'Start|End', await labels('#creditsAtField .seg'));
  ok('creditsAt survives export and import of settings', await p.evaluate(() => { S.set.creditsAt = 'start'; const o = JSON.parse(buildExport('settings')).settings; const c = cleanSettings(o).creditsAt; S.set.creditsAt = 'end'; return o.creditsAt === 'start' && c === 'start' && cleanSettings({ creditsAt: 'sideways' }).creditsAt === undefined; }));

  // --- Start on a three-page Spread score
  await cardSet(); await pick('creditsAt', 'start'); await resync(); await wait(300);
  await S(s => { s.set.creditsOn = false; }); await resync();
  const offN = await S(s => ({ sp: s.spreads.length, tu: s.turns.length })); await S(s => { s.set.creditsOn = true; }); await resync();
  const on = await S(s => ({ first: s.spreads[0].slice(), sp: s.spreads.length, tu: s.turns.length, has: !!(s.spreads[s.spreads.length - 1].credits), end: s.creditsEnd }));
  ok('Start puts the credits card on the left of the first spread', on.first[0] === -2 && on.first[1] >= 0, JSON.stringify(on));
  ok('spreads and turns equal the same work with credits off', on.sp === offN.sp && on.tu === offN.tu, JSON.stringify([on, offN]));
  ok('no ending spread, no credits end marker', on.has === false && on.end == null );
  const hdl = await p.evaluate(() => hasCreditsSpread());
  ok('hasCreditsSpread is false at Start, so no handle, teal marker, or tail', hdl === false && await p.evaluate(() => defaultEnd() === audioLen()));

  // --- shown from t=0 until the first turn, in every transition, even with creditsEarly saved true
  await S(s => { s.set.creditsEarly = true; });
  let allOk = true; const det = [];
  for (const tr of ['flip', 'slide', 'cut']) {
    await S((s, tr) => { s.set.transition = tr; }, tr); await resync();
    const t0 = await S(s => s.vStart), t1 = await S(s => s.turns[0] + 2);
    const a = await look(t0 + 0.05), z = await look(t1);
    const pass = a.diff > 0.003 && a.diff < 0.2 && z.diff > 0.5; det.push([tr, a.diff.toFixed(4), z.diff.toFixed(4)]); allOk = allOk && pass;
  }
  ok('with creditsEarly saved true the credits show from t=0 and are covered after the first turn, in Turn, Slide, and Cut', allOk, JSON.stringify(det));
  await S(s => { s.set.transition = 'flip'; });
  const mid = await S(s => s.turns[0] - s.set.flipDur * 0.5 - 0.01);
  ok('the credits are fully visible right up to the first turn (no fade-out)', (await look(mid)).diff > 0.003);

  // --- ink on background, no panel
  const inkRes = [];
  for (const bg of ['#000000', '#FCFCFC']) {
    await S((s, bg) => { s.set.bg = bg; }, bg); await wait(200);
    const a = await look(await S(s => s.vStart + 0.05));
    const dark = bg === '#000000', cornerOk = a.corner.slice(0, 3).every((v, i) => Math.abs(v - a.bgc[i]) <= 3);
    inkRes.push([bg, cornerOk && (dark ? a.lighter > a.darker : a.darker > a.lighter) && a.diff > 0.003 && a.diff < 0.2]);
  }
  ok('the credits are drawn light on Black and dark on Cloud White, over the plain background with no panel', inkRes.every(x => x[1]), JSON.stringify(inkRes));
  await S(s => { s.set.bg = '#000000'; });

  // --- rows close at Start, open at End
  await wait(500);
  ok('Credits appear and Credits end close at Start', !(await vis('#creditsWithLastField')) && !(await vis('#creditsEarlyField')));
  ok('their saved choices stay (Credits end stays Custom)', await S(s => s.set.creditsEarly) === true && await S(s => s.set.creditsWithLast) !== undefined);
  await pick('creditsAt', 'end'); await wait(700);
  ok('Credits end opens at End', await vis('#creditsEarlyField'));
  ok('the End labels read as in the spec', await p.evaluate(() => document.querySelector('#credStartLbl').textContent) === 'Credits appear' && await labels('#creditsEarlyField .seg') === 'With video|Custom', await labels('#creditsEarlyField .seg'));
  ok('End builds today\'s ending again', await S(s => !!s.spreads[s.spreads.length - 1].credits || !!s.spreads[s.spreads.length - 1].inlineCredits));
  await pick('creditsAt', 'start'); await wait(300);

  // --- the dimmed Start, its reasons, the bounce-back
  const hint = () => p.evaluate(() => { const e = document.querySelector('#creditsAtHint'); return { text: e.textContent.trim(), html: e.innerHTML, vis: !e.hidden && e.getBoundingClientRect().height > 0, sw: !!e.querySelector('.hb.sw'), hb: !!e.querySelector('.hb:not(.sw)') }; });
  const startState = () => p.evaluate(() => { const r = document.querySelector('input[name=creditsAt][value=start]'); return { dis: r.disabled, aria: r.getAttribute('aria-disabled'), dim: r.closest('label').classList.contains('dim'), desc: r.getAttribute('aria-describedby') }; });
  const bounce = async (how) => {
    const before = await S(s => s.set.creditsAt);
    if (how === 'click') await p.evaluate(() => document.querySelector('input[name=creditsAt][value=start]').closest('label').click());
    else { await p.evaluate(() => document.querySelector('input[name=creditsAt][value=end]').focus()); await p.keyboard.press('ArrowLeft'); }
    await wait(60); const flash = await p.evaluate(() => document.querySelector('#creditsAtHint').classList.contains('flash') || document.querySelector('#creditsAtHint').getAnimations().length > 0);
    await wait(700); return { before, after: await S(s => s.set.creditsAt), chk: await checked('creditsAt'), flash, toast: await toastText() };
  };
  await pick('creditsAt', 'end'); await wait(300);
  ok('when Start is available and End is chosen the reason line is closed and Start is not dimmed', !(await hint()).vis && !(await startState()).dim);
  // Single page
  await pick('pageLayout', 'single'); await wait(800);
  let st = await startState(), h = await hint();
  ok('Single page: Start is dimmed with aria-disabled, never disabled, and the line says Requires Spread layout.', st.dim && st.aria === 'true' && st.dis === false && st.desc === 'creditsAtHint' && h.vis && h.text === 'Requires Spread layout.' && h.hb && !h.sw, JSON.stringify([st, h]));
  let bo = await bounce('click');
  ok('clicking dimmed Start leaves End checked, flashes the line, and shows no toast', bo.after === 'end' && bo.chk === 'end' && bo.flash && bo.toast === '', JSON.stringify(bo));
  bo = await bounce('key');
  ok('arrowing onto dimmed Start leaves End checked and flashes the line', bo.after === 'end' && bo.chk === 'end' && bo.flash, JSON.stringify(bo));
  await pick('pageLayout', 'spread'); await wait(800);
  // First page alone off
  await sw('#firstAlone', false); await wait(800);
  st = await startState(); h = await hint();
  ok('First page alone off: dimmed, and the line shows the switch chip', st.dim && h.vis && h.text === 'Requires First page alone.' && h.sw, JSON.stringify([st, h]));
  await sw('#firstAlone', true); await wait(800);
  ok('First page alone back on: Start is available again and the line closes', !(await startState()).dim && !(await hint()).vis);
  // two-page score
  const q = await open(twoPage);
  const Q = f => q.evaluate(([K, f]) => { const s = window[K].S; return eval('(' + f + ')')(s); }, [K, String(f)]);
  await q.evaluate(() => { S.credits.title = 'Test piece'; S.set.creditsOn = true; applyGroupSwitches(); syncCredits(); }); await q.waitForTimeout(700);
  const qs = await q.evaluate(() => { const r = document.querySelector('input[name=creditsAt][value=start]'), e = document.querySelector('#creditsAtHint'); return { dim: r.closest('label').classList.contains('dim'), text: e.textContent.trim(), vis: !e.hidden && e.getBoundingClientRect().height > 0, sw: !!e.querySelector('.hb') }; });
  ok('a two-page score: dimmed, and the plain line says Requires 3 or more pages.', qs.dim && qs.vis && qs.text === 'Requires 3 or more pages.' && !qs.sw, JSON.stringify(qs));
  ok('the reasons visible without hovering (no title or tooltip needed)', qs.vis);
  // saved Start opens as End on a two-page score, with the toast
  await q.evaluate(() => { S.set.creditsAt = 'start'; saveSettings(); rebuildSpreads(true); });
  await q.waitForTimeout(300);
  ok('Start chosen and a two-page score opens: moved to End with the toast', await Q(s => s.set.creditsAt) === 'end' && await q.evaluate(() => document.querySelector('#toast').textContent) === 'Credits moved to the end. Start requires 3 or more pages.');
  await q.close();

  // --- Start stops being possible: First page alone off, and Single page; one Undo restores both
  await pick('creditsAt', 'start'); await wait(300); await cardSet(); await resync();
  const h0 = await S(s => s.history.length);
  await sw('#firstAlone', false); await wait(900);
  ok('First page alone off with Start chosen moves credits to End and shows the toast', await S(s => s.set.creditsAt) === 'end' && await toastText() === 'Credits moved to the end. Start requires First page alone.', await toastText());
  ok('it is one History step', await S((s, h0) => s.history.length === h0 + 1, h0));
  await undo(); await wait(700);
  ok('one Undo restores First page alone and Start', await S(s => s.set.firstAlone === true && s.set.creditsAt === 'start') && await checked('creditsAt') === 'start' && await p.evaluate(() => document.querySelector('#firstAlone').checked));
  await sw('#firstAlone', false); await wait(900); await sw('#firstAlone', true); await wait(900);
  ok('turning First page alone back on does not move credits back to Start', await S(s => s.set.creditsAt) === 'end');
  await pick('creditsAt', 'start'); await wait(300);
  await p.evaluate(() => { document.querySelector('#toast').classList.remove('show'); });
  await pick('pageLayout', 'single'); await wait(900);
  ok('Single page with Start chosen moves credits to End with the toast', await S(s => s.set.creditsAt) === 'end' && await toastText() === 'Credits moved to the end. Start requires Spread layout.', await toastText());
  await undo(); await wait(900);
  ok('one Undo restores Spread layout and Start', await S(s => s.set.pageLayout === 'spread' && s.set.creditsAt === 'start'), JSON.stringify(await S(s => [s.set.pageLayout, s.set.creditsAt])));
  await pick('creditsAt', 'end');

  // --- the empty-credits line is gone, the export warning stays
  ok('the inline empty-credits line is gone', await p.evaluate(() => !document.querySelector('#credEmptyWarn') && !/Credits are enabled but empty/.test(document.querySelector('.panel').textContent)));
  await S(s => { s.credits.title = ''; s.credits.l2 = ''; s.credits.l3 = ''; s.set.creditsOn = true; });
  const asked = await p.evaluate(async () => { const seen = [], was = window.askWarn; window.askWarn = (title, ...r) => { seen.push(title); return Promise.resolve(title !== 'Credits are enabled but empty'); }; try { await onExportClick(); } catch (e) {} window.askWarn = was; return seen; });
  ok('exporting with credits on and no text still shows the warning dialog', asked.includes('Credits are enabled but empty'), JSON.stringify(asked));

  // --- the group summary and the tooltip
  ok('the credits tooltip is true for both ends', await p.evaluate(() => /beside the first page or at the end/.test(document.querySelector('[data-tip="tip.credits"]').textContent)));

  // --- spacing is even and the rows glide in each combination
  const gaps = async () => p.evaluate(() => {
    const g = [...document.querySelectorAll('.group')].find(x => x.dataset.sum === 'credits'); const rows = [...g.querySelectorAll('.group-body > .field')].filter(e => !e.hidden && e.getBoundingClientRect().height > 0).map(e => e.getBoundingClientRect());
    return rows.slice(1).map((r, i) => Math.round(r.top - rows[i].bottom));
  });
  const spacing = [];
  for (const w of [1040, 700, 390]) for (const scheme of ['light', 'dark']) {
    const r = await open(FX + '/score.pdf', w, scheme);
    const R = f => r.evaluate(f);
    await R(() => { S.credits.title = 'Test piece'; S.credits.titleEdited = true; S.set.creditsOn = true; applyGroupSwitches(); syncCredits(); });
    for (const c of ['end-with', 'end-after', 'start']) {
      await R(c => { S.set.creditsAt = c === 'start' ? 'start' : 'end'; S.set.creditsWithLast = c !== 'end-after'; syncControls(); syncCredits(); applyCreditsUI(); }, c).catch(() => {});
      await r.waitForTimeout(700);
      const gs = await r.evaluate(() => { const g = [...document.querySelectorAll('.group')].find(x => x.dataset.sum === 'credits'); const rows = [...g.querySelectorAll('.group-body > .field')].filter(e => !e.hidden && e.getBoundingClientRect().height > 0).map(e => e.getBoundingClientRect()); return rows.slice(1).map((x, i) => Math.round(x.top - rows[i].bottom)); });
      spacing.push([w, scheme, c, Math.max(...gs) - Math.min(...gs)]);
    }
    await r.context().close();
  }
  ok('gaps between the Credits rows are even in each combination at 1040px, 700px, and 390px, light and dark', spacing.every(x => x[3] <= 2), JSON.stringify(spacing.filter(x => x[3] > 2)));

  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
