// The row under the preview (Back, Play, the time, Add page turn, the spread label) keeps one height while the playhead moves, at every window width: the label sits in a box
// as wide as the longest label the score can show, so a longer one never wraps to a second row and makes the preview above it grow and shrink.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-transport-steady.js
const { chromium } = require('playwright-core'); const { PDFDocument } = require('../vendor/pdf-lib.min.js');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  // a 200-page score, so the labels run from "Spread 1 / 101 · p. 1" to "Spread 100 / 101 · pp. 198–199"
  const doc = await PDFDocument.create(); for (let i = 0; i < 200; i++) doc.addPage([420, 560]); const bytes = Buffer.from(await doc.save());
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', { name: 'long.pdf', mimeType: 'application/pdf', buffer: bytes });
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 }); await p.waitForTimeout(800);
  const pick = v => p.evaluate(v => { const r = document.querySelector('input[name=pageLayout][value=' + v + ']'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  // where the row, the preview, and the label are with the playhead at t
  const at = t => p.evaluate(([K, t]) => {
    const S = window[K].S; S.time = t; updateTimeUI(true);
    const box = q => { const r = document.querySelector(q).getBoundingClientRect(); return { w: r.width, h: r.height }; };
    const rect = q => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const now = document.querySelector('#spreadNow'), kids = [...document.querySelectorAll('#spreadMax>span')];
    return { tr: rect('#transport'), inf: rect('#spreadInfo'), tap: rect('#bTap'), time: rect('.transport .time'), lvl: document.querySelector('#transport').dataset.info, row: box('#transport'), stage: box('#stageWrap'), info: box('#spreadInfo'), text: now.textContent, nowW: now.getBoundingClientRect().width, maxW: Math.max(0, ...kids.map(k => k.getBoundingClientRect().width)) };
  }, [K, t]);
  const dur = await p.evaluate(K => window[K].duration(), K);
  for (const layout of ['spread', 'single']) {
    await pick(layout); await p.waitForTimeout(600);
    for (const w of [1300, 1040, 960, 800, 700, 560, 390]) {
      await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(500);
      const runs = []; for (let i = 0; i <= 24; i++) runs.push(await at(dur * i / 24));
      if (process.env.SHOTS) { await at(dur * 0.34); await p.screenshot({ path: process.env.SHOTS + '/transport-' + layout + '-' + w + '.png' }); }          // SHOTS=folder saves a picture of each size to look at
      const hs = new Set(runs.map(r => Math.round(r.row.h))), ss = new Set(runs.map(r => Math.round(r.stage.h))), is = new Set(runs.map(r => Math.round(r.info.w)));
      const texts = new Set(runs.map(r => r.text));
      ok(layout + ' ' + w + 'px: the row keeps one height while scrubbing', hs.size === 1, [...hs].join(','));
      ok(layout + ' ' + w + 'px: the preview keeps one size while scrubbing', ss.size === 1, [...ss].join(','));
      ok(layout + ' ' + w + 'px: the label box keeps one width', is.size === 1, [...is].join(','));
      const r0 = runs[0], overlaps = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
      ok(layout + ' ' + w + 'px: the label is on the right edge of the row', runs.every(r => Math.abs(r.inf.r - r.tr.r) <= 1.5), runs.map(r => Math.round(r.tr.r - r.inf.r)).join(','));
      ok(layout + ' ' + w + 'px: the label touches no button or the time', runs.every(r => !overlaps(r.inf, r.tap) && !overlaps(r.inf, r.time)), 'wording ' + r0.lvl + ', ' + (r0.inf.t > r0.tap.b - 4 ? 'own row' : 'same row'));
      ok(layout + ' ' + w + 'px: the wording does not change while scrubbing', new Set(runs.map(r => r.lvl)).size === 1, [...new Set(runs.map(r => r.lvl))].join(','));
      ok(layout + ' ' + w + 'px: the label shows more than one text and always fits its box', texts.size > 1 && runs.every(r => r.nowW <= r.maxW + 0.5), [...texts].join(' | '));
    }
    await p.setViewportSize({ width: 1300, height: 900 });
  }
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})();
