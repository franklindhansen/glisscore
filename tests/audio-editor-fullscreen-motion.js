// Going to full screen and back is one motion: the window itself grows from its own size and place (and shrinks back), the picture (waveform or spectrogram) goes with it, redrawn at every size,
// and no frame shows the picture at its final size ahead of the window. A frame record is taken each frame: the window's and picture's rectangles, the picture's bitmap, the parts' opacity.
// With reduced motion the end state is reached at once.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-fullscreen-motion.js
const { chromium } = require('playwright-core');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const record = (p, ms) => p.evaluate(ms => new Promise(res => {
  const q = s => document.querySelector(s), box = q('#audioDlg .dlg'), out = [], t0 = performance.now(), r = e => { const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, w: x.width, h: x.height }; };
  q('#aeFull').click();
  (function f() { const t = performance.now() - t0, cv = q('#aeCanvas'); out.push({ t, box: r(box), cv: r(cv), bw: cv.width, bo: +getComputedStyle(box).opacity, parts: ['.ed-head', '.ae-bar', '.ae-main'].map(s => +getComputedStyle(q(s)).opacity) });
    if (t < ms) requestAnimationFrame(f); else res(out); })();
}), ms);
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [calm, VW, VH] of [[false, 1280, 800], [true, 1280, 800], [false, 390, 800]]) {
    const ctx = await b.newContext({ viewport: { width: VW, height: VH }, reducedMotion: calm ? 'reduce' : 'no-preference' }), p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
    await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(900);
    for (const view of ['wave', 'spec']) {
      if (view === 'spec') { await p.evaluate(() => document.querySelector('#aeView input[value=spec]').click()); await p.waitForTimeout(1500); }
      const geo = () => p.evaluate(() => { const r = e => { const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, w: x.width, h: x.height }; }; return { box: r(document.querySelector('#audioDlg .dlg')), cv: r(document.querySelector('#aeCanvas')) }; });
      const normal = await geo(); const full = { l: 0, t: 0, w: VW, h: VH };
      for (const dir of ['in', 'out']) {
        const from = dir === 'in' ? normal.box : full, to = dir === 'in' ? full : normal.box, tag = (calm ? 'reduced motion, ' : '') + (VW < 600 ? 'phone, ' : '') + view + ' ' + (dir === 'in' ? 'to full screen' : 'back to the window') + ': ';
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
          ok(tag + 'the window itself never fades', rec.every(f => f.bo === 1), JSON.stringify(rec.filter(f => f.bo !== 1).slice(0, 2).map(f => [Math.round(f.t), f.bo])));
          const settled = rec.filter(f => f.t > 1000), still = settled.every(f => Math.abs(f.cv.h - end.cv.h) < 0.6 && Math.abs(f.cv.w - end.cv.w) < 0.6 && f.parts.every((o, k) => o === end.parts[k]));
          ok(tag + 'nothing keeps moving after the motion ends', still, JSON.stringify(settled.filter(f => Math.abs(f.cv.h - end.cv.h) >= 0.6).slice(0, 2).map(f => [Math.round(f.t), f.cv.h, end.cv.h])));
        }
        ok(tag + 'the picture ends at the size it is shown (crisp), and the bars are back at full strength (the tool window stays docked off on a phone)', Math.abs(end.bw - end.cv.w * 1) <= 2 && end.parts.every((o, k) => o === 1 || (k === 2 && dir === 'in' && VW < 600)), JSON.stringify({ bitmap: end.bw, shown: end.cv.w, parts: end.parts }));
        await p.waitForTimeout(300);
      }
      const after = await geo(); ok((calm ? 'reduced motion, ' : '') + (VW < 600 ? 'phone, ' : '') + view + ': after the round trip the window is where it started', Math.abs(after.box.l - normal.box.l) < 1.5 && Math.abs(after.box.w - normal.box.w) < 1.5 && Math.abs(after.cv.h - normal.cv.h) < 1.5, JSON.stringify({ after: after.box, normal: normal.box }));
    }
    await ctx.close();
  }
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
