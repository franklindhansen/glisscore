'use strict';
/* ====================================================================
   Audio handling
   ==================================================================== */
let actx = null;
/* iPhone and iPad send no double-click for two quick taps (the EQ's add and remove a band, the waveform's handles and the sliders' reset all wait for one), so two taps close together in time and place make one */
{
  let last = null, down = null, real = 0;
  document.addEventListener('dblclick', e => { if (e.isTrusted) real = performance.now(); }, true);
  document.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') down = { x: e.clientX, y: e.clientY }; }, true);
  document.addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch' || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) { last = null; return; }          // a drag is not a tap
    const n = performance.now(), el = e.target;
    if (last && n - last.t < 350 && last.el === el && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
      last = null; const o = { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, view: window };
      setTimeout(() => { if (performance.now() - real > 400) el.dispatchEvent(new MouseEvent('dblclick', o)); }, 60);          // unless the browser sent one itself
    } else last = { t: n, x: e.clientX, y: e.clientY, el };
  }, true);
}
/* iPhone and iPad: the silent switch mutes everything the Web Audio API plays unless the page counts as playing media. Safari 16.4 and later take audioSession 'playback'; older ones need a silent looping audio element that is started by a touch. */
let silentEl = null;
function audioPlayback() {
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) {}
  if (navigator.audioSession || silentEl || !/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
  try {
    const n = 800, b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer), w = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const a = document.createElement('audio'); a.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); a.loop = true; a.setAttribute('playsinline', ''); a.setAttribute('aria-hidden', 'true');
    silentEl = a; const p = a.play(); if (p && p.catch) p.catch(() => { silentEl = null; });
  } catch (e) { silentEl = null; }
}
audioPlayback(); ['touchend', 'pointerdown', 'click'].forEach(t => document.addEventListener(t, audioPlayback, { capture: true, passive: true }));
function ensureCtx() { if (!actx) { audioPlayback(); const AC = window.AudioContext || window.webkitAudioContext; actx = new AC(); } return actx; }
/* the sample rate a file really has, read from its first bytes (WAV, FLAC, MP3), so it can be opened without being converted to the device's rate */
function sniffRate(b) {
  const u32 = (o, le) => ((le ? b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24 : b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0), tag = (o, t) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === t;
  if (b.length > 44 && tag(0, 'RIFF') && tag(8, 'WAVE')) { let o = 12; while (o + 8 < b.length) { if (tag(o, 'fmt ')) return u32(o + 12, true); o += 8 + u32(o + 4, true) + (u32(o + 4, true) & 1); } return null; }
  if (b.length > 22 && tag(0, 'fLaC')) return (b[18] << 12 | b[19] << 4 | b[20] >> 4);
  let o = 0; if (b.length > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) o = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
  for (let i = o; i + 4 < Math.min(b.length, o + 8192); i++) if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) { const v = (b[i + 1] >> 3) & 3, sr = (b[i + 2] >> 2) & 3; if (v === 1 || sr === 3 || ((b[i + 1] >> 1) & 3) === 0) continue; return [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]][v][sr]; }
  return null;
}
/* ---------------- M4A (AAC) decoded in pieces ----------------
   The browser's one-shot decoder gives no progress, and in Safari it can take minutes for a long recording. So the AAC frames are read out of the file (the sample tables in its moov box say where each one is)
   and fed to the browser's own decoder (WebCodecs) a bit at a time. That gives a real progress bar. The start padding the encoder added is skipped using the file's edit list, as other players do. */
