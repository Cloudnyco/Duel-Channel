// ---- arena: the 直播主赛场 — the stage, its lights and the battle effects ---------------------------------------------
// The level's layout (15 × 11: a raised forbidden rim, the red start column, 11 duel columns, the blue end column) built
// from the client's own battle art: the common map atlases for the tiles and the highland rim, the tile_start / tile_end
// effects for the gates, the env's boundary line (common_V060_line_*) for the safe zone, the HUD's enemy HP bar and the
// buff effects (excitement, stun, frozen). Around it the broadcast: an LED wall playing the 礼物对决 key art (bg1; for
// 竞猜对决, whose art the package does not have, the page's stand-in banner of the mode) with a ticker naming the mode
// and round, and three yellow follow-spots that sweep while the viewers bet and track each side once the fight starts.
// Hit effects use the client's FX sprites (fxcommon / UI atlases): physical = white-yellow, arts = violet.
const FLOOR = { cx: 640, top: 238, bottom: 690, farK: 0.74, T: 79 };
function proj(x, y) {
  const v = clamp((y + 1) / (AH + 2), -0.2, 1.2), k = lerp(FLOOR.farK, 1, v);
  const acc = (FLOOR.farK * v + (1 - FLOOR.farK) * v * v / 2) / ((FLOOR.farK + 1) / 2);
  return [FLOOR.cx + (x - AW / 2) * FLOOR.T * k, FLOOR.top + (FLOOR.bottom - FLOOR.top) * acc, k];
}
const TEAM_COL = [0xe8473d, 0x2f86e8];
// the HUD's own HP colours: enemy_hp_slider's fill (left, the red start side) and char_hp_slider's (right, blue)
const TEAM_HP = [0xea4700, 0x49b2e3];
const COL = { yellow: 0xf6e033, spot: 0xffe68a, phys: 0xfff0b8, arts: 0xb98cff, zone: 0xffa63d, ice: 0x9fd8ff, gold: 0xffd060, fear: 0xc0306a };
let arenaApp = null, arena = null;
const spineData = new Map();
const b64bytes = (s) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
function loadFighter(f) {
  if (spineData.has(f.key)) return spineData.get(f.key);
  const p = (async () => {
    const url = `vfs/f_${f.key}.skel`;
    VFS[url] = b64bytes(f.spine.skel);
    const mode = f.spine.pma ? PIXI.ALPHA_MODES.PMA : PIXI.ALPHA_MODES.UNPACK;
    const atlas = new PIXI.spine.TextureAtlas(f.spine.atlas, (name, cb) => cb(PIXI.BaseTexture.from('data:image/png;base64,' + (f.spine.pages[name] || Object.values(f.spine.pages)[0]), { alphaMode: mode })));
    const res = await PIXI.Assets.load({ src: url, data: { spineAtlas: atlas } });
    return res.spineData;
  })();
  spineData.set(f.key, p);
  return p;
}
const iconUri = (f) => (f && f.icon ? 'data:image/png;base64,' + f.icon : '');
function lerpCol(a, b, t) {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t), g = lerp((a >> 8) & 255, (b >> 8) & 255, t), bl = lerp(a & 255, b & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
const ADD = () => PIXI.BLEND_MODES.ADD;

// ---- textures: the client's FX sprites (FXTEX, data URIs) and a few drawn ones -------------------------------------------
const TX = {};
function tex(name) {
  if (TX[name]) return TX[name];
  if (name === 'smokeA' || name === 'smokeB') {
    const base = tex('smoke').baseTexture;
    return (TX[name] = new PIXI.Texture(base, new PIXI.Rectangle(name === 'smokeA' ? 0 : 128, 0, 128, 256)));
  }
  return (TX[name] = PIXI.Texture.from(FXTEX[name]));
}
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return PIXI.Texture.from(c); }

function initArena() {
  arenaApp = new PIXI.Application({ view: $('arena'), width: 1280, height: 720, backgroundColor: 0x070909, antialias: true, autoStart: false });
  arena = {
    root: new PIXI.Container(), back: new PIXI.Container(), floor: new PIXI.Container(), pools: new PIXI.Container(), zoneL: new PIXI.Container(),
    unitsC: new PIXI.Container(), fx: new PIXI.Container(), air: new PIXI.Container(), W: null, acc: 0, ff: 1, running: false, t: 0, spots: [], built: false,
  };
  arenaApp.stage.addChild(arena.root);
  arena.root.addChild(arena.back, arena.floor, arena.zoneL, arena.pools, arena.unitsC, arena.fx, arena.air);
  arena.zoneShown = -2; arena.flashT = 0;
  arena.unitsC.sortableChildren = true;
  FX.layer = arena.fx;
}

