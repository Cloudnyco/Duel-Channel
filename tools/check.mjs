// Static checks (run in CI): the page template and its sources fit together, the scripts parse as the classic scripts
// they are inlined as, the data files hold what the sim and the page read, and git tracks the asset pack only where it
// belongs (assets/, complete when there; never the display fonts or a built page).
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
for (const k of ['FONT_BENDER', 'FONT_NOVECENTO', 'PIXI', 'PIXISPINE', 'DUELCFG', 'BUILD', 'PACK', 'REPORT', 'ENGINE', 'PARTICLES', 'SIM', 'ARENA', 'NET', 'EMOTE', 'FLOW']) {
  check(tpl.split(`/*${k}*/`).length === 2, `web/index.src.html: /*${k}*/ must appear exactly once`);
}
// the page's scripts are concatenated into one function body: together they must parse
const body = ['web/src/report.js', 'web/src/engine.js', 'web/src/particles.js', 'shared/sim.js', 'web/src/arena.js', 'web/src/net.js', 'web/src/emote.js', 'web/src/flow.js'].map(rd).join('\n');
try { new Function(body); } catch (e) { fails.push('web sources do not parse together: ' + e.message); }
// the served page's loader runs on its own, before the game
try { new Function(rd('web/src/loader.js')); } catch (e) { fails.push('web/src/loader.js does not parse: ' + e.message); }
// data
const cfg = JSON.parse(rd('data/duelcfg.json')), roster = JSON.parse(rd('data/fighters.json'));
for (const k of ['modes', 'rounds', 'npcs', 'npcSelector', 'consts', 'env', 'tips']) check(cfg[k], `data/duelcfg.json: missing ${k}`);
for (const k of ['zoneFirst', 'zoneEvery', 'zoneCentre', 'zones', 'atkMul', 'hpMul', 'moveMultiplier']) check(cfg.env && cfg.env[k] !== undefined, `data/duelcfg.json env: missing ${k}`);
check(Array.isArray(roster) && roster.length > 0, 'data/fighters.json: empty');
for (const f of roster) {
  for (const k of ['key', 'name', 'hp', 'atk', 'def', 'res', 'bat', 'aspd', 'ms', 'range', 'score', 'pool', 'talents']) check(f[k] !== undefined, `data/fighters.json ${f.key}: missing ${k}`);
  check(!('spine' in f) && !('icon' in f), `data/fighters.json ${f.key}: models / portraits belong in the asset pack (assets/models.json)`);
}
const fx = JSON.parse(rd('web/fx-map.json'));
for (const [k, v] of Object.entries(fx)) if (k !== '_comment') check(/^[\w.-]+\.(png|jpg)$/.test(v), `web/fx-map.json ${k}: not a plain file name`);
// what git tracks: the asset pack under assets/ (minus the fonts, which are not the game's), no built page, no loose
// media elsewhere, nothing large outside assets/
let tracked = [];
try { tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean); } catch (e) { /* not a checkout */ }
for (const f of tracked) {
  const pack = f.startsWith('assets/');
  check(!f.startsWith('public/') || f === 'public/.gitkeep', `tracked built page: ${f}`);
  check(!f.startsWith('assets/fonts/') && !/\.(woff2?|otf|ttf)$/i.test(f), `tracked font (its authors' terms; fetched at build time): ${f}`);
  check(pack || !/\.(ogg|wav|mp3|skel|atlas)$/i.test(f), `media outside the asset pack: ${f}`);
  check(pack || statSync(join(ROOT, f)).size < 1.5 * 1048576, `tracked file over 1.5 MB: ${f}`);
}
// a tracked asset pack is a complete one (what tools/build-page.mjs needs; the fonts are fetched)
const packFiles = tracked.filter((f) => f.startsWith('assets/'));
if (packFiles.length) {
  for (const f of ['assets/ui.json', 'assets/models.json', ...Object.entries(fx).filter(([k]) => k !== '_comment').map(([, v]) => `assets/fx/${v}`)]) {
    check(packFiles.includes(f), `asset pack: ${f} is not tracked`);
  }
  check(packFiles.some((f) => f.startsWith('assets/audio/') && f.endsWith('.ogg')), 'asset pack: no sound tracked');
}
if (fails.length) { console.error(fails.map((m) => '✗ ' + m).join('\n')); process.exit(1); }
console.log(`ok: template, ${body.split('\n').length} lines of page code, ${roster.length} fighters, ${Object.values(cfg.rounds).flat().length} rounds, ${tracked.length} tracked files`);
