// ---- UIParticle: every ParticleSystem under a UIParticle node simulated in 2D on a canvas inside that node ---------
// Units: a system's sizes, speeds and shape extents are its own units × its offset scale (the product of the local
// scales between it and the UIParticle), × 10 more for systems in Local scaling mode — the rule that matches the
// known on-screen sizes (the streak fire next to a 40 px counter, the confetti, the music-player bars). Positions use
// the system's offset under the UIParticle, y up. Shapes emitting along +Z (cones, boxes) move only by their 2D lean.
// Additive materials draw with 'lighter'; the legacy particle shaders' tint colour is doubled.
const PIMG = {};
function preloadPtex() {
  return Promise.all(Object.entries(D.ptex || {}).map(([k, uri]) => new Promise((res) => { const im = new Image(); im.onload = () => { PIMG[k] = im; res(); }; im.onerror = () => res(); im.src = uri; })));
}
const ptint = new Map();
function tintedTex(key, r, g, b) {
  const q = (v) => Math.round(clamp(v, 0, 1) * 12) / 12;
  r = q(r); g = q(g); b = q(b);
  const im = PIMG[key];
  if (!im || (r > 0.99 && g > 0.99 && b > 0.99)) return im;
  const ck = key + r + ',' + g + ',' + b;
  let c = ptint.get(ck);
  if (c) return c;
  c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const x = c.getContext('2d');
  x.drawImage(im, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(im, 0, 0);
  ptint.set(ck, c);
  return c;
}
function mmEval(m, t, rnd) {
  if (!m) return 0;
  switch (m.st) {
    case 0: return m.sc;
    case 1: return (m.cx && m.cx.length ? evalKeys(m.cx, t) : 1) * m.sc;
    case 2: return lerp(evalKeys(m.cn, t) ?? 0, evalKeys(m.cx, t) ?? 0, rnd) * m.sc;
    case 3: return lerp(m.mn, m.sc, rnd);
    default: return m.sc || 0;
  }
}
function sampleGrad(g, t) {
  if (!g) return [1, 1, 1, 1];
  const ck = g.c, ak = g.a;
  let col = [ck[0][0], ck[0][1], ck[0][2]];
  if (t >= ck[ck.length - 1][3]) col = ck[ck.length - 1].slice(0, 3);
  else for (let i = 0; i < ck.length - 1; i++) {
    const a = ck[i], b = ck[i + 1];
    if (t >= a[3] && t <= b[3]) { const u = b[3] > a[3] ? (t - a[3]) / (b[3] - a[3]) : 0; col = [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)]; break; }
  }
  let al = ak[0][0];
  if (t >= ak[ak.length - 1][1]) al = ak[ak.length - 1][0];
  else for (let i = 0; i < ak.length - 1; i++) {
    const a = ak[i], b = ak[i + 1];
    if (t >= a[1] && t <= b[1]) { const u = b[1] > a[1] ? (t - a[1]) / (b[1] - a[1]) : 0; al = lerp(a[0], b[0], u); break; }
  }
  return [col[0], col[1], col[2], al];
}
function startColor(m, tn, rnd) {
  if (!m) return [1, 1, 1, 1];
  switch (m.st) {
    case 1: return sampleGrad(m.gmax, tn);
    case 2: return m.cmin.map((v, i) => lerp(v, m.cmax[i], rnd));
    case 3: { const a = sampleGrad(m.gmin, tn), b = sampleGrad(m.gmax, tn); return a.map((v, i) => lerp(v, b[i], rnd)); }
    case 4: return sampleGrad(m.gmax, rnd);
    default: return m.cmax.slice();
  }
}
class PSys {
  constructor(d) {
    this.d = d;
    this.U = (d.off[2] || 1) * (d.scaling === 1 ? 10 : 1);
    const q = d.q || [0, 0, 0, 1];
    this.rz = 2 * Math.atan2(q[2], q[3]);
    this.flipX = Math.abs(q[0]) > 0.3 && Math.abs(q[1]) > 0.3;   // a quarter turn about x and y: a mirrored, edge-on plane
    this.restart();
  }
  restart() {
    this.ps = []; this.t = 0; this.acc = 0; this.fired = new Set();
    this.delay = mmEval(this.d.delay, 0, Math.random());
    const d = this.d;
    if (d.loop && d.prewarm) for (let i = 0, n = Math.min(200, Math.ceil(Math.min(d.dur, 10) * 20)); i < n; i++) this.step(0.05);
  }
  extent() {
    const d = this.d, U = this.U, life = Math.max(d.life.sc, d.life.mn || 0);
    const size = Math.max(d.size.sc, d.size.mn || 0) * U * (d.sizeOL ? 1.2 : 1);
    const speed = Math.max(Math.abs(d.speed.sc), Math.abs(d.speed.mn || 0)) * U;
    const sh = d.shape.on ? Math.max(d.shape.radius, d.shape.box[0] / 2, d.shape.box[1] / 2) * U : 0;
    return Math.hypot(d.off[0], d.off[1]) + Math.min(size, 1600) / 2 + Math.min(speed * life, 600) + sh;
  }
  spawn(tn) {
    const d = this.d, sh = d.shape, U = this.U, r = Math.random;
    if (this.ps.length >= Math.min(d.max || 1000, 400)) return;
    let x = 0, y = 0, dx = 0, dy = 0;
    if (sh.on) {
      const rad = sh.radius * U, arc = (sh.arc ?? 360) * Math.PI / 180;
      switch (sh.type) {
        case 0: case 1: case 2: case 3: case 10: case 11: case 17: {
          const a = r() * arc, shell = sh.type === 1 || sh.type === 3 || sh.type === 11, rr = (shell ? 1 : Math.sqrt(r())) * rad;
          x = Math.cos(a) * rr; y = Math.sin(a) * rr; dx = Math.cos(a); dy = Math.sin(a); break;
        }
        case 4: case 7: case 8: case 9: {
          const a = r() * arc, f = Math.sqrt(r()), lean = Math.sin(sh.angle * Math.PI / 180) * f;
          x = Math.cos(a) * f * rad; y = Math.sin(a) * f * rad; dx = Math.cos(a) * lean; dy = Math.sin(a) * lean; break;
        }
        case 5: case 15: case 16: case 18:
          x = (r() - 0.5) * sh.box[0] * U; y = (r() - 0.5) * sh.box[1] * U; break;
        case 12: x = (r() * 2 - 1) * rad; dy = 1; break;
        default: break;
      }
      if (sh.randDir > 0 || sh.sph > 0) {
        const a = r() * Math.PI * 2, k = Math.max(sh.randDir, sh.sph) * r();
        dx = lerp(dx, Math.cos(a), k); dy = lerp(dy, Math.sin(a), k);
      }
      const srz = (sh.rot ? sh.rot[2] : 0) * Math.PI / 180;
      if (srz) { [x, y] = [x * Math.cos(srz) - y * Math.sin(srz), x * Math.sin(srz) + y * Math.cos(srz)]; [dx, dy] = [dx * Math.cos(srz) - dy * Math.sin(srz), dx * Math.sin(srz) + dy * Math.cos(srz)]; }
      x += (sh.pos ? sh.pos[0] : 0) * U; y += (sh.pos ? sh.pos[1] : 0) * U;
    }
    if (this.rz) { const c = Math.cos(this.rz), s = Math.sin(this.rz); [x, y] = [x * c - y * s, x * s + y * c]; [dx, dy] = [dx * c - dy * s, dx * s + dy * c]; }
    const sp = mmEval(d.speed, tn, r()) * U;
    const p = { x: x + d.off[0], y: y + d.off[1], vx: dx * sp, vy: dy * sp, age: 0, life: Math.max(0.02, mmEval(d.life, tn, r())),
      size: mmEval(d.size, tn, r()) * U, rot: mmEval(d.rot, tn, r()), col: startColor(d.color, tn, r()), r1: r(), r2: r(), r3: r() };
    this.ps.push(p);
  }
  step(dt) {
    const d = this.d;
    if (this.delay > 0) { this.delay -= dt; this.age(dt); return; }
    const dur = Math.max(0.01, d.dur);
    if (d.loop || this.t < dur) {
      const lt = this.t % dur, lp = Math.floor(this.t / dur), tn = lt / dur;
      this.acc += (d.rate ? mmEval(d.rate, tn, Math.random()) : 0) * dt;
      while (this.acc >= 1) { this.acc -= 1; this.spawn(tn); }
      d.bursts.forEach((b, i) => {
        const cycles = b.cycles > 0 ? b.cycles : Math.min(50, Math.floor((dur - b.t) / Math.max(0.01, b.iv)) + 1);
        for (let c = 0; c < cycles; c++) {
          const bt = b.t + c * b.iv, key = lp + ':' + i + ':' + c;
          if (lt >= bt && !this.fired.has(key)) {
            this.fired.add(key);
            const n = Math.round(mmEval(b.n, tn, Math.random()));
            for (let k = 0; k < n; k++) this.spawn(tn);
          }
        }
      });
      if (this.fired.size > 400) this.fired.clear();
    }
    this.t += dt;
    this.age(dt);
  }
  age(dt) {
    const d = this.d, U = this.U, g = d.gravity ? mmEval(d.gravity, 0, 0.5) : 0;
    this.ps = this.ps.filter((p) => (p.age += dt) < p.life);
    for (const p of this.ps) {
      const tl = p.age / p.life;
      let vx = p.vx, vy = p.vy;
      if (d.vel) { vx += mmEval(d.vel[0], tl, p.r1) * U; vy += mmEval(d.vel[1], tl, p.r2) * U; }
      if (g) p.vy -= 9.81 * g * U * dt;
      p.x += vx * dt; p.y += vy * dt;
      if (d.rotOL) p.rot += mmEval(d.rotOL, tl, p.r3) * dt;
      p.svx = vx; p.svy = vy;
    }
  }
  draw(ctx, k, cx, cy) {
    const d = this.d, im = PIMG[d.tex];
    if (!im || !this.ps.length) return;
    ctx.globalCompositeOperation = d.blend === 'add' ? 'lighter' : 'source-over';
    const tint = d.tint ? d.tint.map((v, i) => (i < 3 ? Math.min(1, v * 2) : Math.min(1, v * 2))) : [1, 1, 1, 1];
    const tx = d.uv ? d.uv.x : 1, ty = d.uv ? d.uv.y : 1, fw = im.width / tx, fh = im.height / ty, nF = tx * ty;
    for (const p of this.ps) {
      const tl = p.age / p.life;
      let size = p.size * (d.sizeOL ? mmEval(d.sizeOL, tl, p.r2) : 1);
      if (!(size > 0.3)) continue;
      size = Math.min(size, 1800);
      const oc = d.col ? sampleGrad(d.col, tl) : [1, 1, 1, 1];
      const a = p.col[3] * oc[3] * tint[3];
      if (a < 0.01) continue;
      const tex = tintedTex(d.tex, p.col[0] * oc[0] * tint[0], p.col[1] * oc[1] * tint[1], p.col[2] * oc[2] * tint[2]) || im;
      let f = 0;
      if (d.uv) {
        const fv = mmEval(d.uv.f, ((tl * (d.uv.cycles || 1)) % 1), p.r1);
        f = Math.min(nF - 1, Math.floor(fv * nF)) + Math.floor(mmEval(d.uv.start, 0, p.r3));
        f = ((f % nF) + nF) % nF;
      }
      const sx = (f % tx) * fw, sy = Math.floor(f / tx) * fh;
      ctx.globalAlpha = clamp(a, 0, 1);
      const px = cx + p.x, py = cy - p.y;
      let w = size, h = size * (fh / fw), rot = -p.rot;
      if (d.render && d.render.mode === 1) {
        const v = Math.hypot(p.svx || 0, p.svy || 0);
        w = size * (d.render.lengthScale || 1) + v * (d.render.velScale || 0);
        rot = v > 1e-3 ? Math.atan2(-(p.svy || 0), p.svx || 0) : rot;
      }
      const c = Math.cos(rot) * k, s = Math.sin(rot) * k;
      ctx.setTransform(this.flipX ? -c : c, this.flipX ? -s : s, -s, c, px * k, py * k);
      ctx.drawImage(tex, sx, sy, fw, fh, -w / 2, -h / 2, w, h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }
}
const liveParticles = new Set();
class UIParticles {
  constructor(s) {
    this.s = s;
    this.systems = s.n.comps.particle.systems.filter((d) => d.tex).map((d) => new PSys(d));
    const ext = Math.max(32, ...this.systems.map((p) => p.extent()));
    this.C = Math.min(2400, Math.ceil(ext * 2 + 16));
    this.cv = document.createElement('canvas');
    this.cv.className = 'pc';
    this.cv.style.width = this.cv.style.height = this.C + 'px';
    s.el.insertBefore(this.cv, s.el.firstChild);
    this.ctx = this.cv.getContext('2d');
    this.visible = false; this.k = 0;
    this.onceDone = false;
  }
  place(s) {
    if (!this.visible) { this.visible = true; for (const p of this.systems) p.restart(); }
    liveParticles.add(this);
    const px = s.rt.pivot[0] * s.w, py = (1 - s.rt.pivot[1]) * s.h;
    sty(s, this.cv, 'left', (px - this.C / 2).toFixed(1) + 'px');
    sty(s, this.cv, 'top', (py - this.C / 2).toFixed(1) + 'px');
  }
  hide() { this.visible = false; liveParticles.delete(this); }
  restart() { for (const p of this.systems) p.restart(); }
  frame(dt, stageK) {
    if (!this.s.shown || this.s.scr.dead) { this.hide(); return; }
    for (const p of this.systems) p.step(dt * (p.d.speedMul || 1));
    // backing store: screen resolution for small emitters, capped for the big soft ones
    const k = Math.max(0.2, Math.min(stageK * (window.devicePixelRatio || 1), 1100 / this.C));
    const px = Math.round(this.C * k);
    if (this.cv.width !== px) { this.cv.width = this.cv.height = px; }
    this.k = px / this.C;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, px, px);
    for (const p of this.systems) p.draw(this.ctx, this.k, this.C / 2, this.C / 2);
  }
}
function tickParticles(dt, stageK) { for (const u of [...liveParticles]) u.frame(dt, stageK); }
