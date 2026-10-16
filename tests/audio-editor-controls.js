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
  const bt = await p.evaluate(() => ({ btn: document.querySelector('#aeBalAuto').textContent, val: document.querySelector('#aeBalVal').textContent, say: document.querySelector('#aeBalSay').textContent, ends: [...document.querySelectorAll('#aeBalCard .sl-end')].map(e => e.textContent) }));
  ok('balance: Auto button, No shift readout, Left/Center/Right labels', bt.btn === 'Auto' && bt.val === 'No shift' && bt.ends.join() === 'Left,Center,Right', JSON.stringify(bt));
  await p.evaluate(() => { const r = document.querySelector('#aeBal'); r.value = 2; r.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(200);
  const bs = await p.evaluate(() => ({ val: document.querySelector('#aeBalVal').textContent, bal: AE.d.fx.imager.bal, say: document.querySelector('#aeBalSay').textContent }));
  ok('balance 2 reads 2.0dB right', bs.val === '2.0dB right' && bs.bal === 2, JSON.stringify(bs));
  await p.evaluate(() => { document.querySelector('#aeBalAuto').click(); });
  await p.waitForTimeout(300);
  const ba = await p.evaluate(() => ({ bal: AE.d.fx.imager.bal, say: document.querySelector('#aeBalSay').textContent, val: document.querySelector('#aeBalVal').textContent }));
  ok('Auto sets the balance to even and says so', Math.abs(ba.bal) > 0 && ba.say === 'Even', JSON.stringify(ba));
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
    return { meterGrid: cs('#aeLR').display, foot: cs('#aeBalCard .bal-foot').display, bars, trackW: Math.round(track.width), cardInside: track.left > card.left && track.right < card.right, scopeInGrid: document.querySelector('.im-scope').parentElement.id === 'aePaneImager' || document.querySelector('.im-scope').parentElement.classList.contains('im-cols'), twoCols: getComputedStyle(document.querySelector('#aePaneImager .im-cols')).gridTemplateColumns.split(' ').length === 2, sliderFull: document.querySelector('#aeBal').getBoundingClientRect().width > card.width * 0.8 };
  });
  ok('balance layout: meter is a grid, bars have width, slider spans the card', lay.meterGrid === 'grid' && lay.foot === 'flex' && lay.bars.every(w => w > 0) && lay.cardInside && lay.sliderFull && lay.scopeInGrid && lay.twoCols, JSON.stringify(lay));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log('CRASH', e.message); process.exit(1); });
