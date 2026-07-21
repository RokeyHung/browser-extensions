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

  // A permissive public-suffix-ish base-domain extractor. Not exhaustive, but
  // good enough to group www./api./cdn. subdomains under one site.
  const TWO_LEVEL_TLDS = new Set([
    'co.uk',
    'org.uk',
    'gov.uk',
    'ac.uk',
    'com.au',
    'net.au',
    'org.au',
    'com.br',
    'com.cn',
    'com.hk',
    'com.tw',
    'com.sg',
    'com.vn',
    'net.vn',
    'org.vn',
    'co.jp',
    'co.kr',
    'co.in',
    'co.nz',
    'com.mx',
    'com.tr',
  ]);

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

  function getBaseDomain(hostname) {
    if (!hostname) return '';
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    const lastTwo = parts.slice(-2).join('.');
    const lastThree = parts.slice(-3).join('.');
    if (TWO_LEVEL_TLDS.has(lastTwo)) return lastThree;
    return lastTwo;
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
