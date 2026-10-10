// ---- the served page's loader --------------------------------------------------------------------------------------
// Served by the gateway, the page carries only the code; the game's assets come as one pack file named after its
// content (PACK_INFO.url, pack/duel-pack.<hash>.json), which browsers may keep for good: a second visit, or a visit
// after a code update, does not download it again. While it downloads, the start slate shows with its loading
// placeholders filling in; then the game starts (duelMain). The single-file page inlines the pack instead.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), start = $('start'), status = $('startStatus'), go = $('go');
  const skel = document.querySelector('#start .sb-skel'), bars = skel ? [...skel.querySelectorAll('b')] : [];
  // the stage scaled into the window, as the game's own fit() does once it runs
  const fit = () => {
    const k = Math.min(innerWidth / 1280, innerHeight / 720);
    stage.style.transform = `scale(${k})`;
    stage.style.left = (innerWidth - 1280 * k) / 2 + 'px'; stage.style.top = (innerHeight - 720 * k) / 2 + 'px';
  };
  fit();
  addEventListener('resize', fit);
  const idle = status.textContent;
  // served means online (the game says the same once it runs)
  $('startMode').textContent = `联机模式：频道服务器 ${location.host}`;
  start.hidden = false;
  go.setAttribute('aria-busy', 'true'); status.setAttribute('aria-busy', 'true');
  if (skel) skel.classList.add('loading');
  const mb = (n) => (n / 1048576).toFixed(1);
  let shown = -1;
  const progress = (got) => {
    const p = Math.min(1, got / PACK_INFO.size), pct = Math.floor(p * 100);
    bars.forEach((b, i) => b.style.setProperty('--fill', Math.round(Math.max(0, Math.min(1, p * bars.length - i)) * 100) + '%'));
    if (pct === shown) return;
    shown = pct;
    status.textContent = `正在载入素材包 ${pct}%\n${mb(got)} / ${mb(PACK_INFO.size)} MB`;
  };
  // the body arrives decoded (the gateway may send it brotli or gzip compressed): progress counts the decoded bytes
  // against the pack's size, which the build wrote into this page
  async function load() {
    const res = await fetch(PACK_INFO.url);
    if (!res.ok) throw new Error(`服务器返回 ${res.status}`);
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; progress(got);
    }
    const all = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return JSON.parse(new TextDecoder().decode(all));
  }
  progress(0);
  load().then((pack) => {
    globalThis.DUEL = pack.ui; globalThis.FIGHTERS = pack.fighters; globalThis.AUDIO = pack.audio; globalThis.FXTEX = pack.fx; globalThis.TRAP_MESH = pack.traps || {};
    // the enemy models: fetched one by one when a battle needs them (arena.js loadFighter)
    globalThis.MODEL_FILES = pack.models || {};
    removeEventListener('resize', fit);
    if (skel) { skel.classList.remove('loading'); bars.forEach((b) => b.style.removeProperty('--fill')); }
    status.removeAttribute('aria-busy'); go.removeAttribute('aria-busy');
    status.textContent = idle;
    duelMain();
  }, (e) => {
    status.removeAttribute('aria-busy');
    status.textContent = `素材包载入失败：${e.message}\n请检查网络后刷新页面`;
  });
})();
