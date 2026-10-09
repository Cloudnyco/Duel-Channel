// ---- UGUI re-creation engine --------------------------------------------------------------------------------------
// The exported node trees become absolutely positioned divs on the 1280 × 720 reference canvas: RectTransform layout
// (y up → y down), a simplified Horizontal/VerticalLayoutGroup + ContentSizeFitter + LayoutElement pass, legacy
// AnimationClip playback (cubic Hermite keys, ±1e30 slopes stepped), clickable hotspots and prefab templates
// instantiated into list containers at run time. Everything runs on one game clock (CLOCK) that the speed control scales.
const D = DUEL, SPR = D.sprites;
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const CLOCK = { t: 0, scale: 1, timers: [] };
// a promise resolved after `sec` seconds of game time (the speed control scales it)
function wait(sec) { return new Promise((res) => CLOCK.timers.push({ at: CLOCK.t + Math.max(0, sec), res })); }
function tickTimers() {
  const due = CLOCK.timers.filter((x) => x.at <= CLOCK.t);
  if (!due.length) return;
  CLOCK.timers = CLOCK.timers.filter((x) => x.at > CLOCK.t);
  for (const x of due) x.res();
}

// fonts the prefabs ask DynFontLoader for → the page's faces (Noto Sans SC stands in for 思源黑体 / NotoSansHans)
const FONT = {
  'NotoSansHans-Medium': ['var(--cn)', 500], 'NotoSansHans-Regular': ['var(--cn)', 400], 'NotoSansHans-Bold': ['var(--cn)', 700],
  'SourceHanSansCN-Heavy': ['var(--cn)', 900], 'SourceHanSansCN-Bold': ['var(--cn)', 700], 'SourceHanSansCN-Medium': ['var(--cn)', 500],
  'Novecentowide-Bold': ['var(--nove)', 700], 'Novecentowide-Medium': ['var(--nove)', 500], 'Novecentowide-Normal': ['var(--nove)', 400],
  'Novecentowide-Light': ['var(--nove)', 300], 'Arvo-Bold': ['var(--arvo)', 700], 'Bender': ['var(--bender)', 400],
};

