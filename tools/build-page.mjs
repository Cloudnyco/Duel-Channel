// Builds the playable page from web/index.src.html, the scripts, the data and the local asset pack, in two forms:
//   public/duel-flow.html          one self-contained file: opened as a file it plays offline (the pack inlined)
//   public/index.html              what the gateway serves: the code only, plus web/src/loader.js, which fetches
//   public/pack/duel-pack.<hash>.json   the asset pack, named after its content so browsers may cache it for good
// The served files also get brotli (.br) and gzip (.gz) copies, which the gateway sends to browsers that take them.
//
// Inputs
//   web/src/*.js, shared/sim.js        this repository's code
//   data/duelcfg.json, data/fighters.json   the duel's configuration and roster (generated from the game's data tables)
//   node_modules/pixi.js, pixi-spine    the renderers (npm install)
//   <assets>/                           the asset pack, in the repository — see docs/ASSETS.md:
//     ui.json            the event's exported screens, templates, sprites, clips and UI Spine
//     models.json        per roster key: { spine: { skel, atlas, pages, pma, anims }, icon }
//     audio/*.ogg        the event's UI sounds (+ the default BGM, m_nobetnolife.ogg, if present)
//     fx/*               the textures listed in web/fx-map.json
//     fonts/             Bender and Novecento wide: not the game's and not in the repository (their authors' free-font
//                        terms); a local copy (.woff2 / .otf) is used, else they are fetched once (FONTS below) and kept
//                        here; without them the page falls back to system fonts
//
// usage: node tools/build-page.mjs [--assets assets] [--out public] [--check]
//   --check: only verify that every input exists and report what is missing (no output; exit 1 when incomplete)
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants as Z } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const A = resolve(ROOT, arg('--assets', process.env.DUEL_ASSETS || 'assets'));
const OUT = resolve(ROOT, arg('--out', 'public'));
const CHECK = process.argv.includes('--check');

const FX = JSON.parse(readFileSync(join(ROOT, 'web', 'fx-map.json'), 'utf8'));
delete FX._comment;
const need = [
  join(ROOT, 'node_modules', 'pixi.js', 'dist', 'pixi.min.js'), join(ROOT, 'node_modules', 'pixi-spine', 'dist', 'pixi-spine.js'),
  join(A, 'ui.json'), join(A, 'models.json'), join(A, 'audio'),
  ...Object.values(FX).map((f) => join(A, 'fx', f)),
];
const missing = need.filter((p) => !existsSync(p));
if (missing.length) {
  console.error(`asset pack incomplete (${A}): ${missing.length} missing\n  ` + missing.map((p) => p.replace(ROOT, '.')).join('\n  '));
  console.error('see docs/ASSETS.md');
  process.exit(1);
}
if (CHECK) { console.log('asset pack complete:', A); process.exit(0); }

// the display fonts, from the community font collection Stronghold Protocol also uses (raw GitHub, then jsDelivr)
const FONTS = [
  { key: '/*FONT_BENDER*/', name: 'bender-regular', remote: 'Bender/BENDER.OTF' },
  { key: '/*FONT_NOVECENTO*/', name: 'novecento-wide-normal', remote: 'Novecento-Wide-Normal-2.otf' },
];
const FONT_SOURCES = ['https://raw.githubusercontent.com/TimWangZi/The-font-of-Arknights/master/font/',
  'https://cdn.jsdelivr.net/gh/TimWangZi/The-font-of-Arknights@master/font/'];
async function fontSrc(f) {
  const css = (buf, ext) => `url(data:font/${ext};base64,${buf.toString('base64')}) format("${ext === 'otf' ? 'opentype' : ext}")`;
  for (const ext of ['woff2', 'otf']) { const p = join(A, 'fonts', `${f.name}.${ext}`); if (existsSync(p)) return css(readFileSync(p), ext); }
  for (const base of FONT_SOURCES) {
    try {
      const r = await fetch(base + f.remote, { signal: AbortSignal.timeout(20000) });
      const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      // an OpenType file: 'OTTO' (CFF) or 0x00010000 (TrueType outlines)
      if (!buf || !(buf.readUInt32BE(0) === 0x4f54544f || buf.readUInt32BE(0) === 0x00010000)) continue;
      mkdirSync(join(A, 'fonts'), { recursive: true });
      writeFileSync(join(A, 'fonts', `${f.name}.otf`), buf);
      console.log(`font ${f.name}: fetched from ${new URL(base).host}`);
      return css(buf, 'otf');
    } catch (e) { /* the next source */ }
  }
  console.warn(`font ${f.name}: not found locally and could not be fetched — the page uses fallback fonts`);
  return `local("${f.name}")`;
}