function mp4Parse(ab) {
  const u8 = new Uint8Array(ab), n = u8.length, dv = new DataView(ab), type = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const kids = (from, to) => { const out = []; for (let o = from; o + 8 <= to;) { let sz = dv.getUint32(o), hs = 8; if (sz === 1 && o + 16 <= to) { sz = Number(dv.getBigUint64(o + 8)); hs = 16; } else if (sz === 0) sz = to - o; if (sz < hs || o + sz > to) break; out.push({ t: type(o + 4), s: o + hs, e: o + sz }); o += sz; } return out; };
  const get = (list, t) => list.find(k => k.t === t);
  const moov = get(kids(0, n), 'moov'); if (!moov) return null;
  const mk = kids(moov.s, moov.e), mvhd = get(mk, 'mvhd'), movTs = mvhd ? dv.getUint32(mvhd.s + (u8[mvhd.s] === 1 ? 20 : 12)) : 1000;
  for (const trak of mk.filter(k => k.t === 'trak')) {
    const tk = kids(trak.s, trak.e), mdia = get(tk, 'mdia'); if (!mdia) continue; const md = kids(mdia.s, mdia.e), hdlr = get(md, 'hdlr'); if (!hdlr || type(hdlr.s + 8) !== 'soun') continue;
    const mdhd = get(md, 'mdhd'), minf = get(md, 'minf'); if (!mdhd || !minf) continue; const stbl = get(kids(minf.s, minf.e), 'stbl'); if (!stbl) continue; const st = kids(stbl.s, stbl.e);
    const stsd = get(st, 'stsd'); if (!stsd) continue; const ent = kids(stsd.s + 8, stsd.e)[0]; if (!ent) continue; if (ent.t !== 'mp4a') return { unsupported: ent.t };
    const ch = dv.getUint16(ent.s + 16), sr = dv.getUint16(ent.s + 24), esds = get(kids(ent.s + 28, ent.e), 'esds'); if (!esds) return null;
    let o = esds.s + 4, asc = null; const tag = () => { const t = u8[o++]; let len = 0, b; do { b = u8[o++]; len = (len << 7) | (b & 127); } while (b & 128 && o < esds.e); return { t, len }; };          // the descriptors inside esds: 3 > 4 > 5 (the AudioSpecificConfig)
    let d = tag(); if (d.t === 3) { o += 2; const fl = u8[o++]; if (fl & 0x80) o += 2; if (fl & 0x40) o += 1 + u8[o]; if (fl & 0x20) o += 2; d = tag(); if (d.t === 4) { o += 13; d = tag(); if (d.t === 5) asc = u8.slice(o, o + d.len); } }
    if (!asc) return null;
    const stsz = get(st, 'stsz'), stsc = get(st, 'stsc'), stco = get(st, 'stco') || get(st, 'co64'), stts = get(st, 'stts'); if (!stsz || !stsc || !stco || !stts) return null;
    const cnt = dv.getUint32(stsz.s + 8), fixed = dv.getUint32(stsz.s + 4), sizes = new Uint32Array(cnt); for (let i = 0; i < cnt; i++) sizes[i] = fixed || dv.getUint32(stsz.s + 12 + i * 4);
    const nCh = dv.getUint32(stco.s + 4), big = stco.t === 'co64', chOff = i => big ? Number(dv.getBigUint64(stco.s + 8 + i * 8)) : dv.getUint32(stco.s + 8 + i * 4);
    const nS = dv.getUint32(stsc.s + 4), runs = []; for (let i = 0; i < nS; i++) runs.push([dv.getUint32(stsc.s + 8 + i * 12), dv.getUint32(stsc.s + 12 + i * 12)]);
    const offs = new Float64Array(cnt); let si = 0;
    for (let c = 0; c < nCh && si < cnt; c++) { let per = 0; for (const r of runs) if (r[0] <= c + 1) per = r[1]; let off = chOff(c); for (let k = 0; k < per && si < cnt; k++, si++) { offs[si] = off; off += sizes[si]; } }
    const delta = dv.getUint32(stts.s + 12) || 1024, ts = dv.getUint32(mdhd.s + (u8[mdhd.s] === 1 ? 20 : 12));
    let skip = 0, length = cnt * delta; const edts = get(tk, 'edts'), elst = edts && get(kids(edts.s, edts.e), 'elst');          // the edit list: where the real sound starts and how long it runs
    if (elst) { const v1 = u8[elst.s] === 1, n0 = dv.getUint32(elst.s + 4); for (let i = 0, p = elst.s + 8; i < n0; i++) { const sd = v1 ? Number(dv.getBigUint64(p)) : dv.getUint32(p), mt = v1 ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4); p += v1 ? 20 : 12; if (mt >= 0) { skip = Math.round(mt * sr / ts); length = Math.min(cnt * delta - skip, Math.round(sd * sr / movTs)); break; } } }
    return { sr: sr || Math.round(ts), ch, asc, offs, sizes, count: cnt, delta, skip, length: Math.max(1, length), ts };
  }
  return null;
}
/* the channels of a decoded AudioData as floats. Float output is copied in the decoder's own layout: Safari cuts everything above 0dB when it converts to another layout. */
function audioDataChannels(a) {
  const n = a.numberOfFrames, ch = a.numberOfChannels, out = [];
  if (a.format === 'f32') { const il = new Float32Array(n * ch); a.copyTo(il, { planeIndex: 0 }); for (let c = 0; c < ch; c++) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = il[i * ch + c]; out.push(x); } }
  else for (let c = 0; c < ch; c++) { const x = new Float32Array(n); a.copyTo(x, a.format === 'f32-planar' ? { planeIndex: c } : { planeIndex: c, format: 'f32-planar' }); out.push(x); }
  return out;
}
/* the whole file as an AudioBuffer, or null when this file or this browser cannot do it this way (the caller then uses the one-shot decoder) */
async function mp4DecodeAac(ab, onProgress, sink) {          // sink: the sound goes to the disk store a block at a time, not into one buffer in memory
  if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined' || typeof AudioBuffer === 'undefined') return null;
  let info; try { info = mp4Parse(ab); } catch (e) { return null; } if (!info || info.unsupported || !info.count || info.ch < 1 || info.ch > 8) return null;
  const cfg = { codec: 'mp4a.40.2', sampleRate: info.sr, numberOfChannels: info.ch, description: info.asc };
  try { const sup = await AudioDecoder.isConfigSupported(cfg); if (!sup || !sup.supported) return null; } catch (e) { return null; }
  let out = null; const chans = [], u8 = new Uint8Array(ab);
  if (sink) { if (!(await sink.begin(info))) return null; }
  else { try { out = new AudioBuffer({ length: info.length, numberOfChannels: info.ch, sampleRate: info.sr }); } catch (e) { return null; } for (let c = 0; c < info.ch; c++) chans.push(out.getChannelData(c)); }
  let pos = 0, err = null, got = 0;
  const dec = new AudioDecoder({ output: a => {
    const n = a.numberOfFrames, from = Math.max(0, info.skip - pos), to = Math.min(n, info.skip + info.length - pos);
    if (to > from) { const pl = audioDataChannels(a); if (sink) sink.push(pl, from, to); else for (let c = 0; c < info.ch; c++) chans[c].set(pl[Math.min(c, pl.length - 1)].subarray(from, to), pos + from - info.skip); }
    pos += n; got++; a.close();
  }, error: e => { err = e; } });
  dec.configure(cfg);
  for (let i = 0; i < info.count; i++) {
    if (err) break; const o = info.offs[i]; if (o + info.sizes[i] > u8.length) break;
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(i * info.delta * 1e6 / info.sr), data: u8.subarray(o, o + info.sizes[i]) }));
    if (i % 512 === 511) { if (onProgress) onProgress(i / info.count); while (dec.decodeQueueSize > 128 && !err) await new Promise(r => { const go = () => { clearTimeout(t); dec.removeEventListener('dequeue', go); r(); }, t = setTimeout(go, 40); dec.addEventListener('dequeue', go); }); await tick(); if (sink) await sink.drain(); }          // waits for the decoder itself, not for a timer
  }
  if (!err) { try { await dec.flush(); } catch (e) { err = e; } } try { dec.close(); } catch (e) {}
  if (err || !got || pos < info.skip + info.length * 0.98) return null;          // anything short of the whole sound: let the one-shot decoder do it
  if (onProgress) onProgress(1); return sink ? info : out;
}
/* what a lossy source is called in the export window ('' for WAV, FLAC, AIFF and other lossless files) */
function lossyLabel(name, alac) {          // alac: the M4A holds Apple Lossless (found when its rate was read, before the browser takes the file's memory to decode it)
  const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  if (ext === 'mp3' || ext === 'mp2') return 'MP3';
  if (ext === 'ogg' || ext === 'oga') return 'OGG'; if (ext === 'opus') return 'Opus'; if (ext === 'aac') return 'AAC'; if (ext === 'wma') return 'WMA';
  if (ext === 'm4a' || ext === 'mp4' || ext === 'm4b') return alac ? '' : 'M4A';
  return '';
}
/* M4A / MP4 / OGG: the real rate, read from the file (the moov box can sit after the sound, so the whole file is walked box by box; Opus always plays at 48 kHz) */
function sniffRateFile(ab) {
  sniffRateFile.alac = false;
  const b = new Uint8Array(ab), n = b.length, dv = new DataView(ab), tag = (o, t) => o + 4 <= n && String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === t;
  if (n > 12 && tag(4, 'ftyp')) {
    const find = (from, to, want) => { for (let o = from; o + 8 <= to;) { let sz = dv.getUint32(o), hs = 8; if (sz === 1 && o + 16 <= to) { sz = Number(dv.getBigUint64(o + 8)); hs = 16; } else if (sz === 0) sz = to - o; if (sz < hs || o + sz > to + 0) break; if (tag(o + 4, want)) return [o + hs, o + sz]; o += sz; } return null; };
    const moov = find(0, n, 'moov'); if (!moov) return null;
    for (let at = moov[0]; at + 8 <= moov[1];) {          // each trak: look for a sound entry (mp4a or alac) in its sample descriptions
      const tk = find(at, moov[1], 'trak'); if (!tk) break; at = tk[1];
      for (let o = tk[0]; o + 40 <= tk[1]; o++) if (tag(o, 'mp4a') || tag(o, 'alac')) { const r = dv.getUint16(o + 28); if (r >= 8000 && r <= 192000) { sniffRateFile.alac = tag(o, 'alac'); return r; } }
    }
    return null;
  }
  if (n > 40 && tag(0, 'OggS')) {
    for (let o = 0; o + 16 < Math.min(n, 4096); o++) {
      if (tag(o, 'Opus') && tag(o + 4, 'Head')) return 48000;
      if (b[o] === 1 && tag(o + 1, 'vorb')) return dv.getUint32(o + 12, true);
    }
  }
  return null;
}
/* the audio engine runs at the file's own rate when it can, so nothing is converted on the way in, while editing, or on the way out */
/* A 32- or 64-bit float WAV is read here, not by the browser: its samples may go above full scale (+1.0), and some browsers (Safari) cut them to ±1 when they decode. Integer WAVs cannot go above full scale, so they stay with the browser's decoder. Returns null for anything else. */
function wavFloatBuffer(ab) {
  const dv = new DataView(ab), u8 = new Uint8Array(ab), tag = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (ab.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= ab.byteLength;) {
    const id = tag(o), sz = dv.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') fmt = { o: body, sz }; else if (id === 'data') data = { o: body, sz: Math.min(sz, ab.byteLength - body) };
    o = body + sz + (sz & 1);
  }
  if (!fmt || !data || fmt.o + 16 > ab.byteLength) return null;
  let af = dv.getUint16(fmt.o, true); const ch = dv.getUint16(fmt.o + 2, true), sr = dv.getUint32(fmt.o + 4, true), bits = dv.getUint16(fmt.o + 14, true);
  if (af === 0xFFFE && fmt.sz >= 26) af = dv.getUint16(fmt.o + 24, true);          // extensible: the sub-format says what the samples are
  if (af !== 3 || (bits !== 32 && bits !== 64) || ch < 1 || ch > 8 || !sr) return null;
  const bps = bits / 8, frames = Math.floor(data.sz / (bps * ch)); if (frames < 1) return null;
  const buf = new AudioBuffer({ length: frames, numberOfChannels: ch, sampleRate: sr });
  for (let c = 0; c < ch; c++) { const out = buf.getChannelData(c); for (let i = 0; i < frames; i++) { const p = data.o + (i * ch + c) * bps; out[i] = bits === 32 ? dv.getFloat32(p, true) : dv.getFloat64(p, true); } }
  return buf;
}
/* how many samples sit exactly at full scale (±1.0). Ordinary decoded sound almost never does; a decoder that clamps leaves many, so this finds a lossy file that was clipped on the way in. Samples above full scale are real overs, kept, so they do not count */
function fullScaleCount(buf) { let n = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v >= 0.99999 && v <= 1) n++; } } return n; }
/* the loudest sample of a whole recording, in dB (above 0 means it goes over full scale) */
function bufferPeakDb(buf) { let m = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; } } return m > 1e-5 ? 20 * Math.log10(m) : -Infinity; }
/* Safari sends a context whose rate differs from the speakers' through a slow converter that delays every start and stop by a third of a second or more (the context's own timestamps do not show it). So there the context keeps the speakers' rate and the player converts the recording as it plays */
const SAFARI = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
function ctxForRate(rate) {
  audioPlayback(); const AC = window.AudioContext || window.webkitAudioContext; if (!rate || rate < 8000 || rate > 192000 || SAFARI) return ensureCtx();
  if (actx && actx.sampleRate === rate) return actx;
  try { const next = new AC({ sampleRate: rate }); if (next.sampleRate === rate) { const old = actx; actx = next; if (old) { try { old.close(); } catch (e) {} } return actx; } try { next.close(); } catch (e) {} } catch (e) {}
  return ensureCtx();
}
/* Surround files (4, 6 or 8 channels) become stereo the standard way: centre and surrounds fold in at -3dB, the low-effects channel is left out, and the sum is scaled by 1/1.7 to keep the level close to the original.
   Channel order as Web Audio gives it: 4 = L R SL SR, 6 = L R C LFE SL SR, 8 = L R C LFE SL SR BL BR. */
function stereoTaps(n) {          // [channel, weight, side] for each channel that goes into the stereo sum
  const g = Math.SQRT1_2;
  const W = n === 4 ? [[0, 1], [2, g, 0], [3, g, 1]] : n === 6 ? [[0, 1], [1, 1], [2, g, 0], [2, g, 1], [4, g, 0], [5, g, 1]] : n === 8 ? [[0, 1], [1, 1], [2, g, 0], [2, g, 1], [4, g, 0], [5, g, 1], [6, g, 0], [7, g, 1]] : null;
  const taps = W ? W.map(w => w.length === 2 ? [w[0], w[1], w[0] % 2] : [w[0], w[1], w[2]]) : Array.from({ length: n }, (_, i) => [i, 1, i % 2]);          // other counts: even channels left, odd right
  const sumL = W ? 1 + g : taps.filter(t => t[2] === 0).reduce((a, t) => a + t[1], 0) || 1, sumR = W ? 1 + g : taps.filter(t => t[2] === 1).reduce((a, t) => a + t[1], 0) || 1;
  return taps.map(([c, w, side]) => [c, w / (side ? sumR : sumL), side]);
}
function downmixStereo(b) {
  const n = b.numberOfChannels, mixL = new Float32Array(b.length), mixR = new Float32Array(b.length), ch = i => b.getChannelData(i);
  for (const [c, k, side] of stereoTaps(n)) { const x = ch(c), o = side ? mixR : mixL; for (let i = 0; i < x.length; i++) o[i] += x[i] * k; }
  const out = new AudioBuffer({ length: b.length, numberOfChannels: 2, sampleRate: b.sampleRate }); out.copyToChannel(mixL, 0); out.copyToChannel(mixR, 1); return out;
}
/* ---------------- The player ----------------
   Everything that is heard comes out of one player on the audio thread. The text below is that player; the limiter (LIM_CODE) and the dynamic bands (audio-fx.js) are put in front of it when it is loaded, so each has one source. */
