/* The disk store for long recordings. Runs in a worker because only a worker can open a file for fast synchronous reads and writes (createSyncAccessHandle).
   A recording is kept in the site's private storage (OPFS) as float32 samples, left and right interleaved, in pieces of one minute. To the rest of the app it is one continuous
   recording: every position is a frame number counted from the start, and a read may cross any number of pieces.
   While the samples arrive, the waveform is measured on the way: the app's 100-per-second peaks, and a pyramid of the lowest and highest sample per 64, 512 and 4096 frames.
   Only one recording is kept. Making a new one deletes the one before it. */
importScripts('audio-fx.js');          // the tools, worked out a stretch at a time (KFX)
const ROOT = 'kf-audio', LEVELS = [64, 512, 4096], MAXOPEN = 12, BLOCK = 1 << 17;
const bytes = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const pieceName = k => 'p' + String(k).padStart(5, '0') + '.f32', copyName = k => 'x' + String(k).padStart(5, '0') + '.f32';          // the recording, and the processed copy of it
const errText = e => (e && e.name && e.name !== 'Error' ? e.name + ': ' : '') + (e && e.message || String(e));
const STALE = new Error('stale');
let cur = null;          // the open recording
let fx = null;          // the tools set for the open recording (the live editor's)
let fxExp = null;          // a second set that an export works from, so the editor can go on changing the live ones while it runs
let fxPly = null;          // a third set for what the editor plays: only what has to be worked out here (noise reduction, Spectra), the EQ and Imager being run live on the page
const slotOf = slot => slot === 'exp' ? fxExp : slot === 'ply' ? fxPly : fx;
const dead = new Set();          // requests the page has called off

function Grow(n) { this.a = new Float32Array(n); this.n = 0; }
Grow.prototype.push = function (v) { if (this.n === this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; } this.a[this.n++] = v; };

const rootDir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, { create: true });
async function readJson(d) { try { return JSON.parse(await (await (await d.getFileHandle('manifest.json')).getFile()).text()); } catch (e) { return null; } }

/* one sync handle per file, opened when first needed; the least recently used is closed when too many are open */
async function handle(s, name, create) {
  let h = s.handles.get(name);
  if (h) { s.handles.delete(name); s.handles.set(name, h); return h; }
  h = await (await s.dir.getFileHandle(name, { create })).createSyncAccessHandle(); s.handles.set(name, h);
  if (s.handles.size > MAXOPEN) { const [k, old] = s.handles.entries().next().value; s.handles.delete(k); try { old.flush(); } catch (e) {} try { old.close(); } catch (e) {} }
  return h;
}
function closeStore() { if (!cur) return; for (const h of cur.handles.values()) { try { h.flush(); } catch (e) {} try { h.close(); } catch (e) {} } cur = null; }
async function writeFile(s, name, u8) { const h = await handle(s, name, true); h.truncate(0); if (h.write(u8, { at: 0 }) !== u8.byteLength) throw new Error('The disk is full.'); h.flush(); }
const writeManifest = s => writeFile(s, 'manifest.json', new TextEncoder().encode(JSON.stringify(s.m)));
async function wipe() { closeStore(); const r = await rootDir(), names = []; for await (const name of r.keys()) names.push(name); for (const name of names) { try { await r.removeEntry(name, { recursive: true }); } catch (e) {} } }

async function create({ key, name, sr, ch, srcCh, piece }) {
  await wipe();
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 8), dir = await (await rootDir()).getDirectoryHandle(token, { create: true });
  const m = { v: 1, token, key, name, sr, ch, srcCh: srcCh || ch, piece: piece || 60 * sr, levels: LEVELS, frames: 0, complete: false };
  cur = { m, dir, handles: new Map(), lv: LEVELS.map(() => ({ lo: Infinity, hi: -Infinity, c: 0, at: 0, out: new Grow(8192) })), q: { per: Math.max(1, Math.floor(sr / 100)), m: 0, c: 0, out: new Grow(8192) }, peak: 0, full: 0 };
  await writeManifest(cur); return { token };
}

/* a finished pyramid bucket: kept for its level's file and folded into the level above (every level is 8 of the one below) */
function emit(s, k, lo, hi) {
  const st = s.lv[k]; st.out.push(lo); st.out.push(hi);
  if (k + 1 < s.lv.length) { const nx = s.lv[k + 1]; if (lo < nx.lo) nx.lo = lo; if (hi > nx.hi) nx.hi = hi; if (++nx.c === 8) { emit(s, k + 1, nx.lo, nx.hi); nx.lo = Infinity; nx.hi = -Infinity; nx.c = 0; } }
}
function measure(s, il, n) {
  const ch = s.m.ch, L = s.lv[0], q = s.q; let p = 0, full = 0, peak = s.peak;
  for (let i = 0; i < n; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < ch; c++) { const v = il[p++]; if (v < lo) lo = v; if (v > hi) hi = v; const a = v < 0 ? -v : v; if (a >= 0.99999 && a <= 1) full++; }
    if (!(hi >= lo)) lo = hi = 0;
    const a = -lo > hi ? -lo : hi; if (a > q.m) q.m = a;
    if (++q.c === q.per) { q.out.push(q.m); if (q.m > peak) peak = q.m; q.m = 0; q.c = 0; }
    if (lo < L.lo) L.lo = lo; if (hi > L.hi) L.hi = hi;
    if (++L.c === LEVELS[0]) { emit(s, 0, L.lo, L.hi); L.lo = Infinity; L.hi = -Infinity; L.c = 0; }
  }
  s.peak = peak; s.full += full;
}
async function flushLevels(s, all) {
  for (let k = 0; k < s.lv.length; k++) { const st = s.lv[k]; if (!st.out.n || (!all && st.out.n < 65536)) continue; const h = await handle(s, 'lv' + LEVELS[k] + '.f32', true), part = st.out.a.subarray(0, st.out.n); if (h.write(bytes(part), { at: st.at * 8 }) !== part.byteLength) throw new Error('The disk is full.'); st.at += st.out.n / 2; st.out.n = 0; }
}
/* n frames, interleaved, added to the end */
async function put(s, il, n) {
  const ch = s.m.ch, FB = ch * 4, P = s.m.piece; let done = 0;
  while (done < n) {
    const f = s.m.frames + done, take = Math.min(n - done, P - f % P), h = await handle(s, pieceName(Math.floor(f / P)), true), view = il.subarray(done * ch, (done + take) * ch);
    if (h.write(bytes(view), { at: (f % P) * FB }) !== take * FB) throw new Error('The disk is full.');
    done += take;
  }
  measure(s, il, n); s.m.frames += n; await flushLevels(s, false);
}
const mine = token => { if (!cur || cur.m.token !== token) throw STALE; return cur; };
async function append({ token, il, n }) { const s = mine(token); if (s.m.complete) throw new Error('This recording is already finished.'); await put(s, il, n); return { frames: s.m.frames }; }

function meta(s, peaks) { return { token: s.m.token, key: s.m.key, name: s.m.name, sr: s.m.sr, ch: s.m.ch, srcCh: s.m.srcCh, frames: s.m.frames, piece: s.m.piece, levels: s.m.levels, peaks, peakMax: s.m.peakMax || 1, peak: s.m.peak, full: s.m.full }; }
async function finish({ token }) {
  const s = mine(token), q = s.q;
  if (q.c) { q.out.push(q.m); if (q.m > s.peak) s.peak = q.m; q.c = 0; }
  for (let k = 0; k < s.lv.length; k++) { const st = s.lv[k]; if (st.c) { emit(s, k, st.lo, st.hi); st.c = 0; } }          // the part buckets at the end, lowest level first
  await flushLevels(s, true);
  const peaks = q.out.a.slice(0, q.out.n); await writeFile(s, 'peaks100.f32', bytes(peaks));
  s.m.peak = s.peak; s.m.peakMax = s.peak || 1; s.m.full = s.full; s.m.complete = true; s.m.written = Date.now(); await writeManifest(s);
  for (const h of s.handles.values()) { try { h.flush(); } catch (e) {} }
  return [meta(s, peaks), [peaks.buffer]];
}

