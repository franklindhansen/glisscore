// style.css as a list of rules, read from the file with no browser: { ctx: ['@media (max-width:700px)'], sels: ['.a', '.b .c'], decls: [{ prop, value }], line }.
// ctx holds the @media, @supports, @container, @layer, and @keyframes blocks the rule sits in (a keyframe's selector is its stop, such as 50%); line is the line its selector starts on. Comments are blanked, so line numbers match the file.
// Used by audio-editor-stylesheet.js and style-tokens.js.
exports.readRules = css => {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')), rules = [];
  const skipStr = (s, i) => { const q = s[i]; for (i++; i < s.length && s[i] !== q; i++) if (s[i] === '\\') i++; return i; };
  const block = (s, i) => { let d = 0; for (; i < s.length; i++) { const c = s[i]; if (c === '"' || c === "'") i = skipStr(s, i); else if (c === '{') d++; else if (c === '}') { d--; if (!d) return i; } } return s.length; };
  const starts = [0]; for (let k = 0; k < src.length; k++) if (src[k] === '\n') starts.push(k + 1);
  const lineAt = o => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= o) lo = mid; else hi = mid - 1; } return lo + 1; };
  const walk = (s, base, ctx) => {
    let i = 0;
    while (i < s.length) {
      let j = i, par = 0; for (; j < s.length; j++) { const c = s[j]; if (c === '"' || c === "'") j = skipStr(s, j); else if (c === '(') par++; else if (c === ')') par--; else if (!par && (c === '{' || c === ';' || c === '}')) break; }
      const pre = s.slice(i, j).trim();
      if (s[j] !== '{') { i = j + 1; continue; }
      const end = block(s, j), body = s.slice(j + 1, end), start = base + i + (s.slice(i, j).length - s.slice(i, j).trimStart().length);
      if (pre[0] === '@') { if (/^@(media|supports|container|layer|keyframes)\b/.test(pre)) walk(body, base + j + 1, ctx.concat(pre.replace(/\s+/g, ' '))); }
      else {
        const parts = []; let d = 0, cur = '', q = null;
        for (const c of body) { if (q) { cur += c; if (c === q) q = null; } else if (c === '"' || c === "'") { q = c; cur += c; } else if (c === '(') { d++; cur += c; } else if (c === ')') { d--; cur += c; } else if (c === ';' && !d) { parts.push(cur); cur = ''; } else cur += c; }
        parts.push(cur);
        const decls = parts.map(p => { const k = p.indexOf(':'); return k < 0 ? null : { prop: p.slice(0, k).trim().toLowerCase(), value: p.slice(k + 1).trim() }; }).filter(d => d && d.prop);
        rules.push({ ctx, sels: pre.split(/,(?![^(]*\))/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean), decls, line: lineAt(start) });
      }
      i = end + 1;
    }
  };
  walk(src, 0, []);
  return rules;
};
// the properties that set a space: margin, padding, and gap, with their sides
exports.SPACING = /^(margin|padding)(-[a-z-]+)?$|^(row-|column-)?gap$/;
