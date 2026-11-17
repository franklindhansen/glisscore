// The video's Fades change only the picture, and the Audio Editor's fades change only the sound: each one's curve, set the other way round, leaves the other untouched, and the controls of one never write the other's settings.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-audio-fades-apart.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 4; i++) doc.addPage([612, 792]);
  const pdf = path.join(os.tmpdir(), 'kf-fadesapart.pdf'); fs.writeFileSync(pdf, await doc.save());
  const sr = 8000, n = sr * 20, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(60 * Math.sin(i / 20));
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf); await p.setInputFiles('#audioIn', { name: 'a.wav', mimeType: 'audio/wav', buffer: wav });
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.audio && window[K].S.audio.buffer, K); await p.waitForTimeout(1200);
  const both = () => p.evaluate(() => { const vs = S.vStart; return { pic0: fadeAt(vs), pic1: fadeAt(vs + 0.5), snd0: soundFadeAt(vs), snd1: soundFadeAt(vs + 0.5), picEnd: fadeAt(vEnd()), sndEnd: soundFadeAt(vEnd()) }; });
  const keys = pre => p.evaluate(pre => JSON.stringify(Object.keys(S.set).filter(k => k.startsWith(pre)).sort().map(k => [k, S.set[k]])), pre);
  // picture fades on, sound fades off
  await p.evaluate(() => { Object.assign(S.set, { fadesOn: true, fadeIn: true, fadeOut: true, fadeAuto: false, fadeAutoOut: false, fadeLen: 2, fadeOutLen: 2, audioFades: false }); });
  let r = await both();
  ok('picture fades on, sound fades off: the picture starts dark and the sound starts at full level', r.pic0 === 0 && r.pic1 < 0.6 && r.snd0 === 1 && r.snd1 === 1, JSON.stringify(r));
  ok('picture fades on, sound fades off: the end is dark in the picture, full in the sound', r.picEnd === 0 && r.sndEnd === 1, JSON.stringify(r));
  // sound fades on, picture fades off
  await p.evaluate(() => { Object.assign(S.set, { fadesOn: false, audioFades: true, audioFadeLen: 1, audioFadeOutLen: null }); });
  r = await both();
  ok('sound fades on, picture fades off: the sound starts silent and the picture starts at full', r.snd0 === 0 && r.snd1 > 0 && r.snd1 < 1 && r.pic0 === 1 && r.pic1 === 1, JSON.stringify(r));
  ok('sound fades on, picture fades off: the end is silent in the sound, full in the picture', r.sndEnd === 0 && r.picEnd === 1, JSON.stringify(r));
  // the controls write only their own settings
  await p.evaluate(() => { Object.assign(S.set, { fadesOn: true, fadeIn: true, fadeOut: true, fadeAuto: false, fadeAutoOut: false, audioFades: true, audioFadeLen: 1 }); syncControls(); });
  await p.locator('#fadeLen').scrollIntoViewIfNeeded();
  const audBefore = await keys('audio');
  await p.evaluate(() => { const r = document.querySelector('#fadeLen'); r.value = 15; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => { for (const id of ['fadeIn', 'fadeOut']) { const c = document.getElementById(id); if (c && c.type === 'checkbox') c.click(); } });
  await p.waitForTimeout(300);
  ok('the video Fades panel never writes the sound settings', (await keys('audio')) === audBefore, audBefore);
  const picBefore = await keys('fade');
  await p.evaluate(() => { openAudioEditor(); }); await p.waitForTimeout(800);
  await p.evaluate(() => { aePush(); AE.d.audioFades = true; AE.d.audioFadeLen = 2.5; AE.d.audioFadeOutLen = 0.7; AE.d.audioFadeShape = 'linear'; aeRefresh && aeRefresh(); });
  const mid = await keys('fade'); ok('the Audio Editor fades never write the picture fade settings while editing', mid === picBefore, mid);
  await p.keyboard.press('Escape'); await p.waitForTimeout(800);
  const after = await keys('fade'); ok('and not when it closes', after === picBefore, after);
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
