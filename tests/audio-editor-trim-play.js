// A big trim while the sound plays must not make Play and Pause slow or unreliable. With a long recording on the disk store (EQ, Imager, a loudness target and the limiter on), the measuring that a trim sets going
// runs in the store's worker; playing has the priority there, so a start is heard at once and not after the measuring. Also: trimming the start past the playhead moves the sound on to the new start,
// pressing Play again while a start is on its way cancels it (it never begins a second one), and the button says so when a start takes a moment.
// Makes its own 10-minute test sound. Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-trim-play.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
function wav(file, secs) { const sr = 48000, n = sr * secs, b = Buffer.alloc(44 + n * 4); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  let s = 1; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; const nz = ((s / 0x7fffffff) - 0.5) * 0.12, t = i / sr, v = Math.sin(2 * Math.PI * 110 * t) * 0.3 + Math.sin(2 * Math.PI * 165.5 * t) * 0.2 + nz; b.writeInt16LE(Math.round(v * 32767), 44 + i * 4); b.writeInt16LE(Math.round((v * 0.9 + nz * 0.5) * 32767), 46 + i * 4); }
  fs.writeFileSync(file, b); }
(async () => {
  const f = path.join(os.tmpdir(), 'kf-trim-play.wav'); wav(f, 600);
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8123/index.html'); await p.setInputFiles('#audioIn', f); await p.waitForFunction(() => S.audio && S.audio.disk); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(1500);
  await p.evaluate(() => { const d = AE.d; d.normalize = true; d.normBy = 'loud'; d.normLufs = -14; d.normPreset = 'custom'; d.limiter = true; aeFx(fx => { fx.eq.on = true; fx.eq.bands = [{ type: 'peaking', f: 900, g: 5, q: 1, on: true }, { type: 'highshelf', f: 7000, g: -3, q: 0.71, on: true }]; fx.imager.on = true; fx.imager.width = 140; }); aeRefresh(); });
  await p.waitForTimeout(600); await p.click('#aePlay'); await p.waitForFunction(() => AE.playing); await p.waitForTimeout(2000);
  const g = await p.evaluate(() => { const r = document.querySelector('#aeCanvas').getBoundingClientRect(), L = S.audio.duration; return { r: [r.x, r.y, r.width, r.height], xs: aeX(0), xe: aeX(L), xm: aeX(L * 0.55), xm2: aeX(L * 0.8) }; }), y = g.r[1] + g.r[3] * 0.5;
  const drag = async (x0, x1) => { await p.mouse.move(g.r[0] + x0, y); await p.mouse.down(); for (let i = 1; i <= 10; i++) { await p.mouse.move(g.r[0] + x0 + (x1 - x0) * i / 10, y); await p.waitForTimeout(25); } await p.mouse.up(); };
  await drag(g.xs, g.xm); await p.waitForTimeout(600);
  const m = await p.evaluate(() => ({ playing: AE.playing, pos: AE.pos, vs: AE.d.vStart, now: aeNow() }));
  ok('trimming the start past the playhead moves the sound on to the new start and it keeps playing', m.playing && m.pos >= m.vs - 0.05 && m.now >= m.vs - 0.05, JSON.stringify(m));
  await drag(g.xe, g.xm2); await p.waitForTimeout(300);
  // Play and Pause while the measuring that the trim set going is still running
  const t = [];
  for (let k = 0; k < 3; k++) {
    const r = await p.evaluate(async () => { const t0 = performance.now(), was = AE.playing; document.querySelector('#aePlay').click(); let heard = was ? 0 : -1, lf = AE.ph ? AE.ph.frame() : -1;
      if (!was) await new Promise(res => { const iv = setInterval(() => { const f = AE.ph ? AE.ph.frame() : -1; if (AE.playing && f > 0 && f !== lf) { heard = performance.now() - t0; clearInterval(iv); res(); } lf = f; if (performance.now() - t0 > 15000) { clearInterval(iv); res(); } }, 4); });
      return { ms: Math.round(heard), playing: AE.playing, was }; });
    t.push(r); await p.waitForTimeout(700);
  }
  const starts = t.filter(x => !x.was), stops = t.filter(x => x.was);
  ok('Pause is at once and Play is heard within half a second while the trim is still being measured', starts.length >= 1 && starts.every(x => x.ms >= 0 && x.ms < 500) && stops.every(x => !x.playing), JSON.stringify(t));
  // a press while a start is on its way cancels it
  const c = await p.evaluate(async () => { if (AE.playing) document.querySelector('#aePlay').click(); await new Promise(r => setTimeout(r, 300)); const slow = DISK.play; DISK.play = function () { return new Promise(res => setTimeout(() => res(slow.apply(DISK, arguments)), 1200)); };
    document.querySelector('#aePlay').click(); await new Promise(r => setTimeout(r, 500)); const label = document.querySelector('#aePlay').title, waiting = document.querySelector('#aePlay').classList.contains('waiting'), starting = AE.starting;
    document.querySelector('#aePlay').click(); await new Promise(r => setTimeout(r, 2200)); DISK.play = slow; return { label, waiting, starting, playing: AE.playing, startingAfter: AE.starting }; });
  ok('a start that takes a moment says so on the button, and pressing again cancels it so nothing starts later', c.starting && c.waiting && /Starting/.test(c.label) && !c.playing && !c.startingAfter, JSON.stringify(c));
  ok('no page errors', errs.length === 0, errs.join(' | ')); fs.unlinkSync(f); await b.close();
})();
