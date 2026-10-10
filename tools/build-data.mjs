// Generates the duel's data from the game's own tables — the three 争锋频道 events played as one (青草城 act1enemyduel,
// 蜜果城 act2enemyduel, 绿藤城 act3enemyduel) — and the enemy models of the asset pack.
//
//   data/duelcfg.json            the configuration (activity_table → activity.ENEMY_DUEL.<act>), merged:
//     rounds        every event's rounds, each kept whole and marked with its event (`act`, its id `<roundId>@<act>`):
//                   a match draws each round from the three events' rounds of that number (sim.js roundTable)
//     roster/pools  every event's enemies; an enemy's weight in a pool is the highest of the three events'
//     npcs          the 28 viewers (the same in every event) with the latest event's ids; their pick tables merged
//     env           the level's rules (the multiplayer stage's runes) of all three, merged, and the safe zone
//                   (data/sources/env_025_act1enemyduel.json, the env every event uses)
//     the rest      modes, constants, texts, emoticon themes of the latest event (place names left out of the texts)
//   data/fighters.json           every duel enemy of the events: stats, duel score (numOfExtraDrops) and the extra cost of
//                                each further unit of the type (data/sources/prts-extra-cost.json, from PRTS), talents,
//                                skills (enemy_database, at the level the latest event's stage uses: 绿藤城 runs seven
//                                enemies at level 1), the original enemy's handbook abilities and damage type, the model's
//                                drawn scale and attack clip (hit frame); 协同 groups and death spawns
//   assets/models/<orig>.json    an original enemy's model: { icon, spine: { skel, atlas, pages, pma, anims } } (base64;
//                                every duel enemy is drawn as its original, originalEnemyId)
//
// Sources (downloaded once into .cache/sources/, tools/lib/fetch.mjs):
//   Kengxxiao/ArknightsGameData   zh_CN/gamedata: excel/activity_table.json, excel/enemy_handbook_table.json,
//                                 excel/display_meta_table.json, excel/range_table.json, levels/enemydata/enemy_database.json,
//                                 levels/activities/<act>/level_<stage>.json
//   isHarryh/Ark-Models           models_data.json and models_enemies/<key>/ (the enemies' Spine models)
//   yuanyan3060/ArknightsGameResource   enemy/<id>.png (portraits)
//
// usage: node tools/build-data.mjs [--gamedata <zh_CN/gamedata dir>]   (a local checkout instead of downloading the tables)
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPOS, getFile, getJson } from './lib/fetch.mjs';
import { parseSkel, resolveRoles, normaliseAtlas, pngSize } from './lib/spine-meta.mjs';
import { MODEL_SCALE_BY_PREFAB, MODEL_STRETCH_Y_BY_PREFAB, MIRRORED_PREFABS } from './lib/model-scales.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const LOCAL = arg('--gamedata');
const ACTS = ['act1enemyduel', 'act2enemyduel', 'act3enemyduel'];
const gd = async (path) => (LOCAL && existsSync(join(LOCAL, ...path.split('/'))) ? JSON.parse(readFileSync(join(LOCAL, ...path.split('/')), 'utf8')) : getJson(REPOS.gamedata, `zh_CN/gamedata/${path}`));
const val = (o) => (o && o.m_defined ? o.m_value : null);
const json = (...p) => JSON.parse(readFileSync(join(...p), 'utf8'));
const write = (p, o, pretty = true) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, (pretty ? JSON.stringify(o, null, 1) : JSON.stringify(o)) + (pretty ? '\n' : '')); };

console.log('game data …');
const [activity, handbook, meta, enemyDb, rangeTable] = await Promise.all([gd('excel/activity_table.json'), gd('excel/enemy_handbook_table.json'),
  gd('excel/display_meta_table.json'), gd('levels/enemydata/enemy_database.json'), gd('excel/range_table.json')]);
