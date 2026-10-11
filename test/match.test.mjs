// A match's start: a seat whose connection comes late — after STARTING SOON would have ended — is waited for (up to
// connectMax) and plays from the first round; before, the match went on without it and, with no one connected when the
// rounds began, closed at once (the full-match test failing on a slow runner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

test('a seat connecting late still plays from the first round', { timeout: 60000 }, async () => {
  Object.assign(process.env, { DUEL_SHOW_MS: '100', DUEL_BET_MS: '300', DUEL_RESULT_MS: '50', DUEL_RANK_MS: '50' });
  const { Match } = await import('../server/game.mjs');
  const m = new Match({ id: 'late-1', mode: 'multiOperationMatch', humans: [{ name: 'late', avatar: null }], npcFill: true });
  const got = [];
  // a client's socket: it answers loading with ready
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    send(s) { const j = JSON.parse(s); got.push(j.t); if (j.t === 'phase' && j.name === 'loading') setImmediate(() => ws.emit('message', JSON.stringify({ t: 'ready' }))); },
    close() { ws.readyState = 3; },
  });
  const run = m.run();
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(m.phase, 'wait', 'the match waits for its seat to connect');
  m.attach(ws, m.tokens()[0].token);
  for (let i = 0; i < 100 && !got.includes('round'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(got.includes('round'), `no round after a late connection: ${got.join(' ')}`);
  // leaving ends it after this round
  ws.emit('message', JSON.stringify({ t: 'leave' }));
  await run;
  assert.ok(m.done);
});
