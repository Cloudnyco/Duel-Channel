// The gateway's page files, with a stand-in build in a temp folder (no assets needed): the shell and the pack go out in
// the encoding the browser takes (brotli / gzip copies, the plain file otherwise or when a copy is stale), with ETags
// and 304s; the pack, named after its content, is cacheable for good; nothing outside the build's names is served; a
// build from before the split (duel-flow.html only) still works; no build at all gives 503.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';

const free = () => new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const get = (port, path, headers = {}, method = 'GET') => new Promise((res, rej) => {
  const r = request({ host: '127.0.0.1', port, path, method, headers }, (m) => { const b = []; m.on('data', (c) => b.push(c)); m.on('end', () => res({ status: m.statusCode, h: m.headers, body: Buffer.concat(b) })); });
  r.on('error', rej); r.end();
});
async function gateway(dir) {
  const port = await free(), ip = await free();
  const p = spawn(process.execPath, [fileURLToPath(new URL('../server/gateway.mjs', import.meta.url))], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', INSTANCES: String(ip), DUEL_PUBLIC: dir }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { await get(port, '/healthz'); return { port, stop: () => p.kill() }; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  p.kill(); throw new Error('gateway did not start');
}
const files = (dir, name, text) => {
  const buf = Buffer.from(text);
  writeFileSync(join(dir, name), buf); writeFileSync(join(dir, name + '.br'), brotliCompressSync(buf)); writeFileSync(join(dir, name + '.gz'), gzipSync(buf));
};

test('the served page: encodings, validators, the immutable pack, only the build\'s names', { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'duel-pub-'));
  mkdirSync(join(dir, 'pack'));
  const shell = '<!doctype html><p>shell</p>', pack = JSON.stringify({ v: 1, ui: { screens: {} }, filler: 'x'.repeat(5000) });
  files(dir, 'index.html', shell);
  files(join(dir, 'pack'), 'duel-pack.0123456789abcdef.json', pack);
  const gw = await gateway(dir);
  try {
    // brotli when offered; the ETag names the representation; the same ETag back gives 304
    let r = await get(gw.port, '/', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(r.status, 200); assert.equal(r.h['content-encoding'], 'br'); assert.equal(r.h['cache-control'], 'no-cache');
    assert.equal(brotliDecompressSync(r.body).toString(), shell); assert.match(r.h.etag, /-br"$/); assert.equal(r.h.vary, 'Accept-Encoding');
    const again = await get(gw.port, '/', { 'Accept-Encoding': 'br', 'If-None-Match': r.h.etag });
    assert.equal(again.status, 304); assert.equal(again.body.length, 0);
    // nothing offered: the plain file
    r = await get(gw.port, '/index.html');
    assert.equal(r.status, 200); assert.equal(r.h['content-encoding'], undefined); assert.equal(r.body.toString(), shell);
    assert.equal(Number(r.h['content-length']), Buffer.byteLength(shell));
    // the pack: gzip, cacheable for a year, immutable; HEAD has the headers only
    r = await get(gw.port, '/pack/duel-pack.0123456789abcdef.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(r.status, 200); assert.equal(r.h['content-encoding'], 'gzip'); assert.match(r.h['cache-control'], /immutable/);
    assert.match(r.h['content-type'], /^application\/json/);
    r = await get(gw.port, '/pack/duel-pack.0123456789abcdef.json', {}, 'HEAD');
    assert.equal(r.status, 200); assert.equal(Number(r.h['content-length']), Buffer.byteLength(pack)); assert.equal(r.body.length, 0);
    // a compressed copy older than its file is not used
    const old = new Date(Date.now() - 3600e3);
    utimesSync(join(dir, 'pack', 'duel-pack.0123456789abcdef.json.gz'), old, old);
    r = await get(gw.port, '/pack/duel-pack.0123456789abcdef.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(r.h['content-encoding'], undefined); assert.equal(r.body.toString(), pack);
    // only the names the build writes
    for (const p of ['/pack/duel-pack.0123456789abcdef.json.br', '/pack/duel-pack.zzzz.json', '/pack/../../package.json', '/pack/%2e%2e/%2e%2e/package.json', '/package.json', '/index.html.br'])
      assert.equal((await get(gw.port, p)).status, 404, p);
    assert.equal((await get(gw.port, '/pack/duel-pack.fedcba9876543210.json')).status, 404);
    const h = JSON.parse((await get(gw.port, '/healthz')).body);
    assert.equal(h.page, true);
  } finally { gw.stop(); }
  // a single-file build only, then nothing
  rmSync(join(dir, 'index.html')); writeFileSync(join(dir, 'duel-flow.html'), '<p>single</p>');
  const gw2 = await gateway(dir);
  try { const r = await get(gw2.port, '/'); assert.equal(r.status, 200); assert.equal(r.body.toString(), '<p>single</p>'); } finally { gw2.stop(); }
  rmSync(join(dir, 'duel-flow.html'));
  const gw3 = await gateway(dir);
  try { assert.equal((await get(gw3.port, '/')).status, 503); } finally { gw3.stop(); rmSync(dir, { recursive: true, force: true }); }
});
