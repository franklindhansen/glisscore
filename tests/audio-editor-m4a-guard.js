// M4A with the limiter on: the file is decoded as it is made, and made once more a little lower if a player would hear it reach full scale.
// The test browser has no AAC encoder, so a stand-in encoder and decoder are used here: what they "decode" stands 80% higher than what went in (far more than AAC does), or no higher at all.
// The real encoder is checked by hand in Safari.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-editor-m4a-guard.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
function wav() { const sr = 48000, n = sr * 4, b = Buffer.alloc(44 + n * 4); let s = 9; b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; const v = Math.round(0.8 * (s / 2147483647 * 2 - 1) * (0.4 + 0.6 * Math.abs(Math.sin(i / 16000))) * 32767); b.writeInt16LE(v, 44 + i * 4); b.writeInt16LE(v, 46 + i * 4); } const f = path.join(os.tmpdir(), 'glisscore-m4a-guard.wav'); fs.writeFileSync(f, b); return f; }
(async () => {
  const file = wav(), b = await chromium.launch();
  for (const disk of [0, 1]) {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message)); const tag = disk ? 'store: ' : 'memory: ';
    await p.addInitScript(() => {
      window.__rise = 1.8; window.__passes = 0;
      window.AudioData = class { constructor(o) { Object.assign(this, o); } close() {} };
      window.AudioEncoder = class { static async isConfigSupported(config) { return { supported: true, config }; } constructor(o) { this.o = o; this.encodeQueueSize = 0; this.first = true; } configure(c) { this.c = c; window.__passes++; }
        encode(ad) { const d = new Float32Array(ad.data), bytes = new Uint8Array(d.buffer), n = ad.numberOfFrames, ch = ad.numberOfChannels; this.o.output({ type: 'key', timestamp: ad.timestamp, duration: Math.round(n * 1e6 / ad.sampleRate), byteLength: bytes.length, copyTo(t) { new Uint8Array(t.buffer || t, t.byteOffset || 0, bytes.length).set(bytes); }, pcm: d, n, ch }, this.first ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: ad.sampleRate, numberOfChannels: ch, description: new Uint8Array([0x11, 0x90]) } } : {}); this.first = false; }
        async flush() {} close() {} };
      window.AudioDecoder = class { constructor(o) { this.o = o; this.state = 'unconfigured'; this.decodeQueueSize = 0; } configure() { this.state = 'configured'; }
        decode(c) { if (!c.pcm) return; const k = window.__rise, n = c.n; this.o.output({ numberOfFrames: n, numberOfChannels: c.ch, copyTo(t, q) { for (let i = 0; i < n; i++) t[i] = c.pcm[q.planeIndex * n + i] * k; }, close() {} }); }
        async flush() {} close() { this.state = 'closed'; } };
    });
    await p.goto('http://localhost:8123/index.html?disk=' + disk); await p.setInputFiles('#audioIn', file); await p.waitForFunction(() => S.audio && (S.audio.buffer || S.audio.disk)); await p.waitForTimeout(1000);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      window.saveFile = async blob => { window.__size = blob.size; }; S.set.audioFormat = 'm4a256'; const run = async (set, rise) => { Object.assign(AE.d, { normalize: false, limiter: false }, set); aeRefresh(); if (AE.d.limiter) await limEnsure(AE.d); window.__rise = rise; window.__passes = 0; AE.m4aLast = null; await aeExportM4a(AE.d, () => {}); return Object.assign({ passes: window.__passes, size: window.__size }, AE.m4aLast); };
      const lim = { normalize: true, normBy: 'loud', normLufs: -3, limiter: true }; await run(lim, 1);          // a first run also measures the encoder's delay (one more use of the encoder), so the counts below start after it
      return { hot: await run(lim, 1.8), fine: await run(lim, 1), off: await run({ normalize: true, normBy: 'peak', normPeakDb: -0.5 }, 1.8), top: AAC_TOP };
    });
    ok(tag + 'a limited M4A that would decode past full scale is made again, lower, and then stays under', r.hot.passes === 2 && r.hot.trim < 1 && r.hot.trim > 0.75 && r.hot.top <= r.top + 1e-6 && r.hot.top > 0.9, JSON.stringify(r.hot));
    ok(tag + 'one that decodes no higher is made once and left alone', r.fine.passes === 1 && r.fine.trim === 1 && r.fine.top <= r.top, JSON.stringify(r.fine));
    ok(tag + 'without the limiter nothing is checked or changed', r.off.passes === 1 && r.off.trim === 1 && !(r.off.top > 0), JSON.stringify(r.off));
    ok(tag + 'no page errors', !errs.length, errs.join('; ')); await p.close();
  }
  await b.close(); fs.unlinkSync(file);
})();
