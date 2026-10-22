'use strict';
/* ====================================================================
   Transport (play / pause / seek)
   ==================================================================== */
const Transport = {
  playing: false, t0: 0, off: 0, src: null,
  now() {
    if (!this.playing) return S.time;
    if (S.audio) {          // the player's own count of frames played, and the clock once it has played to its end (the video can run on past the sound)
      const h = this.dh, ct = actx.currentTime;
      if (h) { const t = h.frame() / h.sr; if (h.ended()) { if (!this.endAt) this.endAt = { ct, t }; return this.endAt.t + (ct - this.endAt.ct); } return t; }
      return this.off < 0 ? Math.min(0, this.off + (ct - this.t0)) : this.off;          // before the first sound is ready, or while waiting for the audio to begin
    }
    return this.off + (performance.now() - this.t0) / 1000;
  },
  async play() {
    if (this.playing || !S.pdf) return;
    if (S.time >= vEnd() - 0.05) S.time = S.vStart;
    if (S.audio) {
      const ac = ensureCtx();
      if (ac.state !== 'running') { try { await ac.resume(); } catch (e) {} }
      if (!S.audio.disk) { try { await fxGet(S.set.fx); } catch (e) { dbg('Processing failed: ' + (e && e.message || e)); } }
      if (this.playing || !S.audio) return;
      this.src = ac.createGain(); this.gain = ac.createGain(); { const gt = ac.currentTime; this.gain.gain.setValueAtTime(0, gt); this.gain.gain.setValueAtTime(0, gt + 0.02); this.gain.gain.linearRampToValueAtTime(1, gt + 0.03); }          // the player makes the sound into this.src; eased in over a few milliseconds
      this.src.connect(this.gain); this.gain.connect(ac.destination);
      this.off = S.time; this.t0 = ac.currentTime;
      this.soundStart(ac, S.time);
    } else { this.off = S.time; this.t0 = performance.now(); }
    this.playing = true; updatePlayIcon();
  },
  /* the player makes the sound, from memory or from the disk store (there with the tools on it), with the volume, the fades and the limiter worked out inside it, and hands it to this.src.
     Before the audio starts (time below 0) it is started when its turn comes */
  async soundStart(ac, t) {
    const tok = this.tok = (this.tok || 0) + 1; this.dh = null; this.endAt = null;
    try {
      if (t < 0) { await new Promise(r => setTimeout(r, -t * 1000)); if (this.tok !== tok) return; t = 0; }
      const v = this.lvl = soundFadeAt(t) * audioGain(), o = { ease: true, init: Object.assign({ gain: v, now: true }, limOn(S.set) ? { lim: { on: true, ceil: LIM_CEIL - LIM_GUARD, tp: TP_H } } : {}) };          // a loudness target with the limiter on: the sound goes through the limiter on its way out
      let h; if (S.audio.disk) { DISK.fxUse(S.set.fx); h = await DISK.play(ac, Math.floor(t * S.audio.sr), this.src, Object.assign({ fx: true }, o)); } else h = await soundPlay(ac, memSound(ac, outBuf()), Math.floor(t * ac.sampleRate), this.src, o);
      if (this.tok !== tok) { h.stop(); return; }
      this.dh = h;
    } catch (e) { if (this.tok === tok && e !== STALE) { console.error(e); this.pause(); toast(tx('ae.playfail') + ' ' + (e && e.message || ''), 5000); } }
  },
  pause() {
    if (!this.playing) return;
    S.time = clamp(this.now(), S.vStart, vEnd());
    this.tok = (this.tok || 0) + 1;
    const o = { dh: this.dh, src: this.src, gain: this.gain };          // the sound is eased out over a few milliseconds before it is cut, so a jump to another spot does not click
    this.dh = null; this.src = null; this.gain = null;
    const cut = () => {
      if (o.dh) { try { o.dh.stop(); } catch (e) {} }
      if (o.src) { try { o.src.disconnect(); } catch (e) {} }
      if (o.gain) { try { o.gain.disconnect(); } catch (e) {} }
    };
    if (o.gain) { try { const ct = o.gain.context.currentTime, g = o.gain.gain; g.cancelScheduledValues(ct); g.setValueAtTime(g.value, ct); g.linearRampToValueAtTime(0, ct + 0.01); } catch (e) {} setTimeout(cut, 40); } else cut();
    this.playing = false; updatePlayIcon(); stageDirty = true; TL.overlayDirty = true;
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  seek(t) {
    t = clamp(t, S.vStart, vEnd());
    if (this.playing) { this.pause(); S.time = t; this.play(); } else S.time = t;
    stageDirty = true; TL.overlayDirty = true; updateTimeUI(true);
  }
};
function updatePlayIcon() {
  $('#playIcon').innerHTML = Transport.playing ? '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>' : '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>';
  $('#bPlay').setAttribute('aria-label', Transport.playing ? 'Pause' : 'Play');
}

/* Tap-to-set: press T at the moment a page should turn */
function tapTurn() {
  if (!S.spreads.length || S.spreads.length < 2) return;
  const t = Transport.now();
  const st = frameState(t);
  const i = st.spread;
  if (i >= S.turns.length) { toast(tx('vid.lastturn')); return; }
  const D = turnGap(), off = refOffset(), dur = vEnd();
  const lo = i === 0 ? turnMin() : S.turns[i - 1] + D;
  const hi = dur - D + off - (S.turns.length - 1 - i) * D;
  pushHistory();
  S.turns[i] = clamp(t, lo, Math.max(lo, hi)); S.ph[i] = false;
  for (let k = i + 1; k < S.turns.length; k++) if (S.turns[k] < S.turns[k - 1] + D) S.turns[k] = S.turns[k - 1] + D;
  S.turnsEdited = true;
  normalizeTurns();
  onTurnsChanged();
  toast(tx('vid.turnset', { noun: turnNoun(), n: i + 1, t: fmt(S.turns[i] - S.vStart) }));
}

/* ====================================================================
   WebGL renderer – flat pages + a bending, shaded, shadow-casting page
   ==================================================================== */
const GLSL = {
  quadVS: `attribute vec2 a_pos; attribute vec2 a_uv; uniform vec2 u_res; varying vec2 v_uv;
    void main(){ vec2 c=a_pos/u_res*2.0-1.0; gl_Position=vec4(c.x,-c.y,0.0,1.0); v_uv=a_uv; }`,
  quadFS: `precision highp float; uniform sampler2D u_tex; uniform sampler2D u_shadow; uniform float u_side; uniform float u_gutter; uniform float u_useShadow; uniform float u_div; uniform float u_pw; uniform float u_rows; uniform float u_fade; uniform vec3 u_bg; uniform float u_inv; uniform vec3 u_ink; varying vec2 v_uv;
    float crease(float d){ return pow(1.0-smoothstep(0.0,0.09,d),1.5); }
    float divider(float d){ float px=d*u_pw; float lw=max(1.0,u_pw/900.0); float line=1.0-smoothstep(lw*0.6,lw*1.6,px); float halo=1.0-smoothstep(0.0,lw*7.0,px); return line*0.5+halo*halo*0.22; }
    void main(){ vec3 col=texture2D(u_tex,v_uv).rgb;
      if(u_inv>0.5){ float l=dot(col,vec3(0.299,0.587,0.114)); col=mix(u_bg,u_ink,clamp(1.0-l,0.0,1.0)); }       // invert: white paper drops out, the notes take the ink color
      float d=u_side>0.0?v_uv.x:1.0-v_uv.x;
      float s=u_side>0.0?v_uv.x:v_uv.x-1.0;
      float sh=texture2D(u_shadow,vec2((s+1.1)/2.2,(v_uv.y*(u_rows-1.0)+0.5)/u_rows)).r*0.5*u_useShadow;
      float m=(1.0-0.30*crease(d)*u_gutter)*(1.0-u_div*divider(d))*(1.0-sh);
      float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
      col=col*m; if(m<0.999) col+=(n-0.5)/255.0;
      col=mix(u_bg,col,u_fade);
      gl_FragColor=vec4(col,texture2D(u_tex,v_uv).a); }`,
  curlVS: `attribute vec2 a_pos; attribute float a_depth; attribute vec2 a_uv; attribute vec3 a_shade; uniform vec2 u_res;
    varying vec2 v_uv; varying vec3 v_shade;
    void main(){ vec2 c=a_pos/u_res*2.0-1.0; gl_Position=vec4(c.x,-c.y,a_depth,1.0); v_uv=a_uv; v_shade=a_shade; }`,
  curlFS: `precision highp float; uniform sampler2D u_front; uniform sampler2D u_back; uniform float u_gutter; uniform float u_div; uniform float u_pw; uniform float u_fade; uniform vec3 u_bg; uniform float u_inv; uniform vec3 u_ink;
    varying vec2 v_uv; varying vec3 v_shade;
    float crease(float d){ return pow(1.0-smoothstep(0.0,0.09,d),1.5); }
    float divider(float d){ float px=d*u_pw; float lw=max(1.0,u_pw/900.0); float line=1.0-smoothstep(lw*0.6,lw*1.6,px); float halo=1.0-smoothstep(0.0,lw*7.0,px); return line*0.5+halo*halo*0.22; }
    void main(){
      vec3 col; float shade;
      if(v_shade.z>=0.0){ col=texture2D(u_front,v_uv).rgb; shade=v_shade.x; }
      else { col=texture2D(u_back,vec2(1.0-v_uv.x,v_uv.y)).rgb; shade=v_shade.y; }
      if(u_inv>0.5){ float l=dot(col,vec3(0.299,0.587,0.114)); col=mix(u_bg,u_ink,clamp(1.0-l,0.0,1.0)); }
      float fl=smoothstep(0.5,0.95,abs(v_shade.z));
      float m=(1.0-0.30*crease(v_uv.x)*u_gutter*fl)*(1.0-u_div*divider(v_uv.x)*fl)*shade;
      float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
      col=col*m; if(m<0.999) col+=(n-0.5)/255.0;
      col=mix(u_bg,col,u_fade);
      gl_FragColor=vec4(col,1.0); }`,
  boxVS: `attribute vec2 a_pos; void main(){ gl_Position=vec4(a_pos,0.0,1.0); }`,
  boxFS: `precision highp float; uniform vec2 u_res; uniform vec4 u_rect; uniform vec4 u_xs; uniform vec2 u_w; uniform vec2 u_off; uniform float u_sigma; uniform float u_alpha;
    float cdf(float t){ float x=t/(0.85*u_sigma); return 0.5+0.5*x/sqrt(1.0+x*x); }
    void main(){ vec2 p=vec2(gl_FragCoord.x,u_res.y-gl_FragCoord.y)-u_off;
      float fx=u_w.x*(cdf(p.x-u_xs.x)-cdf(p.x-u_xs.y))+u_w.y*(cdf(p.x-u_xs.z)-cdf(p.x-u_xs.w)); float fy=cdf(p.y-u_rect.y)-cdf(p.y-u_rect.w);
      float a=u_alpha*fx*fy; float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
      a=a>0.0005?clamp(a+(n-0.5)/255.0,0.0,1.0):0.0;
      gl_FragColor=vec4(0.0,0.0,0.0,a); }`
};
function hexToRgb(h) {
  h = (h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
function makeProgram(gl, vs, fs, attrs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  p.u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; p.u[nm] = gl.getUniformLocation(p, nm); }
  return p;
}

/* Lays out the closing credits on one page-sized area, centered as one block: the title largest (it may wrap), then line 2
   (one or two lines), then line 3 a little smaller. Lines 2 and 3 never wrap; they scale down to fit. Each line has its
   own bold / italic, and optionally its own font. */
const CREDITS_FONT_FALLBACK = "'Instrument Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
const lineStyle = key => { const s = S.set; return { b: !!s['cred' + key + 'B'], i: !!s['cred' + key + 'I'], font: s.creditsFontEach ? (s['cred' + key + 'Font'] || '') : (s.creditsFont || '') }; };
/* the weight each line is drawn in: Bold is 700, otherwise a little lighter for the lower lines */
const lineWeight = (key, st) => st.b ? 700 : key === 'L3' ? 400 : 500;
function drawCreditsCard(cv, o) {
  const w = cv.width, h = cv.height, c = cv.getContext('2d'); c.clearRect(0, 0, w, h);
  const maxW = w * 0.88, s0 = w * 0.095, s1 = w * 0.062;
  const setFont = (size, weight, st) => { c.font = (st.i ? 'italic ' : '') + weight + ' ' + size + 'px ' + (st.font ? '"' + st.font + '",' : '') + CREDITS_FONT_FALLBACK; };
  const wrapAt = (words, width) => { const lines = []; let cur = ''; words.forEach(wd => { const t = cur ? cur + ' ' + wd : wd; if (cur && c.measureText(t).width > width) { lines.push(cur); cur = wd; } else cur = t; }); if (cur) lines.push(cur); return lines; };
  /* the title: one line if it fits (shrinking a little), otherwise evenly filled lines */
  const fitWrap = (txt, size, weight, st) => {
    const words = txt.split(/\s+/).filter(Boolean);
    for (let k = 1; k >= 0.7; k -= 0.05) { setFont(size * k, weight, st); if (c.measureText(txt).width <= maxW) return { lines: [txt], size: size * k }; }
    setFont(size, weight, st); const n = wrapAt(words, maxW).length; let lo = 0, hi = maxW;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (wrapAt(words, mid).length === n) hi = mid; else lo = mid; }
    return { lines: wrapAt(words, hi), size };
  };
  /* always one line: the size is scaled so the whole line fits */
  const fitOne = (txt, size, weight, st) => { setFont(size, weight, st); const m = c.measureText(txt).width; return m > maxW ? size * maxW / m : size; };
  const blocks = [], tS = lineStyle('Title'), l2S = lineStyle('L2'), l3S = lineStyle('L3');
  if (o.title) { const wt = lineWeight('Title', tS), f = fitWrap(o.title, s0, wt, tS); blocks.push({ lines: f.lines, size: f.size, weight: wt, st: tS, lh: 1.15, gapAfter: s1 * 1.1 }); }
  let ens = s1;
  const l2 = o.l2.split('\n').map(t => t.trim()).filter(Boolean);
  if (l2.length) { const wt = lineWeight('L2', l2S), size = Math.min.apply(null, l2.map(t => fitOne(t, s1, wt, l2S))); blocks.push({ lines: l2, size, weight: wt, st: l2S, lh: 1.25, gapAfter: s1 * 0.5 }); ens = size; }
  if (o.l3) { const wt = lineWeight('L3', l3S), size = Math.min(fitOne(o.l3, s1 * 0.8, wt, l3S), ens * 0.82); blocks.push({ lines: [o.l3], size, weight: wt, st: l3S, lh: 1.25, gapAfter: 0 }); }
  if (!blocks.length) return;
  blocks[blocks.length - 1].gapAfter = 0;
  let total = 0; blocks.forEach((b, i) => { total += b.lines.length * b.size * b.lh + (i < blocks.length - 1 ? b.gapAfter : 0); });
  let y = h * 0.5 - total / 2;
  c.fillStyle = o.dark ? '#ececec' : '#1b1b1f'; c.textAlign = 'center'; c.textBaseline = 'middle';
  blocks.forEach((b, i) => {
    setFont(b.size, b.weight, b.st);
    b.lines.forEach(line => { c.fillText(line, w / 2, y + b.size * b.lh / 2); y += b.size * b.lh; });
    if (i < blocks.length - 1) y += b.gapAfter;
  });
}
/* Google Fonts: any font name from fonts.google.com can be used. Google wants the exact capitalization, so a name typed in
   lower case is tried in a few likely forms (Title Case, then forms with short words like IBM, PT, JP in capitals). */
const fontLoads = {}, fontResolved = {};
const validFontName = n => /^[A-Za-z0-9 &.'-]{1,60}$/.test(n);
const titleCase = s => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
function fontCandidates(raw) {
  raw = raw.trim(); const out = [], add = s => { if (s && !out.includes(s)) out.push(s); };
  const t = titleCase(raw).split(/\s+/), up = w => w.length <= 3 && /^[A-Za-z]+$/.test(w) ? w.toUpperCase() : w;
  add(raw); add(t.join(' ')); add(t.map(up).join(' '));
  if (t.length > 1) { add([up(t[0])].concat(t.slice(1)).join(' ')); add(t.slice(0, -1).concat([up(t[t.length - 1])]).join(' ')); }
  return out;
}
function tryGoogleFont(name) {
  return new Promise(res => {
    const link = document.createElement('link'); link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':400,500,600,700,400italic,500italic,600italic,700italic&display=swap';
    link.onload = () => Promise.all([[400, ''], [500, ''], [600, ''], [700, ''], [500, 'italic ']].map(([wt, st]) => document.fonts.load(st + wt + ' 20px "' + name + '"'))).then(() => res(true), () => res(true));
    link.onerror = () => { link.remove(); res(false); };
    document.head.appendChild(link);
  });
}
/* the correctly capitalized name once it has loaded, '' for no font, or null if Google doesn't have it */
async function resolveGoogleFont(raw) {
  raw = (raw || '').trim(); if (!raw) return '';
  if (!validFontName(raw)) return null;
  const k = raw.toLowerCase();
  if (k in fontResolved) return fontResolved[k];
  if (!fontLoads[k]) fontLoads[k] = (async () => { for (const c of fontCandidates(raw)) if (await tryGoogleFont(c)) { fontResolved[k] = c; fontResolved[c.toLowerCase()] = c; return c; } return null; })();
  const r = await fontLoads[k]; if (r === null) delete fontLoads[k];
  return r;
}
const CRED_FONT_KEYS = ['creditsFont', 'credTitleFont', 'credL2Font', 'credL3Font'];
const creditsFontsInUse = () => (S.set.creditsFontEach ? ['credTitleFont', 'credL2Font', 'credL3Font'] : ['creditsFont']).map(k => S.set[k]).filter(Boolean);
class Renderer {
  constructor(canvas, src, opts = {}) {
    this.canvas = canvas; this.src = src; this.cap = opts.cap || 14;
    const gl = this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.pQuad = makeProgram(gl, GLSL.quadVS, GLSL.quadFS, ['a_pos', 'a_uv']);
    this.pCurl = makeProgram(gl, GLSL.curlVS, GLSL.curlFS, ['a_pos', 'a_depth', 'a_uv', 'a_shade']);
    this.pBox = makeProgram(gl, GLSL.boxVS, GLSL.boxFS, ['a_pos']);
    this.N = 128; this.M = 24;
    const N = this.N, M = this.M, idx = [];
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx.push(a, b, c, b, d, c);
    }
    this.idxCount = idx.length;
    this.ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.vbo = gl.createBuffer(); this.qbo = gl.createBuffer(); this.bbo = gl.createBuffer();
    this.curlData = new Float32Array((N + 1) * (M + 1) * 8);
    this.world = new Float32Array((N + 1) * (M + 1) * 3);
    this.SW = 1024; this.shadowBytes = new Uint8Array(this.SW * (M + 1)); this.shadowProf = new Float32Array(this.SW * (M + 1)); this.shadowRow = new Float32Array(this.SW); this.shadowTmp = new Float32Array(this.SW);
    this.shadowTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, this.SW, M + 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.shadowBytes);
    this.setTexParams();
    this.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.setTexParams();
    this.scoreFade = 1; this.bgRgb = [0, 0, 0]; this.inkRgb = [0.99, 0.99, 0.99];
    this.tex = new Map(); this.pending = new Map(); this.sizeKey = ''; this.lay = null; this.onUpdate = null; this.W = canvas.width; this.H = canvas.height;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }
  setTexParams() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  resize(W, H) { this.canvas.width = W; this.canvas.height = H; this.W = W; this.H = H; }
  layout() {
    const m = S.set.margin / 100, pa = S.pdf ? S.pdf.aspect : 0.77, W = this.W, H = this.H, one = singleOn();
    let pw = Math.floor(Math.min(W * (1 - 2 * m) / (one ? 1 : 2), H * (1 - 2 * m) * pa));
    pw = Math.max(8, pw);
    const ph = Math.max(8, Math.floor(pw / pa));
    /* a single page is the right-hand page with the left one empty, moved so the page itself is centered: the turn swings it around its left edge */
    const x0 = one ? Math.round((W - pw) / 2) - pw : Math.round((W - 2 * pw) / 2), y0 = Math.round((H - ph) / 2);
    return { pw, ph, x0, y0, cx: x0 + pw, cy: y0 + ph / 2, xs: one ? x0 + pw : x0 };      // xs: where the left-most page starts
  }
  clearTextures() {
    const gl = this.gl; this.tex.forEach(e => gl.deleteTexture(e.t)); this.tex.clear(); this.pending.clear(); this.sizeKey = '';
  }
  checkSize(lay) {
    const key = lay.pw + 'x' + lay.ph;
    if (key !== this.sizeKey) { this.clearTextures(); this.sizeKey = key; }
  }
  tex_(idx) {
    if (idx === -1) return null;
    if (idx === BLANK) return this.white;
    if (idx === CARD) return this.cardTexture();
    if (idx < 0) return null;
    const e = this.tex.get(idx);
    if (e) { this.tex.delete(idx); this.tex.set(idx, e); return e.t; }
    this.request(idx);
    return this.white;
  }
  request(idx) {
    if (this.pending.has(idx)) return this.pending.get(idx);
    const key = this.sizeKey, lay = this.lay, gl = this.gl;
    const p = this.src.render(idx, lay.pw, lay.ph).then(cv => {
      this.pending.delete(idx);
      if (key !== this.sizeKey) return;
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      this.setTexParams();
      this.tex.set(idx, { t });
      while (this.tex.size > this.cap) { const k = this.tex.keys().next().value; gl.deleteTexture(this.tex.get(k).t); this.tex.delete(k); }
      if (this.onUpdate) this.onUpdate();
    }).catch(e => { this.pending.delete(idx); console.warn('page render failed', idx, e); });
    this.pending.set(idx, p);
    return p;
  }
  async ensure(list) {
    const lay = this.layout(); this.lay = lay; this.checkSize(lay);
    const need = list.filter(i => i >= 0 && !this.tex.has(i));
    if (need.length) await Promise.all(need.map(i => this.request(i)));
  }
  prefetch(list) {
    const lay = this.layout(); this.lay = lay; this.checkSize(lay);
    list.forEach(i => { if (i >= 0 && !this.tex.has(i) && !this.pending.has(i)) this.request(i); });
  }
  attribs(n) { const gl = this.gl; for (let i = 0; i < 4; i++) { if (i < n) gl.enableVertexAttribArray(i); else gl.disableVertexAttribArray(i); } }
  drawQuad(tex, x, y, w, h, side, flat) {
    const gl = this.gl, P = this.pQuad;
    const v = new Float32Array([x, y, 0, 0, x + w, y, 1, 0, x, y + h, 0, 1, x + w, y, 1, 0, x + w, y + h, 1, 1, x, y + h, 0, 1]);
    gl.useProgram(P); gl.uniform2f(P.u.u_res, this.W, this.H); gl.uniform1f(P.u.u_side, side); gl.uniform1f(P.u.u_gutter, flat ? 0 : gutterAmt());
    gl.uniform1f(P.u.u_useShadow, this.useShadow ? 1 : 0); gl.uniform1f(P.u.u_div, flat ? 0 : dividerAmt()); gl.uniform1f(P.u.u_pw, this.lay.pw); gl.uniform1f(P.u.u_rows, this.M + 1);
    gl.uniform1f(P.u.u_fade, this.scoreFade); gl.uniform3f(P.u.u_bg, this.bgRgb[0], this.bgRgb[1], this.bgRgb[2]);
    gl.uniform1f(P.u.u_inv, !flat && S.set.invert ? 1 : 0); gl.uniform3f(P.u.u_ink, this.inkRgb[0], this.inkRgb[1], this.inkRgb[2]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(P.u.u_shadow, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(P.u.u_tex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.qbo); gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    this.attribs(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    if (flat) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }     // loose text: only its letters are drawn
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (flat) gl.disable(gl.BLEND);
  }
  /* the credits text, drawn once into a page-sized picture and reused until the wording, size or background changes */
  cardTexture() {
    const lay = this.lay, gl = this.gl, dark = (() => { const c = this.bgRgb; return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 0.5; })();
    /* the exact font faces this card needs (e.g. Playfair Display bold italic) must be loaded before it is drawn, or a
       fallback font gets drawn instead; if one is still loading, the card is redrawn as soon as it arrives */
    const ready = ['Title', 'L2', 'L3'].map(k => {
      const st = lineStyle(k), spec = (st.i ? 'italic ' : '') + lineWeight(k, st) + ' 20px "' + (st.font || 'Instrument Sans') + '"';
      const ok = !!(document.fonts && document.fonts.check && document.fonts.check(spec));
      if (!ok && document.fonts && document.fonts.load) document.fonts.load(spec).then(() => { stageDirty = true; }, () => {});
      return ok ? 1 : 0;
    }).join('');
    const o = { title: creditsTitle(), l2: S.credits.l2.trim(), l3: S.credits.l3.trim(), dark };
    const key = [o.title, o.l2, o.l3, lay.pw, lay.ph, dark, JSON.stringify(['Title', 'L2', 'L3'].map(lineStyle)), ready].join('|');
    if (this.cardKey === key && this.cardTex) return this.cardTex;
    const cv = document.createElement('canvas'); cv.width = lay.pw; cv.height = lay.ph;
    drawCreditsCard(cv, o);
    if (this.cardTex) gl.deleteTexture(this.cardTex);
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    this.setTexParams(); this.cardTex = t; this.cardKey = key; return t;
  }
  buildCurl(lay, p, shift = 0) {
    const N = this.N, M = this.M, pw = lay.pw, ph = lay.ph, cd = this.curlData, wd = this.world;
    const L = 0.12 + 1.3 * (S.set.bend / 100), skew = 0.10, ds = pw / N;
    const f = pw * 20, zs = 1 / (pw * 1.3);
    const lx = -0.45, ly = -0.35, lz = 0.82;
    let k = 0, w = 0;
    for (let j = 0; j <= M; j++) {
      const v = j / M, Y = (v - 0.5) * ph;
      let x = 0, z = 0, aPrev = 0;
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        const ue = clamp(s + skew * (v - 0.5), 0, 1);
        const q = clamp(p * (1 + L) - L * (1 - ue), 0, 1);
        const a = Math.PI * q;
        if (i > 0) { const am = (aPrev + a) / 2; x += ds * Math.cos(am); z += ds * Math.sin(am); }
        aPrev = a;
        const sinA = Math.sin(a), cosA = Math.cos(a);
        const dotN = -sinA * lx + cosA * lz;
        const rf = clamp(dotN / lz, 0, 1), rb = clamp(-dotN / lz, 0, 1);
        const sc = f / (f - z);
        cd[k++] = lay.cx - shift + x * sc; cd[k++] = lay.cy + Y * sc; cd[k++] = -z * zs;
        cd[k++] = s; cd[k++] = v;
        cd[k++] = 0.62 + 0.38 * rf; cd[k++] = 0.62 + 0.38 * rb; cd[k++] = cosA;
        wd[w++] = x - shift; wd[w++] = Y; wd[w++] = z;
      }
    }
  }
  /* Soft shadow of the lifted page, computed from its side profile, blurred and stored in a fine map that the
     flat pages underneath sample. It is exactly zero while the page lies flat, so nothing pops on or off. */
  updateShadowMap(lay) {
    const gl = this.gl, N = this.N, M = this.M, SW = this.SW, wd = this.world, pw = lay.pw, R = 1.1, rows = M + 1;
    const row = this.shadowRow, tmp = this.shadowTmp, prof = this.shadowProf, out = this.shadowBytes;
    const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const strength = shOn() ? clamp(S.set.turnShadow / 100, 0, 1.5) : 0;
    const sigS = (0.012 + 0.062 * clamp(S.set.turnSoft / 100, 0, 1)) * SW / (2 * R);     // blur size in map samples
    const rad = Math.max(1, Math.round((Math.sqrt(4 * sigS * sigS + 1) - 1) / 2));      // three box blurs ≈ a gaussian
    const fill = (lo, hi, a) => {
      const k0 = Math.max(0, Math.floor((lo / pw + R) / (2 * R) * SW)), k1 = Math.min(SW - 1, Math.ceil((hi / pw + R) / (2 * R) * SW));
      for (let k = k0; k <= k1; k++) if (a > row[k]) row[k] = a;
    };
    for (let j = 0; j < rows; j++) {
      row.fill(0);
      if (strength > 0) for (let i = 0; i < N; i++) {
        const p0 = (j * (N + 1) + i) * 3, p1 = p0 + 3;
        const x0 = wd[p0], x1 = wd[p1], z0 = wd[p0 + 2], z1 = wd[p1 + 2], zm = (z0 + z1) / 2;
        const cast = strength * 0.40 * ss(0.01 * pw, 0.10 * pw, zm) * (1 - 0.5 * clamp(zm / (0.8 * pw), 0, 1));
        const ao = strength * 0.22 * ss(0.01 * pw, 0.08 * pw, zm) * (1 - ss(0.10 * pw, 0.70 * pw, zm));
        const g0 = x0 + 0.30 * z0, g1 = x1 + 0.30 * z1;
        if (cast > 0.002) fill(Math.min(g0, g1), Math.max(g0, g1), cast);
        if (ao > 0.002) fill(Math.min(x0, x1), Math.max(x0, x1), ao);
      }
      for (let pass = 0; pass < 3; pass++) {
        let acc = 0;
        for (let k = -rad; k <= rad; k++) acc += row[Math.min(SW - 1, Math.max(0, k))];
        for (let k = 0; k < SW; k++) {
          tmp[k] = acc / (2 * rad + 1);
          acc += row[Math.min(SW - 1, k + rad + 1)] - row[Math.max(0, k - rad)];
        }
        row.set(tmp);
      }
      prof.set(row, j * SW);
    }
    for (let pass = 0; pass < 2; pass++) {          // smooth between rows too, so slanted edges stay clean
      for (let k = 0; k < SW; k++) {
        let prev = prof[k];
        for (let j = 0; j < rows; j++) { const i = j * SW + k, cur = prof[i], next = j + 1 < rows ? prof[i + SW] : cur; prof[i] = (prev + 2 * cur + next) / 4; prev = cur; }
      }
    }
    for (let k = 0; k < SW * rows; k++) out[k] = Math.round(clamp(prof[k] / 0.5, 0, 1) * 255);   // full 8-bit range for 0..0.5
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SW, rows, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, out);
    gl.activeTexture(gl.TEXTURE0);
  }
  /* A soft drop shadow under the whole score, so it looks like a real object on the background. */
  /* The shadow follows what is physically there: A and B are the left and right halves of the score, each an
     x-range plus a strength. A half that is still empty (or only part covered by a turning page) casts no shadow yet. */
  drawScoreShadow(lay, A, B, dx = 0) {
    if (!(S.set.scoreAmt > 0) || !shOn() || S.set.invert) return;       // an inverted score has no paper to cast a shadow
    const wa = A.x1 > A.x0 ? A.w : 0, wb = B.x1 > B.x0 ? B.w : 0; if (!(wa > 0) && !(wb > 0)) return;
    const gl = this.gl, P = this.pBox, soft = clamp(S.set.scoreSoft / 100, 0, 1), amt = clamp(S.set.scoreAmt / 100, 0, 1);
    const sigma = Math.max(1, (0.006 + 0.034 * soft) * lay.ph), k = 0.5 + soft;
    gl.useProgram(P);
    gl.uniform2f(P.u.u_res, this.W, this.H); gl.uniform4f(P.u.u_rect, 0, lay.y0, 0, lay.y0 + lay.ph);
    gl.uniform4f(P.u.u_xs, A.x0 + dx, A.x1 + dx, B.x0 + dx, B.x1 + dx); gl.uniform2f(P.u.u_w, wa, wb);
    gl.uniform2f(P.u.u_off, 0.004 * lay.ph * k, 0.011 * lay.ph * k); gl.uniform1f(P.u.u_sigma, sigma); gl.uniform1f(P.u.u_alpha, 0.7 * amt * this.scoreFade);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.DYNAMIC_DRAW);
    this.attribs(1); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }
  drawCurl(lay, front, back) {
    const gl = this.gl, P = this.pCurl;
    gl.useProgram(P); gl.uniform2f(P.u.u_res, this.W, this.H); gl.uniform1f(P.u.u_gutter, gutterAmt());
    gl.uniform1f(P.u.u_div, dividerAmt()); gl.uniform1f(P.u.u_pw, lay.pw);
    gl.uniform1f(P.u.u_fade, this.scoreFade); gl.uniform3f(P.u.u_bg, this.bgRgb[0], this.bgRgb[1], this.bgRgb[2]);
    gl.uniform1f(P.u.u_inv, S.set.invert ? 1 : 0); gl.uniform3f(P.u.u_ink, this.inkRgb[0], this.inkRgb[1], this.inkRgb[2]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, front || this.white); gl.uniform1i(P.u.u_front, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, back || this.white); gl.uniform1i(P.u.u_back, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.bufferData(gl.ARRAY_BUFFER, this.curlData, gl.DYNAMIC_DRAW);
    this.attribs(4);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 8);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 32, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES, this.idxCount, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.DEPTH_TEST);
  }
  /* Fade the whole picture to black by laying a see-through black sheet over it. */
  drawFade(a) {
    if (!(a > 0.001)) return;
    const gl = this.gl, P = this.pBox;
    gl.useProgram(P);
    gl.uniform2f(P.u.u_res, this.W, this.H); gl.uniform4f(P.u.u_rect, -1e5, -1e5, 1e5, 1e5);
    gl.uniform4f(P.u.u_xs, -1e5, 1e5, 0, 0); gl.uniform2f(P.u.u_w, 1, 0);
    gl.uniform2f(P.u.u_off, 0, 0); gl.uniform1f(P.u.u_sigma, 1); gl.uniform1f(P.u.u_alpha, Math.min(1, a));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.DYNAMIC_DRAW);
    this.attribs(1); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }
  render(st) {
    const gl = this.gl, lay = this.layout(); this.lay = lay; this.checkSize(lay);
    gl.viewport(0, 0, this.W, this.H);
    const bg = hexToRgb(S.set.bg); gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const sp = S.spreads[st.spread]; if (!sp) return;
    const fade = st.fade == null ? 1 : st.fade, scoreOnly = S.set.fadeStyle === 'score';
    this.scoreFade = scoreOnly ? fade : 1; this.bgRgb = bg; this.inkRgb = hexToRgb(S.set.ink);
    const nx = st.flip != null ? S.spreads[st.spread + 1] : null;
    const mode = S.set.transition, slide = !!nx && mode === 'slide';
    const credA = creditsAlpha(st.t);        // 1 normally; fades to 0 at the credits' end marker
    const sw = i => !isSheet(i) ? 0 : i === BLANK ? credA : 1;      // how much shadow a page casts: none for empty space, and the blank sheet beside the credits fades with them
    const drawPage = (idx, x, side) => {
      const t = this.tex_(idx); if (!t) return;
      const k = idx === CARD || idx === BLANK ? credA : 1;      // the credits text, and the blank sheet beside it, fade away together
      if (k <= 0.002) return;
      const base = this.scoreFade; this.scoreFade = base * k;
      this.drawQuad(t, x, lay.y0, lay.pw, lay.ph, side, idx === CARD);
      this.scoreFade = base;
    };
    /* one half of the score: its x-range, and how strongly it casts a shadow (0 when nothing is there) */
    const half = (side, w) => side === 0 ? { x0: lay.x0, x1: lay.cx, w } : { x0: lay.cx, x1: lay.cx + lay.pw, w };
    const reveal = !!nx && !!nx.credits && sp[1] === -1;     // the last page stands alone, so there is no page to turn: the credits fade up beside it
    if (reveal) {
      const p = 0.5 - 0.5 * Math.cos(Math.PI * st.flip), base = this.scoreFade;
      this.useShadow = false;
      this.drawScoreShadow(lay, half(0, sw(sp[0])), half(1, 0));
      drawPage(sp[0], lay.x0, -1);
      this.scoreFade = base * p; drawPage(CARD, lay.cx, 1); this.scoreFade = base;
    } else if (slide) {
      /* Slide: one spread stays put and the other slides over it, like stacked sheets. "In" brings the next spread in
         from the right on top of the current one; "Out" slides the current spread off to the left, uncovering the next. */
      const p = 0.5 - 0.5 * Math.cos(Math.PI * st.flip), dist = this.W - lay.xs, inMode = S.set.slideDir !== 'out';
      const under = inMode ? sp : nx, over = inMode ? nx : sp, dOver = inMode ? (1 - p) * dist : -p * dist, k = inMode ? 1 - p : p;
      const base = this.scoreFade, cover = s => isSheet(over[s]) ? 1 : k;    // a page the moving spread does not cover fades instead of popping
      this.useShadow = false;
      this.drawScoreShadow(lay, half(0, sw(under[0]) * cover(0)), half(1, sw(under[1]) * cover(1)));
      [0, 1].forEach(s => {
        if (under[s] === -1) return;
        this.scoreFade = base * cover(s);
        drawPage(under[s], s ? lay.cx : lay.x0, s ? 1 : -1);
      });
      this.scoreFade = base;
      this.drawScoreShadow(lay, half(0, sw(over[0])), half(1, sw(over[1])), dOver);
      drawPage(over[0], lay.x0 + dOver, -1); drawPage(over[1], lay.cx + dOver, 1);
    } else {
      if (st.flip == null || !nx) {
        this.drawScoreShadow(lay, half(0, sw(sp[0])), half(1, sw(sp[1])));
        this.useShadow = false;
        drawPage(sp[0], lay.x0, -1); drawPage(sp[1], lay.cx, 1);
      } else {
        const p = 0.5 - 0.5 * Math.cos(Math.PI * st.flip);
        /* Peel (a single page): the sheet lifts and curls from its free edge, then is drawn off to the left, carrying its shadow, so the next page
           is already in place beneath it and nothing has to melt away; it has left the frame by the time the turn ends */
        const peel = singleOn(), pu = clamp((p - 0.2) / 0.8, 0, 1), shift = peel ? (lay.cx + 0.12 * lay.pw) * pu * pu : 0;
        this.buildCurl(lay, p, shift);
        /* The turning page's free edge decides how much of each half is covered. A half that was empty only gets a
           shadow once the turned page has reached it, and a half that is emptying loses its shadow as the page lifts. */
        const edge = this.curlData[(Math.floor(this.M / 2) * (this.N + 1) + this.N) * 8];
        const L = sw(sp[0]) ? half(0, sw(sp[0])) : sw(nx[0]) ? { x0: clamp(edge, lay.x0, lay.cx), x1: lay.cx, w: sw(nx[0]) } : half(0, 0);
        const R = sw(nx[1]) ? half(1, sw(nx[1])) : sw(sp[1]) ? { x0: lay.cx, x1: clamp(edge, lay.cx, lay.cx + lay.pw), w: sw(sp[1]) } : half(1, 0);
        this.drawScoreShadow(lay, L, R);
        if (peel) { const hx = lay.cx - shift, lo = Math.min(edge, hx), hi = Math.min(Math.max(edge, hx), lay.cx); if (hi > lo) this.drawScoreShadow(lay, { x0: lo, x1: hi, w: 0.8 }, half(1, 0)); }          // the sheet's own shadow where it hangs past the page beneath
        this.updateShadowMap(lay);
        this.useShadow = true;
        drawPage(sp[0], lay.x0, -1); drawPage(nx[1], lay.cx, 1);
        this.useShadow = false;
        this.drawCurl(lay, isSheet(sp[1]) ? this.tex_(sp[1]) : null, isSheet(nx[0]) ? this.tex_(nx[0]) : null);
      }
    }
    if (!scoreOnly) this.drawFade(1 - fade);
  }
  destroy() { try { if (this.cardTex) this.gl.deleteTexture(this.cardTex); this.clearTextures(); const e = this.gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } catch (e) {} }
}

