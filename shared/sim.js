// ---- the duel sim, shared by the page and the server (no rendering, no DOM) -------------------------------------------
// Field: the official level (level_act1enemyduel, 15 × 11): 9 lanes, a start column (S) on the left, an end column (E)
// on the right, 11 duel tiles between, forbidden tiles around. Rules from the level's runes: ATK × 1.5, max HP × 0.5,
// enemy move × 0.5, 火与钢 has status resistance (stun / freeze halved). The safe zone, from the client's env prefab
// env_025_act1enemyduel (DUELCFG.env): 60 s in, then every 20 s, the zone closes one tile on each side around the level
// tile (7, 5): 9 × 7, 7 × 5, 5 × 3, 3 × 1 tiles. On a tile outside a unit gets ATK +100 %, ASPD +50, move × 1.5 (not on
// the start / end tiles), and each second one internal-injury stack and stacks × 0.5 % max HP true damage; back inside,
// the state and its stacks are gone (PRTS). 蜜果城's 惊喜 enemies drop in behind the other side (SURPRISE below).
// Every enemy's skills and talents follow PRTS's 争锋频道/选手信息 pages (00, 01, 02, 03, 领袖) with the numbers of its
// duel data (enemy_database at the level the latest event's stage uses): ENEMIES below, the three 领袖 of 竞猜对决 in
// LEADERS, 绿藤城's 巨型 and 协同 leaders in GIANTS.
// A battle is deterministic for its line-ups and seed: the server computes the outcome before the bets and every client
// replays it identically (IEEE-exact arithmetic only: sqrt, + − × ÷; time is counted in whole steps).
// Globals expected: FIGHTERS (every enemy), DUELCFG (data/duelcfg.json: the three events as one), clamp, lerp.
// The roster is DUELCFG.roster, each enemy with its pool weights (DUELCFG.pools: the highest of the three events') as f.pool.
const DCFG = DUELCFG, ENV = DCFG.env;
const POOL = FIGHTERS.filter((f) => DCFG.roster.includes(f.key)).map((f) => ({ ...f, pool: DCFG.pools[f.key] || {} }));
// every enemy by key, the ones that only come summoned or with their group too
const FIGHTER = Object.fromEntries(FIGHTERS.map((f) => [f.key, f]));
const AW = 13, AH = 9;                      // playable columns (S … E) and lanes; the forbidden border is drawn around
const byKey = (k) => POOL.find((f) => f.key === k);
const dist = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- the sim (no rendering): a world of units, deterministic for a seed ------------------------------------------------
const DT = 1 / 30, HZ = 30, BATTLE_MAX = DCFG.consts.battlePhaseTimeMax || 200;
// Timers count down by DT, which 1/30 cannot hold exactly: a 3.5 s countdown is still 4e-15 after its 105th step and
// would run out one step late, a 1.5 s one would not — which intervals ran late depended on how their decimals round
// (before this, 48 % of back-to-back attacks, every one of the 3.5 / 4 / 7 s attackers). The game counts in fixed point
// (PRTS), where a whole number of steps is exact; so a countdown within EPS of zero has run out.
const EPS = 1e-9;
// collision: the distance two ground units keep, and how far a unit can be shoved in a step (0.6 tile a second)
const BODY = 0.5, SHOVE = 0.6 * DT;
const ZONE_FIRST = Math.round((ENV.zoneFirst ?? 60) * HZ), ZONE_EVERY = Math.round((ENV.zoneEvery ?? 20) * HZ);
const ZONES = ENV.zones || [[4, 3], [3, 2], [2, 1], [1, 0]], ZC = ENV.zoneCentre || [7, 5];
// the safe zone at step n: -1 before the first, else the index into ZONES (half-extents in tiles around the centre tile)
function zoneAt(n) { return n < ZONE_FIRST ? -1 : Math.min(ZONES.length - 1, Math.floor((n - ZONE_FIRST) / ZONE_EVERY)); }
// the zone's rectangle in field units (x 0…AW, y 0…AH); the level's column = floor(x) + 1, row = floor(y) + 1
function zoneRect(z) { const [hx, hy] = ZONES[z]; return { x0: ZC[0] - 1 - hx, x1: ZC[0] + hx, y0: ZC[1] - 1 - hy, y1: ZC[1] + hy }; }
const tileX = (x) => clamp(Math.floor(x), 0, AW - 1), tileY = (y) => clamp(Math.floor(y), 0, AH - 1);
function outsideZone(u, z) {
  if (z < 0) return false;
  const [hx, hy] = ZONES[z];
  return Math.abs(tileX(u.x) + 1 - ZC[0]) > hx || Math.abs(tileY(u.y) + 1 - ZC[1]) > hy;
}
const RESIST = new Set(ENV.statusResist || []);
// the range shapes the skills name (range_table): [column, row] offsets around a tile
const RANGES = DCFG.ranges || {};
const inShape = (id, cx, cy, v) => (RANGES[id] || [[0, 0]]).some(([c, r]) => tileX(v.x) === cx + c && tileY(v.y) === cy + r);

// ---- stats: the data's × the level's runes, then buffs ------------------------------------------------------------------
// A buff: { id, t (seconds left; Infinity until taken off), atk (ratio), aspd, def, defMul (ratio), res, ms (ratio),
// msMul (×, “提升至”), dr (damage taken − share), dodge (physical) }. A buff with an id replaces the one before it.
function sumBuffs(u) {
  let atk = 0, aspd = 0, def = 0, defMul = 0, res = 0, ms = 0, msMul = 1, dr = 0, dodge = 0;
  for (const b of u.buffs) {
    atk += b.atk || 0; aspd += b.aspd || 0; def += b.def || 0; defMul += b.defMul || 0; res += b.res || 0; ms += b.ms || 0;
    if (b.msMul) msMul *= b.msMul;
    if (b.dr) dr = 1 - (1 - dr) * (1 - b.dr);
    if (b.dodge > dodge) dodge = b.dodge;
  }
  u.bAtk = atk; u.bAspd = aspd; u.bDef = def; u.bDefMul = defMul; u.bRes = res; u.bMs = ms; u.bMsMul = msMul; u.bDr = dr; u.dodge = dodge;
}
function addBuff(u, b) {
  const i = b.id ? u.buffs.findIndex((x) => x.id === b.id) : -1;
  if (i >= 0) u.buffs[i] = b; else u.buffs.push(b);
  sumBuffs(u);
  return b;
}
function dropBuff(u, id) { const n = u.buffs.length; u.buffs = u.buffs.filter((x) => x.id !== id); if (u.buffs.length !== n) sumBuffs(u); }
const hasBuff = (u, id) => u.buffs.some((x) => x.id === id);
// a stacking buff: one more stack (up to max), its values the per-stack ones × stacks
function stackBuff(u, id, per, max, t) {
  const old = u.buffs.find((x) => x.id === id), n = Math.min(max || Infinity, (old ? old.n : 0) + 1);
  const b = { id, n, t: t ?? Infinity };
  for (const [k, v] of Object.entries(per)) b[k] = v * n;
  return addBuff(u, b);
}
function tickBuffs(u) {
  let gone = false;
  for (const b of u.buffs) if (b.t !== Infinity) { b.t -= DT; if (b.t <= EPS) gone = true; }
  if (gone) { u.buffs = u.buffs.filter((b) => b.t === Infinity || b.t > EPS); sumBuffs(u); }
}
const atkOf = (u) => u.atk * u.atkMul * (1 + u.bAtk);
const defOf = (u) => Math.max(0, (u.defv + u.bDef) * (1 + u.bDefMul));
const resOf = (u) => clamp(u.res + u.bRes, 0, 100);
const artsOf = (atk, v) => atk * Math.max(0.05, 1 - resOf(v) / 100);
const physOf = (atk, v, pen) => Math.max(atk * 0.05, atk - defOf(v) * (1 - (pen || 0)));
// 抵抗 (PRTS 术语释义: stun, cold, freeze … last half as long): the level's rune (火与钢) or the enemy's own (handbook)
const resists = (v) => RESIST.has(v.f.key) || v.resist;

