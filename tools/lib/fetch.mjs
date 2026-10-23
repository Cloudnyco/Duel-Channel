// A cached downloader for the data tools: files from the public GitHub repositories the game data and models come from,
// kept under .cache/sources/<owner>/<repo>/<path> (a second run reads the disk). raw.githubusercontent.com first, then
// the jsDelivr mirror of the same commit-ish; a few attempts each; a bounded number of downloads at once.
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = join(ROOT, '.cache', 'sources');

// a repository on GitHub: { owner, repo, ref }; or a site's files under one base URL: { owner, repo, base } (owner and
// repo only name its cache folder)
export const REPOS = {
  gamedata: { owner: 'Kengxxiao', repo: 'ArknightsGameData', ref: 'master' },
  models: { owner: 'isHarryh', repo: 'Ark-Models', ref: 'main' },
  icons: { owner: 'yuanyan3060', repo: 'ArknightsGameResource', ref: 'main' },
  // PRTS's own copies of the enemies' Spine models, for the originals Ark-Models only names
  prts: { owner: 'prts', repo: 'torappu', base: 'https://torappu.prts.wiki/assets/' },
};
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const urlsOf = (r, path) => (r.base ? [`${r.base}${enc(path)}`] : [
  `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.ref}/${enc(path)}`,
  `https://cdn.jsdelivr.net/gh/${r.owner}/${r.repo}@${r.ref}/${enc(path)}`,
]);
const HEADERS = { 'User-Agent': 'Duel-Channel data tools (https://github.com/Cloudnyco/Duel-Channel)' };

let active = 0;
const waiting = [];
const LIMIT = 12;
async function slot(fn) {
  if (active >= LIMIT) await new Promise((res) => waiting.push(res));
  active++;
  try { return await fn(); } finally { active--; const next = waiting.shift(); if (next) next(); }
}

/**
 * A repository file's bytes, from the cache or downloaded into it.
 * @param {{owner:string,repo:string,ref?:string,base?:string}} r the repository, or a site's base URL
 * @param {string} path its path in the repository
 * @param {{optional?: boolean}} [o] optional: a file the repository does not have resolves to null instead of failing
 * @returns {Promise<Buffer|null>}
 */
export async function getFile(r, path, o = {}) {
  const local = join(CACHE, r.owner, r.repo, ...path.split('/'));
  if (existsSync(local) && statSync(local).size > 0) return readFileSync(local);
  return slot(async () => {
    let last = null;
    for (const url of urlsOf(r, path)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(90000) });
          if (res.status === 404) { last = new Error(`404 ${url}`); break; }
          if (!res.ok) throw new Error(`${res.status} ${url}`);
          const buf = Buffer.from(await res.arrayBuffer());
          mkdirSync(dirname(local), { recursive: true });
          writeFileSync(local, buf);
          return buf;
        } catch (e) { last = e; await new Promise((res) => setTimeout(res, 600 * (attempt + 1))); }
      }
    }
    if (o.optional) return null;
    throw new Error(`could not fetch ${r.owner}/${r.repo}/${path}: ${last && last.message}`);
  });
}
export const getJson = async (r, path) => JSON.parse((await getFile(r, path)).toString('utf8'));
