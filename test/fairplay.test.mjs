// Fair play: a round's seed stays with the server until the bets close (the line-ups come with a commitment the seed and
// salt then match), the window's last part is secret (picks made then, and the NPC viewers' picks that use the
// outcome, show only as the bets close), a seat's messages and pick changes are rate-limited, and a debug server
// (DUEL_DEBUG=1) sends the seed with the round. The gateway: one seat per browser in the public queues, viewers from one
// address at different tables, a room code's failed tries and a flooding connection cut off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

process.env.DUEL_BET_MS = '3000'; process.env.DUEL_SECRET_MS = '1500'; process.env.DUEL_RESULT_MS = '50'; process.env.DUEL_RANK_MS = '50';
const { Match, SIM, commitOf } = await import('../server/game.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a seat's connection as the match sees it: what it is sent (with the time since t0), its message handler
function fakeSeat(m, p) {
  const s = { got: [], t0: Date.now(), closed: null, h: {} };
  const ws = { readyState: 1, send: (x) => { const msg = JSON.parse(x); msg.at = Date.now() - s.t0; s.got.push(msg); if (msg.t === 'battle') setTimeout(() => m.onMessage(p, { t: 'watched' }), 10); },
    on: (ev, fn) => { s.h[ev] = fn; }, close: (code) => { s.closed = code; } };
  m.attach(ws, p.token);
  s.say = (o) => s.h.message(JSON.stringify(o));
  return s;
}

test('a round: no seed before the bets close; the seed and salt then match the commitment and give the result', { timeout: 30000 }, async () => {
  const m = new Match({ id: 't-1', mode: 'multiOperationMatch', humans: [{ name: 'a', tag: '#1', avatar: SIM.POOL[0].key }], npcFill: true });
  // 你推的∩酱 (CHOOSE_WIN) at the table
  m.players.find((p) => p.npc).npc = Object.values(SIM.DCFG.npcs).find((n) => n.specialStrategy === 'CHOOSE_WIN');
  const me = m.players[0], s = fakeSeat(m, me);
  s.t0 = Date.now();
  // a pick while picks show, changed in the secret part
  setTimeout(() => s.say({ t: 'bet', side: 0, kind: 'normal' }), 300);
  setTimeout(() => s.say({ t: 'bet', side: 1, kind: 'normal' }), 2000);
  await m.playRound(SIM.roundTable('multiOperationMatch')[0][0], 1);
  const round = s.got.find((x) => x.t === 'round'), battle = s.got.find((x) => x.t === 'battle'), result = s.got.find((x) => x.t === 'result');
  assert.equal(round.seed, undefined); assert.equal(round.salt, undefined); assert.match(round.commit, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(battle.seed)); assert.match(battle.salt, /^[0-9a-f]{32}$/);
  assert.equal(commitOf(battle.seed, battle.salt), round.commit);
  const lineups = round.lineups.map((side) => side.map(([k, n]) => ({ f: SIM.POOL.find((f) => f.key === k), n })));
  assert.equal(SIM.predict(lineups, battle.seed).winner, result.w);
  // the secret part: from 1.5 s on, only one's own pick comes back; the NPC who knows the winner never shows before
  const secret = s.got.find((x) => x.t === 'secret');
  assert.ok(secret && secret.at >= 1400 && secret.at < 2000, String(secret && secret.at));
  const bets = s.got.filter((x) => x.t === 'bets');
  for (const b of bets.filter((x) => x.at > secret.at)) assert.deepEqual(Object.keys(b.choices), [me.id]);
  const knower = m.players.find((p) => p.npc && p.npc.specialStrategy === 'CHOOSE_WIN');
  assert.ok(!bets.some((b) => knower.id in b.choices));
  const kc = battle.choices[knower.id];
  if (!kc.skip && result.w !== 'draw') assert.equal(kc.side, result.w);
  assert.equal(battle.choices[me.id].side, 1);
  // the other NPCs that bet while picks showed: none informed
  for (const p of m.players.filter((x) => x.npc && bets.some((b) => b.at < secret.at && x.id in b.choices))) assert.equal(p.informed, false, p.name);
});

test('a seat: pick changes capped each round; a flood of messages is dropped, then the seat is cut off', { timeout: 30000 }, async () => {
  const m = new Match({ id: 't-2', mode: 'multiOperationMatch', humans: [{ name: 'a', tag: '#1', avatar: SIM.POOL[0].key }], npcFill: true });
  const me = m.players[0], s = fakeSeat(m, me);
  const p = m.playRound(SIM.roundTable('multiOperationMatch')[0][0], 1);
  await sleep(100);
  for (let i = 0; i < 14; i++) m.onMessage(me, { t: 'bet', side: i % 2, kind: 'normal' });
  assert.ok(s.got.some((x) => x.t === 'error' && /改选次数过多/.test(x.msg)));
  assert.equal(me.choice.side, 1);   // the 12th pick stands
  await p;
  // pings: 20 at once go through, the rest are dropped; past 200 dropped the connection is closed
  for (let i = 0; i < 260; i++) s.say({ t: 'ping', c: i });
  assert.ok(s.got.filter((x) => x.t === 'pong').length <= 21);
  assert.equal(s.closed, 4008);
});

test('a debug server (DUEL_DEBUG=1) sends the seed with the round, and says so', { timeout: 30000 }, async () => {
  const code = `
    process.env.DUEL_BET_MS = '200';
    const { Match, SIM, commitOf } = await import(${JSON.stringify(new URL('../server/game.mjs', import.meta.url).href)});
    const m = new Match({ id: 'd', mode: 'multiOperationMatch', humans: [{ name: 'a', tag: '#1', avatar: SIM.POOL[0].key }], npcFill: false });
    const out = [];
    m.attach({ readyState: 1, send: (x) => out.push(JSON.parse(x)), on() {}, close() {} }, m.players[0].token);
    m.playRound(SIM.roundTable('multiOperationMatch')[0][0], 1);
    const r = out.find((x) => x.t === 'round'), h = out.find((x) => x.t === 'hello');
    console.log(JSON.stringify({ debug: h.debug, seed: r.seed, ok: commitOf(r.seed, r.salt) === r.commit }));
    process.exit(0);`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DUEL_DEBUG: '1' } });
  let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  await new Promise((r) => p.on('exit', r));
  const o = JSON.parse(out.trim().split('\n').pop());
  assert.equal(o.debug, true); assert.ok(Number.isInteger(o.seed)); assert.equal(o.ok, true);
});