// traps: the round's field traps (makeTraps; none by default)
function makeWorld(lineups, seed, visual, traps) {
  const W = { units: [], shots: [], t: 0, n: 0, zone: -1, rng: mulberry32(seed), visual, result: null, done: false, events: [],
    reserve: [], born: [], timers: [], ground: [], hurt: [false, false], start: [0, 0], all: [[], []], coming: [0, 0],
    traps: (traps || []).map(makeTrap), bolts: [], links: [] };
  trapTiles(W); W.links = coilLinks(W);
  lineups.forEach((groups, side) => {
    const flat = [];
    // a 协同 group enters whole with its head (data/fighters.json group)
    for (const g of groups) for (let i = 0; i < g.n; i++) { flat.push(g.f); for (const k of g.f.group || []) flat.push(FIGHTER[k]); }
    // 巨型 leaders stand at the giants' spawn point (GIANTS); the 惊喜 enemies may wait off the field (SURPRISE)
    const giants = flat.filter((f) => GIANT.has(f.key)), rest = flat.filter((f) => !GIANT.has(f.key));
    const sur = rest.filter((f) => SURPRISE.has(f.key)), hold = SR && sur.length > 0 && sur.length < rest.length && sur.length <= rest.length * SR.teamRatio;
    const field = hold ? rest.filter((f) => !SURPRISE.has(f.key)) : rest;
    for (const f of giants) W.units.push(makeUnit(f, side, side === 0 ? GIANT_AT[0] : AW - GIANT_AT[0], GIANT_AT[1], W));
    field.forEach((f, i) => {
      const lane = i % AH, layer = Math.floor(i / AH);
      const y = lane + 0.5 + (W.rng() - 0.5) * 0.3;
      const x = side === 0 ? 0.55 - layer * 0.18 + (W.rng() - 0.5) * 0.2 : AW - 0.55 + layer * 0.18 + (W.rng() - 0.5) * 0.2;
      W.units.push(makeUnit(f, side, clamp(x, 0.1, AW - 0.1), y, W));
    });
    if (hold) for (const f of sur) W.reserve.push(makeUnit(f, side, side === 0 ? 0.55 : AW - 0.55, AH / 2, W));
  });
  for (const u of W.units) { W.start[u.side]++; W.all[u.side].push(u); }
  for (const u of W.reserve) W.all[u.side].push(u);
  for (const u of W.units) { const H = ENEMIES[u.f.key]; if (H && H.enter) H.enter(W, u); }
  return W;
}
function makeUnit(f, side, x, y, W) {
  const T = f.talents || {}, SK = f.skillData || {};
  const u = {
    f, side, x, y, maxHp: f.hp * ENV.hpMul, atk: f.atk * ENV.atkMul, defv: f.def, res: f.res, bat: f.bat, aspd: f.aspd,
    ranged: f.way === 'RANGED' || f.way === 'ALL', arts: f.dmg === 'arts', reach: Math.max(0.8, f.range), speed: f.ms * ENV.moveMultiplier,
    cd: 0.3 + W.rng() * 0.6, target: null, retarget: 0, dead: false, stacks: 0, outN: 0, outside: false, pending: [],
    facing: side === 0 ? 1 : -1, stun: 0, stunKind: '', bleed: [], reborn: REBORN(f) ? 1 : 0, rebornT: 0, enhanced: false,
    rangeT: 0, state: 'idle', attackSeq: 0, attackIv: 1, skillSeq: 0, sp: f.spData ? f.spData.init || 0 : 0, view: null,
    // the leaders' states (zero for everyone else): damage taken reduced by dr, invincible for invT, a barrier, standing
    // still for hold (the barrier) / charge (溶血骇惧), ATK × atkMul, a 溶血骇惧 on this unit (fear)
    dr: T['Passive.damage_resistance'] || 0, invT: 0, barrier: 0, hold: 0, charge: 0, atkMul: 1, fear: null,
    // buffs (sumBuffs), states: 寒冷 (cold), 自缚 / rooted (root), no attacks (disarm: 无德决斗家; noAtk: the enemy's own),
    // a skill being channelled (chan), skill clocks (clk), element gauges (el), 嘲讽等级 (taunt)
    buffs: [], bAtk: 0, bAspd: 0, bDef: 0, bDefMul: 0, bRes: 0, bMs: 0, bMsMul: 1, bDr: 0, dodge: 0,
    cold: 0, root: 0, disarm: 0, noAtk: 0, chan: null, clk: {}, el: null, taunt: TAUNT[f.key] || T['taunt.taunt_level'] || 0,
    resist: (f.abilities || []).some((a) => a.text.includes('拥有抵抗')), giant: GIANT.has(f.key), atkN: 0, regen: f.regen || 0,
  };
  // 杰斯顿: the warden form attacks at range with arts (ironsandstorm); the killer form after the reborn is melee physical
  if (SK.ironsandstorm) { u.ranged = true; u.arts = true; }
  // the leaders' skill clocks (initial cooldowns from the data)
  if (SK.CrossAttack) u.crossT = SK.CrossAttack.init;
  if (SK.ShieldBurst) u.burstT = SK.ShieldBurst.init;
  if (SK.FearCage) { u.fsp = 0; u.fearOn = null; u.fearWait = 0; u.fearHp0 = 0; }
  if (SK.Rush) u.rushT = SK.Rush.bb.duration;
  // 狼之主's first form cannot be stunned
  u.noStun = !!T['Passive.damage_resistance'];
  u.leader = !!(SK.CrossAttack || SK.FearCage || SK.Rush);
  // a giant reaches the whole field
  if (u.giant) u.reach = 99;
  u.hp = u.maxHp;
  const H = ENEMIES[f.key];
  if (H && H.init) H.init(u, T, SK);
  return u;
}
// a unit summoned or dropped in during the battle (shown by the arena as it appears)
function spawnUnit(W, key, side, x, y, init) {
  const f = FIGHTER[key];
  if (!f) return null;
  const u = makeUnit(f, side, clamp(x, 0.1, AW - 0.1), clamp(y, 0.1, AH - 0.1), W);
  if (init) init(u);
  W.born.push(u); W.all[side].push(u);
  return u;
}
const after = (W, t, run) => W.timers.push({ t, run });
const live = (v) => !v.dead && !v.rebornT;
const foesOf = (W, u) => W.units.filter((v) => live(v) && v.side !== u.side);
const alliesOf = (W, u) => W.units.filter((v) => live(v) && v.side === u.side && v !== u);
// a giant's body (GIANTS): the rectangle it occupies, { x0, x1, y0, y1 } in field units
function boxOf(v) {
  const B = GIANT_BOX[v.f.key], cx = v.x + (v.side ? -B.dx : B.dx), cy = v.y + B.dy;
  return { x0: cx - B.w / 2, x1: cx + B.w / 2, y0: cy - B.h / 2, y1: cy + B.h / 2 };
}
// the point of v's body nearest to u (a giant: the nearest point of its rectangle; anyone else: itself)
function aimAt(u, v) {
  if (!v.giant) return [v.x, v.y];
  const b = boxOf(v);
  return [clamp(u.x, b.x0, b.x1), clamp(u.y, b.y0, b.y1)];
}
// the distance from u to v's body
const gap = (u, v) => { if (!v.giant) return dist(v.x - u.x, v.y - u.y); const [ax, ay] = aimAt(u, v); return dist(ax - u.x, ay - u.y); };
// the target: an enemy in reach, highest 嘲讽等级 first, then the nearest (PRTS: 优先攻击嘲讽等级最高 > 距离自身最近 /
// 仇恨值最高 — the duel's data gives no aggro but the 嘲讽等级 ±1 of some enemies, so both read as this); none in reach:
// the nearest, to walk to
function pickTarget(W, u) {
  let best = null, bd = 1e9, bin = false;
  for (const v of W.units) {
    if (!live(v) || v.side === u.side) continue;
    const d = gap(u, v), inR = d <= u.reach;
    if (inR && !bin) { best = v; bd = d; bin = true; continue; }
    if (inR !== bin) continue;
    if (inR ? v.taunt > best.taunt || (v.taunt === best.taunt && d < bd) : d < bd) { best = v; bd = d; }
  }
  return best;
}
// up to n enemies within a radius of u (default its reach), by 嘲讽等级 then distance
function bestFoes(W, u, n, r) {
  const R = r ?? u.reach;
  return foesOf(W, u).map((v) => [gap(u, v), v]).filter((x) => x[0] <= R).sort((a, b) => b[1].taunt - a[1].taunt || a[0] - b[0]).slice(0, n).map((x) => x[1]);
}
// up to n enemies within reach, the main target first, then by 嘲讽等级 and distance
function enemiesInReach(W, u, tg, n) {
  const list = [tg];
  for (const v of bestFoes(W, u, n + 1)) { if (list.length >= n) break; if (v !== tg) list.push(v); }
  return list;
}
// stun / freeze: the target's immunities (enemy_database) and status resistance (half duration); a skill being
// channelled and an attack in progress are interrupted
function disable(W, v, sec, kind) {
  if (!live(v) || (v.f.immune && v.f.immune[kind]) || (kind === 'stun' && v.noStun) || v.ccImmune) return;
  if (resists(v)) sec *= 0.5;
  if (sec > v.stun) { v.stun = sec; v.stunKind = kind; }
  v.pending = [];
  if (v.chan) chanBreak(W, v);
  const H = ENEMIES[v.f.key];
  if (H && H.stunned) H.stunned(W, v);
  if (W.visual) W.events.push([kind, v]);
}
// 寒冷 (PRTS 术语释义): attack speed −30; chilled again while cold or frozen, an enemy freezes (unless immune)
function chill(W, v, sec) {
  if (!live(v)) return;
  if ((v.cold > 0 || (v.stun > 0 && v.stunKind === 'frozen')) && !(v.f.immune && v.f.immune.frozen)) { disable(W, v, sec, 'frozen'); return; }
  const s = resists(v) ? sec * 0.5 : sec;
  if (s > v.cold) v.cold = s;
  if (W.visual) W.events.push(['cold', v]);
}
// HP lost. src: the unit it came from (hits and skills; null for the safe zone, bleeding …); tick: a share of damage
// over time (a step's) — hit-counting talents only count discrete hits
function hurt(W, b, dmg, src, tick) {
  if (!live(b) || b.invT > 0) return;
  b.hp -= dmg;
  if (W.visual) b.flash = 0.12;
  if (dmg > 0) {
    W.hurt[b.side] = true;
    if (b.grow) b.grow = false;
    const H = ENEMIES[b.f.key];
    if (H && H.hurt) H.hurt(W, b, dmg, src, !tick);
  }
  if (b.hp > 0 || b.dead) return;
  fall(W, b, false);
}
// a unit's HP ran out (or it was taken off the field: removed — no reborn, nothing of its own on death)
function fall(W, b, removed) {
  // a 溶血骇惧 ends with the unit it was on
  if (b.fear) fearOff(W, b);
  // 杰斯顿, 群集之瘴 and the leaders (reborn): drop, come back after the delay in the second form
  if (b.reborn === 1 && !removed) {
    const T = b.f.talents;
    b.reborn = 2; b.hp = 0; b.rebornT = REBORN(b.f); b.target = null; b.pending = []; b.stun = 0; b.stacks = 0; b.outN = 0;
    b.barrier = 0; b.hold = 0; b.charge = 0; b.chan = null; b.cold = 0;
    if (b.fearOn) fearAllOff(W, b);
    W.events.push(['reborn', b]);
    return;
  }
  b.hp = 0; b.dead = true; b.chan = null; W.events.push([removed ? 'gone' : 'die', b]);
  if (!removed) {
    const T = b.f.talents || {}, H = ENEMIES[b.f.key];
    // 易爆源石虫 / 自爆冰虫 / 爆裂冰法师: a blast around it (BOOM)
    const B = BOOM[b.f.key];
    if (B) {
      const a = atkOf(b) * T['boom.atk_scale'];
      for (const v of foesOf(W, b)) if (dist(v.x - b.x, v.y - b.y) <= B.r) {
        strike(W, v, B.arts ? artsOf(a, v) : physOf(a, v), b, B.arts ? 'arts' : 'phys');
        if (B.cold) chill(W, v, B.cold);
      }
      W.events.push(['boom', b]);
    }
    // what it leaves (data/fighters.json deathSpawn: its own deathrattle or PRTS's text)
    const S = b.f.deathSpawn;
    if (S) W.coming[b.side]++;
    if (S) after(W, S.delay || EPS, () => {
      W.coming[b.side]--;
      for (let i = 0; i < S.cnt; i++) {
        const o = S.spread ? (W.rng() * 2 - 1) * S.spread : 0, p = S.spread ? (W.rng() * 2 - 1) * S.spread : 0;
        spawnUnit(W, S.key, b.side, b.x + o, b.y + p, null);
      }
    });
    if (H && H.die) H.die(W, b);
  }
  // the other units that react to a death (劈柴骑士, the 协同 partners)
  for (const v of W.units) if (v !== b && live(v)) { const H = ENEMIES[v.f.key]; if (H && H.death) H.death(W, v, b); }
}
// physical or arts damage (not true damage): the target's damage reductions (its own, its weak side, buffs), then its
// barrier, then its HP. A barrier that breaks ends its skill. Returns the damage taken.
function strike(W, b, dmg, src, kind) {
  if (!live(b)) return 0;
  if (b.dr) dmg *= 1 - b.dr;
  if (b.bDr) dmg *= 1 - b.bDr;
  // 勇敢的壳 / 荒原刺背兽: the weak point in front, damage from behind reduced; 石头脑袋 the other way round
  if (b.weak && src) { const front = (src.x - b.x) * b.facing > 0; if (front !== b.weak.front) dmg *= 1 - b.weak.dr; }
  // 岁相: from a source in the columns of its body, above or below it, damage × 50 % (Bristleback; PRTS)
  if (b.giant && src && b.f.talents['Bristleback.damage_resistance']) {
    const B = boxOf(b);
    if (src.x >= B.x0 && src.x <= B.x1 && (src.y < B.y0 || src.y > B.y1)) dmg *= 1 - b.f.talents['Bristleback.damage_resistance'];
  }
  if (b.barrier > 0 && (!b.barrierArts || kind === 'arts')) {
    const a = Math.min(b.barrier, dmg);
    b.barrier -= a; dmg -= a;
    if (b.barrier <= 0) {
      b.barrier = 0; b.hold = 0; W.events.push(['barrierbreak', b]);
      const H = ENEMIES[b.f.key];
      if (H && H.unshield) H.unshield(W, b);
    }
  }
  hurt(W, b, dmg, src, false);
  return dmg;
}
// one hit of a's on b at ATK × mult. o: { stun, pen (share of DEF ignored), arts / phys / tru (the damage type, else
// the attacker's), cold, el ([kind, amount]), noTalent (no on-hit talents) }
function hit(W, a, b, mult, o) {
  if (!live(b)) return 0;
  const atk = atkOf(a) * mult, kind = o && o.tru ? 'true' : o && o.phys ? 'phys' : (o && o.arts) || a.arts ? 'arts' : 'phys';
  // physical dodge (拳击宗师, 假酒海盗's zone)
  if (kind === 'phys' && b.dodge > 0 && W.rng() < b.dodge) { if (W.visual) W.events.push(['miss', b]); return 0; }
  const dmg = kind === 'true' ? atk : kind === 'arts' ? artsOf(atk, b) : physOf(atk, b, o && o.pen);
  const dealt = strike(W, b, dmg, a, kind);
  if (W.visual) W.events.push(['hit', b, a]);          // for the effects only (never read by the sim)
  if (a.grow) a.grow = false;
  if (o && o.stun) disable(W, b, o.stun, 'stun');
  if (o && o.cold) chill(W, b, o.cold);
  if (o && o.disarm && live(b)) b.disarm = Math.max(b.disarm, o.disarm);
  if (o && o.el) elem(W, b, o.el[0], o.el[1]);
  if (!(o && o.noTalent)) onHit(W, a, b, dealt);
  return dealt;
}
// the on-hit talents of the attacker
function onHit(W, a, b, dealt) {
  const T = a.f.talents || {};
  if (T['Bleeding.attack@bleeding_damage']) b.bleed.push({ dps: T['Bleeding.attack@bleeding_damage'], t: T['Bleeding.attack@duration'] || 10 });
  if (T['dot.damage']) b.bleed.push({ dps: T['dot.damage'] / (T['dot.interval'] || 1), t: T['dot.duration'] || 10, arts: true });
  // 流鼻涕虫虫 / 窃笑鳄鱼: DEF down with every hit, stacking without end
  if (T['defdown.def'] && live(b)) stackBuff(b, 'defdown', { def: T['defdown.def'] }, Infinity);
  // the element gauges a normal attack adds (ATK × ratio): 巧克力流心虫虫 灼燃, 凋零萨卡兹 / 重生术师 凋亡
  const E = EL_HIT[a.f.key];
  if (E && T[E[1]]) elem(W, b, E[0], atkOf(a) * T[E[1]]);
  const H = ENEMIES[a.f.key];
  if (H && H.hit) H.hit(W, a, b, dealt);
}
// 元素损伤 on an enemy (PRTS 术语释义, the “·我方” versions: the duel's units are all enemies): the gauge fills to 1000
// (a 领袖 2000) and bursts — 灼燃: 7000 element damage and RES −20 for 10 s; 凋亡: 800 element damage a second and 50 %
// 虚弱 (ATK down) easing off over 15 s, updated once a second. While it bursts the gauge stays empty. Element damage
// is not reduced by DEF or RES (read as true damage).
function elem(W, b, kind, amt) {
  if (!live(b) || !(amt > 0)) return;
  const E = b.el || (b.el = { burn: 0, apo: 0, burnT: 0, apoT: 0 });
  if (E[kind + 'T'] > 0) return;
  E[kind] += amt;
  if (E[kind] < (b.f.levelType === 'BOSS' ? 2000 : 1000) - EPS) return;
  E[kind] = 0;
  if (kind === 'burn') { E.burnT = 10; addBuff(b, { id: 'burn', t: 10, res: -20 }); hurt(W, b, 7000, null, false); }
  else { E.apoT = 15; addBuff(b, { id: 'apo', t: Infinity, atk: -0.5 }); }
  W.events.push(['elem', b, kind]);
}
function elemStep(W, u) {
  const E = u.el;
  if (E.burnT > 0) { E.burnT -= DT; if (E.burnT <= EPS) E.burnT = 0; }
  if (E.apoT > 0) {
    hurt(W, u, 800 * DT, null, true);
    const s0 = Math.ceil(E.apoT - EPS);
    E.apoT -= DT;
    if (E.apoT <= EPS) { E.apoT = 0; dropBuff(u, 'apo'); } else if (Math.ceil(E.apoT - EPS) !== s0) addBuff(u, { id: 'apo', t: Infinity, atk: -0.5 * Math.ceil(E.apoT - EPS) / 15 });
  }
}
// what lands where a hit lands: the main target (unless o.noMain), the area around it (o.area: a range_table shape
// around the target's tile, or a radius, o.areaMult of ATK; o.areaOthers: the others only), a chain (重生术师)
function land(W, a, tg, mult, o) {
  if (o && o.cross) { crossBlast(W, a, tg.x, tg.y, mult, o.cross); return; }
  if (!(o && o.noMain)) hit(W, a, tg, mult, o);
  // 改装排污车's 污秽喷射: a pollution of radius 1.7 (PRTS) where it lands, its data's damage a second to the enemies in it
  if (o && o.pollute) {
    const P = o.pollute;
    ground(W, { kind: 'pollute', x: tg.x, y: tg.y, r: 1.7, side: a.side, t: P.projectile_life_time, tick: (W2, g) => {
      for (const v of W.units) if (live(v) && v.side !== g.side && onGround(g, v)) hurt(W, v, P.polluted_damage_low * DT, a, true);
    } });
  }
  if (o && o.area) {
    const A = o.area, cx = tileX(tg.x), cy = tileY(tg.y), am = mult * (A.mult ?? 1);
    for (const v of foesOf(W, a)) {
      if (v === tg) continue;
      if (A.r ? dist(v.x - tg.x, v.y - tg.y) <= A.r : inShape(A.id, cx, cy, v)) hit(W, a, v, am, { ...o, area: null, noMain: false, chain: null, noTalent: A.noTalent });
    }
    if (W.visual) W.events.push(['area', a, { x: tg.x, y: tg.y, id: A.id, r: A.r }]);
  }
  if (o && o.chain) {
    const C = o.chain, done = new Set([tg]);
    let at = tg, m = mult;
    for (let i = 1; i < C.n; i++) {
      const next = foesOf(W, a).filter((v) => !done.has(v)).map((v) => [dist(v.x - at.x, v.y - at.y), v]).filter((x) => x[0] <= C.r).sort((p, q) => p[0] - q[0])[0];
      if (!next) break;
      m *= C.k; at = next[1]; done.add(at);
      hit(W, a, at, m, { ...o, chain: null });
      if (W.visual) W.events.push(['chain', at, a]);
    }
  }
}
// ---- skills over time, the ground, timers ------------------------------------------------------------------------------
// a skill channelled for a while (no moving, no normal attacks meanwhile): { key, tgt (ends it when it falls, unless
// free), dur (s), every (s: a tick), tick(W, u, c), end(W, u, c) (ran its course), after(W, u, done) (either way) }; a
// stun or freeze breaks it (disable)
function chan(W, u, c) {
  u.chan = { s: 0, n: 0, ...c, S: Math.round(c.dur * HZ), E: c.every ? Math.round(c.every * HZ) : 0 };
  u.skillSeq++; u.pending = [];
  if (W.visual) W.events.push(['chan', u, c.key]);
}
function chanStep(W, u) {
  const c = u.chan;
  if (c.tgt && !c.free && !live(c.tgt)) { chanEnd(W, u, false); return; }
  c.s++;
  if (c.E && c.s % c.E === 0) { c.n++; c.tick(W, u, c); if (u.chan !== c) return; }
  if (c.s >= c.S) chanEnd(W, u, true);
}
function chanEnd(W, u, done) { const c = u.chan; u.chan = null; if (done && c.end) c.end(W, u, c); if (c.after) c.after(W, u, done); }
function chanBreak(W, u) { const c = u.chan; u.chan = null; if (c.after) c.after(W, u, false); }
// an effect on the ground: { kind, x, y; r (radius) | id (a range shape around tile cx, cy) | all; side (its owner's),
// t (s), every (s), tick(W, g) } — ticks at once, then every `every` s, or each step without one
function ground(W, g) {
  const G = { ...g, s: Math.round(g.t * HZ), E: g.every ? Math.round(g.every * HZ) : 1, k: 0, cx: tileX(g.x), cy: tileY(g.y) };
  W.ground.push(G);
  if (W.visual) W.events.push(['ground', null, G]);
  return G;
}
const onGround = (g, v) => (g.r ? dist(v.x - g.x, v.y - g.y) <= g.r : g.id ? inShape(g.id, g.cx, g.cy, v) : true);
function groundStep(W) {
  for (const g of W.ground) { if (g.k % g.E === 0) g.tick(W, g); g.k++; }
  W.ground = W.ground.filter((g) => g.k < g.s);
}
function runTimers(W) {
  const due = [];
  for (const x of W.timers) { x.t -= DT; if (x.t <= EPS) due.push(x); }
  if (!due.length) return;
  W.timers = W.timers.filter((x) => x.t > EPS);
  for (const x of due) x.run();
}

