// ---- emoji (表情): the top bar's switch and emoji panel, and the barrage of falling emojis -------------------------------
// The official system (the battle prefabs' EnemyDuelEmoticon* components, display_meta_table's emoticon theme): the top
// bar of the bets and the battle carries a switch (已开启 / 已屏蔽: hides the barrage and disables sending) and the
// button that opens the emoji panel — one theme (emticon_duel_basic), its 12 emojis in a 4-column grid. A sent emoji
// falls through the screen in one of 9 lanes: from above the top edge (0.3–0.7 of the width, scale 0.8) to below the
// bottom one (0.05–0.95, scale 1.1) in 3.2 s along the prefab's eased curve, the sender's own on a glow. A lane is
// chosen by a weight that comes back over 15 s after its last emoji. One emoji per consts.chatCd (1 s).
// The barrage layer sits where the battle page's barrage_container does: over the arena, under every state panel.
const EMO = (() => {
  // serialized values of EnemyDuelEmoticonBarrageItem / EnemyDuelEmoticonPageComponent (not part of ui.json)
  const PATH = [[0.3, 1.05, 0, 50, 0.8], [0.7, 1.05, 0, 50, 0.8], [0.05, 0, 0, -70, 1.1], [0.95, 0, 0, -70, 1.1]];   // anchor x, y, pos x, y, scale: top left / right, bottom left / right
  const DURATION = 3.2, LANES = 9, MAX_INTERVAL = 15;
  // AnimationCurve keys: [time, value, inSlope, outSlope, inWeight, outWeight, weightedMode (1 in, 2 out, 3 both)]
  const TWEEN = [[0, 0.0037841796875, 0.2728792726993561, 0.2728792726993561, 0, 1 / 3, 0],
    [0.10223999619483948, 0.03168335556983948, 0.40498578548431396, 0.40498578548431396, 1 / 3, 0.4302518963813782, 3],
    [0.6000925898551941, 0.37336647510528564, 0.9329995512962341, 0.9329995512962341, 1 / 3, 0.5853633880615234, 3],
    [1, 1, 2.0876753330230713, 2.0876753330230713, 0.40037378668785095, 0, 3]];
  const WEIGHT = [[0, 0, 0, 0, 1 / 3, 1 / 3, 0], [0.6000000238418579, 0, 0, 2.500000238418579, 1 / 3, 1 / 3, 0], [1, 1, 2.500000238418579, 1, 1 / 3, 1 / 3, 0]];
  // the theme page's GridLayoutGroup: 4 columns of 93.3 px cells, 7.5 px apart
  const CELL = 93.33334350585938, GAP = 7.5, COLS = 4;
  // a Unity AnimationCurve between two keys is a cubic Bézier in (time, value) with its control points a third of the
  // way along the tangents, or at the keys' own weights: solve for the time, read the value
  function curveAt(keys, t) {
    if (t <= keys[0][0]) return keys[0][1];
    const last = keys[keys.length - 1];
    if (t >= last[0]) return last[1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], dx = b[0] - a[0];
    const wo = a[6] & 2 ? a[5] : 1 / 3, wi = b[6] & 1 ? b[4] : 1 / 3;
    const bz = (p0, p1, p2, p3, s) => { const r = 1 - s; return r * r * r * p0 + 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s * p3; };
    const x1 = a[0] + wo * dx, x2 = b[0] - wi * dx, y1 = a[1] + wo * dx * a[3], y2 = b[1] - wi * dx * b[2];
    let lo = 0, hi = 1;
    for (let k = 0; k < 32; k++) { const m = (lo + hi) / 2; if (bz(a[0], x1, x2, b[0], m) < t) lo = m; else hi = m; }
    return bz(a[1], y1, y2, b[1], (lo + hi) / 2);
  }
  const mix = (p, q, k) => p.map((v, i) => v + (q[i] - v) * k);

  let on = true, layer = null, items = [], lanes = [], clock = 0, cdUntil = 0, bars = [], spawned = 0;
  try { on = localStorage.getItem('duel.barrage') !== '0'; } catch (e) {}
  const ready = () => on && clock >= cdUntil;

  // the barrage layer for a match (its own screen between the arena and the state panels)
  function begin() {
    end();
    if (!D.screens.__barrage) D.screens.__barrage = { name: 'barrage_container', active: true, rt: FULL_RT, comps: {}, children: [] };
    layer = new Screen('__barrage', { z: 19 });
    layer.root.active = on;
    lanes = Array.from({ length: LANES }, () => -Infinity);
  }
  function end() {
    if (layer && !layer.dead) layer.close();
    layer = null; items = []; bars = [];
  }
  // a lane: random by weight among those rested long enough, else the one rested longest
  function lane() {
    const w = lanes.map((at) => curveAt(WEIGHT, clamp((clock - at) / MAX_INTERVAL, 0, 1)));
    const sum = w.reduce((x, y) => x + y, 0);
    let i;
    if (sum > 0) { let r = Math.random() * sum; for (i = 0; i < LANES - 1; i++) { r -= w[i]; if (r < 0 && w[i] > 0) break; } }
    else i = lanes.indexOf(Math.min(...lanes));
    lanes[i] = clock;
    return i;
  }
  function spawn(pic, self) {
    if (!on || !layer || layer.dead || !FXTEX[pic]) return;
    const s = (lane() + 0.15 + 0.7 * Math.random()) / LANES;
    const it = instantiate(layer, layer.root, 'emoji_barrage_item');
    layer.show('bg', self, it);
    setImage(layer.one('emoji_icon', it), FXTEX[pic], 'contain');
    const x = { it, from: mix(PATH[0], PATH[1], s), to: mix(PATH[2], PATH[3], s), t: 0 };
    place(x); items.push(x); spawned++;
  }
  function place(x) {
    const c = mix(x.from, x.to, curveAt(TWEEN, clamp(x.t / DURATION, 0, 1))), rt = x.it.rt;
    rt.amin = [c[0], c[1]]; rt.amax = [c[0], c[1]]; rt.pos = [c[2], c[3]]; rt.scale = [c[4], c[4]];
  }
  function tick(dt) {
    clock += dt;
    for (const x of items) { x.t += dt; place(x); }
    if (items.some((x) => x.t >= DURATION)) items = items.filter((x) => { if (x.t < DURATION) return true; removeNode(x.it); return false; });
    // the emoji button greys out while sending is not possible (switched off, or within the cooldown)
    for (const b of bars) if (b.scr.dead) b.dead = true; else if (b.ready !== ready()) b.refresh();
    if (bars.some((b) => b.dead)) bars = bars.filter((b) => !b.dead);
  }

  // my emoji: shown at once; online the instance relays it to the others
  function send(pic) {
    if (!on) return false;
    // the client's own toast for clicking too fast (constToastData.continuousClicks)
    if (clock < cdUntil) { toast('操作过于频繁，请稍后再试'); return false; }
    cdUntil = clock + (C.chatCd ?? 1);
    spawn(pic, true);
    if (G.online && NET.match) NET.match.send({ t: 'emoji', pic });
    return true;
  }
  // an emoji from the instance (another seat's, or an NPC's); my own echo is already falling
  function receive(m) {
    if (!G.online || (me && m.id === me.id)) return;
    spawn(m.pic, false);
  }
  // offline: an NPC viewer's reaction (npcEmote, shared with the server) after a moment
  function npc(moment, p, right, delay) {
    if (G.online || !p.npc || p.out) return;
    const pic = npcEmote(moment, p.choice, right, Math.random);
    if (pic) wait(delay).then(() => spawn(pic, false));
  }

  // a state screen's top bar (a panel_top_menu instance): the switch, the emoji button, the panel it opens
  function bar(scr, top) {
    const sw = scr.one('group_emoji/btn_emoji_switch', top), sel = scr.one('group_emoji/btn_emoji_select', top);
    if (!sw || !sel) return;
    // the button shows the default emoticon (consts.defaultEmoticonPicId)
    setImage(scr.one('state_on/container_emoji/img_emoji', sel), FXTEX[C.defaultEmoticonPicId] || FXTEX.pic_hello, 'contain');
    const b = { scr, ready: null, refresh: () => { b.ready = ready(); scr.show('state_on', b.ready, sel); scr.show('state_off', !b.ready, sel); } };
    b.refresh(); bars.push(b);
    // the switch's clip runs on → off; played back to show "on"
    play(sw, 'battle_ui_emoji_switch', { reverse: on, rate: 100 });
    let panel = null, open = false;
    const show = (want) => {
      if (want === open || (want && !on)) return;
      open = want;
      if (!panel) panel = buildPanel(scr, (pic) => { if (send(pic)) wait(0.3).then(() => show(false)); }, () => show(false));
      panel.active = true;
      play(panel, 'battle_ui_emoji_select_panel', { reverse: !want }).then(() => { if (!open && panel) panel.active = false; });
    };
    scr.tap('btn_emoji_select/hotspot', () => show(!open), top);
    scr.tap('btn_emoji_switch/hotspot', () => {
      on = !on;
      try { localStorage.setItem('duel.barrage', on ? '1' : '0'); } catch (e) {}
      play(sw, 'battle_ui_emoji_switch', { reverse: on });
      if (layer) layer.root.active = on;
      if (!on) { for (const x of items) removeNode(x.it); items = []; show(false); }
    }, top);
  }
  function buildPanel(scr, pick, close) {
    const panel = instantiate(scr, scr.root, 'panel_emoji');
    panel.active = false;
    const content = scr.one('scroll_pager/viewport/content', panel), page = content && instantiate(scr, content, 'emoji_theme_item');
    if (page) {
      EMOJI_PICS.forEach((pic, i) => {
        const it = instantiate(scr, page, 'emoji_item');
        it.rt = { amin: [0, 1], amax: [0, 1], pivot: [0.5, 0.5], size: [CELL, CELL], scale: [1, 1], rotz: 0,
          pos: [(i % COLS) * (CELL + GAP) + CELL / 2, -(Math.floor(i / COLS) * (CELL + GAP) + CELL / 2)] };
        scr.show('panel_empty', false, it);
        setImage(scr.one('emoji_icon', it), FXTEX[pic], 'contain');
        scr.tap('panel_content/hotspot', () => { play(it, 'emoji_click_anim'); pick(pic); }, it);
      });
    }
    // the panel's full-screen backdrop (btn_raycast, switched on by the opening clip): a tap outside closes it
    scr.tap('btn_raycast', close, panel);
    return panel;
  }
  return { begin, end, tick, bar, send, receive, npc, get on() { return on; }, get count() { return items.length; }, get spawned() { return spawned; } };
})();
