// The gateway: serves the page, runs the lobby over ws://<host>:<port>/lobby — the 礼物对决 matchmaking queue (a full
// table of 8 starts at once; after QUEUE_FILL_MS the waiting players start with NPC viewers in the empty seats) and
// 群组 rooms (6-digit codes, the host's NPC-fill switch, the host starts) — and hands each new match to the least
// loaded battle instance. GET /status shows the instances, the queue and the rooms.
// The page: public/index.html (the code) and public/pack/duel-pack.<hash>.json (the assets) from `npm run build`, sent
// precompressed (brotli / gzip, whichever the browser takes) with validators; the pack, named after its content, may be
// cached for good. A build from before the split (public/duel-flow.html only) is served as it is.
// env: PORT (default 8600), HOST (bind, default 127.0.0.1), INSTANCES (comma-separated instance ports), QUEUE_FILL_MS,
//      DUEL_PUBLIC (the built page's folder, default ../public)
import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SIM } from './game.mjs';

const PORT = Number(process.env.PORT || 8600), HOST = process.env.HOST || '127.0.0.1';
const INSTANCES = (process.env.INSTANCES || '8611,8612,8613').split(',').map(Number);
const QUEUE_FILL_MS = Number(process.env.QUEUE_FILL_MS || 10000);
const MAX = (SIM.DCFG.modes.multiOperationMatch || {}).maxPlayer || 8, MIN_ROOM = SIM.DCFG.consts.minRoomNum || 2;
const PUBLIC = process.env.DUEL_PUBLIC || fileURLToPath(new URL('../public', import.meta.url));
const SHELL = join(PUBLIC, 'index.html'), SINGLE = join(PUBLIC, 'duel-flow.html');
const hasPage = () => existsSync(SHELL) || existsSync(SINGLE);
const log = (s) => console.log(`[gateway] ${s}`);

// ---- instances: polled for load, the least loaded one gets the next match --------------------------------------------
const inst = new Map(INSTANCES.map((p) => [p, { port: p, up: false, matches: 0, players: 0, list: [] }]));
async function poll() {
  for (const i of inst.values()) {
    try { const r = await fetch(`http://127.0.0.1:${i.port}/status`, { signal: AbortSignal.timeout(1500) }); Object.assign(i, await r.json(), { up: true }); }
    catch (e) { i.up = false; }
  }
}
setInterval(poll, 2000); poll();
async function createMatch(mode, members, npcFill) {
  await poll();
  const live = [...inst.values()].filter((i) => i.up).sort((a, b) => a.matches - b.matches);
  if (!live.length) throw new Error('没有可用的对战实例');
  const r = await fetch(`http://127.0.0.1:${live[0].port}/create`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, npcFill, humans: members.map((s) => ({ name: s.name, tag: s.tag, avatar: s.avatar })) }) });
  const o = await r.json();
  if (!r.ok) throw new Error(o.error || 'create failed');
  live[0].matches++;
  members.forEach((s, i) => { s.state = 'idle'; s.room = null; send(s, { t: 'matched', port: o.port, matchId: o.matchId, token: o.seats[i].token, mode }); });
  log(`match ${o.matchId} → instance ${o.port}: ${members.map((s) => s.name).join(', ')}${npcFill ? ' + NPC' : ''}`);
}

// ---- sessions --------------------------------------------------------------------------------------------------------
const sessions = new Set();
let sid = 0;
const send = (s, m) => { if (s.ws.readyState === 1) s.ws.send(JSON.stringify(m)); };
// portraits dealt in turn from a shuffled deck, so players who arrive together look different
const avatars = SIM.POOL.map((f) => f.key).sort(() => Math.random() - 0.5);
let avatarNext = 0;
const nextAvatar = () => avatars[avatarNext++ % avatars.length];
// eslint-disable-next-line no-control-regex -- names lose control characters on purpose
const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || `博士${1000 + Math.floor(Math.random() * 9000)}`;
// a viewer's avatar: a roster portrait (an enemy key) or their own small picture (a base64 PNG / JPEG / WebP data URI,
// the page sends 96 × 96); anything else is ignored
const AVATAR_KEYS = new Set(SIM.POOL.map((f) => f.key));
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const cleanAvatar = (v) => (typeof v === 'string' && (AVATAR_KEYS.has(v) || (v.length <= 16000 && AVATAR_RE.test(v))) ? v : null);

