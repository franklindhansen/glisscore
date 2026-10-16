// The MP4 writer that writes into the disk store as it goes, set against the one that builds the file in memory. It cuts a 3 second H.264 clip with ffmpeg (needed).
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-mux-disk.js
const { chromium } = require('playwright-core'); const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const FX = process.env.S || 'tests/fixtures';
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kfmux-')), sh = c => cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// a 3 second 160x96 clip with no B-frames, cut into one sample per frame
sh(`ffmpeg -v error -y -f lavfi -i "testsrc=size=160x96:rate=10:duration=3" -c:v libx264 -bf 0 -g 10 -pix_fmt yuv420p -x264-params "keyint=10:scenecut=0" -f h264 ${tmp}/t.h264`);
const b = fs.readFileSync(tmp + '/t.h264'), nals = [];
for (let i = 0; i + 3 < b.length;) { if (b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && b[i + 3] === 1))) { const sc = b[i + 2] === 1 ? 3 : 4; let j = i + sc; while (j + 3 < b.length && !(b[j] === 0 && b[j + 1] === 0 && (b[j + 2] === 1 || (b[j + 2] === 0 && b[j + 3] === 1)))) j++; if (j + 3 >= b.length) j = b.length; nals.push(b.subarray(i + sc, j)); i = j; } else i++; }
let sps = null, pps = null, cur = []; const samples = [];
for (const n of nals) { const t = n[0] & 31; if (t === 7) { sps = n; continue; } if (t === 8) { pps = n; continue; } cur.push(n); if (t === 1 || t === 5) { samples.push({ key: t === 5, d: Buffer.concat(cur.map(n => Buffer.concat([Buffer.from([n.length >>> 24, (n.length >>> 16) & 255, (n.length >>> 8) & 255, n.length & 255]), n]))).toString('base64') }); cur = []; } }
const avcC = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]).toString('base64');
(async () => {
  const br = await chromium.launch(); const p = await br.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=1'); await p.setInputFiles('#audioIn', FX + '/s24.wav'); await p.waitForFunction(() => S.audio && S.audio.disk); await p.waitForTimeout(800);
  for (const [name, aud, co64] of [['24-bit sound', 'pcm', false], ['24-bit sound, 64-bit places', 'pcm', true], ['no sound', null, false]]) {
    const out = await p.evaluate(async ({ samples, avcC, aud, co64 }) => {
      const un = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)), fakes = samples.map(x => { const d = un(x.d); return { byteLength: d.length, type: x.key ? 'key' : 'delta', copyTo: t => t.set(d) }; });
      const meta = { decoderConfig: { description: un(avcC) } }, sr = 48000, ch = 2, fill = (blk) => { const n = sr, d = new Uint8Array(n * ch * 3); for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.round(Math.sin((blk * n + i) * 0.03 * (c + 1)) * 0.4 * 8388607) & 0xffffff, o = (i * ch + c) * 3; d[o] = v >>> 16; d[o + 1] = (v >>> 8) & 255; d[o + 2] = v & 255; } return d; };
      const build = async sink => {
        const w = new Mp4Writer({ width: 160, height: 96, fps: 10, codec: 'avc', sink, co64, audio: aud ? { sampleRate: sr, channels: ch, pcm: true } : null });
        if (sink) await w.begin();
        if (aud) for (let k = 0; k < 3; k++) { w.addPcm(fill(k), sr); if (sink) await w.drain(); }
        for (let i = 0; i < fakes.length; i++) { w.addVideo(fakes[i], i === 0 ? meta : undefined); if (sink && i % 7 === 6) await w.drain(); }
        if (!sink) return w.finalize();
        const size = await w.finalizeStream(), f = await DISK.fileDone(); return f.slice(0, size);
      };
      const mem = await build(null); await DISK.fileOpen(); const wr = diskWriter(), dsk = await build(wr);
      const bytes = async blob => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let k = 0; k < ab.length; k += 30000) s += String.fromCharCode.apply(null, ab.subarray(k, k + 30000)); return btoa(s); };
      return { mem: await bytes(mem), dsk: await bytes(dsk) };
    }, { samples, avcC, aud, co64 });
    fs.writeFileSync(tmp + '/mem.mov', Buffer.from(out.mem, 'base64')); fs.writeFileSync(tmp + '/dsk.mov', Buffer.from(out.dsk, 'base64'));
    const probe = f => JSON.parse(sh(`ffprobe -v error -show_entries stream=codec_name,codec_type,nb_frames,duration,sample_rate,channels -show_entries format=duration -of json ${f}`));
    const md5 = (f, sel) => sh(`ffmpeg -v error -i ${f} ${sel} -f md5 -`);
    const a = probe(tmp + '/mem.mov'), c = probe(tmp + '/dsk.mov');
    ok(name + ': the same streams, frames and length', JSON.stringify(a.streams) === JSON.stringify(c.streams) && a.format.duration === c.format.duration, JSON.stringify(c.streams.map(s => [s.codec_name, s.nb_frames, s.duration])));
    ok(name + ': the picture decodes the same', md5(tmp + '/mem.mov', '-map 0:v -c:v copy -bsf:v h264_mp4toannexb') === md5(tmp + '/dsk.mov', '-map 0:v -c:v copy -bsf:v h264_mp4toannexb') && md5(tmp + '/mem.mov', '-map 0:v') === md5(tmp + '/dsk.mov', '-map 0:v'));
    if (aud) ok(name + ': the sound decodes the same', md5(tmp + '/mem.mov', '-map 0:a') === md5(tmp + '/dsk.mov', '-map 0:a'));
    const err = sh(`ffmpeg -v error -i ${tmp}/dsk.mov -f null - 2>&1 || true`); ok(name + ': ffmpeg reads it without a complaint', err === '', err.slice(0, 200));
    if (co64) ok(name + ': it uses co64', fs.readFileSync(tmp + '/dsk.mov').includes('co64'));
  }
  ok('no errors', errs.length === 0, errs.join(' | ')); await br.close();
})();
