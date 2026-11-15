// The stylesheet as a file (no browser): a spacing, type size, corner, control height, or color in an editor's rules comes from a token in :root, never from a number.
// A rule in an editor's area fails when it sets, with a number or a color instead of a token:
//   spacing    margin, padding, gap (and their sides): a px value other than 0
//   type       font-size: a px value
//   corner     border-radius: a px value (a pill, 99px or more, stays)
//   height     height or min-height on a button, choice, menu, field, or number box: a px value (a picture's height is not covered)
//   color      #hex, rgb(), rgba(), hsl() in color, background, border, outline, fill, stroke, or box-shadow, outside :root
// A value written with var() and calc() over tokens is allowed: it is how a derived distance is written.
// The areas are listed once, below. Today's offenders are in tests/style-tokens-allowed.txt, one per line, as "area ctx selector {property}" (the value is not part of the key, so changing a number on a listed line does not fix it: use a token).
// The list may only shrink: this check fails on an offender that is not listed, and on a listed one that is gone (it names the line to delete). The Audio Editor's part is empty; the PDF Editor's and the video panels' parts end empty with their tickets.
// Run:  zsh tests/run-all.sh style-tokens
const fs = require('fs'), path = require('path');
const { readRules } = require('./lib/css-rules.js');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
const ROOT = path.join(__dirname, '..'), ALLOWED = path.join(__dirname, 'style-tokens-allowed.txt');
const rules = readRules(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'));
// the areas: a rule belongs to the first area one of its selectors matches
const AREAS = {
  audio: /\.(ae-|nr-|sp-|im-|eq-|lv-|fd-|em-|mt-|tool-grid|on-grid|foot-row|sl-|bal-|bm-|head-note|card-fold|fa\b|fa-)|#ae|#audioDlg|#aeWin/,
  pdf: /\.pe-|\.pe\b|#pe|#pdfDlg|\.pe[A-Z]/,
  video: /\.group|\.subhead|\.line-fold|\.fmt-btn|\.tl-|#tl|\.transport|\.stage|\.fade|\.cred|\.app\.fs|\.fs-|#panel|\.panel\b/,
};
const CONTROL = /(^|[\s>+~(,])(button|select|input)$|\.(btn|seg|icon-btn|fmt-btn|mt-chip|num|sp-seg|ae-jack|combo)$/;          // tested on a selector's last part: a control itself, not its glyph or a pseudo-element
const lastPart = sel => sel.split(/\s*[\s>+~]\s*/).pop().replace(/:(not|is|where|has)\([^)]*\)/g, '').replace(/:(hover|active|focus-visible|focus|checked|disabled|first-child|last-child)\b/g, '');
const PX = /-?\d*\.?\d+px/g, zero = v => /^-?0*\.?0+px$/.test(v);
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const noVar = v => { let o = '', d = 0; for (let i = 0; i < v.length; i++) { if (v.startsWith('var(', i) && !d) { d = 1; i += 3; continue; } if (d) { if (v[i] === '(') d++; else if (v[i] === ')') d--; continue; } o += v[i]; } return o; };
const SPACING = /^(margin|padding)(-[a-z-]+)?$|^(row-|column-)?gap$/, COLORP = /^(color|background(-color|-image)?|border(-[a-z]+)?(-color)?|outline(-color)?|fill|stroke|box-shadow|text-shadow)$/;
const found = [];
for (const r of rules) {
  if (r.sels.some(s => /^:root|^html\[data-theme|:root\[/.test(s))) continue;          // the tokens' own definitions
  for (const sel of r.sels) {
    const area = /\.sys-/.test(sel) ? 'video' : Object.keys(AREAS).find(a => AREAS[a].test(sel)); if (!area) continue;
    const ctx = (r.ctx.length ? r.ctx.join(' ') + ' ' : '');
    for (const { prop, value } of r.decls) {
      const v = noVar(value), px = (v.match(PX) || []).filter(x => !zero(x));
      let kind = null;
      if (SPACING.test(prop) && px.length) kind = 'spacing';
      else if (prop === 'font-size' && px.length) kind = 'type';
      else if (prop === 'border-radius' && px.some(x => parseFloat(x) < 99)) kind = 'corner';
      else if ((prop === 'height' || prop === 'min-height') && px.length && CONTROL.test(lastPart(sel))) kind = 'height';
      else if (COLORP.test(prop) && COLOR.test(v)) kind = 'color';
      if (kind) found.push({ key: area + ' ' + kind + ' ' + ctx + sel + ' {' + prop + '}', line: r.line, value });
    }
  }
}
// a token defined as itself (--a:var(--a)) is empty everywhere: a find-and-replace on a value can do this to the token's own definition
const selfRef = []; for (const r of rules) for (const d of r.decls) if (/^--/.test(d.prop) && new RegExp('^var\\(\\s*' + d.prop + '\\s*[,)]').test(d.value)) selfRef.push(d.prop + ' at style.css:' + r.line);
const lines = (() => { try { return fs.readFileSync(ALLOWED, 'utf8').split('\n'); } catch (e) { return []; } })().map((l, i) => [l.trim(), i + 1]).filter(([t]) => t && t[0] !== '#');
const left = new Map(); for (const [t, n] of lines) { if (!left.has(t)) left.set(t, []); left.get(t).push(n); }
const fresh = [];
for (const f of found) { const l = left.get(f.key); if (l && l.length) l.shift(); else fresh.push(f); }
const gone = [...left].flatMap(([k, ns]) => ns.map(n => [k, n])).sort((a, b) => a[1] - b[1]);
if (process.env.TOKENS_LIST) { for (const f of found) console.log('PASS ' + f.line + '\t' + f.key + '\t' + f.value.slice(0, 90)); process.exit(0); }          // a way to list every offender with its line: TOKENS_LIST=1 zsh tests/run-all.sh -o FILE style-tokens
const by = {}; for (const f of found) by[f.key.split(' ')[0]] = (by[f.key.split(' ')[0]] || 0) + 1;
ok('the stylesheet read: ' + rules.length + ' rules; offenders by area ' + JSON.stringify(by), rules.length > 500);
ok('the Audio Editor has no raw spacing, type size, corner, control height, or color', !found.some(f => f.key.startsWith('audio ')), (by.audio || 0) + ' left');
ok('no token is defined as itself', selfRef.length === 0, selfRef.join(', '));
ok('no new raw value in any editor', fresh.length === 0, fresh.length + ' new');
for (const f of fresh) ok('new raw value at style.css:' + f.line + ' (' + f.value.slice(0, 60) + '): ' + f.key, false, 'use a token from :root, or a calc() over tokens');
for (const [k, n] of gone) ok('listed offender is gone, delete line ' + n + ' of tests/style-tokens-allowed.txt: ' + k, false);
ok('every line of tests/style-tokens-allowed.txt is still in style.css (delete a line when its rule is fixed)', gone.length === 0, gone.length ? gone.length + ' gone: delete their lines' : '');
