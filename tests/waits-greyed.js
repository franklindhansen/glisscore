// Consistent waits: while the Audio Editor works (the Emulator reading a reference, the noise tool's Auto), the controls that would do nothing yet are greyed, and the pane's reason line says "Processing".
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/waits-greyed.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ';
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    // the Emulator: sampled while the reference is read
    await p.evaluate(() => { aeTool('emu'); window.__em = []; const q = document.querySelector.bind(document); const t = setInterval(() => { if (AE.em && (AE.em.busy || AE.em.busyOwn)) window.__em.push({ go: q('#aeEmGo').disabled, state: q('#aeEmState').textContent.trim() }); }, 10); window.__emStop = () => clearInterval(t); });
    await p.waitForTimeout(400); await p.setInputFiles('#aeEmIn', FX + '/s24.wav'); await p.waitForFunction(() => AE.em && AE.em.ref && AE.em.own && !AE.em.busyOwn && !AE.em.busy); await p.waitForTimeout(200);
    const em = await p.evaluate(() => { window.__emStop(); return window.__em; });
    ok(tag + 'Emulate is greyed during the reading and the line beside it says "Processing"', em.length > 0 && em.every(s => s.go && /Processing/.test(s.state)), JSON.stringify(em.slice(0, 3)) + ' of ' + em.length);
    // the noise tool's Auto
    const nr = await p.evaluate(async () => { aeTool('noise'); await sleep(300); const q = document.querySelector.bind(document), seen = []; q('#aeNrFind').click(); for (let i = 0; i < 800 && AE.nrAutoBusy; i++) { seen.push({ find: q('#aeNrFind').disabled, listen: q('#aeNrListen').disabled, why: q('.nr-listen').title, state: q('#aeNrState').textContent.trim() }); await sleep(10); } return seen; });
    ok(tag + 'Auto is greyed during its work and the state line says "Processing"', nr.length > 0 && nr.every(s => s.find && /Processing/.test(s.state)), JSON.stringify(nr.slice(0, 2)) + ' of ' + nr.length);
    ok(tag + '"Noise only" is greyed during it, with its reason', nr.length > 0 && nr.every(s => s.listen && s.why === 'Available when processing finishes'), JSON.stringify(nr.slice(0, 2)));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
