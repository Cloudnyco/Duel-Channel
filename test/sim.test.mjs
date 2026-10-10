// The duel sim: determinism, the golden battles, the official rules it encodes (line-up tolerance, the safe zone's
// steps, the bet settlement, 竞猜对决's picks, 观众保护, end and standings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSim, matchRounds, digest } from './sim-env.mjs';

const SIM = loadSim();
const rounds = matchRounds(SIM);
const byKey = (k) => SIM.POOL.find((f) => f.key === k);
const run = (L, seed, traps) => { const W = SIM.makeWorld(L, seed, false, traps); while (!W.done) SIM.simStep(W); return W; };

test('a battle is deterministic for its line-ups and seed', () => {
  const L = SIM.makeLineups(rounds[5], SIM.mulberry32(1234));
  assert.equal(digest(run(L, 99)), digest(run(L, 99)));
});

test('the golden battles replay identically (rules or numbers changed? run tools/golden.mjs and review)', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
  assert.ok(cases.length >= 20);
  for (const c of cases) {
    const rd = SIM.DCFG.rounds[c.roundId];
    const L = SIM.makeLineups(rd, SIM.mulberry32(c.seed ^ 0x5bd1e995));
    // (compared as JSON: arrays made inside the sim's VM context have another Array prototype)
    assert.equal(JSON.stringify(L.map((s) => s.map((g) => [g.f.key, g.n]))), JSON.stringify(c.lineups), `line-ups of round ${c.round} seed ${c.seed}`);
    const W = run(L, c.seed, c.traps);
    assert.equal(W.result, c.winner, `winner, round ${c.round} seed ${c.seed}`);
    assert.equal(W.n, c.steps, `end step, round ${c.round} seed ${c.seed}`);
    assert.equal(createHash('sha256').update(digest(W)).digest('hex').slice(0, 16), c.hash, `final state, round ${c.round} seed ${c.seed}`);
  }
});

// PRTS 争锋频道/分配规则: the budget (enemyScore ± random) split point by point among the round's types; a type sends
// units while its share pays (the n-th costs base + (n − 1) × extra), one more by chance, at least one
test('line-ups follow PRTS\'s allocation: types per round, none on both sides, each unit paid for (the last by chance)', () => {
  assert.equal(SIM.unitCost(byKey('enemy_5031_dqrtar_2'), 0), 15); assert.equal(SIM.unitCost(byKey('enemy_5031_dqrtar_2'), 2), 25);
  for (const rd of Object.values(SIM.DCFG.rounds)) for (let i = 0; i < 12; i++) {
    const L = SIM.makeLineups(rd, SIM.mulberry32(i * 7919 + rd.round));
    const keys = L.map((s) => s.map((g) => g.f.key));
    assert.ok(!keys[0].some((k) => keys[1].includes(k)), `${rd.roundId}: a type on both sides`);
    L.forEach((side, sd) => {
      const kmin = sd ? rd.enemySideMinRight : rd.enemySideMinLeft, kmax = sd ? rd.enemySideMaxRight : rd.enemySideMaxLeft;
      assert.ok(side.length >= Math.min(kmin, 1) && side.length <= kmax, `${rd.roundId}: ${side.length} types`);
      // without each type's last unit (the one that may come by chance), the side fits its budget
      let paid = 0;
      for (const g of side) { assert.ok(g.n >= 1); for (let k = 0; k < g.n - 1; k++) paid += SIM.unitCost(g.f, k); }
      assert.ok(paid <= rd.enemyScore + rd.enemyScoreRandom + 1e-9, `${rd.roundId}: ${paid}`);
    });
  }
});

test('the safe zone: none before 60 s, then 9×7, 7×5, 5×3, 3×1 every 20 s (env_025_act1enemyduel)', () => {
  const at = (s) => SIM.zoneAt(Math.round(s * 30));
  assert.equal(at(59.9), -1);
  assert.equal(at(60), 0); assert.equal(at(79.9), 0); assert.equal(at(80), 1); assert.equal(at(100), 2); assert.equal(at(120), 3); assert.equal(at(190), 3);
  const sizes = [0, 1, 2, 3].map((z) => { const r = SIM.zoneRect(z); return [r.x1 - r.x0, r.y1 - r.y0]; });
  assert.equal(JSON.stringify(sizes), JSON.stringify([[9, 7], [7, 5], [5, 3], [3, 1]]));
  // a unit on the centre tile is inside every zone, one at the start column outside the first
  const u = (x, y) => ({ x, y });
  for (let z = 0; z < 4; z++) assert.equal(SIM.outsideZone(u(6.5, 4.5), z), false);
  assert.equal(SIM.outsideZone(u(0.5, 4.5), 0), true);
});

