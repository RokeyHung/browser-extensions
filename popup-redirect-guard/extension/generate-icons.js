#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the shield from icons/shield-source.svg: a blue shield with a white X,
// evoking "block popups and redirects".
// The shield outline is the SVG's bezier path, flattened into a polygon once and
// filled by a point-in-polygon test; each pixel takes 4×4 samples so the curves
// stay smooth at 16px.
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

// ─── Artwork ────────────────────────────────────────────────────────────────────

const SHIELD = [33, 151, 243]; // #2197f3
const WHITE = [255, 255, 255];

// Bounding box of the drawing inside the 32×32 SVG canvas.
const ART = { x0: 1, y0: 1, x1: 31, y1: 31 };

// The X is stroked in the source with width 2 and round caps, so filling every
// point within 1 unit of either diagonal reproduces it exactly.
const CROSS_HALF_WIDTH = 1;
const CROSS = [
  [11, 11, 21, 21],
  [21, 11, 11, 21],
];

function flattenCubic(p0, c1, c2, p1, steps, out) {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]]);
  }
}

// The shield outline of the source SVG, in its own coordinates. Curve control
// points are taken straight from the path data; the `S` command's first control
// point is the reflection of the previous one, resolved here.
const SHIELD_OUTLINE = (() => {
  const points = [[31, 8]];
  flattenCubic([31, 8], [31, 8.23], [30.83, 31], [16, 31], 48, points); // right edge down to the tip
  flattenCubic([16, 31], [1.17, 31], [1, 8.23], [1, 8], 48, points); // tip back up the left edge
  flattenCubic([1, 8], [1, 7.6], [1.24, 7.24], [1.61, 7.08], 8, points); // top-left corner
  points.push([15.61, 1.08]); // up to the peak
  flattenCubic([15.61, 1.08], [15.86, 0.97], [16.14, 0.97], [16.39, 1.08], 6, points); // rounded peak
  points.push([30.39, 7.08]); // down to the top-right corner
  flattenCubic([30.39, 7.08], [30.76, 7.24], [31, 7.6], [31, 8], 8, points);
  return points;
})();

function inPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Colour at a point of the source artwork; null outside the shield.
function colorAt(u, v) {
  if (!inPolygon(u, v, SHIELD_OUTLINE)) return null;
  const onCross = CROSS.some(([ax, ay, bx, by]) => distanceToSegment(u, v, ax, ay, bx, by) <= CROSS_HALF_WIDTH);
  return onCross ? WHITE : SHIELD;
}

// ─── PNG encoding ───────────────────────────────────────────────────────────────

const SAMPLES = 4; // per axis, so 16 samples per pixel

function makePNG(size) {
  const artWidth = ART.x1 - ART.x0;
  const artHeight = ART.y1 - ART.y0;
  const inset = size * 0.03;
  const scale = (size - inset * 2) / Math.max(artWidth, artHeight);
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
      // edges anti-alias instead of stair-stepping.
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
