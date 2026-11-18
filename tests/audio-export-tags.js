// Audio export tags: what is typed into the tag fields comes back out of the exported file exactly (only the ends of each value are trimmed),
// in every format and depth (WAV 16, 24, and 32-bit float, FLAC 16 and 24-bit, M4A at several rates), from several kinds of source file, from memory and from the disk store,
// with plain, accented, non-Latin, right-to-left, emoji, long, and symbol-filled values. Empty fields write nothing, and no tags at all leave the file untagged.
// The files are read back here by the formats' own rules (WAV's LIST/INFO and ID3 chunks, FLAC's Vorbis comments, M4A's ilst), and by ffprobe too when it is installed.
// The exported files are kept in $TMPDIR/glisscore-tags for reading with other tools.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/audio-export-tags.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const FX = process.env.S || 'tests/fixtures', KEEP = path.join(os.tmpdir(), 'glisscore-tags');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
fs.rmSync(KEEP, { recursive: true, force: true }); fs.mkdirSync(KEEP, { recursive: true });
let ffprobe = null; try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); ffprobe = 'ffprobe'; } catch (e) { }

// what a person types, field by field (the ids of the inputs after "aeTag")
const LONG = 'Variations on a theme '.repeat(60).trim() + ' — ' + 'ñ'.repeat(300);
const SETS = {
  plain: { Title: 'Sonata No. 2', Artist: 'Jane Doe', AlbumArtist: 'The Ensemble', Album: 'Recital', Year: '2024', Track: '7', Disc: '2', Composer: 'J. S. Bach', Genre: 'Classical', Comment: 'Recorded live' },
  unicode: { Title: 'Clair de lune — Débussy’s “Suite bergamasque”', Artist: 'Zoë Ångström & Łukasz Øster', AlbumArtist: 'Ελληνικό Κουαρτέτο', Album: '交響曲 第九番 / 合唱付き', Year: '1905', Track: '12', Disc: '1', Composer: 'Пётр Ильич Чайковский', Genre: 'Classical; Romantic', Comment: 'שלום עולם · مرحبا بالعالم · 🎻🎹🎼 👩🏽‍🎤 a=b=c, 50% "quoted" \'single\' <tag> \\back\\ é' },
  long: { Title: LONG, Artist: 'A'.repeat(1000), Album: 'Album ' + '🎵'.repeat(200), Comment: LONG + ' end', Year: '1999', Track: '999', Disc: '999' },
  work: { Title: 'II. Adagio', Artist: 'Quartet', Composer: 'Brahms', ShowWork: true, Work: 'String Quartet No. 1 in C minor, Op. 51', Movement: 'Romanze: Poco adagio', MovementNo: '2', Compilation: true, Year: '1873' },
  spaces: { Title: '   Padded  title   ', Artist: '\tTabbed\t', Comment: '  two  spaces  inside  ', Track: ' 3 ', Year: 'c.1850s' },
  credits: { Artist: 'Only the artist' },          // the title follows the Credits title, which is set to "From the credits" for this one
  none: {},
};
const FIELDS = ['Title', 'Artist', 'AlbumArtist', 'Album', 'Year', 'Track', 'Disc', 'Composer', 'Genre', 'Comment', 'Work', 'Movement', 'MovementNo'];
// what the file must hold: each value as typed, trimmed at its ends; the number fields keep only their digits; Work, Movement, and its number only with Show work on
function expected(set, credits) {
  const e = {}; FIELDS.forEach(f => { let v = set[f] == null ? '' : String(set[f]); if (/Year|Track|Disc|MovementNo/.test(f)) v = v.replace(/\D/g, ''); v = v.trim(); if (/Work|Movement/.test(f) && !set.ShowWork) v = ''; e[f] = v; });
  if (!e.Title && credits) e.Title = credits.trim();
  e.showWork = !!set.ShowWork && !!(e.Work || e.Movement); e.compilation = !!set.Compilation; return e;
}

