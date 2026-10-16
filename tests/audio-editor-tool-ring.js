// Background work shows in the tool list as a blue ring that fills with the progress, for Noise reduction (its main job, Auto, Learn noise, Mains hum) and the Emulator, and only while another tool is open:
// with its own window open the bar there says it. No orange text, no amber pulse; the ring fades in with the job and out when it ends.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-tool-ring.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const sr = 44100, n = sr * 12; let seed = 9; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const wav = Buffer.alloc(44 + n * 2); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round((0.1 * Math.sin(2 * Math.PI * 330 * i / sr) * Math.sin(Math.PI * i / n) + 0.01 * (rnd() - 0.5)) * 32767), 44 + i * 2);
const file = path.join(os.tmpdir(), 'kf-tool-ring.wav'); fs.writeFileSync(file, wav);
(async () => {
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    const jk = t => document.querySelector('.ae-jack[data-tool="' + t + '"]'), ring = t => { const c = getComputedStyle(jk(t), '::before'); return { op: +c.opacity, bg: c.backgroundImage, ring: +c.getPropertyValue('--ring') || 0, busy: jk(t).classList.contains('busy'), wait: jk(t).classList.contains('wait') }; };
    const rgb = hex => { const e = document.createElement('i'); e.style.color = hex; document.body.appendChild(e); const v = getComputedStyle(e).color; e.remove(); return v; }, cs = getComputedStyle(document.documentElement), o = { accentRgb: rgb(cs.getPropertyValue('--accent').trim()), turnRgb: rgb(cs.getPropertyValue('--turn').trim()) };
    o.text = !!document.querySelector('.ae-busy'); o.led = document.querySelector('#aeNrLed').classList.contains('busy'); o.rules = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch (e) { return []; } }).filter(r => /#aeChain \.busy/.test(r.cssText)).length;
    aeTool('level'); await sleep(300); o.idle = ring('noise');
    aeNrProg(0.4); await sleep(700); o.mid = ring('noise'); o.pct = document.querySelector('#aeNrPct').textContent; aeNrProg(0.8); await sleep(700); o.late = ring('noise');
    aeTool('noise'); await sleep(700); o.own = ring('noise'); aeTool('level'); await sleep(700); o.back = ring('noise');
    aeNrProg(1); await sleep(700); o.done = ring('noise'); aeNrProg(0.1); await sleep(80); o.restart = ring('noise'); aeNrProg(1); await sleep(700);
    // Auto, then leave the tool while it works
    aeTool('noise'); await sleep(300); const auto = aeNrAuto(); await sleep(100); aeTool('level'); await sleep(250); o.auto = ring('noise'); o.autoBusy = !!AE.nrAutoBusy; await auto; await sleep(700); o.autoDone = ring('noise');
    // Mains hum
    aeTool('noise'); await sleep(300); const hum = aeNrHum(); await sleep(100); aeTool('level'); await sleep(250); o.hum = ring('noise'); o.humBusy = !!AE.humBusy; await hum; await sleep(700); o.humDone = ring('noise');
    // Learn noise (a turning arc: no share is known)
    aeTool('noise'); await sleep(300); AE.nsel = { a: 1, b: 3 }; aeRefresh(); await sleep(100); document.querySelector('#aeNrLearn').click(); await sleep(100); aeTool('level'); await sleep(250); o.learn = ring('noise'); o.learnBusy = !!AE.nrLearning;
    for (let i = 0; i < 300 && AE.nrLearning; i++) await sleep(20); await sleep(700); o.learnDone = ring('noise');
    // Emulator
    o.emIdle = ring('emu'); AE.em = { busy: true, prog: 0.5, name: 'x' }; aeRingSync(); await sleep(700); o.em = ring('emu'); aeTool('emu'); await sleep(700); o.emOwn = ring('emu'); aeTool('level'); await sleep(700); o.emBack = ring('emu');
    AE.em = { busyOwn: true, prog: 0.25 }; aeRingSync(); await sleep(700); o.em2 = ring('emu'); AE.em = null; aeRingSync(); await sleep(700); o.emDone = ring('emu');
    return o;
  });
  const blue = x => x.op > 0.9 && x.bg.includes(r.accentRgb) && !x.bg.includes(r.turnRgb), o_restart = r => r.restart.ring < 0.3, near = (x, v) => Math.abs(x.ring - v) < 0.04;
  ok('no orange "Processing" line, no amber pulse on the light, no leftover amber status-bar dot', !r.text && !r.led && r.rules === 0, JSON.stringify({ text: r.text, led: r.led, rules: r.rules }));
  ok('idle: no ring', r.idle.op < 0.02 && r.idle.bg !== 'none' && r.emIdle.op < 0.02, JSON.stringify({ n: r.idle, e: r.emIdle }));
  ok('Noise reduction working, another tool open: a blue ring, filled to the progress', blue(r.mid) && near(r.mid, 0.4) && near(r.late, 0.8), JSON.stringify({ mid: r.mid, late: r.late }));
  ok('the share done is written beside the card heading as the ring fills', r.pct === '40%', r.pct);
  ok('with its own window open there is no ring (the bar there says it), and it comes back when you leave', r.own.op < 0.02 && blue(r.back), JSON.stringify({ own: r.own, back: r.back }));
  ok('when the job ends the ring fades away', r.done.op < 0.02 && !r.done.busy, JSON.stringify(r.done));
  ok('a new job starts its ring at its own share, not where the last one ended', o_restart(r), JSON.stringify(r.restart));
  ok('Auto: leave the tool while it works and the ring shows; it goes when Auto ends', r.autoBusy && blue(r.auto) && r.autoDone.op < 0.02, JSON.stringify({ auto: r.auto, done: r.autoDone }));
  ok('Mains hum: the same', r.humBusy && blue(r.hum) && r.humDone.op < 0.02, JSON.stringify({ hum: r.hum, done: r.humDone }));
  ok('Learn noise: a turning arc, gone when it ends', r.learnBusy && blue(r.learn) && r.learn.wait && r.learnDone.op < 0.02, JSON.stringify({ learn: r.learn, done: r.learnDone }));
  ok('Emulator: a blue ring filled to its progress while another tool is open, for the reference and for your audio', blue(r.em) && near(r.em, 0.5) && blue(r.em2) && near(r.em2, 0.25), JSON.stringify({ em: r.em, em2: r.em2 }));
  ok('Emulator: no ring with its own window open, back when you leave, gone when the reading ends', r.emOwn.op < 0.02 && blue(r.emBack) && r.emDone.op < 0.02, JSON.stringify({ own: r.emOwn, back: r.emBack, done: r.emDone }));
  ok('no errors', errs.length === 0, errs.join(' | '));
  await b.close(); fs.unlinkSync(file);
})();
