// ---- error reports ------------------------------------------------------------------------------------------------
// Every error the page does not handle itself (a throw in a handler, a rejected promise, the flow breaking down) is
// caught here with a trail of what led to it: the flow's phases, toasts, connection changes, console warnings. A
// fatal one (the flow stopped) opens the report panel; any other leaves a notice and a dot on the gear, and the game
// goes on. The panel (also 设置 → 反馈问题) holds a report the viewer can read before it leaves the page: the build,
// the browser and GPU, the match's state, every round's line-ups and seed (enough to replay its battle), the errors
// and the trail; no account, no file path. It can be copied, opened as a prefilled GitHub issue, or (online) sent to
// the server's host, who finds it under logs/reports/.
const REPORT = (() => {
  const t0 = performance.now(), trail = [], errors = [];
  let unseen = false, kind = 'manual';
  const at = () => ((performance.now() - t0) / 1000).toFixed(1);
  const text = (v) => (v instanceof Error ? `${v.name}: ${v.message}` : typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })());
  function note(tag, v) {
    trail.push(`${at().padStart(7)}s  ${tag.padEnd(7)} ${text(v).replace(/\s+/g, ' ').slice(0, 300)}`);
    if (trail.length > 150) trail.shift();
  }
  // console warnings and errors join the trail (and are printed as before)
  for (const k of ['warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { note(k, a.map(text).join(' ')); orig(...a); };
  }
  function caught(err, where, fatal = false) {
    const e = err instanceof Error ? err : new Error(text(err));
    // the same failure over and over (a broken frame loop) is kept once
    if (errors.length && errors[errors.length - 1].msg === text(e)) { errors[errors.length - 1].n++; return; }
    errors.push({ at: at(), where, msg: text(e), stack: String(e.stack || '').split('\n').slice(1, 9).map((l) => l.trim()).join('\n'), fatal, n: 1 });
    if (errors.length > 20) errors.shift();
    note('ERROR', `${where}: ${text(e)}`);
    if (fatal) open('fatal');
    else notify();
  }
  addEventListener('error', (e) => { if (e.error || e.message) caught(e.error || e.message, 'page'); });
  addEventListener('unhandledrejection', (e) => caught(e.reason, 'promise'));

  // ---- what the report says ----
  function gpu() {
    try {
      const gl = arenaApp && arenaApp.renderer && arenaApp.renderer.gl, ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : '无 WebGL';
    } catch (e) { return '未知'; }
  }
  // anything the report reads may not exist yet (an error during start-up): each part falls back to '?'
  const v = (f, d = '?') => { try { const r = f(); return r === undefined ? d : r; } catch (e) { return d; } };
  function build(desc = '') {
    const b = typeof BUILD !== 'undefined' ? BUILD : {}, online = v(() => NET.on, false);
    const ua = navigator.userAgent, where = online ? `联机（${location.host}）` : location.protocol === 'file:' ? '单机（本地文件）' : `单机（${location.host}）`;
    const lines = [
      `- 版本：${b.version || '?'}（${b.commit || '?'}，构建于 ${b.date || '?'}）`,
      `- 页面：${where}`,
      `- 浏览器：${ua}`,
      `- 显卡：${gpu()}`,
      `- 窗口：${innerWidth}×${innerHeight}，像素比 ${devicePixelRatio || 1}，语言 ${navigator.language}`,
      `- 运行：${at()} 秒，整体速度 ×${v(() => CLOCK.scale)}`,
      `- 赛事：${v(() => G.mode.name)}，第 ${v(() => G.round || 0)} 轮，阶段「${v(() => $('phase').textContent, '')}」`,
    ];
    if (online) {
      const link = (l) => (!l ? '无' : l.closed ? '已关闭' : l.reconnecting ? '重连中' : '在线');
      lines.push(v(() => `- 联机：大厅 ${link(NET.lobby)}，比赛 ${link(NET.match)}${G.matchId ? `（${G.matchId}，座位 ${me ? me.id : '?'}，seq ${NET.match ? NET.match.seq : 0}）` : ''}，延迟 ${PING.ms == null ? '?' : Math.round(PING.ms) + 'ms'}`, '- 联机：?'));
    }
    const mine = v(() => me, null);
    if (mine) lines.push(`- 我：${mine.pts} 礼物${mine.out ? '（已淘汰）' : ''}，本轮${mine.choice ? (mine.choice.skip ? '观望' : `${mine.choice.kind === 'all' ? '全力' : ''}支持${mine.choice.side ? '右' : '左'}队`) : '未选择'}`);
    const out = ['### 争锋频道 错误报告', '', ...(desc ? ['**描述**', '', desc, ''] : []), ...lines, ''];
    if (errors.length) {
      out.push('**错误**', '```');
      for (const e of errors) out.push(`[${e.at}s] ${e.fatal ? '致命 · ' : ''}${e.where}: ${e.msg}${e.n > 1 ? `（×${e.n}）` : ''}`, ...(e.stack ? [e.stack] : []), '');
      out.push('```');
    }
    const rounds = v(() => G.log, []);
    if (rounds.length) {
      out.push('**回合记录**（阵容与种子，可重放战斗）', '```');
      for (const r of rounds) {
        out.push(`第 ${r.r} 轮  种子 ${r.seed ?? '?'}  ${r.lineups.join('  VS  ')}${r.w !== undefined ? `  → ${r.w === 'draw' ? '平局' : r.w ? '右胜' : '左胜'}` : ''}`);
        // the field's traps (makeTraps): key, the level's column and row, the direction
        if (r.traps && r.traps.length) out.push(`  装置 ${JSON.stringify(r.traps)}`);
      }
      out.push('```');
    }
    out.push('**最近的记录**', '```', ...trail.slice(-60), '```');
    return out.join('\n');
  }

  // ---- the panel ----
  const ISSUES = 'https://github.com/Cloudnyco/Duel-Channel/issues/new';
  function issueUrl(desc, report) {
    // a GitHub issue form takes its fields from the query; the address has to stay short, so the trail is cut there
    // (the copied report is whole)
    const env = report.split('\n').filter((l) => l.startsWith('- ')).join('\n');
    const errs = errors.slice(-3).map((e) => `[${e.at}s] ${e.where}: ${e.msg}\n${e.stack}`).join('\n\n');
    const where = !v(() => NET.on, false) ? '单机（直接打开 duel-flow.html）' : v(() => G.matchId && NET.match && !NET.match.closed, false) ? '联机：对局中' : '联机：匹配 / 群组房间';
    const q = new URLSearchParams({
      template: 'bug_report.yml', title: `[报错] ${errors.length ? errors[errors.length - 1].msg.slice(0, 60) : (desc || '').slice(0, 60) || '问题反馈'}`,
      where, 'what-happened': desc || (errors.length ? '页面报错（见日志）。' : ''), env,
      logs: `${errs}\n\n${trail.slice(-25).join('\n')}`.slice(0, 3500),
    });
    return `${ISSUES}?${q}`;
  }
  function open(as) {
    kind = as;
    const box = $('report'), desc = $('rpDesc');
    $('rpTitle').textContent = as === 'fatal' ? '出错了：游戏无法继续' : as === 'notice' ? '发生了一个错误' : '反馈问题';
    const last = errors[errors.length - 1];
    $('rpMsg').textContent = as === 'manual' ? '说说遇到了什么，报告会附上版本、浏览器和当前对局的状态。'
      : `${last ? last.msg : ''}${as === 'fatal' ? '\n可以刷新页面重新开始；联机对局中刷新会回到比赛。' : '\n游戏可以继续；如果反复出现，请把报告发给我们。'}`;
    $('rpReload').hidden = as !== 'fatal';
    $('rpClose').hidden = as === 'fatal';
    $('rpSend').hidden = !v(() => NET.on, false);
    $('rpStatus').textContent = '';
    refresh();
    box.hidden = false;
    unseen = false; $('gear').classList.remove('alert');
    if (typeof settings !== 'undefined' && settings.open) settings.toggle(false);
    setTimeout(() => (as === 'fatal' ? $('rpCopy') : desc).focus(), 50);
  }
  function refresh() { $('rpBody').textContent = build($('rpDesc').value.trim()); }
  function close() { if (kind === 'fatal') return; $('report').hidden = true; $('gear').focus(); }
  function notify() {
    if ($('report') && !$('report').hidden) { refresh(); return; }
    unseen = true; $('gear').classList.add('alert');
    const n = $('rpNotice');
    n.hidden = false; clearTimeout(notify.h); notify.h = setTimeout(() => { n.hidden = true; }, 9000);
  }
  function status(t) { $('rpStatus').textContent = t; }
  function init() {
    $('rpDesc').oninput = () => refresh();
    $('rpCopy').onclick = () => {
      const t = build($('rpDesc').value.trim());
      const done = () => status('已复制。可以粘贴到 GitHub Issue 或发给开服的朋友。');
      const fallback = () => { const r = document.createRange(); r.selectNodeContents($('rpBody')); getSelection().removeAllRanges(); getSelection().addRange(r); status('复制失败：报告已选中，按 Ctrl+C 复制。'); };
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, fallback); else fallback();
    };
    $('rpIssue').onclick = () => {
      const desc = $('rpDesc').value.trim();
      window.open(issueUrl(desc, build(desc)), '_blank', 'noopener');
      status('已在新标签页打开 GitHub；表单里的日志较短，完整报告可以「复制报告」后补充。');
    };
    $('rpSend').onclick = async () => {
      const btn = $('rpSend');
      btn.disabled = true; status('发送中……');
      try {
        const r = await fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: build($('rpDesc').value.trim()), name: v(() => NET.me.name, '') }) });
        const o = await r.json().catch(() => ({}));
        status(r.ok ? `已发送给服务器主机（编号 ${o.id}）。` : `发送失败：${o.error || r.status}`);
      } catch (e) { status('发送失败：' + e.message); }
      btn.disabled = false;
    };
    $('rpReload').onclick = () => location.reload();
    $('feedback').onclick = () => open('manual');
    if (typeof BUILD !== 'undefined') $('buildTag').textContent = `v${BUILD.version} · ${BUILD.commit}`;
    $('rpClose').onclick = close;
    $('rpNotice').onclick = () => { $('rpNotice').hidden = true; open('notice'); };
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('report').hidden) close(); });
  }
  return { note, caught, open, init, fatal: (e) => caught(e, 'flow', true), get errors() { return errors; }, get trail() { return trail; }, build };
})();
