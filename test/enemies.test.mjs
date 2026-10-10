// The duel enemies' skills and talents (shared/sim.js ENEMIES, GIANTS, SURPRISE): PRTS 争锋频道/选手信息's text with
// the numbers of the duel data, one mechanism at a time on a small staged battle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSim } from './sim-env.mjs';

const SIM = loadSim();
const F = (k) => SIM.FIGHTERS_ALL.find((f) => f.key === k);
const side = (list) => list.map(([k, n]) => ({ f: F(k), n: n || 1 }));
const world = (left, right, seed = 7) => SIM.makeWorld([side(left), side(right)], seed, false);
const steps = (W, sec) => { for (let i = 0; i < Math.round(sec / SIM.DT); i++) SIM.simStep(W); };
// a target that stands, never attacks and does not fall
const dummy = (v, x, y) => { v.passive = true; v.speed = 0; v.hp = v.maxHp = 1e9; if (x !== undefined) { v.x = x; v.y = y; } return v; };
const of = (W, key) => W.units.filter((u) => u.f.key === key);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const SAKAZ = 'enemy_5032_dqmon';

test('元素损伤 (the “·我方” versions): 灼燃 bursts at 1000 (a 领袖 2000) for 7000 and RES −20 10 s; 凋亡 800 a second and 虚弱', () => {
  const W = world([[SAKAZ]], [[SAKAZ]]), v = dummy(W.units[1]);
  SIM.elem(W, v, 'burn', 999.5); assert.equal(v.hp, 1e9);
  SIM.elem(W, v, 'burn', 0.5); assert.equal(v.hp, 1e9 - 7000); assert.equal(v.bRes, -20);
  SIM.elem(W, v, 'burn', 5000); assert.equal(v.hp, 1e9 - 7000, 'no build-up while it bursts');
  steps(W, 10.05); assert.equal(v.bRes, 0);
  const hp = v.hp; SIM.elem(W, v, 'apo', 1000); assert.equal(v.bAtk, -0.5);
  steps(W, 1); assert.ok(near(hp - v.hp, 800, 1), String(hp - v.hp)); assert.ok(v.bAtk > -0.5 && v.bAtk < -0.45);
  steps(W, 14.1); assert.equal(v.bAtk, 0);
  const L = world([[SAKAZ]], [['enemy_5054_dqxi']]), boss = dummy(L.units[1]);
  SIM.elem(L, boss, 'burn', 1500); assert.equal(boss.hp, 1e9); SIM.elem(L, boss, 'burn', 500); assert.equal(boss.hp, 1e9 - 7000);
});

test('寒冷: attack speed −30; chilled again, it freezes; 抵抗 (冰手术师, handbook) halves it', () => {
  const W = world([['enemy_5043_dqgscr']], [[SAKAZ]]), [ice, v] = W.units;
  SIM.chill(W, v, 5); assert.equal(v.cold, 5); assert.equal(v.stun, 0);
  SIM.chill(W, v, 5); assert.equal(v.stunKind, 'frozen'); assert.equal(v.stun, 5);
  assert.equal(ice.resist, true); SIM.chill(W, ice, 5); assert.equal(ice.cold, 2.5);
});

test('禁锢 → 解放 before the 4th attack (锁链拳手: ATK +50 %, 60 % of DEF ignored; 衣架射手: arts); 杰斯顿\'s killer form frees all', () => {
  const W = world([['enemy_5037_dqdbox']], [[SAKAZ]]), [u] = W.units;
  dummy(W.units[1], 1.5, u.y);
  assert.equal(u.confined, true); assert.equal(u.bAspd, -50);
  while (u.atkN < 3) SIM.simStep(W);
  assert.equal(u.confined, true);
  while (u.atkN < 4) SIM.simStep(W);
  assert.equal(u.confined, false); assert.equal(u.bAspd, 0); assert.equal(u.bAtk, 0.5); assert.equal(u.pen, 0.6);
  const J = world([['enemy_5055_dqkill']], [['enemy_5038_dqiprr_2', 2]]), [jes, ...pris] = J.units;
  for (const v of pris) dummy(v, 10, v.y);
  assert.ok(pris.every((v) => v.confined && !v.arts));
  SIM.hurt(J, jes, 1e9); steps(J, 4.1);
  assert.equal(jes.enhanced, true); assert.ok(pris.every((v) => !v.confined && v.arts));
});

test('嘲讽等级: in reach, the highest first (扎人的石头 +1 over a nearer 0; a nearer 0 over 橡胶弹狙击手 −1); 扎人的石头 strikes back 300 arts', () => {
  const W = world([[SAKAZ]], [['enemy_5048_dqingd'], ['enemy_5030_dqpro_3']]), [u, rock, dog] = W.units;
  u.x = 5; u.y = 4.5; dummy(rock, 5.7, 4.5); dummy(dog, 5.4, 4.5); u.retarget = 0; u.reach = 1;
  SIM.simStep(W); assert.equal(u.target, rock);
  const G = world([[SAKAZ]], [['enemy_15094_dqgent'], ['enemy_5030_dqpro_3']]), [g, gent, dog2] = G.units;
  g.x = 5; g.y = 4.5; dummy(gent, 5.4, 4.5); dummy(dog2, 5.7, 4.5); g.retarget = 0; g.reach = 1;
  SIM.simStep(G); assert.equal(g.target, dog2);
  const hp = u.hp; SIM.strike(W, rock, 100, u, 'phys');
  assert.ok(near(hp - u.hp, 300 * (1 - u.res / 100)), String(hp - u.hp));
});

