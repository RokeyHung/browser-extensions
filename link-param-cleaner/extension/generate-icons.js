#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the broken chain from icons/link-broken-source.svg: two open links on
// one diagonal with a gap between them, and two sparks flying off the break.
// Geometry is expressed in the source SVG's 24×24 coordinate space and sampled
// 4×4 per pixel so the diagonals stay smooth at 16px.
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

// The source is a single #1C274C with the two chain halves at opacity 0.5. At
// 16px that grey-blue wash disappears into any toolbar, so the PNG uses solid
// colour instead: the extension's purple for the chain, the accent orange for
// the sparks, which are the smallest shapes and need the most separation.
const CHAIN = [85, 70, 203]; // #5546CB
const SPARK = [255, 136, 89]; // #FF8859

// Bounding box of the drawing inside the 24×24 SVG canvas. Two of them: with
// the sparks gone at 16px their share of the canvas would be empty margin, and
// the chain would be drawn smaller than the icon it has to fill.
const ART_WITH_SPARKS = { x0: 2.5, y0: 2.5, x1: 21.5, y1: 21.5 };
const ART_CHAIN_ONLY = { x0: 4.9, y0: 4.9, x1: 19.1, y1: 19.1 };

const CENTER = 12;
const HALF_LENGTH = 8.4; // from the centre to the far end of a link
const GAP = 1.7; // half the break, so the two halves never touch
const OUTER = 3.0; // tube radius
const INNER = 1.45; // the hole through the link

// A link is a capsule with a round cap at the far end and a flat, open end at
// the break — the hole runs out of that end, which is what makes the shape read
// as a link that snapped rather than a bar.
function inRing(s, n) {
  const far = HALF_LENGTH - OUTER;
  const outside = s <= far ? Math.abs(n) <= OUTER : (s - far) ** 2 + n ** 2 <= OUTER ** 2;
  if (!outside) return false;
  const hole = s <= far ? Math.abs(n) <= INNER : (s - far) ** 2 + n ** 2 <= INNER ** 2;
  return !hole;
}

// Thick rounded line segment, used for the sparks.
function onSegment(u, v, ax, ay, bx, by, halfWidth) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / lengthSq));
  const px = ax + t * dx - u;
  const py = ay + t * dy - v;
  return px * px + py * py <= halfWidth * halfWidth;
}

// Colour at a point of the artwork, or null for transparent.
function colorAt(u, v, withSparks) {
  // Axis coordinates: s runs along the chain towards the top right, n across it.
  const s = (u - CENTER - (v - CENTER)) / Math.SQRT2;
  const n = (u - CENTER + (v - CENTER)) / Math.SQRT2;

  if (s >= GAP && inRing(s, n)) return CHAIN;
  if (s <= -GAP && inRing(-s, -n)) return CHAIN;

  // The sparks fly out of the break, perpendicular to the chain. They are the
  // first thing to go at 16px: three pixels of orange next to a purple bar read
  // as dirt, not as a break.
  if (withSparks) {
    if (onSegment(u, v, 8.8, 7.4, 6.4, 4.0, 0.62)) return SPARK;
    if (onSegment(u, v, 7.4, 8.8, 4.0, 6.4, 0.62)) return SPARK;
  }

  return null;
}

// ─── PNG encoding ───────────────────────────────────────────────────────────────

const SAMPLES = 4; // per axis, so 16 samples per pixel

function makePNG(size) {
  const withSparks = size >= 48;
  const ART = withSparks ? ART_WITH_SPARKS : ART_CHAIN_ONLY;
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
          const color = colorAt(u, v, withSparks);
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