/* frames start … start+n as one Float32Array per channel */
async function read({ token, start, n, copy }) {
  const s = mine(token), ch = s.m.ch, FB = ch * 4, P = s.m.piece, name = copy ? copyName : pieceName; start = Math.max(0, Math.floor(start)); n = Math.max(0, Math.min(Math.floor(n), s.m.frames - start));
  const il = new Float32Array(n * ch); let done = 0;
  while (done < n) {
    const f = start + done, take = Math.min(n - done, P - f % P), h = await handle(s, name(Math.floor(f / P)), false);
    if (h.read(bytes(il.subarray(done * ch, (done + take) * ch)), { at: (f % P) * FB }) !== take * FB) throw new Error('Part of the stored recording is missing.');
    done += take;
  }
  if (ch === 1) return [{ start, chans: [il] }, [il.buffer]];
  const out = []; for (let c = 0; c < ch; c++) { const x = new Float32Array(n); for (let i = 0, p = c; i < n; i++, p += ch) x[i] = il[p]; out.push(x); }
  return [{ start, chans: out }, out.map(x => x.buffer)];
}
/* n buckets of one pyramid level from bucket 'from': lowest and highest sample of each, in pairs */
async function peaks({ token, level, from, n }) {
  const s = mine(token), k = LEVELS.indexOf(level); if (k < 0) throw new Error('No such level.');
  const total = Math.ceil(s.m.frames / level); from = Math.max(0, Math.floor(from)); n = Math.max(0, Math.min(Math.floor(n), total - from));
  const out = new Float32Array(n * 2); if (n) { const h = await handle(s, 'lv' + level + '.f32', false); if (h.read(bytes(out), { at: from * 8 }) !== out.byteLength) throw new Error('Part of the stored recording is missing.'); }
  return [{ from, pairs: out }, [out.buffer]];
}

/* the recording kept from an earlier visit, if it is this file and all of it is still there */
/* files left from earlier exports are cleared when a recording is opened again (a new session: nothing is still saving them) */
async function clearExports(s) { const names = []; for await (const n of s.dir.keys()) if (/^export.*\.bin$/.test(n)) names.push(n); for (const n of names) { const o = s.handles.get(n); if (o) { try { o.close(); } catch (e) {} s.handles.delete(n); } try { await s.dir.removeEntry(n); } catch (e) {} } }
async function open({ key }) {
  if (cur && cur.m.complete && cur.m.key === key) { await clearExports(cur); const h = await handle(cur, 'peaks100.f32', false), pk = new Float32Array(h.getSize() / 4); h.read(bytes(pk), { at: 0 }); return [meta(cur, pk), [pk.buffer]]; }
  const r = await rootDir();
  for await (const [, d] of r.entries()) {
    if (d.kind !== 'directory') continue; const m = await readJson(d); if (!m || !m.complete || m.key !== key || m.v !== 1) continue;
    let total = 0; for await (const [name, f] of d.entries()) if (/^p\d+\.f32$/.test(name)) total += (await f.getFile()).size;
    if (total !== m.frames * m.ch * 4) continue;
    closeStore(); cur = { m, dir: d, handles: new Map() };
    await clearExports(cur);
    const h = await handle(cur, 'peaks100.f32', false), pk = new Float32Array(h.getSize() / 4); h.read(bytes(pk), { at: 0 });
    return [meta(cur, pk), [pk.buffer]];
  }
  return null;
}
async function remove() { await wipe(); let left = 0; for await (const name of (await rootDir()).keys()) left++; return { left }; }          // left: recordings that could not be deleted (open in another tab)
async function env() {
  const o = { sync: typeof FileSystemSyncAccessHandle !== 'undefined', storage: !!(navigator.storage && navigator.storage.getDirectory) };
  try { const e = await navigator.storage.estimate(); o.quota = e.quota; o.usage = e.usage; } catch (e) {}
  return o;
}

/* ---------------- WAV, read straight from the file a block at a time ----------------
   The header is read by hand: plain and extensible formats, a data size of 0 or 0xFFFFFFFF (a recorder that never went back to fill it in: the sound runs to the end of the file),
   and RF64 / BW64, whose real sizes are in the ds64 chunk. Whole numbers of 8, 16, 24 and 32 bits and floats of 32 and 64 bits. */
async function wavInfo(file) {
  const rd = async (o, n) => new DataView(await file.slice(o, o + n).arrayBuffer()), tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (file.size < 44) return null; const top = await rd(0, 12), riff = tag(top, 0), big = riff === 'RF64' || riff === 'BW64';
  if ((riff !== 'RIFF' && !big) || tag(top, 8) !== 'WAVE') return null;
  let fmt = null, data = null, size64 = null;
  for (let o = 12, k = 0; o + 8 <= file.size && k < 4096 && !(fmt && data); k++) {
    const hd = await rd(o, 8), id = tag(hd, 0), sz = hd.getUint32(4, true), body = o + 8; let len = sz;
    if (id === 'ds64' && sz >= 16) { const d = await rd(body, 16); size64 = Number(d.getBigUint64(8, true)); }
    else if (id === 'fmt ' && sz >= 16) fmt = { dv: await rd(body, Math.min(sz, 40)), sz };
    else if (id === 'data') { len = big && sz === 0xFFFFFFFF && size64 != null ? size64 : sz; if (len === 0 || len === 0xFFFFFFFF || body + len > file.size) len = file.size - body; data = { o: body, len }; }
    o = body + len + (len & 1);
  }
  if (!fmt || !data) return null;
  let af = fmt.dv.getUint16(0, true); const ch = fmt.dv.getUint16(2, true), sr = fmt.dv.getUint32(4, true), align = fmt.dv.getUint16(12, true), bits = fmt.dv.getUint16(14, true);
  if (af === 0xFFFE && fmt.dv.byteLength >= 26) af = fmt.dv.getUint16(24, true);          // extensible: the sub-format says what the samples are
  const okBits = af === 1 ? [8, 16, 24, 32] : af === 3 ? [32, 64] : [];
  if (!okBits.includes(bits) || ch < 1 || ch > 8 || sr < 8000 || sr > 192000 || align !== ch * bits / 8) return null;
  const frames = Math.floor(data.len / align); if (frames < 1) return null;
  return { float: af === 3, bits, ch, sr, align, at: data.o, frames };
}
/* the same fold to stereo the app uses for surround files, with the same sums in the same order */
function mixTaps(n) {
  const g = Math.SQRT1_2;
  const W = n === 4 ? [[0, 1], [2, g, 0], [3, g, 1]] : n === 6 ? [[0, 1], [1, 1], [2, g, 0], [2, g, 1], [4, g, 0], [5, g, 1]] : n === 8 ? [[0, 1], [1, 1], [2, g, 0], [2, g, 1], [4, g, 0], [5, g, 1], [6, g, 0], [7, g, 1]] : null;
  const taps = W ? W.map(w => w.length === 2 ? [w[0], w[1], w[0] % 2] : [w[0], w[1], w[2]]) : Array.from({ length: n }, (_, i) => [i, 1, i % 2]);
  const sumL = W ? 1 + g : taps.filter(t => t[2] === 0).reduce((a, t) => a + t[1], 0) || 1, sumR = W ? 1 + g : taps.filter(t => t[2] === 1).reduce((a, t) => a + t[1], 0) || 1;
  return taps.map(([c, w, side]) => [c, w / (side ? sumR : sumL), side]);
}
function wavBlock(ab, w, n) {
  const tot = n * w.ch; let x;
  if (w.float && w.bits === 32) x = new Float32Array(ab, 0, tot);
  else {
    x = new Float32Array(tot);
    if (w.float) { const s = new Float64Array(ab, 0, tot); for (let i = 0; i < tot; i++) x[i] = s[i]; }
    else if (w.bits === 16) { const s = new Int16Array(ab, 0, tot); for (let i = 0; i < tot; i++) x[i] = s[i] / 32768; }
    else if (w.bits === 24) { const s = new Uint8Array(ab); for (let i = 0, p = 0; i < tot; i++, p += 3) x[i] = (s[p] | s[p + 1] << 8 | s[p + 2] << 24 >> 8) / 8388608; }
    else if (w.bits === 32) { const s = new Int32Array(ab, 0, tot); for (let i = 0; i < tot; i++) x[i] = s[i] / 2147483648; }
    else { const s = new Uint8Array(ab); for (let i = 0; i < tot; i++) x[i] = (s[i] - 128) / 128; }
  }
  if (w.ch <= 2) return x;
  const out = new Float32Array(n * 2); for (const [c, k, side] of w.taps) for (let i = 0, p = c, o = side; i < n; i++, p += w.ch, o += 2) out[o] += x[p] * k;
  return out;
}
async function importWav({ file, key, piece }, id) {
  const w = await wavInfo(file); if (!w) return null;          // not a WAV this can read: the page uses the browser's decoder
  if (w.ch > 2) w.taps = mixTaps(w.ch);
  const { token } = await create({ key, name: file.name, sr: w.sr, ch: Math.min(2, w.ch), srcCh: w.ch, piece }), s = cur;
  for (let at = 0; at < w.frames; at += BLOCK) {
    if (dead.has(id)) { await wipe(); throw STALE; }
    const n = Math.min(BLOCK, w.frames - at), ab = await file.slice(w.at + at * w.align, w.at + (at + n) * w.align).arrayBuffer();
    if (ab.byteLength !== n * w.align) throw new Error('The file could not be read to the end.');
    await put(s, wavBlock(ab, w, n), n); postMessage({ id, progress: (at + n) / w.frames });
  }
  const r = await finish({ token }); r[0].float = w.float; r[0].bits = w.bits; return r;
}

