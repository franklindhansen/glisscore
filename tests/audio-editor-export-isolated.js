// An export works from the draft as it was when Export was pressed: changes made in the editor while it runs (volume, trim, an EQ band, the fades) must not reach the file. Memory and disk store.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-export-isolated.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const disk of [0, 1]) for (const fmt of ['wav24', 'flac24']) {
    const tag = (disk ? 'disk store, ' : 'memory, ') + fmt + ': ';
    const p = await b.newPage({ viewport: { width: 1240, height: 900 } }); p.setDefaultTimeout(30000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(800);
    const run = mid => p.evaluate(async ([mid, fmt]) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms)); let out = null; window.saveFile = async blob => { out = new Uint8Array(await blob.arrayBuffer()); }; S.set.audioFormat = fmt;
      const o1 = DISK.master, o2 = window.fxGet; let slow = true; DISK.master = async function (...a) { if (slow) { slow = false; await sleep(700); } return o1.apply(this, a); }; window.fxGet = async function (...a) { await sleep(700); return o2.apply(this, a); };
      const pr = aeExport(); await sleep(250);
      if (mid) { aeFx(fx => { fx.eq.bands = [{ type: 'peaking', f: 800, g: 9, q: 1, on: true }]; fx.eq.on = true; }); AE.d.gainDb = 12; AE.d.normalize = true; AE.d.normBy = 'peak'; AE.d.vEndSet = 1.5; AE.d.audioFades = true; AE.d.audioFadeLen = 1; aeRefresh(); aeLive(); await sleep(300); }
      await pr; DISK.master = o1; window.fxGet = o2; let h = 0; for (let i = 0; i < out.length; i++) h = (Math.imul(h, 31) + out[i]) | 0; return { size: out.length, h };
    }, [mid, fmt]);
    const a = await run(false); await p.evaluate(() => { aeUndoAll && 0; }).catch(() => {});
    await p.evaluate(() => { for (let i = 0; i < 20 && AE.undo.length; i++) aeUndo(); AE.d.gainDb = 0; AE.d.normalize = false; AE.d.vEndSet = null; AE.d.audioFades = false; aeRefresh(); }); await p.waitForTimeout(300);
    const c = await run(true);
    ok(tag + 'edits made while it runs do not reach the file', a.size > 1e5 && a.size === c.size && a.h === c.h, JSON.stringify({ a, c }));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
