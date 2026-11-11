// Opens the app in Chromium with no server (every file is read from disk) to measure or picture a screen.
//   node tests/probe.js --open audio --tool level --size 1440x760 --shot /tmp/level.png
//   node tests/probe.js --open audio --tool imager --run "document.querySelector('.im-scope').getBoundingClientRect().height"
//   node tests/probe.js --open pdf --tool crop --dark --shot /tmp/crop.png --sel '#pdfDlg .dlg'
// Options: --size WxH (1280x800)  --audio FILE (loud.mp3)  --pdf FILE (score.pdf)  --open audio|pdf  --tool NAME  --dark
//          --wait MS (800)  --run EXPR  --run-file FILE  --shot FILE  --sel SELECTOR (the open dialog, else the page)
// FILE for --audio and --pdf is a name in tests/fixtures or a path. --run prints the expression's value as JSON; it may be async.
const fs = require('fs'), path = require('path');
module.paths.push(path.join(process.env.HOME || '', 'keyframes-tests/node_modules'));
const { chromium } = require('playwright-core');
const ROOT = path.join(__dirname, '..'), FIX = path.join(ROOT, process.env.S || 'tests/fixtures');
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', json: 'application/json', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', pdf: 'application/pdf', wasm: 'application/wasm' };
const a = { size: '1280x800', audio: 'loud.mp3', pdf: 'score.pdf', wait: '800' }, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); if (k === 'help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 8).join('\n')); process.exit(0); } if (k === 'dark') a.dark = true; else a[k.replace(/-(\w)/g, (m, c) => c.toUpperCase())] = argv[++i]; }
const file = n => fs.existsSync(n) ? path.resolve(n) : path.join(FIX, n);
(async () => {
  const [w, h] = a.size.split('x').map(Number), b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: a.dark ? 'dark' : 'light' }); p.setDefaultTimeout(60000);
  p.on('pageerror', e => console.error('page error: ' + e.message));
  await p.route('http://localhost:8123/**', r => { const f = path.join(ROOT, decodeURIComponent(new URL(r.request().url()).pathname)); try { r.fulfill({ body: fs.readFileSync(f), contentType: TYPES[f.split('.').pop()] || 'application/octet-stream' }); } catch (e) { r.fulfill({ status: 404, body: '' }); } });
  await p.goto('http://localhost:8123/index.html?disk=0');
  if (a.dark) await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const wait = +a.wait;
  if (a.open === 'pdf' || argv.includes('--pdf')) { await p.setInputFiles('#pdfIn', file(a.pdf)); await p.waitForTimeout(2000); }
  if (a.open !== 'pdf' || argv.includes('--audio')) { await p.setInputFiles('#audioIn', file(a.audio)); await p.waitForFunction(() => typeof S !== 'undefined' && S.audio && S.audio.buffer); }
  if (a.open === 'audio') { await p.evaluate(() => openAudioEditor()); await p.waitForTimeout(500); if (a.tool) await p.evaluate(t => aeTool(t), a.tool); }
  if (a.open === 'pdf') { await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1500); if (a.tool) await p.evaluate(t => peTool(t), a.tool); }
  await p.waitForTimeout(wait);
  const code = a.runFile ? fs.readFileSync(a.runFile, 'utf8') : a.run;
  if (code) console.log(JSON.stringify(await p.evaluate(c => (0, eval)('(async () => (' + c + '\n))()'), code), null, 1));
  if (a.shot) { const sel = a.sel || (a.open === 'audio' ? '#audioDlg .dlg' : a.open === 'pdf' ? '#pdfDlg .dlg' : null); if (sel) await p.locator(sel).first().screenshot({ path: a.shot }); else await p.screenshot({ path: a.shot }); console.log('saved ' + a.shot); }
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
