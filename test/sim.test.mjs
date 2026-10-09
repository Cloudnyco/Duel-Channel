// The duel sim: determinism, the golden battles, the official rules it encodes (line-up tolerance, the safe zone's
// steps, the bet settlement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSim, matchRounds, digest } from './sim-env.mjs';

const SIM = loadSim();
const rounds = matchRounds(SIM);
const byKey = (k) => SIM.POOL.find((f) => f.key === k);
const run = (L, seed) => { const W = SIM.makeWorld(L, seed, false); while (!W.done) SIM.simStep(W); return W; };

test('a battle is deterministic for its line-ups and seed', () => {
  const L = SIM.makeLineups(rounds[5], SIM.mulberry32(1234));
  assert.equal(digest(run(L, 99)), digest(run(L, 99)));
});

test('the golden battles replay identically (rules or numbers changed? run tools/golden.mjs and review)', () => {
  const cases = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
  assert.ok(cases.length >= 20);
  for (const c of cases) {
    const rd = rounds.find((r) => r.round === c.round);
    const L = SIM.makeLineups(rd, SIM.mulberry32(c.seed ^ 0x5bd1e995));
    // (compared as JSON: arrays made inside the sim's VM context have another Array prototype)
    assert.equal(JSON.stringify(L.map((s) => s.map((g) => [g.f.key, g.n]))), JSON.stringify(c.lineups), `line-ups of round ${c.round} seed ${c.seed}`);
    const W = run(L, c.seed);
    assert.equal(W.result, c.winner, `winner, round ${c.round} seed ${c.seed}`);
    assert.equal(W.n, c.steps, `end step, round ${c.round} seed ${c.seed}`);
    assert.equal(createHash('sha256').update(digest(W)).digest('hex').slice(0, 16), c.hash, `final state, round ${c.round} seed ${c.seed}`);
  }
});

test('line-ups stay within each round\'s score tolerance', () => {
  for (const rd of rounds) for (let i = 0; i < 25; i++) {
    for (const side of SIM.makeLineups(rd, SIM.mulberry32(i * 7919 + rd.round))) {
      const s = SIM.sideScore(side);
      assert.ok(Math.abs(s - rd.enemyScore) <= rd.enemyScoreRandom, `round ${rd.round}: score ${s} vs ${rd.enemyScore} ± ${rd.enemyScoreRandom}`);
    }
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
  assert.equal(SIM.EMOJI_PICS.length, 12);
  assert.equal(SIM.EMOJI_PICS[0], 'pic_left'); assert.equal(SIM.EMOJI_PICS[1], 'pic_right');
  const rnd = SIM.mulberry32(7), seen = new Set();
  for (let i = 0; i < 4000; i++) {
    const left = SIM.npcEmote('bet', { side: 0, kind: 'normal' }, null, rnd), right = SIM.npcEmote('bet', { side: 1, kind: 'all' }, null, rnd);
    assert.ok(left === null || left === 'pic_left'); assert.ok(right === null || right === 'pic_right');
    for (const [m, ch, ok] of [['battle', null, null], ['result', { side: 0, kind: 'normal' }, true], ['result', { side: 0, kind: 'normal' }, false], ['result', { skip: true }, null]]) {
      const pic = SIM.npcEmote(m, ch, ok, rnd);
      if (pic) { assert.ok(SIM.EMOJI_PICS.includes(pic), pic); seen.add(pic); }
      if (m === 'result' && ok === true) assert.ok(!['pic_sad', 'pic_wronged', 'pic_clown'].includes(pic));
      if (m === 'result' && ok === false) assert.ok(!['pic_happy', 'pic_busk'].includes(pic));
    }
  }
  assert.ok(seen.size >= 8, [...seen].join());
});