const dbAll = Object.fromEntries(enemyDb.enemies.map((x) => [x.Key, x.Value]));
// an enemy at a level: enemy_database keeps a level above 0 as overrides of level 0 — the fields it defines, its talents,
// skills and SP when it gives them
function enemyAt(key, lv) {
  const vs = dbAll[key], base = vs[0].enemyData, o = lv ? (vs.find((v) => v.level === lv) || vs[0]).enemyData : base;
  if (o === base) return base;
  const pick = (a, b) => (b && b.m_defined ? b : a);
  const out = { ...base, attributes: Object.fromEntries(Object.keys(base.attributes).map((k) => [k, pick(base.attributes[k], o.attributes[k])])) };
  for (const k of Object.keys(base)) if (o[k] && typeof o[k] === 'object' && 'm_defined' in o[k]) out[k] = pick(base[k], o[k]);
  for (const k of ['talentBlackboard', 'skills', 'spData']) if (o[k]) out[k] = o[k];
  return out;
}
const HB = handbook.enemyData, emo = meta.emoticonData;
const zone = json(ROOT, 'data', 'sources', 'env_025_act1enemyduel.json');

// ---- the events ---------------------------------------------------------------------------------------------------------
// the pools the rounds draw from (roundData enemyPoolLeft / Right) → the weight's short name
const POOLS = { poolNormal: 'normal', poolSmallEnemy: 'small', poolBoss: 'boss', poolMusic: 'music', poolNoSurpriseEnemy: 'nosurprise', poolGiantBoss: 'giant', poolAntiGiantBoss: 'antigiant' };
const bbOf = (r) => Object.fromEntries((r ? r.blackboard : []).map((b) => [b.key, b.valueStr ?? b.value]));
const events = [], allEnemies = new Map(), levelOf = {};
for (const id of ACTS) {
  const cfg = activity.activity.ENEMY_DUEL[id], act = activity.basicInfo[id];
  // the multiplayer modes' stage (its level carries the runes; the solo stage has the same ones)
  const stage = cfg.modeData.multiOperationMatch.stageIds[0];
  const level = await gd(`levels/activities/${id}/level_${stage}.json`);
  const runes = level.runes || [], rune = (key) => runes.find((r) => r.key === key);
  const mul = bbOf(rune('enemy_attribute_mul')), envr = bbOf(rune('env_system_new'));
  // the enemy levels the stage uses (a later event's win: 绿藤城's balance changes)
  for (const r of level.enemyDbRefs || []) if (r.useDb) levelOf[r.id] = r.level || 0;
  const verify = runes.filter((r) => r.key === 'env_gbuff_new_with_verify').map(bbOf);
  const listOf = (b) => String(b.enemy || '').split('|').filter(Boolean);
  const env = {
    atkMul: mul.atk, hpMul: mul.max_hp, moveMultiplier: level.options.moveMultiplier,
    ringHpRatio: envr.hp_ratio, ringAtk: envr.atk, ringAspd: envr.attack_speed, ringMove: envr.move_speed,
    zoneFirst: zone.firstSafeZoneInterval, zoneEvery: zone.interval, zoneCentre: zone.position, zones: zone.zones,
    statusResist: verify.filter((b) => b.key === 'enemy_status_resistance').flatMap(listOf),
    // the later events' level rules: the 惊喜 enemies' way onto the field (who; their drop-in's odds, env_system_new
    // enemy_duel_*; their entry buff), and the damage report (sim.js)
    surprise: verify.filter((b) => b.key === 'enemyduel_surprise_attacker_born').flatMap(listOf),
    surpriseRule: envr.enemy_duel_surprise_attacker_interval ? {
      interval: envr.enemy_duel_surprise_attacker_interval, delay: envr.enemy_duel_surprise_attacker_spawn_delay,
      baseProb: envr.enemy_duel_surprise_attacker_base_prob, hurtProb: envr.enemy_duel_surprise_attacker_prob_add_when_hurt,
      lossProb: envr.enemy_duel_surprise_attacker_prob_add_battle_loss_ratio, valueProb: envr.enemy_duel_surprise_attacker_prob_add_battle_value_ratio,
      teamRatio: envr.enemy_duel_team_count_ratio, lossRatio: envr.enemy_duel_battle_loss_ratio, valueRatio: envr.enemy_duel_battle_value_ratio,
    } : null,
    surpriseBorn: verify.filter((b) => b.key === 'enemyduel_surprise_attacker_born').map((b) => ({ moveSpeed: b.move_speed, attackSpeed: b.attack_speed, duration: b.duration }))[0] || null,
    globalBuffs: runes.filter((r) => r.key === 'env_gbuff_new').map((r) => bbOf(r).key),
    envKey: envr.key,
  };
  const pools = {};
  for (const [eid, p] of Object.entries(cfg.poolData)) pools[eid] = Object.fromEntries(Object.entries(POOLS).map(([k, s]) => [s, p[k] || 0]).filter(([, w]) => w > 0));
  for (const [eid, e] of Object.entries(cfg.enemyData)) if (dbAll[eid]) allEnemies.set(eid, e);
  events.push({ id, act, cfg, env, pools, roster: Object.keys(cfg.enemyData).filter((e) => dbAll[e]) });
  console.log(`  ${id} ${act.name}: ${Object.keys(cfg.enemyData).length} enemies, ${Object.keys(cfg.roundData).length} rounds`);
}
// ---- the three events as one ----------------------------------------------------------------------------------------------
const latest = events[events.length - 1], L = latest.cfg;
const city = /青草城|蜜果城|绿藤城/g;
const rounds = {};
for (const ev of events) for (const r of Object.values(ev.cfg.roundData)) { const key = `${r.roundId}@${ev.id}`; rounds[key] = { ...r, roundId: key, act: ev.id }; }
const pools = {};
for (const ev of events) for (const [eid, w] of Object.entries(ev.pools)) {
  const o = (pools[eid] ||= {});
  for (const [k, v] of Object.entries(w)) o[k] = Math.max(o[k] || 0, v);
}
// the viewers: the same 28 in every event (by their number); a pick table per viewer, the events' entries merged (a
// later event's score for an enemy wins)
const npcNo = (id) => id.replace(/^act\d+enemyduel_/, '');
const npcSelector = {};
for (const ev of events) for (const [nid, t] of Object.entries(ev.cfg.npcSelectorData)) {
  const id = `${latest.id}_${npcNo(nid)}`, scores = Object.fromEntries((npcSelector[id] ? npcSelector[id].data : []).map((d) => [d.enemyId, d.score]));
  for (const d of t.data) scores[d.enemyId] = d.score;
  npcSelector[id] = { npcId: id, data: Object.entries(scores).map(([enemyId, score]) => ({ enemyId, score })) };
}
const env = { ...events.reduce((o, e) => ({ ...o, ...Object.fromEntries(Object.entries(e.env).filter(([, v]) => v != null)) }), {}), statusResist: [...new Set(events.flatMap((e) => e.env.statusResist))], surprise: [...new Set(events.flatMap((e) => e.env.surprise))],
  globalBuffs: [...new Set(events.flatMap((e) => e.env.globalBuffs))] };