/* ---------------- AIFF and AIFF-C, read straight from the file a block at a time ----------------
   The same plain sound as a WAV, but with the bytes of each number the other way round (big-endian) and 8-bit samples that are signed. The header is read by hand: COMM (channels, frames, bits, the rate as an 80-bit number)
   and SSND (the sound). AIFF-C adds a sample type: none, twos (big-endian), sowt (little-endian), fl32 and fl64 (floats). Anything compressed is left to the browser. */
async function aiffInfo(file) {
  const rd = async (o, n) => new DataView(await file.slice(o, o + n).arrayBuffer()), tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (file.size < 54) return null; const top = await rd(0, 12), form = tag(top, 8); if (tag(top, 0) !== 'FORM' || (form !== 'AIFF' && form !== 'AIFC')) return null;
  let comm = null, ssnd = null;
  for (let o = 12, k = 0; o + 8 <= file.size && k < 4096 && !(comm && ssnd); k++) {
    const hd = await rd(o, 8), id = tag(hd, 0), sz = hd.getUint32(4), body = o + 8;
    if (id === 'COMM' && sz >= 18) comm = await rd(body, Math.min(sz, 40));
    else if (id === 'SSND' && sz >= 8) { const h = await rd(body, 8), skip = h.getUint32(0); let len = sz - 8 - skip; if (body + 8 + skip + len > file.size) len = file.size - body - 8 - skip; ssnd = { o: body + 8 + skip, len }; }
    o = body + sz + (sz & 1);
  }
  if (!comm || !ssnd) return null;
  const ch = comm.getUint16(0), bits = comm.getUint16(6), exp = comm.getUint16(8) & 0x7fff, mant = comm.getUint32(10) * 4294967296 + comm.getUint32(14), sr = Math.round(mant * Math.pow(2, exp - 16383 - 63));
  let little = false, float = false;
  if (form === 'AIFC') {
    if (comm.byteLength < 22) return null; const t = tag(comm, 18);
    if (t === 'sowt') little = true; else if (t === 'fl32' || t === 'FL32' || t === 'fl64' || t === 'FL64') float = true; else if (t !== 'NONE' && t !== 'twos') return null;
  }
  if (!(float ? bits === 32 || bits === 64 : [8, 16, 24, 32].includes(bits)) || ch < 1 || ch > 8 || sr < 8000 || sr > 192000) return null;
  const align = ch * bits / 8, frames = Math.floor(ssnd.len / align); if (frames < 1) return null;
  return { float, bits, ch, sr, align, at: ssnd.o, frames, little };
}
/* the bytes of each sample the way a WAV has them, so the WAV conversion does the rest */
function aiffToWav(ab, w) {
  const u = new Uint8Array(ab), b = w.bits / 8; if (w.bits === 8) { for (let i = 0; i < u.length; i++) u[i] ^= 0x80; return ab; }
  if (w.little) return ab;
  for (let i = 0; i + b <= u.length; i += b) for (let a = i, z = i + b - 1; a < z; a++, z--) { const t = u[a]; u[a] = u[z]; u[z] = t; }
  return ab;
}
async function importAiff({ file, key, piece }, id) {
  const w = await aiffInfo(file); if (!w) return null;
  if (w.ch > 2) w.taps = mixTaps(w.ch);
  const { token } = await create({ key, name: file.name, sr: w.sr, ch: Math.min(2, w.ch), srcCh: w.ch, piece }), s = cur;
  for (let at = 0; at < w.frames; at += BLOCK) {
    if (dead.has(id)) { await wipe(); throw STALE; }
    const n = Math.min(BLOCK, w.frames - at), ab = await file.slice(w.at + at * w.align, w.at + (at + n) * w.align).arrayBuffer();
    if (ab.byteLength !== n * w.align) throw new Error('The file could not be read to the end.');
    await put(s, wavBlock(aiffToWav(ab, w), w, n), n); postMessage({ id, progress: (at + n) / w.frames });
  }
  const r = await finish({ token }); r[0].float = w.float; r[0].bits = w.bits; return r;
}

/* ---------------- Apple Lossless (ALAC) in M4A, decoded here ----------------
   The format is Apple's, which published its decoder as open source (Apache License 2.0, 2011); this is a fresh JavaScript implementation of the same bitstream (the sample-entry settings, the frame syntax, the adaptive Rice code
   for the residuals and the adaptive prediction filter), checked sample for sample against ffmpeg. Every frame holds one or two channels: a small header, the filter settings, the residuals, and for deep samples a few low-order bits that are kept apart. Mono and stereo only. */
