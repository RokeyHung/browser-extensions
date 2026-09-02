#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the download glyph from icons/download-source.svg (SVG Repo): an arrow
// dropping into an open tray, with a lighter bar across the tray floor.
// Geometry is expressed in the source SVG's coordinate space — the 20×18 box the
// artwork occupies after its translate(2 3) — and sampled 4×4 per pixel so the
// round caps stay smooth at 16px.
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

// Facebook blue, without any part of the Meta wordmark or logo (spec §27).
const BLUE = [8, 102, 255]; // #0866FF — arrow and tray
const ACCENT = [159, 199, 255]; // #9FC7FF — the bar across the tray floor

const ART = { x0: 0, y0: 0, x1: 20, y1: 18 };

function insideRoundedRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const dx = u < x0 + r ? x0 + r - u : u > x1 - r ? u - (x1 - r) : 0;
  const dy = v < y0 + r ? y0 + r - v : v > y1 - r ? v - (y1 - r) : 0;
  return dx * dx + dy * dy <= r * r;
}

// Distance from a point to a segment — the source draws the arrowhead as a
// 2-unit stroke with round caps and a round join, which is exactly a pair of
// capsules of radius 1.
function nearSegment(u, v, x1, y1, x2, y2, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = dx * dx + dy * dy;
  let t = length ? ((u - x1) * dx + (v - y1) * dy) / length : 0;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx - u;
  const py = y1 + t * dy - v;
  return px * px + py * py <= r * r;
}

// Colour at a point of the source artwork, painted in the same order as the SVG.
// `detail` is false at 16px, where the accent bar is under two pixels tall and
// only muddies the tray.
function colorAt(u, v, detail) {
  let color = null;

  // The lighter bar sits under the arrow in the source's paint order.
  if (detail && u >= 2 && u <= 18 && v >= 14 && v <= 16) color = ACCENT;

  // Tray: a rounded rectangle with its middle removed, open at the top.
  if (insideRoundedRect(u, v, 0, 9, 20, 18, 1) && !(u >= 2 && u <= 18 && v >= 9 && v <= 16)) color = BLUE;

  // Arrow shaft, with the rounded cap at the top.
  if (u >= 9 && u <= 11 && v >= 1 && v <= 9.6) color = BLUE;
  if ((u - 10) ** 2 + (v - 1) ** 2 <= 1) color = BLUE;

  // Arrowhead: two capsules meeting at the tip.
  if (nearSegment(u, v, 6, 8, 10, 12, 1)) color = BLUE;
  if (nearSegment(u, v, 10, 12, 14, 8, 1)) color = BLUE;

  return color;
}

// ─── PNG encoding ───────────────────────────────────────────────────────────────

const SAMPLES = 4; // per axis, so 16 samples per pixel

function makePNG(size) {
  const artWidth = ART.x1 - ART.x0;
  const artHeight = ART.y1 - ART.y0;
  const inset = size * 0.06;
  const scale = (size - inset * 2) / Math.max(artWidth, artHeight);
  const offsetX = (size - artWidth * scale) / 2;
  const offsetY = (size - artHeight * scale) / 2;
  const detail = size >= 32;

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
          const color = colorAt(u, v, detail);
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
      // Average the covered samples for colour, use coverage for alpha so edges
      // anti-alias instead of stair-stepping.
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
