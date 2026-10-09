// ---- online play: the lobby (the gateway) and a match (a battle instance) over WebSocket --------------------------------
// Served by the gateway (http), the page plays online: 礼物对决 matchmaking and 群组 rooms go through the lobby; a
// match's rounds, every seat's bets and the results come from its instance, which also computed each battle's outcome
// before the bets — the page replays the same fight from the line-ups and the seed (sim.js is shared). Opened as a
// file, the page stays the offline demo. 自娱自乐 is always local.
const NET = { on: /^https?:$/.test(location.protocol), lobby: null, match: null, me: null };
// A server connection with a message queue the flow reads in order (next / drain / take). With `retry` (seconds) a
// connection that drops unexpectedly is reopened in the background with growing pauses until that time runs out:
// waiting reads simply wait on, what the flow sends meanwhile that matters (bets, ready, watched, leave) goes out once
// it is back, and `reopen` (the url to reconnect to, and what to send first) lets the match ask for what it missed
// (since=<last seq>) and the lobby take its session back. The server's own closes (match over, seat taken, refused)
// are final. onstate('reconnecting' | 'online' | 'lost') drives the waiting overlay.
const KEEP = ['bet', 'watched', 'ready', 'leave'];
class Link {
  constructor(url, { retry = 0, reopen = null, onstate = () => {}, intercept = () => false } = {}) {
    this.url = url; this.q = []; this.waiters = []; this.closed = false; this.seq = 0; this.outbox = [];
    this.retry = retry; this.reopen = reopen; this.onstate = onstate; this.intercept = intercept;
    this.reconnecting = false; this.closing = false;
    this.ready = this.open(url);
  }
  open(url) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => this.receive(e);
    ws.onclose = (e) => this.dropped(ws, e);
    return new Promise((res, rej) => { ws.onopen = () => { this.opened = true; res(); }; ws.onerror = () => rej(new Error('无法连接 ' + url)); });
  }
  receive(e) {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    // numbered broadcasts: a reopened match connection replays what it missed (nothing twice); a replayed message is
    // `age` ms old, so the flow's clocks (bet countdowns, the battle's start) count from when it was really sent
    if (m.seq) { if (m.seq <= this.seq) return; this.seq = m.seq; }
    m._at = performance.now() - (m.age || 0);
    if (m.t === 'pong') { if (Number.isFinite(m.c)) PING.got(m._at - m.c); return; }
    if (m.t === 'emoji') { EMO.receive(m); return; }
    if (this.intercept(m)) return;
    const i = this.waiters.findIndex((w) => w.types.includes(m.t));
    if (i >= 0) this.waiters.splice(i, 1)[0].res(m); else this.q.push(m);
  }
  dropped(ws, e) {
    if (ws !== this.ws) return;
    // reopened only once it has been open (a first connection that fails is the caller's error)
    if (this.closing || !this.retry || !this.opened || [1000, 4001, 4002].includes(e.code)) { this.end(); return; }
    if (this.reconnecting) return;
    this.reconnecting = true; this.onstate('reconnecting');
    const until = performance.now() + this.retry * 1000;
    let pause = 400;
    const attempt = async () => {
      if (this.closing) return;
      const r = this.reopen ? this.reopen(this) : { url: this.url };
      try {
        await this.open(r.url);
        for (const o of [].concat(r.first || [], this.outbox.splice(0))) this.ws.send(JSON.stringify(o));
        this.reconnecting = false; this.onstate('online');
      } catch (err) {
        if (performance.now() + pause > until) { this.reconnecting = false; this.end(); this.onstate('lost'); return; }
        setTimeout(attempt, pause); pause = Math.min(3000, pause * 2);
      }
    };
    setTimeout(attempt, pause);
  }
  end() { this.closed = true; this.outbox.length = 0; for (const w of this.waiters.splice(0)) w.res({ t: 'closed' }); }
  send(o) {
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
    else if (this.reconnecting && KEEP.includes(o.t)) this.outbox.push(o);
  }
  // the next message of one of the types (queued first); { t: 'timeout' } after `ms`, { t: 'closed' } when the link drops
  next(types, ms) {
    types = [].concat(types, 'closed');
    const i = this.q.findIndex((m) => types.includes(m.t));
    if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    if (this.closed) return Promise.resolve({ t: 'closed' });
    return new Promise((res) => {
      const w = { types, res };
      this.waiters.push(w);
      if (ms) setTimeout(() => { const k = this.waiters.indexOf(w); if (k >= 0) { this.waiters.splice(k, 1); res({ t: 'timeout' }); } }, ms);
    });
  }
  // queued messages of a type, without waiting; take: the first one (or null)
  drain(type) { const out = this.q.filter((m) => m.t === type); this.q = this.q.filter((m) => m.t !== type); return out; }
  take(type) { const i = this.q.findIndex((m) => m.t === type); return i >= 0 ? this.q.splice(i, 1)[0] : null; }
  close() { this.closing = true; this.reconnecting = false; try { this.ws.close(); } catch (e) { /* gone */ } this.end(); }
}

