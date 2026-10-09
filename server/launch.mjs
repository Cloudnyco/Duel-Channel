// Starts the gateway and N battle instances as child processes (one log stream, Ctrl+C stops all).
// usage: node server/launch.mjs [--instances 3] [--port 8600] [--host 127.0.0.1]
import { fork } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--instances', 3)), PORT = Number(arg('--port', 8600)), HOST = arg('--host', '127.0.0.1');
const ports = Array.from({ length: N }, (_, i) => PORT + 11 + i);
const kids = [];
const start = (file, env) => {
  const c = fork(new URL(file, import.meta.url), [], { env: { ...process.env, HOST, ...env } });
  c.on('exit', (code) => console.log(`[launch] ${file} ${env.PORT} exited (${code})`));
  kids.push(c);
};
for (const p of ports) start('./instance.mjs', { PORT: String(p), NAME: `instance-${p}` });
start('./gateway.mjs', { PORT: String(PORT), INSTANCES: ports.join(',') });
console.log(`[launch] gateway :${PORT}, instances ${ports.join(', ')} — open http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`);
const stop = () => { for (const c of kids) c.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
