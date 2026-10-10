// The gateway's page files, with a stand-in build in a temp folder (no assets needed): the shell and the pack go out in
// the encoding the browser takes (brotli / gzip copies, the plain file otherwise or when a copy is stale), with ETags
// and 304s; the pack, named after its content, is cacheable for good; nothing outside the build's names is served; a
// build from before the split (duel-flow.html only) still works; no build at all gives 503. Also: the lobby's sessions,
// the relay of a match's connection, players' error reports, the launcher's restarts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';

const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = (port, path, headers = {}, method = 'GET') => new Promise((res, rej) => {
  const r = request({ host: '127.0.0.1', port, path, method, headers }, (m) => { const b = []; m.on('data', (c) => b.push(c)); m.on('end', () => res({ status: m.statusCode, h: m.headers, body: Buffer.concat(b) })); });
  r.on('error', rej); r.end();
});
async function gateway(dir, logs = join(dir, 'logs')) {
  const port = await free(), ip = await free();
  const p = spawn(process.execPath, [fileURLToPath(new URL('../server/gateway.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', INSTANCES: String(ip), DUEL_PUBLIC: dir, DUEL_LOGS: logs }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { await get(port, '/healthz'); return { port, stop: () => p.kill() }; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  p.kill(); throw new Error('gateway did not start');
}
const files = (dir, name, text) => {
  const buf = Buffer.from(text);
  writeFileSync(join(dir, name), buf); writeFileSync(join(dir, name + '.br'), brotliCompressSync(buf)); writeFileSync(join(dir, name + '.gz'), gzipSync(buf));
};

test('the served page: encodings, validators, the immutable pack, only the build\'s names', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duel-pub-'));
  mkdirSync(join(dir, 'pack'));
  const shell = '<!doctype html><p>shell</p>', pack = JSON.stringify({ v: 1, ui: { screens: {} }, filler: 'x'.repeat(5000) });
  files(dir, 'index.html', shell);
  files(join(dir, 'pack'), 'duel-pack.0123456789abcdef.json', pack);
  const gw = await gateway(dir);
  try {
    // brotli when offered; the ETag names the representation; the same ETag back gives 304
    let r = await get(gw.port, '/', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(r.status, 200); assert.equal(r.h['content-encoding'], 'br'); assert.equal(r.h['cache-control'], 'no-cache');
    assert.equal(brotliDecompressSync(r.body).toString(), shell); assert.match(r.h.etag, /-br"$/); assert.equal(r.h.vary, 'Accept-Encoding');
    const again = await get(gw.port, '/', { 'Accept-Encoding': 'br', 'If-None-Match': r.h.etag });
    assert.equal(again.status, 304); assert.equal(again.body.length, 0);
    // nothing offered: the plain file
    r = await get(gw.port, '/index.html');
    assert.equal(r.status, 200); assert.equal(r.h['content-encoding'], undefined); assert.equal(r.body.toString(), shell);
    assert.equal(Number(r.h['content-length']), Buffer.byteLength(shell));
    // the pack: gzip, cacheable for a year, immutable; HEAD has the headers only
    r = await get(gw.port, '/pack/duel-pack.0123456789abcdef.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(r.status, 200); assert.equal(r.h['content-encoding'], 'gzip'); assert.match(r.h['cache-control'], /immutable/);
    assert.match(r.h['content-type'], /^application\/json/);
    r = await get(gw.port, '/pack/duel-pack.0123456789abcdef.json', {}, 'HEAD');
    assert.equal(r.status, 200); assert.equal(Number(r.h['content-length']), Buffer.byteLength(pack)); assert.equal(r.body.length, 0);
    // a compressed copy older than its file is not used
    const old = new Date(Date.now() - 3600e3);
    utimesSync(join(dir, 'pack', 'duel-pack.0123456789abcdef.json.gz'), old, old);
    r = await get(gw.port, '/pack/duel-pack.0123456789abcdef.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(r.h['content-encoding'], undefined); assert.equal(r.body.toString(), pack);
    // only the names the build writes
    for (const p of ['/pack/duel-pack.0123456789abcdef.json.br', '/pack/duel-pack.zzzz.json', '/pack/../../package.json', '/pack/%2e%2e/%2e%2e/package.json', '/package.json', '/index.html.br'])
      assert.equal((await get(gw.port, p)).status, 404, p);
    assert.equal((await get(gw.port, '/pack/duel-pack.fedcba9876543210.json')).status, 404);
    const h = JSON.parse((await get(gw.port, '/healthz')).body);
    assert.equal(h.page, true);
  } finally { gw.stop(); }
  // a single-file build only, then nothing
  rmSync(join(dir, 'index.html')); writeFileSync(join(dir, 'duel-flow.html'), '<p>single</p>');
  const gw2 = await gateway(dir);
  try { const r = await get(gw2.port, '/'); assert.equal(r.status, 200); assert.equal(r.body.toString(), '<p>single</p>'); } finally { gw2.stop(); }
  rmSync(join(dir, 'duel-flow.html'));
  const gw3 = await gateway(dir);
  try { assert.equal((await get(gw3.port, '/')).status, 503); } finally { gw3.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('the lobby: a dropped viewer keeps their room seat and takes the session back with its key', { timeout: 30000 }, async () => {
  const { default: WebSocket } = await import('ws');
  const dir = mkdtempSync(join(tmpdir(), 'duel-pub-'));
  const gw = await gateway(dir);
  const open = () => new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/lobby`), q = [], waits = [];
    ws.on('message', (d) => { const m = JSON.parse(d); const i = waits.findIndex((w) => w.t === m.t); if (i >= 0) waits.splice(i, 1)[0].res(m); else q.push(m); });
    const next = (t) => { const i = q.findIndex((m) => m.t === t); if (i >= 0) return Promise.resolve(q.splice(i, 1)[0]); return new Promise((r) => waits.push({ t, res: r })); };
    ws.on('open', () => res({ ws, next, say: (o) => ws.send(JSON.stringify(o)) })); ws.on('error', rej);
  });
  try {
    const a = await open();
    a.say({ t: 'hello', name: '房主' });
    const wa = await a.next('welcome');
    assert.match(wa.key, /^[0-9a-f]{24}$/);
    a.say({ t: 'room.create', mode: 'multiOperationRoom' });
    const room = await a.next('room');
    const b = await open();
    b.say({ t: 'hello', name: '房客' }); await b.next('welcome');
    b.say({ t: 'room.join', code: room.code });
    await b.next('room');
    // the host's connection drops: the guest sees them away, still in the room
    a.ws.terminate();
    const seen = await b.next('room');
    assert.equal(seen.members.find((m) => m.id === wa.id).away, true);
    // back on a new connection with the key: the same session, the same room
    const a2 = await open();
    a2.say({ t: 'resume', key: wa.key });
    const back = await a2.next('welcome');
    assert.equal(back.id, wa.id); assert.equal(back.resumed, true);
    const room2 = await a2.next('room');
    assert.equal(room2.code, room.code); assert.equal(room2.host, wa.id);
    assert.equal(room2.members.find((m) => m.id === wa.id).away, false);
    // a key the gateway does not know
    const c = await open();
    c.say({ t: 'resume', key: '0'.repeat(24) });
    assert.equal((await c.next('resume.fail')).t, 'resume.fail');
    for (const x of [a2, b, c]) x.ws.close();
  } finally { gw.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a match connection through the gateway: relayed to its instance, close codes kept, nothing else dialled', { timeout: 30000 }, async () => {
  const { default: WebSocket } = await import('ws');
  const dir = mkdtempSync(join(tmpdir(), 'duel-pub-'));
  const ip = await free(), port = await free();
  const inst = spawn(process.execPath, [fileURLToPath(new URL('../server/instance.mjs', import.meta.url))],
    { env: { ...process.env, PORT: String(ip), HOST: '127.0.0.1', DUEL_LOGS: join(dir, 'logs') }, stdio: 'ignore' });
  const gw = spawn(process.execPath, [fileURLToPath(new URL('../server/gateway.mjs', import.meta.url))],
    { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', INSTANCES: String(ip), DUEL_PUBLIC: dir, DUEL_LOGS: join(dir, 'logs') }, stdio: 'ignore' });
  const post = (p, body) => new Promise((res, rej) => {
    const data = Buffer.from(JSON.stringify(body));
    const r = request({ host: '127.0.0.1', port: p, path: '/create', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      (m) => { const b = []; m.on('data', (c) => b.push(c)); m.on('end', () => res(JSON.parse(Buffer.concat(b)))); });
    r.on('error', rej); r.end(data);
  });
  // a socket's first message, or how it ended
  const first = (url) => new Promise((res) => {
    const ws = new WebSocket(url);
    ws.on('message', (d) => { res({ msg: JSON.parse(d), ws }); });
    ws.on('close', (code) => res({ code }));
    ws.on('error', () => res({ error: true }));
  });
  try {
    for (let i = 0; i < 100; i++) { try { await get(port, '/healthz'); await get(ip, '/status'); break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
    const o = await post(ip, { mode: 'multiOperationRoom', npcFill: true, humans: [{ name: '甲' }] });
    const base = `ws://127.0.0.1:${port}/match?port=${ip}&m=${o.matchId}`;
    const ok = await first(`${base}&k=${o.seats[0].token}`);
    assert.equal(ok.msg.t, 'hello'); assert.equal(ok.msg.you, 'p1'); assert.equal(ok.msg.players.length, 8);
    assert.equal(JSON.parse((await get(port, '/status')).body).gateway.relays, 1);
    ok.ws.close();
    // the instance's own close code comes through: a token it does not know is final (4001)
    assert.equal((await first(`${base}&k=${'0'.repeat(24)}`)).code, 4001);
    // malformed, or a port that is not one of the instances: refused before anything is dialled
    for (const q of [`port=${port}&m=${o.matchId}&k=${o.seats[0].token}`, `port=${ip}&m=x&k=${o.seats[0].token}`, `port=${ip}&m=${o.matchId}&k=${o.seats[0].token}&since=-1`])
      assert.ok((await first(`ws://127.0.0.1:${port}/match?${q}`)).error, q);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(JSON.parse((await get(port, '/status')).body).gateway.relays, 0);
  } finally { gw.kill(); inst.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test('error reports: saved one file each under logs/reports, refused when empty, too large or too frequent', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duel-pub-')), logs = join(dir, 'logs');
  const gw = await gateway(dir, logs);
  const post = (body) => new Promise((res, rej) => {
    const data = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const r = request({ host: '127.0.0.1', port: gw.port, path: '/report', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
      (m) => { const b = []; m.on('data', (c) => b.push(c)); m.on('end', () => res({ status: m.statusCode, body: Buffer.concat(b).toString() })); });
    r.on('error', (e) => res({ status: 0, body: String(e) })); r.end(data);
  });
  try {
    let r = await post({ text: '### 争锋频道 错误报告\n- 版本：0.1.0\u0007', name: '测试员' });
    assert.equal(r.status, 200, r.body);
    assert.equal(JSON.parse(r.body).id, 1);
    const files = readdirSync(join(logs, 'reports'));
    assert.equal(files.length, 1);
    const saved = readFileSync(join(logs, 'reports', files[0]), 'utf8');
    // the control character is gone
    assert.match(saved, /name 测试员/); assert.match(saved, /- 版本：0\.1\.0\n/);
    assert.equal((await post({ text: '   ' })).status, 400);
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post({ text: 'x'.repeat(70 * 1024) })).status, 413);
    // five a minute from one address: four more pass (five saved), the sixth is refused
    for (let i = 0; i < 4; i++) assert.equal((await post({ text: 'again ' + i })).status, 200);
    assert.equal((await post({ text: 'one too many' })).status, 429);
    const st = JSON.parse((await get(gw.port, '/status')).body);
    assert.equal(st.gateway.reports, 5);
    assert.ok(Array.isArray(st.gateway.errors));
  } finally { gw.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('the launcher starts a battle instance again after it dies', { timeout: 60000 }, async () => {
  // a base port whose instance port (+11) is free too
  let base;
  for (;;) { base = await free(); if (base + 11 < 65535) break; }
  const dir = mkdtempSync(join(tmpdir(), 'duel-pub-'));
  const p = spawn(process.execPath, [fileURLToPath(new URL('../server/launch.mjs', import.meta.url)), '--instances', '1', '--port', String(base)],
    { env: { ...process.env, DUEL_PUBLIC: dir, DUEL_LOGS: join(dir, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  const status = async () => JSON.parse((await get(base + 11, '/status')).body);
  const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } if (Date.now() - t0 > ms) throw new Error('timed out\n' + out); await new Promise((r) => setTimeout(r, 200)); } };
  try {
    const first = await until(status, 15000);
    process.kill(first.pid);
    const again = await until(async () => { const s = await status(); return s.pid !== first.pid && s; }, 20000);
    assert.notEqual(again.pid, first.pid);
    assert.match(out, /starting it again in 1 s/);
  } finally { p.kill(); rmSync(dir, { recursive: true, force: true }); }
});