// ---- the stage (built once the fonts are in, the floor's wordmark is drawn with them) -----------------------------------
function buildStage() {
  if (arena.built) return;
  arena.built = true;
  buildBackdrop();
  buildFloor();
  buildLights();
  buildFlash();
}
// behind the field: the studio wall, the LED screen (key art + dot mask + ticker), the truss, the crowd at the sides
function buildBackdrop() {
  const B = arena.back, g = new PIXI.Graphics();
  for (let i = 0; i < 24; i++) { g.beginFill(lerpCol(0x050707, 0x0d1112, i / 23)); g.drawRect(0, i * 30, 1280, 31); g.endFill(); }
  // wall panels with seams
  for (let x = 0; x < 1280; x += 64) { g.beginFill(0x0b0f10, 0.9); g.drawRect(x + 1, 30, 62, 210); g.endFill(); }
  B.addChild(g);
  // the LED wall
  const L = { x: 138, y: 58, w: 1004, h: 168 };
  const led = new PIXI.Container();
  const art = new PIXI.Sprite(tex('keyart'));
  // the art across the wall's width, centred on its height (the key art is 1559 × 960)
  const fitArt = (w = 1559, h = 960) => { const s = L.w / w; art.scale.set(s); art.position.set(L.x, L.y + L.h / 2 - h * s * 0.5); };
  fitArt(); art.alpha = 1;
  arena.ledArt = { art, fit: fitArt, key: 'keyart' };
  const mask = new PIXI.Graphics(); mask.beginFill(0xffffff); mask.drawRect(L.x, L.y, L.w, L.h); mask.endFill();
  led.addChild(art, mask); art.mask = mask;
  const dots = new PIXI.TilingSprite(canvasTex(6, 6, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 6, 6); x.clearRect(1, 1, 4, 4); }), L.w, L.h);
  dots.position.set(L.x, L.y); dots.alpha = 0.42;
  led.addChild(dots);
  const shade = new PIXI.Graphics(); shade.beginFill(0x000000, 0.1); shade.drawRect(L.x, L.y, L.w, L.h); shade.endFill();
  led.addChild(shade);
  // the ticker: duel yellow on black, scrolling
  const band = new PIXI.Graphics(); band.beginFill(0x0a0b0b); band.drawRect(L.x, L.y + L.h - 26, L.w, 26); band.endFill();
  band.beginFill(COL.yellow); band.drawRect(L.x, L.y + L.h - 27, L.w, 2); band.endFill();
  led.addChild(band);
  arena.tickerText = new PIXI.Text('', { fontFamily: 'Novecento, Noto Sans SC, Microsoft YaHei, sans-serif', fontSize: 17, fontWeight: '700', fill: COL.yellow, letterSpacing: 3 });
  arena.ticker = new PIXI.TilingSprite(PIXI.Texture.EMPTY, L.w, 24);
  arena.ticker.position.set(L.x, L.y + L.h - 25);
  led.addChild(arena.ticker);
  setTicker('');
  // bezel
  const bez = new PIXI.Graphics();
  bez.lineStyle(6, 0x171c1d); bez.drawRect(L.x - 3, L.y - 3, L.w + 6, L.h + 6);
  bez.lineStyle(1, 0x2c3436); bez.drawRect(L.x - 6, L.y - 6, L.w + 12, L.h + 12);
  led.addChild(bez);
  B.addChild(led);
  arena.ledDots = dots;
  // the truss and its lamp heads (the follow-spots hang here)
  const truss = new PIXI.Graphics();
  truss.beginFill(0x111617); truss.drawRect(0, 0, 1280, 16); truss.endFill();
  truss.lineStyle(2, 0x1f2729); for (let x = 0; x < 1280; x += 24) { truss.moveTo(x, 0); truss.lineTo(x + 12, 16); truss.moveTo(x + 12, 16); truss.lineTo(x + 24, 0); }
  truss.lineStyle(0);
  for (const x of [230, 640, 1050]) { truss.beginFill(0x232b2d); truss.drawRoundedRect(x - 16, 8, 32, 20, 4); truss.endFill(); truss.beginFill(0xfff2b0, 0.9); truss.drawRoundedRect(x - 10, 22, 20, 5, 2); truss.endFill(); }
  B.addChild(truss);
  // the crowd beside the field: silhouette rows, phone lights twinkling (updated in stageFrame)
  const crowd = new PIXI.Graphics();
  arena.crowdPts = [];
  for (const side of [0, 1]) for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
    const x = side ? 1100 + i * 21 + (row % 2) * 10 : 8 + i * 21 + (row % 2) * 10, y = 250 + row * 34 + Math.sin(i * 1.7 + row) * 3;
    crowd.beginFill(lerpCol(0x0a0d0e, 0x15191a, row / 3)); crowd.drawCircle(x, y, 8); crowd.drawRoundedRect(x - 12, y + 6, 24, 26, 8); crowd.endFill();
    arena.crowdPts.push([x, y]);
  }
  B.addChild(crowd);
}
// the wall's picture for a mode: the key art, or 竞猜对决's stand-in banner
function setLedArt(stand) {
  const L = arena.ledArt, want = stand && typeof ART !== 'undefined' && ART.stand ? 'stand' : 'keyart';
  if (!L || L.key === want) return;
  L.key = want;
  if (want === 'keyart') { L.art.texture = tex('keyart'); L.fit(); return; }
  // the banner (1280 × 420, a data URI) sized once it has loaded
  const t = PIXI.Texture.from(ART.stand.banner), fit = () => L.fit(t.baseTexture.width, t.baseTexture.height);
  L.art.texture = t;
  if (t.baseTexture.valid) fit(); else t.baseTexture.once('loaded', fit);
}
function setTicker(round) {
  if (!arena.tickerText) return;
  const stand = typeof G !== 'undefined' && G.mode && G.mode.key === 'stand';
  const [en, name] = stand ? [G.mode.en, G.mode.name] : ['ULTIMATE GIFT CRASH', '礼物对决'];
  arena.tickerText.text = `DUEL CHANNEL   ▸▸   ${en}   ▸▸   ${name} · 直播中   ▸▸   ${round || '青草城对战中心'}   ▸▸   `;
  arena.tickerText.updateText(true);
  arena.ticker.texture = arena.tickerText.texture;
  // one row only: the band is as tall as the text
  arena.ticker.height = arena.tickerText.height; arena.ticker.y = 58 + 168 - 13 - arena.tickerText.height / 2;
}
// the floor, in the client's own map art: the 11 × 9 duel tiles and the gate columns are the common atlas's road metal
// (TX_Common_Lungmen_N_01, a non-deployable tile: no yellow frame), the forbidden rim is raised highland — its tops the
// common forbidden tile (hazard-taped, T_common_A), its inner faces lit by the highland's yellow triangle lamps. The start /
// end columns carry the client's tile_start / tile_end effect: a red / blue frame and warning decal on the ground
// (T_starting_A / T_ending_A on the effect's plane, its UVs) and a glowing box face (T_starting_Mask beams).
const RIM_H = 0.42, GATE_H = 0.5;
function projH(x, y, h) { const [px, py, k] = proj(x, y); return [px, py - h * FLOOR.T * k * 0.8, k]; }
const fxImg = (k) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = FXTEX[k]; });
// one mesh of many quads: q = { p: four screen points (tl, tr, br, bl), uv: four [u, v] (default the full texture) }
function quadsMesh(tex, quads, blend) {
  const v = [], uv = [], idx = [];
  quads.forEach((q, i) => {
    for (const p of q.p) v.push(p[0], p[1]);
    for (const t of q.uv || [[0, 0], [1, 0], [1, 1], [0, 1]]) uv.push(t[0], t[1]);
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const m = new PIXI.Mesh(new PIXI.MeshGeometry(new Float32Array(v), new Float32Array(uv), new Uint16Array(idx)), new PIXI.MeshMaterial(tex));
  if (blend != null) m.blendMode = blend;
  return m;
}
async function buildFloor() {
  const [ground, forbid, hlight, gateR, gateB, beamR, beamB] = await Promise.all(['ground', 'forbid', 'hlight', 'gateR', 'gateB', 'beamR', 'beamB'].map(fxImg));
  const TS = 96, CW = (AW + 2) * TS, CH = (AH + 2) * TS;
  const floorTex = canvasTex(CW, CH, (x) => {
    const rnd = mulberry32(20250426);
    x.fillStyle = '#06080a'; x.fillRect(0, 0, CW, CH);
    for (let r = 0; r < AH + 2; r++) for (let c = 0; c < AW + 2; c++) {
      const X = c * TS, Y = r * TS, rim = r === 0 || r === AH + 1 || c === 0 || c === AW + 1;
      x.save(); x.translate(X + TS / 2, Y + TS / 2); x.rotate(Math.floor(rnd() * 4) * Math.PI / 2);
      if (rim) x.drawImage(forbid, -TS / 2, -TS / 2, TS, TS); else x.drawImage(ground, -TS / 2 + 2, -TS / 2 + 2, TS - 4, TS - 4);
      x.restore();
      // the studio is dark: the map art toned down, a little per-tile variation; seams and a bevel
      x.fillStyle = rim ? 'rgba(8,10,12,.5)' : `rgba(8,12,16,${0.34 + rnd() * 0.08})`; x.fillRect(X, Y, TS, TS);
      if (!rim) {
        x.fillStyle = 'rgba(190,210,230,.12)'; x.fillRect(X + 2, Y + 2, TS - 4, 2); x.fillRect(X + 2, Y + 2, 2, TS - 4);
        x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(X + 2, Y + TS - 4, TS - 4, 2); x.fillRect(X + TS - 4, Y + 2, 2, TS - 4);
        x.fillStyle = '#050607'; x.fillRect(X, Y, TS, 2); x.fillRect(X, Y, 2, TS);
      }
    }
    // the gates: per tile the effect plane — a solid frame band (5 % a side) and the warning decal inside
    for (const [col, img, rgb] of [[1, gateR, '255,82,82'], [AW, gateB, '102,82,255']]) for (let r = 1; r <= AH; r++) {
      const X = col * TS, Y = r * TS, b = TS * 0.05;
      x.fillStyle = `rgba(${rgb},.16)`; x.fillRect(X + 2, Y + 2, TS - 4, TS - 4);
      x.fillStyle = `rgba(${rgb},.85)`; x.fillRect(X + 2, Y + 2, TS - 4, b); x.fillRect(X + 2, Y + TS - 2 - b, TS - 4, b); x.fillRect(X + 2, Y + 2, b, TS - 4); x.fillRect(X + TS - 2 - b, Y + 2, b, TS - 4);
      // the plane's inner UVs (0.0147…0.7912 × 0.0103…0.7868, v up) on the 128 px texture
      x.save(); x.globalAlpha = 0.9; x.globalCompositeOperation = 'lighter';
      x.drawImage(img, 2, 27, 99, 99, X + 2 + b, Y + 2 + b, TS - 4 - 2 * b, TS - 4 - 2 * b); x.restore();
    }
  });
  // the field (ground level): 2 × 2 cells a tile
  const SX = AW * 2, SY = AH * 2, verts = [], uvs = [], idx = [];
  for (let j = 0; j <= SY; j++) for (let i = 0; i <= SX; i++) {
    const p = proj(i / 2, j / 2);
    verts.push(p[0], p[1]); uvs.push((1 + i / 2) / (AW + 2), (1 + j / 2) / (AH + 2));
  }
  for (let j = 0; j < SY; j++) for (let i = 0; i < SX; i++) { const a = j * (SX + 1) + i, b = a + 1, c = a + SX + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  const field = new PIXI.Mesh(new PIXI.MeshGeometry(new Float32Array(verts), new Float32Array(uvs), new Uint16Array(idx)), new PIXI.MeshMaterial(floorTex));
  // the rim: raised tops (uv into the same texture) and the faces turned to the camera
  const cellUv = (c, r) => [[(c + 1) / (AW + 2), (r + 1) / (AH + 2)], [(c + 2) / (AW + 2), (r + 1) / (AH + 2)], [(c + 2) / (AW + 2), (r + 2) / (AH + 2)], [(c + 1) / (AW + 2), (r + 2) / (AH + 2)]];
  const top = (c, r) => ({ p: [projH(c, r, RIM_H), projH(c + 1, r, RIM_H), projH(c + 1, r + 1, RIM_H), projH(c, r + 1, RIM_H)], uv: cellUv(c, r) });
  const farTops = [], nearTops = [];
  for (let c = -1; c <= AW; c++) { farTops.push(top(c, -1)); nearTops.push(top(c, AH)); }
  for (let r = 0; r < AH; r++) { farTops.push(top(-1, r)); farTops.push(top(AW, r)); }
  // a face: dark metal, a lit top edge, the highland's yellow triangle lamp in the middle
  const faceTex = canvasTex(96, 40, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#20262c'); g.addColorStop(1, '#0b0d10');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(160,180,200,.25)'; x.fillRect(0, 0, w, 1.5);
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 0, 1, h); x.fillRect(w - 1, 0, 1, h);
    if (hlight) { x.globalAlpha = 0.95; x.drawImage(hlight, w / 2 - 9, 5, 18, 18); x.globalAlpha = 1; }
    x.fillStyle = 'rgba(246,200,40,.55)'; x.fillRect(w / 2 - 16, h - 9, 32, 2);
  });
  const face = (a, b, c, d) => ({ p: [projH(a, b, RIM_H), projH(c, d, RIM_H), proj(c, d), proj(a, b)] });
  const faces = [];
  for (let c = 0; c < AW; c++) faces.push(face(c, 0, c + 1, 0));
  for (let r = 0; r < AH; r++) { faces.push(face(0, r, 0, r + 1)); faces.push(face(AW, r + 1, AW, r)); }
  // the stage front: the near rim's outer face, then the drop to the studio floor
  const front = [];
  for (let c = -1; c <= AW; c++) front.push(face(c, AH + 1, c + 1, AH + 1));
  const edge = new PIXI.Graphics();
  const a = proj(-1, AH + 1), b = proj(AW + 1, AH + 1);
  edge.beginFill(0x07090a); edge.drawPolygon([a[0], a[1], b[0], b[1], b[0], b[1] + 34, a[0], a[1] + 34]); edge.endFill();
  edge.beginFill(COL.yellow, 0.5); edge.drawRect(a[0], a[1] + 1, b[0] - a[0], 1.5); edge.endFill();
  for (const sd of [-1, AW + 1]) {
    const p0 = proj(sd, -1), p1 = proj(sd, AH + 1), dx = sd < 0 ? -26 : 26;
    edge.beginFill(0x07090a); edge.drawPolygon([p0[0], p0[1], p1[0], p1[1], p1[0] + dx * 0.4, p1[1] + 34, p0[0] + dx * 0.3, p0[1] + 18]); edge.endFill();
  }
  // the gate boxes: a glowing face per tile (towards the camera), beams rising, the team's tint
  const boxTex = (beam, rgb) => canvasTex(128, 64, (x, w, h) => {
    const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, `rgba(${rgb},.95)`); g.addColorStop(0.3, `rgba(${rgb},.4)`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    if (beam) { x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.5; for (const bx of [-38, 6, 50, 94]) x.drawImage(beam, bx, 0, 64, h); }
    x.globalCompositeOperation = 'destination-in';
    const f = x.createLinearGradient(0, 0, 0, h); f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(0.6, 'rgba(0,0,0,.8)'); f.addColorStop(1, '#000'); x.fillStyle = f; x.fillRect(0, 0, w, h);
  });
  arena.gates = [];
  for (const [x0, beam, rgb] of [[0, beamR, '255,90,90'], [AW - 1, beamB, '110,140,255']]) {
    const q = [];
    // the faces between the tiles of the column are shared: one at each tile edge
    for (let r = 0; r <= AH; r++) q.push({ p: [projH(x0, r, GATE_H), projH(x0 + 1, r, GATE_H), proj(x0 + 1, r), proj(x0, r)] });
    const m = quadsMesh(boxTex(beam, rgb), q, ADD()); m.alpha = 0.85;
    arena.gates.push(m);
  }
  arena.floor.addChild(edge, quadsMesh(faceTex, front), field, quadsMesh(faceTex, faces), quadsMesh(floorTex, farTops), quadsMesh(floorTex, nearTops), ...arena.gates);
}
// three follow-spots: a light cone from the truss and a pool on the floor each; haze and dust in the air
function buildLights() {
  for (const ox of [230, 640, 1050]) {
    const cone = new PIXI.Sprite(tex('cone')); cone.anchor.set(0.5, 0); cone.blendMode = ADD(); cone.tint = COL.spot; cone.alpha = 0.16;
    const pool = new PIXI.Sprite(tex('glow')); pool.anchor.set(0.5); pool.blendMode = ADD(); pool.tint = COL.spot; pool.alpha = 0.42;
    arena.air.addChild(cone); arena.pools.addChild(pool);
    arena.spots.push({ ox, oy: 22, cone, pool, x: AW / 2, y: AH / 2 });
  }
  arena.haze = [];
  for (let i = 0; i < 4; i++) {
    const h = new PIXI.Sprite(tex('wisp')); h.anchor.set(0.5); h.blendMode = ADD(); h.alpha = 0.045; h.scale.set(3 + i * 0.6);
    h.position.set(200 + i * 300, 330 + (i % 2) * 120); arena.air.addChild(h); arena.haze.push({ s: h, vx: 6 + i * 2, ph: i });
  }
  arena.motes = [];
  for (let i = 0; i < 46; i++) {
    const m = new PIXI.Sprite(tex('point')); m.anchor.set(0.5); m.blendMode = ADD(); m.tint = COL.spot;
    const sc = 0.02 + Math.random() * 0.035; m.scale.set(sc);
    arena.air.addChild(m); arena.motes.push({ s: m, x: Math.random() * 1280, y: 240 + Math.random() * 420, v: 4 + Math.random() * 10, ph: Math.random() * 7 });
  }
  arena.twinkles = [];
  // a vignette, like the broadcast camera's
  const vig = new PIXI.Sprite(canvasTex(320, 180, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h * 0.58, h * 0.35, w / 2, h * 0.58, w * 0.62);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
  }));
  vig.width = 1280; vig.height = 720; arena.root.addChild(vig);
}
function stageFrame(dt) {
  if (!arena.built) return;
  arena.t += dt;
  const t = arena.t, W = arena.W;
  if (arena.ticker) arena.ticker.tilePosition.x -= 46 * dt;
  if (arena.ledDots) arena.ledDots.alpha = 0.4 + Math.sin(t * 9) * 0.015;
  // the spots: a slow sweep while betting; in the fight one follows each side, the middle one the melee
  const alive = W ? W.units.filter((u) => !u.dead) : [];
  const cen = (list) => (list.length ? [list.reduce((a, u) => a + u.x, 0) / list.length, list.reduce((a, u) => a + u.y, 0) / list.length] : null);
  arena.spots.forEach((sp, i) => {
    let tgt = [AW / 2 + Math.sin(t * 0.33 + i * 2.1) * (AW * 0.34), AH / 2 + Math.cos(t * 0.27 + i * 1.3) * (AH * 0.3)];
    if (arena.running && alive.length) {
      const c = i === 1 ? cen(alive) : cen(alive.filter((u) => u.side === (i === 0 ? 0 : 1)));
      if (c) tgt = c;
    }
    const k = 1 - Math.exp(-dt * (arena.running ? 2.6 : 1.2));
    sp.x += (tgt[0] - sp.x) * k; sp.y += (tgt[1] - sp.y) * k;
    const [px, py, pk] = proj(sp.x, sp.y), dx = px - sp.ox, dy = py - sp.oy, len = Math.hypot(dx, dy);
    sp.cone.position.set(sp.ox, sp.oy);
    sp.cone.rotation = Math.atan2(dy, dx) - Math.PI / 2;
    sp.cone.scale.set(1.45 * FLOOR.T * pk / 132, len / 260);
    sp.cone.alpha = 0.17 + Math.sin(t * 1.7 + i) * 0.02;
    sp.pool.position.set(px, py); sp.pool.scale.set(2.0 * FLOOR.T * pk / 256, 0.8 * FLOOR.T * pk / 256);
  });
  for (const h of arena.haze) { h.s.x += h.vx * dt; if (h.s.x > 1500) h.s.x = -220; h.s.alpha = 0.04 + Math.sin(t * 0.4 + h.ph) * 0.012; }
  // dust motes glow inside the cones
  for (const m of arena.motes) {
    m.y -= m.v * dt; m.x += Math.sin(t * 0.6 + m.ph) * 4 * dt;
    if (m.y < 230) { m.y = 690; m.x = Math.random() * 1280; }
    let lit = 0;
    for (const sp of arena.spots) { const [px, py] = proj(sp.x, sp.y), d = Math.abs(m.x - lerp(sp.ox, px, clamp((m.y - sp.oy) / (py - sp.oy), 0, 1))); lit = Math.max(lit, 1 - d / 60); }
    m.s.position.set(m.x, m.y); m.s.alpha = 0.05 + Math.max(0, lit) * 0.6;
  }
  // phone lights in the crowd
  if (Math.random() < dt * 5 && arena.crowdPts.length) {
    const [cx, cy] = arena.crowdPts[Math.floor(Math.random() * arena.crowdPts.length)];
    FX.spawn('twinkle', cx + (Math.random() - 0.5) * 10, cy - 4, { life: 0.5, s0: 0.05, s1: 0.11, a0: 0.9, a1: 0, layer: arena.air, tint: Math.random() < 0.5 ? 0xffffff : COL.spot });
  }
}

