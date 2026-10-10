// A battle instance: hosts any number of matches. The gateway creates matches here (POST /create, local only); players'
// connections come through the gateway's relay to ws://127.0.0.1:<port>/match?m=<match>&k=<seat token>[&since=<last
// seq>] (since: a dropped connection coming back, game.mjs attach). GET /status reports the load.
// env: PORT (required), HOST (bind address, default 127.0.0.1), NAME
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Match } from './game.mjs';
import { installCrashLog, recordError, recentErrors } from './errors.mjs';

const PORT = Number(process.env.PORT), HOST = process.env.HOST || '127.0.0.1', NAME = process.env.NAME || `instance-${PORT}`;
const matches = new Map();
let seq = 0;
const log = (s) => console.log(`[${NAME}] ${s}`);
installCrashLog(NAME);

// a JSON body (≤ 256 kB: eight seats with their own avatar pictures of ≤ 16 kB each)
function body(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 256 * 1024) { rej(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { rej(e); } });
  });
}
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
const fromLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/create') {
      if (!fromLocal(req)) return json(res, 403, { error: 'local only' });
      const o = await body(req);
      const id = `${PORT}-${++seq}`;
      const m = new Match({ id, mode: o.mode, humans: o.humans || [], npcFill: !!o.npcFill, log, onError: (e) => recordError(NAME, `match ${id}`, e) });
      matches.set(id, m);
      // kept two minutes after the end: a seat whose connection dropped near the end can still fetch the standings
      m.run().then(() => setTimeout(() => matches.delete(id), 120000));
      return json(res, 200, { matchId: id, port: PORT, seats: m.tokens() });
    }
    if (req.url === '/status') {
      const live = [...matches.values()].filter((m) => !m.done);
      return json(res, 200, { name: NAME, port: PORT, pid: process.pid, errors: recentErrors(), matches: live.length,
        players: live.reduce((a, m) => a + m.humans().filter((p) => p.connected).length, 0),
        list: live.map((m) => ({ id: m.id, mode: m.mode, phase: m.phase, round: m.round ? m.round.round : 0, humans: m.humans().map((p) => p.name), seats: m.players.length })) });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 400, { error: String(e.message || e) }); }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname === '/match' && matches.get(u.searchParams.get('m'));
  if (!m) { socket.destroy(); return; }
  const since = u.searchParams.has('since') ? Number(u.searchParams.get('since')) : null;
  wss.handleUpgrade(req, socket, head, (ws) => m.attach(ws, u.searchParams.get('k'), since));
});
server.listen(PORT, HOST, () => log(`listening on ${HOST}:${PORT}`));
