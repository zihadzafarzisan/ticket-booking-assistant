/**
 * Generates placeholder extension icons at the sizes the manifest requests.
 *
 * Chrome wants icons at 16/32/48/128 px for both the toolbar action and the
 * chrome://extensions listing. This produces simple, valid solid-color PNGs
 * (a cinema-red square) with no external dependencies — only Node's built-in
 * zlib for PNG DEFLATE compression.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const SIZES = [16, 32, 48, 128];
// Muted cinema-red, matches the popup accent
const [R, G, B] = [0xdc, 0x26, 0x26];
const outDir = resolve(process.cwd(), 'public/icons');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines: each row prefixed with filter byte 0 (None)
  const rowLen = size * 3 + 1;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowLen;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = R;
      raw[p + 1] = G;
      raw[p + 2] = B;
    }
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const file = resolve(outDir, `icon-${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`[icons] wrote ${file}`);
}

console.log('[icons] Done.');