// ---- sprites: preload, tint (multiply rgb) on demand ---------------------------------------------------------------
const imgs = {};
const tintCache = new Map();
function preloadSprites() {
  return Promise.all(Object.entries(SPR).map(([k, s]) => new Promise((res) => { const im = new Image(); im.onload = () => { imgs[k] = im; res(); }; im.onerror = () => res(); im.src = s.uri; })));
}
function spriteUrl(ref, rgb) {
  if (!ref || !SPR[ref]) return null;
  if (!rgb || (rgb[0] > 0.995 && rgb[1] > 0.995 && rgb[2] > 0.995)) return SPR[ref].uri;
  const key = ref + '|' + rgb.slice(0, 3).map((v) => v.toFixed(2)).join(',');
  if (tintCache.has(key)) return tintCache.get(key);
  const im = imgs[ref];
  if (!im) return SPR[ref].uri;
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = `rgb(${rgb[0] * 255},${rgb[1] * 255},${rgb[2] * 255})`;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(im, 0, 0);
  const url = c.toDataURL();
  tintCache.set(key, url);
  return url;
}
const rgba = (c) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`;
// style writes only when the value changed (the whole tree is laid out every frame)
function sty(s, el, k, v) {
  const c = s.css || (s.css = new Map()), key = el === s.el ? k : el === s.g ? 'g.' + k : el === s.t ? 't.' + k : 'x.' + k;
  if (c.get(key) !== v) { c.set(key, v); el.style[k] = v; }
}

// ---- build ---------------------------------------------------------------------------------------------------------
const DEF_RT = { amin: [0.5, 0.5], amax: [0.5, 0.5], pos: [0, 0], size: [100, 100], pivot: [0.5, 0.5], scale: [1, 1], rotz: 0 };
const FULL_RT = { amin: [0, 0], amax: [1, 1], pos: [0, 0], size: [0, 0], pivot: [0.5, 0.5], scale: [1, 1], rotz: 0 };
const isMagenta = (g) => g && g.color[0] > 0.99 && g.color[1] < 0.01 && g.color[2] > 0.99;
function build(n, parent, path, scr) {
  const rt0 = n.comps.canvas && parent ? FULL_RT : (n.rt || DEF_RT);
  const s = { n, parent, path, scr, el: document.createElement('div'), kids: [], rt: JSON.parse(JSON.stringify(rt0)), active: n.active,
    alpha: n.comps.group ? n.comps.group.alpha : 1, lp: null, gEnabled: true, press: 0 };
  s.el.className = 'n'; s.el.dataset.name = n.name;
  const c = n.comps;
  // magenta (1, 0, 1) marks graphics drawn by a special material (transition wipes): not drawn here
  const g0 = c.img || c.fill || c.grad;
  const gfx = (c.maskHide || c.nodraw || isMagenta(g0)) ? null : g0;
  if (gfx) { s.g = document.createElement('div'); s.g.className = 'g'; s.el.appendChild(s.g); s.color = gfx.color.slice(); s.lastTint = ''; }
  // magenta (1, 0, 1) graphics are drawn by a wipe shader that reads its progress from the colour's green channel:
  // a duel-yellow band revealed (trans_in) or cleared (trans_out) left to right by that progress
  else if (!c.maskHide && !c.nodraw && isMagenta(g0)) { s.g = document.createElement('div'); s.g.className = 'g wipe'; s.el.appendChild(s.g); s.color = g0.color.slice(); s.wipe = /out/.test(n.name) ? 'out' : 'in'; }
  if (c.img && c.img.kind === 'image' && c.img.type === 3) s.fill = c.img.fill ?? 1;
  if (c.text) {
    s.t = document.createElement('div'); s.t.className = 't'; s.el.appendChild(s.t);
    s.color = c.text.color.slice();
    const al = c.text.align;
    s.t.style.justifyContent = ['flex-start', 'center', 'flex-end'][al % 3];
    s.t.style.alignItems = ['flex-start', 'center', 'flex-end'][Math.floor(al / 3)];
    s.t.style.textAlign = ['left', 'center', 'right'][al % 3];
    s.t.style.fontSize = c.text.size + 'px';
    s.t.style.fontStyle = c.text.style & 2 ? 'italic' : 'normal';
    if (c.outline) { const o = c.outline, col = rgba(o.color), dx = o.d[0], dy = -o.d[1]; s.t.style.textShadow = `${dx}px ${dy}px 0 ${col}, ${-dx}px ${dy}px 0 ${col}, ${dx}px ${-dy}px 0 ${col}, ${-dx}px ${-dy}px 0 ${col}`; }
    setText(s, c.text.text || '');
  }
  if (c.mask) s.el.style.overflow = 'hidden';
  // a RawImage showing a render texture (the blurred screen behind a popup): a backdrop blur
  if (c.rtimg && !gfx) scr.blurs.push(s);
  if (c.spine) scr.spines.push(s);
  if (c.particle && c.particle.systems && c.particle.systems.length) s.ps = new UIParticles(s);
  scr.all.push(s);
  for (const ch of n.children) s.kids.push(build(ch, s, path + '/' + ch.name, scr));
  for (const k of s.kids) s.el.appendChild(k.el);
  // UIStencilComponent siblings: the first with a graphic writes the stencil (its shape clips the others); a writer named
  // *mask* only writes it, it is not drawn
  // a UV-scrolling material (Torappu/UI/HoriOrVeriUVAnimated): UV units per Unity _Time.x (seconds / 20)
  const mat = c.mat;
  if (mat && /HoriOrVeriUVAnimated/.test(mat.shader)) { const k = (mat.f._TimeScale ?? 1) / 20; s.uvAnim = [(mat.f._XTimeScale || 0) * k, (mat.f._YTimeScale || 0) * k]; }
  return s;
}
// Unity rich text (<color>, <b>, <i>, <size>) → spans; the font follows the prefab's DynFontLoader, else a guess
function setText(s, txt) {
  txt = txt == null ? '' : String(txt);
  if (s.txt === txt) return;
  s.txt = txt;
  const c = s.n.comps.text;
  if (/<(color|b|i|size)\b/.test(txt)) {
    const esc = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s.t.innerHTML = esc.replace(/&lt;color=(#[0-9a-fA-F]{6,8}|\w+)&gt;/g, '<span style="color:$1">').replace(/&lt;\/color&gt;/g, '</span>')
      .replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>').replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>')
      .replace(/&lt;size=(\d+)&gt;/g, '<span style="font-size:$1px">').replace(/&lt;\/size&gt;/g, '</span>');
  } else s.t.textContent = txt;
  const f = c.font && FONT[c.font];
  if (f) { s.t.style.fontFamily = f[0]; s.t.style.fontWeight = c.text.style & 1 ? Math.max(700, f[1]) : f[1]; }
  else {
    const latin = /^[ -~万×]*$/.test(txt.replace(/<[^>]+>/g, ''));
    s.t.style.fontFamily = latin ? 'var(--nove)' : 'var(--cn)';
    s.t.style.fontWeight = c.text.style & 1 ? 700 : 500;
  }
}
// an image node showing a picture supplied at run time (avatars, enemy portraits)
function setImage(s, uri, fit = 'cover') {
  if (!s || !s.g) return;
  s.imgOverride = uri; s.lastTint = '';
  // a slot for a picture loaded at run time stays transparent until it is filled
  if (uri && s.color && s.color[3] < 0.05) s.color[3] = 1;
  // …and has no size until the game fits it to the loaded texture: an empty point-anchored rect fills its parent
  const rt = s.rt;
  if (uri && rt.size[0] <= 0 && rt.size[1] <= 0 && rt.amin[0] === rt.amax[0] && rt.amin[1] === rt.amax[1]) {
    rt.amin = [0, 0]; rt.amax = [1, 1]; rt.size = [0, 0]; rt.pos = [0, 0];
  }
  s.g.style.borderImage = 'none'; s.g.style.borderWidth = '0';
  s.g.style.backgroundImage = uri ? `url(${uri})` : 'none';
  s.g.style.backgroundSize = fit; s.g.style.backgroundPosition = 'center';
  if (/avatar|head/.test(s.n.name)) s.g.style.borderRadius = '50%';
}

function sliceOf(im) {
  if (im.kind === 'atlas' && im.slice) {
    const sp = SPR[im.ref], [x0, y0, x1, y1] = im.slice;
    return [Math.round(x0 * sp.w), Math.round((1 - x1) * sp.w), Math.round((1 - y1) * sp.h), Math.round(y0 * sp.h)];
  }
  if (im.border) { const [L, B, R, T] = im.border.map(Math.round); return [L, R, T, B]; }
  return [0, 0, 0, 0];
}
// a graphic drawn into a 2D context at (x, y, w, h): nine-sliced like Unity when it is sliced, else stretched; a writer
// without a sprite (a circle shader) is an ellipse
function drawSprite(x, im, name, X, Y, W, H, mat) {
  const img = im && im.ref && imgs[im.ref];
  if (!img) {
    // the shape shaders (Torappu/UI/Shape/*), in UV units of the rect: a circle of radius _OutStep about the centre; a
    // rounded rect _OutWidth × _OutHeight with corner _Radius
    const sh = mat && mat.shader || '', f = mat ? mat.f : {};
    x.beginPath();
    if (/ShapeCircle/.test(sh)) x.ellipse(X + W / 2, Y + H / 2, W * f._OutStep, H * f._OutStep, 0, 0, Math.PI * 2);
    else if (/ShapeRect/.test(sh)) { const w = W * f._OutWidth, h = H * f._OutHeight; x.roundRect(X + (W - w) / 2, Y + (H - h) / 2, w, h, Math.min(W, H) * f._Radius); }
    else if (/circle|round|avatar/i.test(name)) x.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
    else x.rect(X, Y, W, H);
    x.fill(); return;
  }
  const sliced = (im.kind === 'atlas' && im.mesh === 1) || (im.kind === 'image' && im.type === 1 && im.border && im.border.some((v) => v > 0));
  if (!sliced) { x.drawImage(img, X, Y, W, H); return; }
  const [L, R, T, B] = sliceOf(im), iw = img.width, ih = img.height;
  const kx = L + R > W ? W / (L + R) : 1, ky = T + B > H ? H / (T + B) : 1;
  const dl = L * kx, dr = R * kx, dt = T * ky, db = B * ky;
  const sx = [0, L, iw - R, iw], sy = [0, T, ih - B, ih], dx = [X, X + dl, X + W - dr, X + W], dy = [Y, Y + dt, Y + H - db, Y + H];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const sw = sx[i + 1] - sx[i], sh = sy[j + 1] - sy[j], dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
    if (sw > 0 && sh > 0 && dw > 0 && dh > 0) x.drawImage(img, sx[i], sy[j], sw, sh, dx[i], dy[j], dw, dh);
  }
}
// a nine-sliced sprite at a size, tinted (multiply), as a data URI; cached per sprite, tint and whole-pixel size
const sliceCache = new Map();
function slicedUri(im, rgb, w, h) {
  const img = imgs[im.ref];
  if (!img) return null;
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h)), Q = 2;
  const key = im.ref + '|' + rgb.slice(0, 3).map((v) => v.toFixed(2)).join(',') + '|' + W + 'x' + H;
  if (sliceCache.has(key)) return sliceCache.get(key);
  const c = document.createElement('canvas'); c.width = W * Q; c.height = H * Q;
  const x = c.getContext('2d');
  x.scale(Q, Q); x.imageSmoothingQuality = 'high';
  drawSprite(x, im, '', 0, 0, W, H);
  if (rgb && !(rgb[0] > 0.995 && rgb[1] > 0.995 && rgb[2] > 0.995)) {
    const a = document.createElement('canvas'); a.width = c.width; a.height = c.height; a.getContext('2d').drawImage(c, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${rgb[0] * 255},${rgb[1] * 255},${rgb[2] * 255})`; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(a, 0, 0);
  }
  const u = c.toDataURL();
  if (sliceCache.size > 400) sliceCache.delete(sliceCache.keys().next().value);
  sliceCache.set(key, u);
  return u;
}
// a stencil group: the writer's shape (at its rect inside the group) as the group's CSS mask
function applyStencil(s, w, h, k = s.stW, ox = 0, oy = 0) {
  if (!k.box || !k.active) { if (s.stKey) { s.stKey = ''; sty(s, s.el, 'webkitMaskImage', 'none'); sty(s, s.el, 'maskImage', 'none'); } return; }
  const bx = k.box[0] - ox, by = k.box[1] - oy, bw = k.box[2], bh = k.box[3], key = [w, h, bx, by, bw, bh].map((v) => Math.round(v)).join(',');
  if (s.stKey === key) return;
  s.stKey = key;
  const Q = 2, c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * Q)); c.height = Math.max(1, Math.round(h * Q));
  const x = c.getContext('2d');
  x.scale(Q, Q); x.fillStyle = '#fff';
  drawSprite(x, k.n.comps.img, k.n.name, bx, by, bw, bh, k.n.comps.mat);
  const v = `url(${c.toDataURL()})`;
  for (const [a, b] of [['webkitMaskImage', v], ['maskImage', v], ['webkitMaskSize', '100% 100%'], ['maskSize', '100% 100%'], ['webkitMaskRepeat', 'no-repeat'], ['maskRepeat', 'no-repeat']]) sty(s, s.el, a, b);
}
function paintGraphic(s, w, h) {
  const c = s.n.comps, g = s.g;
  if (!g) return;
  sty(s, g, 'display', s.gEnabled && !s.stHide ? '' : 'none');
  if (s.wipe) {
    const p = clamp(s.color[1], 0, 1), on = p > 0.001 && p < 0.999 && s.color[3] > 0.01;
    sty(s, g, 'opacity', on ? String(s.color[3]) : '0');
    sty(s, g, 'clipPath', s.wipe === 'in' ? `polygon(0 0, ${p * 115}% 0, ${p * 115 - 15}% 100%, 0 100%)` : `polygon(${p * 115}% 0, 100% 0, 100% 100%, ${p * 115 - 15}% 100%)`);
    return;
  }
  if (c.img) {
    const im = c.img;
    if (s.imgOverride) { sty(s, g, 'opacity', String(s.color[3])); return; }
    const tintKey = s.color.slice(0, 3).map((v) => v.toFixed(2)).join(',');
    if (tintKey !== s.lastTint) {
      s.slice9 = null;
      s.lastTint = tintKey;
      const url = spriteUrl(im.ref, s.color);
      if (!url) { g.style.background = 'none'; }
      else if (im.kind === 'atlas' && im.mesh === 1) {
        s.slice9 = sliceOf(im); s.sliceKey = '';
        g.style.backgroundSize = '100% 100%'; g.style.backgroundRepeat = 'no-repeat';
      } else if (im.kind === 'image' && im.type === 1 && im.border && im.border.some((v) => v > 0)) {
        s.slice9 = sliceOf(im); s.sliceKey = '';
        g.style.backgroundSize = '100% 100%'; g.style.backgroundRepeat = 'no-repeat';
      } else if (im.kind === 'image' && im.type === 2 && SPR[im.ref]) {
        // tiled: repeats at the sprite's own size
        g.style.backgroundImage = `url(${url})`;
        g.style.backgroundSize = `${SPR[im.ref].w}px ${SPR[im.ref].h}px`;
        g.style.backgroundRepeat = 'repeat'; g.style.backgroundPosition = 'center';
      } else {
        g.style.backgroundImage = `url(${url})`;
        g.style.backgroundSize = im.preserve ? 'contain' : '100% 100%';
        g.style.backgroundPosition = 'center';
      }
    }
    // a nine-slice: drawn for this size into one image (borders shrink to fit like Unity's)
    if (s.slice9 && w > 0 && h > 0) {
      const key = tintKey + '|' + Math.round(w) + 'x' + Math.round(h);
      if (key !== s.sliceKey) { s.sliceKey = key; const u = slicedUri(im, s.color, w, h); if (u) sty(s, g, 'backgroundImage', `url(${u})`); }
    }
    if (s.uvAnim && w > 0) {
      const t = performance.now() / 1000, sp = SPR[im.ref], tw = im.type === 2 && sp ? sp.w : w, th = im.type === 2 && sp ? sp.h : h;
      if (im.type !== 2) { sty(s, g, 'backgroundRepeat', 'repeat'); }
      sty(s, g, 'backgroundPosition', `${(-(s.uvAnim[0] * t) % 1 * tw).toFixed(1)}px ${((s.uvAnim[1] * t) % 1 * th).toFixed(1)}px`);
    }
    sty(s, g, 'opacity', String(s.color[3]));
    if (s.fill != null) {
      const f = clamp(s.fill, 0, 1), m = im.fillMethod, o = im.fillOrigin;
      if (m === 0) sty(s, g, 'clipPath', o ? `inset(0 0 0 ${(1 - f) * 100}%)` : `inset(0 ${(1 - f) * 100}% 0 0)`);
      else if (m === 1) sty(s, g, 'clipPath', o ? `inset(0 0 ${(1 - f) * 100}% 0)` : `inset(${(1 - f) * 100}% 0 0 0)`);
      else { const v = `conic-gradient(#000 ${f * 360}deg, transparent 0)`; sty(s, g, 'maskImage', v); sty(s, g, 'webkitMaskImage', v); }
    }
  } else if (c.fill) {
    const k = c.fill.c2;
    sty(s, g, 'background', rgba([s.color[0] * k[0], s.color[1] * k[1], s.color[2] * k[2], s.color[3] * k[3]]));
  } else if (c.grad) {
    const pts = c.grad.points.map(([col, p]) => `${rgba([col[0] * s.color[0], col[1] * s.color[1], col[2] * s.color[2], col[3] * s.color[3]])} ${p * 100}%`);
    const dir = c.grad.dir === 1 ? 'to top' : c.grad.dir === 2 ? 'to left' : c.grad.dir === 3 ? 'to bottom' : 'to right';
    sty(s, g, 'background', pts.length ? `linear-gradient(${dir}, ${pts.join(', ')})` : rgba(s.color));
  }
}

