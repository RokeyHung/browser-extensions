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
  // This runs in the page world with no access to chrome.* or the extension's
  // modules, so the shared block is inlined here too. It has to agree with
  // DomainMatcher exactly: `config.baseDomain` is computed by the service
  // worker, and any disagreement here would block the site's own navigations.

  // >>> shared:domain-suffix — generated, do not edit (make sync-domain-suffix) >>>
  // Derive the registrable domain (eTLD+1) from a hostname. Getting this wrong is
  // not cosmetic: a base domain of `co.id` makes every unrelated .co.id site look
  // like the same site, which silently widens cookie queries, autofill scope and
  // same-site checks to strangers.

  // Second-level labels a country registry uses to group registrations rather
  // than to name a site: the `com` in `com.vn`, the `co` in `co.uk`. Paired with
  // the two-letter country TLD test below this covers every country following the
  // convention, including the ones nobody here thought to write down.
  // `web` is deliberately absent: `web.de` is a real site, not a suffix.
  const REGISTRY_LABELS = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gob', 'nom']);

  // Public suffixes spanning 2+ labels that the rule cannot derive, so they have
  // to be named. Mostly hosting providers that isolate each subdomain as its own
  // site — without these, treating `alice.github.io` as a site would sweep in
  // every neighbouring project.
  const NAMED_SUFFIXES = new Set([
    'me.uk',
    'github.io',
    'gitlab.io',
    'pages.dev',
    'vercel.app',
    'netlify.app',
    'web.app',
    'firebaseapp.com',
    'herokuapp.com',
    'workers.dev',
  ]);

  // True for a country second-level suffix such as `com.vn`, `co.id` or `ac.jp`:
  // a registry label under a two-letter country TLD.
  function isCountrySecondLevel(suffix) {
    const parts = suffix.split('.');
    if (parts.length !== 2) return false;
    const [label, tld] = parts;
    return /^[a-z]{2}$/i.test(tld) && REGISTRY_LABELS.has(label.toLowerCase());
  }

  // True when `suffix` is something anyone can register under, so it can never be
  // a site on its own.
  function isPublicSuffix(suffix) {
    return NAMED_SUFFIXES.has(suffix.toLowerCase()) || isCountrySecondLevel(suffix);
  }

  // True for hosts with no meaningful site label: IP addresses and single-label
  // hosts such as `localhost` or an intranet name.
  function isLiteralHost(hostname) {
    if (!hostname) return true;
    return hostname.includes(':') || /^[\d.]+$/.test(hostname);
  }

  // e.g. www.facebook.com -> facebook.com, foo.example.co.uk -> example.co.uk
  function getBaseDomain(hostname) {
    if (!hostname) return hostname;
    if (isLiteralHost(hostname)) return hostname;

    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;

    const last2 = parts.slice(-2).join('.');
    const last3 = parts.slice(-3).join('.');
    if (parts.length >= 4 && isPublicSuffix(last3)) return parts.slice(-4).join('.');
    if (isPublicSuffix(last2)) return last3;
    return last2;
  }

  // The site's own label inside its registrable domain — the part that stays the
  // same across subdomains and country TLDs.
  // e.g. www.facebook.com -> facebook, foo.example.co.uk -> example
  // Returns null when the host has no such label (IPs, localhost).
  function getSiteLabel(hostname) {
    if (isLiteralHost(hostname)) return null;
    const base = getBaseDomain(hostname);
    const label = base ? base.split('.')[0] : '';
    if (!label) return null;
    // A bare single-label host is its own base domain; treat it as literal so we
    // never widen the scope to "everything named localhost".
    if (base === hostname && !hostname.includes('.')) return null;
    return label;
  }
  // <<< shared:domain-suffix <<<

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
    if (getBaseDomain(targetHost) === config.baseDomain) return { block: false };
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