// ---- the 礼物对决 queue ------------------------------------------------------------------------------------------------
let queue = [];
function leaveQueue(s) { queue = queue.filter((x) => x !== s); if (s.state === 'queue') s.state = 'idle'; }
setInterval(async () => {
  queue = queue.filter((s) => s.ws.readyState === 1 && s.state === 'queue');
  if (!queue.length) return;
  const waited = Date.now() - queue[0].queuedAt;
  for (const s of queue) send(s, { t: 'queue', n: queue.length, max: MAX, waited: (Date.now() - s.queuedAt) / 1000, filling: waited > QUEUE_FILL_MS * 0.6 });
  if (queue.length >= MAX || waited >= QUEUE_FILL_MS) {
    const group = queue.splice(0, MAX);
    try { await createMatch('multiOperationMatch', group, group.length < MAX); }
    catch (e) { for (const s of group) { s.state = 'idle'; send(s, { t: 'error', msg: '匹配失败：' + e.message }); } }
  }
}, 500);

// ---- rooms -----------------------------------------------------------------------------------------------------------
const rooms = new Map();
function roomState(r) {
  return { t: 'room', code: r.code, mode: r.mode, npc: r.npc, max: MAX, host: r.host.id, members: r.members.map((m) => ({ id: m.id, name: m.name, tag: m.tag, avatar: m.avatar })) };
}
function pushRoom(r) { const st = roomState(r); for (const m of r.members) send(m, st); }
function leaveRoom(s) {
  const r = s.room && rooms.get(s.room);
  s.room = null; if (s.state === 'room') s.state = 'idle';
  if (!r) return;
  r.members = r.members.filter((m) => m !== s);
  if (!r.members.length) { rooms.delete(r.code); return; }
  if (r.host === s) r.host = r.members[0];
  pushRoom(r);
}

function onMessage(s, m) {
  switch (m.t) {
    case 'hello':
      s.name = cleanName(m.name);
      s.avatar = cleanAvatar(m.avatar) || s.avatar;
      send(s, { t: 'welcome', id: s.id, name: s.name, tag: s.tag, avatar: s.avatar });
      break;
    case 'queue':
      leaveRoom(s); leaveQueue(s);
      s.state = 'queue'; s.queuedAt = Date.now(); queue.push(s);
      break;
    case 'cancel': leaveQueue(s); break;
    case 'ping': if (Number.isFinite(m.c)) send(s, { t: 'pong', c: m.c }); break;   // the page's latency probe
    case 'avatar': { const a = cleanAvatar(m.avatar); if (a) { s.avatar = a; const r = s.room && rooms.get(s.room); if (r) pushRoom(r); } break; }
    case 'room.create': {
      leaveQueue(s); leaveRoom(s);
      let code; do code = String(100000 + Math.floor(Math.random() * 900000)); while (rooms.has(code));
      const r = { code, mode: m.mode === 'multiOperationRoom' ? m.mode : 'multiOperationRoom', host: s, members: [s], npc: false };
      rooms.set(code, r); s.room = code; s.state = 'room';
      pushRoom(r);
      break;
    }
    case 'room.join': {
      const r = rooms.get(String(m.code || '').trim());
      if (!r) { send(s, { t: 'error', msg: '房间不存在或已无法加入' }); break; }
      if (r.members.length >= MAX) { send(s, { t: 'error', msg: '房间已满' }); break; }
      leaveQueue(s); leaveRoom(s);
      r.members.push(s); s.room = r.code; s.state = 'room';
      pushRoom(r);
      break;
    }
    case 'room.npc': { const r = rooms.get(s.room); if (r && r.host === s) { r.npc = !!m.on; pushRoom(r); } break; }
    case 'room.leave': leaveRoom(s); break;
    case 'room.start': {
      const r = rooms.get(s.room);
      if (!r || r.host !== s) break;
      if (r.members.length < MIN_ROOM && !r.npc) { send(s, { t: 'error', msg: `至少需要 ${MIN_ROOM} 名玩家，或勾选“开局时添加NPC进行补位”` }); break; }
      rooms.delete(r.code);
      createMatch(r.mode, r.members, r.npc).catch((e) => { for (const x of r.members) send(x, { t: 'error', msg: '开局失败：' + e.message }); });
      break;
    }
    default:
  }
}

