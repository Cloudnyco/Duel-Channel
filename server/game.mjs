// The match engine of a battle instance: one 礼物对决 match (8 seats; empty seats filled with the official NPC viewers),
// authoritative for the rounds, the bets, the results and the ranking. Battles are not simulated live: the line-ups
// and a seed go to the clients, the shared deterministic sim (shared/sim.js, the same file the page runs) computes the
// outcome here beforehand, and every client replays the same fight.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';

const root = new URL('..', import.meta.url);
const load = (p) => readFileSync(new URL(p, root), 'utf8');
const ctx = {
  FIGHTERS: JSON.parse(load('data/fighters.json')), DUELCFG: JSON.parse(load('data/duelcfg.json')),
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t, Math, console,
};
vm.createContext(ctx);
vm.runInContext(load('shared/sim.js') + '\n;globalThis.SIM = { makeLineups, predict, npcPick, npcEmote, settleOne, mulberry32, pickWeighted, POOL, DCFG, EMOJI_PICS };', ctx);
export const SIM = ctx.SIM;
const C = SIM.DCFG.consts;

// timings (ms): the client's STARTING SOON + loading, the bet window (official 20 s), the round-end panel (the clip at
// 0.6×) and the scoreboard (official 8 s); a battle is waited for until every connected human has watched it, at most
// its simulated length + the round-start banner + a margin
// (DUEL_*_MS env overrides are for quick test runs)
const env = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const T = {
  show: env('DUEL_SHOW_MS', 4500), loadMax: (C.maxLoadingTime || 15) * 1000, connectMax: 12000,
  bet: env('DUEL_BET_MS', (C.modeOperationSelectTime || 20) * 1000), result: env('DUEL_RESULT_MS', 3200),
  rank: env('DUEL_RANK_MS', (C.modeOperationRankTime || 8) * 1000), battleExtra: 14000,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => randomBytes(12).toString('hex');
const avatarKeys = () => SIM.POOL.map((f) => f.key);

export class Match {
  constructor({ id, mode, humans, npcFill, log = () => {} }) {
    this.id = id; this.mode = mode; this.log = log; this.done = false; this.round = null; this.phase = 'wait'; this.later = new Set();
    this.hist = []; this.seq = 0; this.roundFrom = 0;
    this.rounds = Object.values(SIM.DCFG.rounds).filter((r) => r.modeId === mode).sort((a, b) => a.round - b.round);
    const max = (SIM.DCFG.modes[mode] || {}).maxPlayer || 8;
    const used = new Set(humans.map((h) => h.avatar));
    const freeAvatar = () => { const k = avatarKeys().filter((x) => !used.has(x)); const a = k.length ? k[Math.floor(Math.random() * k.length)] : avatarKeys()[0]; used.add(a); return a; };
    const base = () => ({ pts: C.modeOperationInitialScore || 10000, out: false, outRound: 0, streak: 0, stats: { all: 0, normal: 0, skip: 0, forced: 0 },
      played: 0, change: 0, right: null, lastForced: false, choice: null, left: false });
    this.players = humans.map((h, i) => ({ id: 'p' + (i + 1), name: h.name, tag: h.tag, avatar: h.avatar, human: true, npc: null, token: token(),
      ws: null, connected: false, ready: false, watched: false, ...base() }));
    if (npcFill) {
      const pool = Object.values(SIM.DCFG.npcs), chosen = [];
      while (this.players.length + chosen.length < max && chosen.length < pool.length) chosen.push(SIM.pickWeighted(pool.filter((x) => !chosen.includes(x)), (x) => x.npcProb || 1, Math.random));
      chosen.forEach((n, i) => this.players.push({ id: 'n' + (i + 1), name: n.name, tag: '#' + (1000 + Math.floor(Math.random() * 9000)), avatar: freeAvatar(), human: false, npc: n, ...base() }));
    }
  }
  tokens() { return this.players.filter((p) => p.human).map((p) => ({ name: p.name, token: p.token })); }
  humans() { return this.players.filter((p) => p.human); }
  snapshot() {
    return this.players.map((p) => ({ id: p.id, name: p.name, tag: p.tag, avatar: p.avatar, human: p.human, npc: !!p.npc, pts: p.pts, out: p.out,
      outRound: p.outRound, streak: p.streak, stats: p.stats, played: p.played, change: p.change, right: p.right, lastForced: p.lastForced, left: p.left, connected: !!p.connected }));
  }
  send(p, msg) { if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); }
  // every broadcast is numbered (seq) and, emojis aside, kept with its time: a seat that comes back gets what it missed
  bcast(msg) {
    const m = { ...msg, seq: ++this.seq };
    if (msg.t !== 'emoji') { this.hist.push({ m, at: Date.now() }); if (msg.t === 'round') this.roundFrom = this.hist.length - 1; }
    const s = JSON.stringify(m);
    for (const p of this.players) if (p.ws && p.ws.readyState === 1) p.ws.send(s);
  }

  // a client's socket for its seat. `since` (the last seq it got) marks a dropped connection coming back: it is sent
  // every broadcast after that. Without it (joining, or a reloaded page) it is sent the current round from its start
  // (before the first round: everything). Each replayed message carries its age (ms), so the client's countdowns and
  // battle replay line up with the instance's clock. A finished match still answers for a while (the final standings).
  attach(ws, tok, since = null) {
    const p = this.players.find((x) => x.human && x.token === tok);
    if (!p || p.left) { ws.close(4001, 'bad token'); return; }
    if (p.ws && p.ws !== ws) try { p.ws.close(4002, 'replaced'); } catch (e) { /* gone */ }
    p.ws = ws; p.connected = true;
    const resume = Number.isInteger(since) && since >= 0;
    if (resume) this.log(`${p.name} reconnected (after #${since})`);
    this.send(p, { t: 'hello', you: p.id, mode: this.mode, rounds: this.rounds.length, players: this.snapshot(), phase: this.phase, resumed: resume });
    const from = resume ? this.hist.findIndex((h) => h.m.seq > since) : this.roundFrom;
    if (from >= 0) for (const h of this.hist.slice(from)) this.send(p, { ...h.m, age: Date.now() - h.at });
    ws.on('message', (data) => { let m; try { m = JSON.parse(data); } catch (e) { return; } this.onMessage(p, m); });
    ws.on('close', () => { if (p.ws === ws) { p.ws = null; p.connected = false; this.log(`${p.name} disconnected`); } });
    if (this.done) setTimeout(() => { try { ws.close(1000, 'match over'); } catch (e) { /* gone */ } }, 3000);
  }
  onMessage(p, m) {
    if (m.t === 'ready') p.ready = true;
    else if (m.t === 'watched') p.watched = true;
    else if (m.t === 'leave') { p.left = true; this.log(`${p.name} left`); }
    else if (m.t === 'bet') this.bet(p, m);
    else if (m.t === 'emoji') this.emoji(p, m.pic);
    // the page's latency probe: echo its clock back
    else if (m.t === 'ping' && Number.isFinite(m.c)) this.send(p, { t: 'pong', c: m.c });
  }
  // an emoji for the barrage: one of the theme's pictures, while the top bar is up (bets, battle, the round's end), at most
  // one per consts.chatCd seconds per seat; everyone (the sender too) gets it
  emoji(p, pic) {
    if (!['bet', 'battle', 'result'].includes(this.phase) || p.left || !SIM.EMOJI_PICS.includes(pic)) return;
    const now = Date.now();
    if (now - (p.emojiAt || 0) < (C.chatCd ?? 1) * 1000 - 50) return;
    p.emojiAt = now;
    this.bcast({ t: 'emoji', id: p.id, pic });
  }
  // the NPC viewers' reactions (npcEmote), each after a delay of its own
  npcEmotes(moment, delay, rightOf = () => null) {
    for (const p of this.players) {
      if (!p.npc || p.out) continue;
      const pic = SIM.npcEmote(moment, p.choice, rightOf(p), Math.random);
      if (pic) this.after(delay(), () => { if (['bet', 'battle', 'result'].includes(this.phase)) this.bcast({ t: 'emoji', id: p.id, pic }); });
    }
  }
  after(ms, fn) { const h = setTimeout(() => { this.later.delete(h); fn(); }, ms); this.later.add(h); }
  // a bet is checked against the round's rules: 观望 only when the round allows it, 支持 only with enough gifts,
  // 全力支持 when the round opens it or the gifts no longer cover the stake
  bet(p, m) {
    const rd = this.round;
    if (this.phase !== 'bet' || !rd || p.out || p.left) return;
    const short = p.pts < rd.roundScore;
    let c = null;
    if (m.skip) { if (rd.canSkip) c = { skip: true }; }
    else if ((m.side === 0 || m.side === 1) && m.kind === 'normal' && !short) c = { side: m.side, kind: 'normal' };
    else if ((m.side === 0 || m.side === 1) && m.kind === 'all' && (rd.canAllIn || short)) c = { side: m.side, kind: 'all', forced: short && !rd.canAllIn };
    if (!c) { this.send(p, { t: 'error', msg: '这个选择在本轮不可用' }); return; }
    p.choice = c;
    this.bcast({ t: 'bets', choices: { [p.id]: c } });
  }
  supporters() { return [0, 1].map((sd) => this.players.filter((q) => q.choice && !q.choice.skip && q.choice.side === sd).length); }
  async waitHumans(pred, ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (this.humans().every((p) => !p.connected || p.left || pred(p))) return true;
      await sleep(100);
    }
    return false;
  }
  anyHumanHere() { return this.humans().some((p) => p.connected && !p.left); }

  async run() {
    try {
      this.log(`match ${this.id} (${this.mode}) seats: ${this.players.map((p) => p.name + (p.human ? '' : '·NPC')).join(', ')}`);
      // everyone connects, sees STARTING SOON, loads
      await this.waitHumans((p) => p.connected, T.connectMax);
      this.phase = 'show'; this.bcast({ t: 'phase', name: 'show' });
      await sleep(T.show);
      this.phase = 'loading'; this.bcast({ t: 'phase', name: 'loading', ms: T.loadMax });
      await this.waitHumans((p) => p.ready, T.loadMax);
      for (const rd of this.rounds) {
        if (!this.anyHumanHere()) { this.log(`match ${this.id}: no one left, closing`); break; }
        if (this.players.filter((p) => !p.out).length <= 1) break;
        await this.playRound(rd);
      }
      this.phase = 'finish';
      this.bcast({ t: 'finish', players: this.snapshot() });
      this.log(`match ${this.id} finished: ${this.players.slice().sort((a, b) => b.pts - a.pts).map((p) => `${p.name} ${p.pts}`).join(', ')}`);
    } catch (e) { this.log(`match ${this.id} error: ${e.stack || e}`); }
    for (const h of this.later) clearTimeout(h);
    await sleep(3000);
    for (const p of this.players) if (p.ws) try { p.ws.close(1000, 'match over'); } catch (e) { /* gone */ }
    this.done = true;
  }
  async playRound(rd) {
    this.round = rd;
    const seed = (Math.random() * 2 ** 31) | 0;
    const lineups = SIM.makeLineups(rd, SIM.mulberry32(seed ^ 0x5bd1e995));
    const pred = SIM.predict(lineups, seed);
    for (const p of this.players) { p.choice = null; p.watched = false; }
    this.phase = 'bet';
    this.bcast({ t: 'round', r: rd.round, roundId: rd.roundId, lineups: lineups.map((s) => s.map((g) => [g.f.key, g.n])), seed, betMs: T.bet });
    // the NPC viewers bet during the window; FOLLOW_* (priority > 0) late, after seeing the others
    const timers = this.players.filter((p) => p.npc && !p.out).map((p) => {
      const at = p.npc.priority > 0 ? (0.65 + Math.random() * 0.25) * T.bet : (0.05 + Math.random() * 0.55) * T.bet;
      return setTimeout(() => {
        if (this.phase !== 'bet') return;
        p.choice = SIM.npcPick(p.npc, { pts: p.pts, rd, lineups, winner: pred.winner, sup: this.supporters(), rnd: Math.random });
        this.bcast({ t: 'bets', choices: { [p.id]: p.choice } });
        const pic = SIM.npcEmote('bet', p.choice, null, Math.random);
        if (pic) this.after(200 + Math.random() * 800, () => { if (this.phase === 'bet') this.bcast({ t: 'emoji', id: p.id, pic }); });
      }, at);
    });
    await sleep(T.bet);
    timers.forEach(clearTimeout);
    // undecided seats: NPCs pick now, humans watch (or, when the round forbids it, back a side at random)
    for (const p of this.players) {
      if (p.out || p.choice) continue;
      if (p.npc) p.choice = SIM.npcPick(p.npc, { pts: p.pts, rd, lineups, winner: pred.winner, sup: this.supporters(), rnd: Math.random });
      else { const short = p.pts < rd.roundScore; p.choice = rd.canSkip ? { skip: true } : { side: Math.random() < 0.5 ? 0 : 1, kind: short ? 'all' : 'normal', forced: short }; }
    }
    this.phase = 'battle';
    this.bcast({ t: 'battle', choices: Object.fromEntries(this.players.filter((p) => p.choice).map((p) => [p.id, p.choice])) });
    // reactions while the fight runs (after the clients' round-start banner, within the battle)
    this.npcEmotes('battle', () => 2500 + Math.random() * Math.max(1000, Math.min(8000, pred.time * 1000)));
    await this.waitHumans((p) => p.watched, pred.time * 1000 + T.battleExtra);
    for (const p of this.players) SIM.settleOne(p, p.choice, rd, pred.winner);
    this.phase = 'result';
    this.bcast({ t: 'result', r: rd.round, w: pred.winner, players: this.snapshot() });
    // the outcome: the clients show the arena a moment longer before the round's panel
    this.npcEmotes('result', () => 100 + Math.random() * 700, (p) => p.right);
    await sleep(T.result + T.rank);
  }
}
