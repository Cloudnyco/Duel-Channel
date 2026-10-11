// 争锋频道's battles for simcheck (core.js): the golden battles (test/fixtures/golden.json), every round table of 礼物对决
// and 竞猜对决 (all three events', three seeds each) and every pack of field traps (two battles each), each a world of
// shared/sim.js (makeWorld) stepped to its end with simStep — as the server predicts a battle and every page replays it.
//   state  after every step: the time, the step, the safe zone and per unit FIELDS (its target as an index), per trap its
//          HP and state
//   deep   every value reachable from the units and the traps (the fighter records and views left out)
//   result the winner, the end step and a hash of the final state (test/sim-env.mjs digest's fields)
// The sim is passed in (SIM: makeLineups, makeWorld, simStep, mulberry32, makeTraps, roundTable, STAGES, DCFG): Node loads
// it into a VM context (test/sim-env.mjs), the check page as the classic script the game page also runs.
import { deepHash, hashValue } from './core.js';

/** Per unit in the state vector. */
export const FIELDS = Object.freeze(['dead', 'x', 'y', 'hp', 'cd', 'stun', 'sp', 'barrier', 'invT', 'hold', 'charge', 'atkMul', 'rebornT', 'cold', 'root', 'disarm',
  'noAtk', 'bAtk', 'bAspd', 'bDef', 'bMs', 'dodge', 'stacks', 'target']);
const DEEP_SKIP = Object.freeze(['f', 'view', 'def']);
const num = (v) => (typeof v === 'number' ? v : v ? 1 : 0);

/** The corpus: golden battles first (the quick subset), then the round tables, then the field traps. */
export function duelCorpus(SIM, golden) {
  const out = [];
  golden.forEach((g, i) => out.push({ id: `golden-${String(i + 1).padStart(2, '0')}`, family: 'golden', fast: true, roundId: g.roundId, seed: g.seed, traps: g.traps || [] }));
  for (const [mode, family] of [['multiOperationMatch', 'gift'], ['multiStandMatch', 'stand']]) {
    SIM.roundTable(mode).flat().forEach((rd, i) => {
      for (let k = 0; k < 3; k++) out.push({ id: `${family}-${rd.roundId}-${k}`, family, fast: false, roundId: rd.roundId, seed: (i * 7919 + k * 104729 + 31) | 0, traps: null });
    });
  }
  let n = 0;
  for (const [act, stages] of Object.entries(SIM.STAGES)) for (const st of stages) for (const g of st.groups) for (const p of g) {
    if (!p.traps.length) continue;
    const rounds = SIM.roundTable('multiOperationMatch').flat().filter((r) => r.act === act);
    for (let k = 0; k < 2; k++) { const rd = rounds[(n + k * 5) % rounds.length]; out.push({ id: `traps-${n + 1}-${k}`, family: 'traps', fast: false, roundId: rd.roundId, seed: (n * 40503 + k * 977 + 7) | 0, traps: p.traps }); }
    n++;
  }
  return out;
}

/** @param {object} SIM the sim's functions and data @param {object[]} corpus */
export function duelAdapter(SIM, corpus) {
  const byId = new Map(corpus.map((c) => [c.id, c]));
  return {
    maxTicks: 100000,
    start(sc) {
      const c = byId.get(sc.id), rd = SIM.DCFG.rounds[c.roundId];
      // the line-ups (and, for a round's own draw, its traps) from the seed, as the server draws them
      const lrng = SIM.mulberry32(c.seed ^ 0x5bd1e995), L = SIM.makeLineups(rd, lrng);
      const traps = c.traps === null ? SIM.makeTraps(rd, lrng) : c.traps;
      return SIM.makeWorld(L, c.seed, false, traps);
    },
    step(W) { if (W.done) return false; SIM.simStep(W); return true; },
    state(W) {
      const v = [W.t, W.n, W.zone, W.units.length, W.shots.length];
      for (const u of W.units) {
        for (const k of FIELDS) v.push(k === 'target' ? (u.target ? W.units.indexOf(u.target) : -1) : num(u[k]));
      }
      for (const t of W.traps) v.push(num(t.hp), num(t.dead));
      return v;
    },
    labels(W) {
      const out = ['t', 'step', 'zone', 'units', 'shots'];
      W.units.forEach((u, i) => { for (const k of FIELDS) out.push(`${u.side ? 'right' : 'left'} ${u.f.key}#${i}.${k}`); });
      W.traps.forEach((t, i) => out.push(`trap ${t.key}#${i}.hp`, `trap ${t.key}#${i}.dead`));
      return out;
    },
    deep(W) { return deepHash([...W.units, ...W.traps], { skip: DEEP_SKIP }); },
    result(W) { return `${W.result}|${W.n}|${hashValue([W.result, W.n, W.units.map((u) => [u.f.key, u.side, u.hp, u.x, u.y, u.dead])])}`; },
  };
}
