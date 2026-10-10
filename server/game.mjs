// The match engine of a battle instance: one match, 礼物对决 (8 seats) or 竞猜对决 (30 seats, the rules in shared/sim.js
// STAND), the empty seats filled with the official NPC viewers when asked; authoritative for the rounds, the bets and
// picks, the results and the ranking. Battles are not simulated live: the line-ups and a seed go to the clients, the
// shared deterministic sim (shared/sim.js, the same file the page runs) computes the outcome here beforehand, and every
// client replays the same fight.
// Fairness: with the seed a client could compute the outcome before betting, so a round's seed goes out only once the
// bets are closed ('battle'); the round opens with the line-ups and a commitment, sha256(`${seed}:${salt}`), which the
// seed and salt in 'battle' let every client check (the server cannot pick a seed after seeing the bets). The line-ups
// come from a seed of their own, so they say nothing about the battle's. The last consts.*SelectTimeLast seconds of
// the window are secret (the official 暗选: picks made then are not shown until the bets close), and the NPC viewers
// whose pick uses the precomputed outcome (SIM.npcInformed) make it in that window only. DUEL_DEBUG=1 (recording, e.g.
// the promo video's pinned seeds) sends the seed with the round as before; every seat is told it is a debug match.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomBytes, randomInt, createHash } from 'node:crypto';

const root = new URL('..', import.meta.url);
const load = (p) => readFileSync(new URL(p, root), 'utf8');
const ctx = {
  FIGHTERS: JSON.parse(load('data/fighters.json')), DUELCFG: JSON.parse(load('data/duelcfg.json')),
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)), lerp: (a, b, t) => a + (b - a) * t, Math, console,
};
vm.createContext(ctx);
vm.runInContext(load('shared/sim.js') + `
;globalThis.SIM = { makeLineups, predict, npcPick, npcEmote, settleOne, mulberry32, pickWeighted, POOL, DCFG, EMOJI_PICS,
  isStand, STAND, standRow, standSeat, standShields, npcStandPick, npcInformed, settleStand, standLeave, standOver, standRanks, roundTable, pickRound, makeTraps };`, ctx);
export const SIM = ctx.SIM;
const C = SIM.DCFG.consts;