// ---- LEADERS: the 领袖 of 竞猜对决 (PRTS 争锋频道/选手信息/领袖; numbers from their duel data) -------------------------
// “自在” — 纬地经天 (CrossAttack: init 2 s, cooldown 5 s): one cast at the (up to) five nearest enemies, an arts projectile
//   each; where one lands, the target's tile and the four next to it (a cross) take ATK × 200 %, each enemy at most once
//   a cast (the crosses of one cast overlap on a crowd; counted apart, “自在” won 90 % of 300 sample battles, the other
//   two leaders about half — read as one cast, about half too); in the second form one more at the farthest enemy. 破桎而出 (ShieldBurst, init / cooldown 20 s; second form ShieldBurstReborn 40 s): with an enemy
//   within 3 tiles, it stops moving behind a barrier for 8 s; a barrier still standing at the end goes off as ATK ×
//   800 % / 1200 % arts on every enemy within 3 tiles, a broken one ends the skill. The barrier absorbs 7500 / 9000 (PRTS;
//   three times the data's `dynamic`, 2500 / 3000, as for the story version). Second form (reborn after 5 s): ATK +10 %,
//   each attack twice (a second enemy when one is in reach), invincible 5 s. 晦明 is not applied: the duel's level gives
//   no unit a 晦 / 明 attribute and PRTS's duel text does not mention it.
// 依然“狼之主” — first form: damage taken −30 %, cannot be stunned. 溶血骇惧 (FearCage): its charge fills 1 a second (55),
//   it then stands for a 7 s wind-up and seizes three random enemies: attack speed −70, losing HP at a rate rising from
//   0 to 30 % of max HP a second over 40 s; once it has lost 20 % of its own max HP, every effect ends; each effect that
//   ends gives back 5 of the charge; no new one within 7 s of the last ending; none while effects last. Second form
//   (reborn after 10 s): ATK +50 %, attack interval −1.5 s, attacks twice, no damage reduction, no 溶血骇惧, invincible
//   10 s. 狂暴怒嗥 has no effect in the duel (PRTS) and is left out.
// “火与钢” — at or below half HP: ATK +280 %, damage taken −60 %. 冲锋 (Rush, once at the start): move speed +200 % for
//   4.5 s. First knock-down: reborn after 5 s with half its HP, invincible 10 s.
// A barrier absorbs three times its data's `dynamic`, as PRTS gives every one of them: 自在 7500 for 2500, 灰尾香主
// (玻璃球打手's original) 10002 for 3334, 泥岩小队践行者 (覆面大锤客's) three layers of 2000 for 2000.
const BARRIER_K = 3;
// a 溶血骇惧 ends on one unit: its source gets 5 of the charge back; after the last, the 7 s pause
function fearOff(W, v) {
  const u = v.fear.src, F = u.f.skillData.FearCage.bb;
  v.fear = null;
  if (!u.fearOn) return;
  u.fearOn = u.fearOn.filter((x) => x !== v);
  u.fsp = Math.min(u.f.skillData.FearCage.sp, u.fsp + F.sp);
  if (!u.fearOn.length) { u.fearOn = null; u.fearWait = F.duration_wait; }
  if (W.visual) W.events.push(['fearend', v]);
}
function fearAllOff(W, u) { for (const v of u.fearOn.slice()) fearOff(W, v); }
// up to n of a list, drawn with the world's generator
function drawN(list, n, rng) {
  const a = list.slice(), out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]);
  return out;
}
// 纬地经天 lands: the cross of tiles around the point; cast: the enemies this cast has already hit
function crossBlast(W, u, x, y, mult, cast) {
  const cx = tileX(x), cy = tileY(y), atk = atkOf(u) * mult;
  for (const v of W.units) {
    if (v.dead || v.side === u.side || cast.has(v)) continue;
    const tx = tileX(v.x), ty = tileY(v.y);
    if ((tx === cx && Math.abs(ty - cy) <= 1) || (ty === cy && Math.abs(tx - cx) <= 1)) { cast.add(v); strike(W, v, artsOf(atk, v), u, 'arts'); }
  }
  if (W.visual) W.events.push(['cross', u, { x: cx + 0.5, y: cy + 0.5 }]);
}
// a leader's step (after the damage over time, before the stun): the timers of its skills and states
function leaderStep(W, u, T, SK) {
  if (u.invT > 0) { u.invT -= DT; if (u.invT <= EPS) u.invT = 0; }
  if (u.rushT > 0) { u.rushT -= DT; if (u.rushT <= EPS) u.rushT = 0; }
  // “火与钢”: the low-HP state
  if (T['AtkUp.atk']) { const low = u.hp <= u.maxHp * T['atkup.hp_ratio']; u.atkMul = low ? 1 + T['AtkUp.atk'] : 1; u.dr = low ? T['AtkUp.damage_resistance'] : 0; }
  // “自在”: 纬地经天
  if (SK.CrossAttack) {
    u.crossT -= DT;
    if (u.crossT <= EPS) {
      const by = foesOf(W, u).map((v) => [dist(v.x - u.x, v.y - u.y), v]).sort((a, b) => a[0] - b[0]);
      if (by.length) {
        u.crossT = SK.CrossAttack.cd;
        const tgts = by.slice(0, 5).map((x) => x[1]);
        if (u.enhanced) tgts.push(by[by.length - 1][1]);
        const cast = new Set();
        for (const v of tgts) W.shots.push({ src: u, tgt: v, x: u.x + u.facing * 0.3, y: u.y, mult: SK.CrossAttack.bb.atk_scale, o: { cross: cast }, g: null, delay: 0 });
        u.skillSeq++;
      }
    }
  }
  // “自在”: 破桎而出
  const burst = u.enhanced ? SK.ShieldBurstReborn : SK.ShieldBurst;
  if (burst) {
    u.burstT -= DT;
    if (u.hold > 0) {
      u.hold -= DT;
      if (u.hold <= EPS) {
        u.hold = 0;
        if (u.barrier > 0) {
          u.barrier = 0;
          const atk = atkOf(u) * burst.bb.atk_scale;
          for (const v of W.units) if (!v.dead && v.side !== u.side && dist(v.x - u.x, v.y - u.y) <= burst.bb.range_radius) strike(W, v, artsOf(atk, v), u, 'arts');
          W.events.push(['barrierblast', u]);
        }
      }
    } else if (u.burstT <= EPS && foesOf(W, u).some((v) => dist(v.x - u.x, v.y - u.y) <= burst.bb.range_radius)) {
      u.burstT = burst.cd; u.barrier = burst.bb.dynamic * BARRIER_K; u.hold = burst.bb.duration; u.skillSeq++;
      W.events.push(['barrier', u]);
    }
  }
  // 依然“狼之主”: 溶血骇惧 (first form)
  if (SK.FearCage && !u.enhanced) {
    const C = SK.FearCage, F = C.bb;
    if (u.fearOn) {
      if (u.fearHp0 - u.hp >= -F.hp_ratio_offset * u.maxHp) fearAllOff(W, u);
    } else if (u.charge > 0) {
      u.charge -= DT;
      if (u.charge <= EPS) {
        u.charge = 0;
        const tgts = drawN(foesOf(W, u), F.max_target, W.rng);
        if (tgts.length) {
          u.fearOn = tgts; u.fearHp0 = u.hp; u.fsp = 0; u.skillSeq++;
          for (const v of tgts) { if (v.fear) fearOff(W, v); v.fear = { t: 0, src: u }; W.events.push(['fear', v]); }
        }
      }
    } else {
      if (u.fearWait > EPS) u.fearWait -= DT;
      u.fsp = Math.min(C.sp, u.fsp + (T['Passive.sp'] || 1) * DT);
      if (u.fsp >= C.sp - EPS && u.fearWait <= EPS && foesOf(W, u).length) { u.charge = F.duration_wait; W.events.push(['fearcharge', u]); }
    }
  }
}

