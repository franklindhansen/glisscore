// Button families: measures every visible button-like control across the app (main view, each Audio Editor tool, each PDF Editor tool, the dialogs) and writes one row per family to the file named by OUT (default: prints them).
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules OUT=rows.json node tests/ui-buttons.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const SEL = 'button, .btn, .icon-btn, .fmt-btn, .seg, .mt-chip, .info-i, .sl-end, .menu-item, .btn-group, .band-pill, .ae-bypill, .combo-list li, [role=button]';
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: +process.env.W || 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.setInputFiles('#audioIn', FX + '/stereo.wav');
  await p.waitForFunction(() => S.pdf && S.audio && S.audio.buffer); await p.waitForTimeout(1200);
  const rows = new Map();
  const grab = async where => {
    const got = await p.evaluate(([SEL, where]) => {
      const out = [];
      document.querySelectorAll(SEL).forEach(el => {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') return;
        for (let a = el; a; a = a.parentElement) if (getComputedStyle(a).visibility === 'hidden' || +getComputedStyle(a).opacity === 0) return;
        const cls = [...el.classList].filter(c => !/^(on|act|open|loading|busy|say|exporting|hot|sel|lit|dim|disabled)$/.test(c)).sort().join('.');
        const par = (el.closest('[id]') || {}).id || '';
        out.push({ key: el.tagName.toLowerCase() + (cls ? '.' + cls : ''), where, par, h: +r.height.toFixed(1), w: +r.width.toFixed(1), pad: cs.padding, rad: cs.borderRadius, fs: cs.fontSize, txt: (el.textContent || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 18), dis: el.disabled || el.getAttribute('aria-disabled') === 'true' });
      });
      return out;
    }, [SEL, where]);
    for (const g of got) { const k = g.key + '|' + g.h + '|' + g.rad + '|' + g.pad + '|' + g.fs; if (!rows.has(k)) rows.set(k, { ...g, n: 0, where: new Set(), ex: new Set() }); const e = rows.get(k); e.n++; e.where.add(g.where); if (e.ex.size < 3) e.ex.add(g.par + ':' + g.txt); }
  };
  const tabs = async (root, tag) => {
    const names = await p.evaluate(root => [...document.querySelectorAll(root + ' [data-tool]')].map(t => t.getAttribute('data-tool')), root);
    for (const n of names) { await p.evaluate(([root, n]) => document.querySelector(root + ' [data-tool="' + n + '"]').click(), [root, n]); await p.waitForTimeout(600); await grab(tag + ':' + n); }
  };
  await grab('main');
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(800); await grab('audio'); await tabs('#aeRail', 'audio');
  await p.evaluate(() => { try { closeAudioEditor && closeAudioEditor(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(900); await grab('pdf'); await tabs('#peRail', 'pdf');
  await p.evaluate(() => { try { closePdfEditor && closePdfEditor(); } catch (e) {} }); await p.waitForTimeout(500);
  // families that are not on screen in any view above (folded or closed): their computed (CSS) values, with 'auto' where the height follows the content
  const hid = await p.evaluate(SEL => { const o = {}; document.querySelectorAll(SEL).forEach(el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); if (r.width && r.height && cs.visibility !== 'hidden') return; const cls = [...el.classList].sort().join('.'), k = el.tagName.toLowerCase() + (cls ? '.' + cls : ''); if (!o[k]) o[k] = { key: k, where: 'hidden', h: cs.height, w: cs.width, pad: cs.padding, rad: cs.borderRadius, fs: cs.fontSize, ex: [(el.closest('[id]') || {}).id || ''], n: 0 }; o[k].n++; }); return Object.values(o); }, SEL);
  hid.forEach(e => rows.set('hid|' + e.key, { ...e, where: new Set(['hidden']), ex: new Set(e.ex) }));
  // SHOTS=dir: also save screenshots (light and dark) of the main view and a few tools, to compare by eye before and after a change
  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    for (const scheme of ['light', 'dark']) {
      await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(400);
      await p.screenshot({ path: process.env.SHOTS + '/' + scheme + '-main.png' });
      for (const f of [0.5, 1]) { await p.evaluate(f => { const h = [...document.querySelectorAll('*')].find(e => /^Page transition$/.test((e.textContent || '').trim()) && e.children.length === 0); for (let a = h; a; a = a.parentElement) if (a.scrollHeight > a.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(a).overflowY)) { a.scrollTop = a.scrollHeight * f; break; } }, f); await p.waitForTimeout(300); await p.screenshot({ path: process.env.SHOTS + '/' + scheme + '-panel-' + f * 100 + '.png' }); }
      await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(700);
      for (const t of ['noise', 'level', 'eq', 'fades']) { await p.evaluate(t => { try { aeTool(t); } catch (e) {} }, t); await p.waitForTimeout(600); await p.screenshot({ path: process.env.SHOTS + '/' + scheme + '-audio-' + t + '.png' }); }
      await p.evaluate(() => closeAudioEditor()); await p.waitForTimeout(500);
      await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(800);
      for (const t of ['arrange', 'crop', 'wm', 'resize']) { await p.evaluate(t => { try { peTool(t); } catch (e) {} }, t); await p.waitForTimeout(600); await p.screenshot({ path: process.env.SHOTS + '/' + scheme + '-pdf-' + t + '.png' }); }
      await p.evaluate(() => closePdfEditor()); await p.waitForTimeout(500);
    }
  }
  const arr = [...rows.values()].map(e => ({ ...e, where: [...e.where], ex: [...e.ex] })).sort((a, b) => a.key.localeCompare(b.key) || a.h - b.h);
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(arr, null, 1)); else console.log(JSON.stringify(arr));
  ok('measured ' + arr.length + ' button shapes', arr.length > 20);
  ok('no page errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
