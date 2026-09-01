#!/usr/bin/env node
// generate-icons.js — creates PNG icons using only Node.js built-ins.
// Draws the compact camera from icons/camera-source.svg: purple body, yellow
// face, a white-ringed lens with an orange centre. Geometry is expressed in the
// source SVG's 1024×1024 coordinate space and sampled 4×4 per pixel so the
// curves stay smooth at 16px.
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

const PURPLE = [85, 70, 203]; // #5546CB — body, lens rings
const YELLOW = [253, 205, 96]; // #FDCD60 — front face
const WHITE = [255, 255, 255]; // #FFFFFF — lens ring, highlight
const ORANGE = [255, 136, 89]; // #FF8859 — lens centre

// Bounding box of the drawing inside the 1024×1024 SVG canvas: the viewfinder
// bump down to the base of the body.
const ART = { x0: 147, y0: 227, x1: 877, y1: 798 };

const LENS = { x: 528, y: 590 };

function insideRoundedRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const dx = u < x0 + r ? x0 + r - u : u > x1 - r ? u - (x1 - r) : 0;
  const dy = v < y0 + r ? y0 + r - v : v > y1 - r ? v - (y1 - r) : 0;
  return dx * dx + dy * dy <= r * r;
}

// Colour at a point of the source artwork, painted back to front in the same
// order as the SVG's paths. `detail` is false at 16px, where the highlight dot
// and the little flash window are smaller than a pixel and only add mud.
function colorAt(u, v, detail) {
  let color = null;

  // Viewfinder bump: a trapezoid narrowing towards the top.
  if (v >= 227 && v <= 268) {
    const t = (v - 227) / 41; // 0 at the top edge, 1 where it meets the body
    const half = 43 + t * 16;
    if (u >= 669 - (half - 43) && u <= 755 + (half - 43)) color = PURPLE;
  }

  // Body.
  if (insideRoundedRect(u, v, 147, 266, 877, 798, 51)) color = PURPLE;

  // Front face: a top strip and the main panel, split by the purple seam the
  // source draws between y=380 and y=400.
  if (u >= 166 && u <= 858) {
    if (v >= 286 && v <= 380) color = YELLOW;
    if (v >= 400 && v <= 778) color = YELLOW;
  }

  // Flash window on the top strip.
  if (detail && u >= 718 && u <= 789 && v >= 322 && v <= 342) color = PURPLE;

  // Lens, outside in.
  const dx = u - LENS.x;
  const dy = v - LENS.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= 168) color = PURPLE;
  if (d <= 148) color = WHITE;
  if (d <= 116) color = PURPLE;
  if (d <= 96) color = ORANGE;

  // Highlight inside the lens.
  if (detail && (u - 571) ** 2 + (v - 558) ** 2 <= 18 * 18) color = WHITE;

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