// the waiting overlay while a connection is being reopened: the battle page's own pnl_connect (等待自己重新联网...)
const RECONNECT = {
  scr: null, n: 0,
  state(s) {
    if (s === 'reconnecting') {
      if (this.n++ === 0) {
        phase('连接中断，正在重新连接……');
        if (!D.screens.__connect) {
          const find = (n) => (n.name === 'pnl_connect' ? n : (n.children || []).reduce((a, c) => a || find(c), null));
          D.screens.__connect = find(D.screens.enemy_duel_battle_page);
        }
        if (D.screens.__connect) {
          this.scr = new Screen('__connect', { z: 70 });
          // the prefab's soft dark spot, over a light dim of the whole stage; clicks still go through (a bet placed now
          // is sent once the connection is back)
          Object.assign(this.scr.wrap.style, { background: 'rgba(12, 12, 12, .42)', pointerEvents: 'none' });
          playLoops(this.scr);
        }
      }
      return;
    }
    if (this.n > 0 && --this.n === 0 && this.scr) { this.scr.close(); this.scr = null; }
    if (s === 'online') toast('已重新连接');
    else if (s === 'lost') toast('无法重新连接到服务器', 3);
  },
};

// the latency probe: one ping a second to the server in use (the match's instance, else the lobby); the shown value is
// the last round trip, eased a little so it does not flicker
const PING = {
  ms: null, at: 0, timer: 0,
  got(rtt) { this.ms = this.ms == null ? rtt : this.ms * 0.6 + rtt * 0.4; this.at = performance.now(); },
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const link = NET.match && !NET.match.closed ? NET.match : NET.lobby && !NET.lobby.closed ? NET.lobby : null;
      if (link) link.send({ t: 'ping', c: performance.now() });
      if (performance.now() - this.at > 4000) this.ms = null;   // no answer for a while: unknown
    }, 1000);
  },
};
// the latency as the game writes it: "<n>ms" coloured by constData.pingConds (low / medium / high)
function pingText() {
  if (!NET.on) return null;
  if (PING.ms == null) return '<color=#9aa0a0>--ms</color>';
  const n = Math.max(1, Math.round(PING.ms)), conds = (DCFG.consts.pingConds || []).slice().sort((a, b) => b.cond - a.cond);
  const tier = (conds.find((c) => n >= c.cond) || { txt: '<@ping.low>{0}</>ms' }).txt.match(/ping\.(\w+)/);
  const col = { low: '#5fd06b', medium: '#f3c33a', high: '#ff5a4e' }[tier ? tier[1] : 'low'] || '#5fd06b';
  return `<color=${col}>${n}ms</color>`;
}
// keep a text node showing the live latency while its screen lives
function watchPing(scr, suffix, under, wrap = (t) => t, offline = '单机') {
  const tick = () => {
    if (scr.dead) return;
    const t = pingText();
    scr.text(suffix, t == null ? offline : wrap(t), under);
    setTimeout(tick, 500);
  };
  tick();
}