// ---- ENEMIES: every other enemy's skills and talents --------------------------------------------------------------------
// PRTS 争锋频道/选手信息 lists what each enemy does in the duel; the numbers are its duel data's (talents T, skills SK).
// Where PRTS lists nothing but the enemy's own data carries a talent the handbook explains and the duel can act on, it is
// applied too (窃笑鳄鱼's DEF −10 a hit, 拳击宗师's dodge, the weak sides of 勇敢的壳 / 石头脑袋, 虹吸巨刃's drain,
// 巨大雪球投手's snowball, 玻璃球打手 / 覆面大锤客's barriers, 勤奋的钻头 / 超级洗地机's rage, “睡眠不足”'s charged shot).
// Left out, with nothing in the duel to act on: blocking, deployment cost, 病害 / 溟痕 / 洋红蒸汽 terrain, 明晦, 失衡,
// 阻流阀 / 重整束流 / 稳固锁链 devices; and what needs a number neither gives (榴弹佣兵's long-range grenade, 雪境精锐's
// DEF down, “铜舌”'s coin, 标枪恐鱼's targeting, 蟹蟹爷爷's counter: PRTS “-”).
// Hooks: init(u, T, SK) as made; enter(W, u) once on the field at the start; step(W, u, T, SK) each step it is free to
// act (not stunned); pre(W, u, tg) before an attack's interval; attack(W, u, tg, a) shapes the attack; fired(W, u) when
// it lands; hit(W, a, b, dealt) after a hit of its; hurt(W, b, dmg, src, discrete) as it takes damage; die(W, b) as it
// falls; death(W, u, other) as another unit falls; stunned(W, u); unshield(W, u) as its barrier breaks.
const ENEMIES = {};
const defEnemy = (keys, h) => { for (const k of keys.split(' ')) ENEMIES['enemy_' + k] = Object.assign(ENEMIES['enemy_' + k] || {}, h); };
const clkReady = (u, k) => u.clk[k] !== undefined && u.clk[k] <= EPS;
const clocks = (u, SK, keys) => { for (const k of keys) if (SK[k]) u.clk[k] = SK[k].init; };
// 嘲讽等级 (PRTS): +1 扎人的石头, 臭嗓门战士 (its data: taunt_level 1), “食器时代”, 匪帮欢乐船; −1 橡胶弹狙击手
const TAUNT = { enemy_5048_dqingd: 1, enemy_15078_dqcjld: 1, enemy_15083_dqymot: 1, enemy_15094_dqgent: -1 };
// who comes back once (reborn): 杰斯顿 and the leaders (reborn / Reborn.duration), 群集之瘴 (Reborning.duration); not
// 大力锤球手, whose data carries a Reborn (PRTS: 不会重生)
const REBORN = (f) => { const T = f.talents || {}; return f.key === 'enemy_15032_dqhrgr' ? 0 : T['reborn.duration'] || T['Reborn.duration'] || T['Reborning.duration'] || 0; };
// blasts on death (PRTS): 易爆源石虫 radius 1.25, ATK × 400 % physical; 自爆冰虫 1.65, 200 % physical and 寒冷 10 s
// (its data's boom.freeze; PRTS: 寒冷); 爆裂冰法师 arts 150 % and 寒冷 5 s (no radius given: 易爆源石虫's)
const BOOM = { enemy_15012_dqbsli: { r: 1.25 }, enemy_15013_dqsnsl: { r: 1.65, cold: 10 }, enemy_15041_dqgrg: { r: 1.25, arts: true, cold: 5 } };
// the element a normal attack adds, and its talent's ratio of ATK
const EL_HIT = { enemy_5029_dqslim: ['burn', 'EpDamage.attack@ep_damage_ratio'], enemy_15017_dqdwlo: ['apo', 'empty.attack@ep_damage_ratio'], enemy_15016_dqdkma: ['apo', 'epdamage.attack@ep_damage_ratio'] };
// the skills a full charge fires (spCost, one point an attack)
const SP_SKILL = {
  stuncombat: (W, u, tg, a, s) => { a.o.stun = s.bb.stun; },                       // 过气水手: the 4th attack stuns 7 s
  stunattack: (W, u, tg, a, s) => { a.o.stun = s.bb.stun; },                       // 橡胶弹狙击手: the 3rd, 100 % and 5 s
  coldattack: (W, u, tg, a, s) => { a.tgts = bestFoes(W, u, 2); a.o.cold = s.bb.freeze; },   // 冰手术师: two, 100 % arts, 寒冷 5 s
  PowerHit: (W, u, tg, a) => { a.o.area = { id: 'x-5' }; },                       // 赛场无赖射手: the target and the 4 around
  CostHealHit: (W, u, tg, a, s) => { a.heal = s.bb.hp_ratio; },                   // 过激的竞猜者: heals 5 % of max HP
  aoeAttack: (W, u, tg, a) => { a.tgts = foesOf(W, u).filter((v) => dist(v.x - u.x, v.y - u.y) <= 2); },   // 街头乐队鼓手: all within 2.0
  // 改装排污车: reach 4.0, a pollution of radius 1.7 where it lands, 100 true damage a second to the enemies in it
  PollutedRangedAtk: (W, u, tg, a, s) => { a.o.pollute = s.bb; },
  ironsandstorm: (W, u, tg, a, s) => { a.o.stun = s.bb.stun; a.tgts = enemiesInReach(W, u, tg, s.bb.max_target || 1); },   // 杰斯顿 (warden)
  armorpiercing: (W, u, tg, a, s) => { a.o.pen = s.bb.def_penetrate; a.times = s.bb.times || 1; },                        // 杰斯顿 (killer)
};
const SP_KEYS = Object.keys(SP_SKILL).filter((k) => k !== 'ironsandstorm' && k !== 'armorpiercing');
// the 禁锢 prisoners (锁链拳手, 衣架射手): attack speed −50 until, before the 4th attack, 解放: ATK +50 % and the fist
// ignores 60 % of DEF, the hanger shoots arts. 杰斯顿's killer form frees them all (PRTS: 进入杀手形态时解放全场敌人).
function liberate(W, u) {
  if (!u.confined) return;
  const T = u.f.talents;
  u.confined = false; dropBuff(u, 'confine');
  addBuff(u, { id: 'liberty', t: Infinity, atk: T['liberty.atk'] });
  if (T['liberty.def_penetrate']) u.pen = T['liberty.def_penetrate']; else u.arts = true;
  W.events.push(['liberty', u]);
}
defEnemy('5037_dqdbox 5038_dqiprr_2', {
  init(u, T) { u.confined = true; addBuff(u, { id: 'confine', t: Infinity, aspd: T['confinement.attack_speed'] }); },
  pre(W, u) { if (u.confined && u.atkN + 1 >= u.f.talents['confinement.times']) liberate(W, u); },
});
// 迫击炮弹投手: the shell hits the target's tile and the 8 around; 扩音术师: the 8 around take ATK × 100 % arts too
defEnemy('5031_dqrtar_2', { attack(W, u, tg, a) { a.o.area = { id: 'x-4' }; } });
defEnemy('5040_dqmage', { attack(W, u, tg, a) { const T = u.f.talents; a.o.area = { id: T['AOEDamage.range_id'], mult: T['AOEDamage.atk_scale'] }; } });
// “火苗与软钢”: at or below half HP, ATK +180 %
defEnemy('5035_dqveng_2', { step(W, u, T) { if (!u.low && u.hp <= u.maxHp * 0.5) { u.low = true; addBuff(u, { id: 'atkup', t: Infinity, atk: T['atkup.atk'] }); } } });
// 保鲜膜骑士: DEF +3000 and RES +95 for its first 30 s
defEnemy('5041_dqkght', { init(u, T) { addBuff(u, { id: 'wrap', t: T['buff.duration'], def: T['buff.def'], res: T['buff.magic_resistance'] }); } });
// 劈柴骑士: each fallen teammate, ATK +10 % and attack speed +5 (up to 10 times)
defEnemy('5042_dqkght_2', { death(W, u, d) { const T = u.f.talents; if (d.side === u.side) stackBuff(u, 'axe', { atk: T['enhance.atk'], aspd: T['enhance.attack_speed'] }, T['enhance.max_stack_cnt']); } });
// 冰手术师: two targets at once (its 伸出冰手: SP_SKILL coldattack)
defEnemy('5043_dqgscr', { attack(W, u, tg, a) { if (!a.skill) a.tgts = enemiesInReach(W, u, tg, 2); } });
// 小寄居蟹: before its first attack, 20 s of DEF +300, rooted
defEnemy('5044_dqzeni', { pre(W, u) { const T = u.f.talents; if (!u.atkN) { addBuff(u, { id: 'shell', t: T['Attack.duration'], def: T['Attack.def'] }); u.root = T['Attack.duration']; } } });
// 镜子机关枪 金酒之杯启动！ (Guide, init 10, every 35 s): locks one enemy in reach, 5 s, then ATK × 200 % arts; 20 s of
// attack speed +100 after
defEnemy('5046_dqmir', {
  init(u, T, SK) { clocks(u, SK, ['Guide']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'Guide')) return;
    const tg = bestFoes(W, u, 1)[0], S = SK.Guide.bb;
    if (tg) chan(W, u, { key: 'Guide', tgt: tg, dur: S.anim_duration, end: (W2, v, c) => { hit(W, v, c.tgt, S.atk_scale, { arts: true }); addBuff(v, { id: 'guide', t: S.duration, aspd: S.attack_speed }); }, after: (W2, v) => { v.clk.Guide = SK.Guide.cd; } });
  },
});
// 扎人的石头: 嘲讽等级 +1 (TAUNT); damage taken from a unit costs that unit 300 arts damage
defEnemy('5048_dqingd', { hurt(W, b, dmg, src, discrete) { if (src && discrete && !W.reflect && live(src)) { W.reflect = true; strike(W, src, artsOf(b.f.talents['taunt.value'], src), b, 'arts'); W.reflect = false; } } });
// 拳击宗师: when its HP first falls below half, 100 % physical dodge for 10 s
defEnemy('5051_dqrwar', { hurt(W, b) { const T = b.f.talents; if (!b.evaded && b.hp < b.maxHp * T['Evade.hp_ratio']) { b.evaded = true; addBuff(b, { id: 'evade', t: T['Evade.duration'], dodge: T['Evade.prob'] }); } } });
// 奔跑吧！躯壳！ / 硕鼷: hurt, move speed +300 % for 2 s / 5 s; again only after 5 s / 10 s
defEnemy('5052_dqsbr 15004_dqdhdt', { hurt(W, b) { const T = b.f.talents; if (W.n >= (b.runN || 0)) { b.runN = W.n + Math.round(T['SpeedUp.cooldown'] * HZ); addBuff(b, { id: 'run', t: T['SpeedUp.duration'], ms: T['SpeedUp.move_speed'] }); } } });
// “庞贝”: up to four targets, its 灼烧 (dot.*), attack speed +40 below half HP (selfbuff.*); from the first enemy within
// 0.8, every 10 s (paused while stunned) 1000 arts on every enemy within 1.4
defEnemy('5053_dqllme', {
  attack(W, u, tg, a) { a.tgts = enemiesInReach(W, u, tg, 4); },
  step(W, u, T) {
    if (!u.blastOn) { if (foesOf(W, u).some((v) => dist(v.x - u.x, v.y - u.y) <= 0.8)) { u.blastOn = true; u.rangeT = T['rangedamage.interval']; } return; }
    u.rangeT -= DT;
    if (u.rangeT > EPS) return;
    u.rangeT = T['rangedamage.interval'];
    for (const v of foesOf(W, u)) if (dist(v.x - u.x, v.y - u.y) <= 1.4) strike(W, v, artsOf(T['rangedamage.attack@damage'], v), u, 'arts');
    W.events.push(['blast', u]);
  },
});
// 大君之赐 (重生术师's, after it falls): physical and arts damage taken −90 %
defEnemy('5050_dqomg', { init(u, T) { addBuff(u, { id: 'gift', t: Infinity, dr: T['dmg_res.damage_resistance'] }); } });
// 巨大雪球投手: the first throw, ATK × 150 % on the target's cross of 5 tiles
defEnemy('15002_dqwing', { attack(W, u, tg, a) { if (!u.atkN) { a.mult = u.f.talents['FirstAttack.attack@first_atk_scale']; a.o.area = { id: 'x-5' }; } } });
// 失业萨克斯手 宣泄怨气 (FourDirAttack, init 10, every 20 s): plays, then sends its grudge up, down, left and right; each
// hits the first enemy on its line for ATK × 150 % physical (the wind-up's length is not given: 1 s)
defEnemy('15003_dqltsw', {
  init(u, T, SK) { clocks(u, SK, ['FourDirAttack']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'FourDirAttack')) return;
    const line = (v) => Math.abs(v.y - u.y) <= 0.5 || Math.abs(v.x - u.x) <= 0.5;
    if (!foesOf(W, u).some(line)) return;
    chan(W, u, { key: 'FourDirAttack', dur: 1, end: () => {
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const on = foesOf(W, u).map((v) => [(v.x - u.x) * ax + (v.y - u.y) * ay, Math.abs((v.x - u.x) * ay + (v.y - u.y) * ax), v]).filter((x) => x[0] > 0 && x[1] <= 0.5).sort((p, q) => p[0] - q[0]);
        if (on.length) hit(W, u, on[0][2], SK.FourDirAttack.bb.atk_scale, { phys: true });
      }
      W.events.push(['fourdir', u]);
    }, after: (W2, v) => { v.clk.FourDirAttack = SK.FourDirAttack.cd; } });
  },
});
// 狂躁珊瑚: each hit that does damage, ATK +15 % (15 stacks at most); 3.5 s after its last attack the stacks go, 2 a second
defEnemy('15005_dqdsbs', {
  hit(W, a, b, dealt) { const T = a.f.talents; if (dealt > 0) stackBuff(a, 'coral', { atk: T['AtkUp.atk'] }, T['AtkUp.max_stack_cnt']); },
  step(W, u) {
    const b = u.buffs.find((x) => x.id === 'coral');
    if (!b || W.n - (u.lastAtkN || 0) < 105 || (W.n - u.lastAtkN - 105) % 15 !== 0) return;
    if (b.n <= 1) dropBuff(u, 'coral'); else addBuff(u, { ...b, n: b.n - 1, atk: b.atk / b.n * (b.n - 1) });
  },
});
// 点灯骑士 微光之触 (ChargeAttack, init 10, every 25 s): 7 s charging at a spot, then ATK × 250 % arts on the enemies in
// the x-1 shape around it (a diamond of radius 2)
defEnemy('15010_dqcadk', {
  init(u, T, SK) { clocks(u, SK, ['ChargeAttack']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'ChargeAttack')) return;
    const S = SK.ChargeAttack.bb, tg = bestFoes(W, u, 1, S.range_radius)[0];
    if (!tg) return;
    const cx = tileX(tg.x), cy = tileY(tg.y);
    chan(W, u, { key: 'ChargeAttack', tgt: tg, free: true, dur: S.duration, end: () => {
      for (const v of foesOf(W, u)) if (inShape('x-1', cx, cy, v)) hit(W, u, v, S.atk_scale, { arts: true });
      W.events.push(['area', u, { x: cx + 0.5, y: cy + 0.5, id: 'x-1' }]);
    }, after: (W2, v) => { v.clk.ChargeAttack = SK.ChargeAttack.cd; } });
  },
});
// 重生术师: its arts bolt jumps on to up to 4 enemies (each within 1.6 of the last, × 0.85 a jump), each hit adding 凋亡
// (ATK × 30 %); after it falls, 大君之赐 rises in its place (deathSpawn)
defEnemy('15016_dqdkma', { attack(W, u, tg, a) { const T = u.f.talents; a.o.chain = { n: T['epdamage.attack@max_target'], r: T['epdamage.attack@projectile_range'], k: T['epdamage.attack@chain.atk_scale'] }; } });
// 凋零萨卡兹: attacks add 凋亡 (ATK × 25 %); 凋零 (DeathEye, init 10, every 24 s): 8 s on one enemy, ATK × 40 % arts a
// second, then 凋亡 of ATK × 220 %
defEnemy('15017_dqdwlo', {
  init(u, T, SK) { clocks(u, SK, ['DeathEye']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'DeathEye')) return;
    const tg = bestFoes(W, u, 1)[0], S = SK.DeathEye.bb;
    if (tg) chan(W, u, { key: 'DeathEye', tgt: tg, dur: S.hit_duration, every: 1, tick: (W2, v, c) => { hit(W, v, c.tgt, S.atk_scale, { arts: true, noTalent: true }); },
      end: (W2, v, c) => { elem(W, c.tgt, 'apo', atkOf(v) * S.ep_damage_ratio); }, after: (W2, v) => { v.clk.DeathEye = SK.DeathEye.cd; } });
  },
});
// “门”: as it falls, one enemy is taken off the field with it (PRTS: 消灭一个敌对单位, drawn at random; no reborn)
defEnemy('15018_dqskzc', { die(W, b) { const fs = foesOf(W, b); if (fs.length) { const v = fs[Math.floor(W.rng() * fs.length)]; W.events.push(['door', v, b]); fall(W, v, true); } } });
// 大喷蛛 喷蛛 (SummonToken, init 5, every 5 s): one 畸变赘生物 where it stands; four as it falls (deathSpawn)
defEnemy('15019_dqharc', {
  init(u, T, SK) { clocks(u, SK, ['SummonToken']); },
  step(W, u, T, SK) { if (clkReady(u, 'SummonToken')) { u.clk.SummonToken = SK.SummonToken.cd; for (let i = 0; i < SK.SummonToken.bb.cnt; i++) spawnUnit(W, SK.SummonToken.bb.enemy_key, u.side, u.x, u.y, null); u.skillSeq++; } },
});
// 超级洗地机: the first damage taken, attack speed +150 and move speed +150 % for 30 s
defEnemy('15021_dqdurg', { hurt(W, b) { const T = b.f.talents; if (!b.raged) { b.raged = true; addBuff(b, { id: 'rage', t: T['Rage.duration'], aspd: T['Rage.attack_speed'], ms: T['Rage.move_speed'] }); } } });
// 玻璃球打手: a barrier against arts (3334 × 3); DEF +1750 while it holds; once broken, move speed +200 %
defEnemy('15027_dqmtrs', {
  init(u, T) { u.barrier = T['shield.dynamic'] * BARRIER_K; u.barrierArts = true; addBuff(u, { id: 'shield', t: Infinity, def: T['shield.def'] }); },
  unshield(W, u) { dropBuff(u, 'shield'); addBuff(u, { id: 'speedup', t: Infinity, ms: u.f.talents['speedup.move_speed'] }); },
});
// 假酒海盗: comes in with a keg at 300 % move speed; the first enemy within 0.8 takes the keg — ATK × 280 % physical — and
// leaves a spot of radius 1.5 for 30 s where its teammates get attack speed +100 and 80 % physical dodge
defEnemy('15031_dqhlti', {
  init(u, T) { u.keg = true; addBuff(u, { id: 'keg', t: Infinity, msMul: T['1.move_speed'] }); },
  step(W, u, T, SK) {
    if (!u.keg) return;
    const v = foesOf(W, u).map((x) => [dist(x.x - u.x, x.y - u.y), x]).filter((x) => x[0] <= 0.8).sort((p, q) => p[0] - q[0])[0];
    if (!v) return;
    const S = SK.BlockedBoom.bb;
    u.keg = false; dropBuff(u, 'keg'); u.skillSeq++;
    hit(W, u, v[1], S.blockee_atk_scale, { phys: true });
    ground(W, { kind: 'rum', x: v[1].x, y: v[1].y, r: 1.5, side: u.side, t: S.fixed_duration, tick: (W2, g) => {
      for (const a of W.units) if (live(a) && a.side === g.side && onGround(g, a)) addBuff(a, { id: 'rum', t: 2 * DT, aspd: S.attack_speed, dodge: S.prob });
    } });
  },
});
// 虹吸巨刃: three targets at once; heals 150 % of the damage it deals
defEnemy('15040_dqrdmn', {
  attack(W, u, tg, a) { a.tgts = enemiesInReach(W, u, tg, u.f.talents['vampire.attack@max_target']); },
  hit(W, a, b, dealt) { if (dealt > 0) a.hp = Math.min(a.maxHp, a.hp + dealt * a.f.talents['vampire.heal_scale']); },
});
// “配重投石机” 超晕眩击 (StunAttack, init 13, every 13 s): a boulder at the nearest enemy within 2.5 not stunned, ATK × 70 %
// physical and stunned 25 s
defEnemy('15043_dqrckm', {
  init(u, T, SK) { clocks(u, SK, ['StunAttack']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'StunAttack')) return;
    const v = foesOf(W, u).filter((x) => !(x.stun > 0) && dist(x.x - u.x, x.y - u.y) <= 2.5).map((x) => [dist(x.x - u.x, x.y - u.y), x]).sort((p, q) => p[0] - q[0])[0];
    if (!v) return;
    u.clk.StunAttack = SK.StunAttack.cd; u.skillSeq++;
    W.shots.push({ src: u, tgt: v[1], x: u.x, y: u.y, mult: SK.StunAttack.bb.atk_scale, o: { phys: true, stun: SK.StunAttack.bb.stun }, g: null, delay: 0, rock: true });
  },
});
// 无德决斗家: its one round (SP 1): ATK × 150 % arts, and the target can neither attack nor use skills for 15 s
defEnemy('15045_dqrbty', {
  attack(W, u, tg, a) {
    if (u.sp < 1) return;
    const T = u.f.talents;
    u.sp--; a.skill = true; a.mult = T['shotbuff.attack@headshot_atk_scale']; a.o.arts = true; a.o.disarm = T['shotbuff.attack@headshot_disarmed_duration'];
  },
});
// 变异食肉植物 吞噬: swallows (takes off the field) the first enemy within 1.0, then 20 s digesting — nothing else
defEnemy('15047_dqwlpl', {
  init(u) { u.passive = true; },
  step(W, u) {
    if (u.noAtk > 0) return;
    const v = foesOf(W, u).map((x) => [dist(x.x - u.x, x.y - u.y), x]).filter((x) => x[0] <= 1).sort((p, q) => p[0] - q[0])[0];
    if (!v) return;
    W.events.push(['eat', v[1], u]); fall(W, v[1], true);
    const t = u.f.skillData.Eat.bb.duration;
    u.noAtk = t; u.root = t; u.skillSeq++;
  },
});
// 高敏感积藏者 应激分裂: below half HP (once), one more of it (that cannot split) at the same HP share, within 0.3 around
defEnemy('15048_dqdivi', {
  hurt(W, b) {
    if (b.noSplit || b.split || b.hp >= b.maxHp * b.f.talents['0.hp_ratio'] || b.hp <= 0) return;
    b.split = true;
    const r = b.hp / b.maxHp;
    spawnUnit(W, b.f.key, b.side, tileX(b.x) + 0.5 + (W.rng() * 2 - 1) * 0.3, tileY(b.y) + 0.5 + (W.rng() * 2 - 1) * 0.3, (v) => { v.noSplit = true; v.hp = v.maxHp * r; });
  },
});
// “巢穴”: grows from the start, over 30 s to max HP +400 % and ATK +80 %, until it first deals or takes damage
defEnemy('15051_dqxjl', {
  init(u) { u.grow = true; u.hp0 = u.maxHp; u.age = 0; },
  step(W, u, T) {
    if (!u.grow) return;
    u.age++;
    const g = Math.min(1, u.age / (T['growth.time'] * HZ)), m = u.hp0 * (1 + T['growth.add_max_hp_ratio'] * g);
    u.hp = u.hp / u.maxHp * m; u.maxHp = m;
    addBuff(u, { id: 'grow', t: Infinity, atk: T['growth.add_atk_ratio'] * g });
  },
});
// 狂躁觅食兽: comes in charging — every 0.333 s after the first 3 s, move speed +33.3 % (30 tries); a stun or freeze
// empties it and the 3 s start over. Charging, its first hit adds (move speed × 700) physical and ends the charge; moving,
// it rams the enemies it meets within 0.5 for (move speed × 700) physical. (Move speed: its own, 0.35 × the buffs.)
defEnemy('15052_dqboar', {
  init(u) { u.boar = { s: 0, tries: 0 }; u.rammed = new Set(); },
  stunned(W, u) { if (u.boar) { u.boar.s = 0; dropBuff(u, 'boar'); } },
  step(W, u, T) {
    const B = u.boar, ms = u.f.ms * (1 + u.bMs) * u.bMsMul;
    if (B) {
      B.s++;
      const pre = Math.round(T['Rush.mhboar_t_predelay.predelay'] * HZ), iv = Math.round(T['Rush.mhboar_t[trigger].interval'] * HZ);
      if (B.s > pre && (B.s - pre) % iv === 0 && B.tries < T['Rush.mhboar_t[trigger].trig_cnt']) { B.tries++; stackBuff(u, 'boar', { ms: T['Rush.mhboar_t[trigger].move_speed'] }, Infinity); }
    }
    if (u.state !== 'move') { u.rammed.clear(); return; }
    for (const v of foesOf(W, u)) {
      const near = dist(v.x - u.x, v.y - u.y) <= 0.5;
      if (near && !u.rammed.has(v)) { u.rammed.add(v); strike(W, v, physOf(T['Crash.atk_scale'] * ms, v), u, 'phys'); }
      else if (!near) u.rammed.delete(v);
    }
  },
  hit(W, a, b, dealt) {
    if (!a.boar || !(dealt > 0)) return;
    const ms = a.f.ms * (1 + a.bMs) * a.bMsMul;
    a.boar = null; dropBuff(a, 'boar');
    strike(W, b, physOf(a.f.talents['FirstAttack.atk_scale'] * ms, b), a, 'phys');
  },
});
// the weak sides: 勇敢的壳 / 荒原刺背兽 weak in front (from behind −80 % / −75 %), 石头脑袋 weak behind (from the front −80 %)
defEnemy('15053_dqtrtl 15054_dqprpn', { init(u, T) { u.weak = { front: true, dr: T['Weakness.damage_resistance'] }; } });
defEnemy('15055_dqrhcr', { init(u, T) { u.weak = { front: false, dr: T['Weakness.damage_resistance'] }; } });
// 荒原刺背兽: each 12 % of its max HP lost, ATK × 240 % physical on every enemy within 2.8 behind it
defEnemy('15054_dqprpn', {
  hurt(W, b) {
    const T = b.f.talents, k = Math.floor((b.maxHp - Math.max(0, b.hp)) / (b.maxHp * T['QuillSpray.hp_ratio']));
    while ((b.quill || 0) < k) {
      b.quill = (b.quill || 0) + 1;
      for (const v of foesOf(W, b)) if ((v.x - b.x) * b.facing <= 0 && dist(v.x - b.x, v.y - b.y) <= T['QuillSpray.range_radius']) hit(W, b, v, T['QuillSpray.atk_scale'], { phys: true, noTalent: true });
      W.events.push(['quill', b]);
    }
  },
});
// 勤奋的钻头: at half HP, attack speed +100, move speed +100 %, and no more stuns or freezes (handbook)
defEnemy('15057_dqmram', { step(W, u, T) { if (!u.raged && u.hp <= u.maxHp * 0.5) { u.raged = true; u.ccImmune = true; addBuff(u, { id: 'rage', t: Infinity, aspd: T['Rage.attack_speed'], ms: T['Rage.move_speed'] }); } } });
// 改装排污车: reach 4.0 while its 污秽喷射 is charged (SP_SKILL PollutedRangedAtk)
defEnemy('15058_dqtank', { step(W, u, T, SK) { u.reach = u.sp >= SK.PollutedRangedAtk.sp ? SK.PollutedRangedAtk.bb.range_radius : u.f.range; } });
// 覆面大锤客: a barrier against arts (2000 × 3); while it holds, max HP +50 % and attack speed +50
defEnemy('15059_dqhmmr', {
  init(u, T) { u.barrier = T['shield.dynamic'] * BARRIER_K; u.barrierArts = true; u.maxHp *= 1 + T['shield.max_hp']; addBuff(u, { id: 'shield', t: Infinity, aspd: T['shield.attack_speed'] }); },
  unshield(W, u) { dropBuff(u, 'shield'); u.maxHp = u.f.hp * ENV.hpMul; u.hp = Math.min(u.hp, u.maxHp); },
});
// 街头乐队贝斯手 / 吉他手 Free Bird (RockYou, init 0, every 10 s after it): 15 s on one enemy in reach, 150 / 200 arts a
// second, each that does damage adding 80 灼燃
defEnemy('15066_dqdudu 15067_dqdidi', {
  init(u, T, SK) { clocks(u, SK, ['RockYou']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'RockYou')) return;
    const tg = bestFoes(W, u, 1)[0], S = SK.RockYou.bb;
    if (tg) chan(W, u, { key: 'RockYou', tgt: tg, dur: 15, every: S.hit_interval, tick: (W2, v, c) => { if (strike(W, c.tgt, artsOf(S.dot_value, c.tgt), v, 'arts') > 0) elem(W, c.tgt, 'burn', S.dot_ep_value); }, after: (W2, v) => { v.clk.RockYou = SK.RockYou.cd; } });
  },
});
// 极饿先锋: its first attack swallows the target outright (no reborn); then DEF +700, move speed −30 %
defEnemy('15079_dqkodo', {
  attack(W, u, tg, a) {
    if (u.ate) return;
    const T = u.f.talents;
    u.ate = true; a.skill = true; a.none = true;
    W.events.push(['eat', tg, u]); fall(W, tg, true);
    addBuff(u, { id: 'full', t: Infinity, def: T['Stronger.def'], ms: T['Stronger.move_speed'] });
  },
});
// 龙卷风忍者 漩涡形态 (SwitchModeTrigger, init 10, every 60 s, paused while it spins): spins 60 s — no normal attacks, ATK
// × 120 % physical a second on every enemy within 1.0
defEnemy('15080_dqgtop', {
  init(u, T, SK) { clocks(u, SK, ['SwitchModeTrigger']); },
  step(W, u, T, SK) {
    if (u.spin > 0) {
      u.spin--;
      if (u.spin % HZ === 0) { for (const v of foesOf(W, u)) if (dist(v.x - u.x, v.y - u.y) <= T['RotateDamage.attack@range_radius']) hit(W, u, v, T['RotateDamage.attack@atk_scale'], { phys: true }); W.events.push(['spin', u]); }
      if (!u.spin) { u.clkHold = false; u.clk.SwitchModeTrigger = SK.SwitchModeTrigger.cd; }
      return;
    }
    if (clkReady(u, 'SwitchModeTrigger')) { u.spin = Math.round(T['EndRotate.rotate_duration'] * HZ); u.clkHold = true; u.skillSeq++; }
  },
});
// “睡眠不足”: a charged shot (ChargeAttack, init 10, every 60 s): 5 s on one enemy, then ATK × 200 % arts
defEnemy('15081_dqmage', {
  init(u, T, SK) { clocks(u, SK, ['ChargeAttack']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'ChargeAttack')) return;
    const tg = bestFoes(W, u, 1)[0], S = SK.ChargeAttack.bb;
    if (tg) chan(W, u, { key: 'ChargeAttack', tgt: tg, dur: S.duration, end: (W2, v, c) => { hit(W, v, c.tgt, S.atk_scale, { arts: true }); }, after: (W2, v) => { v.clk.ChargeAttack = SK.ChargeAttack.cd; } });
  },
});
// 匪帮欢乐船: 嘲讽等级 +1; moving, it rams each ground enemy that comes within 0.9 (ATK × 100 % physical); 0.8 s after it
// falls, a 过气水手 (deathSpawn)
defEnemy('15083_dqymot', {
  init(u) { u.rammed = new Set(); },
  step(W, u, T) {
    if (u.state !== 'move') { u.rammed.clear(); return; }
    for (const v of foesOf(W, u)) {
      const near = !v.f.fly && dist(v.x - u.x, v.y - u.y) <= 0.9;
      if (near && !u.rammed.has(v)) { u.rammed.add(v); hit(W, u, v, T['Crash.atk_scale'], { phys: true, noTalent: true }); }
      else if (!near) u.rammed.delete(v);
    }
  },
});
// 易爆种子: after its attack, it bursts (falls) unless stunned
defEnemy('15084_dqhfly', { fired(W, u) { if (!(u.stun > 0)) { hurt(W, u, u.hp, null, false); } } });
// 止戈者: four broken blades, ATK +70 % while it has any; each attack spends one, and spending the last it attacks again
defEnemy('15085_dqji', {
  init(u, T) { u.blades = T['DeadSpawn.cnt']; },
  attack(W, u, tg, a) { if (u.blades > 0) { u.blades--; a.mult = 1 + u.f.talents['Atkup.atk']; if (!u.blades) a.again = true; } },
});
// 速胜卫士 / “交通亭”量产型: each hit taken, DEF −50 and RES −2 / −1 (80 / 110 stacks)
defEnemy('15086_dqcbld', { hurt(W, b, dmg, src, discrete) { const T = b.f.talents, n = T['def_reduce.max_stack_cnt']; if (discrete) stackBuff(b, 'erode', { def: T['def_reduce.def'] / n, res: T['def_reduce.magic_resistance'] / n }, n); } });
defEnemy('15088_dqterm', {
  hurt(W, b, dmg, src, discrete) { const T = b.f.talents, n = T['passive.max_stack_cnt']; if (discrete) stackBuff(b, 'erode', { def: T['passive.def'] / n, res: T['passive.magic_resistance'] / n }, n); },
  // 1 s after it falls: ATK × 200 % physical within 1.25, and out pops a 速胜卫士 (deathSpawn)
  die(W, b) {
    const a = atkOf(b) * b.f.talents['Boom.atk_scale'], x = b.x, y = b.y;
    after(W, 1, () => { for (const v of W.units) if (live(v) && v.side !== b.side && dist(v.x - x, v.y - y) <= 1.25) strike(W, v, physOf(a, v), b, 'phys'); W.events.push(['boom', b]); });
  },
});
// 神拳机甲 超负载神拳 (Punch, init 0, every 20 s after it): 10 s on one enemy in reach, a punch a second: ATK × 75 %
// physical and stunned 2 s
defEnemy('15089_dqbgpa', {
  init(u, T, SK) { clocks(u, SK, ['Punch']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'Punch')) return;
    const tg = bestFoes(W, u, 1)[0], S = SK.Punch.bb;
    if (tg) chan(W, u, { key: 'Punch', tgt: tg, dur: S.duration, every: 1, tick: (W2, v, c) => { hit(W, v, c.tgt, S.atk_scale, { phys: true, stun: S.stun }); }, after: (W2, v) => { v.clk.Punch = SK.Punch.cd; } });
  },
});
// 神射机甲: four targets at once, ATK × 50 % physical each
defEnemy('15090_dqacpa', { attack(W, u, tg, a) { a.tgts = enemiesInReach(W, u, tg, 4); a.mult = u.f.talents['Passive.attack@ranged.atk_scale']; } });
// 度假区越野车 载客: at the start it takes up to 3 teammates within its reach (not 领袖, not machines, on the ground) on
// board, off the field; they get off around it when it first attacks, or as it falls
function unload(W, u) {
  if (!u.riders || !u.riders.length) return;
  for (const v of u.riders) { v.x = clamp(u.x + (W.rng() * 2 - 1) * 0.2, 0.1, AW - 0.1); v.y = clamp(u.y + (W.rng() * 2 - 1) * 0.2, 0.1, AH - 0.1); W.born.push(v); }
  u.riders = [];
  W.events.push(['unload', u]);
}
defEnemy('15091_dqbus', {
  enter(W, u) {
    const ok = (v) => v.side === u.side && v !== u && live(v) && v.f.levelType !== 'BOSS' && !(v.f.tags || []).includes('machine') && !v.f.fly && !v.giant && !v.f.group && dist(v.x - u.x, v.y - u.y) <= u.reach;
    u.riders = W.units.filter((v) => ok(v) && !W.units.some((b) => b !== u && b.riders && b.riders.includes(v))).map((v) => [dist(v.x - u.x, v.y - u.y), v]).sort((p, q) => p[0] - q[0]).slice(0, u.f.talents['Bus.max_cnt']).map((x) => x[1]);
    if (u.riders.length) W.units = W.units.filter((v) => !u.riders.includes(v));
  },
  pre(W, u) { unload(W, u); },
  die(W, b) { unload(W, b); },
});
// 圣徒卡门: 3 rounds; while it has one, each attack is a 手炮 (Fire): ATK × 200 % physical, one round. Every 35 s, with
// none left, it reloads: rooted, no attacks, a round each 2 s (one stunned in between is lost) up to 3; a stun while
// reloading ends it and stuns it 10 s more
defEnemy('15092_dqudg', {
  init(u, T) { u.reloadT = T['Reload.interval']; },
  attack(W, u, tg, a) { if (u.sp >= 1) { u.sp--; a.skill = true; a.mult = u.f.skillData.Fire.bb.atk_scale; a.o.phys = true; } },
  stunned(W, u) { if (u.reloading) { u.reloading = false; u.root = 0; u.noAtk = 0; u.stun = Math.max(u.stun, u.f.talents['Stun.stun']); } },
  step(W, u, T) {
    if (u.reloading) {
      if (++u.reloadN % (2 * HZ) === 0) { u.sp++; u.skillSeq++; }
      if (u.sp >= u.f.spData.max) { u.reloading = false; u.root = 0; u.noAtk = 0; } else { u.root = 1; u.noAtk = 1; }
      return;
    }
    u.reloadT -= DT;
    if (u.reloadT > EPS) return;
    u.reloadT = T['Reload.interval'];
    if (u.sp <= 0) { u.reloading = true; u.reloadN = 0; u.root = 1; u.noAtk = 1; }
  },
});
// ---- GIANTS: 绿藤城's leaders (PRTS 争锋频道/选手信息/领袖) ---------------------------------------------------------------
// 岁相 and “萨米的意志” are 巨型单位 that only come on the left. The client spawns a giant at one point of its own
// (EnemyDuelWaveManager.m_giantEnemySpawnPosition, not in the data); recordings of the event show 岁相 inside the field
// right of the red gate, its body over the back rows. Here: the middle row, the third tile right of the gate (GIANT_AT).
// A giant occupies a rectangle around that point, as PRTS gives its body (GIANT_BOX): 岁相 3.95 × 4.95 tiles, 0.5 left
// and 2 up (toward the back) of it; 萨米 2.95 × 2.95, 1 up. Nobody walks into that body; it is fought from its edges. A
// giant never moves and reaches the whole field. The others walk like anyone: the 协同 groups enter whole
// (data/fighters.json group), 侠客三人行 (玉双剑) with 枣大刀 and 炭长矛, 并驾骑士 with 凋零骑士, 调停的意志 (凯尔希) with
// Mon2tr. What only matters past the battle's 200 s (岁相 / 萨米 wreck the stage after 540 / 600 s) is left out, so is the
// 开局偷刀 the event's notes call a fault.
const GIANT = new Set(['enemy_15068_dqsui', 'enemy_15069_dqdeer']);
const GIANT_AT = [3.5, AH / 2];
const GIANT_BOX = { enemy_15068_dqsui: { w: 3.95, h: 4.95, dx: -0.5, dy: -2 }, enemy_15069_dqdeer: { w: 2.95, h: 2.95, dx: 0, dy: -1 } };
// 岁相: two targets at once, physical, an attack every 3.267 s whatever its attack speed.
//   远山惊雷 (ThunderS3, init 10, every 30 s): the (up to) 3 enemies nearest it each get a 21 s field of thunder on their
//     tile's cross of 5, ATK × 20 % arts every 1.5 s on everyone in it.
//   天坠 (PowerSlashS3, init 5, every 18 s): the nearest enemy: ATK × 120 % physical twice, then for 15 s ATK × 25 % arts
//     a second, the share +25 % after every third.
//   十方吐纳 (DragonBreath, init 30, every 30 s): 7 s of dragon's breath along the rows of its body, everything right of
//     it: ATK × 50 % arts and 50 % physical a second, double on each row's first (leftmost) enemy (the tick, once a
//     second, is not given).
//   From a source in the columns of its body but above or below it, damage × 50 % (Bristleback, PRTS).
defEnemy('15068_dqsui', {
  init(u, T, SK) { u.fixedIv = 3.267; u.ranged = false; clocks(u, SK, ['ThunderS3', 'PowerSlashS3', 'DragonBreath']); },
  attack(W, u, tg, a) { a.tgts = enemiesInReach(W, u, tg, 2); a.o.phys = true; },
  step(W, u, T, SK) {
    const near = () => foesOf(W, u).map((v) => [gap(v, u), v]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
    if (clkReady(u, 'DragonBreath')) {
      u.clk.DragonBreath = SK.DragonBreath.cd;
      const S = SK.DragonBreath.bb;
      chan(W, u, { key: 'DragonBreath', dur: S.anim_duration, every: 1, tick: () => {
        const B = boxOf(u), r0 = tileY(B.y0 + 0.01), r1 = tileY(B.y1 - 0.01), inBreath = (v) => tileY(v.y) >= r0 && tileY(v.y) <= r1 && v.x > B.x1;
        const first = new Set();
        for (let r = r0; r <= r1; r++) { const row = foesOf(W, u).filter((v) => inBreath(v) && tileY(v.y) === r).sort((p, q) => p.x - q.x); if (row.length) first.add(row[0]); }
        for (const v of foesOf(W, u)) {
          if (!inBreath(v)) continue;
          const k = first.has(v) ? 2 : 1;
          hit(W, u, v, S.atk_scale * k, { arts: true, noTalent: true }); hit(W, u, v, S.atk_scale_ex * S.atk_scale * k, { phys: true, noTalent: true });
        }
        W.events.push(['breath', u]);
      } });
      return;
    }
    if (clkReady(u, 'ThunderS3')) {
      const S = SK.ThunderS3.bb, ts = near().slice(0, 3);
      if (ts.length) {
        u.clk.ThunderS3 = SK.ThunderS3.cd; u.skillSeq++;
        for (const v of ts) ground(W, { kind: 'thunder', x: v.x, y: v.y, id: 'x-5', side: u.side, t: S.projectile_life_time, every: 1.5, tick: (W2, g) => {
          for (const x of foesOf(W, u)) if (onGround(g, x)) hit(W, u, x, S.atk_scale, { arts: true, noTalent: true });
        } });
      }
    }
    if (clkReady(u, 'PowerSlashS3')) {
      const S = SK.PowerSlashS3.bb, v = near()[0];
      if (v) {
        u.clk.PowerSlashS3 = SK.PowerSlashS3.cd; u.skillSeq++;
        hit(W, u, v, S.atk_scale, { phys: true }); hit(W, u, v, S.atk_scale, { phys: true });
        W.events.push(['slash', v, u]);
        for (let i = 1; i <= S.duration; i++) after(W, i, () => { if (live(v)) hit(W, u, v, S.atk_scale_init + S.atk_scale_add * Math.floor((i - 1) / S.times), { arts: true, noTalent: true }); });
      }
    }
  },
});
// “萨米的意志”: its attack (every 6 s) drops icicles down the target's column, one a tile from the top every 0.2 s, ATK ×
//   100 % physical on whoever stands there; below half HP, physical / arts damage taken −60 % and a second column (another
//   enemy's). 自然涌动 (Lasso, init 40, every 60 s): one enemy (two below half HP), stunned and ATK × 20 % arts a second,
//   10 s.
function icicles(W, u, col) {
  for (let r = 0; r < AH; r++) after(W, 0.2 * r + EPS, () => { for (const v of foesOf(W, u)) if (tileX(v.x) === col && tileY(v.y) === r) hit(W, u, v, 1, { phys: true }); });
  W.events.push(['icicle', u, { col }]);
}
defEnemy('15069_dqdeer', {
  init(u, T, SK) { u.ranged = false; clocks(u, SK, ['Lasso']); },
  attack(W, u, tg, a) {
    a.none = true;
    const cols = [tileX(tg.x)];
    if (u.mad) { const o = bestFoes(W, u, 99).find((v) => tileX(v.x) !== cols[0]); if (o) cols.push(tileX(o.x)); }
    for (const c of cols) icicles(W, u, c);
  },
  step(W, u, T, SK) {
    if (!u.mad && u.hp < u.maxHp * 0.5) { u.mad = true; addBuff(u, { id: 'mad', t: Infinity, dr: T['Madness.damage_resistance'] }); }
    if (!clkReady(u, 'Lasso')) return;
    const S = SK.Lasso.bb, ts = drawN(foesOf(W, u), u.mad ? T['Madness.enemy_smdeer_mad[skill].max_target'] : S.max_target, W.rng);
    if (!ts.length) return;
    u.clk.Lasso = SK.Lasso.cd; u.skillSeq++;
    for (const v of ts) {
      disable(W, v, S.projectile_life_time, 'stun');
      for (let i = 1; i <= S.projectile_life_time; i++) after(W, i, () => { if (live(v)) hit(W, u, v, S.atk_scale, { arts: true, noTalent: true }); });
    }
  },
});
// 侠客三人行 (玉双剑): while it stands, it, 炭长矛 and 枣大刀 take physical / arts damage × 60 %; 以德服人 (FirstAid, init 15,
//   every 15 s): heals the one of the three lowest in HP share by ATK × 500 % and shakes off its stun / cold.
// 枣大刀 单刀赴会 (WindMove, init 0, every 20 s): 2 s (4 s while 玉双剑 stands) of whirling its blade — no normal
//   attacks, move speed +200 %, ATK × 80 % physical a second on every enemy within 1.2 (not while stunned).
const TRIO = ['enemy_15072_dqlbgg', 'enemy_15070_dqhlgy', 'enemy_15071_dqyrzf'];
defEnemy('15072_dqlbgg', {
  init(u, T, SK) { clocks(u, SK, ['FirstAid']); },
  step(W, u, T, SK) {
    for (const v of W.units) if (live(v) && v.side === u.side && TRIO.includes(v.f.key) && !hasBuff(v, 'trio')) addBuff(v, { id: 'trio', t: Infinity, dr: T['GlobalDyBuff.damage_resistance'] });
    if (!clkReady(u, 'FirstAid')) return;
    u.clk.FirstAid = SK.FirstAid.cd; u.skillSeq++;
    const v = W.units.filter((x) => live(x) && x.side === u.side && TRIO.includes(x.f.key)).sort((p, q) => p.hp / p.maxHp - q.hp / q.maxHp)[0];
    if (!v) return;
    v.hp = Math.min(v.maxHp, v.hp + atkOf(u) * SK.FirstAid.bb.heal_scale); v.stun = 0; v.cold = 0;
    W.events.push(['heal', v, u]);
  },
  die(W, b) { if (!W.units.some((v) => v !== b && live(v) && v.side === b.side && v.f.key === b.f.key)) for (const v of W.units) if (v.side === b.side) dropBuff(v, 'trio'); },
});
defEnemy('15070_dqhlgy', {
  init(u, T, SK) { clocks(u, SK, ['WindMove']); },
  step(W, u, T, SK) {
    if (u.spin > 0) {
      u.spin--;
      if (u.spin % HZ === 0 || !u.spin) { for (const v of foesOf(W, u)) if (dist(v.x - u.x, v.y - u.y) <= T['WindDamage.range_radius']) hit(W, u, v, T['WindDamage.atk_scale'], { phys: true, noTalent: true }); W.events.push(['spin', u]); }
      if (!u.spin) dropBuff(u, 'wind');
      return;
    }
    if (!clkReady(u, 'WindMove')) return;
    const S = SK.WindMove.bb, jade = W.units.some((v) => live(v) && v.side === u.side && v.f.key === TRIO[0]);
    u.clk.WindMove = SK.WindMove.cd; u.skillSeq++;
    u.spin = Math.round((jade ? S.lb_duration : S.duration) * HZ);
    addBuff(u, { id: 'wind', t: Infinity, ms: S.move_speed });
  },
});
// 并驾骑士: its blows land on the target's cross of 5; 蓄力锤 (ChargeAttack, init 22, every 22 s): 4 s charging, then ATK ×
//   300 % physical on the target's cross of 5. 凋零骑士: two targets at once; 爆炸箭 (TripleAttack, init 22, every 22 s): up to
//   3 enemies, each blowing up 2.5 s later, ATK × 160 % arts on its cross of 5. When one of the two falls, the other:
//   ATK +80 %, attack speed +100, move speed +150 %.
const KNIGHTS = ['enemy_15073_dqkght', 'enemy_15074_dqdght'];
const knightRage = {
  death(W, u, d) {
    if (u.raged || d.side !== u.side || !KNIGHTS.includes(d.f.key) || d.f.key === u.f.key) return;
    const T = u.f.talents;
    u.raged = true; addBuff(u, { id: 'rage', t: Infinity, atk: T['triggerrage.atk'], aspd: T['triggerrage.attack_speed'], ms: T['triggerrage.move_speed'] });
  },
};
defEnemy('15073_dqkght', {
  ...knightRage,
  init(u, T, SK) { clocks(u, SK, ['ChargeAttack']); },
  attack(W, u, tg, a) { a.o.area = { id: u.f.talents['aoe.attack@dekght[aoe].range_id'], mult: u.f.talents['aoe.attack@dekght[aoe].atk_scale'] }; },
  step(W, u, T, SK) {
    if (!clkReady(u, 'ChargeAttack')) return;
    const tg = bestFoes(W, u, 1)[0], S = SK.ChargeAttack.bb;
    if (tg) chan(W, u, { key: 'ChargeAttack', tgt: tg, dur: S.duration, end: (W2, v, c) => { land(W, v, c.tgt, S.atk_scale, { phys: true, area: { id: S['dekght[aoe].range_id'] } }); }, after: (W2, v) => { v.clk.ChargeAttack = SK.ChargeAttack.cd; } });
  },
});
defEnemy('15074_dqdght', {
  ...knightRage,
  init(u, T, SK) { clocks(u, SK, ['TripleAttack']); },
  attack(W, u, tg, a) { a.tgts = enemiesInReach(W, u, tg, 2); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'TripleAttack')) return;
    const ts = bestFoes(W, u, 3), S = SK.TripleAttack.bb;
    if (!ts.length) return;
    u.clk.TripleAttack = SK.TripleAttack.cd; u.skillSeq++;
    for (const v of ts) {
      W.events.push(['mark', v, u]);
      after(W, S['dekght_2[aoe].interval'], () => {
        const cx = tileX(v.x), cy = tileY(v.y);
        for (const x of foesOf(W, u)) if (inShape(S['dekght_2[aoe].range_id'], cx, cy, x)) hit(W, u, x, S['dekght_2[aoe].atk_scale'], { arts: true, noTalent: true });
        W.events.push(['area', u, { x: cx + 0.5, y: cy + 0.5, id: S['dekght_2[aoe].range_id'] }]);
      });
    }
  },
});
// 调停的意志 (凯尔希): below half HP (once) it trades places with Mon2tr; both hold their attacks 5 s and Mon2tr strikes
//   about it, ATK × 100 % physical within 2 and stunned 5 s — as it does when it falls (handbook).
function m3Boom(W, m) {
  const S = FIGHTER['enemy_15076_dqzmst'].skillData.Boom.bb;
  for (const v of foesOf(W, m)) if (dist(v.x - m.x, v.y - m.y) <= S.range_radius) hit(W, m, v, S.atk_scale, { phys: true, stun: S.boom_duration, noTalent: true });
  W.events.push(['boom', m]);
}
defEnemy('15075_dqzklz', {
  hurt(W, b) {
    if (b.swapped || b.hp >= b.maxHp * b.f.talents['HpChecker.hp_ratio'] || b.hp <= 0) return;
    const m = W.units.filter((v) => live(v) && v.side === b.side && v.f.key === 'enemy_15076_dqzmst').map((v) => [dist(v.x - b.x, v.y - b.y), v]).sort((p, q) => p[0] - q[0])[0];
    if (!m) return;
    b.swapped = true;
    const M = m[1], x = b.x, y = b.y, hold = b.f.skillData.SwapM3.bb.stop_attack_duration;
    b.x = M.x; b.y = M.y; M.x = x; M.y = y;
    b.noAtk = hold; M.noAtk = hold; b.skillSeq++;
    W.events.push(['swap', b, M]);
    m3Boom(W, M);
  },
});
defEnemy('15076_dqzmst', { die(W, b) { m3Boom(W, b); } });
// 奎隆，摩诃萨埵权化 惩五戒 (MultiAttack, init 15, every 30 s): five blows at the target, ATK × 90 % physical each
defEnemy('15093_dqzfkl', {
  init(u, T, SK) { clocks(u, SK, ['MultiAttack']); },
  step(W, u, T, SK) {
    if (!clkReady(u, 'MultiAttack')) return;
    const tg = bestFoes(W, u, 1)[0];
    if (!tg) return;
    u.clk.MultiAttack = SK.MultiAttack.cd; u.skillSeq++;
    chan(W, u, { key: 'MultiAttack', tgt: tg, dur: 1, every: 0.2, tick: (W2, v, c) => { hit(W, v, c.tgt, SK.MultiAttack.bb.atk_scale, { phys: true }); } });
  },
});