function hasReaders(k) { return k.n.comps.mask === 'UIStencilComponent' || k.kids.some(hasReaders); }
// stencil groups, top-down over a built tree: in a group the first stencil graphic writes (a UIStencilGraphic sibling —
// a shape shader, nothing drawn — when there is one) and the later ones read: siblings, or inside a sibling; when the
// group also holds graphics that are not stencilled (a card's frame) only the siblings holding readers are masked.
// Inside a masked subtree the stencil graphics are readers of that writer, not new writers.
function stencilScan(s, covered = false) {
  if (!covered) {
    const st = s.kids.filter((k) => k.n.comps.mask === 'UIStencilComponent');
    const sg = s.kids.find((k) => k.n.comps.nodraw === 'UIStencilGraphic');
    const wr = sg && (st.length || s.kids.some(hasReaders)) ? sg : st.find((k) => k.n.comps.img);
    if (wr) {
      const others = s.kids.filter((k) => k !== wr), holders = others.filter(hasReaders);
      if (holders.length) {
        if (holders.length === others.length) s.stW = wr; else for (const k of holders) k.stOuter = wr;
        if (/mask/i.test(wr.n.name) || !(wr.n.comps.img && wr.n.comps.img.ref)) wr.stHide = true;
      }
    }
  }
  for (const k of s.kids) stencilScan(k, covered || !!s.stW || !!k.stOuter || k === s.stW);
}
// ---- Unity auto layout (simplified) ----------------------------------------------------------------------------------
const measurer = document.createElement('div');
measurer.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre;line-height:1.12;';
document.body.appendChild(measurer);
const mcache = new Map();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => mcache.clear());
// a text that wraps at its rect's width (Unity's Horizontal Overflow: Wrap)
function wrapText(s, w) { if (!s || !s.t) return; s.wrapW = w; Object.assign(s.t.style, { display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: '1.45' }); }
function textSize(s) {
  const t = s.t, st = t.style;
  const key = t.innerHTML + '|' + st.fontSize + '|' + st.fontFamily + '|' + st.fontWeight + '|' + (s.wrapW || 0);
  let v = mcache.get(key);
  if (v) return v;
  measurer.style.fontSize = st.fontSize; measurer.style.fontFamily = st.fontFamily; measurer.style.fontWeight = st.fontWeight;
  measurer.style.whiteSpace = s.wrapW ? 'pre-wrap' : 'pre'; measurer.style.wordBreak = s.wrapW ? 'break-all' : 'normal'; measurer.style.width = s.wrapW ? s.wrapW + 'px' : 'auto'; measurer.style.lineHeight = s.wrapW ? '1.45' : '1.12';
  measurer.innerHTML = t.innerHTML;
  v = [measurer.offsetWidth, measurer.offsetHeight];
  if (mcache.size > 4000) mcache.clear();
  mcache.set(key, v);
  return v;
}
const ignored = (k) => k.n.comps.le && k.n.comps.le.ignore;
const lgKids = (s) => s.kids.filter((k) => k.active && !ignored(k));
function prefSize(s, ax) {
  const le = s.n.comps.le;
  let v;
  if (le && le.pref[ax] >= 0) v = le.pref[ax];
  else if (s.n.comps.lg) v = groupPref(s, ax);
  else if (s.t) v = textSize(s)[ax];
  else v = s.rt.size[ax];
  if (le && le.min[ax] >= 0) v = Math.max(v, le.min[ax]);
  return v;
}
const flexOf = (k, ax) => { const le = k.n.comps.le; return le && le.flex && le.flex[ax] > 0 ? le.flex[ax] : 0; };
const childSz = (g, k, ax) => ((ax === 0 ? g.cw : g.ch) ? prefSize(k, ax) : k.rt.size[ax]);
function groupPref(s, ax) {
  const g = s.n.comps.lg, main = g.dir === 'h' ? 0 : 1, kids = lgKids(s);
  const pad = ax === 0 ? g.pad[0] + g.pad[1] : g.pad[2] + g.pad[3];
  const sz = kids.map((k) => childSz(g, k, ax));
  return pad + (ax === main ? sz.reduce((a, b) => a + b, 0) + g.spacing * Math.max(0, kids.length - 1) : (sz.length ? Math.max(...sz) : 0));
}
function arrange(s, w, h) {
  const g = s.n.comps.lg, main = g.dir === 'h' ? 0 : 1, cross = 1 - main;
  const kids = lgKids(s);
  if (g.rev) kids.reverse();
  const inner = [w - g.pad[0] - g.pad[1], h - g.pad[2] - g.pad[3]];
  const ctrl = [g.cw, g.ch], force = [g.fw, g.fh];
  const sizes = kids.map((k) => [childSz(g, k, 0), childSz(g, k, 1)]);
  let total = sizes.reduce((a, z) => a + z[main], 0) + g.spacing * Math.max(0, kids.length - 1);
  // leftover space along the main axis goes to the flexible children (LayoutElement flexible size; force-expand = 1)
  if (ctrl[main] && kids.length && total < inner[main]) {
    const wts = kids.map((k) => Math.max(flexOf(k, main), force[main] ? 1 : 0)), sum = wts.reduce((a, b) => a + b, 0);
    if (sum > 0) { const extra = inner[main] - total; sizes.forEach((z, i) => { z[main] += extra * wts[i] / sum; }); total = inner[main]; }
  }
  const ax = g.align % 3, ay = Math.floor(g.align / 3);
  const alignMain = (main === 0 ? ax : ay) / 2, alignCross = (cross === 0 ? ax : ay) / 2;
  let cur = (main === 0 ? g.pad[0] : g.pad[2]) + (inner[main] - total) * alignMain;
  kids.forEach((k, i) => {
    const z = sizes[i];
    if (ctrl[cross] && (force[cross] || flexOf(k, cross) > 0)) z[cross] = inner[cross];
    const c0 = (cross === 0 ? g.pad[0] : g.pad[2]) + (inner[cross] - z[cross]) * alignCross;
    k.lgRect = main === 0 ? { x: cur, y: c0, w: z[0], h: z[1] } : { x: c0, y: cur, w: z[0], h: z[1] };
    cur += z[main] + g.spacing;
  });
  for (const k of s.kids) if (!kids.includes(k)) k.lgRect = null;
}

