// ---- the duel sim, shared by the page and the server (no rendering, no DOM) -------------------------------------------
// Field: the official level (level_act1enemyduel, 15 × 11): 9 lanes, a start column (S) on the left, an end column (E)
// on the right, 11 duel tiles between, forbidden tiles around. Rules from the level's runes: ATK × 1.5, max HP × 0.5,
// enemy move × 0.5, 火与钢 has status resistance (stun / freeze halved). The safe zone, from the client's env prefab
// env_025_act1enemyduel (DUELCFG.env): 60 s in, then every 20 s, the zone closes one tile on each side around the level
// tile (7, 5): 9 × 7, 7 × 5, 5 × 3, 3 × 1 tiles. On a tile outside a unit gets ATK +100 %, ASPD +50, move × 1.5 (not on
// the start / end tiles), and each second one internal-injury stack and stacks × 0.5 % max HP true damage; back inside,
// the state and its stacks are gone (PRTS). Enemy skills use the client's skill data (spCost charged per attack). The
// three 领袖 of 竞猜对决 (自在, 依然“狼之主”, “火与钢”) follow PRTS's 争锋频道 leader page with the numbers of their duel
// data (enemy_database enemy_5054_dqxi / enemy_15023_dqwlfm / enemy_15024_dqreid): see LEADERS below.
// A battle is deterministic for its line-ups and seed: the server computes the outcome before the bets and every client
// replays it identically (IEEE-exact arithmetic only: sqrt, + − × ÷; time is counted in whole steps).
// Globals expected: FIGHTERS (the roster), DUELCFG (the duel config), clamp, lerp.
const POOL = FIGHTERS;
const DCFG = DUELCFG, ENV = DCFG.env;
const AW = 13, AH = 9;                      // playable columns (S … E) and lanes; the forbidden border is drawn around
const byKey = (k) => POOL.find((f) => f.key === k);
const dist = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---- the sim (no rendering): a world of units, deterministic for a seed ------------------------------------------------
const DT = 1 / 30, HZ = 30, BATTLE_MAX = DCFG.consts.battlePhaseTimeMax || 200;
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
function makeWorld(lineups, seed, visual) {
  const W = { units: [], shots: [], t: 0, n: 0, zone: -1, rng: mulberry32(seed), visual, result: null, done: false, events: [] };
  lineups.forEach((groups, side) => {
    const flat = [];
    for (const g of groups) for (let i = 0; i < g.n; i++) flat.push(g.f);
    flat.forEach((f, i) => {
      const lane = i % AH, layer = Math.floor(i / AH);
      const y = lane + 0.5 + (W.rng() - 0.5) * 0.3;
      const x = side === 0 ? 0.55 - layer * 0.18 + (W.rng() - 0.5) * 0.2 : AW - 0.55 + layer * 0.18 + (W.rng() - 0.5) * 0.2;
      W.units.push(makeUnit(f, side, clamp(x, 0.1, AW - 0.1), y, W));
    });
  });
  return W;
}
function makeUnit(f, side, x, y, W) {
  const T = f.talents || {}, SK = f.skillData || {};
  const u = {
    f, side, x, y, maxHp: f.hp * ENV.hpMul, atk: f.atk * ENV.atkMul, defv: f.def, res: f.res, bat: f.bat, aspd: f.aspd,
    ranged: f.way === 'RANGED' || f.way === 'ALL', arts: f.dmg === 'arts', reach: Math.max(0.8, f.range), speed: f.ms * ENV.moveMultiplier,
    cd: 0.3 + W.rng() * 0.6, target: null, retarget: 0, dead: false, stacks: 0, outN: 0, outside: false, pending: [],
    facing: side === 0 ? 1 : -1, stun: 0, stunKind: '', bleed: [], reborn: T['reborn.duration'] || T['Reborn.duration'] ? 1 : 0, rebornT: 0, enhanced: false,
    rangeT: T['rangedamage.interval'] || 0, state: 'idle', attackSeq: 0, attackIv: 1, skillSeq: 0, sp: 0, view: null,
    // the leaders' states (zero for everyone else): damage taken reduced by dr, invincible for invT, a barrier, standing
    // still for hold (the barrier) / charge (溶血骇惧), ATK × atkMul, a 溶血骇惧 on this unit (fear)
    dr: T['Passive.damage_resistance'] || 0, invT: 0, barrier: 0, hold: 0, charge: 0, atkMul: 1, fear: null,
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
  u.hp = u.maxHp;
  return u;
}
function nearestEnemy(W, u) {
  let best = null, bd = 1e9;
  for (const v of W.units) if (!v.dead && !v.rebornT && v.side !== u.side) { const d = dist(v.x - u.x, v.y - u.y); if (d < bd) { bd = d; best = v; } }
  return best;
}
// up to n enemies within reach, nearest first (the main target always first)
function enemiesInReach(W, u, tg, n) {
  const list = [tg];
  const rest = W.units.filter((v) => v !== tg && !v.dead && !v.rebornT && v.side !== u.side && dist(v.x - u.x, v.y - u.y) <= u.reach)
    .sort((a, b) => dist(a.x - u.x, a.y - u.y) - dist(b.x - u.x, b.y - u.y));
  for (const v of rest) { if (list.length >= n) break; list.push(v); }
  return list;
}
// stun / freeze: the target's immunities (enemy_database) and the level's status resistance (half duration); an attack
// in progress is interrupted
function disable(W, v, sec, kind) {
  if (v.dead || v.rebornT > 0 || (v.f.immune && v.f.immune[kind]) || (kind === 'stun' && v.noStun)) return;
  if (RESIST.has(v.f.key)) sec *= 0.5;
  if (sec > v.stun) { v.stun = sec; v.stunKind = kind; }
  v.pending = [];
  if (W.visual) W.events.push([kind, v]);
}
function hurt(W, b, dmg) {
  if (b.dead || b.rebornT > 0 || b.invT > 0) return;
  b.hp -= dmg;
  if (W.visual) b.flash = 0.12;
  if (b.hp > 0) return;
  // a 溶血骇惧 ends with the unit it was on
  if (b.fear) fearOff(W, b);
  // 杰斯顿 and the leaders (reborn): drop, come back after the delay in the second form
  if (b.reborn === 1) {
    const T = b.f.talents;
    b.reborn = 2; b.hp = 0; b.rebornT = T['reborn.duration'] || T['Reborn.duration'] || 4; b.target = null; b.pending = []; b.stun = 0; b.stacks = 0; b.outN = 0;
    b.barrier = 0; b.hold = 0; b.charge = 0;
    if (b.fearOn) fearAllOff(W, b);
    W.events.push(['reborn', b]);
    return;
  }
  b.hp = 0; b.dead = true; W.events.push(['die', b]);
  const T = b.f.talents || {};
  if (T['boom.atk_scale']) {                          // 易爆源石虫 / 自爆冰虫: explode on death (the 冰虫 also freezes)
    for (const v of W.units) if (!v.dead && v.side !== b.side && dist(v.x - b.x, v.y - b.y) <= 1.3) {
      const a = b.atk * T['boom.atk_scale'];
      strike(W, v, Math.max(a * 0.05, a - v.defv));
      if (T['boom.freeze']) disable(W, v, T['boom.freeze'], 'frozen');
    }
    W.events.push(['boom', b]);
  }
}
// physical or arts damage (not true damage): the target's damage reduction, then its barrier, then its HP. A barrier
// that breaks ends its skill.
function strike(W, b, dmg) {
  if (b.dead || b.rebornT > 0) return;
  if (b.dr) dmg *= 1 - b.dr;
  if (b.barrier > 0) {
    const a = Math.min(b.barrier, dmg);
    b.barrier -= a; dmg -= a;
    if (b.barrier <= 0) { b.barrier = 0; b.hold = 0; W.events.push(['barrierbreak', b]); }
  }
  hurt(W, b, dmg);
}
// o (a skill's hit): { stun, pen (share of DEF ignored) }
function hit(W, a, b, mult, o) {
  if (b.dead) return;
  const atk = a.atk * a.atkMul * mult, def = b.defv * (1 - ((o && o.pen) || 0));
  strike(W, b, a.arts ? atk * Math.max(0.05, 1 - b.res / 100) : Math.max(atk * 0.05, atk - def));
  if (W.visual) W.events.push(['hit', b, a]);          // for the effects only (never read by the sim)
  if (o && o.stun) disable(W, b, o.stun, 'stun');
  const T = a.f.talents || {};
  if (T['Bleeding.attack@bleeding_damage']) b.bleed.push({ dps: T['Bleeding.attack@bleeding_damage'], t: T['Bleeding.attack@duration'] || 10 });
  if (T['dot.damage']) b.bleed.push({ dps: T['dot.damage'] / (T['dot.interval'] || 1), t: T['dot.duration'] || 10, arts: true });
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
const foesOf = (W, u) => W.units.filter((v) => !v.dead && !v.rebornT && v.side !== u.side);
// 纬地经天 lands: the cross of tiles around the point; cast: the enemies this cast has already hit
function crossBlast(W, u, x, y, mult, cast) {
  const cx = tileX(x), cy = tileY(y), atk = u.atk * u.atkMul * mult;
  for (const v of W.units) {
    if (v.dead || v.side === u.side || cast.has(v)) continue;
    const tx = tileX(v.x), ty = tileY(v.y);
    if ((tx === cx && Math.abs(ty - cy) <= 1) || (ty === cy && Math.abs(tx - cx) <= 1)) { cast.add(v); strike(W, v, atk * Math.max(0.05, 1 - v.res / 100)); }
  }
  if (W.visual) W.events.push(['cross', u, { x: cx + 0.5, y: cy + 0.5 }]);
}
// a leader's step (after the damage over time, before the stun): the timers of its skills and states
function leaderStep(W, u, T, SK) {
  if (u.invT > 0) u.invT = Math.max(0, u.invT - DT);
  if (u.rushT > 0) u.rushT -= DT;
  // “火与钢”: the low-HP state
  if (T['AtkUp.atk']) { const low = u.hp <= u.maxHp * T['atkup.hp_ratio']; u.atkMul = low ? 1 + T['AtkUp.atk'] : 1; u.dr = low ? T['AtkUp.damage_resistance'] : 0; }
  // “自在”: 纬地经天
  if (SK.CrossAttack) {
    u.crossT -= DT;
    if (u.crossT <= 0) {
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
      if (u.hold <= 0) {
        u.hold = 0;
        if (u.barrier > 0) {
          u.barrier = 0;
          const atk = u.atk * u.atkMul * burst.bb.atk_scale;
          for (const v of W.units) if (!v.dead && v.side !== u.side && dist(v.x - u.x, v.y - u.y) <= burst.bb.range_radius) strike(W, v, atk * Math.max(0.05, 1 - v.res / 100));
          W.events.push(['barrierblast', u]);
        }
      }
    } else if (u.burstT <= 0 && foesOf(W, u).some((v) => dist(v.x - u.x, v.y - u.y) <= burst.bb.range_radius)) {
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
      if (u.charge <= 0) {
        u.charge = 0;
        const tgts = drawN(foesOf(W, u), F.max_target, W.rng);
        if (tgts.length) {
          u.fearOn = tgts; u.fearHp0 = u.hp; u.fsp = 0; u.skillSeq++;
          for (const v of tgts) { if (v.fear) fearOff(W, v); v.fear = { t: 0, src: u }; W.events.push(['fear', v]); }
        }
      }
    } else {
      if (u.fearWait > 0) u.fearWait -= DT;
      u.fsp = Math.min(C.sp, u.fsp + (T['Passive.sp'] || 1) * DT);
      if (u.fsp >= C.sp && u.fearWait <= 0 && foesOf(W, u).length) { u.charge = F.duration_wait; W.events.push(['fearcharge', u]); }
    }
  }
}
// the attack about to start: a skill when its charge (one point an attack) is full — 过气水手 stuncombat (stuns the
// target), 杰斯顿 ironsandstorm (warden form: stuns up to max_target targets) / armorpiercing (killer form: `times` hits,
// ignoring def_penetrate of the DEF); 庞贝 hits up to four targets at once (handbook)
function chooseAttack(W, u, tg) {
  const SK = u.f.skillData || {};
  const key = SK.armorpiercing && u.enhanced ? 'armorpiercing' : SK.ironsandstorm && !u.enhanced ? 'ironsandstorm' : SK.stuncombat ? 'stuncombat' : null;
  let tgts = [tg], o = null, times = 1, skill = false;
  if (key) {
    const s = SK[key];
    if (u.sp >= s.sp) {
      u.sp = 0; skill = true;
      if (key === 'stuncombat') o = { stun: s.bb.stun };
      else if (key === 'ironsandstorm') { o = { stun: s.bb.stun }; tgts = enemiesInReach(W, u, tg, s.bb.max_target || 1); }
      else { o = { pen: s.bb.def_penetrate }; times = s.bb.times || 1; }
    } else u.sp++;
  }
  if (u.f.key === 'enemy_5053_dqllme') tgts = enemiesInReach(W, u, tg, 4);
  // the leaders' second forms: “自在” attacks twice (a second enemy when one is in reach), 依然“狼之主” hits twice
  if (u.enhanced && u.f.talents['reborn.atk']) { const two = enemiesInReach(W, u, tg, 2); if (two.length > 1) tgts = two; else times = 2; }
  if (u.enhanced && u.f.talents['Passive2.atk']) times = 2;
  return { tgts, o, times, skill };
}
function simStep(W) {
  const z = zoneAt(W.n);
  if (z !== W.zone) { W.zone = z; if (W.visual) W.events.push(['zone', null]); }
  for (const u of W.units) {
    if (u.dead) continue;
    if (u.rebornT > 0) {
      u.rebornT -= DT;
      if (u.rebornT <= 0) {
        const T = u.f.talents; u.rebornT = 0; u.hp = u.maxHp * (T['Reborn.hp_ratio'] || 1); u.enhanced = true;
        u.atk += (T['enhance.atk'] || 0) * ENV.atkMul; u.defv += T['enhance.def'] || 0; u.res += T['enhance.magic_resistance'] || 0;
        u.bat = Math.max(0.3, u.bat + (T['enhance.base_attack_time'] || 0)); u.speed += (T['enhance.move_speed'] || 0) * ENV.moveMultiplier;
        if (u.f.skillData && u.f.skillData.armorpiercing) { u.ranged = false; u.arts = false; u.reach = 0.8; u.sp = 0; }
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
      if (++u.outN % HZ === 0) { u.stacks++; hurt(W, u, u.stacks * ENV.ringHpRatio * u.maxHp); }
    } else { u.outN = 0; u.stacks = 0; }
    const T = u.f.talents || {};
    if (T['periodic_damage.damage']) hurt(W, u, T['periodic_damage.damage'] * DT);
    if (u.bleed.length) { for (const b of u.bleed) { hurt(W, u, b.arts ? b.dps * DT * Math.max(0.05, 1 - u.res / 100) : b.dps * DT); b.t -= DT; } u.bleed = u.bleed.filter((b) => b.t > 0); }
    // 溶血骇惧 on this unit: HP lost at a rate rising over duration_bleed seconds to hp_ratio of max HP a second
    if (u.fear) { const F = u.fear.src.f.skillData.FearCage.bb; u.fear.t += DT; hurt(W, u, F.hp_ratio * u.maxHp * Math.min(1, u.fear.t / F.duration_bleed) * DT); }
    if (u.dead || u.rebornT > 0) continue;
    if (u.leader) { leaderStep(W, u, T, u.f.skillData); if (u.dead || u.rebornT > 0) continue; }
    // 庞贝: a blast at everything in range every few seconds
    if (u.rangeT) {
      u.rangeT -= DT;
      if (u.rangeT <= 0) {
        u.rangeT = T['rangedamage.interval'];
        for (const v of W.units) if (!v.dead && v.side !== u.side && dist(v.x - u.x, v.y - u.y) <= u.reach) strike(W, v, T['rangedamage.attack@damage'] * Math.max(0.05, 1 - v.res / 100));
        W.events.push(['blast', u]);
      }
    }
    if (u.stun > 0) { u.stun -= DT; if (u.stun <= 0) { u.stun = 0; u.stunKind = ''; } continue; }
    // queued hits (the attack clip's hit frame)
    u.pending = u.pending.filter((p) => {
      p.t -= DT;
      if (p.t > 0) return true;
      for (const tg of p.tgts) {
        if (tg.dead || tg.rebornT) continue;
        for (let i = 0; i < p.times; i++) {
          if (u.ranged) W.shots.push({ src: u, tgt: tg, x: u.x + u.facing * 0.3, y: u.y, mult: p.mult, o: p.o, g: null, delay: i * 0.12 });
          else hit(W, u, tg, p.mult, p.o);
        }
      }
      return false;
    });
    u.retarget -= DT;
    if (!u.target || u.target.dead || u.target.rebornT || u.retarget <= 0) { u.target = nearestEnemy(W, u); u.retarget = 0.5; }
    const tg = u.target;
    u.cd -= DT;
    if (!tg) { u.state = 'idle'; continue; }
    const dx = tg.x - u.x, dy = tg.y - u.y, d = dist(dx, dy);
    if (Math.abs(dx) > 0.05) u.facing = dx > 0 ? 1 : -1;
    const gate = tileX(u.x) === 0 || tileX(u.x) === AW - 1;    // the start / end tiles give no move speed
    if (u.charge > 0) { u.state = 'idle'; continue; }          // 溶血骇惧's wind-up: no move, no attack
    if (d > u.reach && u.hold > 0) u.state = 'idle';          // behind the barrier: no move
    else if (d > u.reach) {
      const rush = u.rushT > 0 ? 1 + u.f.skillData.Rush.bb.move_speed : 1;
      const step = Math.min(d - u.reach * 0.9, u.speed * (u.outside && !gate ? ENV.ringMove : 1) * rush * DT);
      u.x += dx / d * step; u.y += dy / d * step;
      u.state = 'move';
    } else if (u.cd <= 0) {
      let aspd = u.aspd + (u.outside ? ENV.ringAspd : 0);
      if (T['selfbuff.attack_speed'] && u.hp < u.maxHp * (T['selfbuff.hp_ratio'] || 0.5)) aspd += T['selfbuff.attack_speed'];
      if (u.fear) aspd = Math.max(10, aspd + u.fear.src.f.skillData.FearCage.bb.attack_speed);
      const iv = u.bat * 100 / aspd;
      u.cd = iv;
      const aa = u.f.attackAnim, dur = aa ? aa.dur : 1, ts = Math.max(1, dur / Math.max(0.2, iv));
      const a = chooseAttack(W, u, tg);
      u.pending.push({ t: (aa ? aa.hit : 0.35) / ts, tgts: a.tgts, o: a.o, times: a.times, mult: u.outside ? 1 + ENV.ringAtk : 1 });
      u.state = 'attack'; u.attackSeq++; u.attackIv = iv;
      if (a.skill) u.skillSeq++;
    } else if (u.state === 'move') u.state = 'idle';
  }
  // separation (ground units only)
  const live = W.units.filter((u) => !u.dead && !u.rebornT && !u.f.fly);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j], dx = b.x - a.x, dy = b.y - a.y, d = dist(dx, dy) || 0.01;
    if (d < 0.5) { const push = (0.5 - d) * 0.5, nx = dx / d, ny = dy / d; a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push; }
  }
  for (const u of W.units) { u.x = clamp(u.x, 0.1, AW - 0.1); u.y = clamp(u.y, 0.1, AH - 0.1); }
  // shots
  W.shots = W.shots.filter((s) => {
    if (s.delay > 0) { s.delay -= DT; return true; }
    const dx = s.tgt.x - s.x, dy = s.tgt.y - s.y, d = dist(dx, dy);
    if (d < 0.3 || s.tgt.dead) {
      if (s.o && s.o.cross) crossBlast(W, s.src, s.tgt.x, s.tgt.y, s.mult, s.o.cross);
      else if (!s.tgt.dead) hit(W, s.src, s.tgt, s.mult, s.o);
      if (s.g) s.g.destroy();
      return false;
    }
    const v = 9 * DT;
    s.x += dx / d * Math.min(v, d); s.y += dy / d * Math.min(v, d);
    return true;
  });
  W.n++; W.t = W.n * DT;
  // the end: one side wiped out (both at once: a draw, everyone who bet wins), else at the phase limit the side with
  // more HP left (an interpretation: neither the data nor PRTS says how a timeout is judged)
  const alive = [0, 1].map((sd) => W.units.filter((u) => u.side === sd && !u.dead));
  if (!alive[0].length || !alive[1].length || W.t >= BATTLE_MAX) {
    let w;
    if (!alive[0].length && !alive[1].length) w = 'draw';
    else if (!alive[0].length) w = 1;
    else if (!alive[1].length) w = 0;
    else {
      const hp = [0, 1].map((sd) => { const all = W.units.filter((u) => u.side === sd); return all.reduce((a, u) => a + u.hp / u.maxHp, 0) / all.length; });
      w = Math.abs(hp[0] - hp[1]) < 0.02 ? 'draw' : hp[0] > hp[1] ? 0 : 1;
    }
    W.done = true; W.result = w;
  }
}
// the outcome of a match-up, computed ahead (headless, same seed and steps as the replay)
function predict(lineups, seed) {
  const W = makeWorld(lineups, seed, false);
  while (!W.done) simStep(W);
  return { winner: W.result, time: W.t };
}

// ---- line-ups: the round's table (target score ± random, types per side, pool) over the official per-unit scores -----
const POOL_FIELD = { poolNormal: 'normal', poolSmallEnemy: 'small', poolBoss: 'boss' };
const sideScore = (gs) => gs.reduce((s, g) => s + g.f.score * g.n, 0);
const sidePower = (gs) => gs.reduce((s, g) => s + g.n * g.f.power, 0);
const pick = (a, rng = Math.random) => a[Math.floor(rng() * a.length)];
function pickWeighted(list, w, rng) {
  const tot = list.reduce((a, x) => a + w(x), 0);
  let r = rng() * tot;
  for (const x of list) { r -= w(x); if (r <= 0) return x; }
  return list[list.length - 1];
}
function makeSide(rd, side, rng) {
  const kmin = side ? rd.enemySideMinRight : rd.enemySideMinLeft, kmax = side ? rd.enemySideMaxRight : rd.enemySideMaxLeft;
  const field = POOL_FIELD[side ? rd.enemyPoolRight : rd.enemyPoolLeft] || 'normal';
  const target = rd.enemyScore + (rng() * 2 - 1) * rd.enemyScoreRandom, lo = rd.enemyScore - rd.enemyScoreRandom, hi = rd.enemyScore + rd.enemyScoreRandom;
  // the pool's enemies that fit under the target; a pool none of which fit (竞猜对决 round 5's 领袖 pool: 300 each against
  // 175 ± 75) gives one of each chosen type over the target (an interpretation: every chosen type appears at least once)
  const inPool = POOL.filter((f) => (f.pool[field] || 0) > 0 && f.score < 9999), fitting = inPool.filter((f) => f.score <= target);
  const over = fitting.length < kmin, cands = over ? inPool : fitting;
  let best = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const k = kmin + Math.floor(rng() * (kmax - kmin + 1));
    if (cands.length < k) continue;
    const types = [];
    while (types.length < k) types.push(pickWeighted(cands.filter((x) => !types.includes(x)), (x) => x.pool[field], rng));
    const gs = types.map((f) => ({ f, n: 1 }));
    let total = sideScore(gs), guard = 0;
    while (total < target && guard++ < 200) {
      const fit = gs.filter((x) => total + x.f.score <= hi);
      if (!fit.length) break;
      fit[Math.floor(rng() * fit.length)].n++;
      total = sideScore(gs);
    }
    const units = gs.reduce((a, g) => a + g.n, 0);
    const miss = (total < lo ? lo - total : total > hi ? total - hi : 0) + (units > 26 ? 50 : 0);
    if (!best || miss < best.miss) best = { gs, miss };
    if (miss === 0 || over) break;
  }
  return best.gs;
}
function makeLineups(rd, rng) { return [makeSide(rd, 0, rng), makeSide(rd, 1, rng)]; }

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
    default: return rnd() < (C.npcCorrectProb ?? 0.3) ? knows : sc[0] === sc[1] ? coin() : sc[0] > sc[1] ? 0 : 1;
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
// the round table's row for round r (1-based)
const standRow = (rows, r) => rows[Math.min(r, rows.length) - 1];
// a viewer's stand state: rounds guessed right, the 观众保护 (still held; taken in round shieldAt), saved this round
const standSeat = () => ({ pass: 0, shield: true, shieldAt: 0, saved: false });
// at the start of round r: past the protected rounds nobody holds a shield any more
function standShields(players, r) { if (r > STAND.shieldTurn) for (const p of players) p.shield = false; }
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

// The emoji panel's pictures (the battle's emoticon theme, enabledEmoticonThemeIdList → display_meta_table).
const EMOJI_PICS = (DCFG.emoticons && DCFG.emoticons[0] ? DCFG.emoticons[0].pics : []);
// An NPC viewer's emoji at a moment of the round, or null. The official data gives the NPC viewers no emoji behaviour
// (real players send them online); this project lets them react so the barrage lives offline too. moment: 'bet' (just
// picked: point at the backed side, or ponder a skip), 'battle' (a reaction), 'result' (the round's outcome for its
// choice). Kept to a sprinkle: a third to a half of them speak per moment, some eight emojis a round.
function npcEmote(moment, choice, right, rnd) {
  const has = (p) => EMOJI_PICS.includes(p), any = (a) => { const ok = a.filter(has); return ok.length ? ok[Math.floor(rnd() * ok.length)] : null; };
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