const PLAY_CODE = `
/* One player makes all the sound that is heard. It runs on the audio thread and takes the recording in blocks, by message, from memory or from the disk store, and copies them out one after another, sample by sample,
   so a join between two blocks cannot shift or click whatever the browser does with start times. It reports how far it has played, and counts the times it ran dry. For checks it can also send back exactly what it put out (echo).
   The EQ, the Imager, the volume with its fades and the limiter are worked out here too, on the samples the player holds. Nothing is read back from the browser's own audio path:
   Safari's fingerprinting protection adds noise to whatever a script reads from there, and a limiter or filter fed that way would put the noise into the sound. The level meter gets its samples from here for the same reason.
   When the recording changes while it plays (flush), it keeps a moment of what it already holds so the sound does not stop, drops the rest, says where the new sound must start (cut),
   and eases from the old sound into the new over a few milliseconds so the change does not click. */
/* the EQ's filters. New settings arrive as numbers and the filters glide to them over 20ms, so a moving band neither clicks nor steps */
class EqM {
  constructor(p) {
    this.c = Float64Array.from(p.coefs); this.d = new Float64Array(this.c.length); this.t = Float64Array.from(p.coefs); this.g = p.gain; this.tg = p.gain; this.dg = 0; this.left = 0;
    this.items = p.items; this.dyn = p.dyn; this.ds = new Float64Array(Math.max(1, p.dyn.length * EQ_DYN_ST)); this.ms = !!p.ms && p.nch === 2; this.solo = p.solo || 0;          // items: in order, a filter (s: its place among the numbers) or a dynamic band (d); c: 0 on the whole sound, 1 on the mid, 2 on the side, 3 on nothing; with ms the two lines are the mid and the side
    this.st = []; for (let c = 0; c < p.nch; c++) this.st.push(new Float64Array(Math.max(4, this.c.length / 5 * 4)));
  }
  set(m) {
    if (!m.coefs || m.coefs.length !== this.c.length) return; if (m.dyn && m.dyn.length === this.dyn.length) this.dyn = m.dyn;
    this.left = Math.max(1, Math.round(sampleRate * 0.02)); for (let i = 0; i < this.c.length; i++) { this.t[i] = m.coefs[i]; this.d[i] = (m.coefs[i] - this.c[i]) / this.left; } this.tg = m.gain; this.dg = (m.gain - this.g) / this.left;
  }
  run(out, n) {
    const c = this.c, its = this.items, ms = this.ms && out.length === 2, nl = out.length; let i0 = 0;
    if (ms) { const l = out[0], r = out[1]; for (let i = 0; i < n; i++) { const a = l[i], b = r[i]; l[i] = (a + b) * 0.5; r[i] = (a - b) * 0.5; } }
    while (i0 < n) {
      const m = this.left > 0 ? Math.min(16, n - i0, this.left) : n - i0;          // while gliding, the numbers move every 16 samples
      for (let b = 0; b < its.length; b++) {
        const it = its[b], k = it.c; if (k === 3) continue;
        const u0 = !(ms && k === 2), u1 = nl > 1 && !(ms && k === 1);
        if (it.d >= 0) { const o = it.d * EQ_DYN_ST; if (u0 && u1) eqDynRun(this.dyn[it.d], this.ds, o, out[0], out[0], out[1], out[1], m, i0); else if (u0) eqDynRun(this.dyn[it.d], this.ds, o, out[0], out[0], null, null, m, i0); else if (u1) eqDynRun(this.dyn[it.d], this.ds, o, out[1], out[1], null, null, m, i0); continue; }
        const q = it.s * 5, s = it.s * 4, b0 = c[q], b1 = c[q + 1], b2 = c[q + 2], a1 = c[q + 3], a2 = c[q + 4];
        for (let ch = 0; ch < nl; ch++) { if (ms && (k === 1 ? ch === 1 : k === 2 ? ch === 0 : false)) continue; const y = out[ch], st = this.st[Math.min(ch, this.st.length - 1)]; let x1 = st[s], x2 = st[s + 1], y1 = st[s + 2], y2 = st[s + 3];
          for (let i = i0; i < i0 + m; i++) { const x = y[i], v = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v; }
          st[s] = x1; st[s + 1] = x2; st[s + 2] = y1; st[s + 3] = y2; }
      }
      const g = this.g; if (g !== 1) for (let ch = 0; ch < nl; ch++) { const y = out[ch]; for (let i = i0; i < i0 + m; i++) y[i] *= g; }
      if (this.left > 0) { this.left -= m; if (this.left <= 0) { c.set(this.t); this.g = this.tg; this.left = 0; } else { for (let i = 0; i < c.length; i++) c[i] += this.d[i] * m; this.g += this.dg * m; } }
      i0 += m;
    }
    if (ms) { const l = out[0], r = out[1], so = this.solo; for (let i = 0; i < n; i++) { const a = so === 2 ? 0 : l[i], b = so === 1 ? 0 : r[i]; l[i] = a + b; r[i] = a - b; } }
  }
}
/* the Imager: the same list of small steps the disk store and exports run (a filter, a volume, two lines added), on numbered lines of sound. A moved slider glides to its new numbers over 20ms */
class PlanM {
  constructor(p) {
    this.ops = p.ops; this.out = p.out; this.lines = p.lines; this.c = Float64Array.from(p.coefs); this.t = Float64Array.from(p.coefs); this.d = new Float64Array(this.c.length);
    this.g = new Float64Array(p.ops.length); for (let j = 0; j < p.ops.length; j++) if (p.ops[j][0] === 1) this.g[j] = p.ops[j][3]; this.gt = Float64Array.from(this.g); this.gd = new Float64Array(this.g.length);
    this.st = new Float64Array(Math.max(4, p.nbq * 4)); this.buf = []; this.left = 0;
  }
  set(m) {
    if (!m.coefs || m.coefs.length !== this.c.length || !m.ops || m.ops.length !== this.ops.length) return;
    this.left = Math.max(1, Math.round(sampleRate * 0.02)); for (let i = 0; i < this.c.length; i++) { this.t[i] = m.coefs[i]; this.d[i] = (m.coefs[i] - this.c[i]) / this.left; }
    for (let j = 0; j < this.ops.length; j++) if (this.ops[j][0] === 1) { this.gt[j] = m.ops[j][3]; this.gd[j] = (this.gt[j] - this.g[j]) / this.left; }
  }
  run(out, n) {
    const buf = this.buf, ops = this.ops, c = this.c, st = this.st, g = this.g; if (!buf.length || buf[0].length !== n) { buf.length = 0; for (let i = 0; i < this.lines; i++) buf.push(new Float32Array(n)); }
    for (let ch = 0; ch < out.length; ch++) buf[ch].set(out[ch]); let i0 = 0;
    while (i0 < n) {
      const m = this.left > 0 ? Math.min(16, n - i0, this.left) : n - i0, e = i0 + m;
      for (let j = 0; j < ops.length; j++) {
        const op = ops[j], s = buf[op[1]], d = buf[op[2]];
        if (op[0] === 0) {
          const q = op[3] * 5, o = op[3] * 4, b0 = c[q], b1 = c[q + 1], b2 = c[q + 2], a1 = c[q + 3], a2 = c[q + 4]; let x1 = st[o], x2 = st[o + 1], y1 = st[o + 2], y2 = st[o + 3];
          for (let i = i0; i < e; i++) { const x = s[i], y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; d[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y; }
          st[o] = x1; st[o + 1] = x2; st[o + 2] = y1; st[o + 3] = y2;
        } else if (op[0] === 1) { const v = g[j]; for (let i = i0; i < e; i++) d[i] = s[i] * v; }
        else { const t = buf[op[3]]; for (let i = i0; i < e; i++) d[i] = s[i] + t[i]; }
      }
      if (this.left > 0) { this.left -= m; if (this.left <= 0) { c.set(this.t); g.set(this.gt); this.left = 0; } else { for (let i = 0; i < c.length; i++) c[i] += this.d[i] * m; for (let j = 0; j < g.length; j++) g[j] += this.gd[j] * m; } }
      i0 = e;
    }
    for (let ch = 0; ch < out.length; ch++) out[ch].set(buf[this.out[ch]]);
  }
}
class Player extends AudioWorkletProcessor {
  constructor(o) {
    super(); const p = (o && o.processorOptions) || {}; this.echo = !!p.echo; this.q = []; this.off = 0; this.played = 0; this.queued = 0; this.started = -1; this.gaps = 0; this.ending = false; this.done = false; this.told = false; this.last = 0; this.tail = null;
    this.fx = false; this.warm = null; this.hr = 32768; this.hist = []; this.hw = 0; this.hn = 128; this.wt = []; this.cur = []; this.old = null; this.xi = 0; this.xn = 0; this.pre = 1; this.preT = 1; this.lis = 0; this.g = 1; this.gT = 1; this.lim = null; this.limP = null; this.wet = 0; this.wetT = 0; this.tmp = []; this.wb = [];
    this.kPre = 1 - Math.exp(-1 / (sampleRate * 0.04)); this.kG = 1 - Math.exp(-1 / (sampleRate * 0.02)); this.kW = 1 - Math.exp(-1 / (sampleRate * 0.01));
    this.fn = p.ease ? Math.max(1, Math.round(sampleRate * 0.01)) : 0; this.fi = this.fn;          // ease: the first sound comes in over 10ms, so starting mid-wave does not click
    this.mt = p.meter ? new Float32Array(2048) : null; this.mi = 0; this.mc = 0;          // meter: the last 2048 samples put out (left and right averaged), sent to the page 40 times a second for the level meter
    if (p.init) this.cmd(p.init);
    this.port.onmessage = e => { const d = e.data; if (d.flush) this.flush(d.keep, d.fade); if (d.chans) { if (this.tail) this.join(d.chans); this.q.push(d.chans); this.queued += d.chans[0].length; if (d.end) this.ending = true; this.port.postMessage({ got: this.queued }); } if (d.set) this.cmd(d.set); if (d.stop) { this.q = []; this.done = true; } };
  }
  /* the tools: chain (the EQ and Imager in order; with xf, eased in over that many frames as the ones before ease out), upd (new numbers for the same filters), pre (a volume ahead of everything, for the original at matched loudness),
     lis (hear only the mid, 1, or the side, 2), gain (the volume, with the fades), lim (the limiter after the volume: on or off, eased over a few milliseconds). now: taken at once instead of eased */
  cmd(d) {
    this.fx = true;
    if (d.chain !== undefined) {
      const next = (d.chain || []).map(m => m.k === 'eq' ? new EqM(m) : new PlanM(m)); this.warm = null;
      if (d.xf > 0 && next.length && this.hw > 0) this.warm = { next, xf: d.xf, p: Math.max(0, this.hw - this.hn * Math.floor(Math.min(Math.round(sampleRate * 0.25), this.hr - 4096) / this.hn)) };          // new filters start from rest, so they first run over the last quarter second of sound, then take over
      else { if (d.xf > 0) { this.old = this.cur; this.xi = 0; this.xn = d.xf; } else this.old = null; this.cur = next; }
    }
    if (this.warm) { const h = this.warm.hold || (this.warm.hold = {}); for (const k of ['pre', 'lis', 'gain', 'lim', 'now']) if (d[k] !== undefined) h[k] = d[k]; d = { upd: d.upd }; }          // the volume, the limiter and the rest wait for the new filters, so everything changes together
    if (d.upd) { if (this.warm) { if (d.upd.length === this.warm.next.length) d.upd.forEach((m, i) => this.warm.next[i].set(m)); } else if (d.upd.length === this.cur.length) d.upd.forEach((m, i) => this.cur[i].set(m)); }
    if (d.pre != null) { this.preT = d.pre; if (d.now) this.pre = d.pre; }
    if (d.lis != null) this.lis = d.lis;
    if (d.gain != null) { this.gT = d.gain; if (d.now) this.g = d.gain; }
    if (d.lim) { this.limP = d.lim; this.wetT = d.lim.on ? 1 : 0; if (d.now) this.wet = this.wetT; }
  }
  /* keep the next 'keep' frames, hold the 'fade' frames after them to ease out of, drop everything else */
  flush(keep, fade) {
    let have = -this.off; for (const b of this.q) have += b[0].length; const n = Math.max(0, Math.min(have, keep + fade)), nch = this.q.length ? this.q[0].length : 0, flat = [];
    for (let c = 0; c < nch; c++) { const x = new Float32Array(n); let at = 0, off = this.off; for (const b of this.q) { if (at >= n) break; const take = Math.min(n - at, b[c].length - off); x.set(b[c].subarray(off, off + take), at); at += take; off = 0; } flat.push(x); }
    const kept = Math.max(0, n - fade); this.q = kept ? [flat.map(x => x.subarray(0, kept))] : []; this.off = 0; this.tail = n > kept ? flat.map(x => x.subarray(kept)) : null; this.ending = false; this.told = false;
    this.queued = this.played + kept; this.port.postMessage({ cut: this.queued });
  }
  join(chans) { const t = this.tail, n = Math.min(t[0].length, chans[0].length); for (let c = 0; c < chans.length; c++) { const x = chans[c], y = t[Math.min(c, t.length - 1)]; for (let i = 0; i < n; i++) { const w = (i + 1) / (n + 1); x[i] = x[i] * w + y[i] * (1 - w); } } this.tail = null; }
  room(list, nl, n) { if (list.length !== nl || list[0].length !== n) { list.length = 0; for (let c = 0; c < nl; c++) list.push(new Float32Array(n)); } return list; }
  /* a volume that eases to where it is going, the same on every channel */
  ease(out, n, from, to, k) { let v = from; for (let c = 0; c < out.length; c++) { const y = out[c]; v = from; for (let i = 0; i < n; i++) { v += (to - v) * k; y[i] *= v; } } return Math.abs(to - v) < 1e-6 ? to : v; }
  /* the new filters run over the kept sound a little at a time (so no one block takes long), and when they have caught up with the sound that is playing they ease in as the old ones ease out */
  warmStep(n, nl) {
    const w = this.warm, t = this.room(this.wt, nl, n); let budget = 2048;
    while (budget >= n && w.p + n <= this.hw) {
      for (let c = 0; c < nl; c++) { const h = this.hist[c], at = w.p % this.hr; if (at + n <= this.hr) t[c].set(h.subarray(at, at + n)); else { t[c].set(h.subarray(at)); t[c].set(h.subarray(0, n - (this.hr - at)), this.hr - at); } }
      for (const m of w.next) m.run(t, n); w.p += n; budget -= n;
    }
    if (w.p + n > this.hw) { this.old = this.cur; this.xi = 0; this.xn = w.xf; this.cur = w.next; this.warm = null; if (w.hold) this.cmd(w.hold); }
  }
  /* the block the player has just laid out, through the tools, in the order they sit in: EQ and Imager, the volume, the limiter. outs[2] hears it after the filters and outs[1] after the volume (for checks) */
  tools(outs, n) {
    const out = outs[0], nl = out.length;
    if (!this.hist.length) for (let c = 0; c < nl; c++) this.hist.push(new Float32Array(this.hr));
    this.hn = n; if (this.warm) this.warmStep(n, nl);
    for (let c = 0; c < nl; c++) { const h = this.hist[c], y = out[c], at = this.hw % this.hr; if (at + n <= this.hr) h.set(y, at); else { h.set(y.subarray(0, this.hr - at), at); h.set(y.subarray(this.hr - at), 0); } }          // the sound as it comes in, before any filter, is kept for the next chain to warm up on
    this.hw += n;
    if (this.old) {
      const tmp = this.room(this.tmp, nl, n); for (let c = 0; c < nl; c++) tmp[c].set(out[c]);
      for (const m of this.old) m.run(tmp, n); for (const m of this.cur) m.run(out, n);
      for (let c = 0; c < nl; c++) { const y = out[c], x = tmp[c]; for (let i = 0; i < n; i++) { const w = Math.min(1, (this.xi + i + 1) / this.xn); y[i] = y[i] * w + x[i] * (1 - w); } }
      this.xi += n; if (this.xi >= this.xn) this.old = null;
    } else for (const m of this.cur) m.run(out, n);
    if (this.pre !== 1 || this.preT !== 1) this.pre = this.ease(out, n, this.pre, this.preT, this.kPre);
    if (this.lis && nl === 2) { const l = out[0], r = out[1], s = this.lis === 1 ? 0.5 : -0.5; for (let i = 0; i < n; i++) { const v = l[i] * 0.5 + r[i] * s; l[i] = v; r[i] = v; } }
    if (outs[2]) for (let c = 0; c < outs[2].length; c++) outs[2][c].set(out[Math.min(c, nl - 1)]);
    if (this.g !== 1 || this.gT !== 1) this.g = this.ease(out, n, this.g, this.gT, this.kG);
    if (outs[1]) for (let c = 0; c < outs[1].length; c++) outs[1][c].set(out[Math.min(c, nl - 1)]);
    if (this.limP) {          // the limiter keeps running whether it is heard or not, so switching it in or out is only a matter of easing between the two
      if (!this.lim) this.lim = new Lim(sampleRate, nl, this.limP.ceil, 80, this.limP.tp);
      const w = this.room(this.wb, nl, n); this.lim.process(out, w, n);
      if (this.wet === 1 && this.wetT === 1) for (let c = 0; c < nl; c++) out[c].set(w[c]);
      else if (this.wet !== 0 || this.wetT !== 0) { let v = this.wet; const t = this.wetT, k = this.kW; for (let c = 0; c < nl; c++) { const y = out[c], x = w[c]; v = this.wet; for (let i = 0; i < n; i++) { v += (t - v) * k; y[i] = y[i] * (1 - v) + x[i] * v; } } this.wet = Math.abs(t - v) < 1e-6 ? t : v; }
    }
  }
  process(inputs, outputs) {
    const out = outputs[0], n = out[0].length; let i = 0;
    while (i < n && this.q.length) {
      const b = this.q[0], take = Math.min(n - i, b[0].length - this.off);
      for (let c = 0; c < out.length; c++) out[c].set(b[Math.min(c, b.length - 1)].subarray(this.off, this.off + take), i);
      if (this.started < 0) this.started = currentFrame + i;
      i += take; this.off += take; if (this.off === b[0].length) { this.q.shift(); this.off = 0; }
    }
    if (i < n) for (let c = 0; c < out.length; c++) out[c].fill(0, i);          // when the blocks run out the rest is silence, whatever the engine left in the block
    if (this.fi > 0 && i) { const N = this.fn; let f = this.fi; for (let c = 0; c < out.length; c++) { const y = out[c]; f = this.fi; for (let k = 0; k < n; k++) { y[k] *= 1 - f / N; if (f > 0) f--; } } this.fi = f; }
    this.played += i; if (this.fx || outputs.length > 1) this.tools(outputs, n);
    if (this.mt) { const m = this.mt, l = out[0], r = out[1] || l; let k = this.mi; for (let j = 0; j < n; j++) { m[k] = (l[j] + r[j]) * 0.5; k = (k + 1) & 2047; } this.mi = k; this.mc += n; if (this.mc >= 1024) { this.mc = 0; const w = new Float32Array(2048); w.set(m.subarray(k)); w.set(m.subarray(0, k), 2048 - k); this.port.postMessage({ wave: w }, [w.buffer]); } }
    if (this.echo && i) this.port.postMessage({ echo: out.map(x => x.slice(0, i)) });
    const ended = this.ending && !this.q.length; if (i < n && this.started >= 0 && !ended && !this.done) this.gaps++;
    if (currentFrame - this.last >= 2048 || (ended && !this.told)) { this.last = currentFrame; this.told = ended; this.port.postMessage({ played: this.played, at: currentFrame + n, started: this.started, gaps: this.gaps, ended }); }
    return !this.done;
  }
}
registerProcessor('glisscore-player', Player);
`;
function playPrepare(ac) {
  if (!ac || !ac.audioWorklet || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);
  if (!ac._playP) {
    const text = LIM_CODE + '\n' + KFX.eqDynRun.toString() + '\nconst EQ_DYN_ST = ' + KFX.EQ_DYN_ST + ';\n' + PLAY_CODE, load = url => ac.audioWorklet.addModule(url), blob = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })), data = 'data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(text)));
    ac._playP = load(blob).catch(() => load(data)).then(() => { URL.revokeObjectURL(blob); return true; }, e => { dbg('The player could not start: ' + (e && e.message || e)); return false; });          // a page opened straight from a file refuses blob modules; a data module works there
  }
  return ac._playP;
}
/* plays a recording from a frame. s is the recording: { sr, ch, frames, get(at, n) gives { chans } }. Blocks of ten seconds are fetched a little ahead of the playhead and handed to the player,
   which copies them out one after another, so the joins are exact. (Starting one buffer after another on a timetable was tried first: Safari did not keep them on their frames.)
   opt.init: what the player is told before the first sound (see its cmd); opt.taps: two more outputs, the sound after the volume (1) and after the filters (2); opt.ease: the first sound is eased in; opt.meter: the player sends back what it puts out, for the level meter */