// the lobby connection (after the start click: the viewer's name). Dropped, it is reopened for up to
// consts.maxRetryTimeInTeamRoom seconds and takes its session back (room seat, queue place, a match started meanwhile);
// if the gateway no longer knows the session (restarted, or too late) the page logs in afresh and the current room or
// queue screen ends as if the lobby had closed
async function connectLobby(name) {
  let live = false;
  const hello = () => ({ t: 'hello', name, avatar: myAvatar.value() || undefined });
  NET.lobby = new Link(`ws://${location.host}/lobby`, {
    retry: C.maxRetryTimeInTeamRoom || 45, onstate: (st) => RECONNECT.state(st),
    reopen: (link) => ({ url: link.url, first: { t: 'resume', key: NET.me.key } }),
    intercept: (m) => {
      if (!live) return false;
      if (m.t === 'welcome') { NET.me = m; return true; }
      if (m.t === 'resume.fail') {
        NET.lobby.send(hello());
        toast('大厅会话已失效，已重新登录', 3);
        for (const w of NET.lobby.waiters.splice(0)) w.res({ t: 'closed' });
        return true;
      }
      return false;
    },
  });
  await NET.lobby.ready;
  NET.lobby.send(hello());
  const w = await NET.lobby.next('welcome', 8000);
  if (w.t !== 'welcome') throw new Error('大厅没有响应');
  NET.me = w; live = true;
  ME_NAME = w.name; ME_TAG = w.tag;
  PING.start();
  return w;
}
function serverPlayer(s, you) {
  return { id: s.id, name: s.name, tag: s.tag, avatar: avatarUri(s.avatar), me: s.id === you, npc: s.npc ? {} : null, human: s.human,
    pts: s.pts, out: s.out, outRound: s.outRound, streak: s.streak, stats: s.stats, played: s.played, change: s.change, right: s.right,
    lastForced: s.lastForced, left: s.left, choice: null };
}
function applyServerPlayers(list) {
  for (const s of list) {
    const p = players.find((x) => x.id === s.id);
    if (p) Object.assign(p, { pts: s.pts, out: s.out, outRound: s.outRound, streak: s.streak, stats: s.stats, played: s.played, change: s.change,
      right: s.right, lastForced: s.lastForced, left: s.left });
  }
}
// a seat in a match: connect to its instance, take the seating
// a seat in a match: connect to its instance, take the seating. Dropped, the connection is reopened for up to
// consts.maxRetryTimeInBattle seconds and the instance replays what was missed (since=<last seq>), so the rounds go on
// where they were. The seat is also kept in sessionStorage: a reloaded page comes back to the match (rejoinMatch).
const SEAT_KEY = 'duel.seat';
async function joinMatch(m) {
  if (NET.match) NET.match.close();
  const url = `ws://${location.hostname}:${m.port}/match?m=${encodeURIComponent(m.matchId)}&k=${encodeURIComponent(m.token)}`;
  NET.match = new Link(url, {
    retry: C.maxRetryTimeInBattle || 30, onstate: (st) => RECONNECT.state(st),
    reopen: (link) => ({ url: `${url}&since=${link.seq}` }),
    // the instance greets a reopened connection again: the flow already has the seating
    intercept: (msg) => msg.t === 'hello' && msg.resumed,
  });
  await NET.match.ready;
  const h = await NET.match.next('hello', 8000);
  if (h.t !== 'hello') throw new Error('对战实例没有响应');
  players = h.players.map((s) => serverPlayer(s, h.you));
  me = players.find((p) => p.me);
  G.online = true;
  G.mode = MODES.find((x) => x.id === h.mode) || G.mode;
  G.matchId = m.matchId;
  try { sessionStorage.setItem(SEAT_KEY, JSON.stringify({ port: m.port, matchId: m.matchId, token: m.token })); } catch (e) { /* no storage */ }
  return h;
}
const forgetSeat = () => { try { sessionStorage.removeItem(SEAT_KEY); } catch (e) { /* no storage */ } };
// after a reload: the seat this tab had, if its match still runs. Returns the state to go to ('show' while the match
// is still starting, 'game' for its rounds or its final standings), or null
async function rejoinMatch() {
  let seat = null;
  try { seat = JSON.parse(sessionStorage.getItem(SEAT_KEY) || 'null'); } catch (e) { /* no storage */ }
  if (!seat) return null;
  try {
    const h = await joinMatch(seat);
    toast('已回到比赛');
    return ['wait', 'show', 'loading'].includes(h.phase) ? 'show' : 'game';
  } catch (e) {
    forgetSeat();
    if (NET.match) { NET.match.close(); NET.match = null; }
    return null;
  }
}

