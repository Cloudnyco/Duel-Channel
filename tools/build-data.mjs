// Generates the duel's data from the game's own tables, and (optionally) the asset pack's models.json.
//
//   data/duelcfg.json    the act1enemyduel configuration (activity_table → activity.ENEMY_DUEL.act1enemyduel: modes,
//                        rounds, NPC viewers and their pick tables, constants, texts) + the level's rules (runes of
//                        level_act1enemyduel_01a) + the safe zone (data/sources/env_025_act1enemyduel.json)
//   data/fighters.json   the roster: every duel enemy with a model (see below) — stats, duel score (numOfExtraDrops),
//                        pool weights, talents, skills from enemy_database; the original enemy's handbook abilities;
//                        model scale / animation roles / damage type from the model source
//   assets/models.json   per roster key: { spine: { skel, atlas, pages, pma, anims }, icon } (base64; never committed)
//
// Sources
//   --gamedata <dir>   zh_CN/gamedata of an ArknightsGameData checkout (github.com/Kengxxiao/ArknightsGameData):
//                      excel/activity_table.json, excel/enemy_handbook_table.json, levels/enemydata/enemy_database.json,
//                      levels/activities/act1enemyduel/level_act1enemyduel_01a.json
//   --models <dir>     a Stronghold Protocol checkout with its assets fetched (github.com/sganggs/Stronghold-Protocol,
//                      `npm run assets`): data/enemies.json, data/assets.json and public/assets/** hold the enemy
//                      Spine models and portraits this project reuses (each duel enemy is drawn as its original,
//                      originalEnemyId). Without it, data/fighters.json keeps the roster it has.
//
// usage: node tools/build-data.mjs --gamedata ../ArknightsGameData/zh_CN/gamedata [--models ../Stronghold-Protocol]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const G = arg('--gamedata'), M = arg('--models');
if (!G) { console.error('usage: node tools/build-data.mjs --gamedata <ArknightsGameData>/zh_CN/gamedata [--models <Stronghold-Protocol>]'); process.exit(2); }
const json = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const val = (o) => (o && o.m_defined ? o.m_value : null);

const activity = json(G, 'excel', 'activity_table.json');
const cfg = activity.activity.ENEMY_DUEL.act1enemyduel, act = activity.basicInfo.act1enemyduel;
const db = Object.fromEntries(json(G, 'levels', 'enemydata', 'enemy_database.json').enemies.map((x) => [x.Key, x.Value[0].enemyData]));
const HB = json(G, 'excel', 'enemy_handbook_table.json').enemyData;
const level = json(G, 'levels', 'activities', 'act1enemyduel', 'level_act1enemyduel_01a.json');
const zone = json(ROOT, 'data', 'sources', 'env_025_act1enemyduel.json');

// ---- the level's rules ------------------------------------------------------------------------------------------------
const rune = (key) => level.runes.find((r) => r.key === key);
const bbOf = (r) => Object.fromEntries((r ? r.blackboard : []).map((b) => [b.key, b.valueStr ?? b.value]));
const mul = bbOf(rune('enemy_attribute_mul')), envr = bbOf(rune('env_system_new'));
const resist = level.runes.filter((r) => r.key === 'env_gbuff_new_with_verify').map(bbOf).filter((b) => b.key === 'enemy_status_resistance').flatMap((b) => String(b.enemy).split('|'));
const env = {
  atkMul: mul.atk, hpMul: mul.max_hp, moveMultiplier: level.options.moveMultiplier,
  ringHpRatio: envr.hp_ratio, ringAtk: envr.atk, ringAspd: envr.attack_speed, ringMove: envr.move_speed,
  zoneFirst: zone.firstSafeZoneInterval, zoneEvery: zone.interval, zoneCentre: zone.position, zones: zone.zones, statusResist: resist,
};
const duelcfg = {
  act: { id: act.id, name: act.name, start: act.startTime, end: act.endTime },
  modes: cfg.modeData, rounds: cfg.roundData, npcs: cfg.npcData, npcSelector: cfg.npcSelectorData,
  extraScore: cfg.extraScoreData, basicScores: cfg.basicScores, announce: cfg.announceData.map((x) => x.announceText),
  comments: cfg.commentData, tips: cfg.tipsData.map((t) => t.txt), consts: cfg.constData, env,
};
writeFileSync(join(ROOT, 'data', 'duelcfg.json'), JSON.stringify(duelcfg, null, 1) + '\n');