// timings (ms): the client's STARTING SOON + loading, the bet window (official 20 s in both modes), the round-end panel
// (the clip at 0.6×) and the scoreboard (official 8 s in both modes); a battle is waited for until every connected human has watched it, at most
// its simulated length + the round-start banner + a margin
// (DUEL_*_MS env overrides are for quick test runs)
const env = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const timings = (stand) => ({
  show: env('DUEL_SHOW_MS', 4500), loadMax: (C.maxLoadingTime || 15) * 1000, connectMax: 12000,
  bet: env('DUEL_BET_MS', ((stand ? C.modeStandSelectTime : C.modeOperationSelectTime) || 20) * 1000), result: env('DUEL_RESULT_MS', 3200),
  rank: env('DUEL_RANK_MS', ((stand ? C.modeStandRankTime : C.modeOperationRankTime) || 8) * 1000), battleExtra: 14000,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = () => randomBytes(12).toString('hex');
export const DEBUG = process.env.DUEL_DEBUG === '1';
export const commitOf = (seed, salt) => createHash('sha256').update(`${seed}:${salt}`).digest('hex');
// a seat's messages: a bucket of RATE_BURST refilled at RATE_PER_S; past it messages are dropped, and a seat that keeps
// flooding (RATE_KICK dropped) is disconnected. A seat changes its pick at most BET_CHANGES times a round.
const RATE_PER_S = 10, RATE_BURST = 20, RATE_KICK = 200, BET_CHANGES = 12;
const avatarKeys = () => SIM.POOL.map((f) => f.key);

export class Match {
  constructor({ id, mode, humans, npcFill, log = () => {}, onError = null }) {
    this.id = id; this.mode = mode; this.log = log; this.onError = onError; this.done = false; this.round = null; this.r = 0; this.phase = 'wait'; this.later = new Set();
    this.hist = []; this.seq = 0; this.roundFrom = 0;
    this.stand = SIM.isStand(mode); this.T = timings(this.stand);
    // the rounds in turn, each the three events' versions of it (one drawn when it comes)
    this.rounds = SIM.roundTable(mode);
    const max = (SIM.DCFG.modes[mode] || {}).maxPlayer || 8;
    const used = new Set(humans.map((h) => h.avatar));
    // NPC portraits: unused ones first (30 seats outnumber the roster: then any)
    const freeAvatar = () => { const k = avatarKeys().filter((x) => !used.has(x)), from = k.length ? k : avatarKeys(); const a = from[Math.floor(Math.random() * from.length)]; used.add(a); return a; };
    const base = () => ({ pts: C.modeOperationInitialScore || 10000, out: false, outRound: 0, streak: 0, stats: { all: 0, normal: 0, skip: 0, forced: 0 },
      played: 0, change: 0, right: null, lastForced: false, choice: null, left: false, ...(this.stand ? SIM.standSeat() : {}) });
    this.players = humans.map((h, i) => ({ id: 'p' + (i + 1), name: h.name, tag: h.tag, avatar: h.avatar, cid: h.cid || null, human: true, npc: null, token: token(),
      ws: null, connected: false, ready: false, watched: false, ...base() }));
    if (npcFill) {
      const pool = Object.values(SIM.DCFG.npcs), chosen = [];
      while (this.players.length + chosen.length < max && chosen.length < pool.length) chosen.push(SIM.pickWeighted(pool.filter((x) => !chosen.includes(x)), (x) => x.npcProb || 1, Math.random));
      chosen.forEach((n, i) => this.players.push({ id: 'n' + (i + 1), name: n.name, tag: '#' + (1000 + Math.floor(Math.random() * 9000)), avatar: freeAvatar(), human: false, npc: n, ...base() }));
    }
  }
  tokens() { return this.players.filter((p) => p.human).map((p) => ({ name: p.name, token: p.token })); }
  humans() { return this.players.filter((p) => p.human); }
  // the seats as the clients see them; the portraits (up to 16 kB each with a viewer's own picture) only with the seating
  // ('hello'), not in every round's result: 30 seats × 30 viewers would make that megabytes. 竞猜对决 adds the rounds
  // guessed right, the 观众保护 and the standing.
  snapshot(withAvatars = false) {
    const rank = this.stand ? SIM.standRanks(this.players) : null;
    return this.players.map((p) => ({ id: p.id, name: p.name, tag: p.tag, ...(withAvatars ? { avatar: p.avatar } : {}), human: p.human, npc: !!p.npc, pts: p.pts, out: p.out,
      outRound: p.outRound, streak: p.streak, stats: p.stats, played: p.played, change: p.change, right: p.right, lastForced: p.lastForced, left: p.left, connected: !!p.connected,
      ...(rank ? { pass: p.pass, shield: p.shield, shieldAt: p.shieldAt, saved: p.saved, rank: rank[p.id] } : {}) }));
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
    this.send(p, { t: 'hello', you: p.id, mode: this.mode, rounds: this.stand ? null : this.rounds.length, players: this.snapshot(true), phase: this.phase, resumed: resume, debug: DEBUG });
    const from = resume ? this.hist.findIndex((h) => h.m.seq > since) : this.roundFrom;
    if (from >= 0) for (const h of this.hist.slice(from)) this.send(p, { ...h.m, age: Date.now() - h.at });
    ws.on('message', (data) => {
      if (!this.allow(p)) { if (p.dropped > RATE_KICK) try { ws.close(4008, 'too many messages'); } catch (e) { /* gone */ } return; }
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      if (m && typeof m === 'object') this.onMessage(p, m);
    });
    ws.on('close', () => { if (p.ws === ws) { p.ws = null; p.connected = false; this.log(`${p.name} disconnected`); } });
    if (this.done) setTimeout(() => { try { ws.close(1000, 'match over'); } catch (e) { /* gone */ } }, 3000);
  }
  // the seat's message bucket (RATE_*)
  allow(p) {
    const now = Date.now(), b = p.bucket || (p.bucket = { n: RATE_BURST, at: now });
    b.n = Math.min(RATE_BURST, b.n + (now - b.at) / 1000 * RATE_PER_S); b.at = now;
    if (b.n < 1) { p.dropped = (p.dropped || 0) + 1; return false; }
    b.n -= 1;
    return true;
  }
  onMessage(p, m) {
    if (m.t === 'ready') p.ready = true;
    else if (m.t === 'watched') p.watched = true;
    else if (m.t === 'leave') {
      p.left = true; this.log(`${p.name} left`);
      // 竞猜对决: leaving while still in is OUT, in the round being played or else the next
      if (this.stand) SIM.standLeave(p, ['bet', 'battle'].includes(this.phase) ? this.r : this.r + 1);
    }
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
  // a pick made: everyone sees it, but in the secret window only its maker (the others learn it as the bets close)
  told(p) { if (this.secret) this.send(p, { t: 'bets', choices: { [p.id]: p.choice } }); else this.bcast({ t: 'bets', choices: { [p.id]: p.choice } }); }
  // a bet is checked against the round's rules: 观望 only when the round allows it, 支持 only with enough gifts,
  // 全力支持 when the round opens it or the gifts no longer cover the stake. 竞猜对决: a side, nothing else.
  bet(p, m) {
    const rd = this.round;
    if (this.phase !== 'bet' || !rd || p.out || p.left) return;
    if ((p.betN = (p.betN || 0) + 1) > BET_CHANGES) { if (p.betN === BET_CHANGES + 1) this.send(p, { t: 'error', msg: '本轮改选次数过多' }); return; }
    if (this.stand) {
      if (m.side !== 0 && m.side !== 1) { this.send(p, { t: 'error', msg: '这个选择在本轮不可用' }); return; }
      p.choice = { side: m.side };
      this.told(p);
      return;
    }
    const short = p.pts < rd.roundScore;
    let c = null;
    if (m.skip) { if (rd.canSkip) c = { skip: true }; }
    else if ((m.side === 0 || m.side === 1) && m.kind === 'normal' && !short) c = { side: m.side, kind: 'normal' };
    else if ((m.side === 0 || m.side === 1) && m.kind === 'all' && (rd.canAllIn || short)) c = { side: m.side, kind: 'all', forced: short && !rd.canAllIn };
    if (!c) { this.send(p, { t: 'error', msg: '这个选择在本轮不可用' }); return; }
    p.choice = c;
    this.told(p);
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
      const T = this.T;
      await this.waitHumans((p) => p.connected, T.connectMax);
      this.phase = 'show'; this.bcast({ t: 'phase', name: 'show' });
      await sleep(T.show);
      this.phase = 'loading'; this.bcast({ t: 'phase', name: 'loading', ms: T.loadMax });
      await this.waitHumans((p) => p.ready, T.loadMax);
      // 礼物对决: the table's rounds while two viewers have gifts; 竞猜对决: until one viewer (or no human) is left, the
      // rounds past the table repeating its last row, at most modeStandRoundNumber
      const total = this.stand ? SIM.STAND.cap : this.rounds.length;
      for (let r = 1; r <= total; r++) {
        if (!this.anyHumanHere()) { this.log(`match ${this.id}: no one left, closing`); break; }
        if (this.stand ? SIM.standOver(this.players) : this.players.filter((p) => !p.out).length <= 1) break;
        await this.playRound(SIM.pickRound(this.stand ? SIM.standRow(this.rounds, r) : this.rounds[r - 1], Math.random), r);
      }
      this.phase = 'finish';
      const fin = this.snapshot();
      this.bcast({ t: 'finish', players: fin });
      this.log(`match ${this.id} finished: ${this.stand
        ? fin.slice().sort((a, b) => a.rank - b.rank).map((p) => `#${p.rank} ${p.name} ${p.pass}`).join(', ')
        : this.players.slice().sort((a, b) => b.pts - a.pts).map((p) => `${p.name} ${p.pts}`).join(', ')}`);
    } catch (e) { if (this.onError) this.onError(e); else this.log(`match ${this.id} error: ${e.stack || e}`); }
    for (const h of this.later) clearTimeout(h);
    await sleep(3000);
    for (const p of this.players) if (p.ws) try { p.ws.close(1000, 'match over'); } catch (e) { /* gone */ }
    this.done = true;
  }
  async playRound(rd, r) {
    const T = this.T, stand = this.stand;
    this.round = rd; this.r = r;
    if (stand) SIM.standShields(this.players, r);
    // the line-ups (and the field's traps) and the battle each from a seed of their own (crypto), the battle's committed
    // to now, shown later
    const lineupSeed = randomInt(2 ** 31), seed = randomInt(2 ** 31), salt = randomBytes(16).toString('hex');
    const lrng = SIM.mulberry32(lineupSeed ^ 0x5bd1e995), lineups = SIM.makeLineups(rd, lrng), traps = SIM.makeTraps(rd, lrng);
    const pred = SIM.predict(lineups, seed, traps);
    for (const p of this.players) { p.choice = null; p.watched = false; p.betN = 0; }
    this.phase = 'bet'; this.secret = false; this.seen = null;
    const secretMs = Math.min(T.bet, env('DUEL_SECRET_MS', ((stand ? C.modeStandSelectTimeLast : C.modeOperationSelectTimeLast) || 7) * 1000)), openMs = T.bet - secretMs;
    this.bcast({ t: 'round', r, roundId: rd.roundId, lineups: lineups.map((s) => s.map((g) => [g.f.key, g.n])), traps, commit: commitOf(seed, salt), betMs: T.bet, secretMs,
      ...(DEBUG ? { seed, salt } : {}) });
    // the NPC viewers: the FOLLOW_* ones (priority > 0) see the supporters as everyone could when the window turned
    // secret; the informed ones (their pick uses the outcome) decide in the secret window, the rest while picks show
    const sup = () => this.seen || this.supporters();
    const npcPick = (p) => (stand
      ? SIM.npcStandPick(p.npc, { lineups, winner: pred.winner, sup: sup(), rnd: Math.random, pass: p.pass, informed: p.informed })
      : SIM.npcPick(p.npc, { pts: p.pts, rd, lineups, winner: pred.winner, sup: sup(), rnd: Math.random, informed: p.informed }));
    const npcs = this.players.filter((p) => p.npc && !p.out);
    for (const p of npcs) p.informed = SIM.npcInformed(p.npc, { stand, pass: p.pass, rnd: Math.random });
    const timers = npcs.map((p) => {
      const at = p.informed || p.npc.priority > 0 ? openMs + (0.1 + Math.random() * 0.75) * secretMs : (0.05 + Math.random() * 0.85) * openMs;
      return setTimeout(() => {
        if (this.phase !== 'bet') return;
        p.choice = npcPick(p);
        this.told(p);
        const pic = SIM.npcEmote('bet', p.choice, null, Math.random);
        if (pic && !this.secret) this.after(200 + Math.random() * 800, () => { if (this.phase === 'bet' && !this.secret) this.bcast({ t: 'emoji', id: p.id, pic }); });
      }, at);
    });
    timers.push(setTimeout(() => { if (this.phase !== 'bet') return; this.seen = this.supporters(); this.secret = true; this.bcast({ t: 'secret' }); }, openMs));
    await sleep(T.bet);
    timers.forEach(clearTimeout);
    this.secret = false;
    // undecided seats: NPCs pick now, humans watch (or, when the round forbids it, back a side at random; 竞猜对决: a
    // side at random)
    for (const p of this.players) {
      if (p.out || p.choice) continue;
      if (p.npc) p.choice = npcPick(p);
      else if (stand) p.choice = { side: Math.random() < 0.5 ? 0 : 1 };
      else { const short = p.pts < rd.roundScore; p.choice = rd.canSkip ? { skip: true } : { side: Math.random() < 0.5 ? 0 : 1, kind: short ? 'all' : 'normal', forced: short }; }
    }
    this.phase = 'battle';
    this.bcast({ t: 'battle', choices: Object.fromEntries(this.players.filter((p) => p.choice).map((p) => [p.id, p.choice])), seed, salt });
    // reactions while the fight runs (after the clients' round-start banner, within the battle)
    this.npcEmotes('battle', () => 2500 + Math.random() * Math.max(1000, Math.min(8000, pred.time * 1000)));
    await this.waitHumans((p) => p.watched, pred.time * 1000 + T.battleExtra);
    for (const p of this.players) if (stand) SIM.settleStand(p, p.choice, r, pred.winner); else SIM.settleOne(p, p.choice, rd, pred.winner);
    this.phase = 'result';
    this.bcast({ t: 'result', r, w: pred.winner, players: this.snapshot() });
    // the outcome: the clients show the arena a moment longer before the round's panel
    this.npcEmotes('result', () => 100 + Math.random() * 700, (p) => p.right);
    await sleep(T.result + T.rank);
  }
}
