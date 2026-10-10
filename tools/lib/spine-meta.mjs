// Spine model metadata for the data tools: a 3.8 binary skeleton's animations (names, lengths, the OnAttack hit times)
// and the roles the arena plays them in (idle, move, attack, skill, die, stun …), plus atlas normalisation.
//
// Adapted from Stronghold Protocol (github.com/sganggs/Stronghold-Protocol), tools/assets/skel.mjs and
// tools/assets/anim-roles.mjs, © its contributors, GPL-3.0-or-later; combined into this AGPL-3.0-or-later project as
// GNU GPL v3 section 13 permits. Changes: one module, ES module exports only, no atlas-region validation.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let runtime = null;
const loadRuntime = () => (runtime ||= require('@pixi-spine/runtime-3.8'));
const round3 = (x) => Math.round(Number(x) * 1000) / 1000;

/** A 3.8 binary skeleton's animation names, durations and OnAttack times. */
export function parseSkel(bytes) {
  const r = loadRuntime();
  const loader = {
    newRegionAttachment: (skin, name) => new r.RegionAttachment(name), newMeshAttachment: (skin, name) => new r.MeshAttachment(name),
    newBoundingBoxAttachment: (skin, name) => new r.BoundingBoxAttachment(name), newPathAttachment: (skin, name) => new r.PathAttachment(name),
    newPointAttachment: (skin, name) => new r.PointAttachment(name), newClippingAttachment: (skin, name) => new r.ClippingAttachment(name),
  };
  const data = new r.SkeletonBinary(loader).readSkeletonData(new Uint8Array(bytes));
  const durations = {}, hits = {};
  for (const a of data.animations) {
    durations[a.name] = round3(a.duration);
    for (const t of a.timelines) {
      if (!t || !Array.isArray(t.events)) continue;
      for (const e of t.events) if (/^onattack$/i.test(e?.data?.name || '')) (hits[a.name] ||= []).push(round3(e.time));
    }
    if (hits[a.name]) hits[a.name].sort((x, y) => x - y);
  }
  return { version: String(data.version ?? ''), animations: data.animations.map((a) => a.name), durations, hits };
}

// ---- animation roles (anim-roles.mjs) -----------------------------------------------------------------------------------
function makeFinder(names) {
  const exact = new Set(names);
  const lower = new Map();
  for (const n of names) {
    const k = n.toLowerCase();
    if (!lower.has(k)) lower.set(k, n);
  }
  return (name) => (name && exact.has(name) ? name : lower.get(String(name).toLowerCase()) ?? null);
}

function clip(begin, loop, end, via) {
  const c = { begin: begin ?? null, loop, end: end ?? null };
  if (via) c.via = via;
  return c;
}

const isDown = (n) => /down/i.test(n);
const isEdge = (n) => /_(begin|start|end)$/i.test(n);

/** First name (sorted) matching `re` and passing `ok`. */
function firstLike(names, re, ok = () => true) {
  return names.filter((n) => re.test(n) && ok(n)).sort()[0] ?? null;
}

/**
 * begin/loop/end triple for a prefix, e.g. prefix 'Move' → Move_Begin|Move_Start, Move_Loop (else the
 * plain 'Move'), Move_End. Begin-only models play the begin clip as the action.
 */
function triple(find, prefix) {
  const begin = find(`${prefix}_Begin`) ?? find(`${prefix}_Start`);
  const loop = find(`${prefix}_Loop`) ?? find(prefix);
  const end = find(`${prefix}_End`);
  if (loop) return clip(begin, loop, end);
  if (begin) return clip(null, begin, end);
  return null;
}

/**
 * Directional variants as virtual names: 'Skill_Right_Loop' → 'Skill_Loop', 'Skill_Loop_Up' → 'Skill_Loop'
 * (Right preferred over Up; `_Down` variants are never aliased). Used only as a last resort for skills
 * of models that have no undirected skill clips (char_279_excu, char_431_ashlok Back).
 */
function directionalAliases(names) {
  const have = new Set(names.map((n) => n.toLowerCase()));
  const alias = new Map();
  for (const dir of ['Right', 'Up']) {
    const re = new RegExp(`_${dir}(?=_|$)`, 'i');
    for (const n of names) {
      if (isDown(n) || !re.test(n)) continue;
      const k = n.replace(re, '');
      const lk = k.toLowerCase();
      if (!have.has(lk) && !alias.has(lk)) alias.set(lk, { virtual: k, real: n });
    }
  }
  const virtuals = [...alias.values()].map((a) => a.virtual);
  return {
    names: [...names, ...virtuals],
    real: (name) => (name == null ? null : alias.get(name.toLowerCase())?.real ?? name),
  };
}

/** Form tag of multi-form enemies, from the idle name: 'A_Idle' → A_x, 'Idle_grey' → x_grey. */
function formFinder(find, idle) {
  if (!idle || /^idle$/i.test(idle)) return () => null;
  let m = /^(.+)_idle$/i.exec(idle);
  if (m) { const pre = m[1]; return (base) => find(`${pre}_${base}`); }
  m = /^idle(_?)(.+)$/i.exec(idle);
  if (m) { const sep = m[1]; const suf = m[2]; return (base) => find(`${base}${sep}${suf}`); }
  return () => null;
}

