// url-normalizer.js — turns raw/relative URLs into a canonical form so the same
// resource is not stored twice. Also decides same-origin / same-site scope.
// Shared by content script, background and crawler (loaded via importScripts or
// a <script> tag), so it attaches to globalThis.

(function () {
  'use strict';

  const DEFAULT_OPTIONS = {
    queryMode: 'query-keys-only', // 'ignore' | 'query-keys-only' | 'keep-full'
    includeHash: false,
    removeTrailingSlash: true,
    sortQuery: true,
  };

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

  function safeUrl(raw, base) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Skip non-navigable / pseudo URLs.
    if (/^(javascript:|data:|blob:|mailto:|tel:|about:|chrome:|edge:|devtools:|#)/i.test(s)) return null;
    try {
      return base ? new URL(s, base) : new URL(s);
    } catch {
      return null;
    }
  }

  function isSameOrigin(url, originUrl) {
    const a = safeUrl(url);
    const b = safeUrl(originUrl);
    if (!a || !b) return false;
    return a.origin === b.origin;
  }

  function isSameSite(url, originUrl) {
    const a = safeUrl(url);
    const b = safeUrl(originUrl);
    if (!a || !b) return false;
    return getBaseDomain(a.hostname) === getBaseDomain(b.hostname) && getBaseDomain(a.hostname) !== '';
  }

  // scope: 'same-origin' | 'same-site' | 'any'
  function inScope(url, originUrl, scope) {
    if (scope === 'any') return true;
    if (scope === 'same-site') return isSameSite(url, originUrl);
    return isSameOrigin(url, originUrl);
  }

  function queryKeys(u) {
    const keys = [];
    for (const key of u.searchParams.keys()) {
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }

  // Returns { url, normalizedUrl, origin, hostname, path, queryKeys } or null.
  function normalize(raw, base, options) {
    const opts = { ...DEFAULT_OPTIONS, ...(options || {}) };
    const u = safeUrl(raw, base);
    if (!u) return null;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    // Lowercase protocol + hostname (URL already lowercases them). Drop default ports.
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }

    const keys = queryKeys(u);

    // Build the normalized search string per query mode.
    let search = '';
    if (opts.queryMode === 'ignore') {
      search = '';
    } else if (opts.queryMode === 'query-keys-only') {
      const sorted = opts.sortQuery ? [...keys].sort() : keys;
      search = sorted.length ? '?' + sorted.join('&') : '';
    } else {
      // keep-full
      if (opts.sortQuery) {
        const entries = [...u.searchParams.entries()].sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
        const sp = new URLSearchParams();
        for (const [k, v] of entries) sp.append(k, v);
        search = sp.toString() ? '?' + sp.toString() : '';
      } else {
        search = u.search;
      }
    }

    // Pathname, optional trailing-slash removal (never strip the root "/").
    let pathname = u.pathname || '/';
    if (opts.removeTrailingSlash && pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.replace(/\/+$/, '') || '/';
    }

    const hash = opts.includeHash ? u.hash : '';
    const normalizedUrl = u.origin + pathname + search + hash;

    return {
      url: u.href,
      normalizedUrl,
      origin: u.origin,
      hostname: u.hostname,
      path: pathname,
      queryKeys: keys,
    };
  }

  function siteIdFromOrigin(origin) {
    const host = safeUrl(origin);
    const h = host ? host.hostname : String(origin || '').replace(/[^a-z0-9]+/gi, '_');
    return (
      'site_' +
      String(h)
        .replace(/[^a-z0-9]+/gi, '_')
        .toLowerCase()
    );
  }

  globalThis.UrlNormalizer = {
    DEFAULT_OPTIONS,
    safeUrl,
    normalize,
    getBaseDomain,
    isSameOrigin,
    isSameSite,
    inScope,
    siteIdFromOrigin,
  };
})();
