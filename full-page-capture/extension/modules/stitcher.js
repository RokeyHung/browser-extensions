// stitcher.js — assembles tiles into the final image(s) on OffscreenCanvas
// (spec §7.8, §8). Runs inside the service worker.
//
// Tiles are drawn as they arrive and released immediately, so peak memory is
// one canvas set plus one bitmap regardless of how tall the page is.

(function () {
  'use strict';

  const C = globalThis.Settings.C;

  // atob rather than fetch(dataUrl): fewer moving parts, and no argument about
  // what a service worker's CSP allows.
  function blobFromBase64(dataUrl, type) {
    const comma = dataUrl.indexOf(',');
    const binary = atob(comma === -1 ? dataUrl : dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: type || 'image/png' });
  }

  // How the full image is sliced vertically to stay inside Chrome's canvas
  // limits. One part whenever it fits, which is the overwhelming majority.
  function plan(width, height, maxPixels, maxEdge) {
    const limit = Math.max(1, Math.min(maxEdge || C.MAX_EDGE, Math.floor((maxPixels || C.MAX_PIXELS) / Math.max(1, width))));
    if (height <= limit) return [{ top: 0, height }];

    const count = Math.ceil(height / limit);
    const even = Math.ceil(height / count); // equal-ish parts look deliberate
    const parts = [];
    for (let top = 0; top < height; top += even) {
      parts.push({ top, height: Math.min(even, height - top) });
    }
    return parts;
  }

  function create({ width, height, maxPixels, maxEdge }) {
    const layout = plan(width, height, maxPixels, maxEdge);
    const parts = layout.map((p) => {
      const canvas = new OffscreenCanvas(width, p.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, p.height);
      return { ...p, canvas, ctx };
    });

    // `dy`/`sh` are in the full image's device-pixel space; a tile that straddles
    // a part boundary is drawn into both parts. Clipping happens on the edges
    // (top and bottom) rather than on a height, so neighbouring tiles stay
    // flush — no seam line, which is the whole point of the extension.
    function drawTile(bitmap, { sx, sy, sw, sh, dy }) {
      for (const part of parts) {
        const top = Math.max(dy, part.top);
        const bottom = Math.min(dy + sh, part.top + part.height);
        if (bottom <= top) continue;
        part.ctx.drawImage(bitmap, sx, sy + (top - dy), sw, bottom - top, 0, top - part.top, sw, bottom - top);
      }
    }

    async function toBlobs(type, quality) {
      const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';
      const out = [];
      for (const part of parts) {
        out.push(await part.canvas.convertToBlob(mime === 'image/jpeg' ? { type: mime, quality } : { type: mime }));
      }
      return out;
    }

    // A small JPEG of the top of the page. The gallery cannot hold 50 full-size
    // images in memory, and this never becomes a downloaded file (spec R8).
    async function thumbnail() {
      const first = parts[0];
      const scale = Math.min(1, C.THUMB_WIDTH / width);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.min(C.THUMB_MAX_HEIGHT, Math.round(first.height * scale)));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(first.canvas, 0, 0, width, Math.round(h / scale), 0, 0, w, h);
      return canvas.convertToBlob({ type: 'image/jpeg', quality: C.THUMB_QUALITY });
    }

    function release() {
      for (const part of parts) {
        part.canvas.width = 1;
        part.canvas.height = 1;
      }
    }

    return { width, height, parts: layout, count: parts.length, drawTile, toBlobs, thumbnail, release };
  }

  globalThis.Stitcher = { blobFromBase64, plan, create };
})();