// ---- layout (Unity RectTransform → CSS, y up → y down) --------------------------------------------------------------
function layout(s, PW, PH, ppivot, shownUp) {
  const rt = s.rt, el = s.el;
  sty(s, el, 'display', s.active ? '' : 'none');
  s.shown = shownUp && s.active;
  if (!s.active) { if (s.ps) s.ps.hide(); markHidden(s); return; }
  const csf = s.n.comps.csf;
  if (csf) for (const a of [0, 1]) if (csf[a] && rt.amin[a] === rt.amax[a]) rt.size[a] = prefSize(s, a);
  let w, h, left, top;
  if (s.lgRect) {
    ({ x: left, y: top, w, h } = s.lgRect);
  } else {
    w = (rt.amax[0] - rt.amin[0]) * PW + rt.size[0];
    h = (rt.amax[1] - rt.amin[1]) * PH + rt.size[1];
    let px = rt.pos[0], py = rt.pos[1];
    if (s.lp) {
      if (s.lp[0] != null) px = s.lp[0] - ((rt.amin[0] + (rt.amax[0] - rt.amin[0]) * rt.pivot[0]) - ppivot[0]) * PW;
      if (s.lp[1] != null) py = s.lp[1] - ((rt.amin[1] + (rt.amax[1] - rt.amin[1]) * rt.pivot[1]) - ppivot[1]) * PH;
    }
    left = rt.amin[0] * PW + px - rt.size[0] * rt.pivot[0];
    const bottom = rt.amin[1] * PH + py - rt.size[1] * rt.pivot[1];
    top = PH - bottom - h;
  }
  sty(s, el, 'left', left.toFixed(2) + 'px');
  sty(s, el, 'top', top.toFixed(2) + 'px');
  sty(s, el, 'width', Math.max(0, w).toFixed(2) + 'px');
  sty(s, el, 'height', Math.max(0, h).toFixed(2) + 'px');
  sty(s, el, 'transformOrigin', `${rt.pivot[0] * 100}% ${(1 - rt.pivot[1]) * 100}%`);
  const pk = 1 - 0.04 * s.press;
  sty(s, el, 'transform', rt.rotz || rt.scale[0] !== 1 || rt.scale[1] !== 1 || s.press ? `rotate(${(-rt.rotz).toFixed(2)}deg) scale(${(rt.scale[0] * pk).toFixed(4)}, ${(rt.scale[1] * pk).toFixed(4)})` : '');
  sty(s, el, 'opacity', String(+s.alpha.toFixed(3)));
  if (s.t) sty(s, s.t, 'color', rgba(s.color));
  paintGraphic(s, w, h);
  s.w = w; s.h = h; s.box = [left, top, w, h];
  if (s.ps) s.ps.place(s);
  if (s.n.comps.lg) arrange(s, w, h);
  for (const k of s.kids) layout(k, w, h, rt.pivot, s.shown);
  if (s.stW) applyStencil(s, w, h);
  for (const k of s.kids) if (k.stOuter && k.box) applyStencil(k, k.box[2], k.box[3], k.stOuter, k.box[0], k.box[1]);
}
function markHidden(s) { for (const k of s.kids) { k.shown = false; if (k.ps) k.ps.hide(); markHidden(k); } }