/* ====================================================================
   Stage (preview)
   ==================================================================== */
let previewR = null, stageDirty = true;
const stageCanvas = $('#stage');
let fsGliding = false;          // full screen is gliding the picture by transform (see fsGlide)
function outputSize() {
  const ar = ASPECTS[S.set.aspect] || 16 / 9, short = +S.set.res;
  let W, H;
  if (ar >= 1) { H = short; W = Math.round(short * ar / 2) * 2; } else { W = short; H = Math.round(short / ar / 2) * 2; }
  return { W, H };
}
/* Changing the video's shape: the new frame simply fades in, quickly */
function morphStage(apply) {
  apply();
  if (S.pdf && !reducedMotion() && stageCanvas.animate) stageCanvas.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: EASE_OUT });
}
function layoutStage() {
  if (fsGliding) return;          // the frame is moving by transform, so its rectangle is not where it lays out: the picture is fitted once, as the glide begins and as it ends
  const wrap = $('#stageWrap'), r = wrap.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  const ar = ASPECTS[S.set.aspect] || 16 / 9;
  const fit = h => { let w = r.width - 2, hh = w / ar; if (hh > h) { hh = h; w = hh * ar; } return [Math.floor(w), Math.floor(hh)]; };
  const fz = clamp(Math.floor(r.height - 6), 22, 32), fm = clamp(Math.floor((r.height - fz) / 2), 3, 10), need = fz + fm + 2;          // in a very short window the button gets smaller and closer to the edge instead of hanging out of the box
  if (SZ.ar !== S.set.aspect) { if (SZ.ar != null && SZ.z !== 1) szReset(false); SZ.ar = S.set.aspect; }          // a new page size starts at Fit
  const sw = $('#stageStrip').offsetWidth || 150;
  wrap.style.setProperty('--fs', fz + 'px'); wrap.style.setProperty('--fsm', fm + 'px');
  let [cw, ch] = fit(r.height - 2), room = 0;
  if (!$('#stageStrip').hidden && !$('.app').classList.contains('fs') && (r.width - cw) / 2 < sw + fm && (r.height - ch) / 2 < need && r.height > need + 40) { room = need; [cw, ch] = fit(r.height - 2 - room); }          // the zoom and full screen strip sits in the corner: where the picture would reach it, the picture gives it a strip of its own below
  wrap.style.paddingBottom = room ? room + 'px' : '';
  stageCanvas.style.width = cw + 'px'; stageCanvas.style.height = ch + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = Math.round(cw * dpr), H = Math.round(ch * dpr);
  const mx = Math.max(W, H); if (mx > 2200) { W = Math.round(W * 2200 / mx); H = Math.round(H * 2200 / mx); }
  if (W !== stageCanvas.width || H !== stageCanvas.height) { previewR.resize(W, H); }
  stageDirty = true; if (SZ.z !== 1) { szClamp(); szApply(false); }
}
/* ---- zoom and fit for the stage: view only (never saved, exported, or a History step), a transform on the picture ---- */
const SZ = { z: 1, x: 0, y: 0, ar: null }, SZ_MAX = 4;
function szClamp() {
  const cv = stageCanvas, w = $('#stageWrap'), mx = Math.max(0, (cv.offsetWidth * SZ.z - w.clientWidth) / 2 + 60), my = Math.max(0, (cv.offsetHeight * SZ.z - w.clientHeight) / 2 + 60);
  SZ.x = clamp(SZ.x, -mx, mx); SZ.y = clamp(SZ.y, -my, my); if (SZ.z <= 1.001) { SZ.z = 1; SZ.x = 0; SZ.y = 0; }
}
function szApply(smooth) {
  const cv = stageCanvas; cv.style.transition = smooth && !reducedMotion() ? 'transform .34s cubic-bezier(.22,1,.36,1)' : 'none';
  cv.style.transform = SZ.z === 1 ? '' : 'translate(' + SZ.x.toFixed(1) + 'px,' + SZ.y.toFixed(1) + 'px) scale(' + SZ.z.toFixed(3) + ')'; $('#stageWrap').classList.toggle('zoomed', SZ.z > 1);
  $('#szOut').disabled = $('#szFit').disabled = SZ.z <= 1; $('#szIn').disabled = SZ.z >= SZ_MAX;
}
function szAt(nz, cx, cy, smooth) {          // the point under (cx, cy) stays where it is
  const cv = stageCanvas, r = $('#stageWrap').getBoundingClientRect(); nz = clamp(nz, 1, SZ_MAX);
  const mx = r.left + cv.offsetLeft + cv.offsetWidth / 2, my = r.top + cv.offsetTop + cv.offsetHeight / 2; if (cx == null) { cx = mx; cy = my; }
  const ox = cx - mx, oy = cy - my, px = (ox - SZ.x) / SZ.z, py = (oy - SZ.y) / SZ.z;
  SZ.x = ox - nz * px; SZ.y = oy - nz * py; SZ.z = nz; szClamp(); szApply(smooth);
}
function szReset(smooth) { SZ.z = 1; SZ.x = SZ.y = 0; szApply(smooth); }
function szBind() {
  const wrap = $('#stageWrap'), ptr = new Map(); let pan = null, pinch = null, gz = 1;
  const live = e => S.pdf && !e.target.closest('#stageStrip, .empty');
  $('#szIn').addEventListener('click', () => szAt(SZ.z * 1.6, null, null, true)); $('#szOut').addEventListener('click', () => szAt(SZ.z / 1.6, null, null, true)); $('#szFit').addEventListener('click', () => szReset(true));
  wrap.addEventListener('wheel', e => {
    if (!live(e)) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); e.stopPropagation(); szAt(SZ.z * Math.exp(-e.deltaY * 0.012), e.clientX, e.clientY, false); }          // a pinch over the picture zooms the picture only; the timeline has its own
    else if (SZ.z > 1) { e.preventDefault(); SZ.x -= e.deltaX; SZ.y -= e.deltaY; szClamp(); szApply(false); }
  }, { passive: false });
  wrap.addEventListener('gesturestart', e => { if (!live(e)) return; e.preventDefault(); e.stopPropagation(); gz = SZ.z; }); wrap.addEventListener('gesturechange', e => { if (!live(e)) return; e.preventDefault(); e.stopPropagation(); szAt(gz * e.scale, e.clientX, e.clientY, false); });          // Safari's pinch
  wrap.addEventListener('pointerdown', e => {
    if (!live(e)) return; ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z: SZ.z }; pan = null; wrap.setPointerCapture(e.pointerId); }
    else if (SZ.z > 1 && e.button === 0) { pan = { x: e.clientX, y: e.clientY, ox: SZ.x, oy: SZ.y }; wrap.setPointerCapture(e.pointerId); wrap.classList.add('panning'); }
  });
  wrap.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptr.size >= 2) { const [a, b] = [...ptr.values()]; szAt(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, false); }
    else if (pan) { SZ.x = pan.ox + e.clientX - pan.x; SZ.y = pan.oy + e.clientY - pan.y; szClamp(); szApply(false); }
  });
  const up = e => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; if (!ptr.size) { pan = null; wrap.classList.remove('panning'); } };
  wrap.addEventListener('pointerup', up); wrap.addEventListener('pointercancel', up);
}
function prefetchAround() {
  if (!previewR || !S.spreads.length) return;
  const st = frameState(S.time), want = [];
  for (let i = st.spread - 1; i <= st.spread + 2; i++) { const sp = S.spreads[i]; if (sp) want.push(sp[0], sp[1]); }
  // current first so it is rendered before neighbors
  const cur = pagesFor(st); previewR.prefetch(cur.concat(want));
}
let lastSpreadShown = -1, fadeLookAt = NaN;          // the time you last scrubbed to
function drawStage() {
  const st = frameState(S.time);
  if (!Transport.playing && fadeLookAt !== S.time) st.fade = 1;      // the paused preview shows the full picture, except where you scrubbed to: there it shows the fade under the playhead
  previewR.render(st);
  if (st.spread !== lastSpreadShown) { lastSpreadShown = st.spread; prefetchAround(); updateInfo(); }
}

