// domain-matcher.js — hostname parsing, pattern matching, same-site detection.
// Attaches to globalThis so it works both as a content script and via
// importScripts() inside the MV3 service worker.

(function () {
  'use strict';

  // Match a site pattern against a hostname.
  //   exact:            animevietsub.com
  //   TLD wildcard:     animevietsub.*        → animevietsub.com / .vn / .xyz
  //   subdomain:        *.animevietsub.com    → www.animevietsub.com
  //   both:             *.animevietsub.*      → www.animevietsub.xyz
  // `includeRoot` lets *.name.* also match the bare root domain (name.tld).
  function matchDomainPattern(pattern, hostname, includeRoot) {
    if (!pattern || !hostname) return false;
    hostname = hostname.toLowerCase();
    pattern = pattern.toLowerCase();

    const parts = hostname.split('.');

    // *.name.* — subdomain wildcard + TLD wildcard
    if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
      const middle = pattern.slice(2, -2);
      const idx = parts.indexOf(middle);
      const matchesSub = idx > 0 && idx < parts.length - 1;
      if (matchesSub) return true;
      // Optionally also match the root domain (name.tld)
      if (includeRoot && parts.length === 2 && parts[0] === middle) return true;
      return false;
    }

    // *.name.com — subdomain wildcard only
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return hostname.endsWith('.' + base);
    }

    // name.* — single-label TLD wildcard (no subdomains)
    if (pattern.endsWith('.*')) {
      const base = pattern.slice(0, -2);
      return parts.length === 2 && parts[0] === base;
    }

    // exact
    return hostname === pattern;
  }

  // Approximate registrable domain = last two labels.
  // Good enough for same-site checks on the common case; does not know about
  // multi-label public suffixes such as co.uk.
  function getBaseDomain(hostname) {
    if (!hostname) return '';
    const parts = hostname.toLowerCase().split('.');
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
  }

  function isSameSite(hostA, hostB) {
    if (!hostA || !hostB) return false;
    if (hostA === hostB) return true;
    return getBaseDomain(hostA) === getBaseDomain(hostB);
  }

  // Suggest the pattern we'd enable for a hostname, e.g.
  //   www.animevietsub.xyz → animevietsub.*
  function suggestPattern(hostname) {
    const base = getBaseDomain(hostname);
    const name = base.split('.')[0];
    return name ? `${name}.*` : hostname;
  }

  // Find the first enabled protection rule that covers this hostname.
  function findProtectedRule(rules, hostname) {
    if (!Array.isArray(rules)) return null;
    for (const rule of rules) {
      if (!rule || !rule.enabled) continue;
      const includeRoot = rule.includeRoot !== false;
      if (matchDomainPattern(rule.sitePattern, hostname, includeRoot)) return rule;
    }
    return null;
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  globalThis.DomainMatcher = {
    matchDomainPattern,
    getBaseDomain,
    isSameSite,
    suggestPattern,
    findProtectedRule,
    safeHostname,
  };
})();
