// An exported M4A is exactly as long as the sound: the media ends where the sound ends (the encoder's surplus last frames are dropped and the last one cut short), the edit list skips the start padding,
// and the "roll" sample group is there, without which Apple's decoder ignores the edit list and plays padding after the end. Where macOS's afconvert exists, its decode must be exactly as long as the source.
// The test browser has an AAC encoder for 128 and 192kbps only. Run through tests/run-all.sh.
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfm4a-')), sr = 44100, secs = 7.31, n = Math.round(sr * secs), wav = Buffer.alloc(44 + n * 4);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) { const v = Math.round(0.3 * (Math.sin(2 * Math.PI * 330 * i / sr) + 0.5 * Math.sin(2 * Math.PI * 1250 * i / sr)) * 32767); wav.writeInt16LE(v, 44 + i * 4); wav.writeInt16LE(Math.round(v * 0.8), 46 + i * 4); }
const src = path.join(tmp, 'src.wav'); fs.writeFileSync(src, wav);
const boxes = (b, s, e) => { const o = []; for (let p = s; p + 8 <= e;) { const sz = b.readUInt32BE(p); o.push({ t: b.toString('latin1', p + 4, p + 8), s: p + 8, e: p + sz }); p += sz; } return o; };
const dig = (b, path) => { let s = 0, e = b.length, hit = null; for (const t of path) { hit = boxes(b, s, e).find(x => x.t === t); if (!hit) return null; s = hit.s; e = hit.e; } return hit; };
(async () => {
  const br = await chromium.launch(), p = await br.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#audioIn', src); await p.waitForFunction(() => S.audio && S.audio.buffer); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
  await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = btoa(s); }; });
  for (const kbps of [128, 192]) for (const [name, a, z] of [['whole file', 0, null], ['trimmed 1.37s to 5.02s', 1.37, 5.02]]) {
    await p.evaluate(({ kbps, a, z }) => { window.__saved = null; S.set.audioFormat = 'm4a' + kbps; AE.d.vStart = a; AE.d.vEndSet = z; aeRefresh(); }, { kbps, a, z }); await p.waitForTimeout(500);
    const supported = await p.evaluate(k => aacConfig(44100, 2, k * 1000).then(c => !!c), kbps); if (!supported) { console.log('skip ' + kbps + 'kbps: this browser has no encoder for it'); continue; }
    await p.evaluate(() => aeExport()); for (let i = 0; i < 200 && !(await p.evaluate(() => window.__saved)); i++) await p.waitForTimeout(250);
    const b = Buffer.from(await p.evaluate(() => window.__saved), 'base64'), want = Math.round(((z == null ? secs : z) - a) * sr), f = path.join(tmp, 'o' + kbps + (z ? 't' : 'w') + '.m4a'); fs.writeFileSync(f, b);
    const stbl = dig(b, ['moov', 'trak', 'mdia', 'minf', 'stbl']), mdhd = dig(b, ['moov', 'trak', 'mdia', 'mdhd']), elst = dig(b, ['moov', 'trak', 'edts', 'elst']), mvhd = dig(b, ['moov', 'mvhd']);
    const stts = boxes(b, stbl.s, stbl.e).find(x => x.t === 'stts'), ne = b.readUInt32BE(stts.s + 4); let total = 0, cnt = 0; for (let i = 0; i < ne; i++) { const c = b.readUInt32BE(stts.s + 8 + 8 * i), d = b.readUInt32BE(stts.s + 12 + 8 * i); total += c * d; cnt += c; }
    const delay = b.readUInt32BE(elst.s + 12), seg = b.readUInt32BE(elst.s + 8), movTs = b.readUInt32BE(mvhd.s + 12), mediaDur = b.readUInt32BE(mdhd.s + 16);
    const sgpd = boxes(b, stbl.s, stbl.e).find(x => x.t === 'sgpd'), sbgp = boxes(b, stbl.s, stbl.e).find(x => x.t === 'sbgp');
    const tag = kbps + 'kbps, ' + name + ': ';
    ok(tag + 'the media is the start padding plus the sound, no more', total === mediaDur && mediaDur === delay + want, JSON.stringify({ total, mediaDur, delay, want }));
    ok(tag + 'the edit list is exactly the length of the sound', Math.abs(seg / movTs * sr - want) < 1, seg + '/' + movTs + ' s vs ' + want / sr);
    ok(tag + 'the pre-roll group covers every frame', !!sgpd && !!sbgp && b.toString('latin1', sgpd.s + 4, sgpd.s + 8) === 'roll' && b.readUInt32BE(sbgp.s + 12) === cnt && b.readUInt32BE(sbgp.s + 16) === 1, 'frames ' + cnt);
    if (process.platform === 'darwin' && fs.existsSync('/usr/bin/afconvert')) { const w = path.join(tmp, 'a.wav'); cp.spawnSync('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16', f, w]); const r = cp.spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=duration_ts', '-of', 'csv=p=0', w], { encoding: 'utf8' });
      ok(tag + "Apple's decoder gives exactly the length of the sound", +r.stdout.trim() === want, r.stdout.trim() + ' vs ' + want); }
  }
  { // a bitrate this browser's encoder cannot do: the file is made at the best it can, and the message says which rate was used and which was asked for
    const has256 = await p.evaluate(() => aacConfig(44100, 2, 256000).then(c => !!c)), has192 = await p.evaluate(() => aacConfig(44100, 2, 192000).then(c => !!c));
    if (has256 || !has192) console.log('skip the fallback check: this browser ' + (has256 ? 'can encode 256kbps' : 'has no 192kbps encoder'));
    else {
      await p.evaluate(() => { window.__saved = null; S.set.audioFormat = 'm4a256'; AE.d.vStart = 0; AE.d.vEndSet = null; aeRefresh(); }); await p.waitForTimeout(500); await p.evaluate(() => aeExport()); for (let i = 0; i < 200 && !(await p.evaluate(() => window.__saved)); i++) await p.waitForTimeout(250);
      const saved = await p.evaluate(() => window.__saved), text = await p.evaluate(() => document.body.innerText);
      ok('256kbps asked for, this browser stops at 192kbps: the file is still made', !!saved);
      ok('and the message says it was made at 192kbps because the browser cannot encode 256kbps', /M4A at 192kbps/.test(text) && /can’t encode M4A at 256kbps/.test(text), text.match(/Audio saved[^\n]*\n?[^\n]*/) && text.match(/Audio saved[^\n]*\n?[^\n]*/)[0]);
    } }
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