test('NPC viewers: who uses the outcome (CHOOSE_WIN; DEFAULT now and then; 竞猜对决 after 3 right)', () => {
  const npc = (st) => Object.values(SIM.DCFG.npcs).find((n) => n.specialStrategy === st);
  const rnd = () => 0.5;
  assert.equal(SIM.npcInformed(npc('CHOOSE_WIN'), { rnd }), true);
  assert.equal(SIM.npcInformed(npc('ALWAYS_LEFT'), { rnd }), false);
  assert.equal(SIM.npcInformed(npc('ALWAYS_LEFT'), { stand: true, pass: 3, rnd }), true);
  assert.equal(SIM.npcInformed(npc('DEFAULT'), { rnd: () => 0.1 }), true);
  assert.equal(SIM.npcInformed(npc('DEFAULT'), { rnd: () => 0.9 }), false);
});

// ---- the gateway -------------------------------------------------------------------------------------------------------
const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const node = (file, env) => spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { env: { ...process.env, ...env }, stdio: 'ignore' });
function lobby(port, ip, cid) {
  return new Promise((res, rej) => {
    const w = new WebSocket(`ws://127.0.0.1:${port}/lobby`, { headers: { 'X-Forwarded-For': ip } });
    const c = { w, q: [], closed: null, send: (o) => w.send(JSON.stringify(o)) };
    c.next = async (t, ms = 15000) => { const t0 = Date.now(); for (;;) { const i = c.q.findIndex((x) => x.t === t); if (i >= 0) return c.q.splice(i, 1)[0]; if (Date.now() - t0 > ms) return null; await sleep(50); } };
    w.on('message', (d) => c.q.push(JSON.parse(d))); w.on('close', (code) => { c.closed = code; });
    w.on('error', rej);
    w.on('open', async () => { c.send({ t: 'hello', name: ip, cid }); await c.next('welcome'); res(c); });
  });
}

test('the queues: one seat per browser, one table per address; a room code\'s failed tries and a flood cut off', { timeout: 60000 }, async () => {
  const gw = await free(), ip = await free();
  const procs = [node('../server/instance.mjs', { PORT: String(ip), HOST: '127.0.0.1' }),
    node('../server/gateway.mjs', { PORT: String(gw), HOST: '127.0.0.1', INSTANCES: String(ip), QUEUE_FILL_MS: '1500', TRUST_PROXY: '1' })];
  try {
    for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${gw}/healthz`); if ((await r.json()).instances === 1) break; } catch (e) { /* not yet */ } await sleep(150); }
    const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);
    const a1 = await lobby(gw, '10.0.0.1', A), a1b = await lobby(gw, '10.0.0.9', A), a2 = await lobby(gw, '10.0.0.1', B), b = await lobby(gw, '10.0.0.2', C);
    // the same browser twice in the queue: refused
    a1.send({ t: 'queue', mode: 'multiOperationMatch' });
    await sleep(100);
    a1b.send({ t: 'queue', mode: 'multiOperationMatch' });
    const refused = await a1b.next('error', 3000);
    assert.match(refused.msg, /同一浏览器只能占一个座位/);
    // two from one address: at different tables
    a2.send({ t: 'queue', mode: 'multiOperationMatch' }); b.send({ t: 'queue', mode: 'multiOperationMatch' });
    const m1 = await a1.next('matched'), mb = await b.next('matched'), m2 = await a2.next('matched');
    assert.ok(m1 && mb && m2);
    assert.equal(m1.matchId, mb.matchId); assert.notEqual(m2.matchId, m1.matchId);
    // seated: the browser cannot queue again while its seat is in play
    a1b.send({ t: 'queue', mode: 'multiOperationMatch' });
    assert.match((await a1b.next('error', 3000)).msg, /同一浏览器只能占一个座位/);
    // a room code's failed tries: ten a minute, then refused
    const c = await lobby(gw, '10.0.0.3', null);
    for (let i = 0; i < 10; i++) { c.send({ t: 'room.join', code: '000000' }); assert.match((await c.next('error', 3000)).msg, /房间不存在/); }
    c.send({ t: 'room.join', code: '000000' });
    assert.match((await c.next('error', 3000)).msg, /尝试过于频繁/);
    // a flood: cut off
    const d = await lobby(gw, '10.0.0.4', null);
    for (let i = 0; i < 400; i++) d.send({ t: 'ping', c: i });
    for (let i = 0; i < 40 && d.closed === null; i++) await sleep(50);
    assert.equal(d.closed, 4008);
    for (const x of [a1, a1b, a2, b, c]) x.w.close();
  } finally { for (const p of procs) p.kill(); }
});