// ---- readers, by each format's rules ----
const u8 = b => new TextDecoder('utf-8', { fatal: true }).decode(b);
function utf16(b) { let le = true, i = 0; if (b[0] === 0xff && b[1] === 0xfe) i = 2; else if (b[0] === 0xfe && b[1] === 0xff) { le = false; i = 2; } let s = ''; for (; i + 1 < b.length; i += 2) s += String.fromCharCode(le ? b[i] | b[i + 1] << 8 : b[i] << 8 | b[i + 1]); return s; }
const cut0 = s => s.replace(/\0+$/, '');
function id3(b) {          // ID3v2.3 or 2.4 frames: text frames and COMM
  const out = {}; if (String.fromCharCode(b[0], b[1], b[2]) !== 'ID3') return { error: 'no ID3 header' };
  const ver = b[3], size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]; let o = 10; const end = 10 + size; if (end > b.length) return { error: 'ID3 size past the chunk: ' + size + ' > ' + (b.length - 10) };
  while (o + 10 <= end) {
    const id = String.fromCharCode(...b.subarray(o, o + 4)); if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const n = ver === 4 ? (b[o + 4] << 21) | (b[o + 5] << 14) | (b[o + 6] << 7) | b[o + 7] : (b[o + 4] << 24 | b[o + 5] << 16 | b[o + 6] << 8 | b[o + 7]) >>> 0, body = b.subarray(o + 10, o + 10 + n); o += 10 + n;
    const dec = (enc, x) => enc === 0 ? String.fromCharCode(...x) : enc === 1 || enc === 2 ? utf16(x) : u8(x);
    if (id === 'COMM') { const enc = body[0]; let k = 4; if (enc === 1 || enc === 2) { while (k + 1 < body.length && (body[k] || body[k + 1])) k += 2; k += 2; } else { while (k < body.length && body[k]) k++; k++; } out.COMM = cut0(dec(enc, body.subarray(k))); }
    else if (id[0] === 'T' || id === 'MVNM' || id === 'MVIN') out[id] = cut0(dec(body[0], body.subarray(1)));
  }
  return out;
}
function readWav(b) {
  const tag = (o) => String.fromCharCode(...b.subarray(o, o + 4)), le = o => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
  const head = tag(0); if ((head !== 'RIFF' && head !== 'RF64') || tag(8) !== 'WAVE') return { error: 'not a WAV' };
  const out = { info: {}, id3: null, chunks: [] }; let o = 12;
  if (head === 'RIFF' && le(4) + 8 !== b.length) out.error = 'RIFF size ' + (le(4) + 8) + ' is not the file size ' + b.length;
  while (o + 8 <= b.length) {
    const id = tag(o), n = le(o + 4), body = b.subarray(o + 8, o + 8 + n); out.chunks.push(id);
    if (o + 8 + n > b.length) { out.error = 'chunk ' + id + ' runs past the end'; break; }
    if (id === 'LIST' && tag(o + 8) === 'INFO') { let k = 4; while (k + 8 <= body.length) { const sid = String.fromCharCode(...body.subarray(k, k + 4)), sn = (body[k + 4] | body[k + 5] << 8 | body[k + 6] << 16 | body[k + 7] << 24) >>> 0; out.info[sid] = cut0(u8(body.subarray(k + 8, k + 8 + sn))); k += 8 + sn + (sn & 1); } }
    if (id === 'id3 ' || id === 'ID3 ') out.id3 = id3(body);
    o += 8 + n + (n & 1);
  }
  return out;
}
function readFlac(b) {
  if (String.fromCharCode(...b.subarray(0, 4)) !== 'fLaC') return { error: 'not FLAC' };
  let o = 4, last = false; const out = { c: {}, count: 0, blocks: [] };
  while (!last && o + 4 <= b.length) {
    last = !!(b[o] & 0x80); const type = b[o] & 0x7f, n = b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3], body = b.subarray(o + 4, o + 4 + n); out.blocks.push(type); o += 4 + n;
    if (type === 4) { const dv = new DataView(body.buffer, body.byteOffset, body.byteLength); let k = 0; const vl = dv.getUint32(k, true); k += 4; out.vendor = u8(body.subarray(k, k + vl)); k += vl; const cnt = dv.getUint32(k, true); k += 4; out.count = cnt;
      for (let i = 0; i < cnt; i++) { const l = dv.getUint32(k, true); k += 4; const s = u8(body.subarray(k, k + l)); k += l; const eq = s.indexOf('='); const key = s.slice(0, eq).toUpperCase(); if (key in out.c) out.dup = key; out.c[key] = s.slice(eq + 1); } }
  }
  if (b[o] !== 0xff || (b[o + 1] & 0xfc) !== 0xf8) out.error = 'no audio frame right after the last metadata block';
  return out;
}
function readMp4(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), out = { items: {} };
  const kids = (s, e) => { const r = []; while (s + 8 <= e) { let n = dv.getUint32(s); const t = String.fromCharCode(...b.subarray(s + 4, s + 8)); let h = 8; if (n === 1) { n = Number(dv.getBigUint64(s + 8)); h = 16; } if (n === 0) n = e - s; if (n < h || s + n > e) { out.error = 'box ' + JSON.stringify(t) + ' has a bad size'; break; } r.push({ t, s: s + h, e: s + n }); s += n; } return r; };
  const find = (list, t) => list.find(x => x.t === t);
  const moov = find(kids(0, b.length), 'moov'); if (!moov) return { error: 'no moov' };
  const udta = find(kids(moov.s, moov.e), 'udta'); if (!udta) return out;
  const meta = find(kids(udta.s, udta.e), 'meta'); if (!meta) return out;
  const mk = kids(meta.s + 4, meta.e), hdlr = find(mk, 'hdlr'); out.hdlr = hdlr && String.fromCharCode(...b.subarray(hdlr.s + 8, hdlr.s + 12));
  const ilst = find(mk, 'ilst'); if (!ilst) return out;
  kids(ilst.s, ilst.e).forEach(it => { const d = find(kids(it.s, it.e), 'data'); if (!d) return; const type = dv.getUint32(d.s) & 0xffffff, p = b.subarray(d.s + 8, d.e);
    out.items[it.t] = type === 1 ? u8(p) : it.t === 'trkn' || it.t === 'disk' ? (p[2] << 8 | p[3]) : type === 21 ? (p.length === 1 ? p[0] : p.length === 2 ? (p[0] << 8 | p[1]) : dv.getUint32(d.s + 8)) : Array.from(p); });
  return out;
}
// what each format must hold for the expected tags: [where, key, value]
function wants(fmt, e) {
  const r = [], add = (k, v) => r.push([k, v]);
  if (fmt.startsWith('wav')) {
    [['INAM', e.Title], ['IART', e.Artist], ['IPRD', e.Album], ['ICRD', e.Year], ['IGNR', e.Genre], ['ICMT', e.Comment], ['ITRK', e.Track]].forEach(([k, v]) => add('info.' + k, v));
    [['TIT2', e.Title], ['TPE1', e.Artist], ['TPE2', e.AlbumArtist], ['TCOM', e.Composer], ['TALB', e.Album], ['TYER', e.Year], ['TRCK', e.Track], ['TPOS', e.Disc], ['TIT1', e.Work], ['MVNM', e.Movement], ['MVIN', e.MovementNo], ['TCON', e.Genre], ['TCMP', e.compilation ? '1' : ''], ['COMM', e.Comment]].forEach(([k, v]) => add('id3.' + k, v));
  } else if (fmt.startsWith('flac')) {
    [['TITLE', e.Title], ['ARTIST', e.Artist], ['ALBUMARTIST', e.AlbumArtist], ['ALBUM', e.Album], ['DATE', e.Year], ['TRACKNUMBER', e.Track], ['DISCNUMBER', e.Disc], ['COMPOSER', e.Composer], ['WORK', e.Work], ['MOVEMENTNAME', e.Movement], ['MOVEMENT', e.MovementNo], ['GENRE', e.Genre], ['COMMENT', e.Comment], ['COMPILATION', e.compilation ? '1' : ''], ['SHOWMOVEMENT', e.showWork ? '1' : '']].forEach(([k, v]) => add('c.' + k, v));
  } else {
    [['©nam', e.Title], ['©ART', e.Artist], ['aART', e.AlbumArtist], ['©alb', e.Album], ['©day', e.Year], ['©wrt', e.Composer], ['©wrk', e.Work], ['©mvn', e.Movement], ['©gen', e.Genre], ['©cmt', e.Comment]].forEach(([k, v]) => add('items.' + k, v));
    [['trkn', +e.Track || ''], ['disk', +e.Disc || ''], ['©mvi', +e.MovementNo || ''], ['shwm', e.showWork ? 1 : ''], ['cpil', e.compilation ? 1 : '']].forEach(([k, v]) => add('items.' + k, v));
  }
  return r;
}
const get = (o, p) => p.split('.').reduce((a, k) => a == null ? undefined : a[k], o);
function compare(fmt, got, e) {
  const bad = [];
  wants(fmt, e).forEach(([p, v]) => { const g = get(got, p); if (v === '' ? g !== undefined : g !== v) bad.push(p + ': ' + JSON.stringify(g === undefined ? '(missing)' : String(g).slice(0, 60)) + ' want ' + JSON.stringify(v === '' ? '(none)' : String(v).slice(0, 60))); });
  return bad;
}
function probeTags(file) { const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format_tags:format=duration', '-of', 'json', file], { encoding: 'utf8' })); const t = {}; Object.entries((j.format && j.format.tags) || {}).forEach(([k, v]) => { t[k.toLowerCase()] = v; }); return { t, dur: j.format && +j.format.duration }; }
function ffErrors(file) { try { return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return String(e.stderr || e.message).trim().slice(0, 200); } }

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const open = async (file, disk) => {
    const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.errs = [];
    p.on('pageerror', e => p.errs.push((e.stack || e).toString().slice(0, 200))); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text().slice(0, 200)); });
    await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=' + disk);
    await p.setInputFiles('#audioIn', FX + '/' + file); await p.waitForFunction(() => S.audio, null, { timeout: 60000 });
    await p.waitForFunction(() => S.audio.buffer ? (tpGet(S.audio.buffer, S.audio.peaks), TPK.get(S.audio.buffer).tp) : S.audio.tp, null, { timeout: 60000 }); await p.waitForTimeout(300);
    await p.evaluate(() => document.querySelector('[data-audio]').click()); await p.waitForTimeout(700);
    await p.evaluate(() => { window.saveFile = async (blob, name) => { const ab = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < ab.length; i += 30000) s += String.fromCharCode.apply(null, ab.subarray(i, i + 30000)); window.__saved = { name, size: ab.length, b64: btoa(s) }; }; });
    return p;
  };
  const typeTags = (p, set, credits) => p.evaluate(({ set, credits, FIELDS }) => {
    S.credits.title = credits || ''; const tc = document.querySelector('#credTitle'); if (tc) tc.value = S.credits.title;
    const sw = document.querySelector('#aeTagShowWork'), cp = document.querySelector('#aeTagCompilation');
    if (sw.checked !== !!set.ShowWork) { sw.checked = !!set.ShowWork; sw.dispatchEvent(new Event('change', { bubbles: true })); }
    if (cp.checked !== !!set.Compilation) { cp.checked = !!set.Compilation; cp.dispatchEvent(new Event('change', { bubbles: true })); }
    FIELDS.forEach(f => { const el = document.querySelector('#aeTag' + f); el.value = set[f] || ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    return { shown: document.querySelector('#aeMetaVal').textContent };
  }, { set, credits, FIELDS });
  const exportAs = async (p, fmt) => {
    await p.evaluate(fmt => { window.__saved = null; Object.assign(AE.d, { normalize: false, limiter: false, gainDb: 0, vStart: 0, vEndSet: null }); S.set.audioFormat = fmt; S.set.audioRate = 0; aeRefresh(); }, fmt);
    for (let i = 0; i < 80; i++) { if (await p.evaluate(() => { const d = AE.d; return fxActive(d.fx, fxChannels()).length ? !!fxPeek(d.fx) : true; })) break; await p.waitForTimeout(250); }
    await p.evaluate(() => aeExport()); for (let i = 0; i < 240; i++) { if (await p.evaluate(() => !!window.__saved)) break; await p.waitForTimeout(250); }
    const s = await p.evaluate(() => window.__saved); if (!s) return null;
    const bytes = Buffer.from(s.b64, 'base64'); return { name: s.name, bytes };
  };
  const durOf = (p, bytes) => p.evaluate(async b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); try { const ab = await new AudioContext().decodeAudioData(u.buffer); return ab.duration; } catch (e) { return 'error: ' + e.message; } }, bytes.toString('base64'));
  let n = 0;
  const check = async (p, label, src, fmt, setName) => {
    const set = SETS[setName], credits = setName === 'credits' ? 'From the credits' : '', e = expected(set, credits);
    const shown = await typeTags(p, set, credits), r = await exportAs(p, fmt), tag = label + ' ' + src + ' → ' + fmt + ', ' + setName;
    if (!r) { ok(tag + ': exported', false, 'no file'); return; }
    const file = path.join(KEEP, String(++n).padStart(3, '0') + '-' + src.replace(/\W+/g, '_') + '-' + fmt + '-' + setName + '-' + label.replace(/\W+/g, '') + path.extname(r.name)); fs.writeFileSync(file, r.bytes);
    const got = fmt.startsWith('wav') ? readWav(r.bytes) : fmt.startsWith('flac') ? readFlac(r.bytes) : readMp4(r.bytes), any = setName !== 'none';
    const bad = compare(fmt, got, e);
    if (got.error) bad.unshift('file: ' + got.error); if (got.dup) bad.push('the key ' + got.dup + ' is written twice');
    if (fmt.startsWith('wav') && got.id3 && got.id3.error) bad.push('id3: ' + got.id3.error);
    if (!any) { if (fmt.startsWith('wav') && (got.chunks.includes('LIST') || got.chunks.includes('id3 '))) bad.push('tag chunks in an untagged file: ' + got.chunks.join(',')); if (fmt.startsWith('flac') && got.blocks.includes(4)) bad.push('a comment block in an untagged file'); if (fmt.startsWith('m4a') && Object.keys(got.items).length) bad.push('ilst items in an untagged file'); }
    if (fmt.startsWith('m4a') && any && got.hdlr !== 'mdir') bad.push('meta handler ' + got.hdlr);
    ok(tag + ': every tag reads back exactly as typed', !bad.length, bad.slice(0, 4).join(' | ') + (bad.length > 4 ? ' …+' + (bad.length - 4) : ''));
    ok(tag + ': the field says ' + (any ? 'Added' : 'nothing'), shown.shown === (any ? 'Added' : ''), JSON.stringify(shown.shown));
    const d = await durOf(p, r.bytes), want = await p.evaluate(() => audLen() / audSr());
    ok(tag + ': the sound still plays in full', typeof d === 'number' && Math.abs(d - want) < 0.06, 'decoded ' + d + 's, source ' + want + 's');
    if (ffprobe) {
      const pr = probeTags(file), errs = ffErrors(file), map = { title: e.Title, artist: e.Artist, album: e.Album, composer: e.Composer, genre: e.Genre, comment: e.Comment };
      const pbad = Object.entries(map).filter(([k, v]) => v && !(fmt.startsWith('wav') && (k === 'composer')) && pr.t[k] !== v).map(([k, v]) => k + ': ' + JSON.stringify((pr.t[k] || '(missing)').slice(0, 50)) + ' want ' + JSON.stringify(v.slice(0, 50)));
      ok(tag + ': ffprobe reads the same tags and the file decodes with no errors', !pbad.length && !errs, pbad.slice(0, 3).join(' | ') + (errs ? ' errors: ' + errs : ''));
    }
  };
  const FMTS = ['wav', 'wav24', 'wav32', 'flac16', 'flac24', 'm4a128', 'm4a320'];
  // every tag set in every format, from a 24-bit stereo WAV
  { const p = await open('s24.wav', 0); for (const s of Object.keys(SETS)) for (const f of FMTS) await check(p, 'memory', 's24.wav', f, s); ok('s24.wav: no page errors', !p.errs.length, p.errs.slice(0, 2).join(' | ')); await p.close(); }
  // other kinds of source, with the hardest values
  for (const src of ['mono.wav', 'loud.mp3', 'u8.wav', 'f64.wav', 'rf64.wav', 'stereo.wav', 'surround.wav']) { const p = await open(src, 0); for (const f of ['wav24', 'flac16', 'm4a256']) await check(p, 'memory', src, f, 'unicode'); ok(src + ': no page errors', !p.errs.length, p.errs.slice(0, 2).join(' | ')); await p.close(); }
  // from the disk store
  { const p = await open('s24.wav', 1); ok('the recording is on the store', await p.evaluate(() => !!S.audio.disk && !S.audio.buffer)); for (const f of ['wav', 'wav24', 'wav32', 'flac24', 'm4a256']) for (const s of ['unicode', 'long', 'work']) await check(p, 'store', 's24.wav', f, s); ok('store: no page errors', !p.errs.length, p.errs.slice(0, 2).join(' | ')); await p.close(); }
  console.log('kept ' + n + ' files in ' + KEEP + (ffprobe ? '' : ' (ffprobe not found: its checks were skipped)'));
  await b.close();
})();
