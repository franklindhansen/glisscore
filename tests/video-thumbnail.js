// Video thumbnail: Save thumbnail writes a 1280x720 JPEG under YouTube's 2 MB limit, named after the title.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-thumbnail.js
const { chromium } = require('playwright-core');
const fs = require('fs');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
// the size and dimensions of a JPEG, read from its SOF marker
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
(async () => {
  const b = await chromium.launch(); const errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000);
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.setInputFiles('#pdfIn', FX + '/score.pdf');
  await p.waitForFunction(K => window[K].S.pdf && window[K].duration() > 2, K, { timeout: 60000 });
  await p.waitForTimeout(800);
  await p.evaluate(K => { window[K].S.credits.title = 'Test: Score / Name'; }, K);
  // catch the file the button saves (the same blob the download link would get)
  const got = await p.evaluate(() => new Promise((res, rej) => {
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { HTMLAnchorElement.prototype.click = orig;
      const name = this.download;
      fetch(this.href).then(r => r.blob()).then(bl => { const fr = new FileReader(); fr.onload = () => res({ name, b64: fr.result.split(',')[1], size: bl.size }); fr.readAsDataURL(bl); }, rej); };
    document.querySelector('#btnThumb').click();
    setTimeout(() => rej(new Error('no file was saved')), 30000);
  }));
  const buf = Buffer.from(got.b64, 'base64');
  const size = jpegSize(buf);
  ok('the file is a JPEG', buf[0] === 0xff && buf[1] === 0xd8);
  ok('it is 1280x720, 16:9', size && size.w === 1280 && size.h === 720, size ? size.w + 'x' + size.h : 'no size found');
  ok('it is under the 2 MB limit', buf.length <= 2 * 1024 * 1024, (buf.length / 1048576).toFixed(2) + ' MB');
  ok('the name is the title with unsafe characters replaced', got.name === 'Test Score Name - Thumbnail.jpg', got.name);
  ok('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL run — ' + e.message); process.exit(1); });
