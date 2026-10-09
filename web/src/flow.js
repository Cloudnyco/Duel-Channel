// ---- the flow: login → browser → mode → matching (NPC fill) / room → STARTING SOON → loading → 10 rounds → settlement ----
// Rules and texts come from the official activity config (activity_table ENEMY_DUEL act1enemyduel → DUELCFG): the modes,
// each round's stake / enemy score / types per side / whether 全力支持 is open, the 28 NPC viewers and their pick
// strategies, select time 20 s (the last 7 s red), scoreboard 8 s (solo 3 s), win streaks shown from 3, 10000 starting
// gifts, reward multipliers 1 (支持) / 2 (全力支持), the settlement comments and 争锋大礼花 rewards. A right guess (a draw
// counts for both sides) wins stake × multiplier, a wrong one loses the stake (全力支持: everything); 0 gifts is out.
// 全力支持 also opens when the gifts no longer cover the stake (PRTS). 观众保护 belongs to 竞猜对决 only.
const C = DCFG.consts;
const ROUNDS = C.modeOperationRoundNumber || 10;
const pad2 = (n) => String(n).padStart(2, '0');
const mmss = (s) => `${pad2(Math.floor(s / 60))}:${pad2(Math.floor(s % 60))}`;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const fmtW = (n) => (n >= 100000 ? (n / 10000).toFixed(n % 10000 ? 1 : 0) + '万' : String(Math.round(n)));
const sgn = (n) => (n > 0 ? '+' : n < 0 ? '-' : '+') + Math.abs(Math.round(n));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function modeOf(id) {
  const m = DCFG.modes[id];
  return { id, key: id === 'soloOperation' ? 'solo' : m.modeType === 'STAND' ? 'stand' : 'gift', name: m.modeShortName, en: m.modeEnName,
    multi: m.isMultiPlayer, room: m.isRoom, n: m.maxPlayer, channel: m.modeAvatarName, subs: m.modeAvatarText, desc1: m.modeTarget,
    desc2: m.modeDesc, record: m.modeRecordDesc, bonus: id === 'multiOperationMatch', type: m.modeType,
    locked: m.modeType === 'STAND' ? '本演示未实现竞猜对决' : null };
}
const byOrder = (a, b) => a.innerSortId - b.innerSortId;
const MODES_MATCH = Object.values(DCFG.modes).filter((m) => !m.isRoom).sort(byOrder).map((m) => modeOf(m.modeId));
const MODES_ROOM = Object.values(DCFG.modes).filter((m) => m.isRoom).sort(byOrder).map((m) => modeOf(m.modeId));
const MODES = [...MODES_MATCH, ...MODES_ROOM];
const roundsOf = (mode) => Object.values(DCFG.rounds).filter((r) => r.modeId === mode.id).sort((a, b) => a.round - b.round);
const isSolo = () => G.mode.id === 'soloOperation';
let ME_NAME = '博士', ME_TAG = '#' + (1000 + Math.floor(Math.random() * 9000));
let players = [], me = null;
const G = { round: 0, mode: MODES_MATCH.find((m) => m.id === 'multiOperationMatch'), log: [], best: 0 };

function newPlayers() {
  const icons = shuffle(POOL.filter((f) => f.icon).map(iconUri));
  const mk = (name, tag, avatar, npc) => ({ name, tag, avatar, me: !npc, npc, pts: C.modeOperationInitialScore || 10000, out: false, outRound: 0,
    streak: 0, stats: { all: 0, normal: 0, skip: 0, forced: 0 }, choice: null, change: 0, played: 0 });
  me = mk(ME_NAME, ME_TAG, myAvatar.value() ? avatarUri(myAvatar.value()) : icons[0], null);
  // the NPC viewers, drawn by their weights (npcProb) from the official 28
  const pool = Object.values(DCFG.npcs), chosen = [];
  while (chosen.length < Math.min(7, pool.length)) chosen.push(pickWeighted(pool.filter((x) => !chosen.includes(x)), (x) => x.npcProb || 1, Math.random));
  players = [me, ...chosen.map((n, i) => mk(n.name, '#' + (1000 + Math.floor(Math.random() * 9000)), icons[(i + 1) % icons.length], n))];
}
const ranked = () => players.slice().sort((a, b) => (a.out !== b.out ? (a.out ? 1 : -1) : a.out ? b.outRound - a.outRound || b.pts - a.pts : b.pts - a.pts));
const rankOf = (p) => ranked().indexOf(p) + 1;

