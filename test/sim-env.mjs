// Loads shared/sim.js with the committed data the way the server does (a VM context with the page's globals).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const load = (p) => readFileSync(new URL(p, root), 'utf8');
export function loadSim() {
  const ctx = {
    FIGHTERS: JSON.parse(load('data/fighters.json')), DUELCFG: JSON.parse(load('data/duelcfg.json')),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t, Math, console,
  };
  vm.createContext(ctx);
  vm.runInContext(load('shared/sim.js') + `
;globalThis.SIM = { makeLineups, predict, npcPick, npcEmote, settleOne, mulberry32, sideScore, makeWorld, simStep, zoneAt, zoneRect,
  outsideZone, POOL, DCFG, ENV, DT, BATTLE_MAX, EMOJI_PICS, isStand, STAND, standRow, standSeat, standShields, npcStandPick, settleStand,
  standLeave, standOver, standRanks, npcInformed, hurt, strike, disable, tileX, tileY, AW, roundTable, pickRound, FIGHTERS_ALL: FIGHTERS, ENEMIES, spawnUnit, elem, chill, addBuff, unitCost };`, ctx);
  return ctx.SIM;
}
// every version of a mode's rounds (the three events'), by round then event (default: the 礼物对决 match)
export const matchRounds = (SIM, mode = 'multiOperationMatch') => SIM.roundTable(mode).flat();
// a stable digest of a finished world: winner, end step, every unit's HP (to the bit) and position
export function digest(W) {
  return JSON.stringify([W.result, W.n, W.units.map((u) => [u.f.key, u.side, u.hp, u.x, u.y, u.dead])]);
}