const aPeek = (br, n) => { const i = br.p >> 3, b = br.b; return (((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) << (br.p & 7)) >>> (32 - n); };          // n <= 25
function aU(br, n) { if (n === 0) return 0; if (n > 25) { const hi = aU(br, n - 16); return hi * 65536 + aU(br, 16); } const v = aPeek(br, n); br.p += n; return v; }
const aS = (br, n) => { const v = aU(br, n); return n >= 32 ? v | 0 : (v << (32 - n)) >> (32 - n); };
const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
function aScalar(br, k, bps) {          // one Rice-coded number: a run of up to nine 1s (nine means "escape": the number follows in full), then k bits
  const top = aPeek(br, 9); let x = Math.clz32(~(top << 23)); if (x > 9) x = 9; br.p += x < 9 ? x + 1 : 9;
  if (x > 8) return aU(br, bps);
  if (k !== 1 && k > 0) { const eb = aPeek(br, k); x = (x << k) - x; if (eb > 1) { x += eb - 1; br.p += k; } else br.p += k - 1; }
  return x;
}
function aRice(br, out, n, bps, mult, cfg) {
  let hist = cfg.mb, mod = 0;
  for (let i = 0; i < n; i++) {
    let k = 31 - Math.clz32((hist >> 9) + 3); if (k > cfg.kb) k = cfg.kb;
    let x = aScalar(br, k, bps); x += mod; mod = 0;
    out[i] = (x >>> 1) ^ -(x & 1);
    hist += x * mult - ((hist * mult) >> 9); if (x > 0xffff) hist = 0xffff;
    if (hist < 128 && i + 1 < n) {          // a run of zeros follows
      k = 7 - (31 - Math.clz32(hist || 1)) + ((hist + 16) >> 6); if (k > cfg.kb) k = cfg.kb;
      const run = aScalar(br, k, 16); if (run > 0) { if (i + 1 + run > n) throw new Error('alac: run'); for (let j = 0; j < run; j++) out[i + 1 + j] = 0; i += run; }
      if (run <= 0xffff) mod = 1; hist = 0;
    }
  }
}
function aPredict(err, out, n, bps, co, order, quant) {
  out[0] = err[0]; if (n <= 1) return;
  if (order === 0) { for (let i = 1; i < n; i++) out[i] = err[i]; return; }
  if (order === 31) { for (let i = 1; i < n; i++) out[i] = sext(out[i - 1] + err[i], bps); return; }
  let i = 1; for (; i <= order && i < n; i++) out[i] = sext(out[i - 1] + err[i], bps);
  const half = quant > 0 ? 1 << (quant - 1) : 0;
  for (; i < n; i++) {
    const base = i - order - 1, d = out[base]; let v = 0, e = err[i];
    for (let j = 0; j < order; j++) v += (out[base + 1 + j] - d) * co[order - 1 - j];
    v = (v + half) >> quant; v += d + e; out[i] = sext(v, bps);
    const es = e > 0 ? 1 : e < 0 ? -1 : 0;
    if (es) for (let j = 0; j < order && e * es > 0; j++) { let w = d - out[base + 1 + j]; const sg = (w > 0 ? 1 : w < 0 ? -1 : 0) * es; co[order - 1 - j] -= sg; w *= sg; e -= (w >> quant) * (j + 1); }
  }
}
/* one frame: fills chans (Int32Array per channel) and gives the number of samples */
function alacFrame(data, cfg, chans) {
  const br = { b: data, p: 0 }; let n = 0;
  for (;;) {
    const tag = aU(br, 3); if (tag === 7) break; if (tag !== cfg.ch - 1) throw new Error('alac: element');
    aU(br, 4); aU(br, 12); const hasSize = aU(br, 1), extra = aU(br, 2) << 3, comp = !aU(br, 1); n = hasSize ? aU(br, 32) : cfg.frame;
    if (n < 1 || n > 1 << 20) throw new Error('alac: size'); const nc = cfg.ch, bps = cfg.bits - extra + (nc - 1);
    for (let c = 0; c < nc; c++) if (!chans[c] || chans[c].length < n) chans[c] = new Int32Array(n);
    if (!comp) { for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) chans[c][i] = aS(br, cfg.bits); continue; }
    const mixShift = aU(br, 8), mixW = aS(br, 8);          // read for one channel too, and unused there
    const pt = [], pq = [], rm = [], co = []; for (let c = 0; c < nc; c++) { pt[c] = aU(br, 4); pq[c] = aU(br, 4); rm[c] = aU(br, 3); const ord = aU(br, 5), a = new Int32Array(ord); for (let i = 0; i < ord; i++) a[i] = aS(br, 16); co[c] = a; }
    let ex = null; if (extra) { ex = []; for (let c = 0; c < nc; c++) ex[c] = new Int32Array(n); for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) ex[c][i] = aU(br, extra); }
    const err = new Int32Array(n), mid = new Int32Array(n);
    for (let c = 0; c < nc; c++) {
      aRice(br, err, n, bps, rm[c] * cfg.pb / 4 | 0, cfg);
      if (pt[c] === 0) aPredict(err, chans[c], n, bps, co[c], co[c].length, pq[c]);
      else { aPredict(err, mid, n, bps, null, 31, 0); aPredict(mid, chans[c], n, bps, co[c], co[c].length, pq[c]); }
    }
    if (nc === 2 && mixW) for (let i = 0; i < n; i++) { let a = chans[0][i], b = chans[1][i]; a -= (b * mixW) >> mixShift; b += a; chans[0][i] = b; chans[1][i] = a; }
    if (extra) for (let c = 0; c < nc; c++) for (let i = 0; i < n; i++) chans[c][i] = (chans[c][i] << extra) | ex[c][i];
  }
  return n;
}
/* the sound track of an M4A that holds ALAC: its settings, where each frame is, and how many samples there are in all. Null for anything else */
async function alacTrack(file) {
  const rd = async (o, n) => new DataView(await file.slice(o, o + n).arrayBuffer()), tg = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  let moov = null; for (let o = 0, k = 0; o + 8 <= file.size && k < 4096; k++) {
    const h = await rd(o, 16); let sz = h.getUint32(0), hs = 8; const t = tg(h, 4); if (sz === 1) { sz = Number(h.getBigUint64(8)); hs = 16; } else if (sz === 0) sz = file.size - o; if (sz < hs) return null;
    if (t === 'moov') { if (sz > 1 << 28) return null; moov = new Uint8Array(await file.slice(o + hs, o + sz).arrayBuffer()); break; } o += sz;
  }
  if (!moov) return null; const dv = new DataView(moov.buffer), type = o => String.fromCharCode(moov[o], moov[o + 1], moov[o + 2], moov[o + 3]);
  const kids = (from, to) => { const out = []; for (let o = from; o + 8 <= to;) { let sz = dv.getUint32(o), hs = 8; if (sz === 1 && o + 16 <= to) { sz = Number(dv.getBigUint64(o + 8)); hs = 16; } else if (sz === 0) sz = to - o; if (sz < hs || o + sz > to) break; out.push({ t: type(o + 4), s: o + hs, e: o + sz }); o += sz; } return out; };
  const get = (l, t) => l.find(k => k.t === t);
  for (const trak of kids(0, moov.length)) {
    if (trak.t !== 'trak') continue; const mdia = get(kids(trak.s, trak.e), 'mdia'); if (!mdia) continue; const mk = kids(mdia.s, mdia.e), hd = get(mk, 'hdlr'), minf = get(mk, 'minf'); if (!hd || !minf || type(hd.s + 8) !== 'soun') continue;
    const stbl = get(kids(minf.s, minf.e), 'stbl'); if (!stbl) continue; const sk = kids(stbl.s, stbl.e), stsd = get(sk, 'stsd'), stsz = get(sk, 'stsz'), stsc = get(sk, 'stsc'), stco = get(sk, 'stco') || get(sk, 'co64'), stts = get(sk, 'stts');
    if (!stsd || !stsz || !stsc || !stco || !stts) continue; const ent = stsd.s + 8; if (type(ent + 4) !== 'alac') continue;
    let cfgAt = -1; const entEnd = ent + dv.getUint32(ent); for (let o = ent + 36; o + 8 <= entEnd; ) { const sz = dv.getUint32(o); if (sz < 8) break; if (type(o + 4) === 'alac') { cfgAt = o + 12; break; } o += sz; }
    if (cfgAt < 0 || cfgAt + 24 > moov.length) return null;
    const cfg = { frame: dv.getUint32(cfgAt), bits: moov[cfgAt + 5], pb: moov[cfgAt + 6], mb: moov[cfgAt + 7], kb: moov[cfgAt + 8], ch: moov[cfgAt + 9], sr: dv.getUint32(cfgAt + 20) };
    if (cfg.ch < 1 || cfg.ch > 2 || ![16, 20, 24, 32].includes(cfg.bits) || !cfg.frame || cfg.frame > 1 << 20 || cfg.sr < 8000 || cfg.sr > 192000) return null;
    const size0 = dv.getUint32(stsz.s + 4), count = dv.getUint32(stsz.s + 8), sizes = new Uint32Array(count); for (let i = 0; i < count; i++) sizes[i] = size0 || dv.getUint32(stsz.s + 12 + i * 4);
    const nch = dv.getUint32(stco.s + 4), wide = stco.t === 'co64', chunk = i => wide ? Number(dv.getBigUint64(stco.s + 8 + i * 8)) : dv.getUint32(stco.s + 8 + i * 4);
    const nsc = dv.getUint32(stsc.s + 4), offs = new Float64Array(count); let k = 0;
    for (let e = 0; e < nsc; e++) { const first = dv.getUint32(stsc.s + 8 + e * 12), spc = dv.getUint32(stsc.s + 12 + e * 12), last = e + 1 < nsc ? dv.getUint32(stsc.s + 8 + (e + 1) * 12) - 1 : nch; for (let c = first - 1; c < last && k < count; c++) { let o = chunk(c); for (let j = 0; j < spc && k < count; j++, k++) { offs[k] = o; o += sizes[k]; } } }
    if (k < count) return null;
    let total = 0; const ns = dv.getUint32(stts.s + 4); for (let i = 0; i < ns; i++) total += dv.getUint32(stts.s + 8 + i * 8) * dv.getUint32(stts.s + 12 + i * 8);
    return { cfg, sizes, offs, count, total };
  }
  return null;
}
async function importAlac({ file, key, piece }, id) {
  let tr = null; try { tr = await alacTrack(file); } catch (e) { return null; } if (!tr || tr.total < 1) return null;
  const cfg = tr.cfg, { token } = await create({ key, name: file.name, sr: cfg.sr, ch: cfg.ch, srcCh: cfg.ch, piece }), s = cur, scale = 1 / Math.pow(2, cfg.bits - 1), chans = [];
  let out = new Float32Array(BLOCK * cfg.ch), fill = 0, frames = 0, wb = 0, win = new Uint8Array(0), t0 = performance.now();
  const flush = async () => { if (fill) { await put(s, out, fill); frames += fill; fill = 0; out = new Float32Array(BLOCK * cfg.ch); } };
  try {
    for (let f = 0; f < tr.count && frames + fill < tr.total; f++) {
      if (dead.has(id)) { await wipe(); throw STALE; }
      const o = tr.offs[f], len = tr.sizes[f]; if (o < wb || o + len > wb + win.length) { wb = o; win = new Uint8Array(await file.slice(o, Math.min(file.size, o + Math.max(len, 4 << 20))).arrayBuffer()); }
      if (win.length < o - wb + len) throw new Error('The file could not be read to the end.');
      const n0 = alacFrame(win.subarray(o - wb, o - wb + len), cfg, chans), n = Math.min(n0, tr.total - frames - fill);
      for (let k = 0; k < n;) { const take = Math.min(n - k, BLOCK - fill); for (let c = 0; c < cfg.ch; c++) { const x = chans[c]; for (let i = 0, q = fill * cfg.ch + c; i < take; i++, q += cfg.ch) out[q] = x[k + i] * scale; } fill += take; k += take; if (fill === BLOCK) await flush(); }
      if (performance.now() - t0 > 100) { t0 = performance.now(); postMessage({ id, progress: Math.min(0.99, f / tr.count) }); await tick(); }
    }
    await flush();
  } catch (e) { try { await wipe(); } catch (e2) {} if (e === STALE) throw e; return null; }
  if (!cur || cur.m.token !== token || frames < tr.total * 0.99) { try { await wipe(); } catch (e) {} return null; }
  return await finish({ token });
}