// ---- small helpers -------------------------------------------------------------------------------------------------
function toast(msg, sec = 2.2) {
  REPORT.note('toast', msg);
  const el = $('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toast.h); toast.h = setTimeout(() => el.classList.remove('on'), sec * 1000);
}
function phase(txt) { $('phase').textContent = txt; REPORT.note('phase', txt); }
const spinners = [];
function spin(s, degPerSec) { if (s) spinners.push({ s, v: degPerSec }); }
function tickSpinners(dt) { for (const x of spinners) if (!x.s.scr.dead) x.s.rt.rotz += x.v * dt; for (let i = spinners.length - 1; i >= 0; i--) if (spinners[i].s.scr.dead) spinners.splice(i, 1); }
// a plain DOM picture inside a node (an avatar container the game fills with a prefab not in the package)
function injectImg(s, uri, cls = 'inj') {
  if (!s) return null;
  let d = s.el.querySelector(':scope > .' + cls);
  if (!d) { d = document.createElement('div'); d.className = cls; s.el.appendChild(d); }
  d.style.backgroundImage = uri ? `url(${uri})` : 'none';
  return d;
}
// rows stacked from the top of a container without a layout group
function stack(items, h, gap = 4, ax = 0.5) {
  items.forEach((s, i) => { s.rt.amin = [ax, 1]; s.rt.amax = [ax, 1]; s.rt.pivot = [ax, 1]; s.rt.pos = [0, -i * (h + gap)]; });
}
// a ScrollRect: wheel / drag moves the content (y up: a larger y shows rows further down)
function scrollable(viewport, content, total) {
  const el = viewport.el, lim = (y) => clamp(y, 0, Math.max(0, total - (viewport.h || 0)));
  el.classList.add('hot'); el.style.cursor = 'grab';
  el.addEventListener('wheel', (e) => { e.preventDefault(); content.rt.pos[1] = lim(content.rt.pos[1] + e.deltaY * 0.5); }, { passive: false });
  let drag = null;
  el.onpointerdown = (e) => { drag = { y: e.clientY, p: content.rt.pos[1] }; el.setPointerCapture(e.pointerId); };
  el.onpointermove = (e) => { if (drag) content.rt.pos[1] = lim(drag.p + (drag.y - e.clientY) / stageK); };
  el.onpointerup = el.onpointercancel = () => { drag = null; };
  return (y) => { content.rt.pos[1] = lim(y); };
}
async function fadeOut(scr, sec = 0.25) {
  const r = scr.root, a0 = r.alpha;
  for (let t = 0; t < sec; t += 1 / 60) { r.alpha = a0 * (1 - t / sec); await wait(1 / 60); }
  scr.close();
}
// a full-stage cut between screens, in the event's own transition language: its banners change through a block
// dissolve (Torappu/UI/DisturbDissolve: a left-to-right ramp, img_uifx_basicmask_04, broken up by the blocky noise
// img_dissolve_01). Here the whole stage goes: square blocks pop in along a slanted front — duel yellow at the front,
// ink behind it — the channel's ident holds a beat over the ink while `fn` swaps the screen, then the blocks drop away
// the same way, yellow at the trailing front, onto the new screen.
const WIPE = { cell: 40, cols: 32, rows: 18, thr: null, ink: '#161616', yellow: '#f6e033' };
function wipeThresholds() {
  if (WIPE.thr) return WIPE.thr;
  const { cols, rows } = WIPE, thr = new Float32Array(cols * rows);
  let noise = null;
  try {
    const im = wipeImg, c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, 64, 64); noise = x.getImageData(0, 0, 64, 64).data;
  } catch (e) { /* no texture: a seeded noise */ }
  const rnd = mulberry32(7741);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    // the texture tiled about 4.4 × 4 over the stage like the material's (_DissolveTex scale 4.36, 4)
    const nx = Math.floor((c / cols * 4.36 % 1) * 64), ny = Math.floor((r / rows * 4 % 1) * 64);
    const n = noise ? (noise[(ny * 64 + nx) * 4] / 255 - 0.33) / 0.62 : rnd();
    const ramp = c / (cols - 1) * 0.86 + (1 - r / (rows - 1)) * 0.14;
    thr[r * cols + c] = ramp * 0.72 + clamp(n, 0, 1) * 0.22 + rnd() * 0.06;
  }
  return (WIPE.thr = thr);
}
let wipeImg = null;
function wipeDraw(x, p, out, label, hold) {
  const { cell, cols, rows } = WIPE, thr = wipeThresholds(), W = 1280, H = 720, span = 0.24, front = 0.1;
  x.clearRect(0, 0, W, H);
  const k = p * (1 + span + front);                       // at p = 1 every block is past its front
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = (k - thr[r * cols + c]) / span;           // 0 → 1 as the front passes the block
    let cov = clamp(u, 0, 1), yellow = u > 0 && u < 1 + front / span;
    if (out) { cov = 1 - cov; yellow = cov > 0 && u > -front / span && u < 1; }
    if (cov <= 0) continue;
    const s = cell * (cov < 1 ? 0.25 + 0.75 * (1 - (1 - cov) ** 2) : 1) + 0.6, cx = c * cell + cell / 2, cy = r * cell + cell / 2;
    x.fillStyle = yellow && cov < 1 ? WIPE.yellow : yellow ? '#e3cc2c' : WIPE.ink;
    x.fillRect(cx - s / 2, cy - s / 2, s, s);
  }
  // the ident over the ink: the ›|‹ mark, the wordmark, the screen being cut to
  if (hold > 0) {
    x.save(); x.globalAlpha = clamp(hold, 0, 1);
    const cx = W / 2, cy = H / 2 - 18;
    x.fillStyle = WIPE.yellow;
    x.beginPath(); x.arc(cx, cy - 74, 30, 0, Math.PI * 2); x.fill();
    x.strokeStyle = WIPE.ink; x.lineWidth = 4.5; x.lineJoin = 'miter';
    x.beginPath(); x.moveTo(cx - 19, cy - 88); x.lineTo(cx - 6, cy - 74); x.lineTo(cx - 19, cy - 60); x.stroke();
    x.beginPath(); x.moveTo(cx + 19, cy - 88); x.lineTo(cx + 6, cy - 74); x.lineTo(cx + 19, cy - 60); x.stroke();
    x.lineWidth = 3.5; x.beginPath(); x.moveTo(cx, cy - 96); x.lineTo(cx, cy - 52); x.stroke();
    x.font = '700 64px Novecento, Bahnschrift, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('DUEL CHANNEL', cx, cy + 6);
    x.fillRect(cx - 150, cy + 50, 300, 3);
    if (label) { x.fillStyle = '#f2f0e4'; x.font = '700 24px "Noto Sans SC", "Microsoft YaHei", sans-serif'; x.fillText(label, cx, cy + 86); }
    x.restore();
  }
}
async function wipe(fn, label = '') {
  const cv = $('wipe'), x = cv.getContext('2d');
  if (!wipeImg && FXTEX.dissolve) { wipeImg = new Image(); wipeImg.src = FXTEX.dissolve; await wipeImg.decode().catch(() => {}); }
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  cv.style.display = 'block';
  const run = (sec, f) => new Promise((res) => { const t0 = performance.now(); const step = (now) => { const u = Math.min(1, (now - t0) / 1000 / sec); f(u); if (u < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
  if (reduce) { await run(0.18, (u) => { x.fillStyle = WIPE.ink; x.globalAlpha = u; x.clearRect(0, 0, 1280, 720); x.fillRect(0, 0, 1280, 720); x.globalAlpha = 1; }); }
  else await run(0.46, (u) => wipeDraw(x, ease(u), false, label, 0));
  sfx('g_ui_tabswitch');
  const holdStart = performance.now();
  let holding = true;
  const holdLoop = () => { if (!holding) return; wipeDraw(x, 1, false, label, (performance.now() - holdStart) / 140); requestAnimationFrame(holdLoop); };
  if (!reduce) requestAnimationFrame(holdLoop);
  await fn();
  await wait(Math.max(0.05, 0.34 - (performance.now() - holdStart) / 1000));
  holding = false;
  if (reduce) await run(0.18, (u) => { x.clearRect(0, 0, 1280, 720); x.globalAlpha = 1 - u; x.fillStyle = WIPE.ink; x.fillRect(0, 0, 1280, 720); x.globalAlpha = 1; });
  else await run(0.46, (u) => wipeDraw(x, ease(u), true, label, 1 - u * 4));
  x.clearRect(0, 0, 1280, 720);
  cv.style.display = 'none';
}
function whenTapped(scr, map) {
  return new Promise((res) => { for (const [suf, val] of Object.entries(map)) scr.tap(suf, () => res(typeof val === 'function' ? val() : val)); });
}

// stand-in art for pictures the game loads at run time: the mode's banner, card cover and settlement backdrop —
// a dark two-tone ground, broadcast stripes, a fan of the pool's enemy portraits and the mode's English name
const ART = {};
const loadImg = (uri) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = uri; });
async function buildArt() {
  const pal = { stand: ['#4a1416', '#123a66'], gift: ['#5a3c06', '#6a2208'], solo: ['#0f3a2c', '#14283c'] };
  const picks = { stand: ['enemy_5032_dqmon', 'enemy_5034_dqield', 'enemy_15007_dqbear', 'enemy_5039_dqgint'],
    gift: ['enemy_15012_dqbsli', 'enemy_5036_dqger_2', 'enemy_5053_dqllme', 'enemy_5055_dqkill', 'enemy_15011_dqnhst'], solo: ['enemy_15013_dqsnsl', 'enemy_15022_dqhvys', 'enemy_15012_dqbsli'] };
  for (const m of MODES.filter((x, i, a) => a.findIndex((y) => y.key === x.key) === i)) {
    const ims = (await Promise.all(picks[m.key].map((k) => byKey(k)).filter(Boolean).map((f) => loadImg(iconUri(f))))).filter(Boolean);
    const draw = (w, h, dim) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'), [a, b] = pal[m.key];
      const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, a); g.addColorStop(1, b);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = Math.max(2, h / 40);
      for (let i = -h; i < w; i += h / 6) { x.beginPath(); x.moveTo(i, h); x.lineTo(i + h, 0); x.stroke(); }
      const sz = h * 0.62, n = ims.length, span = Math.min(w * 0.62, n * sz * 0.72);
      ims.forEach((im, i) => {
        const cx = w * 0.62 - span / 2 + (n > 1 ? i * span / (n - 1) : span / 2), cy = h * 0.5 + (i % 2 ? h * 0.06 : -h * 0.04);
        x.save(); x.translate(cx, cy); x.rotate((i - (n - 1) / 2) * 0.06);
        x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(-sz / 2 + 6, -sz / 2 + 8, sz, sz);
        x.drawImage(im, -sz / 2, -sz / 2, sz, sz);
        x.strokeStyle = i % 2 ? '#2f86e8' : '#e8473d'; x.lineWidth = Math.max(2, sz / 30); x.strokeRect(-sz / 2, -sz / 2, sz, sz);
        x.restore();
      });
      x.fillStyle = 'rgba(255,255,255,.16)'; x.font = `700 ${Math.round(h * 0.2)}px Novecento, Bahnschrift, sans-serif`;
      x.textBaseline = 'bottom'; x.fillText(m.en, h * 0.08, h * 0.97);
      if (dim) { x.fillStyle = `rgba(0,0,0,${dim})`; x.fillRect(0, 0, w, h); }
      return c.toDataURL('image/jpeg', 0.86);
    };
    ART[m.key] = { banner: draw(1280, 420, 0.25), card: draw(660, 296, 0), bg: draw(1280, 720, 0.72) };
  }
}

// ---- 1 entry: login, then the browser ------------------------------------------------------------------------------
// The side bar (back / home / guide / medal) and the browser's daily + milestone column are systems this demo does not
// have, so they are left out and the page closes the gaps: the timeline runs the full width, the browser window sits
// centred on the desk, and its video widens into the column's place (the same height, a wider broadcast strip, its
// controls and the channel bar following the new edges).
function trimEntry(scr) {
  scr.show('panel_left_bar', false);
  scr.show('group_milestone_daily', false);
  scr.show('panel_browser_content/group_time', false);   // the event's end date: not a live event here
  scr.show('panel_fun_show', false);          // the fake cursor that clicks the side bar's browser icon
  const n = (p) => scr.one(p);
  const tl = n('panel_bg/group_timeline'); if (tl) { tl.rt.size[0] = 0; tl.rt.pos[0] = 0; }
  const br = n('entry_state/panel_browser');
  if (br) {
    // the window opens out of the side bar's icon (its own x keys in the open / close clips): remap them so it opens
    // from, and settles at, the centre of the desk (x' = A + B·x keeps the curves' shape)
    const end = br.rt.size[0], x1 = br.rt.pos[0], to1 = -(1280 + end) / 2;
    br.rt.pos[0] = to1;
    // the music player widget sat wholly behind the window's right part; keep it there (not half out from under it)
    const mp = n('entry_state/group_music_player');
    if (mp) mp.rt.pos[0] = (1280 + to1 + end) - 16 - mp.rt.size[0] / 2 - 1280;
    if (!trimEntry.done) {
      trimEntry.done = true;
      const op = D.clips.act1enemyduel_entry_browser_open, cx = op && op.curves.find((c) => c.path === '' && c.attr === 'm_AnchoredPosition.x');
      const cw = op && op.curves.find((c) => c.path === '' && c.attr === 'm_SizeDelta.x');
      if (cx && cw) {
        const x0 = cx.keys[0][1], w0 = cw.keys[0][1], to0 = 640 - w0 / 2 - 1280, B = (to1 - to0) / (x1 - x0), A = to1 - B * x1;
        for (const name of ['act1enemyduel_entry_browser_open', 'act1enemyduel_entry_browser_close']) {
          const c = D.clips[name] && D.clips[name].curves.find((k) => k.path === '' && k.attr === 'm_AnchoredPosition.x');
          if (c) c.keys = c.keys.map(([t, v, i, o]) => [t, A + B * v, Math.abs(i) >= 1e29 ? i : B * i, Math.abs(o) >= 1e29 ? o : B * o]);
        }
      }
    }
  }
  const vid = n('panel_browser_content/group_video'), col = n('panel_browser_content/group_milestone_daily');
  if (!vid || !col) return;
  const left = vid.rt.pos[0] - vid.rt.size[0] / 2, right = col.rt.pos[0] + col.rt.size[0] / 2, W = right - left, dx = (W - vid.rt.size[0]) / 2;
  vid.rt.pos[0] = (left + right) / 2;
  for (const k of ['video_holder', 'img_act_end']) { const x = n(`group_video/${k}`); if (x) x.rt.size[0] = W; }
  const tlv = n('group_lower_dec/viedo_timeline'); if (tlv) tlv.rt.size[0] += 2 * dx;
  for (const k of ['group_lower_dec/pause', 'group_lower_dec/streaming', 'group_video/video_tuber']) { const x = n(k); if (x) x.rt.pos[0] -= dx; }
}
async function stEntry(ctx) {
  phase('入口 · 登录');
  const scr = new Screen('enemy_duel_entry_page', { z: 5 });
  scr.text('name_layout/text_name', me.name);
  scr.image('group_avatar/avatar_loader', me.avatar, null, 'cover');
  scr.text('group_top_bar/text_tab_name', C.entryTabText || '争锋频道');
  scr.text('btn_medal/text_medal_progress', '<color=#f9e828>1</color>/2');
  playLoops(scr);
  sfx('g_ui_dqinterfaceload');
  startBgm();
  scr.text('panel_name/text_music_name', SND.track || '（声音未开启）');
  ctx.entryScr = scr;
  let playerOpen = true;
  const togglePlayer = () => { playerOpen = !playerOpen; scr.play('group_music_player', playerOpen ? 'act1enemyduel_entry_music_open' : 'act1enemyduel_entry_music_close'); };
  scr.tap('group_music_player/hide_hotspot', togglePlayer);
  trimEntry(scr);
  const video = new MiniShow(scr.one('video_holder'));
  ctx.video = video;
  if (!ctx.loggedIn) {
    scr.show('panel_entry_anim', true);
    await scr.play('entry_state', 'act1enemyduel_entry_stage_entry');
    scr.show('panel_entry_anim', false);
    ctx.loggedIn = true;
  } else scr.show('panel_entry_anim', false);
  phase('入口 · 浏览器（点“加入赛事”或“创建群组”）');
  scr.play('panel_browser', 'act1enemyduel_entry_browser_open');
  const later = (what) => () => toast(`${what}：本演示未实现`);
  if (!NET.on) scr.tap('btn_search/hotspot', later('加入群组（联机模式下可用）'));
  if (NET.match) { NET.match.close(); NET.match = null; }
  G.online = false;
  let r;
  for (;;) {
    r = await whenTapped(scr, { 'btn_join/hotspot': 'join', 'btn_create/hotspot': 'create', ...(NET.on ? { 'btn_search/hotspot': 'search' } : {}) });
    if (r !== 'search') break;
    const code = await searchDialog();
    if (code) { ctx.joinCode = code; G.mode = MODES_ROOM.find((m) => m.type === 'OPERATION') || G.mode; break; }
  }
  if (r === 'search') {
    await scr.play('panel_browser', 'act1enemyduel_entry_browser_close');
    ctx.entry = 'create';
    video.destroy(); scr.close(); ctx.entryScr = null;
    return 'room';
  }
  await scr.play('panel_browser', 'act1enemyduel_entry_browser_close');
  ctx.entry = r;
  ctx.pending = () => { video.destroy(); scr.close(); ctx.entryScr = null; };
  return 'prepare';
}