const consts = Object.fromEntries(Object.entries(L.constData).map(([k, v]) => [k, typeof v === 'string' ? v.replace(city, '') : v]));
const duelcfg = {
  act: { id: 'enemyduel', name: '争锋频道', events: events.map((e) => ({ id: e.id, name: e.act.name, start: e.act.startTime, end: e.act.endTime })) },
  modes: L.modeData, rounds, npcs: L.npcData, npcSelector,
  extraScore: L.extraScoreData, basicScores: L.basicScores, announce: L.announceData.map((x) => x.announceText),
  comments: L.commentData, tips: L.tipsData.map((t) => t.txt), consts, env,
  roster: [...allEnemies.keys()], pools,
  // the range shapes the duel enemies' skills name (range_table: x-1 the diamond of radius 2, x-4 the 3 × 3 square, x-5
  // the cross of five): [column, row] offsets from the centre tile
  ranges: Object.fromEntries(['x-1', 'x-4', 'x-5'].map((id) => [id, rangeTable[id].grids.map((g) => [g.col, g.row])])),
  // the emoji panel's themes (enabledEmoticonThemeIdList): each theme's pictures in their sortId order
  emoticons: L.enabledEmoticonThemeIdList.filter((t) => emo.emoticonThemeDataDict[t]).map((t) => ({ id: t, pics: emo.emoticonThemeDataDict[t].map((e) => emo.emojiDataDict[e]).sort((a, b) => a.sortId - b.sortId).map((e) => e.picId) })),
};
write(join(ROOT, 'data', 'duelcfg.json'), duelcfg);
console.log(`  merged: ${duelcfg.roster.length} enemies (${Object.values(pools).filter((w) => Object.keys(w).length).length} drawn), ${Object.keys(rounds).length} rounds, ${duelcfg.emoticons.length} emoji themes`);