// ---- matching: the server's queue (a full table starts at once, else NPCs fill after a wait) ---------------------------
async function stMatchOnline(ctx) {
  phase('匹配中（联机）');
  if (!ctx.prep) { ctx.prep = new Screen('enemy_duel_prepare_page', { z: 6 }); ctx.prep.show('group_default_title', false); ctx.prep.show('panel_mode/group_matching', false); }
  const prep = ctx.prep;
  prep.show('panel_mode/button_match', false); prep.show('panel_mode/bg_button', false);
  const scr = new Screen('enemy_duel_match_state', { z: 8 });
  scr.show('button_match/root_mode_cancel', true); scr.show('button_match/root_mode_succ', false);
  scr.show('text_toggle/text_wait', true); scr.show('text_toggle/text_connecting', false);
  scr.text('num_layout/text_num', '1'); scr.text('num_layout/text_num_max', '8');
  // the two curved arrows close into a ring (in_matching), then the ring turns once a minute (mode_matching_loop)
  scr.play('group_matching', 'in_matching').then(() => { if (!scr.dead) scr.play('group_matching', 'mode_matching_loop', { loop: true }); });
  let cancelled = false;
  const cancel = () => { cancelled = true; NET.lobby.send({ t: 'cancel' }); };
  scr.tap('root_mode_cancel/button_start', cancel); scr.tap('root_top/button_back/hotspot', cancel);
  NET.lobby.drain('matched'); NET.lobby.drain('queue');
  NET.lobby.send({ t: 'queue', mode: G.mode.id });
  const t0 = performance.now();
  let matched = null;
  while (!cancelled && !matched) {
    const m = await NET.lobby.next(['queue', 'matched', 'error'], 400);
    scr.text('root_count/text', `${Math.floor((performance.now() - t0) / 1000)}S`);
    if (m.t === 'queue') {
      scr.text('num_layout/text_num', String(m.n)); scr.text('num_layout/text_num_max', String(m.max));
      scr.show('text_toggle/text_wait', !m.filling); scr.show('text_toggle/text_connecting', m.filling);
      phase(m.filling ? `匹配中（联机）· ${m.n}/${m.max} · 即将由 NPC 补位` : `匹配中（联机）· ${m.n}/${m.max}`);
    } else if (m.t === 'matched') matched = m;
    else if (m.t === 'error') { toast(m.msg, 3); cancelled = true; }
    else if (m.t === 'closed') { toast('与大厅的连接已断开', 3); cancelled = true; }
  }
  if (!matched) { sfx('cancel'); scr.close(); prep.close(); ctx.prep = null; return 'prepare'; }
  scr.text('num_layout/text_num', scr.one('num_layout/text_num_max').txt);
  scr.show('button_match/root_mode_cancel', false); scr.show('button_match/root_mode_succ', true);
  phase('匹配成功');
  sfx('match');
  try { await joinMatch(matched); } catch (e) { toast(e.message, 3); scr.close(); prep.close(); ctx.prep = null; return 'prepare'; }
  await wait(1.0);
  scr.close(); prep.close(); ctx.prep = null;
  return 'show';
}