test('settlement: a right 支持 earns the stake, 全力支持 twice; a wrong one loses it; a draw pays everyone', () => {
  const rd = rounds[0], mk = () => ({ pts: 10000, out: false, played: 0, streak: 0, stats: { skip: 0, all: 0, normal: 0, forced: 0 } });
  let p = mk(); SIM.settleOne(p, { side: 0, kind: 'normal' }, rd, 0); assert.equal(p.pts, 10000 + rd.roundScore);
  p = mk(); SIM.settleOne(p, { side: 0, kind: 'all' }, rd, 0); assert.equal(p.pts, 10000 + 2 * rd.roundScore);
  p = mk(); SIM.settleOne(p, { side: 1, kind: 'normal' }, rd, 0); assert.equal(p.pts, 10000 - rd.roundScore);
  p = mk(); SIM.settleOne(p, { side: 1, kind: 'all' }, rd, 0); assert.equal(p.pts, 0); assert.equal(p.out, true);
  p = mk(); SIM.settleOne(p, { side: 1, kind: 'normal' }, rd, 'draw'); assert.equal(p.pts, 10000 + rd.roundScore);
  p = mk(); SIM.settleOne(p, { skip: true }, rd, 0); assert.equal(p.pts, 10000);
});

test('the level\'s runes are applied: ATK × 1.5, max HP × 0.5', () => {
  const f = byKey('enemy_5032_dqmon');
  const W = SIM.makeWorld([[{ f, n: 1 }], [{ f, n: 1 }]], 1, false);
  assert.equal(W.units[0].maxHp, f.hp * 0.5);
  assert.equal(W.units[0].atk, f.atk * 1.5);
});

test('emojis: the battle theme\'s 12 pictures; NPC reactions only use them and fit the moment', () => {
  // five themes: the duel's basic one (12) first, then the four others (6 each)
  assert.deepEqual(SIM.EMOJI_THEMES.map((t) => t.pics.length), [12, 6, 6, 6, 6]);
  assert.equal(SIM.EMOJI_THEMES[0].id, 'emticon_duel_basic');
  assert.equal(SIM.EMOJI_BASIC[0], 'pic_left'); assert.equal(SIM.EMOJI_BASIC[1], 'pic_right');
  assert.equal(SIM.EMOJI_PICS.length, 36);
  const rnd = SIM.mulberry32(7), seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const left = SIM.npcEmote('bet', { side: 0, kind: 'normal' }, null, rnd), right = SIM.npcEmote('bet', { side: 1, kind: 'all' }, null, rnd);
    assert.ok(left === null || left === 'pic_left'); assert.ok(right === null || right === 'pic_right');
    for (const [m, ch, ok] of [['battle', null, null], ['result', { side: 0, kind: 'normal' }, true], ['result', { side: 0, kind: 'normal' }, false], ['result', { skip: true }, null]]) {
      const pic = SIM.npcEmote(m, ch, ok, rnd);
      if (pic) { assert.ok(SIM.EMOJI_BASIC.includes(pic), pic); seen.add(pic); }
      if (m === 'result' && ok === true) assert.ok(!['pic_sad', 'pic_wronged', 'pic_clown'].includes(pic));
      if (m === 'result' && ok === false) assert.ok(!['pic_happy', 'pic_busk'].includes(pic));
    }
  }
  assert.ok(seen.size >= 8, [...seen].join());
});

