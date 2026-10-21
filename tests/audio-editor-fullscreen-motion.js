// Going to full screen and back is one motion: the window itself grows from its own size and place (and shrinks back), the picture (waveform or spectrogram) goes with it, redrawn at every size,
// and no frame shows the picture at its final size ahead of the window. A frame record is taken each frame: the window's and picture's rectangles, the picture's bitmap, the parts' opacity.
// With reduced motion the end state is reached at once.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-fullscreen-motion.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const record = (p, ms) => p.evaluate(ms => new Promise(res => {
  const q = s => document.querySelector(s), box = q('#audioDlg .dlg'), out = [], t0 = performance.now(), r = e => { const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, w: x.width, h: x.height }; };
  q('#aeFull').click();
  (function f() { const t = performance.now() - t0, cv = q('#aeCanvas'); out.push({ t, box: r(box), cv: r(cv), bw: cv.width, bo: +getComputedStyle(box).opacity, bh: cv.height, dn: getComputedStyle(q('#aeDone').closest('.row')).visibility, dh: q('#aeDone').getBoundingClientRect().height, wo: +getComputedStyle(q('.ae-wave')).opacity, parts: ['.ed-head', '.ae-bar', '.ae-main'].map(s => +getComputedStyle(q(s)).opacity) });
    if (t < ms) requestAnimationFrame(f); else res(out); })();
}), ms);
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [calm, VW, VH] of [[false, 1280, 800], [true, 1280, 800], [false, 390, 800], [false, 760, 600]]) {
    const ctx = await b.newContext({ viewport: { width: VW, height: VH }, reducedMotion: calm ? 'reduce' : 'no-preference' }), p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(900);
    for (const view of ['wave', 'spec']) {
      if (view === 'spec') { await p.evaluate(() => document.querySelector('#aeView input[value=spec]').click()); await p.waitForTimeout(1500); }
      const geo = () => p.evaluate(() => { const r = e => { const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, w: x.width, h: x.height }; }; return { box: r(document.querySelector('#audioDlg .dlg')), cv: r(document.querySelector('#aeCanvas')) }; });
      const normal = await geo(); const full = { l: 0, t: 0, w: VW, h: VH };
      for (const dir of ['in', 'out']) {
        const from = dir === 'in' ? normal.box : full, to = dir === 'in' ? full : normal.box, tag = (calm ? 'reduced motion, ' : '') + (VW <= 760 ? 'phone, ' : '') + view + ' ' + (dir === 'in' ? 'to full screen' : 'back to the window') + ': ';
        const rec = await record(p, 1300), first = rec[0], end = rec[rec.length - 1], near = (a, c, tol) => Math.abs(a.l - c.l) <= tol && Math.abs(a.t - c.t) <= tol && Math.abs(a.w - c.w) <= tol && Math.abs(a.h - c.h) <= tol;
        if (calm) {
          ok(tag + 'the end state is reached at once', near(first.box, to, 1.5) && rec.every(f => f.bo === 1), JSON.stringify({ first: first.box, to }));
          ok(tag + 'nothing is left running', await p.evaluate(() => document.getAnimations().length === 0));
        } else {
          const prog = (v, a, c) => (v - a) / (c - a), span = to.w - from.w, steps = rec.slice(1).map((f, i) => Math.abs(f.box.w - rec[i].box.w) / Math.abs(span));
          ok(tag + 'the window starts from its own size and place (no pop to the final size)', first.t < 60 && Math.abs(prog(first.box.w, from.w, to.w)) < 0.2, JSON.stringify({ t: Math.round(first.t), w: first.box.w, from: from.w }));
          ok(tag + 'the window ends exactly where it belongs', near(end.box, to, 1.5), JSON.stringify({ end: end.box, to }));
          ok(tag + 'the window moves one way, in steps of under a third of the way', rec.every((f, i) => !i || (f.box.w - rec[i - 1].box.w) * Math.sign(span) >= -0.5) && Math.max(...steps) < 0.34, 'largest step ' + Math.round(Math.max(...steps) * 100) + '%');
          const lead = rec.filter(f => { const pb = prog(f.box.w, from.w, to.w), cvFrom = dir === 'in' ? normal.cv.w : VW, cvTo = dir === 'in' ? VW : normal.cv.w, pc = prog(f.cv.w, cvFrom, cvTo); return Math.abs(pb - pc) > 0.12; });
          ok(tag + 'the picture goes with the window: no frame has it ahead of or behind the window', !lead.length, lead.length + ' frame(s) off, e.g. ' + JSON.stringify(lead[0] && { t: Math.round(lead[0].t), box: lead[0].box.w, cv: lead[0].cv.w }));
          ok(tag + 'the picture is redrawn once, when the other layout takes over, and not at every size', new Set(rec.map(f => f.bw)).size <= 2, JSON.stringify([...new Set(rec.map(f => f.bw))]));
          const stretch = rec.map(f => Math.max(f.cv.w / f.bw, f.bw / f.cv.w, f.cv.h / f.bh, f.bh / f.cv.h)), seen = rec.filter((f, i) => stretch[i] > 1.8 && f.wo > 0.9);
          ok(tag + 'a picture stretched past 1.8 times its drawn size is always dimmed', !seen.length, seen.length + ' frame(s), e.g. ' + JSON.stringify(seen[0] && { t: Math.round(seen[0].t), wo: seen[0].wo, stretch: +Math.max(...stretch).toFixed(2) }));
          ok(tag + 'the picture never goes empty: it eases to half strength at the hand-over and is solid at both ends', rec.every(f => f.wo >= 0.4) && rec[0].wo === 1 && end.wo === 1, JSON.stringify({ least: Math.min(...rec.map(f => f.wo)), first: rec[0].wo, end: end.wo }));
          ok(tag + 'the window itself never fades', rec.every(f => f.bo === 1), JSON.stringify(rec.filter(f => f.bo !== 1).slice(0, 2).map(f => [Math.round(f.t), f.bo])));
          const settled = rec.filter(f => f.t > 1000), still = settled.every(f => Math.abs(f.cv.h - end.cv.h) < 0.6 && Math.abs(f.cv.w - end.cv.w) < 0.6 && f.parts.every((o, k) => o === end.parts[k]));
          ok(tag + 'nothing keeps moving after the motion ends', still, JSON.stringify(settled.filter(f => Math.abs(f.cv.h - end.cv.h) >= 0.6).slice(0, 2).map(f => [Math.round(f.t), f.cv.h, end.cv.h])));
        }
        ok(tag + 'the picture ends at the size it is shown (crisp), and the bars are back at full strength (the tool window stays docked off on a phone)', Math.abs(end.bw - end.cv.w * 1) <= 2 && end.parts.every((o, k) => o === 1 || (k === 2 && dir === 'in' && VW <= 760)), JSON.stringify({ bitmap: end.bw, shown: end.cv.w, parts: end.parts }));
        if (dir === 'in') { const rogue = await p.evaluate(() => [...document.querySelector('#audioDlg .dlg').children].filter(el => !el.matches('.ed-head, .ae-wave, .ae-bar, .ae-main, .ed-lead') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden').map(el => el.className || el.tagName));
          ok(tag + 'nothing in the window is left showing in full screen unless it is part of the layout (a part is hidden, never just covered)', !rogue.length, rogue.join(', ')); }
        if (dir === 'in') ok(tag + 'the buttons row (Export audio, Cancel, Done) is hidden in full screen, so a stretched Done is never seen', end.dn === 'hidden', 'visibility ' + end.dn + ', Done ' + Math.round(end.dh) + 'px tall');
        await p.waitForTimeout(300);
      }
      const after = await geo(); ok((calm ? 'reduced motion, ' : '') + (VW <= 760 ? 'phone, ' : '') + view + ': after the round trip the window is where it started', Math.abs(after.box.l - normal.box.l) < 1.5 && Math.abs(after.box.w - normal.box.w) < 1.5 && Math.abs(after.cv.h - normal.cv.h) < 1.5, JSON.stringify({ after: after.box, normal: normal.box }));
    }
    await ctx.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
