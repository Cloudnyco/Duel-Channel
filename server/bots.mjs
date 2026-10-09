// Bot players: real clients of the lobby and the instances (no rendering). Each bot queues for 礼物对决 (or joins a
// room), loads, bets during each window (a legal random choice), sends an emoji now and then, reports the battle watched
// after a few seconds. Its finish line counts the emojis it saw (others', its own echoes of a quick double send — the
// server lets one through per consts.chatCd — and any picture outside the theme, which the server must drop).
// usage: node server/bots.mjs [--n 7] [--lobby ws://127.0.0.1:8600/lobby] [--room <code>] [--loop] [--prefix Bot]
// exits with code 0 once every bot has finished its match (unless --loop)
import WebSocket from 'ws';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 7)), LOBBY = arg('--lobby', 'ws://127.0.0.1:8600/lobby'), ROOM = arg('--room', null);
const LOOP = process.argv.includes('--loop'), PREFIX = arg('--prefix', 'Bot');
const host = new URL(LOBBY).hostname;
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
  lobby.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') say(lobby, ROOM ? { t: 'room.join', code: ROOM } : { t: 'queue', mode: 'multiOperationMatch' });
    else if (m.t === 'matched') play(m);
    else if (m.t === 'error') console.log(`[${name}] lobby error: ${m.msg}`);
  });
  function play(mt) {
    const ws = new WebSocket(`ws://${host}:${mt.port}/match?m=${mt.matchId}&k=${mt.token}`);
    let me = null, pts = 10000, tried = [], burst = false;
    const seen = { others: 0, burst: 0, bad: 0 };
    ws.on('message', async (d) => {
      const m = JSON.parse(d);
      if (m.t === 'hello') me = m.you;
      else if (m.t === 'emoji') {
        if (!/^pic_[a-z]+$/.test(m.pic) || m.pic === 'pic_nonexistent') seen.bad++;
        else if (m.id !== me) seen.others++;
        else if (m.pic === 'pic_pray') seen.burst++;
      }
      else if (m.t === 'phase' && m.name === 'loading') { await sleep(rnd(500, 2500)); say(ws, { t: 'ready' }); }
      else if (m.t === 'round') {
        await sleep(rnd(1000, m.betMs - 2500));
        // a 支持 (sometimes 观望 / 全力支持); the server refuses what the round does not allow, the bot then goes all in
        const side = Math.random() < 0.5 ? 0 : 1, roll = Math.random();
        const first = roll < 0.15 ? 'skip' : roll > 0.85 ? 'all' : 'normal';
        tried = [first];
        say(ws, first === 'skip' ? { t: 'bet', skip: true } : { t: 'bet', side, kind: first });
      } else if (m.t === 'error') {
        // refused: try the other choices once each this round
        const next = ['normal', 'all', 'skip'].find((k) => !tried.includes(k));
        if (next) { tried.push(next); say(ws, next === 'skip' ? { t: 'bet', skip: true } : { t: 'bet', side: Math.random() < 0.5 ? 0 : 1, kind: next }); }
      }
      else if (m.t === 'battle') {
        // the first battle: two of the same at once (one gets through) and a picture the theme does not have
        if (!burst) { burst = true; say(ws, { t: 'emoji', pic: 'pic_pray' }); say(ws, { t: 'emoji', pic: 'pic_pray' }); say(ws, { t: 'emoji', pic: 'pic_nonexistent' }); }
        await sleep(rnd(1200, 2000));
        say(ws, { t: 'emoji', pic: ['pic_hello', 'pic_happy', 'pic_shock', 'pic_think'][Math.floor(Math.random() * 4)] });
        await sleep(rnd(800, 4000)); say(ws, { t: 'watched' });
      }
      else if (m.t === 'result') { const p = m.players.find((x) => x.id === me); if (p) pts = p.pts; }
      else if (m.t === 'finish') {
        const order = m.players.slice().sort((a, b) => b.pts - a.pts);
        console.log(`[${name}] finished #${order.findIndex((x) => x.id === me) + 1} with ${pts} (emoji: others ${seen.others}, burst ${seen.burst}, bad ${seen.bad})`);
        ws.close();
        if (LOOP) { await sleep(rnd(1000, 3000)); say(lobby, { t: 'queue', mode: 'multiOperationMatch' }); } else { lobby.close(); if (++done === N) process.exit(0); }
      }
    });
  }
}
for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 150);
