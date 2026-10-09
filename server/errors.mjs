// Server-side error records, shared by the gateway and the battle instances: every error worth a look (a match that
// broke, an exception nothing caught, a rejected promise) is printed, appended to logs/server-errors.log and kept in
// a short list for GET /status. An exception nothing caught leaves the process in an unknown state: it is recorded and
// the process exits, and launch.mjs starts it again. Also where the players' error reports are written
// (logs/reports/, see the gateway's POST /report).
// env: DUEL_LOGS (the logs folder, default ../logs)
import { appendFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOGS = process.env.DUEL_LOGS || fileURLToPath(new URL('../logs', import.meta.url));
const recent = [];

export function recordError(who, where, err) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(1, 8).join('\n') : '';
  const at = new Date().toISOString();
  recent.push({ at, where, msg });
  if (recent.length > 20) recent.shift();
  console.error(`[${who}] ${where}: ${msg}${stack ? '\n' + stack : ''}`);
  try { mkdirSync(LOGS, { recursive: true }); appendFileSync(join(LOGS, 'server-errors.log'), `${at} [${who}] ${where}: ${msg}\n${stack ? stack + '\n' : ''}\n`); } catch (e) { /* no log folder: the console has it */ }
}
export const recentErrors = () => recent.slice();

export function installCrashLog(who) {
  process.on('uncaughtException', (err) => { recordError(who, 'uncaught exception (restarting)', err); process.exit(1); });
  process.on('unhandledRejection', (err) => recordError(who, 'unhandled rejection', err));
}

// a player's report: one Markdown file per report, named by time and a running number
let reportSeq = 0;
export function saveReport(text, meta) {
  const dir = join(LOGS, 'reports');
  mkdirSync(dir, { recursive: true });
  if (!reportSeq) reportSeq = readdirSync(dir).filter((f) => f.endsWith('.md')).length;
  const id = ++reportSeq, stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const head = `<!-- report ${id} · ${new Date().toISOString()} · from ${meta.from} · name ${meta.name || '?'} -->\n\n`;
  writeFileSync(join(dir, `${stamp}-${String(id).padStart(4, '0')}.md`), head + text + '\n');
  return id;
}
export function reportCount() {
  try { return readdirSync(join(LOGS, 'reports')).filter((f) => f.endsWith('.md')).length; } catch (e) { return 0; }
}