// ---- 群组 rooms: create, or join with a code; the host switches NPC fill and starts --------------------------------------
async function stRoomOnline(ctx) {
  if (ctx.prep) { ctx.prep.close(); ctx.prep = null; }
  const scr = new Screen('enemy_duel_room_state', { z: 8 });
  for (const s of scr.q('ping')) s.active = false;
  for (const s of scr.q('btnStartBattle')) s.active = false;
  scr.text('root_title/prefix', ''); scr.text('root_title/text_title', G.mode.name);
  scr.text('root_desc/text_desc1', G.mode.desc1); scr.text('root_desc/text_desc2', G.mode.desc2);
  watchPing(scr, 'delay_layout/text_delay', null, (t) => `当前延迟  ${t}`);
  NET.lobby.drain('room');
  if (ctx.joinCode) NET.lobby.send({ t: 'room.join', code: ctx.joinCode }); else NET.lobby.send({ t: 'room.create', mode: G.mode.id });
  const joined = !!ctx.joinCode;
  ctx.joinCode = null;
  playLoops(scr);
  scr.play('duel_room', 'in_room');
  const content = scr.one('scroll_view/viewport/content');
  let room = null, result = null, roomT = DCFG.consts.maxRoomTime || 900;
  const draw = (r) => {
    clearKids(content);
    const host = r.host === NET.me.id;
    r.members.forEach((p, i) => {
      const c = instantiate(scr, content, 'room_player_card');
      scr.show('root_empty', false, c); scr.show('root_wait', false, c); scr.show('root_main', true, c);
      scr.show('text_toggle/text_wait', false, c); scr.show('text_toggle/text_name', true, c);
      scr.text('text_toggle/text_name', (p.id === NET.me.id ? `${p.name}（我）` : p.name) + (p.away ? '（断线中）' : ''), c);
      scr.image('avatar_container/avatar_img', avatarUri(p.avatar), c);
      scr.show('state_host', p.id === r.host, c); scr.show('state_bg_player', p.id === NET.me.id, c);
      scr.one('group_options', c).active = false;
      play(c, 'room_card_join', { delay: i * 0.03 });
      c.rt.amin = [0, 1]; c.rt.amax = [0, 1]; c.rt.pivot = [0, 1]; c.rt.pos = [(i % 4) * (c.rt.size[0] + 10), -Math.floor(i / 4) * (c.rt.size[1] + 10)];
    });
    scr.text('root_roomid/text_id', r.code);
    scr.text('layout_num/text_num', String(r.max));
    scr.text('root_text/text_num1', String(r.members.length)); scr.text('root_text/text_num2', String(r.max));
    scr.show('button_room_host', host); scr.show('button_room_guest', !host);
    const enough = r.members.length >= (DCFG.consts.minRoomNum || 2) || r.npc;
    scr.show('button_room_host/root_host_lack', host && !enough); scr.show('button_room_host/root_host_start', host && enough); scr.show('button_room_host/root_back', false);
    scr.text('root_host_lack/text_start', `至少再邀请\n${Math.max(1, (DCFG.consts.minRoomNum || 2) - r.members.length)}名玩家`);
    scr.show('button_npc/root_normal', !r.npc); scr.show('button_npc/root_select', r.npc);
    phase(`群组房间 ${r.code} · ${r.members.length}/${r.max} 人${r.npc ? ' · NPC 补位' : ''}${host ? '（你是房主）' : '（等待房主开局）'}`);
  };
  scr.tap('button_npc', () => { if (room && room.host === NET.me.id) NET.lobby.send({ t: 'room.npc', on: !room.npc }); else toast('只有房主可以设置 NPC 补位'); });
  scr.tap('root_roomid/button', () => {
    if (!room) return;
    const ok = () => toast(DCFG.constToast ? DCFG.constToast.roomIdCopySuccess : '房间码已复制，快去邀请房客吧');
    navigator.clipboard ? navigator.clipboard.writeText(room.code).then(ok, () => toast('邀请码：' + room.code, 4)) : toast('邀请码：' + room.code, 4);
  });
  scr.tap('button_room_host', () => NET.lobby.send({ t: 'room.start' }));
  scr.tap('panel_top/button_back', () => { result = 'back'; });
  const tick = setInterval(() => { roomT = Math.max(0, roomT - 1); scr.text('time_layout/text_time', mmss(roomT)); }, 1000);
  while (!result) {
    const m = await NET.lobby.next(['room', 'matched', 'error'], 300);
    if (m.t === 'room') { room = m; draw(m); }
    else if (m.t === 'matched') { try { await joinMatch(m); result = 'show'; } catch (e) { toast(e.message, 3); } }
    else if (m.t === 'error') { toast(m.msg, 3); if (!room) result = 'back'; }
    else if (m.t === 'closed') { toast('与大厅的连接已断开', 3); result = 'back'; }
  }
  clearInterval(tick);
  if (result === 'back') NET.lobby.send({ t: 'room.leave' });
  scr.close();
  return result === 'show' ? 'show' : joined ? 'entry' : 'prepare';
}