// ---- 2 mode select -------------------------------------------------------------------------------------------------
function fillCard(scr, c, m) {
  scr.show('panel_entry', false, c); scr.show('panel_empty', false, c); scr.show('panel_card', true, c);
  scr.show('tag_bonus', !!m.bonus, c);
  scr.show('root_bottom/icon_double', m.multi, c); scr.show('root_bottom/icon_single', !m.multi, c);
  scr.show('root_bottom/text', m.multi, c); scr.show('root_bottom/text_single', !m.multi, c);
  scr.text('root_bottom/text', String(m.n), c); scr.text('root_bottom/text_single', String(m.n), c);
  scr.text('ver_layout/name', m.name, c); scr.text('ver_layout/en_name', m.en, c);
  const rec = m.record && G.best > 0 && m.key !== 'stand';
  scr.show('record_toggle/root_max', rec, c); scr.show('record_toggle/text_norecord', !rec, c);
  scr.text('root_max/text_num', String(G.best), c); if (m.record) scr.text('root_max/text_desc', m.record, c);
  scr.show('group_lock', !!m.locked, c); scr.text('group_lock/root_title/text', m.locked || '', c);
  if (ART[m.key]) scr.image('root_mask/map', ART[m.key].card, c, 'cover');
  for (const g of ['name_layout_select', 'name_layout_unselect']) { scr.text(g + '/name', m.channel, c); scr.text(g + '/desc', m.subs, c); }
  setSel(scr, c, false, true);
}
function setSel(scr, c, on, instant) {
  scr.show('bg_select', true, c);
  if (instant) { play(c, 'switch_mode_card', { reverse: !on, rate: 100 }); return; }
  play(c, 'switch_mode_card', { reverse: !on });
}
async function stPrepare(ctx) {
  const create = ctx.entry === 'create';
  phase(create ? '创建群组 · 选择模式' : '选择赛事');
  let scr;
  await wipe(async () => { if (ctx.pending) { ctx.pending(); ctx.pending = null; } scr = new Screen('enemy_duel_prepare_page', { z: 6 }); }, '选择赛事');
  ctx.prep = scr;
  scr.show('group_default_title/root_match', !create); scr.show('group_default_title/root_create', create);
  scr.show('group_default_title', true); scr.show('group_default_bg', true); scr.show('group_mode', false);
  scr.show('panel_mode/group_matching', false);
  scr.show('button_match/root_mode_choose', true); scr.show('button_match/root_mode_start', false); scr.show('button_match/root_mode_cancel', false);
  scr.show('root_top/left_live', true); scr.show('root_top/left_forum', false);
  scr.play('view', 'in_mode');
  playLoops(scr);
  const content = scr.one('panel_main/viewport/content');
  const LIST = create ? MODES_ROOM : MODES_MATCH;
  const cards = LIST.map((m, i) => {
    const c = instantiate(scr, content, 'mode_card');
    fillCard(scr, c, m);
    play(c, 'in_mode_card', { delay: 0.1 + i * 0.08 });
    return c;
  });
  let sel = -1;
  const choose = (i) => {
    const m = LIST[i];
    if (m.locked) { toast(m.locked); return; }
    if (sel === i) return;
    if (sel >= 0) setSel(scr, cards[sel], false);
    sel = i; setSel(scr, cards[i], true);
    G.mode = m;
    scr.show('group_default_title', false); scr.show('group_default_bg', false); scr.show('group_mode', true);
    scr.show('icon_join', !create); scr.show('icon_create', create);
    scr.show('icon_solo', !m.multi); scr.show('icon_multi', m.multi);
    scr.show('root_main/create_prefix', create); scr.text('root_main/text_title', m.name);
    scr.text('layout/player_num', String(m.n));
    scr.text('root_desc/text_desc1', m.desc1); scr.text('root_desc/text_desc2', m.desc2);
    scr.show('group_desc/root_bonus', !!m.bonus);
    if (ART[m.key]) scr.image('root_trans/banner', ART[m.key].banner, null, 'cover');
    scr.play('root_banner/root_trans', 'banner_in');
    scr.show('button_match/root_mode_choose', false); scr.show('button_match/root_mode_start', true);
    scr.show('text_start_match', m.multi); scr.show('text_start_solo', !m.multi);
    scr.play('button_match/root_mode_start', 'btn_certain_active');
    phase(`选择赛事 · ${m.name}（点右侧按钮开始）`);
  };
  cards.forEach((c, i) => scr.tap('hotspot', () => choose(i), c));
  scr.tap('root_mode_choose/button_start', () => toast('先在左侧选择一种模式'));
  const r = await whenTapped(scr, { 'root_top/button_back/hotspot': 'back', 'root_mode_start/button_start': 'start' });
  if (r === 'back') { scr.close(); ctx.prep = null; return 'entry'; }
  newPlayers();
  G.online = false;
  if (!G.mode.multi) { await scr.play('view', 'trans_choose_mode'); scr.close(); ctx.prep = null; return 'show'; }
  return create ? 'room' : 'match';
}

// ---- 3a matching: real-looking joins, then NPCs fill the room --------------------------------------------------------
async function stMatch(ctx) {
  phase('匹配中');
  if (!ctx.prep) { newPlayers(); ctx.prep = new Screen('enemy_duel_prepare_page', { z: 6 }); ctx.prep.show('group_default_title', false); ctx.prep.show('panel_mode/group_matching', false); }
  const prep = ctx.prep;
  prep.show('panel_mode/button_match', false); prep.show('panel_mode/bg_button', false);
  const scr = new Screen('enemy_duel_match_state', { z: 8 });
  scr.show('button_match/root_mode_cancel', true); scr.show('button_match/root_mode_succ', false);
  scr.show('text_toggle/text_wait', true); scr.show('text_toggle/text_connecting', false);
  scr.text('num_layout/text_num_max', String(players.length));
  // the two curved arrows close into a ring (in_matching), then the ring turns once a minute (mode_matching_loop)
  scr.play('group_matching', 'in_matching').then(() => { if (!scr.dead) scr.play('group_matching', 'mode_matching_loop', { loop: true }); });
  let cancelled = false;
  scr.tap('root_mode_cancel/button_start', () => { cancelled = true; });
  scr.tap('root_top/button_back/hotspot', () => { cancelled = true; });
  let n = 1, t = 0;
  const joins = [0.9, 1.7, 2.2, 3.6].map((x) => x + Math.random() * 0.8);
  scr.text('num_layout/text_num', '1');
  while (n < players.length && !cancelled) {
    await wait(0.1); t += 0.1;
    scr.text('root_count/text', `${Math.floor(t)}S`);
    if (joins.length && t >= joins[0]) { joins.shift(); n++; }
    if (t > 5.2) {
      scr.show('text_toggle/text_wait', false); scr.show('text_toggle/text_connecting', true);
      phase('匹配中 · 人数不足，NPC 补位');
      if (t > 6 && Math.round(t * 10) % 3 === 0) { n++; }
    }
    scr.text('num_layout/text_num', String(Math.min(n, players.length)));
  }
  if (cancelled) { sfx('cancel'); scr.close(); prep.close(); ctx.prep = null; return 'prepare'; }
  scr.show('button_match/root_mode_cancel', false); scr.show('button_match/root_mode_succ', true);
  phase('匹配成功');
  sfx('match');
  await wait(1.3);
  scr.close(); prep.close(); ctx.prep = null;
  return 'show';
}

