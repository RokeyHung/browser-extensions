#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws a rounded square with a blue→cyan gradient and a white "no entry"
// (prohibition) sign, evoking "block popup". Run: node generate-icons.js

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
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      drawFn(x, y, pixels, (y * size + x) * 4, size);
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

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
  const r = size / 2;
  const cx = r;
  const cy = r;
  const dx = x - cx;
  const dy = y - cy;

  // Rounded-square mask.
  const abx = Math.abs(dx);
  const aby = Math.abs(dy);
  const cornerR = size * 0.22;
  const inSquare = abx <= r - 1 && aby <= r - 1;
  const inCorner = abx > r - cornerR && aby > r - cornerR;
  const cornerDist = Math.sqrt((abx - (r - cornerR)) ** 2 + (aby - (r - cornerR)) ** 2);
  const inShape = inSquare && (!inCorner || cornerDist <= cornerR);

  if (!inShape) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
    return;
  }

  // Background gradient #2563eb → #0891b2.
  const t = (x + y) / (size * 2);
  const bgR = Math.round(37 + t * (8 - 37));
  const bgG = Math.round(99 + t * (145 - 99));
  const bgB = Math.round(235 + t * (178 - 235));

  // Prohibition sign: white ring + diagonal slash.
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ringOuter = size * 0.34;
  const ringInner = size * 0.24;
  const inRing = dist <= ringOuter && dist >= ringInner;

  // Diagonal bar (perpendicular distance to the y=x line through center).
  const barHalf = size * 0.055;
  const perp = Math.abs(dx - dy) / Math.SQRT2;
  const inBar = perp <= barHalf && dist <= ringOuter - 1;

  if (inRing || inBar) {
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = 255;
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
