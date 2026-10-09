// Builds the playable page: web/index.src.html with every script, the data and the local asset pack inlined into one
// file, public/duel-flow.html (opened as a file it plays offline; served by the gateway it plays online).
//
// Inputs
//   web/src/*.js, shared/sim.js        this repository's code
//   data/duelcfg.json, data/fighters.json   the duel's configuration and roster (generated from the game's data tables)
//   node_modules/pixi.js, pixi-spine    the renderers (npm install)
//   <assets>/                           the asset pack, never committed — see docs/ASSETS.md:
//     ui.json            the event's exported screens, templates, sprites, clips and UI Spine
//     models.json        per roster key: { spine: { skel, atlas, pages, pma, anims }, icon }
//     audio/*.ogg        the event's UI sounds (+ the default BGM, m_nobetnolife.ogg, if present)
//     fx/*               the textures listed in web/fx-map.json
//     fonts/bender-regular.woff2, fonts/novecento-wide-normal.woff2
//
// usage: node tools/build-page.mjs [--assets assets] [--out public/duel-flow.html] [--check]
//   --check: only verify that every input exists and report what is missing (no output; exit 1 when incomplete)
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const A = resolve(ROOT, arg('--assets', process.env.DUEL_ASSETS || 'assets'));
const OUT = resolve(ROOT, arg('--out', 'public/duel-flow.html'));
const CHECK = process.argv.includes('--check');

const FX = JSON.parse(readFileSync(join(ROOT, 'web', 'fx-map.json'), 'utf8'));
delete FX._comment;
const need = [
  join(ROOT, 'node_modules', 'pixi.js', 'dist', 'pixi.min.js'), join(ROOT, 'node_modules', 'pixi-spine', 'dist', 'pixi-spine.js'),
  join(A, 'ui.json'), join(A, 'models.json'), join(A, 'audio'),
  join(A, 'fonts', 'bender-regular.woff2'), join(A, 'fonts', 'novecento-wide-normal.woff2'),
  ...Object.values(FX).map((f) => join(A, 'fx', f)),
];
const missing = need.filter((p) => !existsSync(p));
if (missing.length) {
  console.error(`asset pack incomplete (${A}): ${missing.length} missing\n  ` + missing.map((p) => p.replace(ROOT, '.')).join('\n  '));
  console.error('see docs/ASSETS.md');
  process.exit(1);
}
if (CHECK) { console.log('asset pack complete:', A); process.exit(0); }

const rd = (p) => readFileSync(p, 'utf8');
const b64 = (p) => readFileSync(p).toString('base64');
const safe = (t) => t.replace(/<\/script/gi, '<\\/script');
// the roster: the committed stats + the local models
const lite = JSON.parse(rd(join(ROOT, 'data', 'fighters.json'))), models = JSON.parse(rd(join(A, 'models.json')));
const fighters = lite.filter((f) => models[f.key]).map((f) => ({ ...f, ...models[f.key] }));
if (fighters.length < lite.length) console.warn(`models for ${fighters.length} of ${lite.length} fighters; the others are left out`);
const audio = Object.fromEntries(readdirSync(join(A, 'audio')).filter((f) => f.endsWith('.ogg')).sort().map((f) => [f.slice(0, -4), b64(join(A, 'audio', f))]));
const fxtex = Object.fromEntries(Object.entries(FX).map(([k, f]) => [k, `data:image/${f.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${b64(join(A, 'fx', f))}`]));
const parts = {
  '/*FONT_BENDER*/': 'data:font/woff2;base64,' + b64(join(A, 'fonts', 'bender-regular.woff2')),
  '/*FONT_NOVECENTO*/': 'data:font/woff2;base64,' + b64(join(A, 'fonts', 'novecento-wide-normal.woff2')),
  '/*PIXI*/': safe(rd(join(ROOT, 'node_modules', 'pixi.js', 'dist', 'pixi.min.js'))),
  '/*PIXISPINE*/': safe(rd(join(ROOT, 'node_modules', 'pixi-spine', 'dist', 'pixi-spine.js'))),
  '/*DATA*/': 'const DUEL = ' + safe(rd(join(A, 'ui.json'))) + ';',
  '/*FIGHTERS*/': 'const FIGHTERS = ' + safe(JSON.stringify(fighters)) + ';',
  '/*DUELCFG*/': 'const DUELCFG = ' + safe(rd(join(ROOT, 'data', 'duelcfg.json'))) + ';',
  '/*AUDIO*/': 'const AUDIO = ' + JSON.stringify(audio) + ';',
  '/*FXTEX*/': 'const FXTEX = ' + JSON.stringify(fxtex) + ';',
  '/*ENGINE*/': safe(rd(join(ROOT, 'web', 'src', 'engine.js'))),
  '/*PARTICLES*/': safe(rd(join(ROOT, 'web', 'src', 'particles.js'))),
  '/*SIM*/': safe(rd(join(ROOT, 'shared', 'sim.js'))),
  '/*ARENA*/': safe(rd(join(ROOT, 'web', 'src', 'arena.js'))),
  '/*NET*/': safe(rd(join(ROOT, 'web', 'src', 'net.js'))),
  '/*FLOW*/': safe(rd(join(ROOT, 'web', 'src', 'flow.js'))),
};
let out = rd(join(ROOT, 'web', 'index.src.html'));
for (const [k, v] of Object.entries(parts)) {
  const n = out.split(k).length - 1;
  if (n !== 1) throw new Error(`template: ${k} appears ${n} times`);
  out = out.replace(k, () => v);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`${OUT.replace(ROOT, '.')}  ${(out.length / 1048576).toFixed(1)} MB  (${fighters.length} fighters, ${Object.keys(audio).length} sounds, ${Object.keys(fxtex).length} textures)`);
