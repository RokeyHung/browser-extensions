#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the compass from icons/compass-source.svg: concentric rings, an
// eight-point rose, a two-tone needle and a hub.
// Every shape in the source is a circle or a polygon, so the geometry is
// transcribed directly. Each pixel takes 4x4 samples.
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

// ─── Artwork (source viewBox is 36x36) ──────────────────────────────────────────

const RIM = [244, 144, 12]; // #f4900c outer ring
const BEZEL = [255, 217, 131]; // #ffd983
const FACE = [245, 248, 250]; // #f5f8fa dial
const ROSE = [204, 214, 221]; // #ccd6dd eight-point star
const NEEDLE_DARK = [41, 47, 51]; // #292f33 south half
const NEEDLE_RED = [221, 46, 68]; // #dd2e44 north half
const HUB = [136, 153, 166]; // #8899a6

const ART = { x0: 0, y0: 0, x1: 36, y1: 36 };
const CENTER = 18;

// The rose is one closed path of 16 points: four long arms on the axes with a
// shorter arm between each pair.
const ROSE_POLYGON = [
  [18, 8],
  [19.531, 14.304],
  [25.071, 10.929],
  [21.696, 16.469],
  [28, 18],
  [21.696, 19.531],
  [25.071, 25.071],
  [19.531, 21.696],
  [18, 28],
  [16.469, 21.696],
  [10.929, 25.071],
  [14.304, 19.531],
  [8, 18],
  [14.304, 16.469],
  [10.929, 10.929],
  [16.469, 14.304],
];

// The needle runs north-west to south-east, each half a thin triangle.
const NEEDLE_SOUTH = [
  [17.343, 20.748],
  [26.12, 26.129],
  [20.741, 17.351],
];
const NEEDLE_NORTH = [
  [18.657, 15.267],
  [9.879, 9.886],
  [15.259, 18.665],
];

function inCircle(u, v, cx, cy, r) {
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

function inPolygon(u, v, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Painted back to front, in the source's own order.
function colorAt(u, v) {
  if (!inCircle(u, v, CENTER, CENTER, 18)) return null;

  let color = RIM;
  if (inCircle(u, v, CENTER, CENTER, 14.5)) color = BEZEL;
  if (inCircle(u, v, CENTER, CENTER, 13)) color = FACE;
  if (inPolygon(u, v, ROSE_POLYGON)) color = ROSE;
  if (inPolygon(u, v, NEEDLE_SOUTH)) color = NEEDLE_DARK;
  if (inPolygon(u, v, NEEDLE_NORTH)) color = NEEDLE_RED;
  if (inCircle(u, v, CENTER, 18.008, 3.055)) color = HUB;
  if (inCircle(u, v, CENTER, 18.008, 1.648)) color = FACE;
  return color;
}

// ─── PNG encoding ───────────────────────────────────────────────────────────────

const SAMPLES = 4; // per axis, so 16 samples per pixel

function makePNG(size) {
  const artWidth = ART.x1 - ART.x0;
  const artHeight = ART.y1 - ART.y0;
  const scale = size / Math.max(artWidth, artHeight);
  const offsetX = (size - artWidth * scale) / 2;
  const offsetY = (size - artHeight * scale) / 2;

  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = ART.x0 + (x + (sx + 0.5) / SAMPLES - offsetX) / scale;
          const v = ART.y0 + (y + (sy + 0.5) / SAMPLES - offsetY) / scale;
          const color = colorAt(u, v);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          covered++;
        }
      }

      const i = (y * size + x) * 4;
      if (!covered) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
        continue;
      }
      // Average the covered samples for colour, use coverage for alpha so the
      // rim anti-aliases instead of stair-stepping.
      pixels[i] = Math.round(r / covered);
      pixels[i + 1] = Math.round(g / covered);
      pixels[i + 2] = Math.round(b / covered);
      pixels[i + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
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

const outDir = path.join(__dirname, 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

[16, 48, 128].forEach((size) => {
  const outPath = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(outPath, makePNG(size));
  console.log(`✓ Generated ${outPath}`);
});

console.log('\nDone! Icons saved to icons/');
