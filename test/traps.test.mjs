// The field's traps (shared/sim.js TRAPS): the stages' random packs (data/duelcfg.json stages), and what each trap does —
// a crate in the way (gone round, broken when there is no other way), the altar's pulse, the bow guns' bolts, the coils'
// currents — on small staged battles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSim, matchRounds } from './sim-env.mjs';

const SIM = loadSim();
const F = (k) => SIM.FIGHTERS_ALL.find((f) => f.key === k);
const SAKAZ = 'enemy_5032_dqmon';
const world = (traps, seed = 7) => SIM.makeWorld([[{ f: F(SAKAZ), n: 1 }], [{ f: F(SAKAZ), n: 1 }]], seed, false, traps);
const steps = (W, sec) => { for (let i = 0; i < Math.round(sec / SIM.DT); i++) SIM.simStep(W); };
// a target that stands, never attacks and does not fall
const dummy = (v, x, y) => { v.passive = true; v.speed = 0; v.hp = v.maxHp = 1e9; v.x = x; v.y = y; return v; };

test('a round draws one of its event\'s two stages, then per random group one pack by weight (none most often)', () => {
  const rounds = matchRounds(SIM);
  for (const act of ['act1enemyduel', 'act2enemyduel', 'act3enemyduel']) {
    assert.equal(SIM.STAGES[act].length, 2, act);
    const rd = rounds.find((r) => r.act === act), rng = SIM.mulberry32(11);
    let some = 0;
    const keys = new Set(SIM.STAGES[act].flatMap((s) => s.groups.flat().flatMap((p) => p.traps.map((t) => t[0]))));
    for (let i = 0; i < 400; i++) {
      const t = SIM.makeTraps(rd, rng);
      if (t.length) some++;
      for (const [k, col, row] of t) {
        assert.ok(keys.has(k), k); assert.ok(col >= 0 && col <= 14 && row >= 0 && row <= 10, `${k} ${col},${row}`);
        // (the 弩炮 and the 清债程序 are left out of the draw for now)
        assert.ok(!/dqballis|dqcrsbow/.test(k), k);
      }
    }
    // 绿藤城 stage a: none 150 : 5 : 5; every event's rounds are mostly bare
    assert.ok(some > 10 && some < 260, `${act}: ${some} of 400 rounds with traps`);
  }
  // the five kinds, with their data (character_table / skill_table)
  assert.deepEqual(Object.keys(SIM.TRAP_DATA).sort(), ['trap_163_foolcrate', 'trap_213_dqore', 'trap_214_dqballis', 'trap_215_dqcrsbow', 'trap_216_dqelec']);
  assert.equal(SIM.TRAP_DATA.trap_163_foolcrate.hp, 5000);
  assert.equal(SIM.TRAP_DATA.trap_213_dqore.skill.bb.value, 500);
});

test('the level\'s rows count up from the near side: row 1 is the bottom lane, row 10 the far rim; UP is towards it', () => {
  const t = SIM.makeTrap(['trap_214_dqballis', 0, 10, 'DOWN'], 0), c = SIM.makeTrap(['trap_163_foolcrate', 7, 1, 'UP'], 1);
  assert.equal(t.y, -0.5); assert.deepEqual([...t.dir], [0, 1]);
  assert.equal(c.y, SIM.AH - 0.5); assert.equal(c.tile, 6 + (SIM.AH - 1) * SIM.AW);
});

test('障碍物: a ground unit goes round a crate in its way; with no other way it breaks it (5000 HP)', () => {
  // a wall across the middle column but for one tile: the walker goes through the gap
  const wall = [1, 2, 3, 4, 6, 7, 8, 9].map((row) => ['trap_163_foolcrate', 7, row, 'UP']);
  let W = world(wall);
  const [a, b] = W.units;
  // (row 8 is y 1.5: the straight way is walled off)
  dummy(b, 11.5, 1.5); a.x = 2.5; a.y = 1.5;
  let crossed = false, onCrate = 0;
  for (let i = 0; i < 30 * 30 && !crossed; i++) {
    SIM.simStep(W);
    if (W.block[SIM.tileX(a.x) + SIM.tileY(a.y) * SIM.AW]) onCrate++;
    if (a.x > 7) crossed = true;
  }
  assert.ok(crossed, 'reached the other side'); assert.equal(onCrate, 0);
  assert.ok(W.traps.every((t) => !t.dead && t.hp === t.maxHp), 'no crate touched');
  // the whole column: the way is through a crate — the walker stops at it and breaks it
  W = world([1, 2, 3, 4, 5, 6, 7, 8, 9].map((row) => ['trap_163_foolcrate', 7, row, 'UP']));
  const [c, d] = W.units;
  dummy(d, 11.5, 4.5); c.x = 4.5; c.y = 4.5;
  steps(W, 6);
  const hit = W.traps.filter((t) => t.hp < t.maxHp);
  assert.equal(hit.length, 1); assert.ok(c.x < 6, 'stopped at the crate');
  steps(W, 200);
  assert.ok(hit[0].dead, 'broken'); assert.ok(c.x > 7, 'through');
});