/* ====================================================================
   Timeline (canvas)
   ==================================================================== */
const TL = {
  canvas: $('#tl'), scroller: $('#tlScroll'), inner: $('#tlInner'), dpr: 1, vw: 800, h: 190,
  rulerH: 26, trackY: 34, trackH: 64, waveY: 108, waveH: 70,
  staticDirty: true, overlayDirty: true, drag: null, hover: -1, hoverX: 0, C: {}, sel: [], selN: 0, box: null
};
TL.ctx = TL.canvas.getContext('2d');
TL.sc = document.createElement('canvas'); TL.sctx = TL.sc.getContext('2d');

function readColors() {
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  TL.C = { bg: g('--panel'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), block: g('--block'), wave: g('--wave'), turn: g('--turn'), fade: g('--fade'), cred: g('--cred'), credSoft: g('--cred-soft'), turnSoft: g('--turn-soft'), play: g('--play'), accent: g('--accent'), panel2: g('--panel2') };
  TL.staticDirty = true;
}
/* The timeline's x axis: audio time, with a little empty room at both ends where the video's start and end handles can be
   dragged outward. While a handle is being dragged the axis is frozen, so the handle follows the pointer. */
const TL_ROOM = 36;
const tlLo = () => TL.drag && TL.drag.kind === 'trim' ? TL.drag.lo : TL.hold ? Math.min(TL.hold.lo, Math.min(S.vStart, 0)) : Math.min(S.vStart, 0);
const tlHi = () => TL.drag && TL.drag.kind === 'trim' ? TL.drag.hi : TL.hold ? Math.max(TL.hold.hi, vEnd(), S.audio ? S.audio.duration : 0) : Math.max(vEnd(), S.audio ? S.audio.duration : 0);
const tlInnerWidth = () => Math.max(TL.vw + (TL.hold ? TL.hold.pad || 0 : 0), Math.ceil(2 * TL_ROOM + (tlHi() - tlLo()) * S.pxPerSec - 1e-6));          // while a glide runs, a zoomed-out axis (narrower than the window) keeps the scroll room the glide needs to travel
const t2x = t => TL_ROOM + (t - tlLo()) * S.pxPerSec - TL.scroller.scrollLeft;
const x2t = x => (x + TL.scroller.scrollLeft - TL_ROOM) / S.pxPerSec + tlLo();
/* Fit shows the video, bracket to bracket (the axis still holds the whole audio, so the rest is a scroll away). A dragged bracket holds the span it started from. */
const fitLo = () => TL.drag && TL.drag.kind === 'trim' ? TL.drag.fitLo : S.vStart;
const fitHi = () => TL.drag && TL.drag.kind === 'trim' ? TL.drag.fitHi : vEnd();
const fitPps = () => clamp((TL.vw - 2 * TL_ROOM) / Math.max(1, fitHi() - fitLo()), 1, 400);
const fitScroll = () => { TL.scroller.scrollLeft = Math.max(0, (fitLo() - tlLo()) * S.pxPerSec); };
function layoutTimeline() {
  tlGlideStop();
  const sc = TL.scroller, vw = Math.max(200, sc.clientWidth), h = Math.max(150, sc.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  TL.dpr = dpr; TL.vw = vw; TL.h = h;
  const cw = Math.round(vw * dpr), ch = Math.round(h * dpr);          // setting a canvas size wipes it, so only do it when the size really changed
  if (TL.canvas.width !== cw) TL.canvas.width = cw;
  if (TL.canvas.height !== ch) TL.canvas.height = ch;
  TL.canvas.style.width = vw + 'px'; TL.canvas.style.height = h + 'px';
  if (TL.sc.width !== cw) TL.sc.width = cw;
  if (TL.sc.height !== ch) TL.sc.height = ch;
  TL.trackH = clamp(Math.round(h * 0.42), 68, 92); TL.waveY = TL.trackY + TL.trackH + 10; TL.waveH = Math.max(36, h - TL.waveY - 8);
  if (S.fitMode) { setZoom(fitPps(), 0, true); fitScroll(); }
  else TL.inner.style.width = tlInnerWidth() + 'px';
  TL.staticDirty = true;
}
/* A bracket that lands (or is double-clicked home) changes what the timeline shows: what Fit fits, or how much empty room the axis keeps. The view glides from the picture it had to the one it now has while the bracket stays on its time,
   so the bracket and the view are one motion, not a jump followed by a slide. The axis keeps the room of both pictures until it lands. */
const tlMap = (lo = tlLo()) => ({ b: S.pxPerSec, a: TL_ROOM - lo * S.pxPerSec - TL.scroller.scrollLeft });
function tlGlideStop() {          // ends a glide where it is: what is on screen stays, and the axis goes back to its own room
  if (!TL.hold && !TL.glideId) return; cancelAnimationFrame(TL.glideId); TL.glideId = 0; TL.glideT = null; TL.scroller.classList.remove('gliding');
  if (TL.hold) { const m = tlMap(); TL.hold = null; if (!TL.drag) { TL.inner.style.width = tlInnerWidth() + 'px'; TL.scroller.scrollLeft = Math.max(0, TL_ROOM - tlLo() * m.b - m.a); } TL.staticDirty = true; }
}
function tlGlide(from) {
  tlGlideStop();
  const to = tlMap(); if (reducedMotion() || (Math.abs(to.a - from.a) < 1 && Math.abs(to.b / from.b - 1) < 1e-3)) return;
  TL.hold = { lo: Math.min(tlLo(), from.lo), hi: Math.max(tlHi(), from.hi), pad: 0 }; TL.hold.pad = Math.max(0, Math.ceil(TL_ROOM - tlLo() * to.b - to.a)); const s1 = S.vStart, e1 = vEnd(), lerp = (u, v, k) => u + (v - u) * k;
  const put = m => { S.pxPerSec = m.b; TL.inner.style.width = tlInnerWidth() + 'px'; TL.scroller.scrollLeft = Math.max(0, TL_ROOM - tlLo() * m.b - m.a); $('#zoom').value = zoomToSlider(m.b); paintRange($('#zoom')); TL.staticDirty = true; };
  const t0 = performance.now(), D = 700; TL.scroller.classList.add('gliding'); put(from); TL.glideT = { s: from.s, e: from.e };
  (function step(now) {
    if (TL.drag) { tlGlideStop(); return; }
    const k = clamp((now - t0) / D, 0, 1), e = .5 - Math.cos(Math.PI * k) / 2;
    TL.glideT = { s: lerp(from.s, s1, e), e: lerp(from.e, e1, e) };          // the brackets travel in time on the same curve as the view, so the two read as one motion
    if (k >= 1) { put(to); TL.hold = null; TL.glideId = 0; TL.glideT = null; put(to); TL.scroller.classList.remove('gliding'); return; }
    put({ b: Math.exp(Math.log(from.b) + (Math.log(to.b) - Math.log(from.b)) * e), a: from.a + (to.a - from.a) * e }); TL.glideId = requestAnimationFrame(step);
  })(t0);
}
function zoomToSlider(pps) { const lo = Math.log(1), hi = Math.log(400); return Math.round(100 * (Math.log(pps) - lo) / (hi - lo)); }
function sliderToZoom(v) { const lo = Math.log(1), hi = Math.log(400); return Math.exp(lo + (hi - lo) * v / 100); }
function setZoom(pps, anchorX, keepFit) {
  tlGlideStop();
  const sc = TL.scroller; if (anchorX == null) anchorX = TL.vw / 2;
  const ta = x2t(anchorX);
  S.pxPerSec = clamp(pps, 1, 400);
  TL.inner.style.width = tlInnerWidth() + 'px';
  sc.scrollLeft = (ta - tlLo()) * S.pxPerSec + TL_ROOM - anchorX;
  $('#zoom').value = zoomToSlider(S.pxPerSec); paintRange($('#zoom'));
  if (!keepFit) S.fitMode = false;
  TL.staticDirty = true;
}
/* Fit: the video, bracket to bracket, fills the window less the room at each end (and it stays fitted when the window resizes); the rest of the audio is a scroll away */
function zoomFit() { layoutTimeline(); S.fitMode = true; setZoom(fitPps(), 0, true); fitScroll(); }

function drawRuler(c) {
  const { C, vw, rulerH } = TL;
  if (TL.glass) { c.save(); c.globalAlpha = 0.07; c.fillStyle = C.ink; c.fillRect(0, 0, vw, rulerH); c.restore(); } else { c.fillStyle = C.panel2; c.fillRect(0, 0, vw, rulerH); }
  c.strokeStyle = C.line; c.beginPath(); c.moveTo(0, rulerH - .5); c.lineTo(vw, rulerH - .5); c.stroke();
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200];
  let step = steps.find(s => s * S.pxPerSec >= 80) || 1200;
  const base = S.vStart, t0 = Math.max(0, x2t(0) - base), t1 = Math.min(duration(), x2t(vw) - base);   // the ruler counts video time
  c.font = '11px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle'; c.fillStyle = C.muted; c.strokeStyle = C.muted;
  const minor = step / 5;
  c.globalAlpha = .45; c.beginPath();
  for (let t = Math.floor(t0 / minor) * minor; t <= t1 + 1e-6; t += minor) { if (t < 0) continue; const x = Math.round(t2x(base + t)) + .5; c.moveTo(x, rulerH - 5); c.lineTo(x, rulerH); }
  c.stroke(); c.globalAlpha = 1;
  for (let t = Math.floor(t0 / step) * step; t <= t1 + 1e-6; t += step) {
    if (t < 0) continue;
    const x = Math.round(t2x(base + t)) + .5;
    c.beginPath(); c.moveTo(x, rulerH - 10); c.lineTo(x, rulerH); c.stroke();
    if (t > 0) c.fillText(fmt(t, step < 1 ? 1 : 0).replace(/\.0$/, ''), x + 4, 11);          // the 0:00 under the start grip is drawn with the grip (drawTrimHandles), so it moves with it
  }
}
function roundRect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
/* A trim handle drawn as a bracket: "[" for a start (dir 1), "]" for an end (dir -1). It wraps AROUND the content: its inner edge is the
   content's own outline (a rectangle whose corners have radius R), and the bracket is a band of thickness t just outside it, so the curves are
   concentric and match exactly. x is the content's edge, y0 / y1 its top and bottom, arm how far the arms reach in over the content. */
