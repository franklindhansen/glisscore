// PDF Editor on a long dense scan (220 pages, each its own 300 dpi picture): opening it and running Clean, Re-kilter, Crop and Re-size on every page must not use so much memory that the browser reloads the tab.
// Memory is the resident size of the browser's own processes. Run with the app served on port 8123, in Chromium or Safari's engine:
//   BROWSER=webkit NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-large-scan.js [pages]
const pw = require('playwright-core'), { execSync } = require('child_process'), fs = require('fs'), { makeLargeScan } = require('./make-large-scan.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
const rssMB = (root, which) => { const rows = execSync('ps -axo pid=,ppid=,rss=,command=').toString().trim().split('\n').map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/); return m && [+m[1], +m[2], +m[3], m[4]]; }).filter(Boolean);
  if (which === 'webkit') return Math.round(rows.filter(r => /ms-playwright\/webkit-/.test(r[3])).reduce((a, r) => a + r[2], 0) / 1024);          // WebKit starts its page process outside our process tree: count the Playwright WebKit build's own processes
  const kids = new Map(); rows.forEach(([pid, pp, rss]) => kids.set(pid, { pp, rss }));
  const under = pid => { let n = pid; for (let i = 0; i < 12 && n > 1; i++) { if (n === root) return true; const k = kids.get(n); if (!k) return false; n = k.pp; } return n === root; };
  return Math.round(rows.filter(([pid]) => under(pid)).reduce((a, r) => a + r[2], 0) / 1024); };
(async () => {
  const pages = +process.argv[2] || 220, file = await makeLargeScan(pages), which = process.env.BROWSER || 'chromium', srv = await pw[which].launchServer({ args: which === 'chromium' ? ['--enable-precise-memory-info'] : [] }), root = srv.process().pid, b = await pw[which].connect(srv.wsEndpoint());
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(600000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const peak = { v: 0 }, step = {}; const timer = setInterval(() => { try { peak.v = Math.max(peak.v, rssMB(root, which)); } catch (e) {} }, 500);
  const mark = async name => { await p.waitForTimeout(+process.env.SETTLE || 300); const now = rssMB(root, which); const done = await p.evaluate(() => PE.d ? { cards: document.querySelectorAll('#peGrid .page-card').length, cleaned: PE.d.order.filter(id => PE.d.slots[id].bg || PE.d.slots[id].sp).length, tilted: PE.d.order.filter(id => PE.d.slots[id].skew || PE.d.slots[id].vskew || PE.d.slots[id].warp).length, cropped: PE.d.order.filter(id => PE.d.slots[id].crop).length, size: JSON.stringify(PE.d.size) } : null); const caches = await p.evaluate(() => ({ thumbs: S.thumbs ? S.thumbs.filter(Boolean).length : 0, VT: VT.size, full: PE.full ? PE.full.size : 0, cropScans: PE.cropScans ? PE.cropScans.size : 0, raw: PE.raw ? PE.raw.size : 0, jsHeapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null })); console.log('   caches: ' + JSON.stringify(caches)); console.log('   pages touched: ' + JSON.stringify(done)); step[name] = { now, peak: peak.v }; console.log('MEM ' + name + ': now ' + now + ' MB, peak so far ' + peak.v + ' MB'); };
  const idle = () => p.waitForFunction(() => !PE.busy, null, { timeout: 600000 });
  await p.goto('http://127.0.0.1:' + (process.env.PORT || 8123) + '/index.html'); await mark('start');
  await p.setInputFiles('#pdfIn', file); await p.waitForFunction(n => S.pdf && S.pdf.n === n, pages); await p.waitForTimeout(1500); await mark('loaded ' + (fs.statSync(file).size / 1e6 | 0) + ' MB file');
  await p.evaluate(() => openPdfEditor()); await p.waitForFunction(() => document.querySelectorAll('#peGrid .page-card').length > 0); await p.waitForTimeout(3000); await mark('editor open');
  await p.evaluate(() => peTool('clean')); await p.waitForTimeout(1500); await p.click('#peCleanGo'); await p.waitForTimeout(500); await idle(); await mark('Clean all');
  await p.evaluate(() => peTool('skew')); await p.waitForTimeout(1500); await p.click('#peSkewGo'); await p.waitForTimeout(500); await idle(); await mark('Re-kilter all');
  await p.evaluate(() => peTool('crop')); await p.waitForTimeout(1500); await p.evaluate(() => peCropRead && 0); await p.waitForFunction(() => !document.querySelector('#peCropAuto').disabled, null, { timeout: 600000 }).catch(() => {}); await p.click('#peCropAuto'); await p.waitForTimeout(500); await idle(); await mark('Crop all');
  await p.evaluate(() => peTool('resize')); await p.waitForTimeout(800); await p.evaluate(() => peSetSize({ w: 11, h: 17 }, false)); await p.waitForTimeout(4000); await mark('Re-size all');
  // what the app itself holds, counted in page pictures (the same every run, unlike the browser's memory): thumbnails, remembered page pictures, and the pictures on the page cards
  const held = () => p.evaluate(() => { const mb = c => c && c.width ? c.width * c.height * 4 / 1048576 : 0, sum = a => a.reduce((x, c) => x + mb(c), 0), cards = [...document.querySelectorAll('#peGrid .page-card canvas')];
    return { MB: Math.round(sum(S.thumbs.filter(Boolean)) + sum([...VT.values()].filter(v => v && v.width)) + sum([...PE.full.values()].filter(v => v && v.width)) + sum(cards)), drawn: cards.filter(c => c.width > 1).length, cards: cards.length }; });
  await p.evaluate(() => { PE.mode = 'pages'; peTool('pages'); }); await p.waitForTimeout(1500);
  const h1 = await held(); console.log('HELD ' + JSON.stringify(h1));
  ok('Page cards far from the view hold no picture (' + h1.drawn + ' of ' + h1.cards + ' drawn)', h1.cards === pages && h1.drawn < pages / 2 && h1.drawn >= 10, JSON.stringify(h1));
  ok('Pictures the app holds stay under 100 MB', h1.MB <= 100, h1.MB + ' MB');
  await p.evaluate(() => { const w = document.querySelector('#peWrap'); w.scrollTop = w.scrollHeight; }); await p.waitForTimeout(1500);
  const end = await p.evaluate(() => { const cs = [...document.querySelectorAll('#peGrid .page-card canvas')]; return { last: cs[cs.length - 1].width > 1, first: cs[0].width > 1 }; });
  ok('Scrolling to the end draws the last page and frees the first', end.last && !end.first, JSON.stringify(end));
  clearInterval(timer); const worst = Math.max(peak.v, ...Object.values(step).map(s => s.now));
  console.log('PEAK ' + worst + ' MB');
  if (process.env.BUDGET_MB) ok('Peak memory stays under ' + process.env.BUDGET_MB + ' MB', worst <= +process.env.BUDGET_MB, worst + ' MB');
  ok('No script errors', errs.length === 0, errs.join(' | ')); await b.close(); await srv.close();
})();
