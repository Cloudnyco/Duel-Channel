// The cross-engine check of the battle sim (docs/ARCHITECTURE.md「模拟一致性检查」). The server predicts every battle
// and every page replays it from the same seed, so each engine must give the same bits as Node. This traces a corpus of
// battles in Node (tools/simcheck/duel.js: the golden battles, every round table, every pack of field traps) and writes
// public/sim-check.html — the sim, its data, the corpus and the reference in one file — which runs the same battles in
// the browser that opens it (the gateway serves it at /sim-check; a phone on the LAN can open it) and compares them step
// by step (tools/simcheck: core.js, ui.js — shared with Stronghold Protocol's check).
//
//   node tools/sim-check.mjs                     write public/sim-check.html
//   node tools/sim-check.mjs --engines chromium,firefox,webkit [--subset golden|all|gift|stand|traps] [--only id,id]
//                                                then run it headless in each engine (Playwright; chromium falls back to
//                                                a local Chrome); exit 1 when one differs
//   node tools/sim-check.mjs --diff <dump.json>  a block a browser downloaded (下载这一段的状态) against Node's run of
//                                                the same steps, entry by entry
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSim } from '../test/sim-env.mjs';
import { duelAdapter, duelCorpus } from './simcheck/duel.js';
import { buildReference, runEngines, formatEngines, diffDumpFile } from './simcheck/node.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
export const PAGE = fileURLToPath(new URL('public/sim-check.html', root));

/** The corpus and its adapter over Node's sim. */
export function nodeCheck() {
  const SIM = loadSim();
  const corpus = duelCorpus(SIM, JSON.parse(read('test/fixtures/golden.json')));
  return { SIM, corpus, adapter: duelAdapter(SIM, corpus) };
}
// an ES module as part of one inline module: its imports of the other parts and its export lists go, `export` before a
// declaration goes
const inline = (src) => src.replace(/^import .* from '\.\/[a-z]+\.js';\n/gm, '').replace(/^export \{[^}]*\};\n?/gm, '').replace(/^export (const|function|class) /gm, '$1 ');
const json = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

/** The check page: one file, nothing fetched. */
export function pageHtml({ corpus, reference, version }) {
  const parts = ['core.js', 'ui.js', 'duel.js'].map((f) => inline(read(`tools/simcheck/${f}`))).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>模拟一致性检查 · 争锋频道</title>
<style>
html, body { margin: 0; background: #14110f; }
#app { --sc-bg: #14110f; --sc-panel: #1f1a16; --sc-fg: #f3ede4; --sc-muted: #a99d8f; --sc-line: #3a3129; --sc-accent: #ffc94a; --sc-ok: #7fd18a;
  --sc-warn: #ffc94a; --sc-bad: #ff6a4d; --sc-font: system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
</style>
</head>
<body>
<main id="app"></main>
<script>
const FIGHTERS = ${read('data/fighters.json').trim()};
const DUELCFG = ${read('data/duelcfg.json').trim()};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
</script>
<script>
${read('shared/sim.js')}
</script>
<script type="application/json" id="sc-data">${json({ corpus, reference, version })}</script>
<script type="module">
${parts}
// the sim's functions, from the classic script above (shared/sim.js, as the game page runs it)
const SIM = { makeLineups, makeWorld, simStep, mulberry32, makeTraps, roundTable, STAGES, DCFG };
const D = JSON.parse(document.getElementById('sc-data').textContent);
const FAMILIES = [['gift', '礼物对决的轮次'], ['stand', '竞猜对决的轮次'], ['traps', '场地装置']];
mountCheck(document.getElementById('app'), {
  project: '争锋频道',
  title: '模拟一致性检查',
  subtitle: '在这台设备的浏览器里重放一批战斗，逐步与服务器（Node）预先算出的结果比较。服务器预测每场战斗，页面用同样的种子重放，两边必须逐位一致。',
  adapter: duelAdapter(SIM, D.corpus),
  scenarios: D.corpus.map((c) => ({ id: c.id, family: c.family, fast: c.fast })),
  subsets: [{ id: 'golden', label: '黄金对局', pick: (sc) => sc.fast }, { id: 'all', label: '全部', pick: () => true },
    ...FAMILIES.map(([id, label]) => ({ id, label, pick: (sc) => sc.family === id }))],
  reference: D.reference,
  info: [['游戏版本', D.version]],
});
</script>
</body>
</html>
`;
}

const commit = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim(); } catch { return ''; } };

async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const { corpus, adapter } = nodeCheck();
  const scenarios = corpus.map((c) => ({ id: c.id, family: c.family, fast: c.fast }));
  if (opt('--diff')) { for (const line of diffDumpFile(opt('--diff'), adapter, scenarios)) console.log(line); return 0; }
  const t0 = Date.now(), version = JSON.parse(read('package.json')).version;
  const reference = buildReference(adapter, scenarios, { project: 'duel-channel', made: { version, commit: commit() } });
  mkdirSync(new URL('public/', root), { recursive: true });
  const html = pageHtml({ corpus, reference, version });
  writeFileSync(PAGE, html);
  console.log(`${scenarios.length} battles traced in ${((Date.now() - t0) / 1000).toFixed(1)} s → public/sim-check.html (${(html.length / 1048576).toFixed(1)} MB; the gateway serves it at /sim-check)`);
  const engines = opt('--engines');
  if (!engines) return 0;
  const q = new URLSearchParams({ auto: '1', subset: opt('--subset') || 'all' });
  if (opt('--only')) q.set('only', opt('--only'));
  const res = await runEngines(`${pathToFileURL(PAGE).href}?${q}`, engines.split(','), { log: (s) => console.log(s) });
  for (const line of formatEngines(res)) console.log(line);
  return Object.values(res).every((r) => r.status === 'done' && r.summary && r.summary.ok === r.summary.n) ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
