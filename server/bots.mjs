// Bot players: real clients of the lobby and the instances (no rendering). Each bot queues (礼物对决, or 竞猜对决 with
// --mode stand) or joins a room, loads, bets during each window (a legal random choice; 竞猜对决: a side, while still in),
// sends an emoji now and then, reports the battle watched after a few seconds. Its finish line counts the emojis it saw
// (others', its own echoes of a quick double send — the server lets one through per consts.chatCd — and any picture
// outside the theme, which the server must drop). In 竞猜对决 the first bot also prints the final standings as JSON.
// usage: node server/bots.mjs [--n 7] [--mode gift|stand] [--lobby ws://127.0.0.1:8600/lobby] [--room <code> | --room new
//                             [--npc]] [--loop] [--prefix Bot] [--drop-resume 1,3] [--drop-rejoin 2]
//   --room new          the first bot creates a room of the mode, the others join it, and it starts once all are in
//                       (--npc: with NPC viewers in the empty seats)
//   --drop-*            tests: lose the match connection once, come back resuming / rejoining
// exits with code 0 once every bot has finished its match (unless --loop)
import WebSocket from 'ws';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 7)), LOBBY = arg('--lobby', 'ws://127.0.0.1:8600/lobby'), ROOM = arg('--room', null);
const LOOP = process.argv.includes('--loop'), PREFIX = arg('--prefix', 'Bot'), NPC = process.argv.includes('--npc');
const STAND = arg('--mode', 'gift') === 'stand';
const QUEUE_MODE = STAND ? 'multiStandMatch' : 'multiOperationMatch', ROOM_MODE = STAND ? 'multiStandRoom' : 'multiOperationRoom';
// --room new: the code of the room the first bot creates, for the others
let roomCode = null;
const roomReady = new Promise((res) => { roomCode = res; });
// tests: bots (1-based) that drop their match connection once and come back resuming / rejoining
const DROP_RESUME = String(arg('--drop-resume', '')).split(',').filter(Boolean).map(Number);
const DROP_REJOIN = String(arg('--drop-rejoin', '')).split(',').filter(Boolean).map(Number);
// a match is reached through the gateway, as the page does (/match?port=…, relayed to the instance)
const GATE = LOBBY.replace(/\/lobby$/, '');
// BOT_PACE scales the bots' think / watch delays (tests run them at 0.1)
const PACE = Number(process.env.BOT_PACE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms) * PACE));
const rnd = (a, b) => a + Math.random() * (b - a);