// ---- the models ---------------------------------------------------------------------------------------------------------
console.log('models …');
const index = (await getJson(REPOS.models, 'models_data.json')).data;
const enemyDir = 'models_enemies';
// originals whose model Ark-Models indexes with no files (registered, never uploaded): drawn with the closest model it
// has — the same enemy's other version, or (灼热源石虫, as Stronghold Protocol does) the plain 源石虫
const MODEL_ALIAS = { enemy_1300_ymmir: 'enemy_1300_ymmir_2', enemy_1307_mhrhcr: 'enemy_1307_mhrhcr_2', enemy_7002_veingd: 'enemy_7002_veingd_2', enemy_1305_mhslim: 'enemy_1007_slime' };
const modelOf = (orig) => MODEL_ALIAS[orig] || orig;
const origs = [...new Set([...allEnemies.values()].map((e) => modelOf(e.originalEnemyId)))];
const looks = {}, modelDir = join(ROOT, 'assets', 'models');
mkdirSync(modelDir, { recursive: true });
const b64 = (buf) => buf.toString('base64');
const one = (v) => (Array.isArray(v) ? v : v ? [v] : []);
let done = 0;
const missing = [];
await Promise.all(origs.map(async (orig) => {
  const key = orig.replace(/^enemy_/, ''), entry = index[key];
  const al = entry && entry.assetList, base = `${enemyDir}/${key}/`;
  if (!al || !al['.skel'] || !al['.atlas'] || !al['.png']) { missing.push(orig); return; }
  const [skel, atlasBuf, ...pngs] = await Promise.all([getFile(REPOS.models, base + one(al['.skel'])[0]), getFile(REPOS.models, base + one(al['.atlas'])[0]),
    ...one(al['.png']).map((f) => getFile(REPOS.models, base + f))]);
  const pageNames = one(al['.png']);
  const sizes = Object.fromEntries(pageNames.map((n, i) => [n, pngSize(pngs[i])]));
  const atlas = normaliseAtlas(atlasBuf.toString('utf8'), (page) => sizes[page] || null);
  const info = parseSkel(skel);
  const anims = resolveRoles(info.animations, { durations: info.durations, skillIndices: [0], numberedSkills: true });
  // the portrait: its own, else its handbook entry's or its base form's
  let icon = null;
  for (const id of [orig, orig.replace(/_\d+$/, '')]) { icon = await getFile(REPOS.icons, `enemy/${id}.png`, { optional: true }); if (icon) break; }
  write(join(modelDir, `${orig}.json`), { icon: icon ? b64(icon) : null, spine: { skel: b64(skel), atlas, pages: Object.fromEntries(pageNames.map((n, i) => [n, b64(pngs[i])])), pma: true, anims } }, false);
  // the attack clip the arena plays and its first strike (OnAttack), for the sim's hit timing
  const a = anims.attack, dur = a && a.via !== 'idle' ? info.durations[a.loop] : null, hit = a && info.hits[a.loop] ? info.hits[a.loop][0] : null;
  looks[orig] = { attackAnim: dur > 0 ? { clip: a.loop, dur, hit: hit != null ? Math.min(dur, hit) : dur / 2 } : null };
  if (++done % 20 === 0) console.log(`  ${done}/${origs.length}`);
}));
if (missing.length) console.log(`  no model upstream (${missing.length}): ${missing.join(' ')}`);
// models no longer used
for (const f of readdirSync(modelDir)) if (f.endsWith('.json') && !origs.includes(f.slice(0, -5))) rmSync(join(modelDir, f));

// ---- the roster -----------------------------------------------------------------------------------------------------------
const DMG = { PHYSIC: 'phys', MAGIC: 'arts', HEAL: 'heal', NO_DAMAGE: 'none', TRUE: 'true' };
// the extra cost of each further unit of a type (PRTS; the tables carry the base only)
const EXTRA = json(ROOT, 'data', 'sources', 'prts-extra-cost.json').extraCost;
// 绿藤城's 协同 enemies (PRTS 争锋频道/选手信息/领袖, 关系=协同; the head is the tag_multi entry of the pools): a group
// enters as one type, costed by its head
const GROUPS = { enemy_15072_dqlbgg: ['enemy_15070_dqhlgy', 'enemy_15071_dqyrzf'], enemy_15073_dqkght: ['enemy_15074_dqdght'], enemy_15075_dqzklz: ['enemy_15076_dqzmst'] };
// what an enemy leaves when it falls: its own data (deathrattle.*), or, where the duel version leaves it to its original,
// PRTS's text — 匪帮欢乐船 “死亡0.8s后…召唤1个过气水手”, “交通亭”量产型 “死亡1s后…弹出1个速胜卫士”
const DEATH_SPAWN = { enemy_15083_dqymot: { key: 'enemy_15022_dqhvys', cnt: 1, delay: 0.8 }, enemy_15088_dqterm: { key: 'enemy_15086_dqcbld', cnt: 1, delay: 1 } };
const deathSpawnOf = (eid, T) => DEATH_SPAWN[eid] || (typeof T['deathrattle.enemy_key'] === 'string'
  ? { key: T['deathrattle.enemy_key'], cnt: T['deathrattle.cnt'] || 1, delay: T['deathrattle.delay'] || 0, spread: T['deathrattle.offset_bound'] || 0 } : null);