// ---- 3b room (创建群组): NPC fill toggle, start -----------------------------------------------------------------------
async function stRoom(ctx) {
  phase('群组房间（勾选 NPC 补位后开始）');
  if (ctx.prep) { ctx.prep.close(); ctx.prep = null; }
  const scr = new Screen('enemy_duel_room_state', { z: 8 });
  scr.text('root_title/prefix', '创建'); scr.text('root_title/text_title', G.mode.name);
  scr.text('layout_num/text_num', String(players.length));
  scr.text('root_desc/text_desc1', G.mode.desc1); scr.text('root_desc/text_desc2', G.mode.desc2);
  scr.text('root_roomid/text_id', String(100000 + Math.floor(Math.random() * 899999)));
  watchPing(scr, 'delay_layout/text_delay', null, (t) => `当前延迟  ${t}`, '单机 · 无网络延迟');
  for (const s of scr.q('ping')) s.active = false;
  for (const s of scr.q('btnStartBattle')) s.active = false;
  let npc = false, t = 900;
  const members = [me];
  const content = scr.one('scroll_view/viewport/content');
  const redraw = () => {
    clearKids(content);
    const list = npc ? players : members;
    const cards = list.map((p, i) => {
      const c = instantiate(scr, content, 'room_player_card');
      scr.show('root_empty', false, c); scr.show('root_wait', false, c); scr.show('root_main', true, c);
      scr.show('text_toggle/text_wait', false, c); scr.show('text_toggle/text_name', true, c);
      scr.text('text_toggle/text_name', p.me ? p.name : `${p.name}  NPC`, c);
      scr.image('avatar_container/avatar_img', p.avatar, c);
      scr.show('state_host', p.me, c); scr.show('state_bg_player', p.me, c);
      // the card's option menu (名片 / 好友 / 移除) opens on a tap and closes on the next
      const opts = scr.one('group_options', c);
      opts.active = false;
      scr.show('group_options/group_host', false, c); scr.show('group_options/group_guest', true, c);
      let open = false;
      scr.tap('btn_check', () => {
        open = !open; opts.active = true;
        play(opts, open ? 'room_card_option_in' : 'room_card_option_out').then(() => { if (!open) opts.active = false; });
      }, c);
      for (const b of ['button_card/hotspot', 'button_friend/text_friend/hotspot', 'button_kick/hotspot']) scr.tap(`group_guest/${b}`, () => toast('名片 / 好友 / 移除：本演示未实现'), c);
      play(c, 'room_card_join', { delay: i * 0.04 });
      return c;
    });
    cards.forEach((c, i) => { c.rt.amin = [0, 1]; c.rt.amax = [0, 1]; c.rt.pivot = [0, 1]; c.rt.pos = [(i % 4) * (c.rt.size[0] + 10), -Math.floor(i / 4) * (c.rt.size[1] + 10)]; });
    scr.text('root_text/text_num1', String(list.length)); scr.text('root_text/text_num2', String(players.length));
    scr.show('button_room_host/root_host_lack', !npc); scr.show('button_room_host/root_host_start', npc); scr.show('button_room_host/root_back', false);
    scr.text('root_host_lack/text_start', `至少再邀请\n${players.length - 1}名玩家`);
    scr.show('button_npc/root_normal', !npc); scr.show('button_npc/root_select', npc);
  };
  scr.show('button_room_guest', false);
  redraw();
  playLoops(scr);
  scr.play('duel_room', 'in_room');
  scr.tap('button_npc', () => { npc = !npc; redraw(); });
  scr.tap('root_roomid/button', () => toast('邀请码已复制（演示）'));
  const tick = setInterval(() => { t = Math.max(0, t - 1); scr.text('time_layout/text_time', mmss(t)); }, 1000);
  const r = await new Promise((res) => {
    scr.tap('panel_top/button_back', () => res('back'));
    scr.tap('button_room_host', () => { if (npc) res('start'); else toast('人数不足：勾选“开局时添加NPC进行补位”'); });
  });
  clearInterval(tick);
  scr.close();
  return r === 'back' ? 'prepare' : 'show';
}

// ---- 4 STARTING SOON -----------------------------------------------------------------------------------------------
async function stShow(ctx) {
  phase('即将开始');
  const scr = new Screen('enemy_duel_entrance_show_dialog', { z: 30 });
  scr.text('root_num/text_num', `${players.length} 名观众已进入直播间`);
  scr.text('root_toggle1/text_main', C.matchTabText || '直播主赛场');
  // the audience wall: every playerhead_N slot gets a player view (the game instantiates the same prefab there); the
  // match's players first, the rest an anonymous crowd of portraits — every seat shows a face (the prefab's empty
  // state reads as a picture that failed to load)
  const icons = shuffle(POOL.filter((f) => f.icon).map(iconUri));
  const slots = scr.all.filter((x) => /^playerhead_\d+$/.test(x.n.name));
  const order = shuffle(slots.map((_, i) => i));
  slots.forEach((ph, i) => {
    const v = instantiate(scr, ph, 'enemy_duel_entrance_show_player_view');
    v.rt = JSON.parse(JSON.stringify(FULL_RT));
    const k = order.indexOf(i);
    const uri = (k < players.length && players[k].avatar) || icons[i % icons.length], filled = !!uri;
    scr.show('empty', !filled, v); scr.show('assit_bg', false, v); scr.show('head', filled, v);
    if (filled) scr.image('head', uri, v);
  });
  playLoops(scr);
  sfx('g_ui_dqstartsign');
  await scr.play('view', 'start_in_10');
  await wait(1.0);
  await scr.play('view', 'start_out');
  ctx.pending = () => scr.close();
  return 'loading';
}

// ---- 5 loading ------------------------------------------------------------------------------------------------------
async function stLoading(ctx) {
  phase('等待加载');
  sfx('g_ui_dqload');
  let scr;
  await wipe(async () => { if (ctx.pending) { ctx.pending(); ctx.pending = null; } scr = new Screen('enemy_duel_ui_battle_start_panel', { z: 30 }); }, '进入直播间');
  scr.text('panel_text/text_stage_name', `${G.mode.name} · ${C.matchTabText || '直播主赛场'}`);
  playLoops(scr);
  const pre = Promise.all(POOL.map((f) => loadFighter(f).catch(() => null)));
  await Promise.all([wait(2.2), pre]);
  if (G.online) {
    NET.match.send({ t: 'ready' });
    const m = await NET.match.next(['round', 'finish']);
    NET.match.q.unshift(m);
  }
  scr.text('panel_text/text_tip', '全部玩家已完成加载');
  await wait(0.5);
  await fadeOut(scr);
  return 'game';
}