test("竞猜对决: up to 30 seats; every round in the three events' versions; 青草城's round 5: small enemies against one 领袖", () => {
  assert.equal(SIM.isStand('multiStandMatch'), true); assert.equal(SIM.isStand('multiStandRoom'), true); assert.equal(SIM.isStand('multiOperationMatch'), false);
  assert.equal(SIM.DCFG.modes.multiStandMatch.maxPlayer, 30); assert.equal(SIM.DCFG.modes.multiStandRoom.maxPlayer, 30);
  assert.deepEqual({ ...SIM.STAND }, { shieldTurn: 5, cap: 60, npcMaxRight: 3 });
  // the three events' versions of every round; a match draws one each round
  const st = SIM.roundTable('multiStandMatch');
  assert.equal(st.length, 10);
  for (const v of st) assert.equal(JSON.stringify(v.map((r) => r.act)), JSON.stringify(['act1enemyduel', 'act2enemyduel', 'act3enemyduel']));
  assert.equal(SIM.standRow(st, 1)[0].round, 1); assert.equal(SIM.standRow(st, 10)[0].round, 10); assert.equal(SIM.standRow(st, 37)[0].round, 10);
  const seen = new Set(), rnd = SIM.mulberry32(3);
  for (let i = 0; i < 60; i++) seen.add(SIM.pickRound(st[4], rnd).act);
  assert.equal(seen.size, 3);
  // 青草城's round 5: small enemies against one kind from the 领袖 pool (merged: 绿藤城 also puts strong common enemies in
  // it); a 领袖 (300, over the target) stands alone
  const r5 = st[4].find((r) => r.act === 'act1enemyduel');
  for (let i = 0; i < 40; i++) {
    const [left, right] = SIM.makeLineups(r5, SIM.mulberry32(i + 1));
    assert.equal(right.length, 1); assert.ok(right[0].f.pool.boss > 0, right[0].f.key);
    if (right[0].f.score >= 300) assert.equal(right[0].n, 1);
    assert.ok(left.every((g) => g.f.pool.small > 0));
  }
});

test('竞猜对决: a wrong pick is OUT, but the 观众保护 takes the first one in rounds 1–5; a draw is right for all', () => {
  const mk = () => ({ id: 'x', human: true, out: false, outRound: 0, played: 0, streak: 0, ...SIM.standSeat() });
  let p = mk(); SIM.settleStand(p, { side: 0 }, 1, 0);
  assert.equal(p.pass, 1); assert.equal(p.right, true); assert.equal(p.out, false);
  SIM.settleStand(p, { side: 1 }, 2, 0);
  assert.equal(p.out, false); assert.equal(p.saved, true); assert.equal(p.shield, false); assert.equal(p.shieldAt, 2); assert.equal(p.pass, 1);
  SIM.settleStand(p, { side: 1 }, 3, 'draw');
  assert.equal(p.right, true); assert.equal(p.saved, false); assert.equal(p.pass, 2);
  SIM.settleStand(p, { side: 1 }, 4, 0);
  assert.equal(p.out, true); assert.equal(p.outRound, 4);
  // an OUT viewer's pick counts for nothing
  SIM.settleStand(p, { side: 0 }, 5, 0); assert.equal(p.pass, 2); assert.equal(p.outRound, 4);
  // from round 6 nobody holds a shield: the first wrong pick there is OUT
  p = mk(); for (let r = 1; r <= 5; r++) SIM.settleStand(p, { side: 0 }, r, 0);
  assert.equal(p.shield, true);
  SIM.standShields([p], 6); assert.equal(p.shield, false);
  SIM.settleStand(p, { side: 1 }, 6, 0); assert.equal(p.out, true); assert.equal(p.outRound, 6); assert.equal(p.pass, 5);
  // leaving while still in
  p = mk(); SIM.standLeave(p, 3); assert.equal(p.out, true); assert.equal(p.outRound, 3);
});