test('what falls leaves something: the side stands meanwhile (“交通亭”: 1 s, a blast and a 速胜卫士); 大喷蛛 spawns every 5 s', () => {
  const W = world([['enemy_15088_dqterm']], [[SAKAZ]]), [t, v] = W.units;
  dummy(v, t.x + 0.8, t.y);
  SIM.hurt(W, t, 1e9); SIM.simStep(W);
  assert.equal(W.done, false); assert.equal(of(W, 'enemy_15086_dqcbld').length, 0);
  steps(W, 1);
  assert.equal(of(W, 'enemy_15086_dqcbld').length, 1);
  assert.ok(1e9 - v.hp >= t.atk * 2 - v.defv - 1, String(1e9 - v.hp));
  const S = world([['enemy_15019_dqharc']], [[SAKAZ]]);
  dummy(S.units[1], 12, 4.5);
  steps(S, 4.9); assert.equal(of(S, 'enemy_15020_dqplas').length, 0);
  steps(S, 0.2); assert.equal(of(S, 'enemy_15020_dqplas').length, 1);
  steps(S, 5); assert.equal(of(S, 'enemy_15020_dqplas').length, 2);
});

test('taken off the field, no reborn: “门” takes one enemy as it falls; 极饿先锋\'s first attack swallows (then DEF +700)', () => {
  const W = world([['enemy_15018_dqskzc']], [['enemy_5055_dqkill']]), [door, jes] = W.units;
  SIM.hurt(W, door, 1e9); SIM.simStep(W);
  assert.equal(jes.dead, true); assert.equal(jes.rebornT, 0); assert.equal(W.result, 'draw');
  const K = world([['enemy_15079_dqkodo']], [['enemy_5055_dqkill']]), [kodo, j2] = K.units;
  j2.x = kodo.x + 0.6; j2.y = kodo.y; j2.passive = true; kodo.cd = 0;
  SIM.simStep(K);
  assert.equal(j2.dead, true); assert.equal(j2.rebornT, 0); assert.equal(kodo.bDef, 700); assert.ok(near(kodo.bMs, -0.3));
});

test('惊喜 (蜜果城): covered, they wait off the field and drop in behind the other side at 150 % move for 5 s; at 60 s at the latest', () => {
  const W = world([['enemy_15034_dqdrp', 2], [SAKAZ, 4]], [['enemy_5034_dqield', 4]]);
  assert.equal(W.reserve.length, 2); assert.equal(of(W, 'enemy_15034_dqdrp').length, 0);
  for (const u of W.units) { u.passive = true; u.speed = 0; }
  W.rng = () => 0.99;
  steps(W, 59.9); assert.equal(W.reserve.length, 2);
  steps(W, 0.2);
  const drop = of(W, 'enemy_15034_dqdrp');
  assert.equal(drop.length, 2); assert.equal(W.reserve.length, 0);
  for (const u of drop) { assert.ok(u.x > SIM.ENV.zoneCentre[0] + 4); assert.equal(u.bMsMul, 1.5); }
  steps(W, 5.1); for (const u of drop) assert.equal(u.bMsMul, 1);
  // alone (no one to cover them) they enter with the rest
  assert.equal(world([['enemy_15034_dqdrp', 3]], [[SAKAZ]]).reserve.length, 0);
});

test('协同 (绿藤城): a group enters whole; 玉双剑 cuts the trio\'s damage taken to 60 %; a knight\'s partner falls → rage', () => {
  const W = world([['enemy_15072_dqlbgg']], [[SAKAZ]]);
  // (compared as JSON: arrays made inside the sim's VM context have another Array prototype)
  assert.equal(JSON.stringify(W.units.filter((u) => u.side === 0).map((u) => u.f.key).sort()), JSON.stringify(['enemy_15070_dqhlgy', 'enemy_15071_dqyrzf', 'enemy_15072_dqlbgg']));
  SIM.simStep(W);
  for (const u of W.units.filter((x) => x.side === 0)) assert.ok(near(u.bDr, 0.4), u.f.key);
  const K = world([['enemy_15073_dqkght']], [[SAKAZ]]), [rider, archer] = K.units;
  assert.equal(archer.f.key, 'enemy_15074_dqdght');
  SIM.hurt(K, archer, 1e9); SIM.simStep(K);
  assert.ok(near(rider.bAtk, 0.8)); assert.equal(rider.bAspd, 100); assert.ok(near(rider.bMs, 1.5));
});