// ---- 6 the rounds -----------------------------------------------------------------------------------------------------
// NPC viewers decide with the shared npcPick (sim.js); the supporters so far feed the FOLLOW_* strategies
function npcDecide(p, rd, lineups, winner) {
  const sup = [0, 1].map((sd) => players.filter((q) => q.choice && !q.choice.skip && q.choice.side === sd).length);
  return npcPick(p.npc, { pts: p.pts, rd, lineups, winner, sup, rnd: Math.random });
}
function plateFor(scr, list, p, side) {
  const tpl = side === 0 ? 'panel_act1duelenemy_nameplate_left' : 'panel_act1duelenemy_nameplate_right';
  const c = instantiate(scr, list, tpl);
  const all = p.choice && p.choice.kind === 'all';
  scr.show('container_name_mine', p.me, c); scr.show('container_name_other', !p.me, c);
  for (const g of ['container_name_mine', 'container_name_other']) { scr.show(g + '/normal', !all, c); scr.show(g + '/allin', all, c); }
  for (const s of scr.q('text_name', c)) setText(s, p.me ? `${p.name} 支持了这边` : p.name);
  for (const s of scr.q('img_avatar', c)) setImage(s, p.avatar);
  scr.show('container_winning', p.streak >= (C.winStreakRoundNum || 3), c);
  scr.text('container_winning/text_turn', String(p.streak), c);
  play(c, 'panel_act1duelenemy_nameplate_in');
  return c;
}
function fillLists(scr, listSuffix, supportSuffix) {
  for (const side of [0, 1]) {
    const pref = side === 0 ? 'panel_list_left' : 'panel_list_right';
    const list = scr.one(`${pref}/list_holder/group_list/${listSuffix}`);
    clearKids(list);
    const sup = players.filter((p) => !p.out && p.choice && !p.choice.skip && p.choice.side === side);
    sup.sort((a, b) => (b.me - a.me));
    stack(sup.slice(0, 6).map((p) => plateFor(scr, list, p, side)), 64, 2, listSuffix === 'content' ? side : 0.5);
    const t = side === 0 ? `等共${sup.length}人支持此队伍……` : `……等共${sup.length}人支持此队伍`;
    scr.text(`${pref}/list_holder/group_support/layout_max/layout_min/${supportSuffix}`, sup.length ? t : '暂无观众支持此队伍');
  }
}
// one enemy of a line-up in the info panel: the official stats as this level applies them (runes: ATK × 1.5, HP × 0.5,
// enemy move × 0.5), the duel score, the original enemy's handbook abilities, the duel's own description
function enemyInfo(g) {
  const f = g.f, dim = (s) => `<color=#a3aaa6>${s}</color>`;
  const way = { MELEE: '近战', RANGED: '远程', ALL: '近战 / 远程' }[f.way] || f.way, rank = { ELITE: '精英', BOSS: '领袖' }[f.levelType || f.rank];
  const kind = [way, f.dmg === 'arts' ? '法术伤害' : '物理伤害', f.fly ? '空中' : '地面', rank].filter(Boolean).join(' · ');
  const lines = [
    `<color=#f3d23a><b>${f.name}</b></color>  ×${g.n}`,
    dim(kind),
    `生命 <b>${Math.round(f.hp * ENV.hpMul)}</b>   攻击 <b>${Math.round(f.atk * ENV.atkMul)}</b>`,
    `防御 <b>${f.def}</b>   法术抗性 <b>${f.res}</b>`,
    `攻击间隔 <b>${(f.bat * 100 / f.aspd).toFixed(1)}s</b>   移速 <b>${+(f.ms * ENV.moveMultiplier).toFixed(2)}</b>   范围 <b>${f.range}</b>`,
    `分值 <b>${f.score}</b> × ${g.n} = <b>${f.score * g.n}</b>`,
  ];
  const ab = f.abilities || [];
  if (ab.length) {
    lines.push(`<color=#f3d23a>能力</color>${f.origName && f.origName !== f.name ? dim(`（图鉴原型：${f.origName}）`) : ''}`);
    for (const a of ab) lines.push(a.title ? `<b>${a.text}</b>` : `· ${a.text}`);
  }
  if (f.desc) lines.push(`<size=15>${dim(f.desc)}</size>`);
  return lines.join('\n');
}
// enemy cards of a side (the fanned row over each team's info button) and the detail lines in its panel
function lineupRow(scr, side, groups) {
  const host = scr.one(side === 0 ? 'group_staff_info_left' : 'group_staff_info_right');
  let row = host.el.querySelector(':scope > .lineup');
  if (!row) { row = document.createElement('div'); row.className = 'lineup ' + (side ? 'r' : 'l'); host.el.appendChild(row); }
  row.innerHTML = groups.map((g) => `<div class="card" style="background-image:url(${iconUri(g.f)})"><b>×${g.n}</b><span>${g.f.name}</span></div>`).join('');
  const content = scr.one((side === 0 ? 'group_staff_info_left' : 'group_staff_info_right') + '/panel_info/main/scrollrect/viewport/content');
  clearKids(content);
  for (const g of groups) {
    const e = instantiate(scr, content, 'enemy_detail_element'), t = scr.one('text_info_01', e);
    wrapText(t, t.rt.size[0]);
    setText(t, enemyInfo(g));
  }
  // the list's height: the game sizes the viewport to its rows; here the same, up to 380 and scrolling past that
  const vp = scr.one((side === 0 ? 'group_staff_info_left' : 'group_staff_info_right') + '/panel_info/main/scrollrect/viewport');
  const total = prefSize(content, 1);
  content.rt.size[1] = total; content.rt.pos[1] = 0;
  if (vp) { vp.rt.size[1] = Math.min(total, 380); scrollable(vp, content, total); }
}
// the top bar (panel_top_menu) of the bet and battle screens: the match and round, the latency, the back button (a hint
// here), the emoji switch and panel
function topBar(scr, holder, r) {
  const top = instantiate(scr, scr.one(holder), 'panel_top_menu');
  scr.text('group_topleft/text_title', `${G.mode.name} · 第 ${r} 轮`, top);
  watchPing(scr, 'panel_lag/text_num', top);
  scr.tap('group_topleft/btn_back/hotspot', () => toast('比赛进行中，可在计分板“离开比赛”'), top);
  EMO.bar(scr, top);
  return top;
}
async function betPhase(r, rd, lineups, winner, net = null) {
  phase(`第 ${r} 轮 · 押注（选择支持的队伍）`);
  const stake = rd.roundScore, solo = !net && isSolo();
  const BET_TIME = net ? net.betMs / 1000 : solo ? (C.modeSoloOperationSelectTime || 300) : (C.modeOperationSelectTime || 20), RED = C.modeOperationSelectTimeLast || 7;
  const MUL = C.modeOperationRewardMultiplier || 1, MUL_ALL = C.modeOperationRewardMultiplierAllin || 2;
  for (const p of players) p.choice = null;
  const scr = new Screen('bet_state', { z: 20 });
  const init = { 'panel_contdown_middle/text_time_out': false, 'panel_contdown_middle/text_info_private': false, 'panel_top_group/group_info': true,
    'panel_top_group/group_info_turn': false, 'group_bet_btn_turn': false, 'left_btn/btn_normal_bet': false, 'right_btn/btn_normal_bet': false,
    'group_turn/ui_particle_boom': false, 'group_turn/turn_info/img_sword': false, 'group_assess': false };
  for (const [k, v] of Object.entries(init)) scr.show(k, v);
  // the bet buttons' selection glow is a halo around a chevron-shaped hole; in btn_ex_bet the halo is not mirrored the
  // way btn_normal_bet's is (scale x −1.5), so its hole points away from the button and the arena shows through:
  // mirror it to match the button
  for (const side of ['left_btn', 'right_btn']) { const gl = scr.one(`${side}/btn_ex_bet/btn_bet/select/normal_bet_select_glow`); if (gl) gl.rt.scale[0] = -Math.abs(gl.rt.scale[0]); }
  scr.text('turn_info/text_turn', pad2(r));
  scr.text('panel_assets/text_assets', String(me.pts).padStart(8, '0'));
  scr.text('panel_rank/content/text_rank', String(rankOf(me)));
  // 观众保护 tips belong to 竞猜对决
  scr.show('panel_contdown_middle/group_tips', false);
  const short = me.pts < stake, canAll = rd.canAllIn || short;
  for (const side of ['left_btn', 'right_btn']) {
    scr.show(`${side}/btn_ex_bet/btn_assets_notenough`, short);
    scr.show(`${side}/btn_ex_bet/btn_bet`, !short);
    scr.show(`${side}/btn_ex_bet/btn_bet_allin`, canAll);
    scr.text(`${side}/btn_ex_bet/btn_bet/btn_info/num_layout_max/layout_min/text_num`, fmtW(stake));
    scr.text(`${side}/btn_ex_bet/btn_assets_notenough/btn_info/num_layout_max/layout_min/text_num`, fmtW(stake));
  }
  const out = me.out;
  scr.show('group_bet_btn', !out); scr.show('pnl_skip', !out && rd.canSkip); scr.show('panel_contdown_middle/group_out', out);
  // the official tips, minus those about 竞猜对决 (its 观众保护)
  const tips = DCFG.tips.filter((x) => !/观众保护|竞猜对决/.test(x)), tip = tips[Math.floor(Math.random() * tips.length)];
  scr.text('panel_contdown_middle/text_info', out ? '你已被淘汰，正在观战……' : solo ? '选择后即开赛 · ' + tip : tip);
  lineupRow(scr, 0, lineups[0]); lineupRow(scr, 1, lineups[1]);
  topBar(scr, 'manager_mode_view/top_menu_holder', r);
  scr.show('group_staff_info_left/panel_info', false); scr.show('group_staff_info_right/panel_info', false);
  const opened = {};
  for (const side of ['group_staff_info_left', 'group_staff_info_right']) {
    let open = false;
    const toggle = () => {
      open = !open; scr.show(`${side}/panel_info`, true);
      // the panel opens over the countdown's tip line: the tip steps back while a panel is open
      opened[side] = open; const tip = scr.one('panel_contdown_middle/text_info'); if (tip) tip.alpha = opened.group_staff_info_left || opened.group_staff_info_right ? 0 : 1;
      scr.play(`${side}/panel_info`, 'battle_ui_staff_panel_info', { reverse: !open }).then(() => { if (!open) scr.show(`${side}/panel_info`, false); });
    };
    scr.tap(`${side}/check_info/hotspot`, toggle);
    const row = scr.one(side).el.querySelector(':scope > .lineup');
    if (row) { row.onclick = toggle; row.title = '查看敌人信息'; }
    scr.tap(`${side}/panel_info/main/staff_info_top/hotspot`, toggle);
  }
  playLoops(scr, scr.root, /countdown_red/);
  scr.play('manager_mode_view', 'battle_ui_bet_in');
  // the round number's boom and fire
  scr.show('group_turn/ui_particle_boom', true);
  wait(0.8).then(() => { if (!scr.dead) scr.show('group_turn/ui_particle_boom', false); });
  const refresh = () => {
    const c = me.choice;
    for (const [i, side] of [[0, 'left_btn'], [1, 'right_btn']]) {
      const selN = c && !c.skip && c.side === i && c.kind === 'normal', selA = c && !c.skip && c.side === i && c.kind === 'all';
      scr.show(`${side}/btn_ex_bet/btn_bet/select`, selN); scr.show(`${side}/btn_ex_bet/btn_bet_allin/select`, selA);
      scr.show(`${side}/btn_ex_bet/btn_bet/dark`, !!c && !selN); scr.show(`${side}/btn_ex_bet/btn_bet_allin/dark`, !!c && !selA);
    }
    scr.show('btn_skip/select', !!(c && c.skip));
    const gain = c && !c.skip ? (c.kind === 'all' ? MUL_ALL * stake : MUL * stake) : 0;
    scr.show('group_assess', !!gain);
    scr.text('assess_layout_min/text_assess', '+' + gain);
    fillLists(scr, 'container', 'text_num');
  };
  const choose = (ch) => {
    const was = me.choice;
    me.choice = ch.skip ? ch : { ...ch, forced: ch.kind === 'all' && short && !rd.canAllIn };
    if (net) NET.match.send(ch.skip ? { t: 'bet', skip: true } : { t: 'bet', side: ch.side, kind: ch.kind });
    if (ch && !ch.skip && (!was || was.skip)) scr.play('group_assess', 'battle_ui_assess_in');
    if (ch && !ch.skip) sfx(ch.kind === 'all' ? 'b_ui_dqcoinall' : 'b_ui_dqcoin');
    if (ch && ch.skip) scr.play('btn_skip', 'battle_ui_skip_select');
    refresh();
    phase(`第 ${r} 轮 · 押注 · ${ch.skip ? '本轮观望' : `${ch.kind === 'all' ? '全力支持' : '支持'} ${ch.side ? '右' : '左'}队`}`);
  };
  for (const [i, side] of [[0, 'left_btn'], [1, 'right_btn']]) {
    scr.tap(`${side}/btn_ex_bet/btn_bet/hotspot`, () => choose({ side: i, kind: 'normal' }));
    scr.tap(`${side}/btn_ex_bet/btn_bet_allin/hotspot`, () => choose({ side: i, kind: 'all' }));
  }
  scr.tap('btn_skip/hotspot', () => choose({ skip: true }));
  refresh();
  // NPC bets land during the countdown; the FOLLOW_* viewers (priority > 0) late, after seeing the others
  const W8 = solo ? 6 : BET_TIME;
  const npcs = net ? [] : players.filter((p) => !p.me && !p.out).map((p) => ({ p, at: p.npc.priority > 0 ? lerp(W8 * 0.65, W8 - 1.5, Math.random()) : lerp(1, W8 * 0.6, Math.random()) }));
  let t = 0, red = false, lastTick = 0;
  const handle = scr.one('slidingarea/handle'), t0 = net && net.at ? net.at : performance.now();
  while (net ? !net.final : t < BET_TIME) {
    if (solo && (me.choice || me.out) && t >= W8) break;
    await wait(0.1);
    if (net) {
      // the instance's clock; the seats' bets as they land; its final word closes the window
      t = (performance.now() - t0) / 1000;
      let upd = false;
      for (const m of NET.match.drain('bets')) for (const [id, ch] of Object.entries(m.choices)) { const p = players.find((x) => x.id === id); if (p && !p.me) { p.choice = ch; upd = true; } }
      for (const m of NET.match.drain('error')) toast(m.msg);
      const fin = NET.match.take('battle');
      if (fin) { for (const p of players) p.choice = fin.choices[p.id] || null; net.final = true; upd = true; G.battleAt = fin._at; }
      if (NET.match.closed || t > BET_TIME + 15) net.final = true;
      if (upd) refresh();
    } else t += 0.1;
    const left = Math.max(0, BET_TIME - t);
    scr.text('panel_contdown_middle/text_time', mmss(Math.ceil(left)));
    if (handle) { handle.rt.amin[0] = handle.rt.amax[0] = clamp(t / BET_TIME, 0, 1); }
    if (!red && left <= RED) { red = true; scr.play('panel_contdown_middle', 'battle_ui_countdown_red', { loop: true }); }
    if (left <= RED && left > 0 && Math.ceil(left) !== lastTick) { lastTick = Math.ceil(left); sfx('b_ui_dqcountdown'); }
    let changed = false;
    for (const x of npcs) if (!x.done && t >= x.at) { x.done = true; x.p.choice = npcDecide(x.p, rd, lineups, winner); changed = true; EMO.npc('bet', x.p, null, 0.2 + Math.random() * 0.8); }
    if (changed) refresh();
  }
  for (const x of npcs) if (!x.done) x.p.choice = npcDecide(x.p, rd, lineups, winner);
  if (!net && !me.out && !me.choice) me.choice = rd.canSkip ? { skip: true } : { side: Math.random() < 0.5 ? 0 : 1, kind: short ? 'all' : 'normal', forced: short };
  refresh();
  scr.text('panel_contdown_middle/text_time', '00:00');
  await wait(0.6);
  await fadeOut(scr, 0.3);
}
async function battlePhase(r, online = false) {
  phase(`第 ${r} 轮 · 比赛中`);
  const scr = new Screen('battle_state', { z: 20 });
  scr.show('panel_waiting', false);
  scr.text('pnl_round/text_round', pad2(r)); scr.text('pnl_allround/text_allround', '/' + pad2(ROUNDS));
  topBar(scr, 'root/top_container', r);
  fillLists(scr, 'content', 'text');
  const c = me.choice;
  scr.show('root/panel_battle_holder/group_support', !!(c && !c.skip));
  if (c && !c.skip) {
    scr.text('panel_battle_holder/group_support/layout_max/layout_min/text', `你${c.kind === 'all' ? '全力' : ''}支持了${c.side ? '右侧（蓝）' : '左侧（红）'}队伍`);
    // both hands point to the side supported (the sprite points right)
    for (const f of scr.q('panel_battle_holder/group_support/layout_max/layout_min/support_finger')) f.rt.scale[0] = c.side ? 1 : -1;
  }
  playLoops(scr);
  scr.play('root', 'battle_ui_battle_in');
  sfx('b_ui_dqstartbanner');
  await scr.play('enemyduel_round_start', 'battle_ui_round_start_in');
  await wait(0.4);
  scr.show('enemyduel_round_start', false);
  let result;
  if (online) {
    // the instance waits for every viewer; if its result comes first (a slower viewer timed out), catch up
    const done = startBattle();
    // a battle that began well before this replay (the connection came back, or the page was reloaded) catches up
    if (G.battleAt && performance.now() - G.battleAt > 6000) arena.ff = 8;
    const res = NET.match.next(['result', 'finish']).then((m) => { G.serverResult = m; if (arena.running) arena.ff = 40; return m; });
    result = await done;
    NET.match.send({ t: 'watched' });
    if (!G.serverResult) { scr.show('panel_waiting', true); phase(`第 ${r} 轮 · 正在等待其他玩家结束观赛……`); }
    await res;
    scr.show('panel_waiting', false);
  } else {
    // offline the NPC viewers react during the fight and to its outcome (online the instance sends theirs)
    for (const p of players) EMO.npc('battle', p, null, 1 + Math.random() * 7);
    result = await startBattle();
    for (const p of players) EMO.npc('result', p, !!(p.choice && !p.choice.skip && (result === 'draw' || p.choice.side === result)), 0.1 + Math.random() * 0.7);
  }
  phase(`第 ${r} 轮 · ${result === 'draw' ? '平局' : result === 0 ? '左队（红）胜' : '右队（蓝）胜'}`);
  await wait(1.6);
  await fadeOut(scr, 0.25);
  return result;
}
function settle(r, rd, w) {
  for (const p of players) { p.shieldHit = false; settleOne(p, p.choice, rd, w); }
}
async function roundEnd(r, w) {
  const scr = new Screen('round_end_state', { z: 22 });
  scr.show('group_left_win', w === 0); scr.show('group_right_win', w === 1); scr.show('group_draw', w === 'draw');
  const c = me.choice, played = c && !c.skip && !(me.out && me.outRound < r);
  const all = played && c.kind === 'all';
  scr.show('group_state/right', played && me.right);
  scr.show('group_state/lose', played && !me.right);
  scr.show('group_state/sorry', !played);
  scr.text('sorry_lower/text_tie_game', me.out && me.outRound < r ? '观战中' : '本轮观望');
  if (played && me.right) {
    scr.show('right/group_allin', all); scr.show('right/spine_container_allin', all); scr.show('right/spine_container_1', !all);
    scr.show('right_lower/bubble/dec_text/text', !all); scr.show('right_lower/bubble/dec_text/text_allin', all);
    scr.text('right_lower/bubble/text_count', sgn(me.change));
    scr.text('group_state/right/text_right', w === 'draw' ? '平局，算猜对！' : '猜对了！');
  }
  if (played && !me.right) {
    scr.show('lose/error', !me.shieldHit); scr.show('lose/shield', me.shieldHit);
    scr.show('text_toggle/text_error', !me.out); scr.show('text_toggle/text_out', me.out);
    scr.show('error_lower/bubble/dec_text/text', !all); scr.show('error_lower/bubble/dec_text/text_allin', all);
    scr.text('error_lower/bubble/text_count', sgn(me.change));
  }
  for (const [i, side] of [[0, 'left'], [1, 'right']]) {
    const mine = played && c.side === i, won = w === 'draw' || w === i;
    scr.show(`group_avatar/${side}`, mine);
    scr.show(`group_avatar/${side}/win`, won); scr.show(`group_avatar/${side}/lose`, !won);
    scr.text(`group_avatar/${side}/win/text_name`, me.name); scr.text(`group_avatar/${side}/lose/text_name`, me.name);
    scr.text(`group_avatar/${side}/win/text_id`, me.tag); scr.text(`group_avatar/${side}/lose/text_id`, me.tag);
    scr.image(`group_avatar/${side}/avatar_bg/container_avatar/img_avatar`, me.avatar);
  }
  sfx(!played ? 'b_ui_dqonlooker' : me.right ? (all ? 'b_ui_dqearncoinh' : 'b_ui_dqearncoin')
    : me.shieldHit ? 'b_ui_dqdefeatshield' : me.out ? 'b_ui_dqdefeat' : all ? 'b_ui_dqlosecoinh' : 'b_ui_dqlosecoin');
  phase(`第 ${r} 轮 · 结算 · ${!played ? '观望' : me.right ? `猜对 ${sgn(me.change)}` : me.shieldHit ? '观众保护抵消' : `猜错 ${sgn(me.change)}`}`);
  playLoops(scr);
  // the clip itself fades the panel in (0.1 s), holds it to 1.58 s and fades it out by 1.83 s; played at 0.6× here so
  // the result stays readable (~2.6 s)
  await scr.play('panel_round_end', 'battle_round_end_anim', { rate: 0.6 });
  scr.close();
}
async function scoreboard(r) {
  phase(`第 ${r} 轮 · 计分板`);
  const scr = new Screen('operation_rank_state', { z: 22 });
  scr.show('panel_second_confirm', false);
  scr.text('group_text/text_bg/text_title_name', r < ROUNDS ? `第 ${r} / ${ROUNDS} 轮` : '最终排名');
  const rk = ranked();
  for (let i = 1; i <= 10; i++) {
    const item = scr.one(`content/item_${i}`), p = rk[i - 1];
    if (!item) continue;
    item.active = !!p;
    if (!p) continue;
    const kind = p.out ? 'out' : p.me ? 'self' : '';
    scr.show('bg_part/group_normal', !kind, item); scr.show('bg_part/group_self', kind === 'self', item); scr.show('bg_part/group_out', kind === 'out', item);
    scr.show('rank_toggle/text_rank', !p.out, item); scr.show('rank_toggle/text_out', p.out, item);
    scr.text('rank_toggle/text_rank', String(i), item);
    scr.text('group_content/text_name', p.me ? `${p.name}（我）` : p.name, item);
    scr.text('group_content/text_money', fmt(p.pts), item);
    scr.text('group_content/text_money_change', p.out && p.outRound < r ? '—' : sgn(p.change), item);
    const ch = scr.one('group_content/text_money_change', item);
    if (ch && ch.color) { const col = p.change > 0 ? [1, 0.82, 0.25, 1] : p.change < 0 ? [1, 0.45, 0.4, 1] : [0.8, 0.8, 0.8, 1]; ch.color = col; }
    scr.show('group_content/winning_streak', p.streak >= (C.winStreakRoundNum || 3), item);
    scr.text('img_bg/text_count', String(p.streak), item);
    scr.image('container_avatar/img_avatar', p.avatar, item);
  }
  playLoops(scr);
  scr.play('panel_round_rank', 'scoreboard_enter');
  let leave = false;
  const confirm = scr.one('panel_second_confirm');
  scr.tap('group_bottom/btn_exit/hotspot', () => { confirm.active = true; scr.play('panel_second_confirm', 'second_confirm_window_switch'); });
  scr.text('confirm_again/bg/text_state', '确定要离开比赛吗？');
  scr.tap('confirm_again/btn_cancel/hotspot', () => { scr.play('panel_second_confirm', 'second_confirm_window_switch', { reverse: true }).then(() => { confirm.active = false; }); });
  scr.tap('confirm_again/btn_confirm/hotspot', () => { leave = true; });
  scr.text('btn_exit/text_layout/text_exit', '离开比赛');
  let n = isSolo() ? (C.modeSoloOperationRankTime || 3) : (C.modeOperationRankTime || 8);
  while (n > 0 && !leave) {
    scr.text('group_countdown/text_count', String(n));
    scr.text('group_countdown/text_state', r < ROUNDS ? '秒后进入下一轮比赛' : '秒后公布最终结果');
    for (let k = 0; k < 10 && !leave; k++) await wait(0.1);
    if (!confirm.active) n--;
  }
  await fadeOut(scr, 0.25);
  return leave;
}
async function stGame() {
  let left = false;
  const rounds = roundsOf(G.mode);
  G.log = [];
  EMO.begin();
  for (let i = 0; i < rounds.length && !left; i++) {
    const rd = rounds[i], r = rd.round;
    G.round = r;
    const seed = (Math.random() * 2 ** 31) | 0;
    const lineups = makeLineups(rd, mulberry32(seed ^ 0x5bd1e995));
    const pred = predict(lineups, seed);
    G.log.push({ r, seed, lineups: lineups.map((x) => x.map((g) => `${g.f.name}×${g.n}`).join(' + ')), cost: lineups.map(sideScore), pred: pred.winner, len: pred.time });
    setupRound(lineups, seed);
    await betPhase(r, rd, lineups, pred.winner);
    const w = await battlePhase(r);
    if (w !== pred.winner) console.warn('replay differs from the prediction', r, w, pred.winner);
    settle(r, rd, w);
    G.log[G.log.length - 1].w = w;
    await roundEnd(r, w);
    left = await scoreboard(r);
    if (players.filter((p) => !p.out).length <= 1) break;
  }
  EMO.end();
  G.left = left;
  return 'finish';
}