// ---- animation: legacy AnimationClip curves --------------------------------------------------------------------------
function evalKeys(keys, t) {
  if (!keys || !keys.length) return null;
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0, , o0] = keys[i], [t1, v1, i1] = keys[i + 1];
  const dt = t1 - t0, u = (t - t0) / dt;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const one = (a, b, m0, m1) => (Math.abs(m0) >= 1e29 || Math.abs(m1) >= 1e29) ? a : h00 * a + h10 * dt * m0 + h01 * b + h11 * dt * m1;
  if (Array.isArray(v0)) return v0.map((a, k) => one(a, v1[k], o0[k], i1[k]));
  return one(v0, v1, o0, i1);
}
function find(s, path) {
  if (!path) return s;
  let cur = s;
  for (const part of path.split('/')) { cur = cur.kids.find((k) => k.n.name === part); if (!cur) return null; }
  return cur;
}
const AX = { x: 0, y: 1, z: 2 };
function applyCurve(target, c, t) {
  const v = evalKeys(c.keys, t);
  if (v == null) return;
  const rt = target.rt;
  if (c.kind === 'position') { target.lp = [v[0], v[1]]; return; }
  if (c.kind === 'scale') { rt.scale = [v[0], v[1]]; return; }
  if (c.kind === 'euler') { rt.rotz = v[2]; return; }
  const [prop, axis] = c.attr.split('.');
  const ax = AX[axis];
  switch (prop) {
    case 'm_AnchoredPosition': rt.pos[ax] = v; return;
    case 'm_SizeDelta': rt.size[ax] = v; return;
    case 'm_AnchorMin': rt.amin[ax] = v; return;
    case 'm_AnchorMax': rt.amax[ax] = v; return;
    case 'm_Pivot': rt.pivot[ax] = v; return;
    case 'm_LocalScale': if (ax < 2) rt.scale[ax] = v; return;
    case 'm_LocalPosition': if (ax < 2) { if (!target.lp) target.lp = [null, null]; target.lp[ax] = v; } return;
    case 'localEulerAnglesRaw': case 'localEulerAngles': case 'localEulerAnglesBaked': if (ax === 2) rt.rotz = v; return;
    case 'm_Alpha': target.alpha = v; return;
    case 'm_Color': case '_color': if (target.color) target.color[{ r: 0, g: 1, b: 2, a: 3 }[axis]] = v; return;
    case 'm_IsActive': target.active = v > 0.5; return;
    case 'm_Enabled': target.gEnabled = v > 0.5; return;
    case 'm_FillAmount': target.fill = v; return;
    default:
  }
}
let playing = [];
// play a clip on a node; resolves when a non-looping clip ends (or is replaced / its screen closes)
function play(s, clipName, opts = {}) {
  const clip = D.clips[clipName];
  if (!s || !clip) return Promise.resolve();
  const binds = [];
  for (const c of clip.curves) {
    if (c.kind === 'pptr') continue;
    const t = find(s, c.path);
    if (t) binds.push([t, c]);
  }
  const loop = opts.loop ?? (clip.wrap === 2 || /_loop/.test(clipName));
  for (const p of playing) if (p.s === s && p.clip === clip) p.done();
  playing = playing.filter((p) => !(p.s === s && p.clip === clip));
  return new Promise((res) => {
    const p = { s, clip, binds, t: -(opts.delay || 0), loop, rev: !!opts.reverse, len: clip.length || 0.0001, done: res, rate: opts.rate || 1 };
    playing.push(p);
    // the first frame applies at once so a node does not flash in its prefab pose
    if (!opts.delay) for (const [target, c] of binds) applyCurve(target, c, p.rev ? p.len : 0);
  });
}
function stopAnims(s) { playing = playing.filter((p) => { if (p.s === s) { p.done(); return false; } return true; }); }
function tickAnims(dt) {
  for (const p of playing) {
    if (p.s.scr.dead) continue;
    p.t += dt * p.rate;
    if (p.t < 0) continue;
    let t = p.t;
    if (p.loop) t = t % Math.max(p.len, 1e-4);
    else t = Math.min(t, p.len);
    if (p.rev) t = p.len - t;
    for (const [target, c] of p.binds) applyCurve(target, c, t);
  }
  playing = playing.filter((p) => {
    if (p.s.scr.dead || (!p.loop && p.t > p.len)) { p.done(); return false; }
    return true;
  });
}

