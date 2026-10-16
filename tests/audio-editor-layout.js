const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch();
  const [w, h, tag] = [+process.argv[2], +process.argv[3], process.argv[4]];
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0');
  await p.setInputFiles('#audioIn', process.env.S + '/loud.mp3');
  await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer, null, { timeout: 30000 });
  await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(400);
  const out = {};
  for (const t of ['noise', 'spec', 'eq', 'imager', 'fades', 'level']) {
    await p.evaluate(t => aeTool(t), t); await p.waitForTimeout(1000);
    const r = await p.evaluate(() => { const win = document.querySelector('#aeWin').getBoundingClientRect(), body = document.querySelector('#aeBody'), pane = document.querySelector('.ae-pane:not([hidden])'); return { win: Math.round(win.height), bodyScroll: body.scrollHeight, bodyClient: body.clientHeight, paneW: Math.round(pane.scrollWidth), paneClientW: pane.clientWidth, dlgScroll: document.querySelector('#audioDlg .dlg').scrollHeight - document.querySelector('#audioDlg .dlg').clientHeight }; });
    out[t] = r;
    await p.locator('#aeWin').screenshot({ path: `t-${tag}-${t}.png` });
  }
  console.log(JSON.stringify(out)); console.log('errors', errs.length, errs.slice(0,2).join(' | '));
  await b.close();
})();