// ---- the browser's 加入群组: a room code ---------------------------------------------------------------------------------
async function searchDialog() {
  const scr = new Screen('enemy_duel_search_dialog', { z: 60 });
  scr.text('group_top_bar/text_tab_name', DCFG.consts.entryTabText || '争锋频道');
  const field = scr.one('inputField');
  const input = document.createElement('input');
  input.className = 'codein'; input.maxLength = 6; input.inputMode = 'numeric'; input.placeholder = '贴上房间编号邀请码';
  field.el.appendChild(input);
  scr.show('inputField/text_input_tip', false);
  setTimeout(() => input.focus(), 50);
  const r = await new Promise((res) => {
    scr.tap('btn_search/hotspot', () => res('go'));
    scr.tap('hotspot_close_tab', () => res(null)); scr.tap('hotspot_close_main', () => res(null));
    input.onkeydown = (e) => { if (e.key === 'Enter') res('go'); if (e.key === 'Escape') res(null); };
  });
  const code = input.value.trim();
  scr.close();
  if (r !== 'go') return null;
  if (!/^\d{6}$/.test(code)) { toast(code ? DCFG.constToast?.noRoom || '房间不存在或已无法加入' : '未输入房间编号'); return null; }
  return code;
}

// ---- the rounds, as the instance runs them -----------------------------------------------------------------------------
async function stGameOnline() {
  let left = false;
  G.log = []; G.matchOver = false;
  EMO.begin();
  for (;;) {
    const m = await NET.match.next(['round', 'finish']);
    if (m.t !== 'round') { if (m.t === 'finish') { applyServerPlayers(m.players); G.matchOver = true; forgetSeat(); } else toast('与对战实例的连接已断开', 3); break; }
    const rd = DCFG.rounds[m.roundId], r = m.r;
    G.round = r;
    const lineups = m.lineups.map((s) => s.map(([k, n]) => ({ f: byKey(k), n })));
    G.log.push({ r, lineups: lineups.map((x) => x.map((g) => `${g.f.name}×${g.n}`).join(' + ')), cost: lineups.map(sideScore), len: 0 });
    setupRound(lineups, m.seed);
    G.serverResult = null; G.battleAt = 0;
    await betPhase(r, rd, lineups, null, { betMs: m.betMs, at: m._at });
    const w = await battlePhase(r, true);
    const res = G.serverResult;
    if (!res || res.t !== 'result') { if (res && res.t === 'finish') { applyServerPlayers(res.players); G.matchOver = true; forgetSeat(); } break; }
    if (w !== res.w) console.warn('the replay differs from the server', r, w, res.w);
    applyServerPlayers(res.players);
    Object.assign(G.log[G.log.length - 1], { w: res.w, len: arena.W ? arena.W.t : 0 });
    await roundEnd(r, res.w);
    left = await scoreboard(r);
    if (left) { NET.match.send({ t: 'leave' }); forgetSeat(); break; }
  }
  EMO.end();
  G.left = left;
  return 'finish';
}