// ---- screens -------------------------------------------------------------------------------------------------------
const screens = [];
let uiZ = 10;
class Screen {
  constructor(name, { z = null, init = {} } = {}) {
    this.name = name; this.all = []; this.spines = []; this.blurs = []; this.dead = false;
    this.wrap = document.createElement('div'); this.wrap.className = 'screen';
    this.wrap.style.zIndex = z ?? (uiZ += 2);
    this.root = build(D.screens[name], null, name, this);
    stencilScan(this.root);
    this.root.rt = JSON.parse(JSON.stringify(FULL_RT));
    this.wrap.appendChild(this.root.el);
    $('ui').appendChild(this.wrap);
    screens.push(this);
    for (const [k, v] of Object.entries(init)) this.show(k, v);
    layout(this.root, 1280, 720, [0.5, 0.5], true);
    setupUiSpines(this);
  }
  // nodes whose path ends with the given suffix (a node name or a "parent/child" tail)
  q(suf, under) {
    const base = under ? under.path + '/' : '';
    return this.all.filter((s) => (!under || s.path.startsWith(base)) && (s.path === suf || s.path.endsWith('/' + suf)));
  }
  one(suf, under) { return this.q(suf, under)[0] || null; }
  text(suf, v, under) { for (const s of this.q(suf, under)) if (s.t) setText(s, v); }
  show(suf, v, under) { for (const s of this.q(suf, under)) s.active = !!v; }
  image(suf, uri, under, fit) { for (const s of this.q(suf, under)) setImage(s, uri, fit); }
  play(suf, clip, opts, under) { return play(this.one(suf, under), clip, opts); }
  // a click handler on a hotspot (or any node): the node becomes hit-testable, its button root reacts to hover / press
  tap(suf, fn, under) {
    for (const s of this.q(suf, under)) bindTap(s, fn);
  }
  close() {
    this.dead = true;
    if (uiApp && this.wrap.contains(uiApp.view)) { uiApp.view.style.display = 'none'; $('stage').appendChild(uiApp.view); }
    for (const s of this.spines) if (s.skHolder) s.skHolder.destroy({ children: true });
    playing = playing.filter((p) => { if (p.s.scr === this) { p.done(); return false; } return true; });
    this.wrap.remove();
    screens.splice(screens.indexOf(this), 1);
  }
}
function bindTap(s, fn) {
  const btn = s.n.name === 'hotspot' || /^hotspot|^button_start$/.test(s.n.name) ? (s.parent || s) : s;
  s.el.classList.add('hot');
  s.el.onclick = (e) => { e.stopPropagation(); if (!s.shown) return; sfx('click'); fn(e); };
  s.el.onpointerdown = () => { btn.press = 1; };
  s.el.onpointerup = s.el.onpointerleave = () => { btn.press = 0; btn.el.classList.remove('hov'); };
  s.el.onpointerenter = () => btn.el.classList.add('hov');
}
// a prefab template instantiated under a node (a list container): its root keeps the template's RectTransform, the
// container's layout group (if any) places it
let instSeq = 0;
function instantiate(scr, parent, tpl, at = null) {
  const n = D.screens[tpl];
  const s = build(n, parent, parent.path + '/' + tpl + '#' + (++instSeq), scr);
  stencilScan(s);
  if (at != null && at < parent.kids.length) { parent.el.insertBefore(s.el, parent.kids[at].el); parent.kids.splice(at, 0, s); }
  else { parent.kids.push(s); parent.el.appendChild(s.el); }
  return s;
}
function removeNode(s) {
  const p = s.parent;
  if (p) p.kids.splice(p.kids.indexOf(s), 1);
  s.el.remove();
  const pre = s.path;
  playing = playing.filter((x) => { if (x.s.path === pre || x.s.path.startsWith(pre + '/')) { x.done(); return false; } return true; });
  s.scr.all = s.scr.all.filter((x) => x.path !== pre && !x.path.startsWith(pre + '/'));
}
function clearKids(s) { for (const k of s.kids.slice()) removeNode(k); }
function animNodes(s, out = []) { if (s.n.comps.anim) out.push(s); s.kids.forEach((k) => animNodes(k, out)); return out; }
// every looping clip under a node (idle loops of a screen: blinking dots, rotating rings, scrolling tiles)
function playLoops(scr, under = scr.root, skip = /x^/) {
  for (const s of animNodes(under)) for (const cn of s.n.comps.anim.clips) {
    const clip = D.clips[cn];
    if (clip && (clip.wrap === 2 || /_loop/.test(cn)) && !skip.test(cn)) play(s, cn, { loop: true });
  }
}