const abilitiesOf = (orig) => ((HB[orig] && HB[orig].abilityList) || []).map((a) => ({ text: a.text.replace(/<\$?[^>]*>/g, ''), title: a.textFormat === 'TITLE' }));
const roster = [];
for (const [eid, e] of allEnemies) {
  const d = enemyAt(eid, levelOf[eid] || 0), orig = e.originalEnemyId, hb = HB[orig] || HB[eid], model = modelOf(orig);
  if (!looks[model]) continue;
  const at = d.attributes, v = (k, dflt) => (at[k] && at[k].m_defined ? at[k].m_value : dflt);
  const hp = v('maxHp', 1000), atk = v('atk', 100), bat = v('baseAttackTime', 2), aspd = v('attackSpeed', 100);
  const dmgs = ((hb && hb.damageType) || []).map((x) => DMG[x] || 'phys');
  const talents = Object.fromEntries((d.talentBlackboard || []).map((t) => [t.key, t.valueStr ?? t.value]));
  roster.push({
    key: eid, orig, model, tag: e.tagType, name: val(d.name), desc: val(d.description), rank: val(d.levelType) || 'NORMAL', levelType: val(d.levelType) || 'NORMAL',
    way: val(d.applyWay) || 'MELEE', fly: val(d.motion) === 'FLY', dmg: dmgs.includes('arts') && !dmgs.includes('phys') ? 'arts' : dmgs[0] === 'arts' ? 'arts' : 'phys',
    hp, atk, def: v('def', 0), res: v('magicResistance', 0), bat, aspd, ms: v('moveSpeed', 1), range: val(d.rangeRadius) || 0.8,
    mass: v('massLevel', 0), regen: v('hpRecoveryPerSec', 0), score: val(d.numOfExtraDrops), scoreAdd: EXTRA[eid] ?? 0, level: levelOf[eid] || 0,
    tags: val(d.enemyTags) || [], group: GROUPS[eid] || null, deathSpawn: deathSpawnOf(eid, talents),
    talents,
    skills: (d.skills || []).map((s) => s.prefabKey),
    skillData: Object.fromEntries((d.skills || []).map((s) => [s.prefabKey, { sp: s.spCost, cd: s.cooldown, init: s.initCooldown, bb: Object.fromEntries((s.blackboard || []).map((b) => [b.key, b.valueStr ?? b.value])) }])),
    spData: d.spData ? { type: d.spData.spType, max: d.spData.maxSp, init: d.spData.initSp, inc: d.spData.increment } : null,
    immune: { stun: !!v('stunImmune', false), frozen: !!v('frozenImmune', false), silence: !!v('silenceImmune', false) },
    origName: hb ? hb.name : null, abilities: abilitiesOf(orig),
    scale: MODEL_SCALE_BY_PREFAB.get(model) ?? 1, scaleY: MODEL_STRETCH_Y_BY_PREFAB.get(model) ?? 1, mirrorX: MIRRORED_PREFABS.has(model), attackAnim: looks[model].attackAnim,
    power: Math.round(Math.sqrt(hp * 0.5 * (1 + v('def', 0) / 600) * (1 + v('magicResistance', 0) / 200) * atk * 1.5 / (bat * 100 / aspd))),
  });
}
roster.sort((x, y) => x.score - y.score || (x.key < y.key ? -1 : 1));
write(join(ROOT, 'data', 'fighters.json'), roster);
console.log(`data/duelcfg.json, data/fighters.json: ${roster.length} fighters; assets/models: ${Object.keys(looks).length} models`);