async function soundPlay(ac, s, from, dest, opt = {}) {
  const sr = s.sr, CH = opt.chunk || 10 * sr, ahead = (opt.ahead || 20) * sr, end = Math.min(s.frames, opt.end || s.frames); from = clamp(Math.floor(from), 0, end);
  if (!(await playPrepare(ac))) throw new Error('The player could not start in this browser.');
  const node = new AudioWorkletNode(ac, 'glisscore-player', { numberOfInputs: 0, numberOfOutputs: opt.taps ? 3 : 1, outputChannelCount: opt.taps ? [s.ch, s.ch, s.ch] : [s.ch], processorOptions: { echo: !!opt.echo, ease: !!opt.ease, meter: !!opt.meter, init: opt.init || null } }), heard = [];
  let next = from, sent = 0, got = 0, st = { played: 0, at: 0, started: -1, gaps: 0, ended: false }, stopped = false, busy = false, again = false, gen = 0, hold = false, quick = !!opt.quick, timer = null, onGot = null, onCut = null, onFirst = null, wave = null;
  /* the first block after a start or a change is a short one, so the sound comes at once; a change of setting (refresh) makes any block still on its way out of date, and it is dropped.
     For a moment after it (2.5s) only three seconds are kept ready, a second at a time, and after that the blocks grow with what is already waiting (up to ten seconds, twenty ahead),
     so the store is never busy for long on one block while a slider is still moving: the next change finds it free */
  const grow = !opt.chunk; let calm = performance.now() + 2500;
  const fill = async () => {
    if (stopped || hold) return; if (busy) { again = true; return; } busy = true;
    try { while (!stopped && next < end && sent - st.played < (grow && performance.now() < calm ? Math.min(ahead, 3 * sr) : ahead)) { const g = gen, at = next, r = await s.get(at, Math.min(quick || (grow && performance.now() < calm) ? Math.min(CH, sr) : grow ? clamp(sent - st.played, sr, CH) : CH, end - at)), n = r.chans[0].length; if (stopped || !n || g !== gen || hold) break; quick = false; next = at + n; sent += n; node.port.postMessage({ chans: r.chans, end: next >= end }, r.chans.map(x => x.buffer)); if (onFirst) { onFirst(); onFirst = null; } } }
    finally { busy = false; if (again) { again = false; fill(); } }
  };
  const settle = async () => { const t0 = performance.now(); while ((busy || got < sent) && performance.now() - t0 < 3000) await new Promise(r => { onGot = r; setTimeout(r, 100); }); };          // everything asked for is in the player's hands
  node.port.onmessage = e => { const d = e.data; if (d.got != null) { got = d.got; if (onGot) onGot(); } else if (d.cut != null) { if (onCut) onCut(d.cut); } else if (d.echo) heard.push(d.echo); else if (d.wave) wave = d.wave; else { st = d; fill(); } };
  node.connect(dest, 0); await fill();
  if (opt.once) await settle();          // an offline render starts right after
  else timer = setInterval(fill, 500);
  return { sr, get startFrame() { return st.started; }, heard: () => heard, gaps: () => st.gaps, ended: () => st.ended,
    frame: () => st.started < 0 ? from : clamp(from + st.played + (st.ended ? 0 : Math.max(0, Math.round(ac.currentTime * sr) - st.at)), from, from + sent),
    post(m) { if (!stopped) { try { node.port.postMessage({ set: m }); } catch (e) {} } },          // the tools, to the player
    tap(i, to) { node.connect(to, i); }, wave: () => wave,          // opt.meter: the last 2048 samples put out, for the level meter
    /* the sound changed (the store's tools were set, or another recording in memory took over): what plays carries on for a quarter of a second (or the given number of frames), then the new sound takes over. Gives the frame where it does */
    async refresh(keepNow) {
      if (stopped) return -1; gen++; hold = true; const cut = await new Promise(res => { onCut = res; node.port.postMessage({ flush: true, keep: keepNow != null ? keepNow : opt.keep != null ? opt.keep : Math.round(sr / 4), fade: opt.fade != null ? opt.fade : 1024 }); }); onCut = null;
      sent = got = cut; next = Math.min(end, from + cut); quick = !!opt.quick; calm = performance.now() + 2500; hold = false; const at = next; if (opt.once) { await fill(); await settle(); } else { await new Promise(res => { onFirst = res; setTimeout(res, 3000); fill(); }); }          // back as soon as the first new block is with the player
      return at;
    },
    stop() { stopped = true; clearInterval(timer); try { node.port.postMessage({ stop: true }); } catch (e) {} try { node.disconnect(); } catch (e) {} } };
}
/* a recording held in memory, as the player takes it. use(buffer) puts another in its place (the cleaned-up sound once it is ready). When the recording's rate is not the one the browser plays at, it is converted on the way (the app's own converter) */
function memSound(ac, buf) {
  const s = { sr: ac.sampleRate, ch: buf.numberOfChannels, frames: 0, buf: null, get: null };
  s.use = b => {
    const chans = []; for (let c = 0; c < s.ch; c++) chans.push(b.getChannelData(Math.min(c, b.numberOfChannels - 1))); s.buf = b;
    if (b.sampleRate === ac.sampleRate) { s.frames = b.length; s.get = async (at, n) => ({ chans: chans.map(x => x.slice(at, at + n)) }); }
    else { const rs = KFX.resampled(async (a, n) => ({ chans: chans.map(x => x.subarray(a, a + n)) }), { sr: b.sampleRate, ch: s.ch, frames: b.length }, ac.sampleRate, b.duration); s.frames = rs.info.frames; s.get = (at, n) => rs.read(at, Math.min(n, ac.sampleRate)); }          // a second at a time, so the page stays smooth
  };
  s.use(buf); return s;
}
/* ---------------- Long recordings on disk ----------------
   An hour-long recording does not fit in memory several times over, so it can live in the site's private storage, written and read by a worker (audio-store-worker.js).
   To everything else it is one continuous recording: read(start, n) gives any range of frames, and the waveform comes from peaks measured while the file was read in.
   WAV files are copied a block at a time by the worker, never read whole. M4A is decoded here a piece at a time and sent over as it comes. */
