// The gateway's abuse limits, per network (an IPv4 address, an IPv6 /64) and in all: lobby connections, open rooms,
// room creation per minute, matches in play (room starts are refused, the queue holds the viewer). Behind a trusted
// proxy (TRUST_PROXY=1) the network is X-Forwarded-For's; connections from this machine are not limited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { default: WebSocket } = await import('ws');
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = (port) => new Promise((res) => { const r = request({ host: '127.0.0.1', port, path: '/healthz' }, () => res(true)); r.on('error', () => res(false)); r.end(); });

// a gateway with its own instance and the given limits
async function server(env) {
  const dir = mkdtempSync(join(tmpdir(), 'duel-limits-')), ip = await free(), port = await free();
  const base = { ...process.env, DUEL_LOGS: join(dir, 'logs'), DUEL_SHOW_MS: '200', DUEL_BET_MS: '2000' };
  const inst = spawn(process.execPath, [fileURLToPath(new URL('../server/instance.mjs', import.meta.url))], { env: { ...base, PORT: String(ip), HOST: '127.0.0.1' }, stdio: 'ignore' });
  const gw = spawn(process.execPath, [fileURLToPath(new URL('../server/gateway.mjs', import.meta.url))],
    { env: { ...base, PORT: String(port), HOST: '127.0.0.1', INSTANCES: String(ip), DUEL_PUBLIC: dir, TRUST_PROXY: '1', QUEUE_FILL_MS: '400', ...env }, stdio: 'ignore' });
  for (let i = 0; i < 100 && !(await up(port) && await up(ip)); i++) await sleep(100);
  await sleep(300);   // the gateway's first poll of the instance
  return { port, stop: () => { gw.kill(); inst.kill(); rmSync(dir, { recursive: true, force: true }); } };
}
// a lobby client from a network (X-Forwarded-For), or the HTTP status that refused it
function open(port, xff) {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/lobby`, xff ? { headers: { 'X-Forwarded-For': xff } } : {}), q = [], waits = [];
    ws.on('message', (d) => { const m = JSON.parse(d); const i = waits.findIndex((w) => w.t.includes(m.t)); if (i >= 0) waits.splice(i, 1)[0].res(m); else q.push(m); });
    const next = (...t) => { const i = q.findIndex((m) => t.includes(m.t)); if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]); return new Promise((r) => waits.push({ t, res: r })); };
    const within = (ms, ...t) => Promise.race([next(...t), sleep(ms).then(() => null)]);
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', name: 'x' })); res({ ws, next, within, say: (o) => ws.send(JSON.stringify(o)) }); });
    ws.on('unexpected-response', (req, r) => res({ refused: r.statusCode }));
    ws.on('error', () => {});
  });
}

test('lobby connections: one network over its limit is refused before the handshake; an IPv6 /64 is one network', { timeout: 30000 }, async () => {
  const s = await server({ MAX_SESSIONS_PER_IP: '2' });
  try {
    const a = await open(s.port, '203.0.113.5'), b = await open(s.port, '203.0.113.5');
    assert.ok(a.ws && b.ws);
    assert.equal((await open(s.port, '203.0.113.5')).refused, 429);
    assert.ok((await open(s.port, '203.0.113.6')).ws, 'another network');
    const v1 = await open(s.port, '2001:db8:1:2::a'), v2 = await open(s.port, '2001:db8:1:2:0:0:0:b');
    assert.ok(v1.ws && v2.ws);
    assert.equal((await open(s.port, '2001:db8:1:2:ffff::1')).refused, 429, 'the same /64');
    assert.ok((await open(s.port, '2001:db8:1:3::a')).ws, 'another /64');
    // this machine (no forwarded address) is not limited
    for (let i = 0; i < 4; i++) assert.ok((await open(s.port)).ws);
  } finally { s.stop(); }
});

test('rooms: per network, per minute and in all', { timeout: 30000 }, async () => {
  const s = await server({ MAX_ROOMS_PER_IP: '1', ROOM_CREATES_PER_MIN: '3', MAX_ROOMS: '2' });
  try {
    const a = await open(s.port, '198.51.100.1'), b = await open(s.port, '198.51.100.1');
    a.say({ t: 'room.create', mode: 'multiOperationRoom' });
    assert.equal((await a.next('room', 'error')).t, 'room');
    b.say({ t: 'room.create', mode: 'multiOperationRoom' });
    assert.match((await b.next('room', 'error')).msg, /同一网络创建的房间已达上限/);
    // a host may replace their own room, but only so often
    a.say({ t: 'room.create', mode: 'multiOperationRoom' }); assert.equal((await a.next('room', 'error')).t, 'room');
    a.say({ t: 'room.create', mode: 'multiOperationRoom' }); assert.equal((await a.next('room', 'error')).t, 'room');
    a.say({ t: 'room.create', mode: 'multiOperationRoom' }); assert.match((await a.next('room', 'error')).msg, /过于频繁/);
    const c = await open(s.port, '198.51.100.2'), d = await open(s.port, '198.51.100.3');
    c.say({ t: 'room.create', mode: 'multiStandRoom' }); assert.equal((await c.next('room', 'error')).t, 'room');
    d.say({ t: 'room.create', mode: 'multiOperationRoom' }); assert.match((await d.next('room', 'error')).msg, /服务器房间已满/);
  } finally { s.stop(); }
});

test('matches: a network with its most matches in play cannot start another, and waits in the queue; others play on', { timeout: 60000 }, async () => {
  const s = await server({ MAX_MATCHES_PER_IP: '1', MAX_ROOMS_PER_IP: '4' });
  const start = async (c) => {
    c.say({ t: 'room.create', mode: 'multiOperationRoom' }); await c.next('room');
    c.say({ t: 'room.npc', on: true }); await c.next('room');
    c.say({ t: 'room.start' });
    return c.within(8000, 'matched', 'error');
  };
  try {
    const a = await open(s.port, '192.0.2.10'), b = await open(s.port, '192.0.2.10');
    assert.equal((await start(a)).t, 'matched');
    const refused = await start(b);
    assert.equal(refused.t, 'error'); assert.match(refused.msg, /同一网络正在进行的比赛已达上限/);
    // the queue: the same network keeps its place and is not seated; another network is
    const q1 = await open(s.port, '192.0.2.10'), q2 = await open(s.port, '192.0.2.20');
    q1.say({ t: 'queue', mode: 'multiOperationMatch' }); q2.say({ t: 'queue', mode: 'multiOperationMatch' });
    assert.equal((await q2.within(8000, 'matched'))?.t, 'matched');
    assert.equal(await q1.within(2500, 'matched'), null, 'held while its network has a match in play');
  } finally { s.stop(); }
});

test('matches in all: a full server refuses a start from any network', { timeout: 60000 }, async () => {
  const s = await server({ MAX_MATCHES: '1' });
  try {
    const a = await open(s.port, '192.0.2.30'), e = await open(s.port, '192.0.2.40');
    for (const c of [a, e]) { c.say({ t: 'room.create', mode: 'multiOperationRoom' }); await c.next('room'); c.say({ t: 'room.npc', on: true }); await c.next('room'); }
    a.say({ t: 'room.start' }); assert.equal((await a.within(8000, 'matched', 'error')).t, 'matched');
    e.say({ t: 'room.start' }); assert.match((await e.within(8000, 'matched', 'error')).msg, /服务器正忙/);
  } finally { s.stop(); }
});
