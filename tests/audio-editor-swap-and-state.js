// Normalize swap motion in the Audio Editor, and the Runs line (its order, its bypassed chip, and the cable inside the tool list).
// Normalize: going between Peak and Loudness changes only what is shown under the switch: the controls leaving and arriving stay where they are (they fade, and the one leaving is wiped away upward),
// nothing slides down, and the card does not change size.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-swap-and-state.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500);
  await p.evaluate(() => aeTool('level')); await p.waitForTimeout(800);
  const swap = async (from, to) => {
    await p.click('#aeNormMode label:has(input[value=' + from + '])'); await p.waitForTimeout(900);
    return p.evaluate(to => new Promise(res => {
      const q = s => document.querySelector(s), out = [], t0 = performance.now(), top = e => Math.round(e.getBoundingClientRect().top * 10) / 10;
      q('#aeNormMode label:has(input[value=' + to + '])').click();
      (function f() { const t = performance.now() - t0; out.push({ t, card: q('#aeNormCard').getBoundingClientRect().height, peak: top(q('#aeNormTarget')), preset: top(q('#aeLoudPreset')), po: +getComputedStyle(q('#aePeakFold>.fa-in')).opacity, lo: +getComputedStyle(q('#aeLoudFold>.fa-in')).opacity }); if (t < 800) requestAnimationFrame(f); else res(out); })();
    }), to);
  };
  for (const [from, to, arrive, leave] of [['loud', 'peak', 'peak', 'preset'], ['peak', 'loud', 'preset', 'peak']]) {
    const rec = await swap(from, to), end = rec[rec.length - 1], key = { peak: 'po', preset: 'lo' };
    const rest = rec.map(f => f[arrive]).concat(rec.map(f => f[leave]));
    ok(from + ' to ' + to + ': the controls arriving and leaving stay where they are (nothing slides)', Math.max(...rec.map(f => f[arrive])) - Math.min(...rec.map(f => f[arrive])) < 0.6 && Math.max(...rec.map(f => f[leave])) - Math.min(...rec.map(f => f[leave])) < 0.6, JSON.stringify({ arrive: [Math.min(...rec.map(f => f[arrive])), Math.max(...rec.map(f => f[arrive]))], leave: [Math.min(...rec.map(f => f[leave])), Math.max(...rec.map(f => f[leave]))] }));
    ok(from + ' to ' + to + ': the card keeps its size', Math.max(...rec.map(f => f.card)) - Math.min(...rec.map(f => f.card)) < 0.6, JSON.stringify(rec.map(f => f.card).filter((v, i, a) => a.indexOf(v) === i)));
    const k1 = to === 'peak' ? 'po' : 'lo', k0 = to === 'peak' ? 'lo' : 'po';
    ok(from + ' to ' + to + ': the old one fades out and the new one fades in, and it ends with only the new one showing', end[k1] === 1 && end[k0] === 0 && rec[0][k0] > 0.9 && rec[0][k1] < 0.1, JSON.stringify({ start: [rec[0][k0], rec[0][k1]], end: [end[k0], end[k1]] }));
  }
  // The Runs line: Fades is listed before Level, as in the tool list; a bypassed chip keeps a visible pill in both themes and is the same shape as the others; the cable stays inside the tool list with any one tool lit alone and with all six
  const c = await b.newPage(); c.setDefaultTimeout(60000); const cerrs = []; c.on('pageerror', e => cerrs.push(e.message));
  await c.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await c.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
  await c.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
  await c.evaluate(() => openAudioEditor()); await c.waitForTimeout(500);
  const lit = t => c.evaluate(t => new Promise(res => {          // the tools that are on: one name, 'all', or none
    const on = n => t === 'all' || t === n; aePush(); const fx = AE.d.fx;
    fx.noise.on = on('noise'); fx.spec.on = on('spec'); fx.eq.on = on('eq'); fx.eq.bands = on('eq') ? [{ type: 'peaking', f: 1000, g: 6, q: 1, on: true }] : []; fx.imager.on = on('imager'); fx.imager.width = on('imager') ? 140 : 100;
    AE.d.audioFades = on('fades'); AE.d.gainDb = on('level') ? 12 : 0; aeRefresh(); aeLive(); setTimeout(res, 1800);
  }), t);
  const cable = () => c.evaluate(() => {
    const body = document.querySelector('#aeRailBody').getBoundingClientRect(), paths = [...document.querySelectorAll('#aeWires path.w-front')];
    let minL = 1e9, maxR = -1e9; paths.forEach(p => { const r = p.getBoundingClientRect(); minL = Math.min(minL, r.left); maxR = Math.max(maxR, r.right); });
    return { n: paths.length, left: +(minL - body.left).toFixed(1), right: +(body.right - maxR).toFixed(1) };
  });
  const cableOk = async (label, t) => { await lit(t); const k = await cable(); ok('the cable stays inside the tool list: ' + label, k.n > 0 && k.left >= 2.5 && k.right >= 2.5, JSON.stringify(k)); };
  for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level']) await cableOk(t + ' alone', t);
  await cableOk('all six together', 'all');
  {
    await lit('fades'); await c.evaluate(() => { AE.d.gainDb = 12; aeRefresh(); aeLive(); }); await c.waitForTimeout(300);
    const names = await c.evaluate(() => ({ names: [...document.querySelectorAll('#aeChain b')].map(b => b.textContent), order: aeChainOrder(AE.d).slice(-2) }));
    ok('the Runs line lists Fades before Level, as the tool list does', names.names.join() === 'Fades,Level' && names.order.join() === 'fades,level', JSON.stringify(names));
  }
  {
    await lit('none'); await lit('noise');
    await c.evaluate(() => { aePush(); AE.d.fx.eq.on = true; AE.d.fx.eq.bands = [{ type: 'peaking', f: 1000, g: 6, q: 1, on: true }]; AE.d.audioFades = true; aeRefresh(); aeLive(); });
    await c.evaluate(() => new Promise(r => setTimeout(r, 1500)));
    const chips = async () => c.evaluate(() => {
      const probe = css => { const i = document.createElement('i'); i.style.cssText = css; document.body.appendChild(i); const v = getComputedStyle(i).backgroundColor; i.remove(); return v; };
      return [...document.querySelectorAll('#aeChain b')].map(b => { const s = getComputedStyle(b), r = b.getBoundingClientRect(); return { text: b.textContent, title: b.title, bp: b.classList.contains('bp'), top: +r.top.toFixed(1), h: +r.height.toFixed(1), pad: s.paddingTop + ' ' + s.paddingRight + ' ' + s.paddingBottom + ' ' + s.paddingLeft, bg: s.backgroundColor, shadow: s.boxShadow, color: s.color, deco: s.textDecorationLine, panel2: probe('background:var(--panel2)'), muted: probe('background:var(--muted)') }; });
    });
    for (const theme of ['light', 'dark']) {
      await c.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme); await c.waitForTimeout(300);
      for (const pick of ['first', 'middle', 'last']) {
        const row = await c.evaluate(() => [...document.querySelectorAll('#aeChain b')].map(b => b.textContent));
        const tool = { first: 'Noise reduction', middle: 'EQ', last: 'Fades' }[pick];
        if (!row.includes(tool)) { ok('chips: ' + tool + ' is in the Runs line', false, row.join()); continue; }
        await c.evaluate(t => { const k = Object.keys(AE_NAMES).find(x => AE_NAMES[x] === t); aeTool(k); }, tool); await c.waitForTimeout(700);
        await c.evaluate(() => aeToggleBypass()); await c.waitForTimeout(600);
        const all = await chips(), bp = all.find(x => x.bp), others = all.filter(x => !x.bp);
        ok(theme + ': bypassing ' + tool + ' (' + pick + ' chip) gives a Bypassed chip with a visible pill, the same box and muted struck text', !!bp && bp.text === tool && bp.title === 'Bypassed' && bp.shadow !== 'none' && bp.bg !== bp.panel2 && bp.color === bp.muted && bp.deco.includes('line-through') && others.every(o => o.h === bp.h && o.top === bp.top && o.pad === bp.pad), JSON.stringify({ bp, other: others[0] && { h: others[0].h, top: others[0].top, pad: others[0].pad } }));
        await c.evaluate(() => aeToggleBypass()); await c.waitForTimeout(600);
      }
    }
    await c.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  }
  {
    await lit('none'); await c.evaluate(() => aePush()); await c.evaluate(() => { AE.d.gainDb = 12; aeRefresh(); aeLive(); }); await c.waitForTimeout(700);
    await c.evaluate(() => { aePush(); AE.d.audioFades = true; aeRefresh(); aeLive(); }); await c.waitForTimeout(700);
    await c.evaluate(() => aeUndo()); await c.waitForTimeout(2500);
    const left = await c.evaluate(() => document.querySelectorAll('#aeWires circle.w-plug.drag').length);
    ok('after an Undo switches Fades off, no blue dot is left on the wires', left === 0, 'dots left: ' + left);
  }
  {
    await c.setViewportSize({ width: 760, height: 900 }); await lit('all'); await c.waitForTimeout(300);
    const k = await c.evaluate(() => { const ch = document.querySelector('#aeChain'), st = document.querySelector('#aeStat'), r = ch.getBoundingClientRect(), s = st.getBoundingClientRect(); return { clipped: getComputedStyle(ch).overflow, inside: r.right <= s.right + 0.5, h: +r.height.toFixed(1) }; });
    ok('all six lit on a narrow window: the Runs line stays in its bar and clips', k.clipped === 'hidden' && k.inside && k.h <= 30, JSON.stringify(k));
  }
  ok('no page errors on the Runs line', !cerrs.length, cerrs.slice(0, 2).join(' | '));
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