// ---- 7 settlement --------------------------------------------------------------------------------------------------
// the finish comment (commentData.OPERATION, by priority) — templates read as: rank N; a new record; NoChoice(1): got
// through a forced 全力支持; score > 149999; MultiChoice(0): out after choosing; NoChoice(0): out on a forced 全力支持;
// score ≤ 149999 (the fallback)
function finishComment(rank, newRecord) {
  const list = Object.values(DCFG.comments.OPERATION).sort((a, b) => a.priority - b.priority);
  const ok = (c) => {
    const n = Number(c.param[0]);
    switch (c.template) {
      case 'act1enemyduelCommentRank': return rank === n;
      case 'act1enemyduelCommentNewRecord': return newRecord;
      case 'act1enemyduelCommentNoChoice': return n === 1 ? (me.stats.forced > 0 && !me.out) : (me.out && me.lastForced);
      case 'act1enemyduelCommentScoreGT': return me.pts > n;
      case 'act1enemyduelCommentMultiChoice': return me.out && !me.lastForced;
      case 'act1enemyduelCommentScoreLE': return me.pts <= n;
      default: return false;
    }
  };
  return (list.find(ok) || list[list.length - 1]).commentText;
}
function finishReward(rank) {
  const basic = DCFG.basicScores[clamp(me.played, 1, DCFG.basicScores.length) - 1] || 0;
  const ex = DCFG.extraScore[G.mode.id], row = ex && ex.data.find((x) => rank >= x.rankMin && rank <= x.rankMax);
  return basic + (row ? row.tokenNum : 0);
}
async function stFinish() {
  phase('最终结算');
  let scr;
  await wipe(async () => { clearArena(); scr = new Screen('enemy_duel_battle_finish_view', { z: 40 }); }, '比赛结束');
  const rk = ranked(), myRank = rk.indexOf(me) + 1;
  scr.text('title_part/text_title', G.left ? '已离开比赛' : '比赛结束');
  if (ART[G.mode.key]) scr.image('panel_bg/img_bg', ART[G.mode.key].bg, null, 'cover');
  scr.show('state_toggle/leave', !!G.left); scr.show('state_toggle/finish', !G.left);
  const content = scr.one('rank_list/scroll_list/viewport/content');
  clearKids(content);
  const items = rk.map((p, i) => {
    const it = instantiate(scr, content, 'enemy_duel_battle_finish_rank_item');
    scr.show('no_info', false, it); scr.show('normal_info', true, it); scr.show('mine', p.me, it);
    scr.text('normal_info/text_name', p.name, it); scr.text('normal_info/text_id', p.tag, it);
    scr.text('normal_info/text_num', fmt(p.pts), it); scr.text('normal_info/text_rank', String(i + 1), it);
    scr.show('icon_toggle/icon_stand', false, it); scr.show('icon_toggle/icon_op', true, it);
    scr.image('npc/img_avatar', p.avatar, it);
    if (p.me) play(it, 'panel_enemyduel_settlement_rank_mine_loop', { loop: true });
    return it;
  });
  stack(items, 81, 6);
  const scrollTo = scrollable(scr.one('rank_list/scroll_list/viewport'), content, items.length * 87);
  wait(0.05).then(() => scrollTo((myRank - 1) * 87 - 200));
  scr.text('name_layout_min/text_name', `Dr.${me.name}`);
  const best = me.pts > G.best && !!G.mode.record;
  scr.text('title_layout_min/text_comment', finishComment(myRank, best));
  scr.show('panel_assets/title_operation', true); scr.show('panel_assets/title_stand', false);
  scr.text('assets_layout_min/text_num', fmt(me.pts)); scr.show('assets_layout_min/text_turn', false);
  scr.show('assets_layout_min/group_best', best);
  if (best) G.best = me.pts;
  scr.text('group_rank/text_rank', String(myRank));
  scr.show('group_rank/rank_top3', myRank <= 3);
  injectImg(scr.one('panel_avatar/container_avatar_img'), me.avatar, 'inj avatar');
  const bl = 'betting_01_layout_max/betting_01_layout_min';
  scr.text(`${bl}/info/layout_max/layout_min/text_num`, String(me.stats.all));
  scr.text(`${bl}/group_betting_02/betting_02_layout_max/betting_02_layout_min/info/layout_max/layout_min/text_num`, String(me.stats.normal));
  scr.text(`${bl}/group_betting_02/betting_02_layout_max/betting_02_layout_min/group_betting_03/betting_03_layout_max/betting_03_layout_min/info/layout_max/layout_min/text_num`, String(me.stats.skip));
  scr.show('group_down/group_1_btn', false); scr.show('group_down/group_2_btn', true);
  scr.show('btn_next/panel_continue', true); scr.show('btn_next/panel_room', false);
  scr.text('panel_achieve/text_num', '×' + finishReward(myRank));
  // the bottom bar's daily-activity meter (每日活跃) and 青草计划 level are account systems this demo does not have (the
  // browser leaves out the same column): the bar keeps the reward and the buttons
  scr.show('panel_layout/container_daily', false); scr.show('panel_layout/container_level', false);
  // the prefab leaves this title's font size at 0 (Unity then falls back to the font's own size): use its twin's 18
  // (竞猜轮次, shown in the same place for the stand mode)
  const assetsTitle = scr.one('title_operation/text_assets_title');
  if (assetsTitle && assetsTitle.t) assetsTitle.t.style.fontSize = '18px';
  playLoops(scr);
  sfx('g_ui_dqwinsettlement');
  scr.play('panel', 'panel_enemyduel_settlement_in');
  if (myRank <= 3) scr.play('group_rank/rank_top3', 'enemyduel_settlement_rank_top3_in').then(() => scr.play('group_rank/rank_top3', 'enemyduel_settlement_rank_top3_loop', { loop: true }));
  phase(`最终结算 · 第 ${myRank} 名 · ${fmt(me.pts)} 礼物点数（继续匹配 / 返回主页）`);
  const r = await whenTapped(scr, { 'btn_next/hotspot': 'match', 'btn_backhome/hotspot': 'entry' });
  await fadeOut(scr, 0.3);
  // the seat is forgotten once the match is over or left; a match lost to the network keeps it (a reload rejoins)
  if (G.online && NET.match) { NET.match.close(); NET.match = null; if (G.matchOver || G.left) forgetSeat(); }
  if (r !== 'match') return 'entry';
  const wasOnline = G.online;
  G.online = false;
  newPlayers();
  if (wasOnline) return G.mode.room ? 'prepare' : 'match';
  return !G.mode.multi ? 'show' : G.mode.room ? 'room' : 'match';
}