// ---- Spine (SkeletonGraphic) in the UI: pixi-spine on the canvas above the UI, the JSON served from memory ----------
let uiApp = null;
const VFS = {};
function installVfs() {
  const ad = PIXI.settings.ADAPTER, f0 = ad.fetch.bind(ad);
  ad.fetch = (url, o) => {
    const u = String(url), k = Object.keys(VFS).find((x) => u.endsWith(x));   // the loader resolves our path against the page URL
    if (!k) return f0(url, o);
    const v = VFS[k];
    return Promise.resolve(new Response(v, { headers: { 'Content-Type': typeof v === 'string' ? 'application/json' : 'application/octet-stream' } }));
  };
}
async function setupUiSpines(scr) {
  if (!scr.spines.length || !window.PIXI || !PIXI.spine || !uiApp) return;
  for (const s of scr.spines) {
    const sp = s.n.comps.spine, asset = D.spines[sp.asset];
    if (!asset) continue;
    const url = `vfs/uispine_${sp.asset}.json`;
    VFS[url] = asset.json;
    const atlas = new PIXI.spine.TextureAtlas(asset.atlas, (line, cb) => cb(PIXI.BaseTexture.from(asset.pages[line.replace(/\.png$/, '')] || Object.values(asset.pages)[0])));
    try {
      const res = await PIXI.Assets.load({ src: url, data: { spineAtlas: atlas } });
      if (scr.dead) return;
      const sk = new PIXI.spine.Spine(res.spineData);
      sk.autoUpdate = false;
      // SkeletonGraphic: skeleton units × the data asset's scale × 100 reference pixels per unit
      const k = (asset.scale || 0.01) * 100;
      sk.scale.set(k);
      if (sp.anim) sk.state.setAnimation(0, sp.anim, !!sp.loop);
      sk.update(0);
      const b = sk.getLocalBounds();
      const ext = Math.max(Math.abs(b.x), Math.abs(b.y), Math.abs(b.x + b.width), Math.abs(b.y + b.height)) * k;
      // the UI Spine canvas moves into the node it draws for, so the UI drawn after it in the hierarchy stays on top
      s.skel = sk; s.skC = Math.min(1600, Math.ceil(ext * 2.6 + 64));
      s.skHolder = new PIXI.Container(); s.skHolder.addChild(sk);
    } catch (e) { console.warn('UI spine', e); }
  }
}
function renderUiSpines(dt, stageK) {
  if (!uiApp) return;
  const cv = uiApp.view;
  let s = null;
  for (const scr of screens) for (const x of scr.spines) if (!s && x.skel && x.shown) s = x;
  if (!s) { if (cv.style.display !== 'none') cv.style.display = 'none'; return; }
  s.skel.update(dt);
  const C = s.skC, px = Math.round(Math.min(1024, C * stageK * (window.devicePixelRatio || 1)));
  const r = uiApp.renderer;
  if (r.width !== px || r.height !== px || r.resolution !== 1) { r.resolution = 1; r.resize(px, px); }
  if (cv.parentNode !== s.el) s.el.insertBefore(cv, s.el.firstChild);
  cv.style.display = 'block'; cv.style.width = cv.style.height = C + 'px';
  const cx = s.rt.pivot[0] * s.w, cy = (1 - s.rt.pivot[1]) * s.h;
  cv.style.left = (cx - C / 2).toFixed(1) + 'px'; cv.style.top = (cy - C / 2).toFixed(1) + 'px';
  s.skHolder.scale.set(px / C); s.skHolder.position.set(px / 2, px / 2);
  s.skHolder.alpha = s.color ? s.color[3] : 1;
  r.render(s.skHolder, { clear: true });
}