/* ---------------- the tools, on the stored recording ----------------
   fxSet takes the description of the processing; fxRead gives any stretch of the processed sound. Stages that did not change are kept from the settings before.
   These do not wait in the store's line (a long measuring pass must not hold up a read for playback): each of their reads from disk takes its turn there instead. */
const tick = () => new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); r(); }; c.port2.postMessage(0); });          // lets waiting messages through without a timer
/* a read for the player goes first; a read for a long job (measuring, scanning) waits while the player is waiting, and every read gives the worker's other messages a turn */
const rawRead = (token, copy, job) => async (a, n) => { if (job) { const w = calm(); if (w) await w; } return queue(async () => (await read({ token, start: a, n, copy }))[0].chans, !job); };
async function fxSet({ token, recipe, slot }) {
  const s = mine(token), src = { key: token, sr: s.m.sr, ch: s.m.ch, frames: s.m.frames, read: rawRead(token) }, sig = JSON.stringify(recipe), old = slotOf(slot);
  const nu = { token, sig, recipe, src, plain: KFX.plain(recipe), chain: KFX.chain(src, recipe, old && old.token === token ? old.chain : null), masters: new Map() }; if (slot === 'exp') fxExp = nu; else if (slot === 'ply') fxPly = nu; else fx = nu; return { copy: !!(s.copy && s.copy.sig === sig) };
}
function tools(token, slot) { const s = mine(token), f = slotOf(slot); if (!f || f.token !== token) throw new Error('No tools are set for this recording.'); return s; }
/* the processed sound for a job: the recording itself when no tool changes it, the processed copy on disk when it is there, or else worked out on the way (always exact) */
function processed(s, slot) {
  const fx = slotOf(slot);
  if (fx.plain) { const rd = rawRead(fx.token, false, true); return async (a, n) => ({ chans: await rd(a, n) }); }
  if (s.copy && s.copy.sig === fx.sig) { const rd = rawRead(fx.token, true, true); return async (a, n) => ({ chans: await rd(a, n) }); }
  const job = KFX.chain(Object.assign({}, fx.src, { read: rawRead(fx.token, false, true) }), fx.recipe, fx.chain, true); return (a, n) => job.read(a, n, true);
}
const info = s => ({ sr: s.m.sr, ch: s.m.ch, frames: s.m.frames });
/* Playing comes first: while the player is waiting for sound (a start, a jump, a change of tools), the long jobs (measuring, scanning) hold still at their next pause and carry on when it has been served */
let urgent = 0, calmWait = [];
const calm = () => urgent > 0 ? new Promise(r => calmWait.push(r)) : null;
const ticker = id => { let t = performance.now(); return async f => { if (performance.now() - t < 40) return; postMessage({ id, progress: f }); await tick(); { const w = calm(); if (w) await w; } t = performance.now(); if (dead.has(id)) throw STALE; }; };
async function fxRead({ token, start, n, exact, slot }) {
  const s = tools(token, slot), fx = slotOf(slot); start = Math.max(0, Math.floor(start));
  if (!fx.plain && s.copy && s.copy.sig === fx.sig) { const chans = await rawRead(token, true)(start, n); return [{ start, chans, exact: true }, chans.map(x => x.buffer)]; }
  const r = await fx.chain.read(start, n, exact); return [{ start, chans: r.chans, exact: r.exact }, r.chans.map(x => x.buffer)];
}
/* One pass over the whole processed sound: its waveform heights (highest sample and true peak of every 10ms) and, when a tool changes the sound, a processed copy on disk beside the recording,
   so that the loudness, the limiter, playback and export read it from there and do not work it out again. One copy is kept: the one for the settings last scanned. */