// ---- boot / frame ---------------------------------------------------------------------------------------------------
let stageK = 1;
function fit() {
  const W = innerWidth, H = innerHeight, k = Math.min(W / 1280, H / 720);
  stageK = k;
  const st = $('stage');
  st.style.transform = `scale(${k})`;
  st.style.left = ((W - 1280 * k) / 2) + 'px'; st.style.top = ((H - 720 * k) / 2) + 'px';
  // the gear keeps the stage's proportions (38 px and 7 px in from the corner at 1280×720), so it stays clear of the
  // official buttons that run close to the corner; it stops shrinking at 30 px to remain easy to hit
  const rs = document.documentElement.style;
  rs.setProperty('--gear', Math.round(clamp(38 * k, 30, 56)) + 'px'); rs.setProperty('--gear-in', Math.max(4, Math.round(7 * k)) + 'px');
  const res = Math.min(2, k * (window.devicePixelRatio || 1));
  for (const app of [arenaApp]) if (app) { app.renderer.resolution = res; app.renderer.resize(1280, 720); app.view.style.width = '1280px'; app.view.style.height = '720px'; }
}
let last = performance.now(), video = null;
function frame(now) {
  const rdt = Math.min(0.1, (now - last) / 1000); last = now;
  const dt = rdt * CLOCK.scale;
  CLOCK.t += dt;
  tickTimers();
  tickAnims(dt);
  tickSpinners(dt);
  EMO.tick(dt);
  for (const scr of screens.slice()) layout(scr.root, 1280, 720, [0.5, 0.5], true);
  tickParticles(dt, stageK);
  arenaFrame(dt);
  if (FLOW.ctx.video && FLOW.ctx.video.app && FLOW.ctx.video.cv.isConnected) FLOW.ctx.video.frame(dt);
  renderUiSpines(dt, stageK);
  if (arena) arena.blurWant = screens.some((scr) => scr.blurs.some((s) => s.shown));
  requestAnimationFrame(frame);
}
const FLOW = { ctx: {} };
// called by the sound layer when the BGM changes: the entry page's music player shows the track's name
function onTrackChange(title) { const e = FLOW.ctx.entryScr; if (e && !e.dead) e.text('panel_name/text_music_name', title); }
const STATES = { entry: stEntry, prepare: stPrepare, show: stShow, loading: stLoading, finish: stFinish,
  match: (ctx) => (NET.on ? stMatchOnline(ctx) : stMatch(ctx)), room: (ctx) => (NET.on ? stRoomOnline(ctx) : stRoom(ctx)),
  game: (ctx) => (G.online ? stGameOnline(ctx) : stGame(ctx)) };
