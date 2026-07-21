// injected-guard.js — runs in the page's MAIN world at document_start.
// Overrides window.open / location.assign / location.replace before page
// scripts run, and reports blocks back to the content script via postMessage.
//
// It cannot use chrome.* APIs, so the content script pushes it a plain config
// object (PRG_CONFIG) and it makes a synchronous local decision.

(function () {
  'use strict';

  let config = { active: false };

  // ── Local, self-contained target evaluation (mirror of NavigationGuard) ──
  function baseDomain(host) {
    const parts = String(host || '')
      .toLowerCase()
      .split('.');
    return parts.length <= 2 ? parts.join('.') : parts.slice(-2).join('.');
  }

  function allowed(host) {
    const hosts = config.allowedHosts || [];
    return hosts.some((h) => host === h || host.endsWith('.' + h));
  }

  // Returns { block, reason } for a candidate navigation.
  function evaluate(rawUrl, trigger) {
    if (!config.active) return { block: false };

    let target;
    try {
      target = new URL(rawUrl, location.href);
    } catch {
      return { block: true, reason: 'invalid target URL' };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return { block: false };

    if (target.origin === location.origin) return { block: false };
    const targetHost = target.hostname.toLowerCase();
    if (baseDomain(targetHost) === config.baseDomain) return { block: false };
    if (allowed(targetHost)) return { block: false };

    const s = config.settings || {};
    if (trigger === 'window.open' && s.blockWindowOpen === false) return { block: false };
    if (trigger === 'scripted-redirect' && s.blockScriptedRedirect === false) return { block: false };

    const reasonMap = {
      'window.open': 'window.open external',
      'scripted-redirect': 'scripted redirect external',
    };
    return { block: true, reason: reasonMap[trigger] || 'external navigation', targetUrl: target.href };
  }

  function report(targetUrl, reason, trigger) {
    window.postMessage({ __prg: true, kind: 'blocked', targetUrl, reason, trigger }, '*');
  }

  // ── Override window.open ────────────────────────────────────────────────
  const originalOpen = window.open;
  window.open = function (url, target, features) {
    const decision = evaluate(url || 'about:blank', 'window.open');
    if (decision.block) {
      report(decision.targetUrl || String(url), decision.reason, 'window.open');
      return null;
    }
    return originalOpen.call(window, url, target, features);
  };

  // ── Override location.assign / location.replace ─────────────────────────
  try {
    const proto = Object.getPrototypeOf(location) || Location.prototype;
    ['assign', 'replace'].forEach((method) => {
      const original = proto[method];
      if (typeof original !== 'function') return;
      const wrapped = function (url) {
        const decision = evaluate(url, 'scripted-redirect');
        if (decision.block) {
          report(decision.targetUrl || String(url), decision.reason, 'scripted-redirect');
          return;
        }
        return original.call(this, url);
      };
      try {
        Object.defineProperty(location, method, { value: wrapped, writable: true, configurable: true });
      } catch {
        try {
          location[method] = wrapped;
        } catch {
          /* some browsers lock this down; background layer still guards */
        }
      }
    });
  } catch {
    /* ignore */
  }

  // ── Receive config from the content script ──────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__prg !== true) return;
    if (data.kind === 'config' && data.config) {
      config = data.config;
    }
  });
})();
