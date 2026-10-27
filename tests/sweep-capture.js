// Records every loading bar that uses the shared sweep and makes a GIF of each: the credits font boxes (main, title, line 2, line 3), the busy chip, and the noise-reduction track. Not a check: run by hand to look at the bars.
// Run with the app served on port 8123:  OUT=folder S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/sweep-capture.js
const { chromium } = require('playwright-core'), { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const FX = process.env.S || 'tests/fixtures', OUT = process.env.OUT || 'sweep-gifs', W = 1300, H = 1300;
fs.mkdirSync(OUT, { recursive: true });
const gif = (video, name, off, dur, r, pad = 14, zoom = 2) => {
  const x = Math.max(0, Math.floor(r.x - pad)), y = Math.max(0, Math.floor(r.y - pad)), w = Math.ceil(r.width + pad * 2), h = Math.ceil(r.height + pad * 2);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', off.toFixed(2), '-t', dur.toFixed(2), '-i', video, '-vf', `crop=${w}:${h}:${x}:${y},scale=iw*${zoom}:-1:flags=lanczos,fps=25,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse`, path.join(OUT, name + '.gif')]);
  console.log('made ' + path.join(OUT, name + '.gif'));
};
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const session = async (setup) => {
    const dir = fs.mkdtempSync(path.join(OUT, 'rec-')), ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir, size: { width: W, height: H } } }), t0 = Date.now(), p = await ctx.newPage(); p.setDefaultTimeout(60000);
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.waitForTimeout(800);
    return { p, ctx, dir, since: () => (Date.now() - t0) / 1000, done: async () => { const v = p.video(); await ctx.close(); return v.path(); } };
  };
  const rect = (p, sel) => p.locator(sel).first().boundingBox();

  // 1. the credits font boxes: all four looked up at once, then found
  { const s = await session(), p = s.p;
    await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => window.__keyframes.S.pdf && window.__keyframes.duration() > 2); await p.waitForTimeout(800);
    await p.evaluate(() => document.querySelector('#creditsOn').click()); await p.waitForTimeout(2000);
    await p.evaluate(() => { document.querySelectorAll('.line-row .fmt-btn.aa').forEach(b => b.click()); }); await p.waitForTimeout(1500);
    await p.evaluate(() => { window.__rel = []; window.resolveGoogleFont = raw => new Promise(res => window.__rel.push(() => res('Lora'))); });
    const ids = ['credFont', 'credTitleFont', 'credL2Font', 'credL3Font'], boxes = {};
    for (const id of ids) { await p.locator('#' + id).scrollIntoViewIfNeeded().catch(() => {}); }
    await p.waitForTimeout(300);
    const t1 = s.since();
    for (const id of ids) await p.evaluate(id => { const i = document.getElementById(id); i.value = 'Lora'; i.dispatchEvent(new Event('input', { bubbles: true })); }, id);
    await p.waitForTimeout(600); const start = s.since();
    for (const id of ids) boxes[id] = await rect(p, '#' + id + ' >> xpath=..');
    await p.waitForTimeout(3600); await p.evaluate(() => window.__rel.forEach(f => f())); await p.waitForTimeout(2000);
    const dur = s.since() - start + 0.2, v = await s.done();
    const names = { credFont: 'font-box-main', credTitleFont: 'font-box-title', credL2Font: 'font-box-line2', credL3Font: 'font-box-line3' };
    for (const id of ids) if (boxes[id]) gif(v, names[id], start - 0.1, dur, boxes[id]); else console.log('skipped ' + id);
  }
  // 2. the busy chip: loading with no measure yet, then with a measure
  { const s = await session(), p = s.p;
    await p.evaluate(() => setBusy('Loading score…', 'pdf', 'Score.pdf', null)); await p.waitForTimeout(300); const start = s.since();
    const r = await rect(p, '#chips .chip.busy');
    await p.waitForTimeout(3900); await p.evaluate(() => setBusy('Loading score…', 'pdf', 'Score.pdf', 0.2)); await p.waitForTimeout(700);
    for (const f of [0.45, 0.7, 0.95]) { await p.evaluate(f => setBusyFrac(f), f); await p.waitForTimeout(700); }
    const dur = s.since() - start + 0.2, v = await s.done(); gif(v, 'busy-chip', start - 0.1, dur, r, 12, 3);
  }
  // 3. the noise-reduction track: working before the first tick, then ticks
  { const s = await session(), p = s.p;
    await p.setInputFiles('#audioIn', FX + '/stereo.wav'); await p.waitForFunction(() => S.audio, null, { timeout: 60000 }); await p.waitForTimeout(1200);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(900);
    await p.evaluate(() => aeTool('noise')); await p.waitForTimeout(900);
    await p.evaluate(() => aeNrProg(0)); await p.waitForTimeout(300); const start = s.since();
    const r = await rect(p, '#aeNrCtl');
    await p.waitForTimeout(3900); for (const f of [0.15, 0.4, 0.7, 1]) { await p.evaluate(f => aeNrProg(f), f); await p.waitForTimeout(800); }
    const dur = s.since() - start + 0.2, v = await s.done(); gif(v, 'noise-reduction-track', start - 0.1, dur, r, 10, 2);
  }
  for (const d of fs.readdirSync(OUT)) if (d.startsWith('rec-')) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
  await b.close();
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
