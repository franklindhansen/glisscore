// The audio export window stays up while the export runs (progress page), can be hidden to keep editing and brought back from the Export audio button, and says when it is done.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-export-window.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) {
    const tag = disk ? 'disk store: ' : 'memory: ';
    const p = await b.newPage({ viewport: { width: 1240, height: 900 } }); p.setDefaultTimeout(15000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => { window.saveFile = async () => { await new Promise(r => setTimeout(r, 1800)); }; document.querySelector('[data-audio]').click(); }); await p.waitForTimeout(800);
    const st = () => p.evaluate(() => ({ dlg: !document.querySelector('#aeExpDlg').hidden, run: !document.querySelector('#aeExpRun').hidden, opts: !document.querySelector('#aePgWrap').hidden, title: document.querySelector('#aeRunTitle').textContent, msg: document.querySelector('#aeRunMsg').textContent, hide: !document.querySelector('#aeRunHide').hidden, close: !document.querySelector('#aeRunClose').hidden, stop: !document.querySelector('#aeRunStop').hidden, exporting: !!AE.exporting }));
    await p.click('#aeExport'); await p.waitForTimeout(300); const a = await st(); ok(tag + 'the window opens on the options', a.dlg && a.opts && !a.run, JSON.stringify(a));
    await p.click('#aeExpGo'); await p.waitForTimeout(500); const w = await st(); ok(tag + 'Export keeps the window up on a progress page with Stop and Keep editing', w.dlg && w.run && !w.opts && w.exporting && w.hide && w.stop && !w.close, JSON.stringify(w));
    await p.screenshot({ path: '/tmp/kfs/run1.png' });
    await p.click('#aeRunHide'); await p.waitForTimeout(300); const h = await st(); ok(tag + 'Keep editing hides the window and the export carries on', !h.dlg && h.exporting, JSON.stringify(h));
    await p.click('#aeExport'); await p.waitForTimeout(300); const r = await st(); ok(tag + 'the Export audio button brings the progress page back (no second export starts)', r.dlg && r.run && r.exporting, JSON.stringify(r));
    await p.waitForFunction(() => !AE.exporting, null, { timeout: 15000 }); await p.waitForTimeout(300); const d = await st(); await p.screenshot({ path: '/tmp/kfs/run2.png' });
    ok(tag + 'when it finishes the window says so, with Close', d.dlg && d.run && /saved/i.test(d.title) && d.close && !d.stop && !d.hide, JSON.stringify(d));
    await p.click('#aeRunClose'); await p.waitForTimeout(300); await p.click('#aeExport'); await p.waitForTimeout(300); const o = await st(); ok(tag + 'opening it again shows the options', o.dlg && o.opts && !o.run, JSON.stringify(o));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
