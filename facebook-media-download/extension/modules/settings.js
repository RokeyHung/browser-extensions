// settings.js — the seven user settings (spec §12, §14) plus every internal
// constant that is deliberately NOT a setting.
//
// Loaded by the service worker via importScripts and by every extension page via
// a plain <script> tag, so it stays a classic script hanging off globalThis.

(function () {
  'use strict';

  // The whole of chrome.storage.sync for this extension: one key per control on
  // the options page, nothing hidden.
  const DEFAULTS = {
    filenamePattern: '{author}-{date}-{postId}-{index}',
    subfolder: '',
    videoQuality: 'highest',
    downloadPoster: false,
    markDownloaded: true,
    notifyOnComplete: false,
    historyLimit: 1000,
  };

  // Not settings. Each of these is either a limit of the platform or a number
  // nobody can pick better than this file can (spec §12). Changing one means
  // editing code, which is the point: a wrong scan budget shows up as a janky
  // feed, which reads as a browser problem rather than a user choice.
  const C = {
    // Harvest (§6)
    WALK_MAX_DEPTH: 32,
    WALK_MAX_NODES: 200000,
    SCAN_BUDGET_MS: 8, // per idle slice; never scan synchronously in the hook
    PAYLOAD_QUEUE_MAX: 20,
    EMBEDDED_WATCH_MS: 5000, // stop watching for <script data-sjs> this long after load

    // Media index (§6.4)
    INDEX_TTL: 30 * 60 * 1000, // CDN URLs carry an expiry; holding them longer is pointless
    INDEX_MAX: 500,

    // In-page UI (§9.5, §10)
    MIN_MEDIA_EDGE: 120, // below this an <img> is an avatar or an icon, not content
    OBSERVER_THROTTLE: 250,
    MARK_BATCH_MS: 400,
    MAX_MARKS: 40, // ✓ overlays alive at once

    // Downloads (§16)
    MAX_CONCURRENT_DOWNLOADS: 3, // more than this and the CDN starts answering 429
    MAX_OFFSCREEN_BYTES: 512 * 1024 * 1024, // the fallback path holds the file in RAM
  };

  const QUALITIES = ['highest', 'ask'];
  const HISTORY_LIMITS = [0, 200, 1000, 5000];

  // Unknown keys from an older build are dropped rather than kept: rebuilding the
  // object from DEFAULTS on every read is free at this size, and it means a
  // removed setting cannot linger and confuse a later version.
  function coerce(stored) {
    const out = { ...DEFAULTS };
    if (!stored) return out;
    if (typeof stored.filenamePattern === 'string' && stored.filenamePattern.trim()) out.filenamePattern = stored.filenamePattern.trim();
    if (typeof stored.subfolder === 'string') out.subfolder = stored.subfolder.trim();
    if (QUALITIES.includes(stored.videoQuality)) out.videoQuality = stored.videoQuality;
    if (typeof stored.downloadPoster === 'boolean') out.downloadPoster = stored.downloadPoster;
    if (typeof stored.markDownloaded === 'boolean') out.markDownloaded = stored.markDownloaded;
    if (typeof stored.notifyOnComplete === 'boolean') out.notifyOnComplete = stored.notifyOnComplete;
    if (HISTORY_LIMITS.includes(stored.historyLimit)) out.historyLimit = stored.historyLimit;
    return out;
  }

  async function get() {
    const bag = await chrome.storage.sync.get('settings');
    return coerce(bag && bag.settings);
  }

  // Saves are read-modify-write, so two in flight at once both read the same
  // starting state and the second writes the first one's change away. The options
  // page makes exactly that call per control: flip two toggles in quick
  // succession and one of them silently does not stick (spec §14).
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

  globalThis.Settings = { DEFAULTS, C, QUALITIES, HISTORY_LIMITS, coerce, get, save, reset };
})();