const DISK = {
  w: null, seq: 0, wait: new Map(), meta: null, fxSig: '',
  can() { return typeof Worker !== 'undefined' && !!(navigator.storage && navigator.storage.getDirectory) && location.protocol !== 'file:'; },
  call(cmd, o, transfer, opt) {
    if (!this.w) {
      this.w = new Worker('audio-store-worker.js');
      this.w.onmessage = e => { const d = e.data, p = this.wait.get(d.id); if (!p) return; if (d.progress != null) { if (p.opt && p.opt.stale && p.opt.stale()) this.w.postMessage({ cmd: 'cancel', target: d.id }); else if (p.opt && p.opt.onProgress) p.opt.onProgress(d.progress); return; } this.wait.delete(d.id); if (d.ok) p.res(d.result); else p.rej(d.stale ? STALE : new Error(d.error)); };
      this.w.onerror = e => { const err = new Error(e.message || 'The disk store stopped.'); for (const p of this.wait.values()) p.rej(err); this.wait.clear(); try { this.w.terminate(); } catch (e2) {} this.w = null; this.meta = null; this.fxSig = ''; this.fxSigE = ''; this.fxSigE = ''; };
    }
    const id = ++this.seq; return new Promise((res, rej) => { this.wait.set(id, { res, rej, opt }); this.w.postMessage(Object.assign({ id, cmd }, o), transfer || []); });
  },
  keyOf: file => file.name + '|' + file.size + '|' + file.lastModified,
  /* the file, written to the store. Gives what the store knows about it ({ sr, ch, frames, peaks, peakMax, … }), or null when this kind of file or this browser cannot do it this way */
  async importFile(file, opt = {}) {
    if (!this.can()) return null;
    const h = new Uint8Array(await file.slice(0, 12).arrayBuffer()), tag = (o, t) => h.length >= o + 4 && t.split('').every((ch, i) => h[o + i] === ch.charCodeAt(0)), key = this.keyOf(file);
    let m = null;
    if ((tag(0, 'RIFF') || tag(0, 'RF64') || tag(0, 'BW64')) && tag(8, 'WAVE')) m = await this.call('importWav', { file, key, piece: opt.piece }, null, opt);
    else if (tag(0, 'FORM') && (tag(8, 'AIFF') || tag(8, 'AIFC'))) m = await this.call('importAiff', { file, key, piece: opt.piece }, null, opt);
    else if (tag(0, 'fLaC')) m = await this.call('importFlac', { file, key, piece: opt.piece }, null, opt);
    else if (tag(4, 'ftyp')) { m = await this.call('importAlac', { file, key, piece: opt.piece }, null, opt); if (!m) m = await this.importM4a(file, key, opt); }
    else if (tag(0, 'OggS')) m = await this.importOgg(file, key, opt);
    else if (/\.mp3$/i.test(file.name) || tag(0, 'ID3') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) m = await this.importMp3(file, key, opt);
    if (m) m.duration = m.frames / m.sr;
    return (this.meta = m);
  },
  /* MP3 (MPEG audio layer III): the frames are cut out of the file here and the browser's own decoder (WebCodecs) turns them into sound, a piece at a time, into the store. The encoder's padding at the start and end is cut
     away the way a player does it (from the LAME/Xing header; with none, nothing is cut, as the one-shot decoder does it). Anything else (another layer, a rate or channel change in the middle, no decoder in this browser) gives null: the usual way. */
  async importMp3(file, key, opt) {
    if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') return null;
    const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], SR = [[11025, 12000, 8000], [0, 0, 0], [22050, 24000, 16000], [44100, 48000, 32000]];
    const hdr = (b, o) => {          // the frame that starts at o, or null
      if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
      const ver = (b[o + 1] >> 3) & 3, layer = (b[o + 1] >> 1) & 3, bi = b[o + 2] >> 4, si = (b[o + 2] >> 2) & 3, pad = (b[o + 2] >> 1) & 1; if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return null;
      const sr = SR[ver][si], mpeg1 = ver === 3, br = (mpeg1 ? BR1 : BR2)[bi] * 1000, mono = (b[o + 3] >> 6) === 3, len = Math.floor((mpeg1 ? 144 : 72) * br / sr) + pad;
      return { sr, ch: mono ? 1 : 2, spf: mpeg1 ? 1152 : 576, len, mpeg1, crc: !(b[o + 1] & 1) };
    };
    let at = 0; { const h = new Uint8Array(await file.slice(0, 10).arrayBuffer()); if (h[0] === 0x49 && h[1] === 0x44 && h[2] === 0x33) at = 10 + ((h[6] & 127) << 21 | (h[7] & 127) << 14 | (h[8] & 127) << 7 | (h[9] & 127)) + (h[5] & 16 ? 10 : 0); }
    const WIN = 8 << 20; let win = new Uint8Array(await file.slice(at, at + WIN).arrayBuffer()), base = at, pos = 0;
    const find = () => { for (; pos + 4 < win.length; pos++) { const h = hdr(win, pos); if (h && (pos + h.len + 4 > win.length ? base + pos + h.len >= file.size : hdr(win, pos + h.len))) return h; } return null; };          // a frame counts when another follows it (or it is the last)
    let first = find(); if (!first) return null;
    let skip = 0, trim = 0, expect = 0, lame = false;
    { const so = first.mpeg1 ? (first.ch === 1 ? 17 : 32) : (first.ch === 1 ? 9 : 17), x = pos + 4 + (first.crc ? 2 : 0) + so, tag = String.fromCharCode(win[x], win[x + 1], win[x + 2], win[x + 3]);
      if (tag === 'Xing' || tag === 'Info') {
        const dv = new DataView(win.buffer, win.byteOffset), fl = dv.getUint32(x + 4); let o = x + 8; if (fl & 1) { expect = dv.getUint32(o); o += 4; } if (fl & 2) o += 4; if (fl & 4) o += 100; if (fl & 8) o += 4;
        if (/^(LAME|Lavc|Lavf|GOGO|L3.|Xing)/.test(String.fromCharCode.apply(null, win.subarray(o, o + 4))) && o + 24 <= win.length) { const d = (win[o + 21] << 4) | (win[o + 22] >> 4), pd = ((win[o + 22] & 15) << 8) | win[o + 23]; if (d + pd < 4 * 1152) { skip = d + 529; trim = Math.max(0, pd - 529); lame = true; } }
        pos += first.len; first = find(); if (!first) return null;          // that frame holds no sound
      } }
    const sr = first.sr, ch = first.ch, spf = first.spf;
    try { const sup = await AudioDecoder.isConfigSupported({ codec: 'mp3', sampleRate: sr, numberOfChannels: ch }); if (!sup || !sup.supported) return null; } catch (e) { return null; }
    const BL = 65536, jobs = []; let token = null, blk = null, fill = 0, sent = 0, fail = null, err = null, produced = 0, nfr = 0, dropped = 0, bad = false; const held = [];
    for (let c = 0; c < ch; c++) held.push(new Float32Array(0));
    const send = () => { const il = blk, n = fill; blk = null; fill = 0; sent += n; const p = this.call('append', { token, il, n }, [il.buffer]).catch(e => { fail = fail || e; }); jobs.push(p); p.then(() => { jobs.splice(jobs.indexOf(p), 1); }); };
    const add = (pl, from, to) => { for (let i = from; i < to;) { if (!blk) blk = new Float32Array(BL * ch); const take = Math.min(to - i, BL - fill); for (let c = 0; c < ch; c++) { const x = pl[Math.min(c, pl.length - 1)]; for (let k = 0, p = fill * ch + c; k < take; k++, p += ch) blk[p] = x[i + k]; } fill += take; i += take; if (fill === BL) send(); } };
    const push = (pl, n) => {          // the first `skip` samples are dropped, and the last `trim` are held back and never sent
      let from = 0; if (dropped < skip) { const d = Math.min(n, skip - dropped); dropped += d; from = d; } if (from >= n) return; produced += n - from;
      const cat = pl.map((x, c) => { const h = held[c], o = new Float32Array(h.length + n - from); o.set(h); o.set(x.subarray(from, n), h.length); return o; }), len = cat[0].length, rel = Math.max(0, len - trim);
      if (rel) add(cat, 0, rel); for (let c = 0; c < ch; c++) held[c] = cat[c].slice(rel);
    };
    const dec = new AudioDecoder({ output: a => { try { push(audioDataChannels(a), a.numberOfFrames); } catch (e) { err = err || e; } a.close(); }, error: e => { err = e; } });
    token = (await this.call('create', { key, name: file.name, sr, ch, piece: opt.piece })).token;
    try {
      dec.configure({ codec: 'mp3', sampleRate: sr, numberOfChannels: ch });
      for (;;) {
        if (opt.stale && opt.stale()) throw STALE; if (err || fail) break;
        if (win.length - pos < 1 << 20 && base + win.length < file.size) { const from = base + pos; win = new Uint8Array(await file.slice(from, Math.min(file.size, from + WIN)).arrayBuffer()); base = from; pos = 0; }
        const h = hdr(win, pos); if (!h) { const f = find(); if (!f) break; continue; }          // damage or a tag between frames: carry on at the next frame that holds up
        if (pos + h.len > win.length) break; if (h.sr !== sr || h.ch !== ch || h.spf !== spf) { bad = true; break; }
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(nfr * spf * 1e6 / sr), data: win.subarray(pos, pos + h.len) })); nfr++; pos += h.len;
        if (nfr % 512 === 0) { if (opt.onProgress) opt.onProgress(Math.min(0.99, (base + pos) / file.size)); while (dec.decodeQueueSize > 128 && !err) await new Promise(r => { const go = () => { clearTimeout(t); dec.removeEventListener('dequeue', go); r(); }, t = setTimeout(go, 40); dec.addEventListener('dequeue', go); }); await tick(); while (jobs.length > 4 && !fail) await jobs[0]; }
      }
      if (!err && !bad) { try { await dec.flush(); } catch (e) { err = e; } } try { dec.close(); } catch (e) {}
      if (err || fail || bad || !nfr) throw err || fail || new Error('This MP3 could not be read this way.');
      if (expect && Math.abs(nfr - expect) > 2 && lame) throw new Error('This MP3 does not have the frames it says.');          // a file that is not whole: the usual way
      if (fill) send(); await Promise.all(jobs); if (fail) throw fail;
    } catch (e) { try { dec.close(); } catch (e2) {} try { await this.call('remove'); } catch (e2) {} if (e === STALE) throw e; return null; }
    return this.call('finish', { token });
  },
  /* Ogg files holding Opus or Vorbis (mono or stereo): the packets are cut out of the Ogg pages here and the browser's own decoder (WebCodecs) turns them into sound a piece at a time, into the store.
     Opus starts with a pre-skip (the decoder's warm-up) that is cut away, and both end where the last page says the sound ends. Anything else (video, several streams in a row or side by side, more than two channels, a
     decoder this browser lacks) gives null: the usual way. */
  async importOgg(file, key, opt) {
    if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') return null;
    const WIN = 8 << 20, tail = new Uint8Array(await file.slice(Math.max(0, file.size - 70000)).arrayBuffer()); let last = -1;
    for (let i = tail.length - 27; i >= 0; i--) if (tail[i] === 0x4f && tail[i + 1] === 0x67 && tail[i + 2] === 0x67 && tail[i + 3] === 0x53) { last = i; break; }
    if (last < 0) return null; const tdv = new DataView(tail.buffer, tail.byteOffset); const lastGran = Number(tdv.getBigInt64(last + 6, true)); if (lastGran <= 0) return null;
    let win = new Uint8Array(await file.slice(0, WIN).arrayBuffer()), base = 0, serial = null, kind = '', heads = [], sr = 0, ch = 0, pre = 0, opusHead = null, dec = null, token = null, fail = null, err = null, bad = false, nfr = 0, total = 0, emitted = 0, dropped = 0, firstOut = true, firstN = 0, skip = 0;
    const jobs = [], BL = 65536; let blk = null, fill = 0;
    const send = () => { const il = blk, n = fill; blk = null; fill = 0; const p = this.call('append', { token, il, n }, [il.buffer]).catch(e => { fail = fail || e; }); jobs.push(p); p.then(() => { jobs.splice(jobs.indexOf(p), 1); }); };
    const add = (pl, from, to) => { for (let i = from; i < to;) { if (!blk) blk = new Float32Array(BL * ch); const take = Math.min(to - i, BL - fill); for (let c = 0; c < ch; c++) { const x = pl[Math.min(c, pl.length - 1)]; for (let k = 0, p = fill * ch + c; k < take; k++, p += ch) blk[p] = x[i + k]; } fill += take; i += take; if (fill === BL) send(); } };
    const opusFrames = d => { const toc = d[0], cf = toc >> 3, ms = cf < 12 ? [10, 20, 40, 60][cf & 3] : cf < 16 ? [10, 20][cf & 1] : [2.5, 5, 10, 20][cf & 3], c = toc & 3, k = c === 0 ? 1 : c === 3 ? (d[1] & 63) : 2; return Math.round(ms * 48 * k); };
    const out = a => {
      try {
        const n = a.numberOfFrames; let from = 0;
        if (firstOut) { firstOut = false; skip = kind === 'opus' ? Math.max(0, pre - Math.max(0, firstN - n)) : 0; }          // the decoder may already have dropped some or all of the pre-skip
        if (dropped < skip) { const d = Math.min(n - from, skip - dropped); dropped += d; from += d; }
        const to = Math.min(n, from + Math.max(0, total - emitted)); if (to > from) { add(audioDataChannels(a), from, to); emitted += to - from; }
      } catch (e) { err = err || e; } a.close();
    };
    const onPacket = async (d, idx) => {
      if (idx === 0) {
        if (d.length >= 19 && String.fromCharCode.apply(null, d.subarray(0, 8)) === 'OpusHead') { kind = 'opus'; ch = d[9]; pre = d[10] | d[11] << 8; sr = 48000; const gain = (d[16] | d[17] << 8) << 16 >> 16, fam = d[18]; if (fam !== 0 || ch < 1 || ch > 2 || gain !== 0) { bad = true; return; } opusHead = d.slice(); total = lastGran - pre; }
        else if (d.length >= 30 && d[0] === 1 && String.fromCharCode.apply(null, d.subarray(1, 7)) === 'vorbis') { kind = 'vorbis'; ch = d[11]; sr = (d[12] | d[13] << 8 | d[14] << 16 | d[15] << 24) >>> 0; if (ch < 1 || ch > 2) { bad = true; return; } heads = [d.slice()]; total = lastGran; }
        else bad = true; return;
      }
      if (kind === 'vorbis' && heads.length < 3) { heads.push(d.slice()); if (heads.length < 3) return; }
      else if (kind === 'opus' && idx === 1) return;          // the comment packet
      if (kind === 'vorbis' && heads.length === 3 && !dec) {
        const lace = n => { const o = []; while (n >= 255) { o.push(255); n -= 255; } o.push(n); return o; }, desc = new Uint8Array([2, ...lace(heads[0].length), ...lace(heads[1].length), ...heads[0], ...heads[1], ...heads[2]]);
        await start(desc); return;
      }
      if (kind === 'opus' && !dec) { const h = opusHead.slice(); await start(h); }
      if (kind === 'opus' && nfr === 0) firstN = opusFrames(d);
      if (!dec || bad) return; if (total <= 0) { bad = true; return; }
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: nfr * 1000, data: d })); nfr++;
    };
    const start = async desc => {
      const cfg = { codec: kind, sampleRate: sr, numberOfChannels: ch, description: desc };
      try { const sup = await AudioDecoder.isConfigSupported(cfg); if (!sup || !sup.supported) { bad = true; return; } } catch (e) { bad = true; return; }
      dec = new AudioDecoder({ output: out, error: e => { err = e; } }); dec.configure(cfg);
      token = (await this.call('create', { key, name: file.name, sr, ch, piece: opt.piece })).token;
    };
    let idx = 0, pos = 0, partial = [], seq = 0;
    try {
      for (;;) {
        if (opt.stale && opt.stale()) throw STALE; if (err || fail || bad) break;
        if (win.length - pos < 70000 && base + win.length < file.size) { const from = base + pos; win = new Uint8Array(await file.slice(from, Math.min(file.size, from + WIN)).arrayBuffer()); base = from; pos = 0; }
        if (pos + 27 > win.length) break;
        if (!(win[pos] === 0x4f && win[pos + 1] === 0x67 && win[pos + 2] === 0x67 && win[pos + 3] === 0x53)) { bad = true; break; }          // damage between pages: the usual way
        const dv = new DataView(win.buffer, win.byteOffset), ns = win[pos + 26], ser = dv.getUint32(pos + 14, true), flags = win[pos + 5]; if (pos + 27 + ns > win.length) break;
        let size = 0; for (let i = 0; i < ns; i++) size += win[pos + 27 + i]; if (pos + 27 + ns + size > win.length) break;
        if (serial === null) { if (!(flags & 2)) { bad = true; break; } serial = ser; } else if (ser !== serial || (flags & 2)) { bad = true; break; }          // one stream only
        if (dv.getUint32(pos + 18, true) !== seq++) { bad = true; break; }          // a page missing
        let at = pos + 27 + ns; for (let i = 0; i < ns; i++) { const l = win[pos + 27 + i]; partial.push(win.slice(at, at + l)); at += l; if (l < 255) { const d = partial.length === 1 ? partial[0] : (() => { const t = new Uint8Array(partial.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of partial) { t.set(x, o); o += x.length; } return t; })(); partial = []; await onPacket(d, idx++); if (err || fail || bad) break; } }
        pos = at;
        if (dec && seq % 64 === 0) { if (opt.onProgress) opt.onProgress(Math.min(0.99, (base + pos) / file.size)); while (dec.decodeQueueSize > 128 && !err) await new Promise(r => { const go = () => { clearTimeout(t); dec.removeEventListener('dequeue', go); r(); }, t = setTimeout(go, 40); dec.addEventListener('dequeue', go); }); await tick(); while (jobs.length > 4 && !fail) await jobs[0]; }
        if (flags & 4) break;
      }
      if (!err && !bad && dec) { try { await dec.flush(); } catch (e) { err = e; } } try { dec && dec.close(); } catch (e) {}
      if (err || fail || bad || !dec || !emitted) throw err || fail || new Error('This file could not be read this way.');
      if (emitted < total * 0.98) throw new Error('This file does not have the sound it says.');
      if (fill) send(); await Promise.all(jobs); if (fail) throw fail;
    } catch (e) { try { dec && dec.close(); } catch (e2) {} if (token) { try { await this.call('remove'); } catch (e2) {} } if (e === STALE) throw e; return null; }
    return this.call('finish', { token });
  },
  async importM4a(file, key, opt) {
    const ab = await file.arrayBuffer(), BL = 65536, jobs = []; let token = null, ch = 0, blk = null, fill = 0, sent = 0, fail = null, total = 0, taps = null;
    const send = () => { const il = blk, n = fill; blk = null; fill = 0; sent += n; const p = this.call('append', { token, il, n }, [il.buffer]).catch(e => { fail = fail || e; }); jobs.push(p); p.then(() => { jobs.splice(jobs.indexOf(p), 1); }); };
    const add = (pl, from, to) => { for (let i = from; i < to;) { if (!blk) blk = new Float32Array(BL * ch); const take = Math.min(to - i, BL - fill); for (let c = 0; c < ch; c++) { const x = pl ? pl[Math.min(c, pl.length - 1)] : null; if (x) for (let k = 0, p = fill * ch + c; k < take; k++, p += ch) blk[p] = x[i + k]; } fill += take; i += take; if (fill === BL) send(); } };
    const sink = {
      begin: async info => { ch = Math.min(2, info.ch); taps = info.ch > 2 ? stereoTaps(info.ch) : null; total = info.length; token = (await this.call('create', { key, name: file.name, sr: info.sr, ch, srcCh: info.ch, piece: opt.piece })).token; return true; },          // surround is folded to stereo as it goes in, the way a recording in memory is
      push: (pl, from, to) => { if (!taps) return add(pl, from, to); const mix = [new Float32Array(to), new Float32Array(to)]; for (const [c, w, side] of taps) { const x = pl[Math.min(c, pl.length - 1)], o = mix[side]; for (let i = from; i < to; i++) o[i] += x[i] * w; } add(mix, from, to); },
      drain: async () => { if (opt.stale && opt.stale()) throw STALE; while (jobs.length > 4 && !fail) await jobs[0]; if (fail) throw fail; }
    };
    let info = null;
    try { info = await mp4DecodeAac(ab, opt.onProgress, sink); }
    catch (e) { if (token) { try { await this.call('remove'); } catch (e2) {} } throw e; }
    if (!info) { if (token) await this.call('remove'); return null; }
    if (sent + fill < total) add(null, 0, total - sent - fill);          // a file that ends a little short keeps its stated length, as it does in memory
    if (fill) send(); await Promise.all(jobs); if (fail) { try { await this.call('remove'); } catch (e2) {} throw fail; }
    return this.call('finish', { token });
  },
  /* the recording stored on an earlier visit, if it is this file and still whole */
  async open(file) { if (!this.can()) return null; const m = await this.call('open', { key: this.keyOf(file) }); if (m) m.duration = m.frames / m.sr; return (this.meta = m); },
  read(start, n, hi) { return this.call('read', { token: this.meta.token, start, n, hi: !!hi }); },          // hi: the player is waiting for it, so it goes before any measuring that is queued
  /* the tools on the stored recording (audio-fx.js, in the same worker): fx sets them, render gives the processed frames of any stretch as { start, chans, exact }.
     exact asks for the very samples a pass from the start of the recording would give; without it a far-off place may start from a short run-in instead */
  fx(fx) { return this.call('fxSet', { token: this.meta.token, recipe: fxRecipe(fx, this.meta.ch) }); },
  /* the tools for what is read, measured or played next (the worker keeps one set). Settings the same as the last set are not sent again; gives true when they changed. A job already running for the old settings stops */
  fxUse(fx, opt) { const rec = fxRecipe(fx, this.meta.ch), key = opt && opt.slot === 'exp' ? 'fxSigE' : opt && opt.slot === 'ply' ? 'fxSigP' : 'fxSig'; if (opt && opt.listen) rec.listen = true; const sig = this.meta.token + JSON.stringify(rec); if (sig === this[key]) return false; this[key] = sig; this.call('fxSet', { token: this.meta.token, recipe: rec, slot: opt && opt.slot }).catch(() => { if (this[key] === sig) this[key] = ''; }); return true; },          // slot 'exp': the set an export works from, apart from the editor's own
  render(start, n, exact, slot) { return this.call('fxRead', { token: this.meta.token, start, n, exact: !!exact, slot }); },
  /* one pass over the processed sound: its waveform heights ({ peaks, peakMax, tp }, as calcPeaks and the true peaks give them), and a processed copy kept on disk when a tool changes the sound */
  scan(opt) { return this.call('fxScan', { token: this.meta.token }, null, opt); },
  rmsScan(recipe, a, b, opt) { return this.call('rmsScan', { token: this.meta.token, recipe, a, b }, null, opt); },          // the average level of the recording and of the processed sound over a..b
  specScan(recipe, w, opt) { return this.call('specScan', Object.assign({ token: this.meta.token, recipe, code: SPEC_CODE, N: SPEC_N, H: SPEC_B, fmin: SPEC_FMIN, fmax: Math.min(20000, this.meta.sr / 2 * 0.98) }, w), null, opt); },          // the spectrum picture of one stretch, after the cleaning stage
  rawScan(opt) { return this.call('rawScan', { token: this.meta.token }, null, opt); },          // the same heights for the recording as it is, whatever tools are set
  /* the draft's kept part, fades, level and limiter in the plain form the worker takes */
  spec(d, gain, o = {}) { return Object.assign({ vs: d.vStart, ve: aeEnd(d), gain, fade: (l => l[0] > 0 || l[1] > 0 ? { len: l[0], lenOut: l[1], shape: d.audioFadeShape } : null)(aeFadeLens(d)), ch: this.meta.ch, limit: null, clamp: false }, o); },
  loud(d, opt) { return this.call('fxLoud', { token: this.meta.token, spec: this.spec(d, 1), slot: opt && opt.slot }, null, opt); },          // loudness of the kept part with its fades, before any volume change
  limit(d, opt) { return this.call('fxLimit', { token: this.meta.token, spec: this.spec(d, 1), target: d.normLufs, ceil: LIM_CEIL - LIM_GUARD, slot: opt && opt.slot }, null, opt); },          // the volume that lands the limited sound on the loudness target
  master(spec, pos, len, slot) { return this.call('fxMaster', { token: this.meta.token, spec, pos, len, slot }); },          // final samples, planar; reads that follow one another carry the limiter on
  /* a file made for export: written a piece at a time into the store's folder, then handed over as a file that stays on disk (a long recording's WAV or FLAC does not fit in memory) */
  fileOpen() { this.fname = 'export-' + Date.now() + '.bin'; return this.call('exportOpen', { token: this.meta.token, name: this.fname }); },          // each export has a file of its own, so a download still reading the last one is never pulled from under it
  fileWrite(at, ab) { return this.call('exportWrite', { token: this.meta.token, name: this.fname, at, data: ab }, [ab]); },
  async fileDone() { const t = this.meta.token; await this.call('exportClose', { token: t, name: this.fname }); const d = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('kf-audio')).getDirectoryHandle(t); return (await d.getFileHandle(this.fname)).getFile(); },
  fileDrop() { return this.meta && this.fname ? this.call('exportRemove', { token: this.meta.token, name: this.fname }).catch(() => {}) : null; },
  peaks(level, from, n) { return this.call('peaks', { token: this.meta.token, level, from, n }); },
  /* plays the stored recording from a frame, through the player every sound goes through (soundPlay). fx: the sound as the tools leave it, worked out as it plays */
  play(ac, from, dest, opt = {}) {
    const m = this.meta, get = (at, n) => opt.fx ? this.render(at, n, false, opt.slot) : this.read(at, n, true), o = Object.assign({ quick: !!opt.fx }, opt);
    if (ac.sampleRate === m.sr) return soundPlay(ac, { sr: m.sr, ch: m.ch, frames: m.frames, get }, from, dest, o);
    /* the context runs at another rate than the recording (Safari: the speakers' rate): the app's own converter turns it into the context's rate a second at a time, and the player counts in that rate */
    const rs = KFX.resampled(get, { sr: m.sr, ch: m.ch, frames: m.frames }, ac.sampleRate, m.frames / m.sr), k = ac.sampleRate / m.sr;
    if (o.end) o.end = Math.floor(o.end * k);
    return soundPlay(ac, { sr: ac.sampleRate, ch: m.ch, frames: rs.info.frames, get: (at, n) => rs.read(at, Math.min(n, ac.sampleRate)) }, Math.floor(from * k), dest, o);
  },
  async remove() { this.meta = null; this.fxSig = ''; this.fxSigE = ''; this.fxSigP = ''; return this.call('remove'); }
};
let loadSeq = 0;          // each load gets a number; a load that is no longer the latest (another file was chosen, or the audio was removed) stops and never touches the editor
const STALE = { stale: true };
/* The disk store (a recording kept in the browser's private storage, read a stretch at a time) is on by default. WAV, AIFF, FLAC, MP3, Ogg Opus and Vorbis, Apple Lossless and stereo AAC in M4A files are kept on the store; every other file loads into memory as before.
   Open the page with ?disk=0 to turn it off (the browser remembers), ?disk=1 to turn it back on. */
