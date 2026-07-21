// block-log.js — builds blocked-attempt log entries and rate-limits toasts
// so a spammy site can't flood the UI (spec §10.3, §16, §18.4).

(function () {
  'use strict';

  const DM = globalThis.DomainMatcher;

  function buildEntry({ sourceUrl, targetUrl, reason, mode, action }) {
    return {
      id: 'blocked_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
      sourceUrl: sourceUrl || '',
      sourceHostname: DM.safeHostname(sourceUrl) || '',
      targetUrl: targetUrl || '',
      targetHostname: DM.safeHostname(targetUrl) || '',
      reason: reason || 'blocked',
      mode: mode || 'normal',
      action: action || 'blocked',
      createdAt: new Date().toISOString(),
    };
  }

  // Simple sliding-window rate limiter keyed by source hostname.
  // Used to decide whether to surface a toast; logging itself is not throttled.
  function createRateLimiter({ windowMs = 10000, maxToasts = 4 } = {}) {
    const buckets = new Map(); // key → { count, resetAt }

    return {
      // Returns { show, suppressed } — suppressed is how many were hidden so far.
      allow(key) {
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || now > b.resetAt) {
          b = { count: 0, resetAt: now + windowMs, suppressed: 0 };
          buckets.set(key, b);
        }
        b.count++;
        if (b.count <= maxToasts) {
          return { show: true, suppressed: b.suppressed };
        }
        b.suppressed++;
        return { show: false, suppressed: b.suppressed };
      },
      reset(key) {
        buckets.delete(key);
      },
    };
  }

  globalThis.BlockLog = { buildEntry, createRateLimiter };
})();