function resolveIdle(names, find, durations) {
  // Among generic idle-like clips prefer an animated one: 'Idle_A' of enemy_9014_acstma is a 0 s pose.
  const idleLike = (animated) => firstLike(names, /(^|_)idle/i,
    (n) => !/skill|stun|down/i.test(n) && (!animated || !(Number(durations?.[n]) <= 0)));
  return find('Idle')
    ?? (durations ? idleLike(true) : null)
    ?? idleLike(false)
    ?? find('Default')
    ?? firstLike(names, /^default/i)
    ?? names[0] ?? null;
}

function resolveAttack(names, find, form, idle) {
  const a = find('Attack');
  if (a) return clip(null, a, null);
  const begin = find('Attack_Begin') ?? find('Attack_Start');
  const end = find('Attack_End');
  const loop = find('Attack_Loop');
  if (loop) return clip(begin, loop, end);
  const numbered = firstLike(names, /^attack/i, (n) => !isDown(n) && !isEdge(n));
  if (begin) {
    // Attack_Begin + Attack_A/B/C + Attack_End (char_1045_svash2): the numbered clips are the attacks.
    return numbered ? clip(begin, numbered, end, 'attackAny') : clip(null, begin, end);
  }
  const c = find('Combat');
  if (c) return clip(null, c, null, 'combat');
  const fa = form('Attack') ?? form('Combat');
  if (fa) return clip(null, fa, null, 'attackAny');
  const any = numbered
    ?? firstLike(names, /(^|_)attack/i, (n) => !isDown(n) && !isEdge(n) && !/skill/i.test(n));
  if (any) return clip(null, any, null, 'attackAny');
  const s = find('Skill_1_Loop') ?? find('Skill1_Loop') ?? find('Skill_Loop')
    ?? firstLike(names, /^skill.*attack/i, (n) => !isDown(n) && !isEdge(n))
    ?? firstLike(names, /^skill.*_loop$/i, (n) => !isDown(n));
  if (s) return clip(null, s, null, 'skill');
  return idle ? clip(null, idle, null, 'idle') : null;
}

function resolveAttackDown(names, find) {
  const a = find('Attack_Down');
  if (a) return clip(null, a, null);
  const t = triple(find, 'Attack_Down');
  if (t) return t;
  const c = find('Combat_Down');
  if (c) return clip(null, c, null, 'combat');
  const any = firstLike(names, /^attack.*down/i, (n) => !isEdge(n));
  if (any) return clip(null, any, null, 'attackAny');
  return null;
}

/** Skill clip for one prefix (Skill_2, Skill2, Skill_02, Skill), or null. */
function skillFamily(names, find, P, numbered) {
  const begin = find(`${P}_Begin`) ?? find(`${P}_Start`);
  const end = find(`${P}_End`);
  const idle = find(`${P}_Idle`);
  const attack = find(`${P}_Attack`)
    ?? firstLike(names, new RegExp(`^${P}_Attack`, 'i'), (n) => !isDown(n) && !isEdge(n));
  const single = find(P);
  // Numbered prefixes only: any other P_* variant (e.g. Skill_1_A). Never for plain 'Skill',
  // which would otherwise grab another skill's animations.
  const variant = numbered
    ? firstLike(names, new RegExp(`^${P}_`, 'i'), (n) => !isDown(n) && !isEdge(n) && !/_idle$/i.test(n))
    : null;
  const loop = find(`${P}_Loop`) ?? attack ?? single ?? variant ?? idle ?? begin;
  if (!loop) return null;
  return { ...clip(loop === begin ? null : begin, loop, loop === end ? null : end), idle: idle ?? null };
}

function resolveSkill(names, find, index, attack) {
  const n = index + 1;
  const pad = String(n).padStart(2, '0');
  const prefixes = [`Skill_${n}`, `Skill${n}`, `Skill_${pad}`, 'Skill'];
  for (const P of prefixes) {
    const c = skillFamily(names, find, P, P !== 'Skill');
    if (c) {
      const { idle, ...rest } = c;
      return { ...rest, index, idle };
    }
  }
  // Last resort: directional-only skill clips (Skill_Right_Loop, Skill_Loop_Up).
  const dir = directionalAliases(names);
  if (dir.names.length > names.length) {
    const findDir = makeFinder(dir.names);
    for (const P of prefixes) {
      const c = skillFamily(dir.names, findDir, P, P !== 'Skill');
      if (c) {
        return { begin: dir.real(c.begin), loop: dir.real(c.loop), end: dir.real(c.end), index, idle: dir.real(c.idle) };
      }
    }
  }
  if (attack) return { ...attack, via: 'attack', index, idle: null };
  return null;
}

function resolveMove(names, find, form) {
  const t = triple(find, 'Move');
  if (t) return t;
  const m = find('Move') ?? form('Move');
  if (m) return clip(null, m, null);
  const r = triple(find, 'Run');
  if (r) return r;
  const run = find('Run') ?? form('Run');
  if (run) return clip(null, run, null);
  const any = firstLike(names, /^move/i, (n) => !isEdge(n)) ?? firstLike(names, /(^|_)move/i, (n) => !isEdge(n));
  return any ? clip(null, any, null) : null;
}