// ---- SURPRISE: 蜜果城's 惊喜 enemies (enemyduel_surprise_attacker_born; env_system_new enemy_duel_*) ---------------------
// PRTS: with teammates to cover them they do not enter with the rest but drop in behind the other side — usually once
// the fighting is on, sometimes before. Read from the stage's numbers: they wait while they are at most half their side
// (team_count_ratio 0.5) and others are with them; each second the batch comes with the chance 1.6 %, +20 % once their
// side has taken damage (the damage report, enemyduel_report_hurt), +30 % with half their side fallen (battle_loss_ratio),
// +20 % with their side under 60 % of its HP (battle_value_ratio); after 60 s, or with none of their side left, it comes
// anyway. They land on the other side's start column, moving at 150 % for 5 s.
const SURPRISE = new Set(ENV.surprise || []), SR = ENV.surpriseRule, SB = ENV.surpriseBorn;
function surpriseStep(W) {
  for (const side of [0, 1]) {
    const wait = W.reserve.filter((u) => u.side === side);
    if (!wait.length) continue;
    const mine = W.all[side].filter((u) => !W.reserve.includes(u));
    let go = !W.units.some((u) => u.side === side && !u.dead) || W.n >= Math.round(SR.delay * HZ);
    if (!go && W.n > 0 && W.n % Math.round(SR.interval * HZ) === 0) {
      const fallen = mine.filter((u) => u.dead).length / Math.max(1, mine.length);
      const hp = mine.reduce((a, u) => a + Math.max(0, u.hp), 0) / Math.max(1, mine.reduce((a, u) => a + u.maxHp, 0));
      const p = SR.baseProb + (W.hurt[side] ? SR.hurtProb : 0) + (fallen >= SR.lossRatio ? SR.lossProb : 0) + (hp < SR.valueRatio ? SR.valueProb : 0);
      go = W.rng() < p;
    }
    if (!go) continue;
    W.reserve = W.reserve.filter((u) => u.side !== side);
    wait.forEach((u, i) => {
      u.x = side === 0 ? AW - 0.55 + (W.rng() - 0.5) * 0.2 : 0.55 + (W.rng() - 0.5) * 0.2;
      u.y = ((i * 4 + 2) % AH) + 0.5 + (W.rng() - 0.5) * 0.3;
      u.facing = side === 0 ? -1 : 1;
      if (SB) addBuff(u, { id: 'drop', t: SB.duration, msMul: SB.moveSpeed, aspd: SB.attackSpeed || 0 });
      u.dropped = true;
      W.born.push(u);
    });
    W.events.push(['drop', null, side]);
  }
}