// ---- sound: the duel's own UI sounds and a BGM (intro, then a seamless loop), decoded from Ogg Opus in memory ------
// AUDIO maps clip names to base64 Ogg Opus (extracted from the client's audio bundles). Web Audio starts only after a
// click (autoplay policy), so the page opens on a "click to start" screen.
const SND = { log: [], ctx: null, buf: {}, music: null, sfxGain: null, musicGain: null, musicOn: true, sfxOn: true, bgm: null, track: '' };
// game events → clips (the audio table's ui.ON_ENEMYDUEL_DQ* events; generic taps use the tab-switch tick)
const SFX_ALIAS = { click: 'g_ui_tabswitch', match: 'g_ui_matchsucceed', cancel: 'g_ui_matchcancel' };
const MUSIC_VOL = 0.45;
async function initSound() {
  if (SND.ctx) return;
  const ctx = SND.ctx = new (window.AudioContext || window.webkitAudioContext)();
  SND.sfxGain = ctx.createGain(); SND.sfxGain.gain.value = 0.8; SND.sfxGain.connect(ctx.destination);
  SND.musicGain = ctx.createGain(); SND.musicGain.gain.value = MUSIC_VOL; SND.musicGain.connect(ctx.destination);
  await Promise.all(Object.entries(typeof AUDIO !== 'undefined' ? AUDIO : {}).map(async ([k, b64]) => {
    try { SND.buf[k] = await ctx.decodeAudioData(b64bytes(b64).buffer); } catch (e) { console.warn('audio', k, e); }
  }));
}
function sfx(kind) {
  if (!SND.ctx || !SND.sfxOn) return;
  const b = SND.buf[SFX_ALIAS[kind] || kind];
  if (SND.log.length < 400) SND.log.push((b ? '' : '!') + (SFX_ALIAS[kind] || kind));
  if (!b) return;
  const src = SND.ctx.createBufferSource(); src.buffer = b; src.connect(SND.sfxGain); src.start();
}
// the intro once, then the loop clip repeating sample-exactly (a whole track loops up to `loopEnd`, skipping its tail)
function playMusic(intro, loop, title, loopEnd) {
  stopMusic();
  if (!SND.ctx) return;
  const ctx = SND.ctx, out = SND.musicGain, srcs = [];
  let at = ctx.currentTime + 0.05;
  if (intro) { const a = ctx.createBufferSource(); a.buffer = intro; a.connect(out); a.start(at); srcs.push(a); at += intro.duration; }
  if (loop) {
    const l = ctx.createBufferSource(); l.buffer = loop; l.loop = true;
    if (loopEnd && loopEnd < loop.duration) { l.loopStart = 0; l.loopEnd = loopEnd; }
    l.connect(out); l.start(at); srcs.push(l);
  }
  SND.music = srcs; SND.track = title;
  if (typeof onTrackChange === 'function') onTrackChange(title);
}
function stopMusic() { if (SND.music) for (const x of SND.music) { try { x.stop(); } catch (e) { /* not started */ } } SND.music = null; }
function setMusicOn(on) { SND.musicOn = on; if (SND.musicGain) SND.musicGain.gain.setTargetAtTime(on ? MUSIC_VOL : 0, SND.ctx.currentTime, 0.08); }
async function loadMusicFile(file) {
  if (!SND.ctx) await initSound();
  const buf = await SND.ctx.decodeAudioData(await file.arrayBuffer());
  SND.bgm = { intro: null, loop: buf, title: file.name.replace(/\.[^.]+$/, '') };
  playMusic(null, buf, SND.bgm.title);
}
function startBgm() {
  if (!SND.ctx || SND.music) return;
  // the duel's BGM, supplied by the user (music/No Bet, No Life.wav): the whole track loops; its last 0.3 s is
  // silence after the fade, so the loop ends at 161.5 s
  if (!SND.bgm) SND.bgm = { intro: null, loop: SND.buf.m_nobetnolife, title: 'No Bet, No Life', loopEnd: 161.5 };
  playMusic(SND.bgm.intro, SND.bgm.loop, SND.bgm.title, SND.bgm.loopEnd);
}
