// The cross-engine check (tools/simcheck, tools/sim-check.mjs): the hashes are pinned (the same in Stronghold
// Protocol's copy of core.js, and a reference made before still compares), a change in one tick is found in its block
// and named by the dump comparison, the deep walk sees another realm's Map / Set (the sim runs in a VM context in Node),
// and the corpus replays the golden battles — the same battle whatever ran before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { hex, hashNumbers, hashValue, deepHash, trace, tracer, compare, diffDumps } from '../tools/simcheck/core.js';
import { nodeCheck, pageHtml } from '../tools/sim-check.mjs';

test('simcheck hashes: pinned values, NaN as one value, −0 apart from 0', () => {
  assert.equal(hex(hashNumbers([0, -0, 1, 0.1, -2.5e-300, 1e300, NaN, Infinity])), '8b3e38ba');
  assert.equal(hex(hashValue({ a: [1, 'x', null, true], b: { c: 0.5 } })), 'a024c2ef');
  assert.equal(hex(hashNumbers([NaN])), hex(hashNumbers([0 / 0])));
  assert.notEqual(hex(hashNumbers([0])), hex(hashNumbers([-0])));
  assert.equal(hex(deepHash([{ s: new Set([1, 2]), m: new Map([['k', 3]]), arr: [4.5] }])), '92f56136');
});

test('simcheck deep walk: a Map / Set made in another realm hashes like one made here', () => {
  const other = vm.runInNewContext('({ s: new Set([1, 2]), m: new Map([["k", 3]]), arr: [4.5] })');
  assert.equal(deepHash([other]), deepHash([{ s: new Set([1, 2]), m: new Map([['k', 3]]), arr: [4.5] }]));
});

test('simcheck compare: a one-ulp change at step 45 is found in its block and named by the dumps', () => {
  // a toy sim: one value, one step at a time; `bump` changes it by one ulp at step 45
  const toy = (bump) => ({
    start: () => ({ n: 0, x: 0.1 }),
    step: (r) => { if (r.n >= 100) return false; r.n++; r.x = r.x * 1.01 + 0.1; if (bump && r.n === 45) r.x = r.x + r.x * Number.EPSILON; return true; },
    state: (r) => [r.n, r.x], labels: () => ['n', 'x'], view: (r) => ({ x: Math.round(r.x) }), deep: (r) => hashNumbers([r.x]), result: (r) => String(Math.round(r.x)),
  });
  const ref = trace(toy(false), { id: 't' }), got = trace(toy(true), { id: 't' });
  assert.deepEqual(compare(ref, trace(toy(false), { id: 't' })), { ok: true, at: null, result: false, ticks: null });
  const c = compare(ref, got);
  assert.equal(c.ok, false);
  assert.deepEqual(c.at, { level: 'state', block: 1, from: 31, to: 60 });
  const a = tracer(toy(false), { id: 't' }, { dump: [31, 60] }).finish(), b = tracer(toy(true), { id: 't' }, { dump: [31, 60] }).finish();
  const d = diffDumps(a.dumps, b.dumps);
  assert.equal(d[0].tick, 45);
  assert.equal(d[0].label, 'x');
});

test('simcheck corpus: the golden battles replay as test/fixtures/golden.json has them, whatever ran before', () => {
  const golden = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
  const a = nodeCheck();
  for (let i = 0; i < 10; i++) {
    const [winner, steps] = trace(a.adapter, { id: `golden-${String(i + 1).padStart(2, '0')}` }).result.split('|');
    assert.equal(winner, String(golden[i].winner), `golden-${i + 1} winner`);
    assert.equal(Number(steps), golden[i].steps, `golden-${i + 1} steps`);
  }
  const alone = trace(nodeCheck().adapter, { id: 'golden-12' }), after = trace(a.adapter, { id: 'golden-12' });
  assert.deepEqual(after, alone);
  assert.ok(a.corpus.length > 300 && new Set(a.corpus.map((c) => c.id)).size === a.corpus.length);
});

test('simcheck page: one file, its module free of imports and exports, parsable', () => {
  const html = pageHtml({ corpus: [], reference: { every: 30, scenarios: {} }, version: 'test' });
  const mod = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
  assert.doesNotMatch(mod, /^\s*(import|export)\b/m);
  assert.doesNotThrow(() => new vm.Script(mod));
  assert.match(html, /<script>\nconst FIGHTERS = /);
});