test('竞猜对决: NPCs guess right at most 3 times; the end; the standings', () => {
  const st = matchRounds(SIM, 'multiStandMatch'), rnd = SIM.mulberry32(5);
  const L = SIM.makeLineups(st[0], SIM.mulberry32(9));
  for (const npc of Object.values(SIM.DCFG.npcs)) {
    for (const winner of [0, 1]) {
      const c = SIM.npcStandPick(npc, { lineups: L, winner, sup: [3, 4], rnd, pass: 3 });
      assert.deepEqual({ ...c }, { side: 1 - winner }, npc.npcId);
      const free = SIM.npcStandPick(npc, { lineups: L, winner, sup: [3, 4], rnd, pass: 2 });
      assert.deepEqual(Object.keys(free), ['side']); assert.ok(free.side === 0 || free.side === 1);
    }
    // a draw is right whatever the side
    assert.ok([0, 1].includes(SIM.npcStandPick(npc, { lineups: L, winner: 'draw', sup: [0, 0], rnd, pass: 3 }).side));
  }
  const seat = (id, human, o) => ({ id, human, left: false, out: false, outRound: 0, ...SIM.standSeat(), ...o });
  // over: one left; none left; only NPCs left (they never keep it going); a human who left does not count
  assert.equal(SIM.standOver([seat('a', true), seat('b', true, { out: true })]), true);
  assert.equal(SIM.standOver([seat('a', true, { out: true }), seat('b', true, { out: true })]), true);
  assert.equal(SIM.standOver([seat('a', true, { out: true }), seat('n1', false), seat('n2', false)]), true);
  assert.equal(SIM.standOver([seat('a', true, { left: true }), seat('n1', false)]), true);
  assert.equal(SIM.standOver([seat('a', true), seat('n1', false)]), false);
  // standings: rounds guessed right, then still in, then OUT later; a tie on both shares the rank
  const ps = [seat('a', true, { pass: 4, out: true, outRound: 6 }), seat('b', true, { pass: 4 }), seat('c', true, { pass: 5, out: true, outRound: 6 }),
    seat('d', true, { pass: 2, out: true, outRound: 3 }), seat('e', false, { pass: 2, out: true, outRound: 3 }), seat('f', false, { pass: 2, out: true, outRound: 4 })];
  assert.deepEqual({ ...SIM.standRanks(ps) }, { c: 1, b: 2, a: 3, f: 4, d: 5, e: 5 });
});

// the 竞猜对决 leaders (sim.js LEADERS): a leader against a few plain enemies, placed by hand
const duel = (key, n = 1, other = 'enemy_5032_dqmon') => {
  const W = SIM.makeWorld([[{ f: byKey(key), n: 1 }], [{ f: byKey(other), n }]], 7, false);
  return { W, u: W.units[0], foes: W.units.slice(1) };
};
const steps = (W, sec) => { for (let i = 0; i < Math.round(sec / SIM.DT); i++) SIM.simStep(W); };

test('领袖 “火与钢”: 冲锋 4.5 s; at half HP ATK +280 % and damage −60 %; reborn once at half HP, invincible 10 s', () => {
  const { W, u } = duel('enemy_15024_dqreid');
  assert.equal(u.rushT, 4.5);
  steps(W, 1); assert.ok(u.rushT > 3.4 && u.rushT < 3.6);
  u.hp = u.maxHp * 0.5; steps(W, 0.1);
  assert.equal(u.atkMul, 3.8); assert.equal(u.dr, 0.6);
  const hp = u.hp; SIM.strike(W, u, 1000); assert.equal(hp - u.hp, 400);
  SIM.hurt(W, u, 1e9);
  assert.equal(u.rebornT, 5);
  steps(W, 5.1);
  assert.equal(u.enhanced, true); assert.equal(u.hp, u.maxHp * 0.5); assert.ok(u.invT > 9.8);
  SIM.hurt(W, u, 1e9); assert.equal(u.hp, u.maxHp * 0.5);
});

