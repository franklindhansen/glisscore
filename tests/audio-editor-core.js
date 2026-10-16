const { chromium } = require('playwright-core');
const results = [];
const ok = (name, pass, info = '') => { results.push((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
(async () => {
  const b = await chromium.launch();
  const page = async (w = 1040, h = 900) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
    return p;
  };
  const load = async (p, file) => {
    await p.setInputFiles('#audioIn', file);
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
    await p.waitForTimeout(400);
    return p.evaluate(() => (document.querySelector('.toast') || { textContent: '' }).textContent);
  };
  const MSG = 'Part of this file was clipped';

  // 1–4: detection
  let p = await page();
  const t1 = await load(p, process.env.S + '/clamp.mp3');
  ok('clamped lossy file shows the import message', t1.includes(MSG), t1.slice(0, 160));
  ok('… and it names the fix without advising a browser switch', t1.includes('convert it to float WAV') && !/safari|chrome|firefox|browser/i.test(t1.slice(t1.indexOf(MSG))));
  await p.close();

  p = await page();
  const t2 = await load(p, process.env.S + '/noclamp.mp3');
  ok('lossy file with no full-scale samples: no message', !t2.includes(MSG), t2.slice(0, 120));
  await p.close();

  p = await page();
  const t3 = await load(p, process.env.S + '/loud.mp3');
  ok('real MP3 at 0.99 full scale: no message (no false alarm)', !t3.includes(MSG), t3.slice(0, 120));
  await p.close();

  p = await page();
  const t4 = await load(p, process.env.S + '/f32over.wav');
  const pk4 = await p.evaluate(() => { let m = 0; for (let c = 0; c < S.audio.buffer.numberOfChannels; c++) { const d = S.audio.buffer.getChannelData(c); for (const v of d) m = Math.max(m, Math.abs(v)); } return m; });
  ok('float WAV: overs kept, no message', !t4.includes(MSG) && pk4 > 1.04, 'peak ' + pk4.toFixed(3));
  await p.close();

  // 5: live true peak function
  p = await page();
  await load(p, process.env.S + '/loud.mp3');
  const tp = await p.evaluate(() => {
    const n = 2048, a = new Float32Array(n), q = new Float32Array(n);
    for (let i = 0; i < n; i++) { a[i] = Math.sin(Math.PI * i / 2 + Math.PI / 4); q[i] = 0; }       // a quarter-rate sine at 45°: samples reach 0.707, the true peak is 1.0
    return { tone: liveTruePeak(a), silence: liveTruePeak(q), sample: Math.max(...a.map(Math.abs)) };
  });
  ok('live true peak finds the between-sample peak', tp.tone > 0.95 && tp.tone > tp.sample + 0.2, 'true ' + tp.tone.toFixed(3) + ' vs sample ' + tp.sample.toFixed(3));
  ok('live true peak of silence is 0', tp.silence === 0);

  // 6: Loudness switches the limiter on
  await p.evaluate(() => openAudioEditor());
  await p.waitForTimeout(500);
  const before = await p.evaluate(() => document.querySelector('#aeLimiter').checked);
  await p.evaluate(() => document.querySelector('input[name=aeNormMode][value=loud]').click());
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({ lim: document.querySelector('#aeLimiter').checked, mode: AE.d.normBy, on: AE.d.normalize, limiter: AE.d.limiter }));
  ok('Loudness turns the limiter on by default', before === false && after.lim === true && after.limiter === true, JSON.stringify({ before, after }));
  await p.evaluate(() => document.querySelector('#aeLimiter').click());
  await p.waitForTimeout(200);
  const off = await p.evaluate(() => AE.d.limiter);
  ok('limiter can still be switched off', off === false);
  await p.evaluate(() => { document.querySelector('#aeLimiter').click(); });
  await p.evaluate(() => aeTool('level'));
  await p.waitForTimeout(1500);
  const lab = await p.evaluate(() => ({ read: document.querySelector('#aeMeter .lv-read').textContent, sum: document.querySelector('#aeSumPeak') ? 'duplicate' : 'True peak', loud: document.querySelector('#aeLoudNote').textContent }));
  ok('meter reads True peak once, summary does not repeat it', lab.read.startsWith('True peak') && lab.sum === 'True peak', JSON.stringify(lab));
  ok('loudness reads its target with the limiter on', /Reaches −14\.0LUFS|Measuring/.test(lab.loud), lab.loud);
  await p.evaluate(() => { document.querySelector('#aeMeter').scrollIntoView(); });
  await p.screenshot({ path: require('os').tmpdir() + '/level1040.png' });
  // playback: the live meter reads without errors
  await p.evaluate(() => { document.querySelector('#aePlay').click(); });
  await p.waitForTimeout(1500);
  const live = await p.evaluate(() => ({ text: document.querySelector('#aePeakNow').textContent, live: document.querySelector('#aeMeter').classList.contains('live') }));
  ok('playback meter runs with a live reading', live.live && live.text !== '—', JSON.stringify(live));
  await p.evaluate(() => { document.querySelector('#aePlay').click(); });
  ok('no page errors during these checks', p.errs.length === 0, p.errs.slice(0, 3).join(' | '));
  await p.close();

  console.log(results.join('\n'));
  await b.close();
})().catch(e => { console.log('TEST CRASH', e.message); process.exit(1); });
