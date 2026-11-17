// Clean, Crop, and Arrange show their controls in two equal cards on the shared card row (the one Watermark and Re-size use), and the cards stack at the same width as Watermark's.
// Crop's second card holds Margin (label, slider, value) and Keep frame on one center line with a wide gap; its Frame choice is as wide as Clean's Paper choice; the tool's band still fits.
// Run with the app served on port 8123:  S=tests/fixtures NODE_PATH=$HOME/keyframes-tests/node_modules node tests/pdf-editor-cards.js
const { chromium } = require('playwright-core');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const URL = 'http://localhost:' + (process.env.PORT || 8123) + '/index.html?disk=0', FX = process.env.S || 'tests/fixtures';
(async () => {
  const b = await chromium.launch(), errs = [];
  for (const [w, h, dark] of [[1300, 900, false], [1300, 900, true], [760, 800, false], [420, 800, false], [420, 800, true]]) {
    const p = await b.newPage({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light' }); p.setDefaultTimeout(60000); p.on('pageerror', e => errs.push(e.message)); const tag = ' (' + w + (dark ? ' dark' : '') + ')';
    await p.goto(URL); await p.setInputFiles('#pdfIn', FX + '/score.pdf'); await p.waitForFunction(() => S.pdf); await p.evaluate(() => openPdfEditor()); await p.waitForTimeout(1200);
    const measure = async tool => { await p.evaluate(t => peTool(t), tool); await p.waitForTimeout(700); return p.evaluate(t => {
      const v = document.querySelector('.pe-tv[data-tool=' + t + ']'), cards = [...v.querySelectorAll('.pe-cards>.ae-card')], r = e => e.getBoundingClientRect(), band = document.getElementById('peBand');
      return { n: cards.length, rows: cards.map(c => [r(c).left, r(c).top, r(c).width, r(c).height]), ctl: [...v.querySelectorAll('.pe-cards .seg, .pe-cards select')].map(e => r(e).width), loose: v.querySelectorAll('.pe-row').length, fit: band.scrollHeight <= band.clientHeight + 1, side: band.scrollWidth <= band.clientWidth + 1 };
    }, tool); };
    const res = {}; for (const t of ['clean', 'crop', 'pages', 'wm']) res[t] = await measure(t);
    const stacked = c => Math.abs(c.rows[0][1] - c.rows[1][1]) > 2;
    for (const t of ['clean', 'crop', 'pages']) {
      const c = res[t]; ok(t + ': two cards on the shared row and no loose controls' + tag, c.n === 2 && c.loose === 0, JSON.stringify([c.n, c.loose]));
      ok(t + ': the cards are equal' + (stacked(c) ? ' (stacked)' : '') + tag, Math.abs(c.rows[0][2] - c.rows[1][2]) <= 1 && (stacked(c) || Math.abs(c.rows[0][3] - c.rows[1][3]) <= 1), JSON.stringify(c.rows));
      ok(t + ': stacks at the same width as Watermark' + tag, stacked(c) === stacked(res.wm), stacked(c) + ' vs ' + stacked(res.wm));
      ok(t + ': the tool band fits' + tag, c.fit && c.side);
    }
    const subs = []; for (const t of ['pages', 'clean', 'skew', 'crop', 'dim', 'split', 'resize', 'wm']) { await p.evaluate(t => peTool(t), t); await p.waitForTimeout(400); subs.push(await p.evaluate(() => { const v = document.querySelector('.pe-tv:not([hidden])'), e = v.querySelector('.pe-sub:not(.warn)'), dlg = document.querySelector('#pdfDlg .dlg').getBoundingClientRect().width; return { t: v.dataset.tool, shown: !!e && getComputedStyle(e).display !== 'none', narrow: dlg <= 744, lead: v.querySelector('.pe-phead').getBoundingClientRect().height > 0 && getComputedStyle(v.querySelector('.pe-phead')).display !== 'none' }; })); }
    ok('the tool subtitle gets no row of its own once the tool list is a selector, and shows beside the tool name above that' + tag, subs.every(x => x.narrow ? !x.shown : x.shown), JSON.stringify(subs.filter(x => x.narrow ? x.shown : !x.shown)));
    await p.evaluate(() => peTool('clean')); await p.waitForTimeout(500);
    const paper = await p.evaluate(() => document.querySelector('#peClBgL').parentElement.querySelector('.seg').getBoundingClientRect().width);
    await p.evaluate(() => peTool('crop')); await p.waitForTimeout(500);
    const crop = await p.evaluate(() => { const r = e => e.getBoundingClientRect(), c = e => (r(e).top + r(e).bottom) / 2, fr = document.querySelector('.pe-cmode'), card = document.querySelector('#peCropPadF').closest('.ae-card'), m = document.querySelector('#peCropPadF'), k = document.querySelector('#peCropSameF'); return { frame: r(fr).width, label: document.querySelector('#peCropModeL').textContent, line: Math.abs(c(m) - c(k)) , gap: r(k).left - r(m).right, oneLine: r(m.querySelector('output')).top < r(m).bottom && r(m.querySelector('span')).top < r(m).bottom - 4, inCard: card.contains(k), sl: r(m.querySelector('input')).width }; });
    ok('Crop: Frame is a labeled choice as wide as Paper' + tag, crop.label === 'Frame' && Math.abs(crop.frame - paper) <= 1, JSON.stringify([crop.frame, paper]));
    ok('Crop: Margin and Keep frame share one center line with a wide gap' + tag, crop.inCard && crop.line <= 1 && crop.gap >= 20, JSON.stringify(crop));
    await p.close();
  }
  ok('no page errors', !errs.length, errs[0] || ''); await b.close();
})();
