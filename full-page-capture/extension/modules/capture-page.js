// capture-page.js — captures ONE url end to end (spec §7). This is a step
// inside the site loop, never a user-facing command.
//
// Scroll a screenful, shoot, draw, release, repeat. The image is assembled as
// the tiles arrive so the worker only ever holds one canvas set and one bitmap.

(function () {
  'use strict';

  const C = globalThis.Settings.C;
  const Stitcher = globalThis.Stitcher;

  const PAGE_FILES = ['modules/page-metrics.js', 'modules/page-prepare.js'];

  class Cancelled extends Error {
    constructor() {
      super('Capture cancelled');
      this.cancelled = true;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function exec(tabId, func, args) {
    const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args: args ? [args] : [] });
    return results && results[0] ? results[0].result : null;
  }

  // The page-side modules register themselves on the isolated world's `window`;
  // re-injecting after every navigation is what makes that world exist again.
  async function injectPageModules(tabId) {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: PAGE_FILES });
  }

  // Chrome allows two captureVisibleTab calls per second. Going over rejects
  // rather than queueing, so a rejection means slow down — and stay slow for
  // the rest of the run, because the machine that hit the limit once will hit
  // it again (spec §7.7).
  async function shoot(windowId, timing) {
    // The quota is about the gap between calls, not about idling. Scrolling,
    // settling and the two page round trips already ate part of that gap, so
    // only the remainder is worth waiting out — sleeping the full interval on
    // top of them made every page roughly 40% slower than it had to be.
    const since = Date.now() - (timing.lastShotAt || 0);
    if (timing.lastShotAt && since < timing.interval) await sleep(timing.interval - since);

    for (let attempt = 1; ; attempt++) {
      try {
        const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
        timing.lastShotAt = Date.now();
        return shot;
      } catch (err) {
        const message = (err && err.message) || String(err);
        const quota = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(message);
        if (!quota || attempt >= C.CAPTURE_RETRIES) throw err;
        timing.interval = Math.min(C.CAPTURE_INTERVAL_MAX, timing.interval + C.CAPTURE_INTERVAL_STEP);
        await sleep(C.QUOTA_BACKOFF);
      }
    }
  }

  // Where each tile lands. Positions are clamped to the last full screenful, so
  // the final tile overlaps the one before it — harmless, because both draw the
  // identical pixels at identical coordinates (spec §7.5).
  function planTiles(contentHeight, step) {
    const maxTop = Math.max(0, contentHeight - step);
    const count = Math.min(C.MAX_TILES, maxTop > 0 ? Math.ceil(maxTop / step) + 1 : 1);
    const tops = [];
    for (let i = 0; i < count; i++) tops.push(Math.min(i * step, maxTop));
    return { tops, truncated: count === C.MAX_TILES && maxTop / step + 1 > C.MAX_TILES };
  }

  // opts: { tabId, windowId, settings, timing, isCancelled, onProgress }
  // Returns { blobs, thumb, meta } — the caller decides whether that becomes a
  // file on disk or a card in the gallery.
  async function capture(opts) {
    const { tabId, windowId, settings, timing } = opts;
    const isCancelled = opts.isCancelled || (() => false);
    const onProgress = opts.onProgress || (() => {});
    const startedAt = Date.now();

    await injectPageModules(tabId);
    const metrics = await exec(tabId, () => window.__fpcMetrics.measure());
    if (!metrics) throw new Error('Could not measure this page.');

    const warnings = [];
    let canvasSet = null;

    try {
      const prepared = await exec(tabId, (args) => window.__fpcPrepare.freeze(args), {
        preloadLazyImages: settings.preloadLazyImages,
        lazyTimeout: C.LAZY_TIMEOUT,
      });

      const rect = metrics.captureRect;
      const step = rect.height;
      const contentHeight = Math.max((prepared && prepared.contentHeight) || 0, metrics.contentHeight);
      const { tops, truncated } = planTiles(contentHeight, step);

      let scale = 0;
      let sx = 0;
      let sy = 0;
      let sw = 0;

      for (let i = 0; i < tops.length; i++) {
        if (isCancelled()) throw new Cancelled();

        const before = await exec(tabId, (args) => window.__fpcPrepare.beforeShot(args), {
          y: tops[i],
          index: i,
          settleDelay: C.SETTLE_DELAY,
        });
        if (!before || before.cancelled) throw new Cancelled();

        const dataUrl = await shoot(windowId, timing);
        const bitmap = await createImageBitmap(Stitcher.blobFromBase64(dataUrl, 'image/png'));

        try {
          if (!canvasSet) {
            // Measured, never assumed: devicePixelRatio already folds in page
            // zoom, and the two disagree by fractions that add up to a visible
            // seam over twenty tiles (spec §2.2).
            scale = bitmap.width / metrics.innerWidth;
            sx = Math.round(rect.x * scale);
            sy = Math.round(rect.y * scale);
            sw = Math.min(Math.round(rect.width * scale), bitmap.width - sx);
            canvasSet = Stitcher.create({
              width: sw,
              height: Math.round(contentHeight * scale),
              maxPixels: C.MAX_PIXELS,
              maxEdge: C.MAX_EDGE,
            });
          }

          // Rounded at the edges rather than on a height, so consecutive tiles
          // share an exact boundary and leave no gap (spec §7.8).
          const top = before.actualScrollY;
          const y0 = Math.round(top * scale);
          const y1 = Math.round(Math.min(top + step, contentHeight) * scale);
          const sh = Math.min(y1 - y0, bitmap.height - sy, canvasSet.height - y0);
          if (sh > 0) canvasSet.drawTile(bitmap, { sx, sy, sw, sh, dy: y0 });
        } finally {
          // Holding the bitmaps to stitch at the end is the fastest way to get
          // the service worker killed: ~20MB each, decoded.
          bitmap.close();
        }

        const done = i + 1;
        const etaMs = (tops.length - done) * (timing.interval + C.SETTLE_DELAY);
        onProgress(done, tops.length, etaMs);
        await exec(tabId, (args) => window.__fpcPrepare.afterShot(args), { done, total: tops.length, etaMs });
      }

      if (!canvasSet) throw new Error('Nothing was captured.');

      const after = await exec(tabId, () => window.__fpcMetrics.measure());
      if (after && Math.abs(after.contentHeight - contentHeight) > contentHeight * 0.05) {
        warnings.push('Page grew while capturing; the shot may miss the newest content.');
      }
      if (metrics.horizontalOverflow) {
        warnings.push(`Page is wider than the viewport; captured the left ${Math.round(rect.width)}px.`);
      }
      if (truncated) warnings.push(`Page truncated at ${C.MAX_TILES} screens.`);
      if (!metrics.scrollable && contentHeight <= step + 4) {
        // Not a warning worth showing for genuinely short pages; only when we
        // failed to find something scrollable on a page that clearly scrolls.
        if (metrics.scrollerKind === 'document' && metrics.contentHeight > metrics.clientHeight + 4) {
          warnings.push('Could not detect a scrollable area; captured the visible part only.');
        }
      }

      const blobs = await canvasSet.toBlobs(settings.format, C.JPEG_QUALITY);
      const thumb = await canvasSet.thumbnail();

      return {
        blobs,
        thumb,
        meta: {
          url: metrics.url,
          title: metrics.title,
          hostname: new URL(metrics.url).hostname,
          scale: Math.round(scale * 100) / 100,
          width: canvasSet.width,
          height: canvasSet.height,
          cssWidth: Math.round(rect.width),
          cssHeight: Math.round(contentHeight),
          tiles: tops.length,
          parts: blobs.length,
          bytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
          durationMs: Date.now() - startedAt,
          format: settings.format,
          warnings,
        },
      };
    } finally {
      if (canvasSet) canvasSet.release();
      // Always. A page left with its header hidden looks broken to the user.
      await exec(tabId, () => window.__fpcPrepare.unfreeze()).catch(() => null);
    }
  }

  globalThis.CapturePage = { capture, planTiles, Cancelled, injectPageModules, exec };
})();
