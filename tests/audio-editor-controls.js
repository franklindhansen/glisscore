const { chromium } = require('playwright-core');
const results = []; const ok = (n, pass, info = '') => results.push((pass ? 'PASS ' : 'FAIL ') + n + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1040, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.setInputFiles('#audioIn', process.env.S + '/stereo.wav');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
  await p.evaluate(() => aeTool('imager')); await p.waitForTimeout(800);
  const w0 = await p.evaluate(() => document.querySelector('#aeWidthVal').textContent);
  ok('width reads 100% at normal', w0 === '100%', w0);
  await p.evaluate(() => { const r = document.querySelector('#aeWidth'); r.value = 50; r.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(200);
  const w1 = await p.evaluate(() => ({ txt: document.querySelector('#aeWidthVal').textContent, stored: AE.d.fx.imager.width }));
  ok('width slider -50 shows 150% and stores 150', w1.txt === '150%' && w1.stored === 150, JSON.stringify(w1));
  await p.evaluate(() => { document.querySelector('#aeWidth').value = 0; document.querySelector('#aeWidth').dispatchEvent(new Event('input')); });
  const bt = await p.evaluate(() => ({ btn: document.querySelector('#aeBalAuto').textContent, val: document.querySelector('#aeBalVal').textContent, say: !!document.querySelector('#aeBalSay'), shown: getComputedStyle(document.querySelector('#aeBalVal')).display !== 'none', meters: [...document.querySelectorAll('#aeBalCard .bm-name')].map(e => e.textContent), ends: [...document.querySelectorAll('#aeBalCard .sl-end')].map(e => e.classList.contains('tick') ? (!e.textContent.trim() && e.querySelector('i') && e.querySelector('i').getBoundingClientRect().height > 0 ? 'tick' : 'tick?' + e.textContent) : e.textContent) }));
  ok('balance: Auto button, no readout and no "No shift" or "louder by" line when not shifted, L, tick, R on the slider and L, R on the meters', bt.btn === 'Auto' && bt.val === '' && !bt.shown && !bt.say && bt.ends.join() === 'L,tick,R' && bt.meters.join() === 'L,R', JSON.stringify(bt));
  await p.evaluate(() => { const r = document.querySelector('#aeBal'); r.value = 2; r.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(200);
  const bs = await p.evaluate(() => ({ val: document.querySelector('#aeBalVal').textContent, bal: AE.d.fx.imager.bal, shown: getComputedStyle(document.querySelector('#aeBalVal')).display !== 'none' }));
  ok('balance 2 reads 2.0dB right, shown beside the heading', bs.val === '2.0dB right' && bs.bal === 2 && bs.shown, JSON.stringify(bs));
  await p.evaluate(() => { document.querySelector('#aeBalAuto').click(); });
  await p.waitForTimeout(300);
  const ba = await p.evaluate(() => ({ bal: AE.d.fx.imager.bal, pressed: document.querySelector('#aeBalAuto').getAttribute('aria-pressed'), even: document.querySelector('#aeLR').classList.contains('even'), val: document.querySelector('#aeBalVal').textContent }));
  ok('Auto sets the balance to even: the button stays pressed and the meters read even', Math.abs(ba.bal) > 0 && ba.pressed === 'true' && ba.even, JSON.stringify(ba));
  const sc = await p.evaluate(() => { const t = [], o = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (s, ...r) { t.push(String(s)); return o.call(this, s, ...r); }; aeScopeDraw(); CanvasRenderingContext2D.prototype.fillText = o; const m = document.querySelector('.im-corr'); return { t, words: [...m.querySelectorAll('span')].length, text: m.textContent.trim(), tip: m.title }; });
  ok('the scope draws L and R and no Mono, and the meter under it has no end words but keeps its tooltip', sc.t.includes('L') && sc.t.includes('R') && !sc.t.includes('Mono') && sc.words === 0 && sc.text === '' && /alike/.test(sc.tip), JSON.stringify(sc));
  // summary follows the live hold while playing, and returns when stopped
  await p.evaluate(() => aeTool('level')); await p.waitForTimeout(900);
  await p.evaluate(() => document.querySelector('#aePlay').click()); await p.waitForTimeout(900);
  const live = await p.evaluate(() => ({ meter: document.querySelector('#aePeakNow').textContent, sum: document.querySelector('#aeSumPeak') ? document.querySelector('#aeSumPeak').textContent : null, playing: AE.playing }));
  ok('one True peak readout: the summary no longer repeats it', live.playing && live.meter !== '—' && live.sum === null, JSON.stringify(live));
  await p.evaluate(() => document.querySelector('#aePlay').click()); await p.waitForTimeout(900);
  const stop = await p.evaluate(() => ({ meter: document.querySelector('#aePeakNow').textContent, sum: document.querySelector('#aeSumPeak') ? document.querySelector('#aeSumPeak').textContent : null, playing: AE.playing }));
  ok('after stop the one readout shows the stopped true peak', !stop.playing && stop.meter !== '—' && stop.meter.endsWith('dB') && stop.sum === null, JSON.stringify(stop));
  // layout checks: these would have caught the broken Balance and Imager layout
  await p.evaluate(() => aeTool('imager')); await p.waitForTimeout(900);
  const lay = await p.evaluate(() => {
    const cs = s => getComputedStyle(document.querySelector(s));
    const bars = [...document.querySelectorAll('#aeBalCard .bm-track b')].map(b => b.getBoundingClientRect().width);
    const card = document.querySelector('#aeBalCard').getBoundingClientRect(), track = document.querySelector('#aeBalCard .bm-track').getBoundingClientRect();
    return { meterGrid: cs('#aeLR').display, foot: !!document.querySelector('#aeBalCard .t-head > #aeBalVal'), bars, trackW: Math.round(track.width), cardInside: track.left > card.left && track.right < card.right, scopeInGrid: document.querySelector('.im-scope').parentElement.id === 'aePaneImager' || document.querySelector('.im-scope').parentElement.classList.contains('im-cols'), twoCols: getComputedStyle(document.querySelector('#aePaneImager .im-cols')).gridTemplateColumns.split(' ').length === 2, sliderFull: document.querySelector('#aeBal').getBoundingClientRect().width > card.width * 0.8 };
  });
  ok('balance layout: meter is a grid, bars have width, slider spans the card', lay.meterGrid === 'grid' && lay.foot === true && lay.bars.every(w => w > 0) && lay.cardInside && lay.sliderFull && lay.scopeInGrid && lay.twoCols, JSON.stringify(lay));
  const lv = await p.evaluate(async () => { aeTool('level'); await sleep(900); AE.hold = 0.5; const strip = document.querySelector('#aeMeter > #aeSum'), pk = document.querySelector('#aePeakNow'); pk.click(); await sleep(100); return { inStrip: strip.contains(pk), reset: AE.hold === 0, change: !!document.querySelector('#aeSumChg') || /Change/i.test(document.querySelector('#aeMeter').textContent), netInPane: /Net gain/i.test(document.querySelector('#aePaneLevel').textContent), netBar: /Net gain/i.test(document.querySelector('#aeStat').textContent) }; });
  ok('Level: True peak is in the Meter\'s strip and resets on click, Change is gone, and Net gain is said once, in the status bar', lv.inStrip && lv.reset && !lv.change && !lv.netInPane && lv.netBar, JSON.stringify(lv));
  // a slider whose default is its middle catches there while dragged (within 2% of its range), drags on past that, and the arrow keys still step through it
  await p.evaluate(async () => { aeTool('imager'); await sleep(900); });
  const at = async (frac) => { const r = await p.evaluate(() => { const e = document.querySelector('#aeBal'), q = e.getBoundingClientRect(), w = parseFloat(getComputedStyle(e).getPropertyValue('--thumb-w')); return { l: q.left + w / 2, w: q.width - w, y: q.top + q.height / 2, v: +e.value }; }); const cx = r.l + r.w * 0.5 + 0; await p.mouse.move(cx, r.y); await p.mouse.down(); await p.mouse.move(r.l + r.w * frac, r.y, { steps: 4 }); const v = await p.evaluate(() => +document.querySelector('#aeBal').value); await p.mouse.up(); return v; };
  const near = await at(0.51), far = await at(0.6);
  const key = await p.evaluate(() => { const e = document.querySelector('#aeBal'); e.value = 0; e.dispatchEvent(new Event('input', { bubbles: true })); return 0; });
  await p.focus('#aeBal'); await p.keyboard.press('ArrowRight'); const stepped = await p.evaluate(() => +document.querySelector('#aeBal').value);
  ok('sliders: Balance catches at its middle when dragged near it (' + near + '), drags on past it (' + far + '), and the arrow keys step through it (' + stepped + ')', near === 0 && far > 1 && stepped > 0 && key === 0);
  // the Balance meters: a letter is as far from its bar as the bar is from its value, and a longer reading never moves the bars
  const mt = await p.evaluate(() => { const rng = document.createRange(), ink = e => { rng.selectNodeContents(e); return rng.getBoundingClientRect(); }, ts = [...document.querySelectorAll('#aeLR .bm-track')], ns = [...document.querySelectorAll('#aeLR .bm-name')], vs = [...document.querySelectorAll('#aeLR .bm-val')], bars = () => ts.map(t => { const r = t.getBoundingClientRect(); return [r.left, r.right]; });
    const gaps = ns.map((n, i) => [ts[i].getBoundingClientRect().left - ink(n).right, ink(vs[i]).left - ts[i].getBoundingClientRect().right]), b0 = JSON.stringify(bars()), keep = vs.map(v => v.textContent);
    vs[0].textContent = '\u22124.5dB'; vs[1].textContent = '\u221299.9dB'; const b1 = JSON.stringify(bars()); vs.forEach((v, i) => { v.textContent = keep[i]; });
    const pr = document.querySelector('#aeLR').getBoundingClientRect(), tr = ts.map(t => t.getBoundingClientRect()), room = [tr[0].top - pr.top, tr[1].top - tr[0].bottom, pr.bottom - tr[1].bottom, Math.min(...ns.map(n => ink(n).left)) - pr.left, pr.right - Math.max(...vs.map(v => ink(v).right))];
    return { gaps, still: b0 === b1, room }; });
  ok('Balance meters: each letter is as far from its bar as the bar is from its value (0.5px), a longer reading never moves the bars, and the inset panel has the same room above, between, and below the rows as at its sides', mt.gaps.every(([a, z]) => Math.abs(a - z) <= 0.5) && mt.still && mt.room.every(v => Math.abs(v - mt.room[0]) <= 0.5), JSON.stringify(mt));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