/**
 * The model's own run cycle, when it has one (猎狗pro: Move_Loop 0.80 s next to Run_Loop 0.53 s): a role of its own, not
 * the move choice — the renderer walks a fast enemy on it (render/units.js `moveFast`; PR #275 by @xcdoge).
 */
function resolveRun(find, form) {
  const t = triple(find, 'Run');
  if (t) return t;
  const r = find('Run') ?? form('Run');
  return r ? clip(null, r, null) : null;
}

/**
 * The stun family is spelled two ways and sometimes numbered (PR #275 by @xcdoge): Stun / Stun_Begin / Stun_End
 * (吉兆飞鳞, 乌顶巨角卢鲁), Stun_1 / Stun_2 (巨大的丑东西: its first and its second form — render/units.js FORMS gives the
 * second form Stun_2), Dizzy_Begin / Dizzy_Loop / Dizzy_End (斩胄之剑 / 破胄之锤, stun-immune in this mode). Without a role
 * a stunned enemy freezes its current clip.
 */
function resolveStun(find) {
  const stun = find('Stun') ?? find('Stun_1') ?? find('Dizzy_Loop');
  const begin = find('Stun_Begin') ?? find('Dizzy_Begin');
  if (stun) return clip(begin, stun, find('Stun_End') ?? find('Dizzy_End'));
  if (begin) return clip(null, begin, null);
  return null;
}

function resolveDie(names, find, form) {
  return find('Die') ?? form('Die')
    ?? firstLike(names, /^die/i)
    ?? firstLike(names, /_die$/i, (n) => !/stun/i.test(n))
    ?? null;
}

/**
 * Resolve animation roles for one Spine model.
 *   after the caller's indices: an enemy's per-skill clips (a multi-skill boss such as 盐风主教昆图斯, Skill_01..04)
 */
export function resolveRoles(animationNames, opts = {}) {
  const names = Array.isArray(animationNames) ? animationNames.filter((n) => typeof n === 'string' && n.length) : [];
  const find = makeFinder(names);
  const durations = opts.durations && typeof opts.durations === 'object' ? opts.durations : null;
  const idle = resolveIdle(names, find, durations);
  const form = formFinder(find, idle);
  const deploy = find('Start') ?? form('Start') ?? idle;
  const attack = resolveAttack(names, find, form, idle);
  const attackDown = resolveAttackDown(names, find);
  const indices = [...new Set((opts.skillIndices?.length ? opts.skillIndices : [0])
    .filter((i) => Number.isInteger(i) && i >= 0 && i < 10))];
  if (!indices.length) indices.push(0);
  // an enemy's numbered skill clips (PR #275 by @xcdoge: its manifest only ever had index 0, so a multi-skill boss could
  // show one cast clip): appended after the caller's indices, whose first stays the primary `skill`
  if (opts.numberedSkills) {
    const found = new Set();
    for (const n of names) {
      const m = /^Skill_?0*(\d+)(?:$|_)/i.exec(n);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) found.add(Number(m[1]) - 1);
    }
    for (const i of [...found].sort((a, b) => a - b)) if (!indices.includes(i)) indices.push(i);
  }
  /** @type {Record<string, SkillClip>} */
  const skills = {};
  for (const i of indices) {
    const s = resolveSkill(names, find, i, attack);
    if (s) skills[String(i)] = s;
  }
  const roles = {
    idle,
    deploy,
    attack,
    attackDown,
    skill: skills[String(indices[0])] ?? null,
    die: resolveDie(names, find, form),
    move: resolveMove(names, find, form),
    stun: resolveStun(find),
  };
  const run = resolveRun(find, form);
  if (run) roles.run = run;
  if (indices.length > 1) roles.skills = skills;
  return roles;
}

/**
 * All animation names referenced by a Roles object (for validation).
 */

// ---- atlases ------------------------------------------------------------------------------------------------------------
// every page gets its real `size:` (some upstream atlases omit it) and `pma: true` (the enemy textures are premultiplied)
export function normaliseAtlas(text, pageSize) {
  const lines = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n'), out = [];
  let inPage = false, i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { out.push(line); inPage = false; i++; continue; }
    if (!inPage) {
      inPage = true;
      out.push(line);
      const fields = [];
      i++;
      while (i < lines.length && /^[^:]+:/.test(lines[i].trim()) && !/^\s/.test(lines[i]) && lines[i].trim()) { fields.push(lines[i]); i++; }
      const sz = pageSize(line.trim());
      const rest = fields.filter((f) => !/^(size|pma)\s*:/.test(f.trim()));
      if (sz) out.push(`size: ${sz.width},${sz.height}`);
      out.push(...rest, 'pma: true');
      continue;
    }
    out.push(line); i++;
  }
  return out.join('\n');
}
// a PNG's size, from its IHDR chunk
export const pngSize = (buf) => (buf && buf.length > 24 && buf.toString('latin1', 12, 16) === 'IHDR' ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null);
