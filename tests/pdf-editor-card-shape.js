// A page card takes its own page's shape after rotation: a portrait page turned 90° shows wide and fills its card, with no white bars.
// The pages are fully red, so a white pixel at a card's edge or corner means the picture does not fill it.
// Run with the app served on port 8123:  NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-card-shape.js
const { chromium } = require('playwright-core');
const { PDFDocument, rgb } = require('../vendor/pdf-lib.min.js');
const ok = (name, pass, info = '') => console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : ''));
(async () => {
  const mk = await PDFDocument.create(); for (let i = 0; i < 5; i++) mk.addPage([612, 792]).drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(.8, 0, 0) });
  const pdf = Buffer.from(await mk.save());
  const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1300, height: 900 } }); p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:' + (process.env.PORT || 8123) + '/index.html'); await p.setInputFiles('#pdfIn', { name: 'red.pdf', mimeType: 'application/pdf', buffer: pdf }); await p.waitForFunction(() => S.pdf);
  await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200);
  const card = id => p.evaluate(id => {
    const c = document.querySelector('#peGrid .page-card[data-id="' + id + '"] canvas'), r = c.getBoundingClientRect(), x = c.getContext('2d'), px = (a, b) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3));
    const w = c.width, h = c.height; return { w, h, shown: [Math.round(r.width), Math.round(r.height)], corners: [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3)] };
  }, id);
  const red = c => c.corners.every(q => q[0] > 150 && q[1] < 60 && q[2] < 60);
  const turn = () => p.evaluate(() => document.querySelector('#peGrid .page-card[data-id="0"] [data-act=rot]').click());
  let a = await card(0), s = await card(1);
  ok('a portrait page starts as a tall card filling its card', a.h > a.w && red(a), JSON.stringify(a));
  await turn(); await p.waitForTimeout(900);
  a = await card(0); s = await card(1);
  ok('a page turned 90° shows as a wide card', a.w > a.h && a.shown[0] > a.shown[1], JSON.stringify(a));
  ok('the turned page fills its wide card to every corner', red(a), JSON.stringify(a.corners));
  ok('its neighbor stays a tall card', s.h > s.w, JSON.stringify(s));
  const line = () => p.evaluate(() => [0, 1].map(id => { const c = document.querySelector('#peGrid .page-card[data-id="' + id + '"]'), t = c.querySelector('canvas').getBoundingClientRect(), f = c.querySelector('.pe-foot').getBoundingClientRect(); return [Math.round(t.top + t.height / 2), Math.round(f.top)]; }));
  const ln = await line(); ok('a wide card shares a row centerline and number line with its tall neighbor', Math.abs(ln[0][0] - ln[1][0]) <= 1 && ln[0][1] === ln[1][1], JSON.stringify(ln));
  await turn(); await p.waitForTimeout(100);
  const moving = await p.evaluate(() => document.querySelector('#peGrid .page-card[data-id="0"] canvas').getAnimations().length);
  ok('turning a page swings its picture into the new shape', moving > 0, String(moving)); await p.waitForTimeout(800);
  a = await card(0); ok('turned a second time (180°) it is tall again and filled', a.h > a.w && red(a), JSON.stringify(a));
  // reordering with a wide card in the row: the drag moves the right card, the wide one stays wide, and the numbers and ticks follow
  await turn(); await p.waitForTimeout(900);
  const row = () => p.evaluate(() => ({ order: PE.d.order.join(), dom: [...document.querySelectorAll('#peGrid .page-card')].map(c => c.dataset.id).join(), wide: [...document.querySelectorAll('#peGrid .page-card canvas')].map(c => c.width > c.height ? 1 : 0).join(''), pos: [...document.querySelectorAll('#peGrid .page-card .pe-pos')].map(e => e.textContent.trim()).join() }));
  const before = await row(); ok('a wide card sits in a row of tall ones', before.wide === '10000', JSON.stringify(before));
  const at = id => p.evaluate(id => { const r = document.querySelector('#peGrid .page-card[data-id="' + id + '"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 3, r.x]; }, id);
  const from = await at(3), to = await at(0);
  await p.mouse.move(from[0], from[1]); await p.mouse.down(); await p.mouse.move(to[2] + 8, to[1], { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(1200);
  const after = await row();
  ok('dragging page 4 to the front puts it first', after.order.split(',')[0] === '3' && after.order !== before.order, JSON.stringify(after));
  ok('the cards are in the new order', after.dom === after.order, JSON.stringify(after));
  ok('the turned page is still the wide card, wherever it moved', after.dom.split(',').map(i => after.wide[after.dom.split(',').indexOf(i)]).join('') === after.wide && after.wide.split('').filter(c => c === '1').length === 1 && after.wide[after.dom.split(',').indexOf('0')] === '1', JSON.stringify(after));
  // the other tools with the turned page in the row
  const shape0 = () => p.evaluate(() => { const c = document.querySelector('#peGrid .page-card[data-id="0"] canvas'); const d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return [c.width, c.height, PE.mode, PE.d.slots[0].rot, d[0] < 255 || d[1] < 255]; });
  for (const t of ['crop', 'split', 'resize', 'pages']) { await p.click('#peRail .pe-tab[data-tool=' + t + ']'); await p.waitForTimeout(1500); const z = await shape0(); ok('in ' + t + ' the turned page is still a wide card with its picture', z[0] > z[1] && z[3] === 270 && z[4], JSON.stringify(z)); }
  // the exported file is unchanged by the card shape: same sizes, and only the turned page carries a turn
  const exported = async () => { const bytes = await p.evaluate(async () => { let out = null; window.saveFile = async blob => { out = Array.from(new Uint8Array(await blob.arrayBuffer())); }; document.querySelector('#peExport').click(); for (let i = 0; i < 100 && !out; i++) await new Promise(r => setTimeout(r, 100)); return out; }); return await PDFDocument.load(Uint8Array.from(bytes)); };
  let doc = await exported(), pg = doc.getPages();
  ok('export: five pages of the original size', pg.length === 5 && pg.every(g => Math.round(g.getWidth()) === 612 && Math.round(g.getHeight()) === 792), pg.map(g => [Math.round(g.getWidth()), Math.round(g.getHeight())].join('x')).join());
  ok('export: only the turned page, now second after the drag, carries its 270° turn', pg.map(g => g.getRotation().angle).join() === '0,270,0,0,0', pg.map(g => g.getRotation().angle).join());
  // Re-size with the turned page in the row
  await p.click('#peRail .pe-tab[data-tool=resize]'); await p.waitForTimeout(700); await p.click('.rz-opt[data-k=tabloid]'); await p.waitForTimeout(300); await p.click('#peRzGo'); await p.waitForTimeout(1500);
  const rz = await shape0(); ok('after Re-size the turned page is still a wide card with its picture', rz[0] > rz[1] && rz[4], JSON.stringify(rz));
  doc = await exported(); pg = doc.getPages();
  ok('export after Re-size: every page is Tabloid', pg.length === 5 && pg.every(g => [Math.round(g.getWidth()), Math.round(g.getHeight())].join() === '792,1224' || [Math.round(g.getWidth()), Math.round(g.getHeight())].join() === '1224,792'), pg.map(g => [Math.round(g.getWidth()), Math.round(g.getHeight())].join('x')).join());
  ok('no script errors', errs.length === 0, errs.join(' | ')); await b.close();
})();
