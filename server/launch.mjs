// Starts the gateway and N battle instances as child processes (one log stream, Ctrl+C stops all). A child that exits
// on its own (an exception nothing caught: errors.mjs records it) is started again after 1, 2, 4… s (at most 30 s);
// after 5 exits within a minute it is left down and the log says so.
// usage: node server/launch.mjs [--instances 3] [--port 8600] [--host 127.0.0.1]
import { fork } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--instances', 3)), PORT = Number(arg('--port', 8600)), HOST = arg('--host', '127.0.0.1');
const ports = Array.from({ length: N }, (_, i) => PORT + 11 + i);
const kids = new Set(), exits = new Map();
let stopping = false;
const start = (file, env) => {
  const c = fork(new URL(file, import.meta.url), [], { env: { ...process.env, HOST, ...env } });
  kids.add(c);
  c.on('exit', (code, sig) => {
    kids.delete(c);
    if (stopping) return;
    const name = `${file.replace(/^\.\/|\.mjs$/g, '')} :${env.PORT}`, now = Date.now();
    const recent = (exits.get(name) || []).filter((t) => now - t < 60000).concat(now);
    exits.set(name, recent);
    if (recent.length > 5) { console.log(`[launch] ${name} exited (${code ?? sig}) ${recent.length} times within a minute — left down; see logs/server-errors.log`); return; }
    const wait = Math.min(30, 2 ** (recent.length - 1));
    console.log(`[launch] ${name} exited (${code ?? sig}); starting it again in ${wait} s`);
    setTimeout(() => { if (!stopping) start(file, env); }, wait * 1000);
  });
};
for (const p of ports) start('./instance.mjs', { PORT: String(p), NAME: `instance-${p}` });
start('./gateway.mjs', { PORT: String(PORT), INSTANCES: ports.join(',') });
console.log(`[launch] gateway :${PORT}, instances ${ports.join(', ')} — open http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}/`);
const stop = () => { stopping = true; for (const c of kids) c.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
