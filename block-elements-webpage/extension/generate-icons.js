#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the closed eye from icons/eye-closed-source.svg: a lid arc with five
// lashes below it, evoking "hidden element".
//
// The source path is a stroke already converted to a fill, so its data is
// hundreds of tiny bezier segments. Rather than transcribing that, the anchor
// points the outline was built around are read off it and the centre lines are
// rebuilt: the arc as a spline through those points, the lashes as segments.
// Everything is then stroked by distance, the way the source was before it got
// flattened. Each pixel takes 4x4 samples.
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

const INK = [28, 39, 76]; // #1c274c
const HALF_WIDTH = 0.75; // the source stroke is 1.5 units wide, with round caps
const LASH_ALPHA = 0.5; // the source's second path carries opacity="0.5"

// Bounding box of the drawing inside the 24x24 SVG canvas, stroke included.
const ART = { x0: 1.25, y0: 6.25, x1: 22.75, y1: 17.25 };

// Points the lid arc passes through, taken from the source outline: the arc ends
// at (2,7) and (22,7), bottoms out at (12,14), and every lash starts on it.
const ARC_POINTS = [
  [2, 7],
  [5, 11.1288],
  [8.4128, 13.3288],
  [12, 14],
  [15.5872, 13.3288],
  [19, 11.1288],
  [22, 7],
];

// Lash centre lines; each end is the midpoint of the corresponding round cap.
const LASHES = [
  [5.0, 11.1289, 3.5, 12.6289],
  [8.4128, 13.3288, 7.0, 15.5],
  [12, 14, 12, 16.5],
  [15.5872, 13.3288, 17.0, 15.5],
  [19.0, 11.1289, 20.5, 12.6289],
];

// Catmull-Rom keeps the curve on every anchor point, so the rebuilt arc meets
// the lashes exactly where the source does.
function splinePolyline(points, stepsPerSpan) {
  const padded = [points[0], ...points, points[points.length - 1]];
  const out = [];

  for (let i = 1; i < padded.length - 2; i++) {
    const p0 = padded[i - 1];
    const p1 = padded[i];
    const p2 = padded[i + 1];
    const p3 = padded[i + 2];

    for (let s = 0; s < stepsPerSpan; s++) {
      const t = s / stepsPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const axis = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([axis(p0[0], p1[0], p2[0], p3[0]), axis(p0[1], p1[1], p2[1], p3[1])]);
    }
  }

  out.push(points[points.length - 1]);
  return out;
}

const ARC = splinePolyline(ARC_POINTS, 40);

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearPolyline(px, py, polyline, halfWidth) {
  for (let i = 0; i < polyline.length - 1; i++) {
    const [ax, ay] = polyline[i];
    const [bx, by] = polyline[i + 1];
    // Cheap reject before the square root.
    if (Math.min(ax, bx) - halfWidth > px || Math.max(ax, bx) + halfWidth < px) continue;
    if (Math.min(ay, by) - halfWidth > py || Math.max(ay, by) + halfWidth < py) continue;
    if (distanceToSegment(px, py, ax, ay, bx, by) <= halfWidth) return true;
  }
  return false;
}

// Alpha at a point of the artwork. The lid is opaque, the lashes half
// transparent, matching the source's two paths.
function alphaAt(u, v, halfWidth, lashAlpha) {
  if (nearPolyline(u, v, ARC, halfWidth)) return 1;
  for (const [ax, ay, bx, by] of LASHES) {
    if (distanceToSegment(u, v, ax, ay, bx, by) <= halfWidth) return lashAlpha;
  }
  return 0;
}

// Optical sizing. At 16px the source proportions put the stroke near one pixel
// and the half-transparent lashes below the threshold of being visible at all,
// so the toolbar icon reads as a faint smile. Small sizes get a heavier stroke
// and firmer lashes; 48 and 128 stay faithful to the source.
function weightFor(size) {
  if (size <= 16) return { halfWidth: 1.05, lashAlpha: 0.78 };
  if (size <= 32) return { halfWidth: 0.9, lashAlpha: 0.62 };
  return { halfWidth: HALF_WIDTH, lashAlpha: LASH_ALPHA };
}

// ─── PNG encoding ───────────────────────────────────────────────────────────────

const SAMPLES = 4; // per axis, so 16 samples per pixel

function makePNG(size) {
  const { halfWidth, lashAlpha } = weightFor(size);
  const artWidth = ART.x1 - ART.x0;
  const artHeight = ART.y1 - ART.y0;
  const inset = size * 0.04;
  const scale = (size - inset * 2) / Math.max(artWidth, artHeight);
  const offsetX = (size - artWidth * scale) / 2;
  const offsetY = (size - artHeight * scale) / 2;

  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let alphaSum = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const u = ART.x0 + (x + (sx + 0.5) / SAMPLES - offsetX) / scale;
          const v = ART.y0 + (y + (sy + 0.5) / SAMPLES - offsetY) / scale;
          alphaSum += alphaAt(u, v, halfWidth, lashAlpha);
        }
      }

      const i = (y * size + x) * 4;
      const alpha = alphaSum / (SAMPLES * SAMPLES);
      if (alpha <= 0) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 0;
        continue;
      }
      // One ink colour throughout, so only the alpha varies per pixel.
      pixels[i] = INK[0];
      pixels[i + 1] = INK[1];
      pixels[i + 2] = INK[2];
      pixels[i + 3] = Math.round(alpha * 255);
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
