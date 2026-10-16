// Jumping the playhead while sound plays must not click: the sound is eased out and in around the jump. Checked in the Audio Editor (click on the waveform) and in the video timeline,
// in memory and on the disk store. The output is recorded just before the speakers and every stretch of sound must start and end near silence.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-seek-click.js
const { chromium } = require('playwright-core');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const video of [0, 1]) for (const disk of [0, 1]) {
    const tag = (video ? 'video timeline, ' : 'Audio Editor, ') + (disk ? 'disk store: ' : 'memory: ');
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(15000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => { const c = AudioNode.prototype.connect; window.REC = []; AudioNode.prototype.connect = function (t, ...r) { if (t instanceof AudioDestinationNode && !this._rec) { const self = this, sp = this.context.createScriptProcessor(1024, 1, 1); sp.onaudioprocess = e => { window.REC.push({ id: self._rec, d: new Float32Array(e.inputBuffer.getChannelData(0)) }); }; c.call(this, sp); c.call(sp, t); this._rec = (window.NID = (window.NID || 0) + 1); } return c.call(this, t, ...r); }; });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
    if (video) {
      await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.waitForTimeout(500);
      await p.evaluate(() => Transport.play()); await p.waitForTimeout(1000);
      for (const t of [3, 6, 4, 7]) { await p.evaluate(t => Transport.seek(t), t); await p.waitForTimeout(500); }
    } else {
      await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
      await p.click('#aePlay'); await p.waitForTimeout(1000);
      const box = await p.locator('#aeCanvas, #audioDlg canvas').first().boundingBox();
      for (const f of [0.3, 0.6, 0.45, 0.7]) { await p.mouse.click(box.x + box.width * f, box.y + 40); await p.waitForTimeout(500); }
    }
    const r = await p.evaluate(() => {          // per player: how loud its first and last samples are (an eased sound starts and ends near 0; the first player is left out, the recorder is not yet listening at its very start)
      const by = {}; for (const b of REC) (by[b.id] = by[b.id] || []).push(b.d); const ids = Object.keys(by).map(Number).sort((a, b) => a - b), o = { nodes: ids.length, ends: 0, starts: 0 };
      ids.forEach((id, n) => { const x = Float32Array.from(by[id].flatMap(a => Array.from(a))); let a = 0, z = x.length - 1; while (a < z && x[a] === 0) a++; while (z > a && x[z] === 0) z--;
        if (n > 0) o.starts = Math.max(o.starts, Math.abs(x[a])); if (n < ids.length - 1) o.ends = Math.max(o.ends, Math.abs(x[z])); });
      return o; });
    ok(tag + 'jumps while playing do not click', r.nodes >= 4 && r.starts < 0.05 && r.ends < 0.05, JSON.stringify(r));
    ok(tag + 'no errors', errs.length === 0, errs.join(' | ')); await p.close();
  }
  await b.close();
})();
