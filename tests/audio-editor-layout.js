// Audio Editor layout at four window sizes, across all six tools: nothing scrolls sideways (the dialog, the page, or the tool), and on a window wide enough for two columns the tool window keeps one
// height from tool to tool and the dialog itself never scrolls. The sizes run side by side in one script, so it adds almost no time to a full run.
// Add SHOTS=1 to also save a screenshot of each tool window (t-<size>-<tool>.png) to look at: the numbers do not catch everything.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-layout.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const b = await chromium.launch(), errs = [];
  await Promise.all([[390, 800], [700, 900], [900, 600], [1280, 800]].map(async ([w, h]) => {
    const p = await b.newPage({ viewport: { width: w, height: h } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(w + ': ' + e.message));
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', (process.env.S || 'tests/fixtures') + '/loud.mp3');
    await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
    const rows = {};
    for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level']) {
      await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(800);
      rows[t] = await p.evaluate(() => { const win = document.querySelector('#aeWin').getBoundingClientRect(), pane = document.querySelector('.ae-pane:not([hidden])'), dlg = document.querySelector('#audioDlg .dlg');
        return { win: Math.round(win.height), pane: pane.scrollWidth - pane.clientWidth, dlgX: dlg.scrollWidth - dlg.clientWidth, docX: document.documentElement.scrollWidth - innerWidth, dlgY: dlg.scrollHeight - dlg.clientHeight }; });
      if (process.env.SHOTS) await p.locator('#aeWin').screenshot({ path: 't-' + w + 'x' + h + '-' + t + '.png' });
    }
    const tag = w + 'x' + h + ': ', all = Object.entries(rows), wide = w >= 700;
    const sideways = all.filter(([, r]) => r.pane > 1 || r.dlgX > 1 || r.docX > 1).map(([t, r]) => t + ' ' + JSON.stringify(r));
    ok(tag + 'no tool scrolls sideways (dialog, page, or tool)', !sideways.length, sideways.join(' | '));
    if (wide) {
      const hs = all.map(([, r]) => r.win);
      ok(tag + 'the tool window keeps one height across all six tools', Math.max(...hs) - Math.min(...hs) <= 1, JSON.stringify(Object.fromEntries(all.map(([t, r]) => [t, r.win]))));
      const tall = all.filter(([, r]) => r.dlgY > 1).map(([t, r]) => t + ' ' + r.dlgY);
      ok(tag + 'the dialog itself does not scroll', !tall.length, tall.join(', '));
    }
    await p.close();
  }));
  ok('no page errors', !errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})();