async function fxScan({ token }, id) {
  const s = tools(token), sig = fx.sig, m = s.m, ch = m.ch, P = m.piece, FB = ch * 4, H = new KFX.Heights(m.frames, m.sr, ch), B = 1 << 16, tk = ticker(id), keep = !fx.plain;
  const have = s.copy && s.copy.sig === sig, rd = processed(s);
  if (keep && !have) await queue(async () => { s.copy = null; for (const [name, h] of Array.from(s.handles)) if (name[0] === 'x') { try { h.close(); } catch (e) {} s.handles.delete(name); } const old = []; for await (const name of s.dir.keys()) if (/^x\d+\.f32$/.test(name)) old.push(name); for (const name of old) await s.dir.removeEntry(name); });
  for (let at = 0; at < m.frames; at += B) {
    const n = Math.min(B, m.frames - at), r = await rd(at, n); H.push(r.chans, n);
    if (keep && !have) await queue(async () => {
      mine(token); let il = r.chans[0]; if (ch > 1) { il = new Float32Array(n * ch); for (let c = 0; c < ch; c++) { const x = r.chans[c]; for (let i = 0, p = c; i < n; i++, p += ch) il[p] = x[i]; } }
      for (let done = 0; done < n;) { const f = at + done, take = Math.min(n - done, P - f % P), h = await handle(s, copyName(Math.floor(f / P)), true); if (h.write(bytes(il.subarray(done * ch, (done + take) * ch)), { at: (f % P) * FB }) !== take * FB) throw new Error('The disk is full.'); done += take; }
    });
    await tk((at + n) / m.frames); if (!fx || fx.sig !== sig) throw STALE;
  }
  if (keep && !have) s.copy = { sig };
  return [{ peaks: H.peaks, peakMax: H.mx || 1, tp: H.tp, copy: keep }, [H.peaks.buffer, H.tp.buffer]];
}
/* the waveform heights of the recording itself (no tools): the highest sample and true peak of every 10ms, in one pass that does not depend on, or disturb, the tools that are set */
async function rawScan({ token }, id) {
  const s = mine(token), m = s.m, H = new KFX.Heights(m.frames, m.sr, m.ch), B = 1 << 16, tk = ticker(id), rd = rawRead(token, false, true);
  for (let at = 0; at < m.frames; at += B) { const n = Math.min(B, m.frames - at); H.push(await rd(at, n), n); await tk((at + n) / m.frames); }
  return [{ peaks: H.peaks, peakMax: H.mx || 1, tp: H.tp }, [H.peaks.buffer, H.tp.buffer]];
}
/* the loudness of the kept part with its fades, before any volume change */
async function fxLoud({ token, spec, slot }, id) { const s = tools(token, slot), mm = KFX.master(processed(s, slot), info(s), Object.assign({}, spec, { gain: 1, limit: null, clamp: false })); return KFX.loudness(mm.fill, mm.total, mm.sr, mm.ch, ticker(id)); }
/* the volume that makes the limited sound land on a loudness target, and what comes out */
async function fxLimit({ token, spec, target, ceil, slot }, id) { const s = tools(token, slot); return KFX.limitTo(processed(s, slot), info(s), spec, target, ceil, ticker(id)); }
/* the final samples of a stretch (level, fades, limiter), planar. Reads that follow one another carry the limiter on. */
async function fxMaster({ token, spec, pos, len, slot }) {
  const s = tools(token, slot), fx = slotOf(slot), key = JSON.stringify(spec); let mm = fx.masters.get(key);
  if (!mm) {
    let rd = processed(s, slot), inf = info(s);
    if (spec.rate && spec.rate !== inf.sr) { const rs = KFX.resampled(rd, inf, spec.rate, spec.ve); rd = rs.read; inf = rs.info; }          // a file at another sample rate: the sound is converted first, then the fades, volume and limiter are applied at the new rate
    mm = KFX.master(rd, inf, spec); fx.masters.set(key, mm); while (fx.masters.size > 2) fx.masters.delete(fx.masters.keys().next().value); }
  const out = await mm.fill(pos, len); return [{ pos, data: out, total: mm.total, reduction: mm.reduction() }, [out.buffer]];
}

/* The picture for the spectrum view of one stretch of the recording: cols columns across t0 … t1, each the average power of up to K slices of N samples spread over its share of the time, after noise reduction and Spectra's rectangles
   (not EQ or Imager), the same analysis as the page's own (its code arrives with the job). Gives the loudness in dB of H bands of pitch for each column. */
async function specScan({ token, recipe, code, t0, t1, cols, K, N, H, fmin, fmax }, id) {
  const s = mine(token), m = s.m, sr = m.sr, src = { key: token, sr, ch: m.ch, frames: m.frames, read: rawRead(token, false, true) }, run = new Function(code + '; return specRun;')(), tk = ticker(id);
  const chn = KFX.chain(src, { noise: recipe.noise, axis: recipe.axis, edits: recipe.edits, tools: [] }, null, true), out = new Float32Array(cols * H), colSec = (t1 - t0) / cols, last = Math.max(0, m.frames - N), mono = new Float32Array(K * N), acc = new Float64Array(H);
  for (let c = 0; c < cols; c++) {
    for (let k = 0; k < K; k++) {
      const at = Math.max(0, Math.min(last, Math.round((t0 + c * colSec + (k + 0.5) * colSec / K) * sr - N / 2))), n = Math.min(N, m.frames - at), r = await chn.read(at, n, false), a = r.chans[0], b = r.chans[1] || null, o = k * N;
      for (let i = 0; i < N; i++) mono[o + i] = i < n ? (b ? (a[i] + b[i]) * 0.5 : a[i]) : 0;
    }
    acc.fill(0); let got = 0; run(mono, sr, N / sr, N, H, fmin, fmax, (c0, data, n) => { for (let f = 0; f < n; f++) { for (let h = 0; h < H; h++) acc[h] += Math.pow(10, data[f * H + h] / 10); got++; } });
    for (let h = 0; h < H; h++) out[c * H + h] = 10 * Math.log10(acc[h] / Math.max(1, got) + 1e-30);
    if ((c & 7) === 7) await tk(c / cols);
    if (dead.has(id)) throw STALE;
  }
  return [{ db: out, cols }, [out.buffer]];
}
/* the average level where there is sound, of the recording as it is and of the sound the tools make of it, over a..b seconds (for playing Bypass as loud as the processed sound).
   The same sums as the page's aeRmsOf: tenth-of-a-second blocks, every other sample, only blocks above 1e-5 of the loudest count. Uses a chain of its own, so the tools that are set for playing are not disturbed. */
