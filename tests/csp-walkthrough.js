// Opens the app under the Content-Security-Policy and uses the parts the policy could touch: a real Google Font (needs the internet), a font that does not exist, a recording on the disk store, and a PDF in the video editor.
// Every violation the browser logs fails it. Run by hand (it needs the internet):  zsh tests/run-all.sh csp-walkthrough
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures', ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), errs = [], logs = [];
  const open = async q => { const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) logs.push(m.text().slice(0, 200)); }); await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html' + q); await p.waitForTimeout(900); return p; };

  let p = await open('?disk=0');
  await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => window.__keyframes.S.pdf && window.__keyframes.duration() > 2); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('#creditsOn').click()); await p.waitForTimeout(900);
  await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = 'Lora'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(() => window.__keyframes.S.set.creditsFont === 'Lora', null, { timeout: 30000 }).catch(() => {});
  const f = await p.evaluate(() => ({ set: window.__keyframes.S.set.creditsFont, sheet: [...document.querySelectorAll('link[rel=stylesheet]')].some(l => l.href.startsWith('https://fonts.googleapis.com/')), faces: [...document.fonts].filter(x => x.family.replace(/"/g, '') === 'Lora').map(x => x.status), seen: performance.getEntriesByType('resource').map(r => r.name).filter(n => /fonts\.g/.test(n)).length }));
  ok('a Google Font is found, its stylesheet loads, and its font files load', f.set === 'Lora' && f.sheet && f.faces.length > 0 && f.faces.includes('loaded'), JSON.stringify(f));
  await p.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => {});
  await p.evaluate(() => { const i = document.querySelector('#credFont'); i.value = 'Zzqx Notafont'; i.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(4000);
  ok('a font that does not exist is turned down and the page carries on', await p.evaluate(() => window.__keyframes.S.set.creditsFont !== 'Zzqx Notafont' && document.body.isConnected));
  await p.close();

  p = await open('?disk=1');
  await p.setInputFiles('#audioIn', FX + '/stereo.wav'); await p.waitForFunction(() => S.audio, null, { timeout: 60000 }); await p.waitForTimeout(1200);
  ok('a recording opens on the disk store', await p.evaluate(() => !!S.audio));
  await p.close();

  ok('no policy violations in the console', logs.length === 0, logs.slice(0, 3).join(' | '));
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
