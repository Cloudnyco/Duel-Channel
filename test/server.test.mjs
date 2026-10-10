// The multiplayer server end to end: a gateway and one battle instance on free ports, eight bot clients queue for
// 礼物对决 and play a whole match (fast timings) sending emojis, two of them losing their connection once and coming
// back, the status page and the health probe answer; twelve bots play 竞猜对决 in a room filled to 30 with NPCs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const node = (file, args, env) => spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url)), ...args], {
  env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 200)); } };

test('a full match: 8 bots through the queue on one instance', { timeout: 240000 }, async () => {
  const gw = await free(), ip = await free();
  const fast = { DUEL_BET_MS: '1500', DUEL_RANK_MS: '300', DUEL_RESULT_MS: '300', DUEL_SHOW_MS: '300', QUEUE_FILL_MS: '1500' };
  const procs = [node('../server/instance.mjs', [], { ...fast, PORT: String(ip), HOST: '127.0.0.1' }),
    node('../server/gateway.mjs', [], { ...fast, PORT: String(gw), HOST: '127.0.0.1', INSTANCES: String(ip) })];
  let log = '';
  for (const p of procs) { p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; }); }
  try {
    const h = await until(async () => { const r = await fetch(`http://127.0.0.1:${gw}/healthz`); const j = await r.json(); return j.instances === 1 && j; }, 20000);
    assert.equal(h.ok, true);
    const bots = node('../server/bots.mjs', ['--n', '8', '--lobby', `ws://127.0.0.1:${gw}/lobby`, '--drop-resume', '1', '--drop-rejoin', '2'], { BOT_PACE: '0.1' });
    let out = '';
    bots.stdout.on('data', (d) => { out += d; });
    const code = await new Promise((res) => bots.on('exit', res));
    assert.equal(code, 0, out + log);
    const finished = out.split('\n').filter((l) => /finished #\d+ with \d+/.test(l));
    assert.equal(finished.length, 8, out);
    const ranks = finished.map((l) => Number(l.match(/#(\d+)/)[1])).sort((a, b) => a - b);
    assert.deepEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8]);
    // a dropped connection that comes back (with the last seq, or afresh as a reloaded page) misses no round: the
    // instance replays what it missed, so it sees as many rounds and results as everyone else
    const counts = finished.map((l) => { const [, r, res, d] = l.match(/rounds (\d+), results (\d+), drops (\d+)/).map(Number); return { r, res, d, l }; });
    const most = Math.max(...counts.map((c) => c.res));
    assert.ok(most >= 3, out);
    for (const c of counts) assert.equal(c.res, most, c.l);
    assert.equal(counts.filter((c) => c.d === 1 && / resume\)/.test(c.l)).length, 1, out);
    assert.equal(counts.filter((c) => c.d === 1 && / rejoin\)/.test(c.l)).length, 1, out);
    // emojis: everyone sees the others'; a double send gets through once; a picture outside the theme never
    for (const l of finished) {
      const [, others, burst, bad] = l.match(/emoji: others (\d+), burst (\d+), bad (\d+)/).map(Number);
      assert.ok(others > 0, l); assert.equal(burst, 1, l); assert.equal(bad, 0, l);
    }
    const st = await (await fetch(`http://127.0.0.1:${gw}/status`)).json();
    assert.equal(st.instances.length, 1);
  } finally { for (const p of procs) p.kill(); }
});

test('a 竞猜对决 match: 12 bots in a room filled to 30 with NPCs, played to its end', { timeout: 240000 }, async () => {
  const gw = await free(), ip = await free();
  const fast = { DUEL_BET_MS: '1500', DUEL_RANK_MS: '300', DUEL_RESULT_MS: '300', DUEL_SHOW_MS: '300' };
  const procs = [node('../server/instance.mjs', [], { ...fast, PORT: String(ip), HOST: '127.0.0.1' }),
    node('../server/gateway.mjs', [], { ...fast, PORT: String(gw), HOST: '127.0.0.1', INSTANCES: String(ip) })];
  let log = '';
  for (const p of procs) { p.stdout.on('data', (d) => { log += d; }); p.stderr.on('data', (d) => { log += d; }); }
  try {
    await until(async () => { const r = await fetch(`http://127.0.0.1:${gw}/healthz`); return (await r.json()).instances === 1; }, 20000);
    const bots = node('../server/bots.mjs', ['--n', '12', '--mode', 'stand', '--room', 'new', '--npc', '--lobby', `ws://127.0.0.1:${gw}/lobby`], { BOT_PACE: '0.1' });
    let out = '';
    bots.stdout.on('data', (d) => { out += d; });
    const code = await new Promise((res) => bots.on('exit', res));
    assert.equal(code, 0, out + log);
    assert.equal(out.split('\n').filter((l) => /finished #\d+ guessed \d+/.test(l)).length, 12, out);
    const line = out.split('\n').find((l) => l.startsWith('standings '));
    const { rounds, draws, players } = JSON.parse(line.slice(10));
    // 12 viewers + 18 NPCs (the room's NPC fill up to modes.multiStandRoom.maxPlayer)
    assert.equal(players.length, 30); assert.equal(players.filter((p) => p.human).length, 12);
    assert.ok(rounds >= 2, line);
    // it ended because at most one viewer, or no human, was still in
    const live = players.filter((p) => !p.out);
    assert.ok(live.length <= 1 || !live.some((p) => p.human), line);
    for (const p of players) {
      // the 观众保护 was only ever taken in rounds 1–5, and nobody holds one after round 5
      assert.ok(p.shieldAt >= 0 && p.shieldAt <= 5, JSON.stringify(p));
      if (rounds > 5) assert.equal(p.shield, false, JSON.stringify(p));
      if (p.out) assert.ok(p.outRound >= 1 && p.outRound <= rounds, JSON.stringify(p));
      // an NPC guesses right at most 3 times (a draw is right for everyone)
      if (!p.human) assert.ok(p.pass <= 3 + draws, JSON.stringify(p));
    }
    // the standings follow the rounds guessed right, then who stayed in longer
    const key = (p) => [p.pass, p.out ? p.outRound : 1e9];
    const order = players.slice().sort((a, b) => a.rank - b.rank);
    assert.equal(order[0].rank, 1);
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [key(order[i - 1]), key(order[i])];
      assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]), `${JSON.stringify(order[i - 1])} before ${JSON.stringify(order[i])}`);
      assert.equal(order[i].rank === order[i - 1].rank, a[0] === b[0] && a[1] === b[1]);
    }
    const st = await (await fetch(`http://127.0.0.1:${gw}/status`)).json();
    assert.ok('multiStandMatch' in st.gateway.queues);
  } finally { for (const p of procs) p.kill(); }
});
