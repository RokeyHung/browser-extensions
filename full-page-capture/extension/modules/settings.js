// settings.js — the five user settings (spec §13, §14) plus every internal
// constant that is deliberately NOT a setting.
//
// Loaded by the service worker via importScripts and by every extension page
// via a plain <script> tag, so it stays a classic script hanging off globalThis.

(function () {
  'use strict';

  // The whole of chrome.storage.sync for this extension. Three keys, one per
  // control on the options page — no hidden state, nothing else to migrate.
  const DEFAULTS = {
    preloadLazyImages: true,
    format: 'png',
    afterCapture: 'preview',
  };

  // Not settings. Every value here is either a hard limit of the browser or a
  // number nobody can pick better than this file can (spec §13). Changing one
  // means editing code, which is the point: a wrong settle delay produces torn
  // screenshots that look like an extension bug rather than a user choice.
  const C = {
    SETTLE_DELAY: 120, // ms after scrolling before the shot
    CAPTURE_INTERVAL: 550, // ms between captureVisibleTab calls (quota is 2/s)
    CAPTURE_INTERVAL_STEP: 100, // added after each quota rejection
    CAPTURE_INTERVAL_MAX: 1200,
    CAPTURE_RETRIES: 3,
    QUOTA_BACKOFF: 1000,

    MAX_TILES: 80, // ≈72 000px tall at a 900px viewport
    MAX_PIXELS: 200000000, // under Chrome's 2^28 canvas area ceiling
    MAX_EDGE: 65535, // Chrome's hard canvas edge limit

    JPEG_QUALITY: 0.92, // spec R7 — never "automatic"
    THUMB_WIDTH: 320,
    THUMB_MAX_HEIGHT: 420,
    THUMB_QUALITY: 0.7,
  };

  // Unknown keys from an older build are dropped rather than kept: the settings
  // object is small enough that rebuilding it from DEFAULTS every read is free,
  // and it means a removed setting cannot linger and confuse a later version.
  function coerce(stored) {
    const out = { ...DEFAULTS };
    if (!stored) return out;
    if (typeof stored.preloadLazyImages === 'boolean') out.preloadLazyImages = stored.preloadLazyImages;
    if (stored.format === 'png' || stored.format === 'jpeg') out.format = stored.format;
    if (stored.afterCapture === 'preview' || stored.afterCapture === 'download') out.afterCapture = stored.afterCapture;
    return out;
  }

  async function get() {
    const bag = await chrome.storage.sync.get('settings');
    return coerce(bag && bag.settings);
  }

  // Saves are read-modify-write, so two of them in flight at once both read the
  // same starting state and the second one writes the first one's change away.
  // The options page makes exactly that call per control: flip two switches in
  // quick succession and one of them silently does not stick. Chaining keeps
  // each save reading what the previous one wrote.
  let queue = Promise.resolve();

  function save(patch) {
    queue = queue.then(async () => {
      const next = coerce({ ...(await get()), ...(patch || {}) });
      await chrome.storage.sync.set({ settings: next });
      return next;
    });
    return queue;
  }

  function reset() {
    queue = queue.then(async () => {
      await chrome.storage.sync.set({ settings: { ...DEFAULTS } });
      return { ...DEFAULTS };
    });
    return queue;
  }

  globalThis.Settings = { DEFAULTS, C, coerce, get, save, reset };
})();
