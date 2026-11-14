// Opening a different recording that has the same name and length throws away every sound worked out for the old one, including the two the editor keeps for a switch back; removing the recording does the same.
// Makes its own copy of the sound with the same name and size and different samples. Run through tests/run-all.sh.
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
(async () => {
  const src = (process.env.S || 'tests/fixtures') + '/stereo.wav', dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-same-')), twin = path.join(dir, 'stereo.wav'), buf = Buffer.from(fs.readFileSync(src));
  for (let i = 1000; i < buf.length - 4; i += 2) buf.writeInt16LE(Math.max(-30000, Math.min(30000, Math.round(buf.readInt16LE(i) * 0.5))), i); fs.writeFileSync(twin, buf);
  const b = await chromium.launch(), errs = [], p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(90000); p.on('pageerror', e => { if (!/UI guard/.test(e.message)) errs.push(e.message); });
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', src); await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const kept = await p.evaluate(async () => { aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 900, g: 6, q: 1, on: true }]; }); const h = aeHeard(AE.d); await fxGet(h.fx); aeFxKeep(h.fx); window.__old = aeFxPeek(h.fx); return { kept: FXK.length, got: !!window.__old }; });
  ok('a sound the editor ran is kept for a switch back', kept.kept >= 1 && kept.got, JSON.stringify(kept));
  await p.evaluate(() => closeAudioEditor()); await p.waitForTimeout(500);
  await p.setInputFiles('#audioIn', twin); await p.waitForFunction(() => S.audio && S.audio.buffer && S.audio.buffer !== window.__old); await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({ kept: FXK.length, same: aeFxPeek(aeHeard(S.set).fx) === window.__old, name: S.audio.name }));
  ok('a new recording with the same name and length keeps none of the old recording\'s sounds', after.kept === 0 && !after.same && after.name === 'stereo.wav', JSON.stringify(after));
  const gone = await p.evaluate(async () => { aeFxKeep(aeHeard(S.set).fx); const before = FXK.length; removeAudio(); return { before, kept: FXK.length, cache: FXC.size }; });
  ok('removing the recording empties them too', gone.kept === 0 && gone.cache === 0, JSON.stringify(gone));
  ok('no page errors', !errs.length, errs.join('; ')); await b.close(); fs.rmSync(dir, { recursive: true, force: true });
})();