// ---- effects: short-lived sprites (screen space) --------------------------------------------------------------------------
const FX = {
  layer: null, parts: [],
  spawn(name, x, y, o = {}) {
    const s = new PIXI.Sprite(tex(name));
    s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5); s.position.set(x, y);
    s.blendMode = o.normal ? PIXI.BLEND_MODES.NORMAL : ADD();
    s.tint = o.tint ?? 0xffffff; s.rotation = o.r || 0;
    const p = { s, t: 0, life: o.life ?? 0.3, vx: o.vx || 0, vy: o.vy || 0, g: o.g || 0, s0: o.s0 ?? 0.2, s1: o.s1 ?? (o.s0 ?? 0.2), sy: o.sy ?? 1,
      a0: o.a0 ?? 1, a1: o.a1 ?? 0, vr: o.vr || 0, face: !!o.face, drag: o.drag ?? 0 };
    (o.layer || FX.layer).addChild(s);
    FX.parts.push(p); FX.step(p, 0);
    return p;
  },
  step(p, dt) {
    p.t += dt;
    const u = clamp(p.t / p.life, 0, 1), e = 1 - (1 - u) * (1 - u);
    p.vy += p.g * dt; p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
    p.s.x += p.vx * dt; p.s.y += p.vy * dt;
    if (p.face) p.s.rotation = Math.atan2(p.vy, p.vx) + Math.PI / 2; else p.s.rotation += p.vr * dt;
    const sc = lerp(p.s0, p.s1, e); p.s.scale.set(sc, sc * p.sy);
    p.s.alpha = lerp(p.a0, p.a1, u);
  },
  update(dt) {
    for (const p of this.parts) this.step(p, dt);
    this.parts = this.parts.filter((p) => { if (p.t < p.life) return true; p.s.destroy(); return false; });
  },
  clear() { for (const p of this.parts) p.s.destroy(); this.parts = []; },
};
// a unit's chest on screen
function chest(u, f = 0.55) {
  const [sx, sy, k] = proj(u.x, u.y), s = FLOOR.T * k / 320 * (u.f.scale || 1);
  return [sx, sy - (u.headH || 120) * s * f - u.hover * FLOOR.T * k * 0.6, k];
}
function fxHit(b, a) {
  const [x, y, k] = chest(b, 0.5), arts = a.f.dmg === 'arts';
  if (arts) {
    FX.spawn('burst', x, y, { life: 0.24, s0: 0.25 * k, s1: 0.55 * k, tint: COL.arts, r: Math.random() * 6 });
    FX.spawn('glow', x, y, { life: 0.18, s0: 0.2 * k, s1: 0.36 * k, a0: 0.6, tint: COL.arts });
    for (let i = 0; i < 5; i++) FX.spawn('rhombus', x + (Math.random() - 0.5) * 18, y, { life: 0.55, s0: 0.6 * k, s1: 0.15, tint: COL.arts, vx: (Math.random() - 0.5) * 60, vy: -50 - Math.random() * 60, vr: 3 });
  } else {
    FX.spawn('star', x, y, { life: 0.18, s0: 0.4 * k, s1: 0.75 * k, tint: COL.phys, r: Math.random() * 6 });
    FX.spawn('glow', x, y, { life: 0.14, s0: 0.18 * k, s1: 0.32 * k, a0: 0.7, tint: COL.phys });
    for (let i = 0; i < 4; i++) {
      // sparks fly away from the attacker, upwards
      const away = b.x >= a.x ? 1 : -1, ang = -Math.PI / 2 + Math.random() * 1.2, sp = 120 + Math.random() * 140;
      FX.spawn('spark', x, y, { life: 0.3, s0: 0.9 * k, s1: 0.3 * k, sy: 1.8, tint: COL.phys, vx: Math.abs(Math.cos(ang)) * sp * away, vy: Math.sin(ang) * sp, g: 520, face: true });
    }
  }
}
function fxDie(u) {
  const [x, y, k] = proj(u.x, u.y);
  for (let i = 0; i < 3; i++) FX.spawn(i % 2 ? 'smokeA' : 'smokeB', x + (Math.random() - 0.5) * 24 * k, y - 8, { normal: true, life: 0.9, s0: 0.25 * k, s1: 0.6 * k, a0: 0.38, tint: 0x8d9698, vy: -18, vr: (Math.random() - 0.5) * 0.8 });
  const [cx, cy] = chest(u, 0.45);
  for (let i = 0; i < 12; i++) FX.spawn('point', cx + (Math.random() - 0.5) * 34 * k, cy + (Math.random() - 0.5) * 40 * k, { life: 0.7 + Math.random() * 0.5, s0: 0.05, s1: 0.015, a0: 0.9, tint: TEAM_COL[u.side], vy: -40 - Math.random() * 50, drag: 1.2 });
}
function fxBoom(u) {
  const [x, y, k] = proj(u.x, u.y), ice = !!u.f.talents['boom.freeze'], col = ice ? COL.ice : 0xffa040, R = 1.3 * FLOOR.T * k;
  FX.spawn('disc', x, y - 14 * k, { life: 0.22, s0: R / 260 * 0.5, s1: R / 260 * 1.4, a0: 0.75, tint: col });
  FX.spawn('ring', x, y, { life: 0.42, s0: 0.1, s1: R * 2 / 256, sy: 0.42, a0: 0.9, tint: col });
  for (let i = 0; i < 5; i++) FX.spawn(i % 2 ? 'smokeA' : 'smokeB', x + (Math.random() - 0.5) * R, y - 10 - Math.random() * 20, { normal: true, life: 1.1, s0: 0.3 * k, s1: 0.75 * k, a0: 0.42, tint: ice ? 0xbcd6e6 : 0x5b5552, vy: -24, vr: (Math.random() - 0.5) });
  for (let i = 0; i < 14; i++) { const a = Math.random() * Math.PI * 2, sp = 160 + Math.random() * 220; FX.spawn(ice ? 'rhombus' : 'spark', x, y - 16 * k, { life: 0.5, s0: (ice ? 0.6 : 0.6) * k, s1: 0.15, sy: ice ? 1 : 1.8, tint: col, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 90, g: 420, face: !ice, vr: ice ? 6 : 0 }); }
}
function fxBlast(u) {
  const [x, y, k] = proj(u.x, u.y), R = u.reach * FLOOR.T * k;
  FX.spawn('ring', x, y, { life: 0.5, s0: 0.1, s1: R * 2 / 256, sy: 0.42, a0: 0.85, tint: COL.arts });
  FX.spawn('glow', x, y - 30 * k, { life: 0.3, s0: 0.4 * k, s1: 0.9 * k, a0: 0.6, tint: COL.arts });
}
// the leaders' skills (sim.js LEADERS): 纬地经天's cross of arts flashes, 破桎而出's barrier going up / breaking / going
// off (a 3-tile shock ring), 溶血骇惧 seizing a unit
function fxCross(a) {
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const [x, y, k] = proj(a.x + dx, a.y + dy);
    FX.spawn('disc', x, y - 6 * k, { life: 0.34, s0: 0.1, s1: FLOOR.T * k / 260 * 0.95, sy: 0.42, a0: 0.7, tint: COL.arts });
    FX.spawn('glow', x, y - 22 * k, { life: 0.26, s0: 0.2 * k, s1: 0.55 * k, a0: 0.55, tint: COL.arts });
  }
}
function fxBarrier(u, kind) {
  const [x, y, k] = chest(u, 0.5);
  if (kind === 'barrier') FX.spawn('ring', x, y, { life: 0.5, s0: 0.1, s1: 1.2 * FLOOR.T * k / 256 * 2, a0: 0.8, tint: COL.arts });
  else if (kind === 'barrierbreak') for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 160; FX.spawn('rhombus', x, y, { life: 0.5, s0: 0.7 * k, s1: 0.15, tint: COL.arts, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 60, g: 360, vr: 5 }); }
  else {
    const [gx, gy] = proj(u.x, u.y), R = 3 * FLOOR.T * k;
    FX.spawn('disc', gx, gy - 10 * k, { life: 0.3, s0: R / 260 * 0.4, s1: R / 260 * 1.6, sy: 0.42, a0: 0.6, tint: COL.arts });
    FX.spawn('ring', gx, gy, { life: 0.6, s0: 0.1, s1: R * 2 / 256, sy: 0.42, a0: 0.95, tint: COL.arts });
    FX.spawn('glow', x, y, { life: 0.4, s0: 0.5 * k, s1: 1.4 * k, a0: 0.7, tint: 0xe2d0ff });
  }
}
function fxFear(v, on) {
  const [x, y, k] = chest(v, 0.75);
  FX.spawn(on ? 'burst' : 'glow', x, y, { life: on ? 0.4 : 0.3, s0: 0.2 * k, s1: (on ? 0.7 : 0.45) * k, a0: on ? 0.85 : 0.5, tint: on ? COL.fear : 0xb0b0b0, r: Math.random() * 6 });
}
function fxRevive(u) {
  const [x, y, k] = proj(u.x, u.y);
  FX.spawn('beam', x, y, { ay: 1, life: 0.6, s0: 0.5 * k, s1: 0.9 * k, sy: 1.8, a0: 0.8, tint: COL.gold });
  FX.spawn('twinkle', x, y - 60 * k, { life: 0.5, s0: 0.3 * k, s1: 1.0 * k, tint: COL.gold });
  FX.spawn('ring', x, y, { life: 0.45, s0: 0.1, s1: 1.4 * FLOOR.T * k / 256 * 2, sy: 0.42, tint: COL.gold });
}
function fxSpawn(u) {
  const [x, y, k] = proj(u.x, u.y);
  FX.spawn(Math.random() < 0.5 ? 'smokeA' : 'smokeB', x, y - 6, { normal: true, life: 0.6, s0: 0.2 * k, s1: 0.45 * k, a0: 0.3, tint: 0x9aa2a4, vy: -12 });
  FX.spawn('glow', x, y - 30 * k, { life: 0.25, s0: 0.2 * k, s1: 0.45 * k, a0: 0.5, tint: TEAM_COL[u.side] });
}