const rd = (p) => readFileSync(p, 'utf8');
const b64 = (p) => readFileSync(p).toString('base64');
const safe = (t) => t.replace(/<\/script/gi, '<\\/script');
// the roster: the committed stats + the local models
const lite = JSON.parse(rd(join(ROOT, 'data', 'fighters.json'))), models = JSON.parse(rd(join(A, 'models.json')));
const fighters = lite.filter((f) => models[f.key]).map((f) => ({ ...f, ...models[f.key] }));
if (fighters.length < lite.length) console.warn(`models for ${fighters.length} of ${lite.length} fighters; the others are left out`);
const audio = Object.fromEntries(readdirSync(join(A, 'audio')).filter((f) => f.endsWith('.ogg')).sort().map((f) => [f.slice(0, -4), b64(join(A, 'audio', f))]));
const fxtex = Object.fromEntries(Object.entries(FX).map(([k, f]) => [k, `data:image/${f.endsWith('.jpg') ? 'jpeg' : 'png'};base64,${b64(join(A, 'fx', f))}`]));
const ui = rd(join(A, 'ui.json'));
const code = {
  ...Object.fromEntries(await Promise.all(FONTS.map(async (f) => [f.key, await fontSrc(f)]))),
  '/*PIXI*/': safe(rd(join(ROOT, 'node_modules', 'pixi.js', 'dist', 'pixi.min.js'))),
  '/*PIXISPINE*/': safe(rd(join(ROOT, 'node_modules', 'pixi-spine', 'dist', 'pixi-spine.js'))),
  '/*DUELCFG*/': 'const DUELCFG = ' + safe(rd(join(ROOT, 'data', 'duelcfg.json'))) + ';',
  '/*ENGINE*/': safe(rd(join(ROOT, 'web', 'src', 'engine.js'))),
  '/*PARTICLES*/': safe(rd(join(ROOT, 'web', 'src', 'particles.js'))),
  '/*SIM*/': safe(rd(join(ROOT, 'shared', 'sim.js'))),
  '/*ARENA*/': safe(rd(join(ROOT, 'web', 'src', 'arena.js'))),
  '/*NET*/': safe(rd(join(ROOT, 'web', 'src', 'net.js'))),
  '/*EMOTE*/': safe(rd(join(ROOT, 'web', 'src', 'emote.js'))),
  '/*FLOW*/': safe(rd(join(ROOT, 'web', 'src', 'flow.js'))),
};
const page = (pack) => {
  let out = rd(join(ROOT, 'web', 'index.src.html'));
  for (const [k, v] of Object.entries({ ...code, '/*PACK*/': pack })) {
    const n = out.split(k).length - 1;
    if (n !== 1) throw new Error(`template: ${k} appears ${n} times`);
    out = out.replace(k, () => v);
  }
  return out;
};
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const rel = (p) => p.replace(ROOT, '.');
mkdirSync(join(OUT, 'pack'), { recursive: true });
// a served file and its compressed copies (brotli 9: within 1 % of 11, ten times faster)
const write = (p, text) => {
  const buf = Buffer.from(text);
  writeFileSync(p, buf);
  const br = brotliCompressSync(buf, { params: { [Z.BROTLI_PARAM_QUALITY]: 9, [Z.BROTLI_PARAM_SIZE_HINT]: buf.length } });
  writeFileSync(p + '.br', br); writeFileSync(p + '.gz', gzipSync(buf, { level: 9 }));
  return { raw: buf.length, br: br.length };
};

// the single file: the pack inlined, the game started at once
const single = page(safe(`const DUEL = ${ui};\nconst FIGHTERS = ${JSON.stringify(fighters)};\nconst AUDIO = ${JSON.stringify(audio)};\nconst FXTEX = ${JSON.stringify(fxtex)};\nduelMain();`));
writeFileSync(join(OUT, 'duel-flow.html'), single);
console.log(`${rel(join(OUT, 'duel-flow.html'))}  ${mb(single.length)}  (${fighters.length} fighters, ${Object.keys(audio).length} sounds, ${Object.keys(fxtex).length} textures)`);

// the served pair: the pack under its content hash (older packs removed), the page pointing at it
const packText = `{"v":1,"ui":${ui},"fighters":${JSON.stringify(fighters)},"audio":${JSON.stringify(audio)},"fx":${JSON.stringify(fxtex)}}`;
const name = `duel-pack.${createHash('sha256').update(packText).digest('hex').slice(0, 16)}.json`;
for (const f of readdirSync(join(OUT, 'pack'))) if (/^duel-pack\.[0-9a-f]{16}\.json(\.br|\.gz)?$/.test(f) && !f.startsWith(name)) rmSync(join(OUT, 'pack', f));
const pk = write(join(OUT, 'pack', name), packText);
const info = { url: 'pack/' + name, size: Buffer.byteLength(packText) };
const shell = write(join(OUT, 'index.html'), page(`const PACK_INFO = ${JSON.stringify(info)};\n` + safe(rd(join(ROOT, 'web', 'src', 'loader.js')))));
console.log(`${rel(join(OUT, 'index.html'))}  ${mb(shell.raw)} (brotli ${mb(shell.br)})  + pack/${name}  ${mb(pk.raw)} (brotli ${mb(pk.br)})`);
