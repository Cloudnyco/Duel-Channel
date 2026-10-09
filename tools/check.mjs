// Static checks that need no asset pack (run in CI): the page template and its sources fit together, the scripts parse
// as the classic scripts they are inlined as, the data files hold what the sim and the page read, and no asset or
// built page is tracked by git.
// usage: node tools/check.mjs
import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => readFileSync(join(ROOT, p), 'utf8');
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// the template: each placeholder once
const tpl = rd('web/index.src.html');
for (const k of ['FONT_BENDER', 'FONT_NOVECENTO', 'PIXI', 'PIXISPINE', 'DATA', 'FIGHTERS', 'DUELCFG', 'AUDIO', 'FXTEX', 'ENGINE', 'PARTICLES', 'SIM', 'ARENA', 'NET', 'FLOW']) {
  check(tpl.split(`/*${k}*/`).length === 2, `web/index.src.html: /*${k}*/ must appear exactly once`);
}
// the page's scripts are concatenated into one function body: together they must parse
const body = ['web/src/engine.js', 'web/src/particles.js', 'shared/sim.js', 'web/src/arena.js', 'web/src/net.js', 'web/src/flow.js'].map(rd).join('\n');
try { new Function(body); } catch (e) { fails.push('web sources do not parse together: ' + e.message); }
// data
const cfg = JSON.parse(rd('data/duelcfg.json')), roster = JSON.parse(rd('data/fighters.json'));
for (const k of ['modes', 'rounds', 'npcs', 'npcSelector', 'consts', 'env', 'tips']) check(cfg[k], `data/duelcfg.json: missing ${k}`);
for (const k of ['zoneFirst', 'zoneEvery', 'zoneCentre', 'zones', 'atkMul', 'hpMul', 'moveMultiplier']) check(cfg.env && cfg.env[k] !== undefined, `data/duelcfg.json env: missing ${k}`);
check(Array.isArray(roster) && roster.length > 0, 'data/fighters.json: empty');
for (const f of roster) {
  for (const k of ['key', 'name', 'hp', 'atk', 'def', 'res', 'bat', 'aspd', 'ms', 'range', 'score', 'pool', 'talents']) check(f[k] !== undefined, `data/fighters.json ${f.key}: missing ${k}`);
  check(!('spine' in f) && !('icon' in f), `data/fighters.json ${f.key}: models / portraits belong in the asset pack, not the repository`);
}
const fx = JSON.parse(rd('web/fx-map.json'));
for (const [k, v] of Object.entries(fx)) if (k !== '_comment') check(/^[\w.-]+\.(png|jpg)$/.test(v), `web/fx-map.json ${k}: not a plain file name`);
// nothing from the asset pack or a built page under version control
let tracked = [];
try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch (e) { /* not a checkout */ }
for (const f of tracked) {
  check(!/^(assets|public)\//.test(f) || f === 'public/.gitkeep', `tracked file in an ignored folder: ${f}`);
  check(!/\.(ogg|wav|mp3|skel|atlas|woff2?|otf|ttf)$/i.test(f), `tracked binary asset: ${f}`);
  const size = statSync(join(ROOT, f)).size;
  check(size < 1.5 * 1048576, `tracked file over 1.5 MB: ${f} (${(size / 1048576).toFixed(1)} MB)`);
}
if (fails.length) { console.error(fails.map((m) => '✗ ' + m).join('\n')); process.exit(1); }
console.log(`ok: template, ${body.split('\n').length} lines of page code, ${roster.length} fighters, ${Object.values(cfg.rounds).flat().length} rounds, ${tracked.length} tracked files`);