async function rmsScan({ token, recipe, a, b }, id) {
  const s = mine(token), m = s.m, sr = m.sr, nch = Math.min(2, m.ch), i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(m.frames, Math.floor(b * sr)), blk = Math.floor(sr / 10), per = 50, tk = ticker(id);
  const raw = rawRead(token, false, true), src = { key: token, sr, ch: m.ch, frames: m.frames, read: raw }, chn = KFX.plain(recipe) ? null : KFX.chain(src, recipe, null, true), pw = [[], []], mx = [0, 0];
  for (let p = i0; p + blk <= i1; p += blk * per) {
    const nb = Math.min(per, Math.floor((i1 - p) / blk)); if (nb < 1) break; const n = nb * blk, ins = [await raw(p, n), chn ? (await chn.read(p, n, true)).chans : null];
    for (let w = 0; w < 2; w++) { const ch = ins[w] || ins[0]; for (let k = 0; k < nb; k++) { let sum = 0; for (let c = 0; c < nch; c++) { const d = ch[c]; for (let i = k * blk; i < (k + 1) * blk; i += 2) sum += d[i] * d[i]; } pw[w].push(sum); if (sum > mx[w]) mx[w] = sum; } }
    await tk((p - i0) / Math.max(1, i1 - i0));
  }
  const rms = w => { let t = 0, n = 0; for (const v of pw[w]) if (v > mx[w] * 1e-5) { t += v; n++; } return n ? Math.sqrt(t / n) : 0; };
  return { o: rms(0), p: rms(1) };
}

/* ---------------- FLAC, read straight into the store ----------------
   Written from the published format (RFC 9639). The file is read in pieces, every frame is decoded and checked against its two checksums, and the samples go into the store a block at a time.
   Anything this does not read (more than two channels, a damaged frame, a stream it does not know) gives null, and the page uses the browser's own decoder as before. */
const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = (c & 0x80) ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; t[i] = c; } return t; })();
const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; } return t; })();
async function flacInfo(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer()); if (head.length < 4 || head[0] !== 0x66 || head[1] !== 0x4c || head[2] !== 0x61 || head[3] !== 0x43) return null;
  let at = 4, info = null;
  for (;;) {
    const h = new Uint8Array(await file.slice(at, at + 4).arrayBuffer()); if (h.length < 4) return null;
    const last = h[0] >> 7, type = h[0] & 127, len = (h[1] << 16) | (h[2] << 8) | h[3]; at += 4;
    if (type === 0) {
      if (len !== 34) return null; const b = new Uint8Array(await file.slice(at, at + 34).arrayBuffer()), v = new DataView(b.buffer);
      info = { minBs: v.getUint16(0), maxBs: v.getUint16(2), sr: (b[10] << 12) | (b[11] << 4) | (b[12] >> 4), ch: ((b[12] >> 1) & 7) + 1, bps: (((b[12] & 1) << 4) | (b[13] >> 4)) + 1, total: (b[13] & 15) * 4294967296 + v.getUint32(14) };
    }
    at += len; if (last) break;
  }
  if (!info) return null; info.at = at; return info;
}
/* a reader of bits from a block of bytes */
function FlacBits(u8) { this.b = u8; this.p = 0; }
FlacBits.prototype.u = function (n) {          // up to 32 bits, unsigned
  let v = 0; while (n > 0) { const byte = this.b[this.p >> 3], have = 8 - (this.p & 7), take = n < have ? n : have; v = v * (1 << take) + ((byte >> (have - take)) & ((1 << take) - 1)); this.p += take; n -= take; }
  return v;
};
FlacBits.prototype.s = function (n) { const v = this.u(n); return n < 32 && v >= Math.pow(2, n - 1) ? v - Math.pow(2, n) : (n === 32 && v >= 2147483648 ? v - 4294967296 : v); };
FlacBits.prototype.unary = function () { let n = 0; for (;;) { const byte = this.b[this.p >> 3] << (this.p & 7) & 255; if (byte) { const z = Math.clz32(byte) - 24; this.p += z + 1; return n + z; } n += 8 - (this.p & 7); this.p = (this.p + 8) & ~7; if ((this.p >> 3) > this.b.length) throw new Error('flac: ran out of bytes'); } };
function flacResidual(br, out, from, n, order, bsz) {
  const method = br.u(2); if (method > 1) throw new Error('flac: residual method'); const po = br.u(4), parts = 1 << po, pb = method ? 5 : 4, esc = method ? 31 : 15; let at = from;
  if (bsz >> po < order) throw new Error('flac: partition');
  for (let q = 0; q < parts; q++) {
    const cnt = (bsz >> po) - (q === 0 ? order : 0), k = br.u(pb);
    if (k === esc) { const bits = br.u(5); for (let i = 0; i < cnt; i++) out[at++] = bits ? br.s(bits) : 0; }
    else for (let i = 0; i < cnt; i++) { const hi = br.unary(), lo = k ? br.u(k) : 0, z = hi * Math.pow(2, k) + lo; out[at++] = (z % 2) ? -(z - 1) / 2 - 1 : z / 2; }
  }
}
const FLAC_FIXED = [[], [1], [2, -1], [3, -3, 1], [4, -6, 4, -1]];
function flacSub(br, n, bits) {
  if (br.u(1)) throw new Error('flac: subframe'); const type = br.u(6); let wasted = 0;
  if (br.u(1)) { wasted = br.unary() + 1; } bits -= wasted; if (bits < 1 || bits > 32) throw new Error('flac: depth');
  const x = new Int32Array(n);
  if (type === 0) { const v = br.s(bits); x.fill(v); }
  else if (type === 1) { for (let i = 0; i < n; i++) x[i] = br.s(bits); }
  else if (type >= 8 && type <= 12) {
    const ord = type - 8; for (let i = 0; i < ord; i++) x[i] = br.s(bits); flacResidual(br, x, ord, n, ord, n);
    const co = FLAC_FIXED[ord]; for (let i = ord; i < n; i++) { let p = 0; for (let j = 0; j < ord; j++) p += co[j] * x[i - 1 - j]; x[i] += p; }
  } else if (type >= 32) {
    const ord = (type & 31) + 1; for (let i = 0; i < ord; i++) x[i] = br.s(bits);
    const prec = br.u(4) + 1; if (prec === 16) throw new Error('flac: precision'); const shift = br.s(5), co = new Float64Array(ord); if (shift < 0) throw new Error('flac: shift');
    for (let j = 0; j < ord; j++) co[j] = br.s(prec); flacResidual(br, x, ord, n, ord, n);
    const div = Math.pow(2, shift);
    for (let i = ord; i < n; i++) { let p = 0; for (let j = 0; j < ord; j++) p += co[j] * x[i - 1 - j]; x[i] += Math.floor(p / div); }          // the sum is held in a double: exact for the sizes that occur
  } else throw new Error('flac: subframe type');
  if (wasted) for (let i = 0; i < n; i++) x[i] = x[i] * Math.pow(2, wasted);
  return x;
}
/* one frame at the reader's place: { n, chans } with the channels as whole numbers, left and right already restored */
function flacFrame(br, si) {
  const startByte = br.p >> 3, b = br.b;
  if (br.u(14) !== 0x3ffe || br.u(1) !== 0) throw new Error('flac: sync'); br.u(1);
  const bsc = br.u(4), src = br.u(4), asg = br.u(4), szc = br.u(3); if (br.u(1)) throw new Error('flac: header');
  let v = br.u(8); if (v >= 0x80) { let extra = v >= 0xfe ? 6 : v >= 0xfc ? 5 : v >= 0xf8 ? 4 : v >= 0xf0 ? 3 : v >= 0xe0 ? 2 : v >= 0xc0 ? 1 : -1; if (extra < 0) throw new Error('flac: number'); for (let i = 0; i < extra; i++) br.u(8); }
  let n = bsc === 1 ? 192 : bsc >= 2 && bsc <= 5 ? 576 << (bsc - 2) : bsc >= 8 ? 256 << (bsc - 8) : bsc === 6 ? br.u(8) + 1 : bsc === 7 ? br.u(16) + 1 : 0; if (!n) throw new Error('flac: block size');
  if (src === 12) br.u(8); else if (src === 13 || src === 14) br.u(16); else if (src === 15) throw new Error('flac: rate');
  const crc = br.u(8), hb = (br.p >> 3) - 1; let c = 0; for (let i = startByte; i < hb; i++) c = CRC8[c ^ b[i]]; if (c !== crc) throw new Error('flac: header checksum');
  const bits = [si.bps, 8, 12, 0, 16, 20, 24, 32][szc]; if (!bits) throw new Error('flac: depth'); const nch = asg < 8 ? asg + 1 : 2, chans = [];
  for (let k = 0; k < nch; k++) chans.push(flacSub(br, n, bits + (asg === 8 && k === 1 || asg === 9 && k === 0 || asg === 10 && k === 1 ? 1 : 0)));
  br.p = (br.p + 7) & ~7; const crc16 = br.u(16), end = (br.p >> 3) - 2; let d = 0; for (let i = startByte; i < end; i++) d = ((d << 8) & 0xffff) ^ CRC16[(d >> 8) ^ b[i]]; if (d !== crc16) throw new Error('flac: frame checksum');
  if (asg === 8) { const L = chans[0], S = chans[1]; for (let i = 0; i < n; i++) S[i] = L[i] - S[i]; }
  else if (asg === 9) { const S = chans[0], R = chans[1]; for (let i = 0; i < n; i++) S[i] = S[i] + R[i]; }          // the side channel becomes the left
  else if (asg === 10) { const M = chans[0], S = chans[1]; for (let i = 0; i < n; i++) { const m = M[i] * 2 + (S[i] & 1), s = S[i]; M[i] = (m + s) >> 1; S[i] = (m - s) >> 1; } }
  else if (asg > 10) throw new Error('flac: channels');
  return { n, chans, bits };
}
async function importFlac({ file, key, piece }, id) {
  let info = null; try { info = await flacInfo(file); } catch (e) { return null; }
  if (!info || info.ch > 2 || info.bps < 4 || info.bps > 24 || !info.sr) return null;
  const { token } = await create({ key, name: file.name, sr: info.sr, ch: info.ch, srcCh: info.ch, piece }), s = cur, WIN = 8 << 20, NEED = 1 << 20, scale = 1 / Math.pow(2, info.bps - 1);
  let base = info.at, win = new Uint8Array(0), pos = 0, frames = 0, fill = 0, out = new Float32Array(BLOCK * info.ch), t0 = performance.now();
  const flush = async () => { if (fill) { await put(s, out, fill); frames += fill; fill = 0; out = new Float32Array(BLOCK * info.ch); } };
  try {
    for (;;) {
      if (dead.has(id)) { await wipe(); throw STALE; }
      if (win.length - pos < NEED && base + win.length < file.size) { const from = base + pos, ab = new Uint8Array(await file.slice(from, Math.min(file.size, from + WIN)).arrayBuffer()); win = ab; base = from; pos = 0; }
      if (win.length - pos < 6) break;
      const br = new FlacBits(win); br.p = pos * 8; let f; try { f = flacFrame(br, info); } catch (e) { if (/sync/.test(e.message) && base + win.length >= file.size && win.length - pos < 4096 && frames + fill > 0) break; throw e; }          // a tag after the last frame is not a frame
      pos = br.p >> 3; if (f.bits !== info.bps) throw new Error('flac: the depth changes');
      for (let k = 0, o = 0; k < f.n;) {
        const take = Math.min(f.n - k, BLOCK - fill);
        for (let c = 0; c < info.ch; c++) { const x = f.chans[c]; for (let i = 0, q = fill * info.ch + c; i < take; i++, q += info.ch) out[q] = x[k + i] * scale; }
        fill += take; k += take; if (fill === BLOCK) await flush();
      }
      if (performance.now() - t0 > 100) { t0 = performance.now(); postMessage({ id, progress: Math.min(0.99, (base + pos - info.at) / Math.max(1, file.size - info.at)) }); await tick(); }
    }
    await flush();
  } catch (e) { try { await wipe(); } catch (e2) {} if (e === STALE) throw e; return null; }          // not readable this way: the page decodes it as before
  if (!cur || cur.m.token !== token || frames < 1) { try { await wipe(); } catch (e) {} return null; }
  return await finish({ token });
}

