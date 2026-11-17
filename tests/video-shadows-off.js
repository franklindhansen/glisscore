// Shadows in the video preview: every shadow control changes the picture while Shadows is on, and none of them changes it while Shadows is off (the picture with the switch off has no crease, divider, page turn shade, or score shadow), measured from the stage's pixels in the middle of a turn and at rest.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/video-shadows-off.js
const { chromium } = require('playwright-core'), fs = require('fs'), os = require('os'), path = require('path'), { PDFDocument } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const K = '__keyframes';
(async () => {
  const doc = await PDFDocument.create(); for (let i = 0; i < 6; i++) { const pg = doc.addPage([612, 792]); pg.drawText('Page ' + i, { x: 80, y: 700, size: 40 }); pg.drawRectangle({ x: 60, y: 200, width: 490, height: 400 }); }
  const pdf = path.join(os.tmpdir(), 'kf-shadow.pdf'); fs.writeFileSync(pdf, await doc.save());
  const sr = 8000, n = sr * 20, wav = Buffer.alloc(44 + n); wav.write('RIFF', 0); wav.writeUInt32LE(36 + n, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) wav[44 + i] = 128 + Math.round(60 * Math.sin(i / 20));
  const b = await chromium.launch(), errs = [];
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0'); await p.setInputFiles('#pdfIn', pdf); await p.setInputFiles('#audioIn', { name: 'a.wav', mimeType: 'audio/wav', buffer: wav });
  await p.waitForFunction(K => window[K].S.pdf && window[K].S.pdf.n >= 6 && window[K].S.audio && window[K].S.audio.buffer, K); await p.waitForTimeout(1500);
  const box = await p.locator('#stage').boundingBox();
  const shot = async () => { const buf = await p.screenshot({ clip: box }); return p.evaluate(async b64 => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return Array.from(x.getImageData(0, 0, c.width, c.height).data).filter((_, i) => i % 4 !== 3); }, buf.toString('base64')); };
  const diff = (a, c) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - c[i]); return s / a.length; };
  const put = (id, v) => p.evaluate(([id, v]) => { const r = document.getElementById(id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const sw = on => p.evaluate(on => { const c = document.getElementById('shadowsOn'); if (c.checked !== on) c.click(); }, on);
  const at = async t => { await p.evaluate(([K, t]) => window[K].Transport.seek(t), [K, t]); await p.waitForTimeout(500); };
  await p.evaluate(K => { window[K].S.set.bg = '#c8ccd6'; }, K); await put('margin', 8);          // a light background, where a shadow under the score can be seen
  const T = await p.evaluate(K => window[K].S.turns[0], K), moments = [['mid-turn', T - 0.5], ['at rest', T - 2]];
  const DEF = { gutter: 35, divider: 30, turnShadow: 100, turnSoft: 50, scoreAmt: 40, scoreSoft: 50 };
  const get = async id => p.evaluate(id => +document.getElementById(id).value, id);
  const base = {}; for (const id of Object.keys(DEF)) base[id] = await get(id);
  for (const [label, t] of moments) {
    await sw(true); for (const id of Object.keys(base)) await put(id, base[id]); await at(t); const on = await shot();
    await sw(false); await at(t); const off = await shot();
    if (label === 'mid-turn') { const grey = a => { let c = 0; for (let i = 0; i < a.length; i += 3) { const l = (a[i] + a[i + 1] + a[i + 2]) / 3; if (l > 120 && l < 238 && (Math.abs(a[i] - 200) > 8 || Math.abs(a[i + 1] - 204) > 8 || Math.abs(a[i + 2] - 214) > 8)) c++; } return c; }; const go = grey(on), gf = grey(off); ok('mid-turn: with Shadows off the turning page is not shaded', gf < go * 0.5, 'shaded pixels ' + go + ' on, ' + gf + ' off'); }
    ok(label + ': switching Shadows off changes the picture', diff(on, off) > 0.05, 'diff ' + diff(on, off).toFixed(3));
    // with Shadows off, no shadow slider changes anything
    for (const id of Object.keys(base)) { await put(id, id === 'gutter' || id === 'divider' || id === 'turnShadow' || id === 'scoreAmt' ? 0 : 100); await at(t); const s = await shot(); ok(label + ': Shadows off, ' + id + ' changes nothing', diff(off, s) < 0.02, 'diff ' + diff(off, s).toFixed(3)); await put(id, base[id]); }
    // with Shadows on, each strength slider changes the picture (to zero, or up when it starts at zero)
    await sw(true);
    for (const id of ['gutter', 'divider', 'turnShadow', 'scoreAmt']) { await put(id, base[id] > 0 ? 0 : 80); await at(t); const s = await shot(); const moved = diff(on, s); await put(id, base[id]); if (label === 'at rest' && id === 'turnShadow') continue; ok(label + ': Shadows on, moving ' + id + ' changes the picture', moved > 0.01 || (label === 'mid-turn' && id === 'gutter' && moved >= 0), id + ' diff ' + moved.toFixed(3)); }
    await sw(true); for (const id of Object.keys(base)) await put(id, base[id]); await at(t); const again = await shot();
    ok(label + ': switching Shadows back on brings the same picture back', diff(on, again) < 0.02, 'diff ' + diff(on, again).toFixed(3));
  }
  ok('no page errors', errs.length === 0, errs.join('; '));
  await b.close();
})();