function drawBracket(c, x, y0, y1, dir, t, arm, R) {
  R = Math.min(R, (y1 - y0) / 2 - 1); const PI = Math.PI;
  c.save(); c.translate(x, 0); if (dir < 0) c.scale(-1, 1);
  c.beginPath();
  c.moveTo(arm, y0 - t); c.lineTo(R, y0 - t);
  c.arc(R, y0 + R, R + t, -PI / 2, PI, true);               // outer top-left corner
  c.lineTo(-t, y1 - R);
  c.arc(R, y1 - R, R + t, PI, PI / 2, true);                // outer bottom-left corner
  c.lineTo(arm, y1 + t); c.lineTo(arm, y1); c.lineTo(R, y1);
  c.arc(R, y1 - R, R, PI / 2, PI, false);                   // inner bottom-left corner (the content's own curve)
  c.lineTo(0, y0 + R);
  c.arc(R, y0 + R, R, PI, PI * 1.5, false);                 // inner top-left corner
  c.lineTo(arm, y0);
  c.closePath(); c.fill(); c.restore();
}
/* where the first and last page blocks sit: they follow the sliding trim brackets (so cutting the audio in the Audio Editor moves everything together),
   except while the very first media is arriving, when the blocks stay put and the brackets ride along with the reveal */
