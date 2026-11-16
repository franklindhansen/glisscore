// The stylesheet as a file (no browser): the tool windows' layout belongs to shared rules (the card, the heading row, the tool grid) and to the pane's own width, so style.css must not grow
//   1) id-based spacing inside a tool pane: a rule whose selector names an element inside a tool pane by its id (#aeGainCard, #aePaneImager ...) and sets margin, padding, or gap;
//   2) screen-width queries on an editor: an @media rule on a width that styles a tool pane or its parts (the ids above, #audioDlg, #aeWin, .ae-*, and the tool classes nr-, sp-, im-, eq-, lv-, fd-, em-, mt-, tool-grid), the PDF Editor (.pe-*, #pdfDlg), or the video panels (the settings panel, the timeline, the transport, the stage's strips and full-screen rows). The page's own stacking (html, body, and .app) is not a video panel: a box cannot ask about its own width.
// Today's rules are listed in tests/audio-editor-stylesheet-allowed.txt, one per line. The list may only shrink: this check fails on a rule that is not listed, and on a listed rule that is gone (it names the line to delete).
// Each tool's ticket deletes that tool's rules from style.css and their lines from the list.
// Run:  node tests/audio-editor-stylesheet.js   (through tests/run-all.sh)
const fs = require('fs'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const ROOT = path.join(__dirname, '..'), ALLOWED = path.join(__dirname, 'audio-editor-stylesheet-allowed.txt');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
// the ids inside a tool pane (an element with class ae-pane and everything in it), read from the page's markup
const paneIds = new Set(); {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']), stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g; let m;
  while ((m = re.exec(html))) {
    if (!m[2]) continue; const tag = m[2].toLowerCase();
    if (m[1]) { let k = stack.length - 1; while (k >= 0 && stack[k].tag !== tag) k--; if (k >= 0) stack.length = k; continue; }
    const cls = (/class="([^"]*)"/.exec(m[3]) || [])[1] || '', id = (/\sid="([^"]+)"/.exec(m[3]) || [])[1], self = m[4] || VOID.has(tag);
    const pane = /(^|\s)ae-pane(\s|$)/.test(cls), inside = pane || stack.some(s => s.pane);
    if (inside && id) paneIds.add(id);
    if (!self) stack.push({ tag, pane });
  }
}
// the stylesheet as rules: { ctx: ['@media (max-width:700px)'], sels: [...], props: [...] }
const { readRules, SPACING } = require('./lib/css-rules.js'), rules = readRules(css).map(r => ({ ctx: r.ctx, sels: r.sels, props: r.decls.map(d => d.prop) }));
const TOOL_CLASS = /\.(ae-[\w-]+|(nr|sp|im|eq|lv|fd|em|mt)-[\w-]+|tool-grid|on-grid)\b/;
// the PDF Editor's parts and the video panels' (the settings panel, the timeline, the transport, the stage's floating strips and the full-screen rows): they give way by their own width too
const OTHER_CLASS = /\.(pe-[\w-]+|group|subhead|line-fold|fmt-btn|tl-[\w-]+|transport|stage-[\w-]+|fade-[\w-]+|cred[\w-]*|fs-[\w-]+|panel|sys-[\w-]+|timeline)\b|#pdfDlg|#pe[A-Z]\w*|#tl\b|\.app\.fs\b/;
const idsOf = sel => [...sel.matchAll(/#([\w-]+)/g)].map(m => m[1]);
const touchesTool = sel => idsOf(sel).some(id => paneIds.has(id) || id === 'audioDlg' || id === 'aeWin') || TOOL_CLASS.test(sel) || OTHER_CLASS.test(sel);
const widthQuery = ctx => ctx.filter(c => /^@media\b/.test(c) && /(^|[^\w-])(min-|max-)?width\b/.test(c.replace(/@media/, '')));
const found = [];
for (const r of rules) for (const sel of r.sels) {
  const sp = [...new Set(r.props.filter(p => SPACING.test(p)))].sort();
  if (sp.length && idsOf(sel).some(id => paneIds.has(id))) found.push('id-spacing ' + (r.ctx.length ? r.ctx.join(' ') + ' ' : '') + sel + ' {' + sp.join(',') + '}');
  const wq = widthQuery(r.ctx); if (wq.length && touchesTool(sel)) found.push('screen-width ' + wq.join(' ') + ' ' + sel);
}
const lines = (() => { try { return fs.readFileSync(ALLOWED, 'utf8').split('\n'); } catch (e) { return []; } })().map((l, i) => [l.trim(), i + 1]).filter(([t]) => t && t[0] !== '#');
const left = new Map(); for (const [t, n] of lines) { if (!left.has(t)) left.set(t, []); left.get(t).push(n); }
const fresh = [], seenCount = new Map();
for (const k of found) { const l = left.get(k); if (l && l.length) l.shift(); else fresh.push(k); seenCount.set(k, 1); }
const gone = [...left].flatMap(([k, ns]) => ns.map(n => [k, n])).sort((a, b) => a[1] - b[1]);
ok('the stylesheet read: ' + rules.length + ' rules, ' + paneIds.size + ' ids inside tool panes, ' + found.length + ' rules on the list', rules.length > 500 && paneIds.size > 50);
ok('no new id-based spacing inside a tool pane, and no new screen-width query on the Audio Editor', fresh.length === 0, fresh.length + ' new');
for (const k of fresh) ok('new rule: ' + k, false, 'not in tests/audio-editor-stylesheet-allowed.txt; use the shared card, heading row, and tool grid, or a container query');
for (const [k, n] of gone) ok('listed rule is gone, delete line ' + n + ' of tests/audio-editor-stylesheet-allowed.txt: ' + k, false);
ok('every rule in tests/audio-editor-stylesheet-allowed.txt is still in style.css (delete a line when its rule is removed)', gone.length === 0, gone.length ? gone.length + ' gone: delete their lines' : '');
