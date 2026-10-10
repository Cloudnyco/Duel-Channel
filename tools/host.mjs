// One-step hosting, behind start.cmd (Windows) and start.sh (Linux / macOS): installs the dependencies when they are
// missing, checks the asset pack, builds the page when it is missing or older than anything it is built from, asks
// whether players on the local network may join, starts the gateway and its battle instances, prints the addresses to
// share (and the port a firewall must let through), and opens the page in the browser.
// usage: node tools/host.mjs [--lan | --local] [--port 8600] [--instances 3] [--rebuild] [--no-open] [--dry-run]
//   --lan / --local   listen on every network interface / on this machine only (default: ask; non-interactive: local)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { networkInterfaces, platform } from 'node:os';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), has = (k) => argv.includes(k);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(opt('--port', 8600)), N = Number(opt('--instances', 3));
const WIN = platform() === 'win32', TTY = process.stdin.isTTY && process.stdout.isTTY;
const say = (s = '') => console.log(s);
const fail = (s) => { console.error('\n✗ ' + s); process.exit(1); };
const node = (args, o = {}) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', ...o });

// 1. Node.js
if (Number(process.versions.node.split('.')[0]) < 22) fail(`需要 Node.js 22 或更新的版本（当前 ${process.version}）：https://nodejs.org/`);

// 2. dependencies
if (!['ws', 'pixi.js', 'pixi-spine'].every((m) => existsSync(join(ROOT, 'node_modules', m, 'package.json')))) {
  say('安装依赖（npm ci）……');
  // npm is a .cmd script on Windows, which only a shell runs
  const r = spawnSync(WIN ? 'npm ci --no-audit --no-fund' : 'npm', WIN ? [] : ['ci', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) fail('依赖安装失败：检查网络后重试，或手动运行 npm ci');
}

// 3. the page: rebuilt when missing or older than its inputs (the code, the data, the asset pack, the renderers)
const PAGE = join(ROOT, 'public', 'index.html');
const newest = (p) => {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(p).reduce((m, f) => Math.max(m, newest(join(p, f))), 0);
};
const inputs = ['web', 'shared', 'data', 'assets', 'tools/build-page.mjs', 'node_modules/pixi.js/package.json', 'node_modules/pixi-spine/package.json'];
const built = existsSync(PAGE) ? statSync(PAGE).mtimeMs : 0;
const assetsOk = node(['tools/build-page.mjs', '--check'], { stdio: 'pipe' }).status === 0;
if (!assetsOk) {
  if (!built) {
    node(['tools/build-page.mjs', '--check']);
    fail('素材包不完整（见上方缺少的文件），无法构建页面：素材包在仓库的 assets/ 里，用 git checkout -- assets 恢复，或重新 clone（docs/ASSETS.md）。\n  只是想加入朋友开的服务器？不需要素材包，用浏览器打开对方给你的地址即可。');
  }
  say('⚠ 素材包不完整，使用已构建的页面（无法重新构建）。');
} else if (has('--rebuild') || !built || inputs.some((p) => newest(join(ROOT, p)) > built)) {
  say(built ? '页面有更新，重新构建……' : '构建页面……');
  if (node(['tools/build-page.mjs']).status !== 0) fail('页面构建失败（见上方输出）');
}

// 4. who may connect
let lan = has('--lan') ? true : has('--local') ? false : null;
if (lan === null && TTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  say('\n要让局域网（或 Tailscale、ZeroTier、Radmin VPN 这类虚拟局域网）里的朋友加入吗？');
  say('  会监听所有网卡。页面内嵌游戏素材，只在你信任的网络里开放，不要暴露到公网。');
  lan = /^y(es)?$|^是$/i.test((await rl.question('  [y/N] ')).trim());
  rl.close();
}
lan = !!lan;

// 5. the server, on ports nothing else holds (another copy already running is the usual case); the instances listen on
// this machine only, players reach them through the gateway
const ports = Array.from({ length: N }, (_, i) => PORT + 11 + i);
const free = (port, host) => new Promise((res) => {
  const s = createServer().once('error', () => res(false));
  s.listen(port, host, () => s.close(() => res(true)));
});
for (const p of [PORT, ...ports]) {
  if (!(await free(p, lan && p === PORT ? '0.0.0.0' : '127.0.0.1'))) fail(`端口 ${p} 已被占用（可能已经开着一个服务器：试试打开 http://127.0.0.1:${PORT}/）。\n  换一组端口：加 --port ${PORT + 100}（对战实例随之用 ${PORT + 111} 起的端口）`);
}
// --dry-run (CI): everything up to here — dependencies, the page, the ports — without starting the server
if (has('--dry-run')) { say(`就绪：页面已构建，端口 ${PORT}、${ports.join('、')} 可用（--dry-run，未启动服务器）`); process.exit(0); }
const child = spawn(process.execPath, ['server/launch.mjs', '--instances', String(N), '--port', String(PORT), ...(lan ? ['--host', '0.0.0.0'] : [])], { cwd: ROOT, stdio: 'inherit' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));

// 6. once the gateway answers: the addresses, the firewall, the browser
const local = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(local + 'healthz', { signal: AbortSignal.timeout(500) })).ok) break; } catch (e) { /* not yet */ }
  await new Promise((r) => setTimeout(r, 150));
}
const kind = (name, ip) => (/tailscale/i.test(name) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) ? 'Tailscale' : /^(zt|zerotier)/i.test(name) || /zerotier/i.test(name) ? 'ZeroTier' : name);
// IPv4 addresses others can reach: not loopback, not link-local (169.254/16), not a proxy client's TUN (198.18/15)
const reachable = (a) => a.family === 'IPv4' && !a.internal && !/^169\.254\.|^198\.1[89]\./.test(a.address);
const addrs = lan ? Object.entries(networkInterfaces()).flatMap(([name, list]) => (list || []).filter(reachable).map((a) => [kind(name, a.address), a.address])) : [];
say('\n────────────────────────────────────────────────────────────');
say('争锋频道已启动');
say(`  本机打开：${local}`);
if (lan) {
  if (addrs.length) for (const [name, ip] of addrs) say(`  朋友打开：http://${ip}:${PORT}/   （${name}）`);
  else say('  没有找到可用的局域网地址：检查网络连接，或先连上 Tailscale / ZeroTier');
  say(`  防火墙需放行 TCP ${PORT}（对局连接也经过这个端口）`);
  if (WIN) say('  首次启动时 Windows 会询问是否允许 Node.js 访问网络：勾选「专用网络」');
  else say(`  Linux 上若启用了防火墙：sudo ufw allow ${PORT}/tcp（或 firewall-cmd --add-port=${PORT}/tcp）`);
} else say('  只有这台电脑能连接；要和朋友联机，重新运行并选 y（或加 --lan）');
say('  按 Ctrl+C 停止');
say('────────────────────────────────────────────────────────────\n');
// the browser, on a desktop
if (!has('--no-open') && TTY) {
  const [cmd, args] = WIN ? ['cmd', ['/c', 'start', '', local]] : platform() === 'darwin' ? ['open', [local]] : ['xdg-open', [local]];
  if (WIN || platform() === 'darwin' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch (e) { /* no browser */ }
  }
}