// ---- the settings gear: the demo's controls and the viewer's avatar, behind one button in the window's corner -------
// An avatar is a roster key (an enemy portrait from the client) or a small picture of the viewer's own (a JPEG data
// URI, 96 × 96); it is kept in this browser and, online, sent to the lobby so the table sees it.
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
function avatarUri(v) {
  if (typeof v === 'string' && AVATAR_RE.test(v) && v.length <= 16000) return v;
  return iconUri(byKey(v)) || iconUri(POOL[0]);
}
const myAvatar = {
  get() { try { return localStorage.getItem('duel.avatar') || ''; } catch (e) { return ''; } },
  set(v) {
    try { localStorage.setItem('duel.avatar', v); } catch (e) { /* no storage: this session only */ }
    this.mem = v;
    if (me) me.avatar = avatarUri(v);
    if (NET.on && NET.lobby) NET.lobby.send({ t: 'avatar', avatar: v });
    settings.paintAvatar();
  },
  value() { return this.mem ?? this.get(); },
};
// an uploaded picture → a 96 × 96 centre crop, JPEG, small enough for the lobby
function shrinkPicture(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 96;
      const x = c.getContext('2d'), s = Math.min(im.width, im.height);
      x.drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 96, 96);
      URL.revokeObjectURL(url);
      let q = 0.86, d = c.toDataURL('image/jpeg', q);
      while (d.length > 12000 && q > 0.4) { q -= 0.12; d = c.toDataURL('image/jpeg', q); }
      res(d);
    };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('不是可以读取的图片')); };
    im.src = url;
  });
}
const settings = {
  open: false,
  init() {
    const gear = $('gear'), box = $('settings');
    gear.onclick = () => this.toggle();
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) { this.toggle(false); gear.focus(); } });
    addEventListener('pointerdown', (e) => { if (this.open && !box.contains(e.target) && !gear.contains(e.target) && !$('logbox').contains(e.target)) this.toggle(false); });
    // the avatar choices: every portrait of the roster, then the viewer's own picture
    const grid = $('avGrid');
    grid.innerHTML = POOL.filter((f) => f.icon).map((f) => `<button type="button" role="radio" data-k="${f.key}" aria-label="${f.name}" title="${f.name}" style="background-image:url(${iconUri(f)})"></button>`).join('');
    grid.onclick = (e) => { const b = e.target.closest('button[data-k]'); if (b) { myAvatar.set(b.dataset.k); toast(NET.on ? '头像已更换，从下一局起同桌观众可见' : '头像已更换'); } };
    $('avUpload').onclick = () => $('avFile').click();
    $('avFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { myAvatar.set(await shrinkPicture(f)); toast(NET.on ? '已使用你的图片，从下一局起同桌观众可见' : '已使用你的图片'); }
      catch (err) { toast('无法读取这个文件：' + f.name); }
    };
    this.paintAvatar();
  },
  paintAvatar() {
    const v = myAvatar.value(), uri = me ? me.avatar : avatarUri(v);
    $('avNow').style.backgroundImage = uri ? `url(${uri})` : 'none';
    $('avName').textContent = me ? `${me.name} ${me.tag || ''}` : ME_NAME;
    for (const b of $('avGrid').children) b.setAttribute('aria-checked', String(b.dataset.k === v));
    $('avUpload').setAttribute('aria-pressed', String(AVATAR_RE.test(v)));
  },
  toggle(on = !this.open) {
    this.open = on;
    $('settings').classList.toggle('open', on);
    $('gear').setAttribute('aria-expanded', String(on));
    if (on) { this.paintAvatar(); $('trackName').textContent = SND.track ? `正在播放：${SND.track}` : '声音尚未开启'; }
    else $('logbox').hidden = true;
  },
};
function controls() {
  settings.init();
  const speeds = [1, 2, 4];
  const sp = $('speed');
  sp.innerHTML = speeds.map((v) => `<button data-v="${v}" aria-pressed="${v === 1}">${v}×</button>`).join('');
  sp.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; CLOCK.scale = Number(b.dataset.v); for (const x of sp.children) x.setAttribute('aria-pressed', x === b); };
  $('ff').onclick = () => { if (arena && arena.running) { arena.ff = 12; toast('快进本场战斗'); } else toast('当前没有进行中的战斗'); };
  $('mus').onclick = (e) => { setMusicOn(!SND.musicOn); e.currentTarget.setAttribute('aria-pressed', SND.musicOn); };
  $('snd').onclick = (e) => { SND.sfxOn = !SND.sfxOn; e.currentTarget.setAttribute('aria-pressed', SND.sfxOn); sfx('click'); };
  $('pick').onclick = () => $('file').click();
  $('file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await loadMusicFile(f); toast('正在播放：' + SND.track); } catch (err) { toast('无法解码这个文件：' + f.name); } e.target.value = ''; };
  $('log').onclick = () => {
    const box = $('logbox');
    box.hidden = !box.hidden;
    if (!box.hidden) box.innerHTML = '<b>回合记录</b>' + (G.log.length ? G.log.map((x) => `<div>第${x.r}轮：<span class="l">${x.lineups[0]}（${x.cost[0]}）</span> vs <span class="r">${x.lineups[1]}（${x.cost[1]}）</span> → ${x.w === undefined ? '进行中' : (x.w === 'draw' ? '平局' : x.w === 0 ? '左胜' : '右胜') + ` · ${x.len.toFixed(0)}s`}</div>`).join('') : '<div>还没有回合</div>')
      + '<b>玩家</b>' + ranked().map((p, i) => `<div>${i + 1}. ${p.name}${p.me ? '（我）' : ''} ${fmt(p.pts)}${p.out ? ' 已淘汰' : ''}</div>`).join('');
  };
}
// the opening screen: the client's LIVE badge and breadcrumb sprites, the 礼物对决 key art, a standby clock, the mode
function startScreen() {
  const st = $('start'), spr = (k) => (SPR[k] ? `url(${SPR[k].uri})` : 'none');
  st.querySelector('.sb-livebadge').style.backgroundImage = spr('loading_atlas/img_live');
  st.querySelector('.sb-crumb').style.backgroundImage = spr('atlas_inroom/deco_live');
  st.querySelector('.sb-art').style.backgroundImage = `url(${FXTEX.keyart})`;
  $('startMode').textContent = NET.on ? `联机模式：频道服务器 ${location.host}` : '单机模式：直接打开的本地文件，不连接服务器';
  const t0 = performance.now(), clk = $('sbClock');
  const tick = () => {
    if (st.hidden) return;
    const n = Math.floor((performance.now() - t0) / 1000);
    clk.textContent = [n / 3600, (n / 60) % 60, n % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');
    setTimeout(tick, 250);
  };
  tick();
}
const startStatus = (t) => { $('startStatus').textContent = t; $('go').setAttribute('aria-busy', 'true'); };
async function boot() {
  REPORT.init();
  try {
    fit();
    installVfs();
    arenaApp || initArena();
    uiApp = new PIXI.Application({ view: $('uispine'), width: 1280, height: 720, backgroundAlpha: 0, antialias: true, autoStart: false });
    fit();
    addEventListener('resize', fit);
    controls();
    phase('加载素材……');
    await Promise.all([preloadSprites(), preloadPtex(), document.fonts ? document.fonts.ready : null]);
    await buildArt();
    buildStage();
    newPlayers();
    requestAnimationFrame(frame);
    phase(NET.on ? '联机模式 · 输入昵称后进入频道' : '点击“进入频道”开始');
    $('start').hidden = false;
    startScreen();
    if (NET.on) {
      const nick = $('nick');
      $('nickrow').hidden = false;
      try { nick.value = localStorage.getItem('duel.nick') || ''; } catch (e) { /* no storage */ }
      setTimeout(() => nick.focus(), 900);
      nick.onkeydown = (e) => { if (e.key === 'Enter') $('start').click(); };
    }
    await new Promise((res) => { $('start').onclick = (e) => { if (!e.target.closest('#nickrow, a')) res(); }; });
    startStatus('正在载入声音……');
    try { await initSound(); } catch (e) { console.warn('sound', e); }
    if (NET.on) {
      const name = $('nick').value.trim();
      try { localStorage.setItem('duel.nick', name); } catch (e) { /* no storage */ }
      startStatus('正在连接频道服务器……');
      try { await connectLobby(name); newPlayers(); toast(`已连接 · ${NET.me.name}${NET.me.tag}`); }
      catch (e) { toast('连接服务器失败，以单机模式继续：' + e.message, 4); NET.on = false; }
    }
    // a reloaded page whose tab was in a match: straight back into it
    const back = NET.on ? await rejoinMatch() : null;
    $('start').hidden = true;
    let st = back || 'entry';
    for (;;) st = await STATES[st](FLOW.ctx);
  } catch (e) { REPORT.fatal(e); }
}
window.__flow = { SND, DCFG, NET, EMO, REPORT, dbg: { STATES, FLOW, get playing() { return playing; }, POOL, startBattle, clearArena, Screen, roundEnd, scoreboard, settle, setupRound, makeLineups, predict, makeWorld, simStep, mulberry32, roundsOf, betPhase, battlePhase, stFinish, stShow, play, get me() { return me; } }, G, get players() { return players; }, CLOCK, screens, arena: () => arena, phase: () => $('phase').textContent,
  // test hook: click the topmost shown, clickable node whose path ends with the suffix
  tap: (suf) => { for (const scr of screens.slice().reverse()) { const s = scr.q(suf).find((x) => x.shown && x.el.onclick); if (s) { s.el.click(); return true; } } return false; } };
boot();
