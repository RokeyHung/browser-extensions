#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins
// Run: node generate-icons.js

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcVal]);
}

function makePNG(size, drawFn) {
  const pixels = new Uint8Array(size * size * 4); // RGBA

  // Fill each pixel
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      drawFn(x, y, pixels, i, size);
    }
  }

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // rest are 0

  // Raw scanlines (filter byte + RGBA per pixel)
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = y * (1 + size * 4) + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }

  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

function draw(x, y, pixels, i, size) {
  const cx = size / 2,
    cy = size / 2;
  const r = size / 2;
  const dx = x - cx,
    dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const cornerR = size * 0.22;

  // Rounded square check (approximate)
  const abx = Math.abs(dx),
    aby = Math.abs(dy);
  const inSquare = abx <= r - 1 && aby <= r - 1;
  // Soften corners
  const inCorner = abx > r - cornerR && aby > r - cornerR;
  const cornerDist = Math.sqrt((abx - (r - cornerR)) ** 2 + (aby - (r - cornerR)) ** 2);
  const inShape = inSquare && (!inCorner || cornerDist <= cornerR);

  if (!inShape) {
    // transparent
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
    return;
  }

  // Background gradient: #4F46E5 → #7C3AED
  const t = (x + y) / (size * 2);
  const bgR = Math.round(79 + t * (124 - 79));
  const bgG = Math.round(70 + t * (58 - 70));
  const bgB = Math.round(229 + t * (237 - 229));

  // Draw "F" letter (simplified pixel art)
  const lx = x / size,
    ly = y / size;

  // Letter area: roughly center 40%
  const inLetter = (() => {
    const nx = (x - size * 0.28) / (size * 0.44);
    const ny = (y - size * 0.2) / (size * 0.6);
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;

    // Vertical stroke
    if (nx < 0.25) return true;
    // Top horizontal bar
    if (ny < 0.2) return true;
    // Middle bar
    if (ny > 0.42 && ny < 0.58 && nx < 0.75) return true;

    return false;
  })();

  if (inLetter) {
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = 230;
  } else {
    pixels[i] = bgR;
    pixels[i + 1] = bgG;
    pixels[i + 2] = bgB;
    pixels[i + 3] = 255;
  }
}

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

[16, 48, 128].forEach((size) => {
  const png = makePNG(size, draw);
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ Generated ${outPath}`);
});

console.log('\nDone! Icons saved to icons/');