let done = 0;
function bot(i) {
  const name = `${PREFIX}${String(i + 1).padStart(2, '0')}`;
  const lobby = new WebSocket(LOBBY);
  const say = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  lobby.on('open', () => say(lobby, { t: 'hello', name }));
  let started = false;
  lobby.on('message', async (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') {
      if (ROOM === 'new' && i === 0) say(lobby, { t: 'room.create', mode: ROOM_MODE });
      else if (ROOM === 'new') say(lobby, { t: 'room.join', code: await roomReady });
      else say(lobby, ROOM ? { t: 'room.join', code: ROOM } : { t: 'queue', mode: QUEUE_MODE });
    } else if (m.t === 'room' && ROOM === 'new' && i === 0) {
      roomCode(m.code);
      if (NPC && !m.npc) say(lobby, { t: 'room.npc', on: true });
      if (m.members.length === N && !started) { started = true; console.log(`[${name}] room ${m.code} (${m.mode}): ${N} in, starting`); say(lobby, { t: 'room.start' }); }
    }
    else if (m.t === 'matched') play(m);
    else if (m.t === 'error') console.log(`[${name}] lobby error: ${m.msg}`);
  });
  function play(mt) {
    let me = null, pts = 10000, tried = [], burst = false, lastSeq = 0, cur = null, drops = 0, out = false, draws = 0, over = false;
    const seen = { others: 0, burst: 0, bad: 0 }, rounds = new Set(), results = new Set();
    const base = `${GATE}/match?port=${mt.port}&m=${mt.matchId}&k=${mt.token}`;
    // a test bot may lose its connection once, on round 3's bet: 'resume' comes back with the last seq it got (as the
    // page does after a drop), 'rejoin' comes back without (as a reloaded page does)
    const dropMode = DROP_RESUME.includes(i + 1) ? 'resume' : DROP_REJOIN.includes(i + 1) ? 'rejoin' : null;
    const connect = (since) => {
      const ws = new WebSocket(since == null ? base : `${base}&since=${since}`);
      cur = ws;
      // the instance ended the match without its standings (an error there): say so and fail, rather than wait forever
      ws.on('close', (code) => { if (code === 1000 && !over) { console.log(`[${name}] match closed before the end`); process.exit(1); } });
      ws.on('message', async (d) => {
        const m = JSON.parse(d);
        if (m.seq) { if (m.seq <= lastSeq) return; lastSeq = m.seq; }
        if (m.t === 'hello') me = m.you;
        else if (m.t === 'emoji') {
          if (!/^pic_[a-z]+$/.test(m.pic) || m.pic === 'pic_nonexistent') seen.bad++;
          else if (m.id !== me) seen.others++;
          else if (m.pic === 'pic_pray') seen.burst++;
        }
        else if (m.t === 'phase' && m.name === 'loading') { await sleep(rnd(500, 2500)); say(cur, { t: 'ready' }); }
        else if (m.t === 'round') {
          rounds.add(m.r);
          if (dropMode && !drops && m.r === 3) {
            drops++;
            ws.terminate();
            // back after the bet window has closed: the instance must replay the bets, the battle, maybe the result
            setTimeout(() => { if (dropMode === 'rejoin') lastSeq = 0; connect(dropMode === 'resume' ? lastSeq : null); }, 2500);
            return;
          }
          await sleep(rnd(1000, m.betMs - 2500));
          // 竞猜对决: a side, while still in (the server ignores a pick from a viewer who is OUT)
          if (STAND) { if (!out) say(cur, { t: 'bet', side: Math.random() < 0.5 ? 0 : 1 }); return; }
          // a 支持 (sometimes 观望 / 全力支持); the server refuses what the round does not allow, the bot then goes all in
          const side = Math.random() < 0.5 ? 0 : 1, roll = Math.random();
          const first = roll < 0.15 ? 'skip' : roll > 0.85 ? 'all' : 'normal';
          tried = [first];
          say(cur, first === 'skip' ? { t: 'bet', skip: true } : { t: 'bet', side, kind: first });
        } else if (m.t === 'error' && !STAND) {
          // refused: try the other choices once each this round
          const next = ['normal', 'all', 'skip'].find((k) => !tried.includes(k));
          if (next) { tried.push(next); say(cur, next === 'skip' ? { t: 'bet', skip: true } : { t: 'bet', side: Math.random() < 0.5 ? 0 : 1, kind: next }); }
        }
        else if (m.t === 'battle') {
          // the first battle: two of the same at once (one gets through) and a picture the theme does not have
          if (!burst) { burst = true; say(cur, { t: 'emoji', pic: 'pic_pray' }); say(cur, { t: 'emoji', pic: 'pic_pray' }); say(cur, { t: 'emoji', pic: 'pic_nonexistent' }); }
          await sleep(rnd(1200, 2000));
          say(cur, { t: 'emoji', pic: ['pic_hello', 'pic_happy', 'pic_shock', 'pic_think'][Math.floor(Math.random() * 4)] });
          await sleep(rnd(800, 4000)); say(cur, { t: 'watched' });
        }
        else if (m.t === 'result') {
          results.add(m.r); if (m.w === 'draw') draws++;
          const p = m.players.find((x) => x.id === me);
          if (p) { pts = p.pts; out = p.out; }
        }
        else if (m.t === 'finish') {
          over = true;
          const tail = `(emoji: others ${seen.others}, burst ${seen.burst}, bad ${seen.bad}; rounds ${rounds.size}, results ${results.size}, drops ${drops}${dropMode ? ' ' + dropMode : ''})`;
          const mine = m.players.find((x) => x.id === me);
          if (STAND) {
            console.log(`[${name}] finished #${mine.rank} guessed ${mine.pass} ${mine.out ? `out in ${mine.outRound}` : 'still in'} ${tail}`);
            if (i === 0) console.log(`standings ${JSON.stringify({ rounds: rounds.size, draws, players: m.players.map((x) => ({ id: x.id, human: x.human, pass: x.pass, out: x.out, outRound: x.outRound, shield: x.shield, shieldAt: x.shieldAt, rank: x.rank, left: x.left })) })}`);
          } else {
            const order = m.players.slice().sort((a, b) => b.pts - a.pts);
            console.log(`[${name}] finished #${order.findIndex((x) => x.id === me) + 1} with ${pts} ${tail}`);
          }
          ws.close();
          if (LOOP) { await sleep(rnd(1000, 3000)); out = false; say(lobby, { t: 'queue', mode: QUEUE_MODE }); } else { lobby.close(); if (++done === N) process.exit(0); }
        }
      });
    };
    connect(null);
  }
}
for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 150);