// ---- the page's files ----------------------------------------------------------------------------------------------------
// a built file: its brotli / gzip copy when the browser accepts it and the copy is as new as the file; an ETag per
// representation (from the content hash, kept while the file's mtime stays); 304 when the browser has it already
const tags = new Map();
function tagOf(path, st) {
  const k = path + '|' + st.mtimeMs + '|' + st.size;
  if (!tags.has(k)) tags.set(k, createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 20));
  return tags.get(k);
}
function sendFile(req, res, path, type, cache) {
  let st;
  try { st = statSync(path); } catch (e) { res.writeHead(404); res.end('not found'); return; }
  const accept = String(req.headers['accept-encoding'] || '').split(',').map((x) => x.trim().split(';')[0]);
  let file = path, enc = null;
  for (const [e, ext] of [['br', '.br'], ['gzip', '.gz']]) {
    if (!accept.includes(e)) continue;
    try { const c = statSync(path + ext); if (c.mtimeMs >= st.mtimeMs) { file = path + ext; enc = e; break; } } catch (err) { /* no copy */ }
  }
  const etag = `"${tagOf(path, st)}${enc ? '-' + enc : ''}"`;
  const head = { 'Content-Type': type, 'Cache-Control': cache, ETag: etag, Vary: 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff' };
  if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) { res.writeHead(304, head); res.end(); return; }
  if (enc) head['Content-Encoding'] = enc;
  head['Content-Length'] = statSync(file).size;
  res.writeHead(200, head);
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ---- HTTP + WebSocket ---------------------------------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    if (existsSync(SHELL)) { sendFile(req, res, SHELL, 'text/html; charset=utf-8', 'no-cache'); return; }
    if (existsSync(SINGLE)) { sendFile(req, res, SINGLE, 'text/html; charset=utf-8', 'no-cache'); return; }
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('页面尚未构建：先准备素材包（docs/ASSETS.md），再运行 npm run build（或用 start.cmd / start.sh 一键启动）');
    return;
  }
  // the asset pack: only names the build writes; the hash in the name makes it immutable
  const pk = /^\/pack\/(duel-pack\.[0-9a-f]{16}\.json)$/.exec(u.pathname);
  if (pk) { sendFile(req, res, join(PUBLIC, 'pack', pk[1]), 'application/json; charset=utf-8', 'public, max-age=31536000, immutable'); return; }
  if (u.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  // a liveness probe for containers and CI: the gateway answers, and how many instances it can reach
  if (u.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, instances: [...inst.values()].filter((i) => i.up).length, page: hasPage() })); return; }
  if (u.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ gateway: { port: PORT, sessions: sessions.size, queue: queue.map((s) => s.name) },
      rooms: [...rooms.values()].map((r) => ({ code: r.code, host: r.host.name, members: r.members.map((m) => m.name), npc: r.npc })),
      instances: [...inst.values()].map((i) => ({ port: i.port, up: i.up, matches: i.matches, players: i.players, list: i.list })) }, null, 1));
    return;
  }
  res.writeHead(404); res.end('not found');
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/lobby') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const s = { id: 'u' + (++sid), ws, name: '', tag: '#' + (1000 + Math.floor(Math.random() * 9000)), avatar: nextAvatar(), state: 'idle', room: null };
    sessions.add(s);
    ws.on('message', (d) => { let m; try { m = JSON.parse(d); } catch (e) { return; } onMessage(s, m); });
    ws.on('close', () => { leaveQueue(s); leaveRoom(s); sessions.delete(s); });
  });
});
server.listen(PORT, HOST, () => log(`page + lobby on http://${HOST}:${PORT}/  (instances ${INSTANCES.join(', ')})`));
