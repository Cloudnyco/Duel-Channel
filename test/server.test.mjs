// The multiplayer server end to end: a gateway and one battle instance on free ports, eight bot clients queue for
// 礼物对决 and play a whole match (fast timings) sending emojis, two of them losing their connection once and coming
// back, the status page and the health probe answer.
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