// ---- TRAPS: the field's 奇怪的装置 (PRTS 争锋频道: 场地内可能会出现奇怪的装置！掌控优势地形也是胜利的一环！) --------------
// Each event's battle stage has two versions (stageIds a / b: the same runes and map, different traps); a round plays
// one of them, 50 : 50 (the data does not say how the game picks one), and from its waves' random groups one pack of
// traps per group by weight (DUELCFG.stages; data/duelcfg.json traps: the traps' own numbers). The traps are drawn with
// the line-ups' generator (makeTraps), so they are known — and shown — while the viewers bet, like the line-ups; the
// battle's seed plays no part. What they do (character_table / skill_table; PRTS's 装置 pages):
//   障碍物 (trap_163_foolcrate): blocks its tile, 5000 HP — ground units go round (a blocked tile costs 1000 tiles of
//     walking, PRTS 阻挡路线), and one with no other way breaks it;
//   源石祭坛 (trap_213_dqore): its tile is for flyers only, it cannot be hurt; every 7 s (from 7 s) a pulse, 500 true damage
//     to every unit of either side on the tiles of its x-1 range (the diamond of radius 2). (It also strengthens some
//     Sarkaz — none of them is a duel enemy.)
//   弩炮 (trap_214_dqballis), on the rim: every 5 s (from 5 s) a bolt straight ahead (10 tiles a second, PRTS), 100
//     physical damage (ATK × atk_scale) to the first unit it touches, either side's;
//   解雇者清债程序 (trap_215_dqcrsbow), on the rim: every 5 s three such bullets — 0.2 s apart and as fast as the bolt (an
//     interpretation: neither number is in the data or on PRTS);
//   梅什科线圈 (trap_216_dqelec): cannot be hurt, does not block; every 2.3 s (from 2.3 s) a current 0.65 wide runs for
//     0.7 s to each coil within its x-2 range placed before it (PRTS), and a unit touching it takes 250 arts damage and
//     停顿 (cannot move) for 1.5 s, once a current.
// Neither side owns a trap: what they do falls on both alike (the stages' layouts are symmetric).
const TRAP_DATA = DCFG.traps || {}, STAGES = DCFG.stages || {};
const TRAP_KIND = { trap_163_foolcrate: 'crate', trap_213_dqore: 'ore', trap_214_dqballis: 'ballista', trap_215_dqcrsbow: 'crossbow', trap_216_dqelec: 'coil' };
// (the level's rows count up from the near side of the field, the bottom of the screen: row r is at y = AH + 0.5 − r, and
// UP is towards smaller y)
const TRAP_DIR = { UP: [0, -1], DOWN: [0, 1], RIGHT: [1, 0], LEFT: [-1, 0] };
const BOLT_V = 10, BOLT_R = 0.35, VOLLEY = { trap_215_dqcrsbow: { n: 3, gap: 0.2 } }, COIL = { on: 0.7, half: 0.65 / 2 };
// a round's traps: [[key, column, row, direction], …] in the level's tiles (the field is columns 1 … 13 and rows 1 … 9)
function makeTraps(rd, rng) {
  const st = rd && STAGES[rd.act];
  if (!st || !st.length) return [];
  const stage = st[Math.floor(rng() * st.length)], out = [];
  for (const g of stage.groups) for (const t of pickWeighted(g, (p) => p.w, rng).traps) out.push(t);
  return out;
}
function makeTrap(t, i) {
  const [key, col, row, dir] = t, D = TRAP_DATA[key] || {}, S = D.skill || { sp: {}, bb: {} };
  const tx = col - 1, ty = AH - row;
  return { key, kind: TRAP_KIND[key] || 'crate', i, col, row, tx, ty, x: tx + 0.5, y: ty + 0.5, dir: TRAP_DIR[dir] || [0, 0], tile: tx >= 0 && tx < AW && ty >= 0 && ty < AH ? tx + ty * AW : -1,
    hp: D.hp || 1, maxHp: D.hp || 1, atk: (D.atk || 0) * (S.bb.atk_scale ?? 1), sp: S.sp.init || 0, cost: key === 'trap_216_dqelec' ? S.bb.interval : S.sp.cost || 0,
    dmg: S.bb.value ?? S.bb['attack@value'] ?? 0, slug: S.bb['attack@sluggish'] || 0, range: S.range, dead: false, view: null };
}
// the tiles ground units cannot cross: 1 a crate (it can be broken), 2 an altar's (flyers only)
function trapTiles(W) {
  W.block = new Uint8Array(AW * AH); W.blockN = 0; W.nav = new Map(); W.blockAt = [];
  for (const t of W.traps) if (t.tile >= 0 && !t.dead && (t.kind === 'crate' || t.kind === 'ore')) { W.block[t.tile] = t.kind === 'crate' ? 1 : 2; W.blockN++; W.blockAt.push([t.tx, t.ty]); }
}
// the coils' currents: from each coil to every coil before it within its x-2 range
function coilLinks(W) {
  const cs = W.traps.filter((t) => t.kind === 'coil'), out = [];
  cs.forEach((a, i) => { for (const b of cs.slice(0, i)) if ((RANGES[a.range] || []).some(([c, r]) => b.col === a.col + c && b.row === a.row + r) && (a.col !== b.col || a.row !== b.row)) out.push({ a, b, t: 0, hit: null }); });
  return out;
}
// ground units' way round the blocked tiles: for a goal tile, each tile's cost to it (10 a step, 14 a diagonal step not
// cutting a blocked corner, onto a crate's tile 10000 more, onto an altar's not at all), worked out once per goal while
// the tiles stay as they are
function navField(W, goal) {
  let F = W.nav.get(goal);
  if (F) return F;
  const N = AW * AH, done = new Uint8Array(N);
  F = new Float64Array(N).fill(Infinity); F[goal] = 0;
  for (;;) {
    let c = -1, best = Infinity;
    for (let i = 0; i < N; i++) if (!done[i] && F[i] < best) { best = F[i]; c = i; }
    if (c < 0) break;
    done[c] = 1;
    if (c !== goal && W.block[c] === 2) continue;
    const cx = c % AW, cy = (c - cx) / AW;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= AW || ny < 0 || ny >= AH) continue;
      const n = nx + ny * AW;
      if (W.block[n] === 2 || done[n]) continue;
      if (dx && dy && (W.block[cx + ny * AW] || W.block[nx + cy * AW])) continue;
      const w = best + (dx && dy ? 14 : 10) + (W.block[n] === 1 ? 10000 : 0);
      if (w < F[n]) F[n] = w;
    }
  }
  W.nav.set(goal, F);
  return F;
}
// does the line from (x0, y0) to (x1, y1), as wide as a unit (0.2 each side), stay off the blocked tiles?
function clearLine(W, x0, y0, x1, y1) {
  const lx = Math.min(x0, x1) - 0.2, hx = Math.max(x0, x1) + 0.2, ly = Math.min(y0, y1) - 0.2, hy = Math.max(y0, y1) + 0.2;
  if (!W.blockAt.some(([c, r]) => c + 1 > lx && c < hx && r + 1 > ly && r < hy)) return true;
  const dx = x1 - x0, dy = y1 - y0, L = dist(dx, dy), n = Math.ceil(L / 0.1);
  const ox = L > 1e-9 ? -dy / L * 0.2 : 0, oy = L > 1e-9 ? dx / L * 0.2 : 0;
  for (let i = 0; i <= n; i++) {
    const x = x0 + dx * i / Math.max(1, n), y = y0 + dy * i / Math.max(1, n);
    for (const k of [0, 1, -1]) {
      const px = x + ox * k, py = y + oy * k;
      if (px < 0 || px >= AW || py < 0 || py >= AH) continue;
      if (W.block[tileX(px) + tileY(py) * AW]) return false;
    }
  }
  return true;
}
// the way for a ground unit to (ax, ay) on a field with blocked tiles: null — straight there; [x, y] — the farthest
// tile ahead on the cheapest way that it can walk to in a line; { crate } — the way goes through a crate it stands at
function steer(W, u, ax, ay) {
  if (clearLine(W, u.x, u.y, ax, ay)) return null;
  const goal = tileX(ax) + tileY(ay) * AW, F = navField(W, goal);
  let c = tileX(u.x) + tileY(u.y) * AW, to = null;
  for (let k = 0; k < 8 && c !== goal; k++) {
    const cx = c % AW, cy = (c - cx) / AW;
    let nxt = -1, best = F[c];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if ((!dx && !dy) || nx < 0 || nx >= AW || ny < 0 || ny >= AH) continue;
      const n = nx + ny * AW;
      if (F[n] < best) { best = F[n]; nxt = n; }
    }
    if (nxt < 0) break;
    const px = nxt % AW + 0.5, py = (nxt - nxt % AW) / AW + 0.5;
    if (W.block[nxt] === 1) {
      if (k > 0) break;
      const crate = W.traps.find((t) => t.tile === nxt && !t.dead);
      if (crate && Math.max(Math.abs(u.x - px), Math.abs(u.y - py)) <= 0.5 + 0.3) return { crate };
      return [px, py];
    }
    if (k > 0 && !clearLine(W, u.x, u.y, px, py)) break;
    to = [px, py]; c = nxt;
  }
  return to;
}
function trapStep(W) {
  for (const t of W.traps) {
    if (t.dead || t.kind === 'crate') continue;
    if (t.kind === 'coil') continue;
    t.sp += DT;
    if (t.sp < t.cost - EPS) continue;
    t.sp = 0;
    if (t.kind === 'ore') {
      for (const v of W.units) if (live(v) && inShape(t.range, t.tx, t.ty, v)) strike(W, v, t.dmg, null, 'true');
      if (W.visual) W.events.push(['pulse', null, t]);
    } else {
      const V = VOLLEY[t.key] || { n: 1, gap: 0 };
      for (let i = 0; i < V.n; i++) W.bolts.push({ t, x: t.x, y: t.y, delay: i * V.gap, g: null });
      if (W.visual) W.events.push(['trapfire', null, t]);
    }
  }
  // the coils' currents: every interval, for COIL.on seconds; a unit touching one is hit once by it
  for (const L of W.links) {
    L.t += DT;
    const per = L.a.cost;
    if (L.t >= per - EPS && !L.hit) { L.hit = new Set(); L.on = 0; L.t = 0; if (W.visual) W.events.push(['arc', null, L]); }
    if (!L.hit) continue;
    const ax = L.a.x, ay = L.a.y, bx = L.b.x - ax, by = L.b.y - ay, l2 = bx * bx + by * by;
    for (const v of W.units) {
      if (!live(v) || L.hit.has(v)) continue;
      const k = clamp(((v.x - ax) * bx + (v.y - ay) * by) / l2, 0, 1);
      if (dist(v.x - ax - bx * k, v.y - ay - by * k) > COIL.half) continue;
      L.hit.add(v);
      strike(W, v, artsOf(L.a.dmg, v), null, 'arts');
      if (live(v)) v.root = Math.max(v.root, L.a.slug);
      if (W.visual) W.events.push(['shock', v, L]);
    }
    L.on += DT;
    if (L.on >= COIL.on - EPS) L.hit = null;
  }
  // bolts and bullets: straight on, hitting the first unit they touch (the nearest along their way this step)
  if (W.bolts.length) W.bolts = W.bolts.filter((b) => {
    if (b.delay > EPS) { b.delay -= DT; return true; }
    const [dx, dy] = b.t.dir, s = BOLT_V * DT;
    let first = null, fk = Infinity;
    for (const v of W.units) {
      if (!live(v)) continue;
      // (a giant: the point of its body nearest the bolt)
      const [vx, vy] = v.giant ? aimAt(b, v) : [v.x, v.y], k = (vx - b.x) * dx + (vy - b.y) * dy;
      if (k < -BOLT_R || k > s + BOLT_R) continue;
      if (Math.abs((vx - b.x) * dy - (vy - b.y) * dx) > BOLT_R) continue;
      if (k < fk) { fk = k; first = v; }
    }
    if (first) {
      strike(W, first, physOf(b.t.atk, first), null, 'phys');
      if (W.visual) W.events.push(['bolt', first, b]);
      if (b.g) b.g.destroy();
      return false;
    }
    b.x += dx * s; b.y += dy * s;
    if (b.x < -1.5 || b.x > AW + 1.5 || b.y < -1.5 || b.y > AH + 1.5) { if (b.g) b.g.destroy(); return false; }
    return true;
  });
}
// a ground unit breaking the crate in its way: its attack, on its own clock, the crate's HP down by its ATK (a crate
// has no DEF or RES); a crate at 0 is gone and the way is open
function breakCrate(W, u, c) {
  u.facing = c.x > u.x ? 1 : -1;
  if (u.cd > EPS || u.disarm > 0 || u.noAtk > 0 || u.passive) { if (u.state === 'move') u.state = 'idle'; return; }
  const iv = u.fixedIv || u.bat * 100 / Math.min(600, Math.max(10, u.aspd + u.bAspd - (u.cold > 0 ? 30 : 0)));
  u.cd = iv; u.state = 'attack'; u.attackSeq++; u.attackIv = iv;
  c.hp -= atkOf(u) * (u.outside ? 1 + ENV.ringAtk : 1);
  if (W.visual) W.events.push(['cratehit', u, c]);
  if (c.hp <= 0) { c.hp = 0; c.dead = true; trapTiles(W); W.events.push(['crategone', null, c]); }
}