test('调停的意志 below half HP trades places with Mon2tr, who strikes about it (stunned 5 s)', () => {
  const W = world([['enemy_15075_dqzklz']], [[SAKAZ]]), [kal, m3, v] = W.units;
  kal.x = 3; kal.y = 2; m3.x = 6; m3.y = 6; dummy(v, 6.5, 6);
  SIM.hurt(W, kal, kal.maxHp * 0.51);
  assert.equal(kal.x, 6); assert.equal(m3.x, 3); assert.ok(kal.noAtk > 4.9);
  const W2 = world([['enemy_15075_dqzklz']], [[SAKAZ]]), [k2, m2, v2] = W2.units;
  k2.x = 3; k2.y = 2; m2.x = 6; m2.y = 6; dummy(v2, 3.5, 2);
  SIM.hurt(W2, k2, k2.maxHp * 0.51);
  assert.equal(v2.stunKind, 'stun'); assert.equal(v2.stun, 5);
});

test('barriers absorb three times the data (玻璃球打手 10002, 覆面大锤客 6000), against arts only; DEF / max HP while they hold', () => {
  const W = world([['enemy_15027_dqmtrs'], ['enemy_15059_dqhmmr']], [[SAKAZ]]), [g, h] = W.units;
  assert.equal(g.barrier, 10002); assert.equal(g.bDef, 1750); assert.equal(h.barrier, 6000);
  assert.equal(h.maxHp, h.f.hp * 0.5 * 1.5);
  let hp = g.hp; SIM.strike(W, g, 100, null, 'phys'); assert.equal(hp - g.hp, 100); assert.equal(g.barrier, 10002);
  SIM.strike(W, g, 10100, null, 'arts'); assert.equal(g.barrier, 0); assert.equal(g.bDef, 0); assert.equal(g.bMs, 2);
  SIM.strike(W, h, 7000, null, 'arts'); assert.equal(h.barrier, 0); assert.equal(h.maxHp, h.f.hp * 0.5); assert.ok(h.hp <= h.maxHp);
});

test('“庞贝”: from the first enemy within 0.8, every 10 s 1000 arts within 1.4', () => {
  const W = world([['enemy_5053_dqllme']], [[SAKAZ], ['enemy_5034_dqield']]), [p, a, b] = W.units;
  p.x = 6; p.y = 4.5; p.speed = 0; p.cd = 1e9; dummy(a, 9, 4.5); dummy(b, 7.6, 4.5);
  steps(W, 12); assert.equal(a.hp, 1e9); assert.equal(b.hp, 1e9);
  a.x = 6.7; steps(W, 9.9); assert.equal(a.hp, 1e9);
  steps(W, 0.2); assert.ok(near(1e9 - a.hp, 1000 * (1 - a.res / 100))); assert.equal(b.hp, 1e9);
});

test('weak sides: 勇敢的壳 takes −80 % from behind; 石头脑袋 −80 % from the front', () => {
  const W = world([['enemy_15053_dqtrtl'], ['enemy_15055_dqrhcr']], [[SAKAZ]]), [shell, head, v] = W.units;
  for (const u of [shell, head]) { u.x = 5; u.facing = 1; }
  v.x = 4; let hp = shell.hp; SIM.strike(W, shell, 1000, v, 'phys'); assert.ok(near(hp - shell.hp, 200));
  v.x = 6; hp = shell.hp; SIM.strike(W, shell, 1000, v, 'phys'); assert.equal(hp - shell.hp, 1000);
  hp = head.hp; SIM.strike(W, head, 1000, v, 'phys'); assert.ok(near(hp - head.hp, 200));
});

test('高敏感积藏者 splits below half HP (once; the copy at the same HP share cannot)', () => {
  const W = world([['enemy_15048_dqdivi']], [[SAKAZ]]), [u] = W.units;
  SIM.hurt(W, u, u.maxHp * 0.6); SIM.simStep(W);
  const all = of(W, 'enemy_15048_dqdivi');
  assert.equal(all.length, 2); assert.ok(near(all[1].hp / all[1].maxHp, u.hp / u.maxHp, 0.01)); assert.equal(all[1].noSplit, true);
  SIM.hurt(W, all[1], all[1].hp * 0.5); SIM.simStep(W); assert.equal(of(W, 'enemy_15048_dqdivi').length, 2);
});

test('巨型 (岁相, “萨米的意志”): in the start column, never moving, reaching the whole field; a melee enemy fights it from the column\'s edge', () => {
  const W = world([['enemy_15068_dqsui']], [[SAKAZ]]), [sui, v] = W.units;
  v.hp = v.maxHp = 1e9;
  assert.equal(sui.giant, true); assert.equal(sui.x, 0.5);
  steps(W, 32);
  assert.equal(sui.x, 0.5);
  assert.ok(v.x < 1.0 + 0.8 + 0.05, String(v.x));
  assert.ok(sui.hp < sui.maxHp, 'the melee enemy reached it');
});
