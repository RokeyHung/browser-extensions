#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the cardboard box from icons/box-source.svg: an open box seen from the
// front, with folded side flaps and a scalloped tab on the front panel.
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

const ORANGE = [243, 156, 18]; // #f39c12 — side flaps, lid, base strip
const BODY = [230, 126, 34]; // #e67e22 — box body
const FRONT = [241, 196, 15]; // #f1c40f — front panel

// Bounding box of the drawing inside the 24×24 SVG canvas.
const ART = { x0: 1, y0: 6, x1: 23, y1: 24 };

// Colour at a point of the source artwork, painted back-to-front in the same
// order as the SVG's paths. Returns null outside the box (transparent).
function colorAt(u, v) {
  let color = null;

  // Side flaps, folded outward from the lid down to the middle of the box.
  if (v >= 6 && v <= 16) {
    const fold = (v - 6) * 0.2; // 2 units of spread over 10
    if ((u >= 21 && u <= 21 + fold) || (u <= 3 && u >= 3 - fold)) color = ORANGE;
  }

  // Body: a trapezoid widening towards the base.
  if (v >= 9 && v <= 23) {
    const spread = (v - 9) / 7; // 2 units of spread over 14
    if (u >= 3 - spread && u <= 21 + spread) color = BODY;
  }

  // Front panel. The two cubic curves in the source cut a shallow scallop out of
  // its top edge; a half-ellipse of the same extent reproduces it.
  if (v >= 16 && v <= 23 && u >= 1 && u <= 23) {
    const inTab = ((u - 12) / 2.8125) ** 2 + ((v - 16) / 2) ** 2 <= 1;
    if (!inTab) color = FRONT;
  }

  // Lid edge and base strip.
  if (v >= 6 && v <= 9 && u >= 3 && u <= 21) color = ORANGE;
  if (v >= 23 && v <= 24 && u >= 1 && u <= 23) color = ORANGE;

  return color;
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