// the attack about to start: { tgts, o (hit options), times, mult, skill, heal, none (no blow), again (止戈者) }. A
// skill fires on a full charge (one point an attack: SP_SKILL); the enemy's hook shapes the rest. “自在” and 依然“狼之主”'s
// second forms attack twice.
function chooseAttack(W, u, tg) {
  const SK = u.f.skillData || {}, T = u.f.talents || {};
  const a = { tgts: [tg], o: {}, times: 1, mult: 1, skill: false };
  if (u.pen) a.o.pen = u.pen;
  const key = SK.armorpiercing && u.enhanced ? 'armorpiercing' : SK.ironsandstorm && !u.enhanced ? 'ironsandstorm' : SP_KEYS.find((k) => SK[k]);
  if (key) {
    const s = SK[key];
    if (u.sp >= s.sp) { u.sp = 0; a.skill = true; SP_SKILL[key](W, u, tg, a, s); } else u.sp++;
  }
  if (u.enhanced && T['reborn.atk']) { const two = enemiesInReach(W, u, tg, 2); if (two.length > 1) a.tgts = two; else a.times = 2; }
  if (u.enhanced && T['Passive2.atk']) a.times = 2;
  const H = ENEMIES[u.f.key];
  if (H && H.attack) H.attack(W, u, tg, a);
  return a;
}
function simStep(W) {
  const z = zoneAt(W.n);
  if (z !== W.zone) { W.zone = z; if (W.visual) W.events.push(['zone', null]); }
  if (W.timers.length) runTimers(W);
  if (W.reserve.length) surpriseStep(W);
  if (W.ground.length) groundStep(W);
  if (W.traps.length) trapStep(W);
  for (const u of W.units) {
    if (u.dead) continue;
    if (u.rebornT > 0) {
      u.rebornT -= DT;
      if (u.rebornT <= EPS) {
        const T = u.f.talents; u.rebornT = 0; u.hp = u.maxHp * (T['Reborn.hp_ratio'] || 1); u.enhanced = true;
        u.atk += (T['enhance.atk'] || 0) * ENV.atkMul; u.defv += T['enhance.def'] || 0; u.res += T['enhance.magic_resistance'] || 0;
        u.bat = Math.max(0.3, u.bat + (T['enhance.base_attack_time'] || 0)); u.speed += (T['enhance.move_speed'] || 0) * ENV.moveMultiplier;
        // 杰斯顿's killer form: melee, physical; every 禁锢 prisoner on the field is freed
        if (u.f.skillData && u.f.skillData.armorpiercing) { u.ranged = false; u.arts = false; u.reach = 0.8; u.sp = 0; for (const v of W.units) if (v.confined && !v.dead) liberate(W, v); }
        // the leaders' second forms (LEADERS)
        u.invT = T['reborn.invincible'] || T['Reborn.invincible'] || T['Passive2.invincible_time'] || 0;
        if (T['reborn.atk']) u.atk *= 1 + T['reborn.atk'];
        if (T['Passive2.atk']) { u.atk *= 1 + T['Passive2.atk']; u.bat = Math.max(0.3, u.bat + (T['Passive2.base_attack_time'] || 0)); u.dr = 0; u.noStun = false; }
        if (u.f.skillData && u.f.skillData.ShieldBurstReborn) u.burstT = u.f.skillData.ShieldBurstReborn.init;
        W.events.push(['revive', u]);
      }
      continue;
    }
    // the safe zone: outside, the excitement state; every second one more stack and its true damage; inside, it is gone
    u.outside = outsideZone(u, z);
    if (u.outside) {
      if (++u.outN % HZ === 0) { u.stacks++; hurt(W, u, u.stacks * ENV.ringHpRatio * u.maxHp, null, false); }
    } else { u.outN = 0; u.stacks = 0; }
    const T = u.f.talents || {}, SK = u.f.skillData || {}, H = ENEMIES[u.f.key];
    if (u.buffs.length) tickBuffs(u);
    if (u.regen && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.regen * DT);
    if (T['periodic_damage.damage']) hurt(W, u, T['periodic_damage.damage'] * DT, null, true);
    if (u.bleed.length) { for (const b of u.bleed) { hurt(W, u, b.arts ? artsOf(b.dps * DT, u) : b.dps * DT, null, true); b.t -= DT; } u.bleed = u.bleed.filter((b) => b.t > EPS); }
    // 溶血骇惧 on this unit: HP lost at a rate rising over duration_bleed seconds to hp_ratio of max HP a second
    if (u.fear) { const F = u.fear.src.f.skillData.FearCage.bb; u.fear.t += DT; hurt(W, u, F.hp_ratio * u.maxHp * Math.min(1, u.fear.t / F.duration_bleed) * DT, null, true); }
    if (u.el) elemStep(W, u);
    if (!live(u)) continue;
    // the states' clocks run whatever the unit does
    if (u.cold > 0) { u.cold -= DT; if (u.cold <= EPS) u.cold = 0; }
    if (u.root > 0) { u.root -= DT; if (u.root <= EPS) u.root = 0; }
    if (u.disarm > 0) { u.disarm -= DT; if (u.disarm <= EPS) u.disarm = 0; }
    if (u.noAtk > 0) { u.noAtk -= DT; if (u.noAtk <= EPS) u.noAtk = 0; }
    if (!u.clkHold) for (const k in u.clk) if (u.clk[k] > 0) u.clk[k] -= DT;
    if (u.leader) { leaderStep(W, u, T, SK); if (!live(u)) continue; }
    if (u.stun > 0) { u.stun -= DT; if (u.stun <= EPS) { u.stun = 0; u.stunKind = ''; } continue; }
    // its skills (not while it cannot use them: 无德决斗家's shot)
    if (H && H.step && !u.chan && !(u.disarm > 0)) { H.step(W, u, T, SK); if (!live(u)) continue; }
    if (u.chan) { chanStep(W, u); if (u.chan || !live(u)) { u.state = 'idle'; continue; } }
    // queued hits (the attack clip's hit frame)
    let fired = false;
    u.pending = u.pending.filter((p) => {
      p.t -= DT;
      if (p.t > EPS) return true;
      for (const tg of p.tgts) {
        if (!live(tg)) continue;
        for (let i = 0; i < p.times; i++) {
          if (u.ranged) W.shots.push({ src: u, tgt: tg, x: u.x + u.facing * 0.3, y: u.y, mult: p.mult, o: p.o, g: null, delay: i * 0.12 });
          else land(W, u, tg, p.mult, p.o);
        }
      }
      fired = true;
      return false;
    });
    if (fired && H && H.fired) { H.fired(W, u); if (!live(u)) continue; }
    u.retarget -= DT;
    if (!u.target || !live(u.target) || u.retarget <= EPS) { u.target = pickTarget(W, u); u.retarget = 0.5; }
    const tg = u.target;
    u.cd -= DT;
    if (!tg) { u.state = 'idle'; continue; }
    const [ax, ay] = aimAt(u, tg), dx = ax - u.x, dy = ay - u.y, d = gap(u, tg);
    if (Math.abs(dx) > 0.05) u.facing = dx > 0 ? 1 : -1;
    const gate = tileX(u.x) === 0 || tileX(u.x) === AW - 1;    // the start / end tiles give no move speed
    if (u.charge > 0) { u.state = 'idle'; continue; }          // 溶血骇惧's wind-up: no move, no attack
    const still = u.hold > 0 || u.root > 0 || u.giant;         // behind the barrier, rooted, a giant: no move
    if (d > u.reach && still) u.state = 'idle';
    else if (d > u.reach) {
      // the field's blocked tiles (TRAPS): a ground unit goes round them, or breaks the crate that leaves no other way
      let way = null;
      if (W.blockN && !u.f.fly) {
        if (u.wayTg !== tg || W.n - u.wayN >= 6 || u.wayV !== W.nav || (u.way && u.way.crate && u.way.crate.dead)) { u.way = steer(W, u, ax, ay); u.wayTg = tg; u.wayN = W.n; u.wayV = W.nav; }
        way = u.way;
      }
      if (way && way.crate) { breakCrate(W, u, way.crate); continue; }
      const rush = u.rushT > 0 ? 1 + u.f.skillData.Rush.bb.move_speed : 1;
      const mx = way ? way[0] - u.x : dx, my = way ? way[1] - u.y : dy, dd = way ? dist(mx, my) : d;
      const step = Math.min(way ? dd : d - u.reach * 0.9, u.speed * (1 + u.bMs) * u.bMsMul * (u.outside && !gate ? ENV.ringMove : 1) * rush * DT);
      if (dd > 0) { u.x += mx / dd * step; u.y += my / dd * step; }
      u.state = 'move';
    } else if (u.passive || u.disarm > 0 || u.noAtk > 0 || u.spin > 0) { if (u.state === 'move') u.state = 'idle'; }
    else if (u.cd <= EPS) {
      if (H && H.pre) H.pre(W, u, tg);
      let aspd = u.aspd + (u.outside ? ENV.ringAspd : 0);
      if (T['selfbuff.attack_speed'] && u.hp < u.maxHp * (T['selfbuff.hp_ratio'] || 0.5)) aspd += T['selfbuff.attack_speed'];
      if (u.fear) aspd += u.fear.src.f.skillData.FearCage.bb.attack_speed;
      aspd = Math.min(600, Math.max(10, aspd + u.bAspd - (u.cold > 0 ? 30 : 0)));
      const iv = u.fixedIv || u.bat * 100 / aspd;
      u.cd = iv;
      const aa = u.f.attackAnim, dur = aa ? aa.dur : 1, ts = Math.max(1, dur / Math.max(0.2, iv));
      const a = chooseAttack(W, u, tg);
      u.atkN++; u.lastAtkN = W.n;
      if (a.heal) { u.hp = Math.min(u.maxHp, u.hp + u.maxHp * a.heal); W.events.push(['heal', u, u]); }
      if (!a.none) u.pending.push({ t: (aa ? aa.hit : 0.35) / ts, tgts: a.tgts, o: a.o, times: a.times, mult: (u.outside ? 1 + ENV.ringAtk : 1) * a.mult });
      u.state = 'attack'; u.attackSeq++; u.attackIv = iv;
      if (a.skill) u.skillSeq++;
      if (a.again) u.cd = 0;
    } else if (u.state === 'move') u.state = 'idle';
  }
  // collision (蜜果城 on, PRTS: 单位之间将会存在碰撞体积，敌对双方甚至是友军之间可能会互相将对方挤开): ground units
  // closer than BODY shove each other apart, half the overlap a step, the lighter (massLevel) giving way more; a unit is
  // shoved at most SHOVE a step (0.6 tile a second), and never onto a start / end column (the gates) it has left. Flying
  // units and the giants do not take part.
  const body = W.units.filter((u) => !u.dead && !u.rebornT && !u.f.fly && !u.giant);
  for (const u of body) { u.sx = 0; u.sy = 0; }
  for (let i = 0; i < body.length; i++) for (let j = i + 1; j < body.length; j++) {
    const a = body[i], b = body[j], dx = b.x - a.x, dy = b.y - a.y, d = dist(dx, dy);
    if (d >= BODY) continue;
    // two on the very same spot part along the lane
    const nx = d > 1e-6 ? dx / d : 0, ny = d > 1e-6 ? dy / d : (j - i) % 2 ? 1 : -1;
    const push = (BODY - d) * 0.5, ma = a.f.mass + 1, mb = b.f.mass + 1, wa = mb / (ma + mb), wb = ma / (ma + mb);
    a.sx -= nx * push * wa; a.sy -= ny * push * wa; b.sx += nx * push * wb; b.sy += ny * push * wb;
  }
  for (const u of body) {
    const m = dist(u.sx, u.sy);
    if (!(m > 0)) continue;
    const k = Math.min(1, SHOVE / m), gate = tileX(u.x) === 0 || tileX(u.x) === AW - 1;
    u.x += u.sx * k; u.y += u.sy * k;
    if (!gate) u.x = clamp(u.x, 1, AW - 1 - 1e-6);
  }
  // nobody stands inside a giant: one who got in is set on the nearest edge of its body
  for (const g of W.units) {
    if (!g.giant || g.dead) continue;
    const B = boxOf(g);
    for (const u of body) {
      if (u.x <= B.x0 || u.x >= B.x1 || u.y <= B.y0 || u.y >= B.y1) continue;
      const l = u.x - B.x0, r = B.x1 - u.x, t = u.y - B.y0, d = B.y1 - u.y, m = Math.min(l, r, t, d);
      if (m === r) u.x = B.x1 + 1e-6; else if (m === l) u.x = B.x0 - 1e-6; else if (m === t) u.y = B.y0 - 1e-6; else u.y = B.y1 + 1e-6;
    }
  }
  // nor on a blocked tile (TRAPS): one who got on is set on its nearest edge
  if (W.blockN) for (const u of body) {
    const c = tileX(u.x), r = tileY(u.y);
    if (!W.block[c + r * AW]) continue;
    const free = (x, y) => x >= 0 && x < AW && y >= 0 && y < AH && !W.block[x + y * AW];
    const out = [[u.x - c, c - 1, r, () => { u.x = c - 1e-6; }], [c + 1 - u.x, c + 1, r, () => { u.x = c + 1 + 1e-6; }],
      [u.y - r, c, r - 1, () => { u.y = r - 1e-6; }], [r + 1 - u.y, c, r + 1, () => { u.y = r + 1 + 1e-6; }]].filter((e) => free(e[1], e[2])).sort((a, b) => a[0] - b[0]);
    if (out.length) out[0][3]();
  }
  for (const u of W.units) { u.x = clamp(u.x, 0.1, AW - 0.1); u.y = clamp(u.y, 0.1, AH - 0.1); }
  // shots
  W.shots = W.shots.filter((s) => {
    if (s.delay > EPS) { s.delay -= DT; return true; }
    const dx = s.tgt.x - s.x, dy = s.tgt.y - s.y, d = dist(dx, dy);
    if (d < 0.3 || s.tgt.dead) {
      if (s.o && s.o.cross) crossBlast(W, s.src, s.tgt.x, s.tgt.y, s.mult, s.o.cross);
      else if (!s.tgt.dead) land(W, s.src, s.tgt, s.mult, s.o);
      if (s.g) s.g.destroy();
      return false;
    }
    const v = 9 * DT;
    s.x += dx / d * Math.min(v, d); s.y += dy / d * Math.min(v, d);
    return true;
  });
  // the units that came this step (summoned, dropped in, off the bus)
  if (W.born.length) {
    for (const u of W.born) { if (!W.units.includes(u)) W.units.push(u); W.events.push(['spawn', u]); }
    W.born = [];
  }
  W.n++; W.t = W.n * DT;
  // the end: one side wiped out (both at once: a draw, everyone who bet wins), else at the phase limit the side with
  // more HP left (an interpretation: neither the data nor PRTS says how a timeout is judged). A side's units still to
  // drop in or to rise from the fallen (death spawns on their way) count as standing; every unit it had counts toward
  // its HP share.
  const standing = (sd) => W.units.some((u) => u.side === sd && !u.dead) || W.reserve.some((u) => u.side === sd) || W.coming[sd] > 0;
  const alive = [standing(0), standing(1)];
  if (!alive[0] || !alive[1] || W.t >= BATTLE_MAX) {
    let w;
    if (!alive[0] && !alive[1]) w = 'draw';
    else if (!alive[0]) w = 1;
    else if (!alive[1]) w = 0;
    else {
      const hp = [0, 1].map((sd) => { const all = W.all[sd]; return all.reduce((a, u) => a + Math.max(0, u.hp) / u.maxHp, 0) / all.length; });
      w = Math.abs(hp[0] - hp[1]) < 0.02 ? 'draw' : hp[0] > hp[1] ? 0 : 1;
    }
    W.done = true; W.result = w;
  }
}
// the outcome of a match-up, computed ahead (headless, same seed and steps as the replay)
function predict(lineups, seed, traps) {
  const W = makeWorld(lineups, seed, false, traps);
  while (!W.done) simStep(W);
  return { winner: W.result, time: W.t };
}

