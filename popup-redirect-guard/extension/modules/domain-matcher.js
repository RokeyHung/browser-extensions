// domain-matcher.js — hostname parsing, pattern matching, same-site detection.
// Attaches to globalThis so it works both as a content script and via
// importScripts() inside the MV3 service worker.

(function () {
  'use strict';

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

    // *.name.* — subdomain wildcard + TLD wildcard.
    // Anchored to the registrable domain: the label has to BE the site. Without
    // that, a rule for *.name.* also covers www.name.evil.com, so an attacker
    // could park a host under the protected pattern.
    if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
      if (getSiteLabel(hostname) !== pattern.slice(2, -2)) return false;
      // Subdomains always match; the bare root domain only when asked for.
      return includeRoot || getBaseDomain(hostname) !== hostname;
    }

    // *.name.com — subdomain wildcard only
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return hostname.endsWith('.' + base);
    }

    // name.* — root domain on any TLD (no subdomains)
    if (pattern.endsWith('.*')) {
      const base = pattern.slice(0, -2);
      return getSiteLabel(hostname) === base && getBaseDomain(hostname) === hostname;
    }

    // exact
    return hostname === pattern;
  }

  function isSameSite(hostA, hostB) {
    if (!hostA || !hostB) return false;
    const a = hostA.toLowerCase();
    const b = hostB.toLowerCase();
    if (a === b) return true;
    return getBaseDomain(a) === getBaseDomain(b);
  }

  // Suggest the pattern we'd enable for a hostname, e.g.
  //   www.animevietsub.xyz → *.animevietsub.*
  // `*.name.*` rather than `name.*` so the suggestion also covers the very page
  // the user is on: `name.*` is root-domain-only, so it would not match the
  // www. host that prompted the suggestion.
  function suggestPattern(hostname) {
    const label = getSiteLabel(String(hostname || '').toLowerCase());
    return label ? `*.${label}.*` : hostname;
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
    // Normalised at the boundary so callers keep the old contract: lowercase
    // in, '' for a missing host. The shared helper itself stays pure.
    getBaseDomain: (hostname) => getBaseDomain(String(hostname || '').toLowerCase()),
    isSameSite,
    suggestPattern,
    findProtectedRule,
    safeHostname,
  };
})();