// ---- the visible arena: the sim's world (sim.js) with Spine views --------------------------------------------------------
function setupRound(lineups, seed) {
  clearArena();
  arena.W = makeWorld(lineups, seed, true);
  for (const u of arena.W.units) attachView(u);
  arena.acc = 0; arena.ff = 1; arena.running = false;
  // 竞猜对决 has no last round: the round alone
  const stand = typeof G !== 'undefined' && G.mode && G.mode.key === 'stand';
  setLedArt(stand);
  setTicker(typeof G !== 'undefined' && G.round ? `ROUND ${String(G.round).padStart(2, '0')}${stand ? '' : ` / ${ROUNDS}`}` : '');
  drawRing();
}
function clearArena() {
  if (arena.W) { for (const u of arena.W.units) if (u.view) u.view.destroy({ children: true }); for (const s of arena.W.shots) if (s.g) s.g.destroy({ children: true }); }
  FX.clear();
  arena.W = null; arena.running = false;
  arena.flashT = 0;
  drawRing(0);
}
function startBattle() {
  arena.running = true;
  if (arena.W) for (const u of arena.W.units) fxSpawn(u);
  return new Promise((res) => { arena.onEnd = res; });
}
function attachView(u) {
  u.view = new PIXI.Container();
  u.shadow = new PIXI.Sprite(tex('glow')); u.shadow.anchor.set(0.5); u.shadow.tint = 0x000000; u.shadow.alpha = 0.6;
  u.ringG = new PIXI.Graphics(); u.bar = new PIXI.Graphics();
  u.view.addChild(u.shadow, u.ringG);
  arena.unitsC.addChild(u.view);
  u.mode = ''; u.flash = 0; u.hover = u.f.fly ? 0.45 : 0; u.barW = 0; u.lastHpDrawn = -1; u.seenAttack = 0; u.seenSkill = 0; u.ghost = 1; u.ghostHold = 0; u.lastRatio = 1;
  loadFighter(u.f).then((data) => {
    if (!u.view || u.view.destroyed) return;
    const sk = new PIXI.spine.Spine(data);
    sk.autoUpdate = false;
    u.sk = sk;
    u.view.addChildAt(sk, 2);
    const top = (data.y || 0) + (data.height || 0);
    u.headH = top > 20 ? top : 0;
    u.view.addChild(u.bar);
    anim(u, u.dead ? 'die' : 'idle', true);
  }).catch((e) => console.warn('fighter', u.f.key, e));
}
function anim(u, kind, force) {
  if (!u.sk || (u.mode === kind && !force)) return;
  const A = u.f.spine.anims, has = (n) => n && u.sk.spineData.findAnimation(n);
  // a unit with two forms (C1_* / C2_*): the second after its reborn
  const form = (n) => (n && u.enhanced && /^C1_/.test(n) && has('C2_' + n.slice(3)) ? 'C2_' + n.slice(3) : n);
  let name = null, loop = true;
  if (kind === 'idle') name = A.idle;
  else if (kind === 'move') name = (u.f.ms > 1 && A.run && has(A.run.loop)) ? A.run.loop : A.move && A.move.loop;
  else if (kind === 'attack') { name = A.attack && A.attack.loop; loop = false; }
  else if (kind === 'skill') { name = A.skill && A.skill.loop; loop = false; if (!has(form(name))) name = A.attack && A.attack.loop; }
  else if (kind === 'die' || kind === 'reborn') { name = A.die; loop = false; }
  name = form(name);
  if (!has(name)) name = has(form(A.idle)) ? form(A.idle) : u.sk.spineData.animations[0].name;
  u.mode = kind;
  const e = u.sk.state.setAnimation(0, name, loop);
  if (kind === 'attack' || kind === 'skill') {
    e.timeScale = Math.max(1, (e.animation.duration || 1) / Math.max(0.2, u.attackIv || 1));
    u.sk.state.addAnimation(0, has(form(A.idle)) ? form(A.idle) : name, true, 0);
  }
}
function renderUnit(u, dt) {
  const [sx, sy, k] = proj(u.x, u.y);
  u.view.position.set(sx, sy);
  u.view.zIndex = sy;
  const s = FLOOR.T * k / 320 * (u.f.scale || 1);
  if (u.sk) {
    if (u.dead) { if (u.mode !== 'die') anim(u, 'die', true); }
    else if (u.rebornT > 0) { if (u.mode !== 'reborn') anim(u, 'reborn', true); }
    else if (u.mode === 'reborn') anim(u, 'idle', true);
    else if (u.skillSeq !== u.seenSkill || u.wantSkill) { u.seenSkill = u.skillSeq; u.seenAttack = u.attackSeq; u.wantSkill = false; anim(u, 'skill', true); }
    else if (u.attackSeq !== u.seenAttack) { u.seenAttack = u.attackSeq; anim(u, 'attack', true); }
    else if (u.state === 'move' && u.mode !== 'move' && (u.mode !== 'attack' || u.sk.state.tracks[0]?.isComplete?.())) anim(u, 'move');
    else if (u.state === 'idle' && u.mode === 'move') anim(u, 'idle');
    u.sk.scale.set(s * u.facing * (u.f.mirrorX ? -1 : 1), s * (u.f.scaleY || 1));
    u.sk.y = -u.hover * FLOOR.T * k * 0.6;
    u.sk.update(u.stun > 0 ? 0 : dt);
    if (!u.headH) u.headH = Math.max(40, -u.sk.getLocalBounds().y);
    if (u.flash > 0) u.flash -= dt;
    u.sk.tint = u.flash > 0 ? 0xffc4b8 : u.stun > 0 && u.stunKind === 'frozen' ? 0xb8dcf0 : u.fear ? 0xd88aa8
      : u.invT > 0 && Math.sin(arena.t * 18) > 0 ? 0xfff0b0 : 0xffffff;
    if (u.dead) { u.deadT = (u.deadT || 0) + dt; u.view.alpha = clamp(1.4 - u.deadT * 1.2, 0, 1); }
  }
  // a soft shadow under the feet
  const sw = 30 * k * clamp(u.f.scale || 1, 0.7, 1.7);
  u.shadow.scale.set(sw * 2.2 / 256, sw * 0.9 / 256);
  if (u.sk) unitHud(u, dt, k, s);
}
// the safe zone (env_025_act1enemyduel): the tiles outside glow amber; its edge is the client's boundary line
// common_V060_line_* — a band 0.3 tile wide just outside the zone (the effect's quads sit 0.15 tile out, 0.3 thick): a
// soft glow (mask_62), flowing squares (flow_242) and a bright core, in the effect's amber (MainColor 0.65, 0.45, 0.14);
// at each shrink the screen-edge lines (common_V060_line_screen) flash
function zoneBand(r, d) {
  const q = [], { x0, y0, x1, y1 } = r;
  const seg = (a, b) => { const n = Math.max(1, Math.ceil(b - a - 1e-9)), out = []; for (let i = 0; i < n; i++) out.push([a + (b - a) * i / n, a + (b - a) * (i + 1) / n]); return out; };
  let u = 0;
  const add = (p, len) => { q.push({ p, uv: [[u, 0], [u + len, 0], [u + len, 1], [u, 1]] }); u += len; };
  for (const [a, b] of seg(x0 - d, x1 + d)) add([proj(a, y0 - d), proj(b, y0 - d), proj(b, y0), proj(a, y0)], b - a);
  for (const [a, b] of seg(y0, y1)) add([proj(x1 + d, a), proj(x1 + d, b), proj(x1, b), proj(x1, a)], b - a);
  for (const [a, b] of seg(x0 - d, x1 + d).reverse()) add([proj(b, y1 + d), proj(a, y1 + d), proj(a, y1), proj(b, y1)], b - a);
  for (const [a, b] of seg(y0, y1).reverse()) add([proj(x0 - d, b), proj(x0 - d, a), proj(x0, a), proj(x0, b)], b - a);
  return q;
}
function buildZone(z) {
  const L = arena.zoneL;
  L.removeChildren().forEach((c) => c.destroy());
  arena.zoneFlow = null;
  if (z < 0) return;
  const r = zoneRect(z), d = 0.3;
  // the wash: every playable tile outside the zone, row by row
  const wash = new PIXI.Graphics();
  const quad = (xa, xb, ya, yb) => { const p = [proj(xa, ya), proj(xb, ya), proj(xb, yb), proj(xa, yb)]; wash.drawPolygon(p.flatMap((v) => [v[0], v[1]])); };
  wash.beginFill(COL.zone, 1);
  for (let y = 0; y < AH; y++) {
    if (y < r.y0 || y >= r.y1) { quad(0, AW, y, y + 1); continue; }
    if (r.x0 > 0) quad(0, r.x0, y, y + 1);
    if (r.x1 < AW) quad(r.x1, AW, y, y + 1);
  }
  wash.endFill();
  wash.alpha = 0.1;
  // the band: glow, flowing squares, core
  // the glow across the band (bright at the zone's edge, like mask_62's falloff), the same along it
  if (!arena.bandTex) arena.bandTex = canvasTex(4, 64, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,.35)'); g.addColorStop(0.92, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,.6)'); x.fillStyle = g; x.fillRect(0, 0, w, h); });
  const glow = quadsMesh(arena.bandTex, zoneBand(r, d).map((q) => ({ p: q.p, uv: q.uv.map(([u, v]) => [0.5, v]) })), ADD()); glow.tint = COL.zone; glow.alpha = 0.75;
  const ft = tex('flowsq'); ft.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
  const fq = zoneBand(r, d).map((q) => ({ p: q.p, uv: q.uv.map(([u, v]) => [u * 1.6, v]) }));
  const flow = quadsMesh(ft, fq, ADD()); flow.tint = 0xffc25a; flow.alpha = 0.55;
  flow.baseUv = Float32Array.from(flow.geometry.getBuffer('aTextureCoord').data);
  const core = new PIXI.Graphics();
  const ring = [];
  const edge = (pts) => { for (const p of pts) ring.push(p[0], p[1]); };
  const steps = (a, b) => { const n = Math.max(1, Math.ceil(Math.abs(b - a))); return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n); };
  edge(steps(r.x0, r.x1).map((x) => proj(x, r.y0))); edge(steps(r.y0, r.y1).map((y) => proj(r.x1, y)));
  edge(steps(r.x1, r.x0).map((x) => proj(x, r.y1))); edge(steps(r.y1, r.y0).map((y) => proj(r.x0, y)));
  core.lineStyle(6, COL.zone, 0.18); core.drawPolygon(ring);
  core.lineStyle(1.6, 0xffd58a, 0.95); core.drawPolygon(ring);
  L.addChild(wash, glow, flow, core);
  arena.zoneWash = wash; arena.zoneFlow = flow; arena.zoneGlow = glow; arena.zoneR = r; arena.zoneIn = 0;
}
function drawRing(dt = 0) {
  const W = arena.W, z = W ? W.zone : -1;
  if (z !== arena.zoneShown) { arena.zoneShown = z; buildZone(z); }
  const t = arena.t;
  if (arena.zoneFlow) {
    arena.zoneIn = Math.min(1, arena.zoneIn + dt * 2.5);
    const b = arena.zoneFlow.geometry.getBuffer('aTextureCoord'), base = arena.zoneFlow.baseUv, off = -t * 0.9;
    for (let i = 0; i < base.length; i += 2) b.data[i] = base[i] + off;
    b.update();
    arena.zoneFlow.alpha = (0.7 + 0.2 * Math.sin(t * 3)) * arena.zoneIn;
    arena.zoneGlow.alpha = (0.85 + 0.15 * Math.sin(t * 2.2)) * arena.zoneIn;
    arena.zoneWash.alpha = (0.085 + 0.025 * Math.sin(t * 2)) * arena.zoneIn;
    // sparks rising from the line (the effect's spark particle systems)
    if (Math.random() < dt * 14) {
      const r = arena.zoneR, side = Math.floor(Math.random() * 4), f = Math.random();
      const [fx, fy] = side === 0 ? [lerp(r.x0, r.x1, f), r.y0 - 0.15] : side === 1 ? [r.x1 + 0.15, lerp(r.y0, r.y1, f)] : side === 2 ? [lerp(r.x0, r.x1, f), r.y1 + 0.15] : [r.x0 - 0.15, lerp(r.y0, r.y1, f)];
      const [x, y, k] = proj(fx, fy);
      FX.spawn('point', x, y, { life: 0.9, s0: 0.05 * k, s1: 0.01, tint: COL.zone, vy: -40 - Math.random() * 40, vx: (Math.random() - 0.5) * 16, drag: 0.4 });
    }
  }
  // the screen-edge flash at a shrink
  if (arena.flashT > 0) {
    arena.flashT = Math.max(0, arena.flashT - dt / 1.3);
    arena.flash.visible = true; arena.flash.alpha = Math.sin(Math.min(1, arena.flashT * 1.6) * Math.PI / 2) * (0.75 + 0.25 * Math.sin(t * 30));
  } else if (arena.flash) arena.flash.visible = false;
}
function buildFlash() {
  arena.flash = new PIXI.Sprite(canvasTex(640, 360, (x, w, h) => {
    for (const [y0, y1] of [[0, 46], [h, h - 46]]) {
      const g = x.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, 'rgba(255,170,50,.9)'); g.addColorStop(0.15, 'rgba(255,150,40,.35)'); g.addColorStop(1, 'rgba(255,140,30,0)');
      x.fillStyle = g; x.fillRect(0, Math.min(y0, y1), w, 46);
    }
    x.fillStyle = 'rgba(255,214,140,.95)'; x.fillRect(0, 5, w, 1.5); x.fillRect(0, h - 6.5, w, 1.5);
  }));
  arena.flash.width = 1280; arena.flash.height = 720; arena.flash.blendMode = ADD(); arena.flash.visible = false;
  arena.root.addChild(arena.flash);
}