// ---- line-ups (PRTS 争锋频道/分配规则) ------------------------------------------------------------------------------------
// The round's table gives each side a budget (enemyScore ± enemyScoreRandom) and a number of types (min … max). The types
// are drawn from the side's pool by weight, never one the other side has; every point of the budget goes to one of them
// at random; each type then sends units while its share pays for them — the n-th unit of a type costs its base score
// (numOfExtraDrops) plus (n − 1) × its extra cost (PRTS's 单兵附加费用) — and one more with the chance (share left) ÷ (that
// unit's cost); a type that ends up sending none sends one. A 协同 group is one type, costed by its head. A summon
// (大君之赐, 畸变赘生物: 999999) is never drawn.
// the pools a round's sides draw from (roundData enemyPoolLeft / Right): 青草城 normal / small / boss; 蜜果城 adds 音乐
// (music) and 无惊喜 (nosurprise), 绿藤城 巨型领袖 (giant) and its counter (antigiant)
const POOL_FIELD = { poolNormal: 'normal', poolSmallEnemy: 'small', poolBoss: 'boss', poolMusic: 'music', poolNoSurpriseEnemy: 'nosurprise',
  poolGiantBoss: 'giant', poolAntiGiantBoss: 'antigiant' };
// the (i + 1)-th unit of a type
const unitCost = (f, i) => f.score + (f.scoreAdd || 0) * i;
const groupCost = (g) => { let s = 0; for (let i = 0; i < g.n; i++) s += unitCost(g.f, i); return s; };
const sideScore = (gs) => gs.reduce((s, g) => s + groupCost(g), 0);
const sidePower = (gs) => gs.reduce((s, g) => s + g.n * g.f.power, 0);
// (the default generator serves the page's decorations only; the sim passes its own)
// eslint-disable-next-line no-restricted-properties
const pick = (a, rng = Math.random) => a[Math.floor(rng() * a.length)];
function pickWeighted(list, w, rng) {
  const tot = list.reduce((a, x) => a + w(x), 0);
  let r = rng() * tot;
  for (const x of list) { r -= w(x); if (r <= 0) return x; }
  return list[list.length - 1];
}
// one side's line-up: [{ f, n }]; taken: the other side's types
function makeSide(rd, side, rng, taken) {
  const kmin = side ? rd.enemySideMinRight : rd.enemySideMinLeft, kmax = side ? rd.enemySideMaxRight : rd.enemySideMaxLeft;
  const field = POOL_FIELD[side ? rd.enemyPoolRight : rd.enemyPoolLeft] || 'normal';
  const budget = Math.round(rd.enemyScore + (rng() * 2 - 1) * rd.enemyScoreRandom);
  const cands = POOL.filter((f) => (f.pool[field] || 0) > 0 && f.score < 9999 && !(taken && taken.has(f.key)));
  const k = Math.min(cands.length, kmin + Math.floor(rng() * (kmax - kmin + 1)));
  const types = [];
  while (types.length < k) types.push(pickWeighted(cands.filter((x) => !types.includes(x)), (x) => x.pool[field], rng));
  const share = types.map(() => 0);
  for (let p = 0; p < budget; p++) share[Math.floor(rng() * types.length)]++;
  return types.map((f, i) => {
    let left = share[i], n = 0;
    for (;;) {
      const c = unitCost(f, n);
      if (left >= c) { left -= c; n++; continue; }
      if (rng() < left / c) n++;
      break;
    }
    return { f, n: Math.max(1, n) };
  });
}
function makeLineups(rd, rng) {
  const left = makeSide(rd, 0, rng, null);
  return [left, makeSide(rd, 1, rng, new Set(left.map((g) => g.f.key)))];
}

// An NPC's side: DEFAULT sums its per-enemy pick scores (npcSelectorData; defaultEnemyScore for the rest) over each
// side and takes the larger, and with npcCorrectProb it simply knows the winner (the result is computed before the bets);
// CHOOSE_WIN always knows it; CHOOSE_ODD takes the side its scores rate lower; FOLLOW_FEWER / FOLLOW_MORE decide late,
// after the others, following the side with fewer / more supporters; CHOOSE_ODD / EVEN_ENEMY_COUNT go by the parity of
// a side's unit count; ALWAYS_LEFT. The action: weights skip 0.3 / bet 1.0 / 全力支持 1.5 × allinProb (the config's
// modeOperation*Param, read here as action weights — an interpretation).
function npcSideScore(npc, groups) {
  const tab = DCFG.npcSelector[npc.npcId], sc = {};
  if (tab) for (const d of tab.data) sc[d.enemyId] = d.score;
  return groups.reduce((a, g) => a + g.n * (sc[g.f.key] ?? npc.defaultEnemyScore ?? 0), 0);
}
// o: { lineups, winner (precomputed), sup ([left, right] supporters so far), rnd }
function npcSide(npc, o) {
  const C = DCFG.consts, rnd = o.rnd, coin = () => (rnd() < 0.5 ? 0 : 1);
  const sc = o.lineups.map((g) => npcSideScore(npc, g)), cnt = o.lineups.map((g) => g.reduce((a, x) => a + x.n, 0)), sup = o.sup;
  const knows = o.winner === 'draw' ? coin() : o.winner;
  switch (npc.specialStrategy) {
    case 'CHOOSE_WIN': return knows;
    case 'CHOOSE_ODD': return sc[0] === sc[1] ? coin() : sc[0] < sc[1] ? 0 : 1;
    case 'FOLLOW_FEWER': return sup[0] === sup[1] ? coin() : sup[0] < sup[1] ? 0 : 1;
    case 'FOLLOW_MORE': return sup[0] === sup[1] ? coin() : sup[0] > sup[1] ? 0 : 1;
    case 'CHOOSE_ODD_ENEMY_COUNT': { const od = cnt.map((n) => n % 2 === 1); return od[0] === od[1] ? coin() : od[0] ? 0 : 1; }
    case 'CHOOSE_EVEN_ENEMY_COUNT': { const ev = cnt.map((n) => n % 2 === 0); return ev[0] === ev[1] ? coin() : ev[0] ? 0 : 1; }
    case 'ALWAYS_LEFT': return 0;
    default: return (o.informed ?? rnd() < (C.npcCorrectProb ?? 0.3)) ? knows : sc[0] === sc[1] ? coin() : sc[0] > sc[1] ? 0 : 1;
  }
}
// o: { pts, rd (the round's row), lineups, winner (precomputed), sup ([left, right] supporters so far), rnd }
function npcPick(npc, o) {
  const C = DCFG.consts, rnd = o.rnd;
  const side = npcSide(npc, o);
  const stake = o.rd.roundScore, short = o.pts < stake, canAll = o.rd.canAllIn || short;
  const w = [o.rd.canSkip ? (C.modeOperationSkipParam ?? 0.3) : 0, short ? 0 : (C.modeOperationBetParam ?? 1), canAll ? (C.modeOperationAllinParam ?? 1.5) * (npc.allinProb ?? 0.5) : 0];
  let r = rnd() * (w[0] + w[1] + w[2]);
  if ((r -= w[0]) < 0) return { skip: true };
  if (r - w[1] < 0) return { side, kind: 'normal' };
  return { side, kind: 'all', forced: short && !o.rd.canAllIn };
}
// a round's settlement for one player's choice (shared so the server and the offline page agree)
function settleOne(p, choice, rd, w) {
  const C = DCFG.consts, stake = rd.roundScore, MUL = C.modeOperationRewardMultiplier || 1, MUL_ALL = C.modeOperationRewardMultiplierAllin || 2;
  p.change = 0; p.right = null;
  if (p.out || !choice) return;
  p.played++;
  if (choice.skip) { p.stats.skip++; return; }
  if (choice.kind === 'all') { p.stats.all++; if (choice.forced) p.stats.forced++; } else p.stats.normal++;
  const right = w === 'draw' || choice.side === w;
  p.right = right; p.lastForced = !!choice.forced;
  if (right) { p.change = (choice.kind === 'all' ? MUL_ALL : MUL) * stake; p.streak++; }
  else { p.change = choice.kind === 'all' ? -p.pts : -Math.min(stake, p.pts); p.streak = 0; }
  p.pts = Math.min(C.modeOperationMaxScore || 999999999, p.pts + p.change);
  if (p.pts <= 0) { p.pts = 0; p.out = true; p.outRound = rd.round; }
}

// ---- 竞猜对决 (STAND) ---------------------------------------------------------------------------------------------------
// Up to 30 viewers (modes.multiStand*.maxPlayer). Each round every viewer still in backs one side: no gifts, no 观望; a
// viewer who has not chosen when the time is up is given a side at random. A wrong pick is OUT, but every viewer has one
// 观众保护: it takes the first wrong pick within rounds 1 … modeStandShieldTurn (5) and is gone for everyone from round 6
// (PRTS: 第6轮时失效; the bet panel's 「所有人不再拥有观众保护！」). Both sides wiped out at once: every pick is right.
// No round limit: the broadcast ends when one viewer is left or all are OUT, and NPC viewers never keep it going (PRTS).
// Ranked by the rounds guessed right (PRTS: 按照成功轮次数进行排名). Interpretations, where neither the data nor PRTS
// says: rounds past the table's last row (10) repeat it; modeStandRoundNumber (60) caps the broadcast; an NPC guesses
// right at most npcMaxCorrectCountInStand (3) times, then backs the losing side; a viewer who leaves while still in is
// OUT that round; equal rounds guessed right go to whoever stayed in longer.
const isStand = (modeId) => !!DCFG.modes[modeId] && DCFG.modes[modeId].modeType === 'STAND';
const STAND = {
  shieldTurn: DCFG.consts.modeStandShieldTurn ?? 5, cap: DCFG.consts.modeStandRoundNumber ?? 60, npcMaxRight: DCFG.consts.npcMaxCorrectCountInStand ?? 3,
};
// a mode's rounds in turn, each a list of the events' versions of that round (data/duelcfg.json keeps all three events'
// rounds whole: <roundId>@<act>); a match plays one of them, drawn when the round comes (pickRound)
function roundTable(modeId) {
  const by = new Map();
  for (const r of Object.values(DCFG.rounds)) if (r.modeId === modeId) { if (!by.has(r.round)) by.set(r.round, []); by.get(r.round).push(r); }
  return [...by.keys()].sort((a, b) => a - b).map((k) => by.get(k).sort((a, b) => (a.act < b.act ? -1 : a.act > b.act ? 1 : 0)));
}
const pickRound = (versions, rnd) => versions[Math.floor(rnd() * versions.length)];
// 竞猜对决: the versions of round r (1-based) — past the table's last, its last
const standRow = (table, r) => table[Math.min(r, table.length) - 1];
// a viewer's stand state: rounds guessed right, the 观众保护 (still held; taken in round shieldAt), saved this round
const standSeat = () => ({ pass: 0, shield: true, shieldAt: 0, saved: false });
// at the start of round r: past the protected rounds nobody holds a shield any more
function standShields(players, r) { if (r > STAND.shieldTurn) for (const p of players) p.shield = false; }
// Whether an NPC's pick this round uses the outcome computed ahead: CHOOSE_WIN always, DEFAULT with npcCorrectProb, and
// in 竞猜对决 one that has guessed right npcMaxRight times (it then backs the loser). Drawn as the round opens and passed
// to npcPick / npcStandPick as o.informed, so such a pick can be made in the window's secret part, never shown before
// the bets close (server/game.mjs; the page offline likewise). o: { stand, pass, rnd }
function npcInformed(npc, o) {
  if (o.stand && o.pass >= STAND.npcMaxRight) return true;
  if (npc.specialStrategy === 'CHOOSE_WIN') return true;
  if (['CHOOSE_ODD', 'FOLLOW_FEWER', 'FOLLOW_MORE', 'CHOOSE_ODD_ENEMY_COUNT', 'CHOOSE_EVEN_ENEMY_COUNT', 'ALWAYS_LEFT'].includes(npc.specialStrategy)) return false;
  return o.rnd() < (DCFG.consts.npcCorrectProb ?? 0.3);
}
// an NPC's pick: its strategy's side (npcSide), or the losing side once it has guessed right npcMaxRight times
function npcStandPick(npc, o) {
  const side = npcSide(npc, o);
  if (o.pass >= STAND.npcMaxRight && o.winner !== 'draw') return { side: 1 - o.winner };
  return { side };
}
// round r's outcome for one viewer's pick (w: 0, 1 or 'draw')
function settleStand(p, choice, r, w) {
  p.right = null; p.saved = false;
  if (p.out || !choice) return;
  p.played++;
  p.right = w === 'draw' || choice.side === w;
  if (p.right) { p.pass++; p.streak++; return; }
  p.streak = 0;
  if (p.shield && r <= STAND.shieldTurn) { p.shield = false; p.shieldAt = r; p.saved = true; return; }
  p.out = true; p.outRound = r;
}
// a viewer who leaves while still in
function standLeave(p, r) { if (!p.out) { p.out = true; p.outRound = r; p.shield = false; } }
// over: one viewer (or none) left, or no human viewer still in (NPCs never keep it going)
function standOver(players) {
  const live = players.filter((p) => !p.out);
  return live.length <= 1 || !live.some((p) => p.human && !p.left);
}
// the standings: rounds guessed right, then still in, then OUT later; equal on both share a rank. { id: rank }
function standRanks(players) {
  const key = (p) => [p.pass, p.out ? p.outRound : Infinity];
  const order = players.slice().sort((a, b) => { const x = key(a), y = key(b); return y[0] - x[0] || (y[1] === x[1] ? 0 : y[1] > x[1] ? 1 : -1); });
  const rank = {};
  order.forEach((p, i) => {
    const q = order[i - 1], same = q && q.pass === p.pass && (q.out ? q.outRound : Infinity) === (p.out ? p.outRound : Infinity);
    rank[p.id] = same ? rank[q.id] : i + 1;
  });
  return rank;
}

// The emoji panel's themes (enabledEmoticonThemeIdList → display_meta_table, each theme's ENEMYDUEL_BATTLE pictures):
// the duel's own (emticon_duel_basic, 12) first, then the four themes a player may own (6 each). Every theme is open
// here (the game sells the others; this demo has no account). EMOJI_PICS: every picture one may send; the NPC viewers
// keep to the basic theme (EMOJI_BASIC).
const EMOJI_THEMES = DCFG.emoticons || [];
const EMOJI_BASIC = EMOJI_THEMES[0] ? EMOJI_THEMES[0].pics : [];
const EMOJI_PICS = [...new Set(EMOJI_THEMES.flatMap((t) => t.pics))];
// An NPC viewer's emoji at a moment of the round, or null. The official data gives the NPC viewers no emoji behaviour
// (real players send them online); this project lets them react so the barrage lives offline too. moment: 'bet' (just
// picked: point at the backed side, or ponder a skip), 'battle' (a reaction), 'result' (the round's outcome for its
// choice). Kept to a sprinkle: a third to a half of them speak per moment, some eight emojis a round.
function npcEmote(moment, choice, right, rnd) {
  const has = (p) => EMOJI_BASIC.includes(p), any = (a) => { const ok = a.filter(has); return ok.length ? ok[Math.floor(rnd() * ok.length)] : null; };
  switch (moment) {
    case 'bet': if (rnd() >= 0.45 || !choice) return null; return choice.skip ? any(['pic_think', 'pic_what']) : any([choice.side ? 'pic_right' : 'pic_left']);
    case 'battle': return rnd() < 0.3 ? any(['pic_shock', 'pic_pray', 'pic_think', 'pic_what']) : null;
    case 'result':
      if (!choice || choice.skip) return rnd() < 0.15 ? any(['pic_what', 'pic_hello']) : null;
      if (rnd() >= 0.55) return null;
      return right ? any(['pic_happy', 'pic_busk', 'pic_hello']) : any(['pic_sad', 'pic_wronged', 'pic_clown', 'pic_shock']);
    default: return null;
  }
}