function trimShown() {
  const T = TL.trimD;
  return !T || TL.intro || (TL.drag && TL.drag.kind === 'trim') || reducedMotion() ? { s: S.vStart, e: vEnd() } : T;
}
function spreadBounds(i) {
  const n = S.spreads.length, sh = trimShown();
  return [i === 0 ? sh.s : shownTurn(i - 1), i === n - 1 ? sh.e : shownTurn(i)];
}
/* the waveform and page blocks ease in when they first appear */
const REVEAL = { wave: 1400, blocks: 900 };
function rvStart(k) {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  (TL.rv || (TL.rv = {}))[k] = performance.now();
  if (!TL.introSeen) { TL.introSeen = true; TL.intro = { t0: performance.now(), D: REVEAL[k] }; }        // the first media to arrive sets the pace the trim brackets ride along with
  else TL.snapTrim = true;                                                                                // later media re-space the page turns at once, so the brackets stay glued to the end of the blocks instead of sliding again
}
/* one shared sweep for everything that arrives: it starts fast and slows, and each block or slice of waveform grows as the sweep reaches it */
const rvFront = p => 1 - Math.pow(1 - p, 3);
const rvLead = p => Math.min(1, 1.35 * rvFront(p));          // how far along the media the sweep (and the trim bracket riding it) has got
const rvGrow = (p, u) => clamp((1.35 * rvFront(p) - u) / 0.35, 0, 1);      // each block or slice of waveform grows just after the sweep passes it
function rvProgress(k) { const t0 = TL.rv && TL.rv[k]; if (t0 == null) return 1; const p = (performance.now() - t0) / REVEAL[k]; if (p >= 1) { TL.rv[k] = null; return 1; } return p; }
function rvActive() { return !!TL.rv && Object.keys(TL.rv).some(k => TL.rv[k] != null); }
function drawBlocks(c) {
  const { C, vw, trackY, trackH } = TL, n = S.spreads.length, pa = S.pdf ? S.pdf.aspect : .77;
  const th = Math.max(18, trackH - 48), tw = th * pa, bp = rvProgress('blocks');      // smaller pictures, with the page numbers and times stacked underneath them
  for (let i = 0; i < n; i++) {
    const [a, b] = spreadBounds(i);
    const x0 = t2x(a), x1 = t2x(b);
    if (x1 < -4 || x0 > vw + 4) continue;
    c.save();
    if (bp < 1) { const k = rvGrow(bp, clamp((a - S.vStart) / Math.max(1e-6, vEnd() - S.vStart), 0, 1)), e = 1 - Math.pow(1 - k, 3); c.globalAlpha = e; c.translate(0, (1 - e) * 8); }       // blocks rise as the sweep reaches them
    roundRect(c, x0 + 1, trackY, Math.max(2, x1 - x0 - 2), trackH, 7); c.fillStyle = C.block; c.fill(); c.strokeStyle = S.spreads[i].credits ? C.cred : C.line; c.stroke(); c.clip();
    const sp = S.spreads[i], tx = Math.max(x0 + 7, 7);
    const labelX = tx + 1;                       // the text sits under the page pictures, at the block's left edge
    let col = 0;                                   // a page that is alone in its spread takes the front spot
    [0, 1].forEach(k => {
      const idx = sp[k]; if (idx < 0) return;
      const x = tx + col++ * (tw + 2), y = trackY + 5, th_ = slotThumb(idx);
      if (th_) c.drawImage(th_, x, y, tw, th); else { c.fillStyle = '#fff'; c.fillRect(x, y, tw, th); }
      c.strokeStyle = 'rgba(0,0,0,.25)'; c.strokeRect(x + .5, y + .5, tw - 1, th - 1);
    });
    let lbl = sp.credits ? 'Credits' : (sp[0] >= 0 && sp[1] >= 0) ? 'pp. ' + pageNo(sp[0]) + '–' + pageNo(sp[1]) : 'p. ' + pageNo(sp[0] >= 0 ? sp[0] : sp[1]);
    c.fillStyle = C.ink; c.font = '600 12px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'top';
    if (c.measureText(lbl).width > x1 - labelX - 8) lbl = lbl.replace('Pages ', 'pp. ').replace('Page ', 'p. ');       // a narrow block gets the short form
    c.fillText(lbl, labelX, trackY + 5 + th + 6);
    c.fillStyle = C.muted; c.font = '11px "Instrument Sans",system-ui,sans-serif';
    c.fillText(fmt(a - S.vStart) + ' – ' + fmt(b - S.vStart), labelX, trackY + 5 + th + 21);
    c.restore();
  }
}
/* a lane: white-ish with a faint tint and a hairline edge, so the PDF row and the audio row read as two separate rows */
function drawLane(c, y, h) {
  const { C, vw } = TL;
  roundRect(c, 0.5, y + 0.5, vw - 1, h - 1, 7);
  if (!TL.glass) { c.fillStyle = C.panel2; c.fill(); }
  c.save(); c.globalAlpha = TL.glass ? 0.09 : 0.06; c.fillStyle = C.ink; c.fill(); c.restore();
  c.save(); c.globalAlpha = TL.glass ? 0.55 : 1; c.strokeStyle = C.line; c.lineWidth = 1; c.stroke(); c.restore();
}
function drawWave(c) {
  const { C, vw, waveY, waveH } = TL;
  drawLane(c, waveY, waveH);
  if (!S.audio) {
    c.fillStyle = C.muted; c.font = '13px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('Add your audio to see its waveform here', vw / 2, waveY + waveH / 2); c.textAlign = 'left'; return;
  }
  const d = aeFromApp(), pk = aeShownPeaks(d), G = audioGain(), cap = limOn(d) ? Math.pow(10, (LIM_CEIL - LIM_GUARD) / 20) : 0, cy = waveY + waveH / 2, half = waveH / 2 - 3;          // the sound that comes out, at its real level against full scale (as the Audio Editor draws it)
  c.fillStyle = C.wave;
  const endX = t2x(S.audio.duration), wp = rvProgress('wave');
  for (let x = 0; x < vw; x++) {
    if (x > endX) break;
    const t0 = x2t(x), t1 = x2t(x + 1); if (t1 < 0) continue;
    let i0 = Math.max(0, Math.floor(t0 * 100)), i1 = Math.min(pk.length - 1, Math.max(i0, Math.ceil(t1 * 100)));
    let m = 0; for (let i = i0; i <= i1; i++) if (pk[i] > m) m = pk[i];
    let g = 1; if (wp < 1) { const k = rvGrow(wp, x / Math.max(1, endX)); g = 1 - Math.pow(1 - k, 3); }       // the waveform grows in from the left, on the same sweep as everything else
    const a = Math.max(1, Math.min(1, cap ? Math.min(cap, m * G) : m * G) * half * g);
    c.fillRect(x, cy - a, 1, a * 2);
  }
}
/* markers swell when hovered and a bit more when grabbed, on a small spring (the same feel as the buttons) */
function hsGet(key, target) {
  const hs = TL.hs || (TL.hs = {}), s = hs[key] || (hs[key] = { x: 1, v: 0, t: 1 }); s.t = target;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { s.x = target; s.v = 0; }
  return s.x;
}
function hsStep(dt) {
  if (!TL.hs) return false; let moving = false;
  for (const k in TL.hs) {
    const s = TL.hs[k], w = s.t > 1.2 ? 2 * Math.PI / 0.4 : 2 * Math.PI / 0.3, z = s.t > 1.2 ? 0.8 : 1, a = -w * w * (s.x - s.t) - 2 * z * w * s.v;
    s.v += a * dt; s.x += s.v * dt;
    if (Math.abs(s.x - s.t) > 0.002 || Math.abs(s.v) > 0.02) moving = true; else { s.x = s.t; s.v = 0; }
  }
  return moving;
}
/* a selected turn gets a ring in the ink color, which reads on both themes, around its handle */
function selRing(c, x, cy, w, h, on) {
  if (!on) return;
  c.save(); c.strokeStyle = TL.C.ink; c.lineWidth = 2; c.globalAlpha = 1; roundRect(c, x - w / 2 - 3, cy - h / 2 - 3, w + 6, h + 6, 8); c.stroke(); c.restore();
}
function drawHandles(c) {
  const { C, vw, trackY, trackH, waveY, waveH } = TL, D = flipDur(), off = refOffset(), selSet = new Set(turnSel());
  for (let i = 0; i < S.turns.length; i++) {
    const t = shownTurn(i), x = t2x(t), bx0 = t2x(t - off), bx1 = t2x(t - off + D), ph = !!S.ph[i];
    if (bx1 < -20 || bx0 > vw + 20) continue;
    const isCr = hasCreditsSpread() && i === S.turns.length - 1, col = isCr ? C.cred : C.turn, soft = isCr ? C.credSoft : C.turnSoft;     // the credits marker has its own color
    const grabbed = !!(TL.drag && TL.drag.kind === 'turn' && TL.drag.i === i), sc = hsGet('t' + i, grabbed ? 1.16 : TL.hover === i ? 1.07 : 1), pw_ = 13 * sc, ph_ = 28 * sc, cy = trackY + trackH / 2;
    if (ph) {                                   // not placed yet: dashed
      c.globalAlpha = .75; c.strokeStyle = col; c.lineWidth = 1.5; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(x + .5, trackY - 3); c.lineTo(x + .5, waveY + waveH); c.stroke();
      roundRect(c, x - pw_ / 2, cy - ph_ / 2, pw_, ph_, 6); c.fillStyle = C.bg; c.fill(); c.stroke();
      c.setLineDash([]); c.lineWidth = 1; c.globalAlpha = 1; selRing(c, x, cy, pw_, ph_, selSet.has(i)); continue;
    }
    if (D > 0) { c.fillStyle = soft; c.fillRect(bx0, trackY, Math.max(1, bx1 - bx0), trackH); c.fillRect(bx0, waveY, Math.max(1, bx1 - bx0), waveH); }
    c.strokeStyle = col; c.globalAlpha = .55; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(x + .5, trackY + trackH); c.lineTo(x + .5, waveY + waveH); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    c.fillStyle = col; c.fillRect(x - 1, trackY - 3, 2, trackH + 6);
    c.save(); if (sc > 1.02) { c.shadowColor = col; c.shadowBlur = (sc - 1) * 60; }
    roundRect(c, x - pw_ / 2, cy - ph_ / 2, pw_, ph_, 6); c.fillStyle = col; c.fill(); c.restore();
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(x - 2 * sc, cy - 7 * sc); c.lineTo(x - 2 * sc, cy + 7 * sc); c.moveTo(x + 2 * sc, cy - 7 * sc); c.lineTo(x + 2 * sc, cy + 7 * sc); c.stroke(); c.lineWidth = 1;       // the grip lines move with the handle
    selRing(c, x, cy, pw_, ph_, selSet.has(i));
  }
}
/* a thin teal strip under the pages shows how long the credits are up; with "End credits early" a teal marker ends it */
function drawCredits(c) {
  if (!creditsAtEnd()) return;
  const { C, vw, trackY, trackH, waveY, waveH } = TL, early = creditsEarlyOn(), xs = t2x(creditsStart()), xe = t2x(early ? S.creditsEnd : vEnd());
  c.fillStyle = C.cred; c.globalAlpha = 0.8; c.fillRect(xs, trackY + trackH - 5, Math.max(2, xe - xs), 3); c.globalAlpha = 1;
}
function drawCreditsEnd(c) {
  if (!creditsAtEnd()) return;
  const { C, vw, trackY, trackH, waveY, waveH } = TL, early = creditsEarlyOn(), xe = t2x(early ? S.creditsEnd : vEnd());
  if (!early || xe < -20 || xe > vw + 20) return;
  const grabbed = !!(TL.drag && TL.drag.kind === 'credEnd'), sc = hsGet('cr', grabbed ? 1.16 : TL.hoverCr ? 1.07 : 1), pw_ = 13 * sc, ph_ = 28 * sc, cy = trackY + trackH / 2;
  c.strokeStyle = C.cred; c.globalAlpha = .55; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(xe + .5, trackY + trackH); c.lineTo(xe + .5, waveY + waveH); c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
  c.fillStyle = C.cred; c.fillRect(xe - 1, trackY - 3, 2, trackH + 6);
  c.save(); if (sc > 1.02) { c.shadowColor = C.cred; c.shadowBlur = (sc - 1) * 60; }
  roundRect(c, xe - pw_ / 2, cy - ph_ / 2, pw_, ph_, 6); c.fill(); c.restore();
  c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(xe - 2 * sc, cy - 7 * sc); c.lineTo(xe - 2 * sc, cy + 7 * sc); c.moveTo(xe + 2 * sc, cy - 7 * sc); c.lineTo(xe + 2 * sc, cy + 7 * sc); c.stroke(); c.lineWidth = 1;
}
function drawTimelineStatic() {
  const c = TL.sctx; c.setTransform(TL.dpr, 0, 0, TL.dpr, 0, 0); c.clearRect(0, 0, TL.vw, TL.h);
  if (!TL.glass) { c.fillStyle = TL.C.bg; c.fillRect(0, 0, TL.vw, TL.h); }      // in full screen the timeline is frosted glass, so the canvas stays clear
  drawWave(c);
  if (S.spreads.length) { drawBlocks(c); drawCredits(c); }
  else {
    drawLane(c, TL.trackY, TL.trackH);
    c.fillStyle = TL.C.muted; c.font = '13px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle';
    c.textAlign = 'center'; c.fillText('Add your PDF to see its layout here.', TL.vw / 2, TL.trackY + TL.trackH / 2); c.textAlign = 'left';
  }
  drawTrim(c);
  drawRuler(c);
}
/* The video's start and end: the parts of the timeline outside it are dimmed, with a bracket handle at each end. */
function trimText(which) {
  const v = which === 'start' ? S.vStart : vEnd() - audioLen();
  const a = Math.abs(v);
  const sec = a.toFixed(1) + 's';
  if (a < 0.05) return tx(which === 'start' ? 'vid.trim.startsame' : 'vid.trim.endsame');
  if (which === 'start') return tx(v < 0 ? 'vid.trim.startbefore' : 'vid.trim.startinto', { s: sec });
  return tx(v > 0 ? 'vid.trim.endafter' : 'vid.trim.endbefore', { s: sec });
}
function drawTrim(c) {
  const { C, vw, rulerH, trackY, trackH } = TL, H = TL.h, xs = t2x(S.vStart), xe = t2x(vEnd());
  const lightGlass = (() => { const m = /^#?([0-9a-f]{6})$/i.exec(String(C.ink).trim()); return !m || (parseInt(m[1].slice(0, 2), 16) * 0.3 + parseInt(m[1].slice(2, 4), 16) * 0.59 + parseInt(m[1].slice(4), 16) * 0.11) < 128; })();      // dark ink = light theme
  c.save(); c.globalAlpha = TL.glass ? 1 : 0.62; c.fillStyle = TL.glass ? (lightGlass ? 'rgba(24,30,50,.10)' : 'rgba(0,0,0,.16)') : C.bg;
  if (xs > 0) c.fillRect(0, rulerH, Math.min(xs, vw), H - rulerH);
  if (xe < vw) c.fillRect(Math.max(xe, 0), rulerH, vw - Math.max(xe, 0), H - rulerH);
  c.restore();
}
/* the video's own fade in and fade out (the main Fades setting, which fades the picture and the sound): one soft line that runs across both lanes, since they fade together */
function drawFadeLines(c) {
  const s = S.set, { vw, waveY, waveH, trackY, trackH, C } = TL; if (!(S.pdf || S.audio) || !s.fadesOn || (!s.fadeIn && !s.fadeOut)) return;
  const vs = S.vStart, ve = vEnd(); if (!(ve > vs)) return; const { Li, Lo } = fadeLens(s, vs, ve);
  const top = (S.spreads.length ? trackY : waveY) + 3, bot = (S.audio ? waveY + waveH : trackY + trackH) - 3;
  c.save(); c.beginPath(); c.rect(0, top - 2, vw, bot - top + 4); c.clip(); c.strokeStyle = C.fade; c.globalAlpha = 0.6; c.lineWidth = 1.5; c.lineJoin = c.lineCap = 'round';
  const ramp = (t0, t1) => {
    const x0 = t2x(t0), x1 = t2x(t1); if (x1 < 0 || x0 > vw) return;
    const n = Math.max(6, Math.ceil(Math.abs(x1 - x0) / 2)); c.beginPath();
    for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n, y = top + (1 - fadeAt(t)) * (bot - top); i ? c.lineTo(t2x(t), y) : c.moveTo(t2x(t), y); }
    c.stroke();
  };
  if (s.fadeIn && Li > 0) ramp(vs, vs + Li); if (s.fadeOut && Lo > 0) ramp(ve - Lo, ve);
  c.restore();
}
/* A dragged bracket follows the pointer (held inside the timeline, so it never leaves the window). Where it may go: the first and last page keep their moment on screen,
   and the axis may grow a little past its frozen ends; the edge scroll below grows it further. It snaps to the start of the audio and to the default end. */
function trimTo(d) {
  const x = clamp(d.rawX, 4, TL.vw - 4), lim = trimLimits(), room = TL_ROOM / S.pxPerSec, t = x2t(x) + d.dx;
  if (d.which === 'start') {
    let v = clamp(t, Math.min(d.lo - room, lim.startMax), lim.startMax);
    if (Math.abs(t2x(v) - t2x(0)) <= 6 && 0 <= lim.startMax) v = 0;          // snaps to the start of the audio
    if (v !== S.vStart) { d.moved = true; S.vStart = v; S.time = v; }
  } else {
    let v = clamp(t, lim.endMin, Math.max(d.hi + room, lim.endMin));
    if (Math.abs(t2x(v) - t2x(defaultEnd())) <= 6 && defaultEnd() >= lim.endMin) v = defaultEnd();   // snaps to the default end
    const nv = v === defaultEnd() ? null : v;
    if (nv !== S.vEndSet) { d.moved = true; S.vEndSet = nv; S.time = Math.max(S.vStart, v - 0.001); }
  }
  TL.staticDirty = true; TL.overlayDirty = true; stageDirty = true; updateTimeUI(true);
}
/* Holding a bracket near either edge keeps scrolling the timeline that way, and grows it when there is no more of it: one drag can pull the start before the audio or the end past it.
   The speed eases up with how far the pointer is past the edge, and the handle stays under the pointer. Reduced motion takes the speed straight, with no easing. */
const TL_EDGE = 24, TL_EDGE_MAX = 2400, TL_EDGE_SPAN = 600;
function edgeStep(dt) {
  const d = TL.drag; if (!d || d.kind !== 'trim' || !d.moved) return false;
  const vw = TL.vw, sc = TL.scroller, pps = S.pxPerSec, left = d.rawX < TL_EDGE, right = d.rawX > vw - TL_EDGE;
  const depth = left ? (TL_EDGE - d.rawX) / TL_EDGE : right ? (d.rawX - (vw - TL_EDGE)) / TL_EDGE : 0;
  const want = (left ? -1 : 1) * Math.min(TL_EDGE_MAX, 320 * depth + 760 * depth * depth);
  d.ev = reducedMotion() ? want : d.ev + (want - d.ev) * Math.min(1, dt * 9);
  if (Math.abs(d.ev) < 2) { if (!want) d.ev = 0; return false; }
  const step = d.ev * dt + d.er, whole = Math.trunc(step); d.er = step - whole; if (!whole) return true;
  const aud = S.audio ? S.audio.duration : 0;
  if (whole < 0) {
    const need = -(sc.scrollLeft + whole);                                      // how much is missing to the left of the first pixel
    let ext = 0; if (need > 0) { const lo = Math.max(d.lo - need / pps, Math.min(d.lo, Math.min(0, S.vStart) - TL_EDGE_SPAN)); ext = (d.lo - lo) * pps; d.lo = lo; }
    TL.inner.style.width = tlInnerWidth() + 'px'; sc.scrollLeft = Math.max(0, sc.scrollLeft + ext + whole);
  } else {
    TL.inner.style.width = tlInnerWidth() + 'px';
    const over = sc.scrollLeft + whole - (sc.scrollWidth - sc.clientWidth);
    if (over > 0) { const hi = Math.min(d.hi + over / pps, Math.max(d.hi, Math.max(aud, vEnd()) + TL_EDGE_SPAN)); d.hi = hi; TL.inner.style.width = tlInnerWidth() + 'px'; }
    sc.scrollLeft = sc.scrollLeft + whole;
  }
  trimTo(d); return true;
}
/* The trim brackets move like real objects: a spring carries them (they ride the same sweep as the blocks and waveform while the first media arrives),
   and when they land they give a small bounce, the same feel as everything else that is dropped into place on this site.
   Positions are kept in time, so zooming never makes them lag. */
function trimStep(dt) {
  const s = S.vStart, e = vEnd(), T = TL.trimD || (TL.trimD = { s, e, vs: 0, ve: 0, bo: 0, bv: 0, ks: -1, ke: 1, big: false });
  const snap = () => { T.s = s; T.e = e; T.vs = T.ve = T.bo = T.bv = 0; };
  if (!(S.pdf || S.audio)) { TL.intro = null; TL.introSeen = false; snap(); return false; }
  if (TL.glideT) { T.s = TL.glideT.s; T.e = TL.glideT.e; T.vs = T.ve = T.bo = T.bv = 0; return true; }          // a glide (tlGlide) carries the brackets
  if ((TL.drag && TL.drag.kind === 'trim') || reducedMotion() || TL.snapTrim) { TL.intro = TL.snapTrim ? TL.intro : null; TL.snapTrim = false; snap(); return false; }
  let ts = s, te = e, w = 2 * Math.PI / 0.4, z = 0.92;
  if (TL.intro) { const p = (performance.now() - TL.intro.t0) / TL.intro.D; if (p >= 1) TL.intro = null; else { te = s + (e - s) * rvLead(Math.min(1, p + 0.05)); w = 2 * Math.PI / 0.2; z = 0.9; } }
  const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n, wb = 2 * Math.PI / 0.27, zb = 0.4;
  for (let i = 0; i < n; i++) {
    T.vs += (-w * w * (T.s - ts) - 2 * z * w * T.vs) * h; T.s += T.vs * h; T.ve += (-w * w * (T.e - te) - 2 * z * w * T.ve) * h; T.e += T.ve * h;
    T.bv += (-wb * wb * T.bo - 2 * zb * wb * T.bv) * h; T.bo += T.bv * h;                // the landing bounce is its own small spring
  }
  const pps = Math.abs(t2x(1) - t2x(0)), off = Math.max(Math.abs(T.s - ts), Math.abs(T.e - te)) * pps, spd = Math.max(Math.abs(T.vs), Math.abs(T.ve)) * pps;
  if (Math.abs(T.vs) * pps > 8) T.ks = Math.sign(T.vs); if (Math.abs(T.ve) * pps > 8) T.ke = Math.sign(T.ve);
  if (off > 6) T.big = true;
  if (off < 0.3 && spd < 4 && !TL.intro) {
    T.s = ts; T.e = te; T.vs = T.ve = 0;
    if (T.big) { T.big = false; T.bv = 70; T.bo = 0; }                                  // it has arrived: a very small bounce (about 2 px, in the direction it was travelling), in keeping with the site's other springs
  } else return true;
  if (Math.abs(T.bo) < 0.05 && Math.abs(T.bv) < 2) { T.bo = T.bv = 0; return false; }
  return true;
}
function drawTrimHandles(c) {
  const { C, vw, rulerH, trackY, trackH } = TL, H = TL.h, T = TL.trimD, bo = T ? T.bo : 0, xs = t2x(T ? T.s : S.vStart) + (T ? T.ks : 0) * bo, xe = t2x(T ? T.e : vEnd()) + (T ? T.ke : 0) * bo;
  const active = TL.drag && TL.drag.kind === 'trim' ? TL.drag.which : TL.hoverTrim, moving = !!T && (Math.abs(T.vs) + Math.abs(T.ve) > 1e-4 || Math.abs(T.bo) > 0.01);
  [['start', xs, 1], ['end', xe, -1]].forEach(([which, x, dir]) => {
    if (x < -14 || x > vw + 14) return;
    const hot = active === which, grabbed = !!(TL.drag && TL.drag.kind === 'trim' && TL.drag.which === which), sc = hsGet('trim-' + which, grabbed ? 1.12 : hot ? 1.05 : 1), tw = 8 * sc, th = 14 * sc, px = moving ? x : Math.round(x), bottom = TL.waveY + TL.waveH;
    c.save(); c.fillStyle = C.accent; if (hot) { c.shadowColor = 'rgba(63,85,230,.45)'; c.shadowBlur = 8 * sc; }
    c.fillRect(px - 1, 0, 2, bottom);          // the line runs from the ruler to the bottom of the track
    roundRect(c, dir > 0 ? px + 2 : px - 2 - tw, (rulerH - th) / 2, tw, th, 3 * sc); c.fill();          // the grip tab sits in the ruler
    if (dir > 0) { c.font = '11px "Instrument Sans",system-ui,sans-serif'; c.textBaseline = 'middle'; c.fillStyle = C.muted; c.fillText('0:00', px + tw + 6, 11); }          // the 0:00 sits just after the grip tab, so the tab never covers it; it slides with the tab
    c.restore();
  });
}
function drawTimeline() {
  if (TL.staticDirty) { drawTimelineStatic(); TL.staticDirty = false; }
  const c = TL.ctx, C = TL.C; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height); c.drawImage(TL.sc, 0, 0);       // clear first: in full screen the layer is see-through, and old frames would pile up
  c.setTransform(TL.dpr, 0, 0, TL.dpr, 0, 0);
  drawFadeLines(c); drawHandles(c); drawCreditsEnd(c); drawTrimHandles(c);        // the markers are drawn here (not in the cached layer), so their spring can run cheaply every frame
  if (TL.box) { c.save(); c.globalAlpha = .12; c.fillStyle = C.accent; c.fillRect(TL.box.a, TL.trackY - 6, TL.box.z - TL.box.a, TL.trackH + 12); c.globalAlpha = .8; c.strokeStyle = C.accent; c.lineWidth = 1; c.strokeRect(TL.box.a + .5, TL.trackY - 5.5, TL.box.z - TL.box.a, TL.trackH + 11); c.restore(); }        // the selection box
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
  if (TL.glow === 'ruler') {
    c.save(); c.shadowColor = C.accent; c.shadowBlur = 14; c.fillStyle = C.accent; c.globalAlpha = 0.14 + 0.14 * pulse; c.fillRect(0, 0, TL.vw, TL.rulerH);
    c.globalAlpha = 0.55 + 0.4 * pulse; c.strokeStyle = C.accent; c.lineWidth = 2; c.strokeRect(1, 1, TL.vw - 2, TL.rulerH - 2); c.restore();
  }
  // playhead (drawn before the hover tags, so a tag is never cut by the line)
  const px = t2x(S.time);
  if (TL.glow === 'playhead' && px >= -10 && px <= TL.vw + 10) {
    c.save(); c.shadowColor = C.play; c.shadowBlur = 20; c.globalAlpha = 0.35 + 0.35 * pulse; c.fillStyle = C.play; c.fillRect(px - 6, 0, 12, TL.h); c.restore();
  }
  if (px >= -10 && px <= TL.vw + 10) {          // the playhead is the top layer: one unbroken line from its head in the ruler to the bottom
    c.fillStyle = C.play; c.fillRect(Math.round(px) - 1, 0, 2, TL.h);
    c.beginPath(); c.moveTo(px - 7, 0); c.lineTo(px + 7, 0); c.lineTo(px, 10); c.closePath(); c.fill();
  }
  // tooltip
  let tipI = TL.drag && TL.drag.kind === 'turn' ? TL.drag.i : TL.hover;
  if (tipI >= 0 && S.turns[tipI] != null) {
    const x = t2x(shownTurn(tipI)), txt = (hasCreditsSpread() && tipI === S.turns.length - 1 ? 'Credits' : turnNoun() + ' ' + (tipI + 1)) + ' · ' + fmt(shownTurn(tipI) - S.vStart);
    c.font = '600 12px "Instrument Sans",system-ui,sans-serif'; const w = c.measureText(txt).width + 16;
    const bx = clamp(x - w / 2, 4, TL.vw - w - 4), by = TL.trackY - 26 < TL.rulerH ? TL.trackY + TL.trackH + 2 : TL.trackY - 26;
    c.fillStyle = C.ink; roundRect(c, bx, by, w, 20, 6); c.fill();
    c.fillStyle = C.bg; c.textBaseline = 'middle'; c.fillText(txt, bx + 8, by + 10.5);
  }
  if (TL.hoverCr || (TL.drag && TL.drag.kind === 'credEnd')) {
    const x = t2x(S.creditsEnd), txt = 'Credits end · ' + fmt(S.creditsEnd - S.vStart);
    c.font = '600 12px "Instrument Sans",system-ui,sans-serif'; const w = c.measureText(txt).width + 16;
    const bx = clamp(x - w / 2, 4, TL.vw - w - 4), by = TL.trackY - 26 < TL.rulerH ? TL.trackY + TL.trackH + 2 : TL.trackY - 26;
    c.fillStyle = C.ink; roundRect(c, bx, by, w, 20, 6); c.fill();
    c.fillStyle = C.bg; c.textBaseline = 'middle'; c.fillText(txt, bx + 8, by + 10.5);
  }
  const tw = TL.drag && TL.drag.kind === 'trim' ? TL.drag.which : TL.hoverTrim;
  if (tw) {
    const atHome = tw === 'start' ? S.vStart === 0 : S.vEndSet == null, x = t2x(tw === 'start' ? S.vStart : vEnd()), txt = trimText(tw) + (atHome ? '' : ' · Double-click to reset');
    c.font = '600 12px "Instrument Sans",system-ui,sans-serif'; const w = c.measureText(txt).width + 16;
    const bx = clamp(x - w / 2, 4, TL.vw - w - 4), by = TL.rulerH + 4;
    c.fillStyle = C.ink; roundRect(c, bx, by, w, 20, 6); c.fill();
    c.fillStyle = C.bg; c.textBaseline = 'middle'; c.fillText(txt, bx + 8, by + 10.5);
  }
  TL.overlayDirty = false;
}
function tlPoint(e) { const r = TL.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function hitTurn(p) {
  if (p.y < TL.trackY - 8 || p.y > TL.trackY + TL.trackH + 8) return -1;
  let best = -1, bd = 10;
  for (let i = 0; i < S.turns.length; i++) { const d = Math.abs(t2x(shownTurn(i)) - p.x); if (d <= bd) { bd = d; best = i; } }
  return best;
}
function hitCredEnd(p) {
  if (!creditsEarlyOn() || p.y < TL.trackY - 8 || p.y > TL.trackY + TL.trackH + 8) return false;
  return Math.abs(t2x(S.creditsEnd) - p.x) <= 9;
}
function hitTrim(p) {
  const xs = t2x(S.vStart), xe = t2x(vEnd()), ruler = p.y < TL.rulerH;          // in the ruler only the grip counts (it sits on the inner side of the line); lower down the whole line does
  if (p.x >= xs - (ruler ? 3 : 9) && p.x <= xs + 13) return 'start';
  if (p.x >= xe - 13 && p.x <= xe + (ruler ? 3 : 9)) return 'end';
  return null;
}
/* How far each end of the video may move: the first and last page keep a moment on screen, and the video stays at least 1 s long */
function trimLimitsFor(vs, ve) {
  const n = S.turns.length, off = refOffset(), D = flipDur();
  const startMax = Math.min(ve - 1, n ? S.turns[0] - off - 0.3 : Infinity);
  const endMin = Math.max(vs + 1, n ? S.turns[n - 1] - off + D + 0.3 : -Infinity);
  return { startMax, endMin };
}
const trimLimits = () => trimLimitsFor(S.vStart, vEnd());
/* Where the grabbed handle may go: the others give way, so only the video's ends stop it (room is kept for the turns behind it and ahead of it). */
function clampTurn(i, t) {
  const D = turnGap(), off = refOffset(), dur = vEnd(), n = S.turns.length;
  const lo = turnMin() + i * D;
  let hi = dur - D + off - (n - 1 - i) * D;
  if (hi < lo) hi = lo;
  return clamp(t, lo, hi);
}
/* Puts the grabbed turn at t and pushes its neighbors along, at the least gap, from where they stood when the drag began (base). */
function nudgeTurns(base, i, t) {
  const D = turnGap(), n = base.length, out = base.slice();
  out[i] = t;
  for (let j = i + 1; j < n; j++) out[j] = Math.max(base[j], out[j - 1] + D);
  for (let j = i - 1; j >= 0; j--) out[j] = Math.min(base[j], out[j + 1] - D);
  return out;
}
/* The group moves rigidly by delta, kept inside the video; the turns outside it give way at the least gap (the ones between group members too). */
function clampGroupDelta(base, idx, delta) {
  const D = turnGap(), off = refOffset(), n = base.length, a = idx[0], z = idx[idx.length - 1];
  const lo = turnMin() + a * D - base[a], hi = vEnd() - D + off - (n - 1 - z) * D - base[z];
  return clamp(delta, lo, Math.max(lo, hi));
}
function nudgeGroup(base, idx, delta) {
  const D = turnGap(), n = base.length, out = base.slice(), inG = new Set(idx);
  for (const g of idx) out[g] = base[g] + delta;
  for (let j = 1; j < n; j++) if (!inG.has(j)) out[j] = Math.max(base[j], out[j - 1] + D);
  for (let j = n - 2; j >= 0; j--) if (!inG.has(j)) out[j] = Math.min(out[j], out[j + 1] - D);
  return out;
}
const turnSel = () => (TL.selN === S.turns.length ? TL.sel : []);
function setTurnSel(a) { TL.sel = a.slice().sort((x, y) => x - y); TL.selN = S.turns.length; TL.staticDirty = true; }
TL.canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const p = tlPoint(e), hi = hitTurn(p), tr = hitTrim(p), ce = hitCredEnd(p);
  TL.canvas.setPointerCapture(e.pointerId);
  const trX = tr ? t2x(tr === 'start' ? S.vStart : vEnd()) : 0;
  const dTurn = hi >= 0 ? Math.abs(p.x - t2x(S.turns[hi])) : Infinity, dTrim = tr ? Math.abs(p.x - trX) : Infinity, dCe = ce ? Math.abs(p.x - t2x(S.creditsEnd)) : Infinity;
  if (ce && dCe < dTurn && dCe <= dTrim) {                      // the credits' end marker
    const rb = S.redo.slice(); pushHistory();
    TL.drag = { kind: 'credEnd', dx: S.creditsEnd - x2t(p.x), moved: false, rb, resume: Transport.playing };
    if (Transport.playing) Transport.pause();
  } else if (tr && (hi < 0 || dTrim < dTurn)) {
    const rb = S.redo.slice(); pushHistory();
    TL.drag = { kind: 'trim', which: tr, rawX: p.x, ev: 0, er: 0, lo: tlLo(), hi: tlHi(), fitLo: fitLo(), fitHi: fitHi(), dx: (tr === 'start' ? S.vStart : vEnd()) - x2t(p.x), moved: false, rb, resume: Transport.playing };
    if (Transport.playing) Transport.pause();
  } else if (hi >= 0 && e.shiftKey) {                           // shift-click adds a turn to the selection or takes it out
    const cur = turnSel(); setTurnSel(cur.includes(hi) ? cur.filter(v => v !== hi) : cur.concat(hi));
    TL.drag = { kind: 'noop' };
  } else if (hi >= 0) {
    if (!turnSel().includes(hi)) setTurnSel([]);                // a plain grab of an unselected turn drops the selection; a selected one takes the group along
    const grp = turnSel().length > 1 ? turnSel().slice() : null;
    const rb = S.redo.slice(); pushHistory(); TL.drag = { kind: 'turn', i: hi, dx: S.turns[hi] - x2t(p.x), base: S.turns.slice(), group: grp, moved: false, rb, live: Transport.playing };
    if (!TL.drag.live) { S.time = clamp(S.turns[hi], S.vStart, vEnd()); stageDirty = true; TL.overlayDirty = true; updateTimeUI(true); }          // paused: the playhead goes to the marker. Playing: the video keeps going, untouched, while the marker moves
  } else if (p.y >= TL.trackY && p.y <= TL.trackY + TL.trackH) {   // empty track: a click clears the selection and moves the playhead; a drag draws a box
    TL.drag = { kind: 'box', x0: p.x, resume: Transport.playing, keep: e.shiftKey ? turnSel().slice() : [], moved: false };
    if (Transport.playing) Transport.pause();
  } else {
    TL.drag = { kind: 'scrub', resume: Transport.playing };
    if (Transport.playing) Transport.pause();
    S.time = fadeLookAt = clamp(x2t(p.x), S.vStart, vEnd()); stageDirty = true; TL.overlayDirty = true; updateTimeUI(true);
  }
  e.preventDefault();
});
TL.canvas.addEventListener('pointermove', e => {
  const p = tlPoint(e), d = TL.drag;
  if (d && d.kind === 'credEnd') {
    const hi = vEnd(), lo = Math.min(creditsFull() + 0.5, hi), t = clamp(x2t(p.x) + d.dx, lo, hi);
    if (t !== S.creditsEnd) { d.moved = true; S.creditsEnd = t; S.time = clamp(t - CREDITS_OUT - 0.2, S.vStart, hi); TL.staticDirty = true; stageDirty = true; updateTimeUI(true); }
  } else if (d && d.kind === 'trim') {
    d.rawX = p.x; trimTo(d);
  } else if (d && d.kind === 'turn') {
    const want = x2t(p.x) + d.dx, delta = d.group ? clampGroupDelta(d.base, d.group, want - d.base[d.i]) : 0;
    const t = d.group ? d.base[d.i] + delta : clampTurn(d.i, want);
    const next = d.group ? nudgeGroup(d.base, d.group, delta) : nudgeTurns(d.base, d.i, t);
    if (next.some((v, j) => v !== S.turns[j])) {
      d.moved = true; S.turns = next; S.turnsEdited = true; for (const g of d.group || [d.i]) S.ph[g] = false;
      if (!d.live) S.time = clamp(t, S.vStart, vEnd());   // the playhead stays exactly on the marker, so you see the frame at the moment the turn starts, is halfway, or finishes (whatever the handle marks); not while the video plays
      TL.staticDirty = true; stageDirty = true; updateTimeUI(true);
    }
  } else if (d && d.kind === 'box') {
    if (!d.moved && Math.abs(p.x - d.x0) < 4) return;
    d.moved = true; d.x1 = p.x; const a = Math.min(d.x0, p.x), z = Math.max(d.x0, p.x);
    setTurnSel(d.keep.concat(S.turns.map((t, i) => i).filter(i => { const x = t2x(shownTurn(i)); return x >= a && x <= z && !d.keep.includes(i); })));
    TL.box = { a, z }; TL.overlayDirty = true;
  } else if (d && d.kind === 'scrub') {
    S.time = fadeLookAt = clamp(x2t(p.x), S.vStart, vEnd()); stageDirty = true; TL.overlayDirty = true; updateTimeUI(true);
  } else {
    const h = hitTurn(p), tr = hitTrim(p), ce = hitCredEnd(p);
    if (ce !== TL.hoverCr) { TL.hoverCr = ce; TL.staticDirty = true; }
    if (h !== TL.hover) { TL.hover = h; TL.staticDirty = true; }
    if (tr !== TL.hoverTrim) { TL.hoverTrim = tr; TL.staticDirty = true; }
    TL.canvas.style.cursor = (h >= 0 || tr || ce) ? 'ew-resize' : (p.y < TL.rulerH ? 'pointer' : 'default');
  }
});
function endDrag(e) {
  const d = TL.drag; if (!d) return;
  const from = d.kind === 'trim' && d.moved ? Object.assign(tlMap(d.lo), { lo: d.lo, hi: d.hi, s: S.vStart, e: vEnd() }) : null;          // the picture the bracket was let go on, for the glide to the new view (Fit, or the same zoom with the empty room re-made)
  TL.drag = null; TL.box = null;
  if (d.kind === 'box') {
    if (d.moved) { TL.overlayDirty = true; if (d.resume) Transport.play(); return; }
    if (!d.keep.length) setTurnSel([]);
    const p = tlPoint(e); S.time = fadeLookAt = clamp(x2t(p.x), S.vStart, vEnd()); stageDirty = true; TL.overlayDirty = true; updateTimeUI(true);
    if (d.resume) Transport.play(); return;
  }
  if (d.kind === 'noop') return;
  if (d.kind === 'turn' && !d.moved) { S.history.pop(); S.redo = d.rb || []; updateHistoryButtons(); }
  if (d.kind === 'turn' && d.moved) onTurnsChanged();
  if (d.kind === 'credEnd') {
    if (!d.moved) { S.history.pop(); S.redo = d.rb || []; updateHistoryButtons(); }
    else toast(tx('vid.credend', { t: fmt(S.creditsEnd - S.vStart) }), 2600);
  }
  if (d.kind === 'trim') {
    if (!d.moved) { S.history.pop(); S.redo = d.rb || []; updateHistoryButtons(); }
    else {
      const sc = TL.scroller;
      if (S.fitMode) { onTrimChanged(); if (from) tlGlide(from); }
      else {                                   // keep the content where it was while the empty room is re-made around the new ends
        TL.inner.style.width = tlInnerWidth() + 'px'; sc.scrollLeft = Math.max(0, sc.scrollLeft + (d.lo - tlLo()) * S.pxPerSec);
        onTrimChanged(); if (from) tlGlide(from);          // the axis can shrink under a view scrolled to its end, which would jump: it glides like Fit does
      }
      toast(trimText(d.which) + '.', 2600);
    }
  }
  TL.staticDirty = true; TL.overlayDirty = true;
  if (d.resume) Transport.play();
}
/* Double-click a blue start or end marker to put it back at the audio's own start or end. */
TL.canvas.addEventListener('dblclick', e => {
  if (!S.pdf) return;
  const which = hitTrim(tlPoint(e)); if (!which) return;
  const home = which === 'start' ? 0 : null;
  if (which === 'start' ? S.vStart === 0 : S.vEndSet == null) { toast(trimText(which) + '.', 2200); return; }
  pushHistory(); const lo0 = tlLo(), from = Object.assign(tlMap(), { lo: lo0, hi: tlHi(), s: TL.trimD ? TL.trimD.s : S.vStart, e: TL.trimD ? TL.trimD.e : vEnd() });
  if (which === 'start') S.vStart = 0; else S.vEndSet = home;
  S.time = clamp(S.time, S.vStart, vEnd());
  if (!S.fitMode) { TL.inner.style.width = tlInnerWidth() + 'px'; TL.scroller.scrollLeft = Math.max(0, TL.scroller.scrollLeft + (lo0 - tlLo()) * S.pxPerSec); }
  normalizeTurns(); onTurnsChanged(); onTrimChanged(); if (from) tlGlide(from); toast(trimText(which) + '.', 2600);
});
TL.canvas.addEventListener('pointerup', endDrag);
TL.canvas.addEventListener('pointercancel', endDrag);
TL.canvas.addEventListener('pointerleave', () => { if (!TL.drag && (TL.hover !== -1 || TL.hoverTrim || TL.hoverCr)) { TL.hover = -1; TL.hoverTrim = null; TL.hoverCr = false; TL.staticDirty = true; } });
TL.scroller.addEventListener('scroll', () => { TL.staticDirty = true; });
TL.scroller.addEventListener('wheel', e => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(S.pxPerSec * Math.exp(-e.deltaY * 0.01), tlPoint(e).x); }
  else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); TL.scroller.scrollLeft += e.deltaY; }
}, { passive: false });