// a unit's HUD, as the client's enemy_hp_slider: a 105 × 7 bar under the unit — no frame, a white trail (α 0.7) that
// falls to the new value, the fill (α 0.7) in the enemy orange (0.918, 0.278, 0) for the left team and the operator blue
// (0.286, 0.698, 0.890) for the right; a boss gets the boss bar (130 × 9 on a black α 0.5 back). Above the head: the
// excitement buff's icon outside the zone (common_acute_infection_buff_01: kuangre_01 on a star_02 glow), the stun swirl
// (buff_stun: ray_13 + star_12); a frozen unit is wrapped in the ice block (buff_frozen: bingkuai_02, xuehua_02).
function unitHud(u, dt, k, s) {
  const big = u.f.rank === 'BOSS', w = (big ? 130 : 105) / 105 * 0.8 * FLOOR.T * k, h = Math.max(3, w / (big ? 14.4 : 15));
  const ratio = clamp(u.hp / u.maxHp, 0, 1);
  if (u.ghostHold > 0) u.ghostHold -= dt; else u.ghost = Math.max(ratio, u.ghost - dt * 0.9);
  if (ratio < u.lastRatio - 1e-4) u.ghostHold = 0.35;
  u.lastRatio = ratio;
  const show = !u.dead && u.rebornT <= 0;
  u.bar.visible = show;
  if (show) {
    if (Math.abs(ratio - u.lastHpDrawn) > 0.002 || Math.abs(u.ghost - (u.lastGhost || 0)) > 0.003 || u.barW !== w) {
      u.lastHpDrawn = ratio; u.lastGhost = u.ghost; u.barW = w;
      const b = u.bar; b.clear();
      b.beginFill(0x000000, big ? 0.5 : 0.3); b.drawRect(-w / 2, 0, w, h); b.endFill();
      b.beginFill(0xffffff, 0.7); b.drawRect(-w / 2, 0, w * u.ghost, h); b.endFill();
      b.beginFill(TEAM_HP[u.side], big ? 0.85 : 0.7); b.drawRect(-w / 2, 0, w * ratio, h); b.endFill();
    }
    u.bar.y = 7 * k;
  }
  const headY = -(u.headH || 120) * s - u.hover * FLOOR.T * k * 0.6;
  // the excitement buff
  const fervor = show && u.outside;
  if (fervor && !u.fervorFx) {
    const c = new PIXI.Container(), halo = new PIXI.Sprite(tex('halo')), ic = new PIXI.Sprite(tex('fervor'));
    halo.anchor.set(0.5); halo.blendMode = ADD(); halo.tint = 0xff7a1a; halo.alpha = 0.7; halo.scale.set(0.34);
    ic.anchor.set(0.5); ic.rotation = -Math.PI / 2; ic.tint = 0xffa02e; ic.scale.set(0.17);
    c.addChild(halo, ic); u.view.addChild(c); u.fervorFx = c;
  }
  if (u.fervorFx) {
    u.fervorFx.visible = fervor;
    if (fervor) { u.fervorFx.position.set(0, headY - 14 * k + Math.sin(arena.t * 4 + u.x) * 2 * k); u.fervorFx.scale.set(k); u.fervorFx.children[0].alpha = 0.4 + 0.2 * Math.sin(arena.t * 6 + u.y); }
  }
  // 破桎而出: a bubble while the barrier holds; 溶血骇惧: blood motes leaving a seized unit; 冲锋: dust at the feet
  const barrier = show && u.barrier > 0;
  if (barrier && !u.barrierFx) {
    const b = new PIXI.Sprite(tex('halo')); b.anchor.set(0.5); b.blendMode = ADD(); b.tint = COL.arts; u.view.addChild(b); u.barrierFx = b;
  }
  if (u.barrierFx) {
    u.barrierFx.visible = barrier;
    if (barrier) { const r = Math.max(60, (u.headH || 120) * s) * 1.25; u.barrierFx.scale.set(r / 128, r / 128 * 0.95); u.barrierFx.y = -r * 0.42; u.barrierFx.alpha = 0.55 + 0.15 * Math.sin(arena.t * 5); }
  }
  // the ground ring: the barrier (violet, with the dome's outline), a seized unit (red, pulsing), invincible (gold)
  const ring = !show ? null : barrier ? COL.arts : u.fear ? COL.fear : u.invT > 0 ? COL.gold : null;
  if (ring !== u.ringCol || ring) {
    const g = u.ringG; g.clear(); u.ringCol = ring;
    if (ring) {
      const rx = 0.55 * FLOOR.T * k, pulse = u.fear ? 0.55 + 0.35 * Math.sin(arena.t * 8) : 0.85;
      g.lineStyle(2.5 * k, ring, pulse); g.drawEllipse(0, 0, rx, rx * 0.42);
      if (barrier) { const r = Math.max(60, (u.headH || 120) * s) * 1.25; g.lineStyle(2 * k, ring, 0.75); g.drawEllipse(0, -r * 0.42, r * 0.5, r * 0.55); }
      if (u.fear) { g.lineStyle(0); g.beginFill(ring, 0.18 + 0.12 * Math.sin(arena.t * 8)); g.drawEllipse(0, 0, rx, rx * 0.42); g.endFill(); }
    }
  }
  if (show && u.fear && Math.random() < dt * 14) { const [cx, cy] = chest(u, 0.5); FX.spawn('point', cx + (Math.random() - 0.5) * 20 * k, cy, { life: 0.8, s0: 0.05, s1: 0.012, a0: 0.9, tint: COL.fear, vy: -50, drag: 0.6 }); }
  if (show && u.rushT > 0 && u.state === 'move' && Math.random() < dt * 14) { const [gx, gy] = proj(u.x, u.y); FX.spawn(Math.random() < 0.5 ? 'smokeA' : 'smokeB', gx - u.facing * 12 * k, gy - 4, { normal: true, life: 0.45, s0: 0.12 * k, s1: 0.3 * k, a0: 0.35, tint: 0xa89a8a, vy: -10 }); }
  // stun: the swirl and its sparkle
  const stun = show && u.stun > 0 && u.stunKind === 'stun';
  if (stun && !u.stunFx) {
    const c = new PIXI.Container(), base = new PIXI.Sprite(tex('swirl')), sw = new PIXI.Sprite(tex('swirl'));
    base.anchor.set(0.5); base.tint = 0xffe27a; base.alpha = 0.9; base.scale.set(0.42);
    sw.anchor.set(0.5); sw.blendMode = ADD(); sw.tint = 0xfff6c8; sw.scale.set(0.42);
    const flat = new PIXI.Container(); flat.scale.set(1, 0.4); flat.addChild(base, sw); c.addChild(flat);
    for (let i = 0; i < 2; i++) { const st = new PIXI.Sprite(tex('stunstar')); st.anchor.set(0.5); st.blendMode = ADD(); st.tint = 0xfff0a0; st.scale.set(0.16); c.addChild(st); }
    u.view.addChild(c); u.stunFx = c;
  }
  if (u.stunFx) {
    u.stunFx.visible = stun;
    if (stun) {
      u.stunFx.position.set(0, headY - 6 * k); u.stunFx.scale.set(k);
      // the swirl spins flat over the head (rotate the sprites, keep the container's squash)
      for (const sp of u.stunFx.children[0].children) sp.rotation += dt * 6;
      for (let i = 1; i < 3; i++) { const a = arena.t * 4.5 + i * Math.PI; u.stunFx.children[i].position.set(Math.cos(a) * 24, Math.sin(a) * 9); u.stunFx.children[i].alpha = 0.6 + 0.4 * Math.sin(arena.t * 9 + i); }
    }
  }
  // frozen: the ice block over the body
  const frozen = show && u.stun > 0 && u.stunKind === 'frozen';
  if (frozen && !u.iceFx) {
    const c = new PIXI.Container(), a = new PIXI.Sprite(tex('ice')), b = new PIXI.Sprite(tex('ice')), g = new PIXI.Sprite(tex('halo'));
    for (const x of [a, b, g]) x.anchor.set(0.5, 0.92);
    g.blendMode = ADD(); g.tint = 0x0052a0; g.alpha = 0.5;
    a.alpha = 0.55; b.blendMode = ADD(); b.tint = 0x3b7d9c; b.alpha = 0.6;
    c.addChild(g, a, b); u.view.addChild(c); u.iceFx = c;
  }
  if (u.iceFx) {
    u.iceFx.visible = frozen;
    if (frozen) {
      const hh = Math.max(30, (u.headH || 120) * s * 1.05);
      u.iceFx.scale.set(hh / 230 * 1.25, hh / 230); u.iceFx.y = 4 * k - u.hover * FLOOR.T * k * 0.6;
      if (Math.random() < dt * 3) { const [cx, cy] = chest(u, 0.6); FX.spawn('snow', cx + (Math.random() - 0.5) * 26 * k, cy, { life: 0.9, s0: 0.1 * k, s1: 0.04 * k, a0: 0.9, tint: 0xd8f2ff, vy: 18, vr: 2 }); }
    }
  }
}
// Playback speeds up as a battle drags on (the event's behaviour as players describe it; no table or client constant
// carries the curve): 1× for the first 15 s of battle time, rising linearly to 2× at 45 s and 3× at 90 s, 3× after
// that. It changes how fast the fight is shown, never the fight: the sim steps are the same, so every client and the
// server's prediction still agree. Fast-forward (arena.ff) multiplies on top.
const PLAYBACK = [[0, 1], [15, 1], [45, 2], [90, 3]];
function playbackRate(t) {
  for (let i = 1; i < PLAYBACK.length; i++) {
    const [t1, r1] = PLAYBACK[i];
    if (t < t1) { const [t0, r0] = PLAYBACK[i - 1]; return r0 + (r1 - r0) * (t - t0) / (t1 - t0); }
  }
  return PLAYBACK[PLAYBACK.length - 1][1];
}
function arenaFrame(dt) {
  if (!arena) return;
  const W = arena.W;
  const rate = W ? arena.ff * playbackRate(W.t) : 1;
  arena.rate = rate;
  if (W && arena.running) {
    arena.acc += dt * rate;
    let n = 0;
    while (arena.acc >= DT && !W.done && n++ < 600) {
      arena.acc -= DT;
      simStep(W);
    }
    // events → effects (when fast-forwarding, only the big ones)
    const busy = rate > 3;
    for (const [kind, u, a] of W.events) {
      if (kind === 'hit') { if (!busy && u.view) fxHit(u, a); if (u.view) u.flash = 0.1; }
      else if (kind === 'die') fxDie(u);
      else if (kind === 'boom') fxBoom(u);
      else if (kind === 'blast') { fxBlast(u); u.wantSkill = true; }
      else if (kind === 'zone') { if (W.zone >= 0) { sfx('b_ui_dqsafearea'); arena.flashT = 1; } }
      else if (kind === 'stun' || kind === 'frozen') { if (!busy && u.view) { const [x, y, k] = chest(u, 1); FX.spawn('flare', x, y, { life: 0.3, s0: 0.3 * k, s1: 0.6 * k, a0: 0.8, tint: kind === 'frozen' ? COL.ice : 0xfff0a0 }); } }
      else if (kind === 'revive') fxRevive(u);
      else if (kind === 'cross') { if (!busy) fxCross(a); }
      else if (kind === 'barrier' || kind === 'barrierbreak' || kind === 'barrierblast') { fxBarrier(u, kind); if (kind !== 'barrierbreak') u.wantSkill = true; }
      else if (kind === 'fearcharge') u.wantSkill = true;
      else if (kind === 'fear' || kind === 'fearend') { if (u.view) fxFear(u, kind === 'fear'); }
    }
    W.events.length = 0;
    if (W.done) {
      arena.running = false;
      if (arena.onEnd) { const f = arena.onEnd; arena.onEnd = null; f(W.result); }
    }
  }
  const adt = dt * (arena.running ? rate : 1);
  if (W) {
    for (const u of W.units) if (u.view) renderUnit(u, adt);
    // projectiles: physical — a white-yellow streak; arts — a violet orb; both leave a short trail
    for (const s of W.shots) {
      const arts = s.src.f.dmg === 'arts', [sx, sy] = proj(s.x, s.y);
      const y = sy - 34;
      if (!s.g) {
        s.g = new PIXI.Container();
        const head = new PIXI.Sprite(tex(arts ? 'point' : 'beam')); head.anchor.set(0.5); head.blendMode = ADD(); head.tint = arts ? COL.arts : COL.phys;
        if (arts) head.scale.set(0.16); else head.scale.set(0.09, 0.16);
        const glow = new PIXI.Sprite(tex('glow')); glow.anchor.set(0.5); glow.blendMode = ADD(); glow.tint = arts ? COL.arts : COL.phys; glow.scale.set(0.12); glow.alpha = 0.6;
        s.g.addChild(glow, head); arena.fx.addChild(s.g); s.px = sx; s.py = y; s.trailT = 0;
      }
      const vx = sx - s.px, vy = y - s.py;
      if (vx || vy) s.g.children[1].rotation = Math.atan2(vy, vx) + Math.PI / 2;
      s.g.position.set(sx, y);
      s.trailT -= adt;
      if (s.trailT <= 0 && rate <= 3) { s.trailT = 0.03; FX.spawn(arts ? 'rhombus' : 'spark', sx, y, { life: 0.2, s0: arts ? 0.25 : 0.35, s1: 0.05, tint: arts ? COL.arts : COL.phys, vr: 3 }); }
      s.px = sx; s.py = y;
    }
  }
  FX.update(adt);
  stageFrame(dt);
  drawRing(dt);
  // a popup's blurred backdrop (the RawImage of a blurred screen grab in the game): blur + darken the arena in WebGL
  arena.blurT = clamp((arena.blurT || 0) + (arena.blurWant ? 1 : -1) * dt * 4, 0, 1);
  if (arena.blurT > 0.01) {
    if (!arena.blurF) { arena.blurF = new PIXI.BlurFilter(0, 4); arena.dimF = new PIXI.ColorMatrixFilter(); }
    arena.blurF.blur = 10 * arena.blurT;
    arena.dimF.brightness(1 - 0.42 * arena.blurT, false);
    if (!arena.root.filters) arena.root.filters = [arena.blurF, arena.dimF];
  } else if (arena.root.filters) arena.root.filters = null;
  arenaApp.render();
}