test('领袖 依然“狼之主”: damage −30 % and no stun; 溶血骇惧 on three, ended by 20 % of its HP; second form after 10 s', () => {
  const { W, u, foes } = duel('enemy_15023_dqwlfm', 4);
  for (const v of foes) { v.x = 6; v.y = 4.5; }
  u.x = 1; u.y = 4.5;
  let hp = u.hp; SIM.strike(W, u, 1000); assert.equal(hp - u.hp, 700);
  SIM.disable(W, u, 3, 'stun'); assert.equal(u.stun, 0);
  // the charge fills in 55 s; a 7 s wind-up standing still; three enemies seized
  u.fsp = 55; steps(W, 0.1);
  assert.equal(u.charge > 6.8, true);
  const x0 = u.x; steps(W, 6.7);
  assert.equal(u.x, x0); assert.equal(u.fearOn, null);
  steps(W, 0.4);
  assert.equal(u.fearOn.length, 3);
  const seized = foes.filter((v) => v.fear);
  assert.equal(seized.length, 3);
  // the HP loss rises with time
  const h0 = seized.map((v) => v.hp); steps(W, 1); const d1 = seized.map((v, i) => h0[i] - v.hp);
  const h1 = seized.map((v) => v.hp); steps(W, 1); const d2 = seized.map((v, i) => h1[i] - v.hp);
  for (let i = 0; i < 3; i++) if (!seized[i].dead) assert.ok(d2[i] > d1[i], `${d1[i]} → ${d2[i]}`);
  // 20 % of its max HP lost: every effect ends, 5 of the charge back for each, a 7 s pause
  SIM.hurt(W, u, u.maxHp * 0.21); steps(W, 0.05);
  assert.equal(u.fearOn, null); assert.equal(foes.filter((v) => v.fear).length, 0);
  assert.ok(u.fsp >= 15 - 1e-9 && u.fsp < 15.1, String(u.fsp)); assert.ok(u.fearWait > 6.9);
  // the second form
  const atk = u.atk, bat = u.bat;
  SIM.hurt(W, u, 1e9); assert.equal(u.rebornT, 10);
  steps(W, 10.05);
  assert.equal(u.enhanced, true); assert.equal(u.atk, atk * 1.5); assert.equal(u.bat, bat - 1.5);
  assert.equal(u.dr, 0); assert.equal(u.noStun, false); assert.ok(u.invT > 9.9);
});

test('领袖 “自在”: the barrier absorbs, then goes off (or breaks and ends); 纬地经天 hits an enemy once a cast; second form', () => {
  // the barrier: 7500 (PRTS), 8 s standing; still up at the end → ATK × 800 % arts within 3 tiles
  let { W, u, foes } = duel('enemy_5054_dqxi', 1);
  u.x = 5.5; u.y = 4.5; foes[0].x = 7.5; foes[0].y = 4.5; foes[0].hp = foes[0].maxHp = 1e9;
  u.crossT = 1e9; u.burstT = 0; steps(W, SIM.DT);
  assert.equal(u.barrier, 7500); assert.ok(u.hold > 7.9);
  let hp = u.hp; SIM.strike(W, u, 5000); assert.equal(u.hp, hp); assert.equal(u.barrier, 2500);
  const f0 = foes[0].hp; steps(W, 8.1);
  assert.equal(u.barrier, 0);
  const burst = u.atk * 8 * Math.max(0.05, 1 - foes[0].res / 100);
  assert.ok(f0 - foes[0].hp >= burst - 1e-6, `${f0 - foes[0].hp} vs ${burst}`);
  // broken: the rest goes to HP, the skill ends
  u.burstT = 0; steps(W, SIM.DT);
  hp = u.hp; SIM.strike(W, u, 8000);
  assert.equal(u.barrier, 0); assert.equal(u.hold, 0); assert.equal(hp - u.hp, 500);
  // 纬地经天: two enemies on one tile, both among the targets: each hit once
  ({ W, u, foes } = duel('enemy_5054_dqxi', 2));
  u.x = 2.5; u.y = 4.5; u.burstT = 1e9;
  for (const v of foes) { v.x = 4.5; v.y = 4.5; v.hp = v.maxHp = 1e9; v.speed = 0; v.aspd = 1e-9; }
  u.crossT = 0; u.cd = 1e9; steps(W, 1);
  const one = u.atk * 2 * Math.max(0.05, 1 - foes[0].res / 100);
  for (const v of foes) assert.ok(Math.abs((1e9 - v.hp) - one) < 1e-3, `${1e9 - v.hp} vs ${one}`);
  // second form: ATK +10 %, invincible 5 s
  const atk = u.atk; SIM.hurt(W, u, 1e9); assert.equal(u.rebornT, 5);
  steps(W, 5.05);
  assert.equal(u.enhanced, true); assert.ok(Math.abs(u.atk - atk * 1.1) < 1e-9); assert.ok(u.invT > 4.9);
});