test('源石祭坛: from 7 s, every 7 s 500 true damage to both sides on its x-1 tiles; its tile is for flyers only', () => {
  const W = world([['trap_213_dqore', 7, 5, 'UP']]), [a, b] = W.units;
  dummy(a, 6.5 - 1, 4.5); dummy(b, 6.5 + 2, 4.5);            // 1 and 2 tiles from the altar's tile (6, 4): in reach
  steps(W, 6.9); assert.equal(a.hp, 1e9); assert.equal(b.hp, 1e9);
  steps(W, 0.2); assert.equal(a.hp, 1e9 - 500); assert.equal(b.hp, 1e9 - 500);
  steps(W, 7); assert.equal(a.hp, 1e9 - 1000);
  assert.equal(W.block[6 + 4 * SIM.AW], 2);
});

test('弩炮 / 清债程序: from 5 s a bolt (three bullets) down the lane, 100 physical damage to the first unit it meets', () => {
  let W = world([['trap_214_dqballis', 0, 5, 'RIGHT']]);
  let [a, b] = W.units;
  dummy(a, 3.5, 4.5); dummy(b, 6.5, 4.5);
  steps(W, 4.9); assert.equal(a.hp, 1e9);
  steps(W, 1);
  const dmg = 1e9 - a.hp;
  assert.ok(dmg > 0 && dmg <= 100, String(dmg)); assert.equal(b.hp, 1e9, 'the first one only');
  W = world([['trap_215_dqcrsbow', 14, 5, 'LEFT']]);
  [a, b] = W.units;
  dummy(a, 3.5, 4.5); dummy(b, 6.5, 4.5);
  steps(W, 6.5);
  // three bullets, all on the nearer one (a bullet: 100 ATK against its DEF, at least 5 %)
  assert.ok(Math.abs((1e9 - b.hp) - 3 * Math.max(5, 100 - b.defv)) < 1e-6, String(1e9 - b.hp)); assert.equal(a.hp, 1e9);
  assert.equal(W.bolts.length, 0);
});

test('梅什科线圈: every 2.3 s a 0.7 s current to the coil placed before it in reach; 250 arts and 停顿 1.5 s, once a current', () => {
  const W = world([['trap_216_dqelec', 5, 7, 'UP'], ['trap_216_dqelec', 5, 3, 'UP'], ['trap_216_dqelec', 5, 9, 'UP']]);
  // (5,7)–(5,9) are 2 apart: linked; (5,3) is 4 from (5,7): not
  assert.equal(W.links.length, 1);
  const [a, b] = W.units;
  dummy(a, 4.5, 2.5); dummy(b, 4.5, 6.5);                     // on the current's line (rows 7–9) / beside the lone coil
  steps(W, 2.2); assert.equal(a.hp, 1e9);
  steps(W, 0.2);
  assert.ok(1e9 - a.hp > 0 && 1e9 - a.hp <= 250); assert.ok(a.root > 1.2); assert.equal(b.hp, 1e9);
  const hp = a.hp; steps(W, 0.6); assert.equal(a.hp, hp, 'once a current');
  steps(W, 1.7); assert.ok(a.hp < hp, 'the next one');
});

test('traps change nothing without them: the same battle with an empty list is the one without', () => {
  const rd = matchRounds(SIM)[12], L = SIM.makeLineups(rd, SIM.mulberry32(5));
  assert.deepEqual(SIM.predict(L, 99), SIM.predict(L, 99, []));
});