/* a file being made for export: written a piece at a time into the recording's folder, then handed to the page as a file (no copy in memory). One at a time; the next export or a new recording replaces it. */
async function exportOpen({ token, name }) {
  const s = mine(token), names = []; for await (const n of s.dir.keys()) if (/^export.*\.bin$/.test(n) && n !== name) names.push(n);
  names.sort(); names.pop();          // the newest earlier file may still be being saved by the browser; older ones are cleared away
  for (const n of names) { const o = s.handles.get(n); if (o) { try { o.close(); } catch (e) {} s.handles.delete(n); } try { await s.dir.removeEntry(n); } catch (e) {} }
  const h = await handle(s, name, true); h.truncate(0); return { ok: true };
}
async function exportWrite({ token, name, at, data }) { const s = mine(token), h = await handle(s, name, true); if (h.write(new Uint8Array(data), { at }) !== data.byteLength) throw new Error('The disk is full.'); return { ok: true }; }
async function exportClose({ token, name }) { const s = mine(token), h = s.handles.get(name); if (h) { try { h.flush(); } catch (e) {} try { h.close(); } catch (e) {} s.handles.delete(name); } return { ok: true }; }
async function exportRemove({ token, name }) { const s = mine(token), h = s.handles.get(name); if (h) { try { h.close(); } catch (e) {} s.handles.delete(name); } try { await s.dir.removeEntry(name); } catch (e) {} return { ok: true }; }

const CMDS = { env, create, append, finish, read, peaks, open, remove, importWav, importAiff, importAlac, importFlac, exportOpen, exportWrite, exportClose, exportRemove }, JOBS = { fxSet, fxRead, fxScan, rawScan, fxLoud, fxLimit, fxMaster, specScan, rmsScan };
const qHi = [], qLo = []; let qBusy = false;
const queue = (fn, hi) => new Promise((res, rej) => { (hi ? qHi : qLo).push({ fn, res, rej }); if (!qBusy) qPump(); });          // in order, but what the player is waiting for goes before what is only being measured
async function qPump() { qBusy = true; try { for (let it; (it = qHi.shift() || qLo.shift());) { try { it.res(await it.fn()); } catch (e) { it.rej(e); } await tick(); } } finally { qBusy = false; } }          // the store does one thing at a time
onmessage = e => {
  const { id, cmd } = e.data; if (cmd === 'cancel') { dead.add(e.data.target); return; }
  const hot = cmd === 'fxRead' && e.data.slot !== 'exp'; if (hot) urgent++;
  (JOBS[cmd] ? Promise.resolve().then(() => JOBS[cmd](e.data, id)) : queue(() => CMDS[cmd](e.data, id), cmd === 'read' && e.data.hi)).then(r => { let tr = []; if (Array.isArray(r)) { tr = r[1]; r = r[0]; } postMessage({ id, ok: true, result: r }, tr); },
    async err => { if (cmd === 'append' || cmd === 'importWav' || cmd === 'finish') { try { if (err !== STALE) await wipe(); } catch (e2) {} } postMessage({ id, ok: false, stale: err === STALE, error: errText(err) }); }).then(() => { dead.delete(id); if (hot && --urgent === 0) calmWait.splice(0).forEach(r => r()); });
};