// ---- the browser's "video": a looping mini broadcast of two fighters (as wide as its holder) --------------------------
class MiniShow {
  constructor(host) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'video';
    host.el.appendChild(this.cv);
    const W = this.W = Math.round(host.rt.size[0] || 615), H = 327, m = W / 2;
    this.app = new PIXI.Application({ view: this.cv, width: W, height: H, backgroundColor: 0x0b1213, antialias: true, autoStart: false });
    const g = new PIXI.Graphics();
    for (let i = 0; i < 12; i++) { g.beginFill(lerpCol(0x0e1a1c, 0x22302f, i / 11)); g.drawRect(0, 150 + i * 15, W, 16); g.endFill(); }
    g.beginFill(0xbfe9ff, 0.06); g.drawPolygon([m - 57, 0, m + 53, 0, m + 163, H, m - 167, H]); g.endFill();
    g.lineStyle(2, 0xf3d23a, 0.5); g.moveTo(m, 160); g.lineTo(m, H);
    this.app.stage.addChild(g);
    this.c = new PIXI.Container(); this.app.stage.addChild(this.c);
    this.t = 0; this.next = 0; this.pair = [];
    this.label = new PIXI.Text('', { fontFamily: 'Noto Sans SC, Microsoft YaHei, sans-serif', fontSize: 15, fontWeight: '700', fill: 0xffffff });
    this.label.position.set(16, 14); this.app.stage.addChild(this.label);
  }
  async cast() {
    const normal = POOL.filter((f) => f.pool.normal > 0);
    const fs = [pick(normal), pick(normal)];
    const ds = await Promise.all(fs.map(loadFighter));
    this.c.removeChildren().forEach((x) => x.destroy());
    this.pair = ds.map((d, i) => {
      const sk = new PIXI.spine.Spine(d); sk.autoUpdate = false;
      const s = 0.5 * (fs[i].scale || 1);
      sk.scale.set(s * (i ? -1 : 1), s); sk.position.set(this.W / 2 + (i ? 1 : -1) * Math.min(150, this.W / 6), 285);
      sk.state.setAnimation(0, fs[i].spine.anims.idle, true);
      this.c.addChild(sk);
      return { sk, f: fs[i] };
    });
    this.label.text = `直播中 · ${fs[0].name} VS ${fs[1].name}`;
  }
  frame(dt) {
    this.t += dt;
    if (this.t >= this.next) { this.next = this.t + 9; this.cast(); }
    const beat = Math.floor(this.t / 1.3);
    if (beat !== this.beat && this.pair.length) {
      this.beat = beat;
      const p = this.pair[beat % 2], A = p.f.spine.anims;
      if (A.attack && A.attack.loop && p.sk.spineData.findAnimation(A.attack.loop)) { p.sk.state.setAnimation(0, A.attack.loop, false); p.sk.state.addAnimation(0, A.idle, true, 0); }
    }
    for (const p of this.pair) p.sk.update(dt);
    this.app.render();
  }
  destroy() { this.app.destroy(false, { children: true }); this.cv.remove(); }
}
