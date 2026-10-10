// PNG → WebP for the asset pack's pictures (the enemies' portraits), with the squoosh codecs compiled to WebAssembly
// (@jsquash/png, @jsquash/webp; dev dependencies): no native build, the same output on every platform.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { decode, init as initPng } from '@jsquash/png/decode.js';
import encode, { init as initWebp } from '@jsquash/webp/encode.js';

const require = createRequire(import.meta.url);
let ready = null;
// the codecs read from node_modules (their own loaders would fetch the .wasm by URL, which Node does not do for files)
function load() {
  if (!ready) {
    const wasm = (p) => WebAssembly.compile(readFileSync(require.resolve(p)));
    ready = Promise.all([
      wasm('@jsquash/png/codec/pkg/squoosh_png_bg.wasm').then((m) => initPng(m)),
      wasm('@jsquash/webp/codec/enc/webp_enc.wasm').then((m) => initWebp(m)),
    ]);
  }
  return ready;
}
/**
 * A PNG's bytes as a lossy WebP (alpha kept).
 * @param {Buffer|Uint8Array} png
 * @param {number} [quality] 0 … 100
 * @returns {Promise<Buffer>}
 */
export async function pngToWebp(png, quality = 90) {
  await load();
  const img = await decode(png);
  return Buffer.from(await encode(img, { quality, method: 6, alpha_quality: 100 }));
}
