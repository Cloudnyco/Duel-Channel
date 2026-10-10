// Writes test/fixtures/golden.json: for 40 (round, seed) pairs, the line-ups the round's table draws and the battle's
// result, end step and a hash of the final state. test/sim.test.mjs replays them; a change in the rules or the numbers
// shows up as a diff here — re-run this script on purpose and review the diff when a change is meant to move results.
// usage: node tools/golden.mjs
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSim, matchRounds, digest } from '../test/sim-env.mjs';

const SIM = loadSim();
const rounds = matchRounds(SIM), cases = [];
for (let i = 0; i < 40; i++) {
  const rd = rounds[i % rounds.length], seed = (i * 2654435761 + 97) | 0;
  const L = SIM.makeLineups(rd, SIM.mulberry32(seed ^ 0x5bd1e995));
  const W = SIM.makeWorld(L, seed, false);
  while (!W.done) SIM.simStep(W);
  cases.push({ round: rd.round, roundId: rd.roundId, seed, lineups: L.map((s) => s.map((g) => [g.f.key, g.n])), winner: W.result, steps: W.n,
    hash: createHash('sha256').update(digest(W)).digest('hex').slice(0, 16) });
}
writeFileSync(new URL('../test/fixtures/golden.json', import.meta.url), JSON.stringify(cases, null, 1) + '\n');
console.log(`${cases.length} golden battles: ${cases.filter((c) => c.winner === 0).length} left, ${cases.filter((c) => c.winner === 1).length} right, ${cases.filter((c) => c.winner === 'draw').length} draws`);