const DISK_ON = (() => { try { const q = new URLSearchParams(location.search).get('disk'); if (q === '0') localStorage.setItem('glisscore.disk', '0'); else if (q === '1') localStorage.removeItem('glisscore.disk'); return localStorage.getItem('glisscore.disk') !== '0'; } catch (e) { return true; } })();
/* the file on the disk store: the stored copy of an earlier visit when it is this file, else a fresh import. Gives the audio (no buffer, the waveform peaks and the recording's shape), or null when the file is not one the store takes */
async function loadAudioDisk(file, live) {
  if (!DISK_ON || !DISK.can()) return null;
  let m = null; const mine = loadSeq;
  try { m = await DISK.open(file); live(); if (!m) m = await DISK.importFile(file, { onProgress: f => { if (mine === loadSeq) setBusyFrac(f * 0.95); }, stale: () => mine !== loadSeq }); }
  catch (e) { if (e === STALE) throw e; console.error(e); m = null; }
  live();
  if (!m) { if (DISK.meta) DISK.remove().catch(() => {}); return null; }          // not a kind of file the store takes (or it failed): the usual way
  if (m.ch > 2 || m.frames < 1) { DISK.remove().catch(() => {}); return null; }
  return { disk: true, name: file.name, duration: m.duration, peaks: m.peaks, peakMax: m.peakMax, peak: m.peak || 0, lossy: lossyLabel(file.name, false), sr: m.sr, ch: m.ch, frames: m.frames };
}
/* the true peaks of a recording on the disk store (the loudest it gets between the samples), measured in the background; until they are in, the sample peaks stand in for them, as for a recording in memory */
function diskTruePeaks(a) {
  DISK.rawScan({ stale: () => S.audio !== a }).then(r => { if (S.audio !== a) return; a.tp = r.tp; TP_VER++; tpReady(); }, e => { if (e !== STALE) console.error(e); });
}
/* the recording is in: the editor and the timeline take it up. Gives the note about any page turns that had to move */
function adoptAudio(file, audio, frames) {
  let movedMsg = ''; const hadTurns = S.turns.slice(), wasEdited = S.turnsEdited, hadAudio = !!S.audio;
  FXC.clear(); NRC.clear(); SEC.clear(); DW.chans = null; DW.at = -1;
  if (DISK.meta && !audio.disk) { DISK.remove().catch(() => {}); }
  if (audio.disk) diskTruePeaks(audio);          // a recording held in memory replaces the one on the disk store
  S.audio = audio; vqNote();
  { const key = file.name + '|' + file.size + '|' + frames;          // the Audio Editor's changes belong to the recording they were made on: a different file starts clean (noise profiles and Spectra boxes mean nothing on another sound)
    if (S.set.audioKey && S.set.audioKey !== key) { AE_SET.forEach(k => { S.set[k] = AE_DEFAULT[k]; }); S.set.fx = fxClone(FX_DEFAULT); }
    S.set.audioKey = key; saveSettings(); }
  if (hadAudio) { S.vStart = 0; S.vEndSet = null; }       // replacing the audio starts the video matching it again
  if (vEnd() - S.vStart < 1) { S.vStart = 0; S.vEndSet = null; }
  S.time = 0;
  if (S.spreads.length) {
    if (!S.turnsEdited) autoSpace(false);
    else {
      normalizeTurns();      // page turns keep their times; only turns past the end of shorter audio are pulled back
      const moved = S.turns.filter((t, i) => Math.abs(t - hadTurns[i]) > 0.01).length;
      if (wasEdited && moved) movedMsg = ' ' + tx(moved === 1 ? 'aud.moved.one' : 'aud.moved.many', { n: moved });
    }
  }
  setChips(); zoomFit(); rvStart('wave'); TL.staticDirty = true; stageDirty = true; updateButtons(); updateInfo();
  fxGet(S.set.fx).then(() => { stageDirty = true; }, () => {});
  return movedMsg;
}
async function loadAudio(file) {
  const mine = ++loadSeq, live = () => { if (mine !== loadSeq) throw STALE; };
  setBusy('Listening…', 'audio', file.name, 0);
  try {
    Transport.pause();
    const dk = await loadAudioDisk(file, live);
    if (dk) {
      const ac = ctxForRate(dk.sr); live(); setBusyFrac(0.98); playPrepare(ac);
      const movedMsg = adoptAudio(file, dk, dk.frames), clipMsg = dk.peak > 1.00006 ? ' ' + tx('aud.clips', { db: DB_TXT(20 * Math.log10(dk.peak)) }) : '';
      toast(tx('aud.loaded', { len: fmt(dk.duration) }) + movedMsg + clipMsg, movedMsg || clipMsg ? 9000 : 4200); return;
    }
    const ab = await file.arrayBuffer(); live();
    const rate0 = sniffRateFile(ab), lossy = lossyLabel(file.name, sniffRateFile.alac), ac = ctxForRate(rate0 || sniffRate(new Uint8Array(ab, 0, Math.min(ab.byteLength, 262144))));          // containers first: the MP3 guess can mistake AAC or Ogg data for MP3 frames
    let buffer = null; try { buffer = wavFloatBuffer(ab); } catch (e) { buffer = null; }          // float WAVs are read here, so no sample above full scale is lost on the way in
    const direct = !!buffer;
    if (new Uint8Array(ab, 4, 4).every((b, i) => b === 'ftyp'.charCodeAt(i))) { try { buffer = await mp4DecodeAac(ab, f => { live(); setBusyFrac(f * 0.9); }); } catch (e) { if (e === STALE) throw e; buffer = null; } }          // M4A: decoded a piece at a time, so there is a real progress bar and Safari is not stuck in one long call
    if (!buffer) { live(); setBusyFrac(null); buffer = await new Promise((res, rej) => { const p = ac.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); }); }          // everything else (and any M4A this cannot read): the browser's own decoder, with no progress to show
    live(); setBusyFrac(0.95); Transport.pause(); playPrepare(ac);          // the player is loaded now, so it is there by the first play
    await new Promise(r => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 80); }); live();          // let the bar paint before the heavy sync work
    const sourceCh = buffer.numberOfChannels; if (sourceCh > 2) buffer = downmixStereo(buffer);
    const memMB = buffer.length * buffer.numberOfChannels * 4 * 2 / 1e6, longMsg = buffer.duration > 900 ? ' ' + tx('aud.long', { mb: Math.round(memMB) }) : '';          // the recording and one processed copy of it; very long files need room
    const clipPk = bufferPeakDb(buffer), clipMsg = clipPk > 0.0005 ? ' ' + tx('aud.clips', { db: DB_TXT(clipPk) }) : '';
    const clampMsg = lossy && !direct && fullScaleCount(buffer) >= 16 ? ' ' + tx('aud.clamped') : '';          // lossy files decoded by the browser only; 16 or more samples stuck at full scale is the sign
    const { peaks, peakMax: mx } = calcPeaks(buffer);          // waveform peaks: 100 per second
    const movedMsg = adoptAudio(file, { buffer, name: file.name, duration: buffer.duration, peaks, peakMax: mx, lossy }, buffer.length);
    toast(tx('aud.loaded', { len: fmt(buffer.duration) }) + (sourceCh > 2 ? ' ' + tx('aud.mixed', { n: sourceCh }) : '') + movedMsg + clipMsg + clampMsg + longMsg, movedMsg || sourceCh > 2 || clipMsg || clampMsg || longMsg ? 9000 : 4200);
  } catch (e) {
    if (e === STALE) return;
    console.error(e);
    const ext = ((file.name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
    toast(file.size === 0 ? tx('aud.empty') : ['aif', 'aiff', 'caf', 'wma', 'amr'].includes(ext) ? tx('aud.badtype', { ext: ext.toUpperCase() }) : tx('aud.readfail'), 6500);
  } finally { if (mine === loadSeq) setBusy(''); }
}