// ---- the roster -------------------------------------------------------------------------------------------------------
const abilitiesOf = (orig) => ((HB[orig] && HB[orig].abilityList) || []).map((a) => ({ text: a.text.replace(/<\$?[^>]*>/g, ''), title: a.textFormat === 'TITLE' }));
let src = null;
if (M) {
  const E = json(M, 'data', 'enemies.json');
  src = { enemies: Array.isArray(E) ? E : (E.enemies || Object.values(E)), assets: json(M, 'data', 'assets.json').enemies, pub: join(M, 'public') };
}
const previous = existsSync(join(ROOT, 'data', 'fighters.json')) ? json(ROOT, 'data', 'fighters.json') : [];
const roster = [], models = {};
for (const e of Object.values(cfg.enemyData)) {
  const d = db[e.enemyId], orig = e.originalEnemyId;
  if (!d) continue;
  let look;
  if (src) {
    const a = src.assets[orig], o = src.enemies.find((x) => x.key === orig);
    if (!a || !a.spine || !o) continue;
    const files = [a.spine.skel, a.spine.atlas, ...a.spine.textures].map((f) => join(src.pub, f));
    if (!files.every(existsSync)) { console.log('skip (model files missing)', e.enemyId); continue; }
    look = { dmg: (o.stats && o.stats.dmgType) || 'phys', scale: o.modelScale || 1, scaleY: o.modelScaleY || 1, mirrorX: !!o.mirrorX, attackAnim: o.attackAnim || null };
    const b64 = (p) => readFileSync(join(src.pub, p)).toString('base64');
    models[e.enemyId] = {
      icon: a.icon && existsSync(join(src.pub, a.icon)) ? b64(a.icon) : null,
      spine: { skel: b64(a.spine.skel), atlas: readFileSync(join(src.pub, a.spine.atlas), 'utf8'), pages: Object.fromEntries(a.spine.textures.map((t) => [t.split('/').pop(), b64(t)])), pma: !!a.spine.pma, anims: a.spine.anims || {} },
    };
  } else {
    const p = previous.find((f) => f.key === e.enemyId);
    if (!p) continue;
    look = { dmg: p.dmg, scale: p.scale, scaleY: p.scaleY, mirrorX: p.mirrorX, attackAnim: p.attackAnim };
  }
  const at = d.attributes, v = (k, dflt) => (at[k] && at[k].m_defined ? at[k].m_value : dflt);
  const pool = cfg.poolData[e.enemyId] || {};
  const hp = v('maxHp', 1000), atk = v('atk', 100), bat = v('baseAttackTime', 2), aspd = v('attackSpeed', 100);
  roster.push({
    key: e.enemyId, orig, name: val(d.name), desc: val(d.description), rank: val(d.levelType) || 'NORMAL', levelType: val(d.levelType) || 'NORMAL',
    way: val(d.applyWay) || 'MELEE', fly: val(d.motion) === 'FLY', dmg: look.dmg,
    hp, atk, def: v('def', 0), res: v('magicResistance', 0), bat, aspd, ms: v('moveSpeed', 1), range: val(d.rangeRadius) || 0.8,
    mass: v('massLevel', 0), score: val(d.numOfExtraDrops), pool: { normal: pool.poolNormal || 0, small: pool.poolSmallEnemy || 0, boss: pool.poolBoss || 0 },
    talents: Object.fromEntries((d.talentBlackboard || []).map((t) => [t.key, t.value])),
    skills: (d.skills || []).map((s) => s.prefabKey),
    skillData: Object.fromEntries((d.skills || []).map((s) => [s.prefabKey, { sp: s.spCost, cd: s.cooldown, init: s.initCooldown, bb: Object.fromEntries((s.blackboard || []).map((b) => [b.key, b.value])) }])),
    immune: { stun: !!v('stunImmune', false), frozen: !!v('frozenImmune', false) },
    origName: HB[orig] ? HB[orig].name : null, abilities: abilitiesOf(orig),
    scale: look.scale, scaleY: look.scaleY, mirrorX: look.mirrorX, attackAnim: look.attackAnim,
    power: Math.round(Math.sqrt(hp * 0.5 * (1 + v('def', 0) / 600) * (1 + v('magicResistance', 0) / 200) * atk * 1.5 / (bat * 100 / aspd))),
  });
}
roster.sort((x, y) => x.score - y.score);
writeFileSync(join(ROOT, 'data', 'fighters.json'), JSON.stringify(roster, null, 1) + '\n');
if (src) {
  mkdirSync(join(ROOT, 'assets'), { recursive: true });
  writeFileSync(join(ROOT, 'assets', 'models.json'), JSON.stringify(models));
}
console.log(`data/duelcfg.json, data/fighters.json: ${roster.length} fighters (pool normal ${roster.filter((f) => f.pool.normal > 0).length}, boss ${roster.filter((f) => f.pool.boss > 0).length})` + (src ? `; assets/models.json: ${Object.keys(models).length} models` : ''));
