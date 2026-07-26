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

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Rounded blue square holding three "filled input" bars plus a check mark.
function draw(x, y, pixels, i, size) {
  const r = size / 2;
  const dx = x - r;
  const dy = y - r;
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

  // Background gradient: #3B82F6 → #2563EB
  const t = (x + y) / (size * 2);
  const bgR = Math.round(59 + t * (37 - 59));
  const bgG = Math.round(130 + t * (99 - 130));
  const bgB = Math.round(246 + t * (235 - 246));

  const nx = x / size;
  const ny = y / size;

  // Three horizontal bars = form rows. The bottom one is shorter, and the
  // check mark sits to its right.
  const bars = [
    { top: 0.24, bottom: 0.34, left: 0.22, right: 0.78 },
    { top: 0.45, bottom: 0.55, left: 0.22, right: 0.78 },
    { top: 0.66, bottom: 0.76, left: 0.22, right: 0.5 },
  ];
  const inBar = bars.some((bar) => ny >= bar.top && ny <= bar.bottom && nx >= bar.left && nx <= bar.right);

  // Check mark: two strokes forming a tick in the lower-right area
  const inCheck = (() => {
    if (ny < 0.58 || ny > 0.82 || nx < 0.56 || nx > 0.84) return false;
    const shortLeg = Math.abs(ny - 0.6 - (nx - 0.56) * 1.2) < 0.06 && nx < 0.66;
    const longLeg = Math.abs(ny - 0.86 + (nx - 0.66) * 1.1) < 0.06 && nx >= 0.66;
    return shortLeg || longLeg;
  })();

  if (inBar || inCheck) {
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = 235;
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
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), makePNG(size, draw));
  console.log(`✓ Generated icons/icon${size}.png`);
});

console.log('\nDone! Icons saved to icons/');
