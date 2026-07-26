// form-matcher.js — domain/path pattern matching and form ranking.
// Loaded in the content script, extension pages and the service worker.
// Domain semantics are the same as block-elements-webpage/rule-matcher.js. Spec §7.

if (typeof FormMatcher === 'undefined') {
  var FormMatcher = (() => {
    // Second-level public suffixes needed to guess the main label of a hostname.
    const SECOND_LEVEL_TLDS = new Set([
      'co.uk',
      'org.uk',
      'ac.uk',
      'gov.uk',
      'co.jp',
      'ne.jp',
      'or.jp',
      'com.au',
      'net.au',
      'org.au',
      'co.nz',
      'com.br',
      'com.cn',
      'com.mx',
      'co.in',
      'co.kr',
      'com.tr',
      'com.sg',
      'com.hk',
      'com.tw',
      'co.za',
      'com.vn',
      'com.ua',
    ]);

    function matchDomainPattern(pattern, hostname) {
      if (!pattern || !hostname) return false;

      // *.website.* — subdomain + TLD wildcard: root domain or any subdomain, any TLD
      if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
        const middle = pattern.slice(2, -2);
        const parts = hostname.split('.');
        const idx = parts.indexOf(middle);
        // middle label present and followed by at least a TLD label (idx >= 0 allows the root domain too)
        return idx >= 0 && idx < parts.length - 1;
      }

      // *.website.com — subdomain wildcard only (does not match the bare root domain)
      if (pattern.startsWith('*.')) {
        const base = pattern.slice(2);
        return hostname.endsWith('.' + base);
      }

      // website.* — TLD wildcard only (root domain on any TLD)
      if (pattern.endsWith('.*')) {
        const base = pattern.slice(0, -2);
        const parts = hostname.split('.');
        return parts[0] === base && parts.length >= 2;
      }

      // exact / bare domain — also matches www. and any subdomain
      let base = pattern;
      if (base.startsWith('www.') && base.slice(4).includes('.')) base = base.slice(4);
      return hostname === pattern || hostname === base || hostname.endsWith('.' + base);
    }

    // Trailing slashes are ignored so /register and /register/ are the same path.
    function normalizePath(pathname) {
      if (!pathname) return '/';
      if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
      return pathname;
    }

    function matchPathPattern(pathPattern, pathname) {
      if (!pathPattern) return true;
      if (pathPattern === '*') return true;
      const path = normalizePath(pathname);
      if (pathPattern.endsWith('*')) return path.startsWith(normalizePath(pathPattern.slice(0, -1)));
      return path === normalizePath(pathPattern);
    }

    // Higher score = more specific. Used to rank forms matching the same URL. Spec §7.3.
    function pathScore(pathPattern) {
      if (!pathPattern || pathPattern === '*') return 0;
      if (pathPattern.endsWith('*')) return 1;
      return 2;
    }

    function domainScore(pattern) {
      if (!pattern) return 0;
      if (pattern.startsWith('*.') && pattern.endsWith('.*')) return 1;
      if (pattern.endsWith('.*')) return 2;
      if (pattern.startsWith('*.')) return 3;
      return 4;
    }

    function matchesUrl(form, hostname, pathname) {
      if (form.enabled === false) return false;
      return matchDomainPattern(form.domainPattern, hostname) && matchPathPattern(form.pathPattern, pathname);
    }

    function getMatchingForms(forms, hostname, pathname) {
      return (forms || [])
        .filter((form) => matchesUrl(form, hostname, pathname))
        .sort((a, b) => {
          const byPath = pathScore(b.pathPattern) - pathScore(a.pathPattern);
          if (byPath) return byPath;
          const byDomain = domainScore(b.domainPattern) - domainScore(a.domainPattern);
          if (byDomain) return byDomain;
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
    }

    // Default pattern proposed when a form is captured: *.mainlabel.*
    function suggestDomainPattern(hostname) {
      if (!hostname) return '';
      // IP address or single-label host — no wildcard makes sense
      if (/^[\d.]+$/.test(hostname) || hostname.includes(':') || !hostname.includes('.')) return hostname;

      const parts = hostname.split('.');
      const lastTwo = parts.slice(-2).join('.');
      const tldLabels = SECOND_LEVEL_TLDS.has(lastTwo) ? 2 : 1;
      const main = parts[parts.length - tldLabels - 1];
      if (!main) return hostname;
      return `*.${main}.*`;
    }

    function validateDomainPattern(pattern) {
      if (!pattern || !pattern.trim()) return 'Domain pattern is required';
      const value = pattern.trim();
      const stars = (value.match(/\*/g) || []).length;
      if (stars > 2) return 'At most 2 wildcards are supported';
      const body = value.replace(/^\*\./, '').replace(/\.\*$/, '');
      if (body.includes('*')) return 'Wildcard is only supported as a "*." prefix or ".*" suffix';
      if (!body) return 'Domain pattern is empty';
      if (/\s/.test(value)) return 'Domain pattern cannot contain spaces';
      return null;
    }

    function validatePathPattern(pattern) {
      if (!pattern || !pattern.trim()) return null; // empty = any path
      const value = pattern.trim();
      if (value === '*') return null;
      if (!value.startsWith('/')) return 'Path pattern must start with "/" (or be "*")';
      if (value.slice(0, -1).includes('*')) return 'Wildcard is only supported at the end of the path';
      return null;
    }

    return {
      matchDomainPattern,
      matchPathPattern,
      matchesUrl,
      getMatchingForms,
      suggestDomainPattern,
      validateDomainPattern,
      validatePathPattern,
      normalizePath,
    };
  })();

  // Reachable from the service worker after importScripts().
  if (typeof globalThis !== 'undefined') globalThis.FormMatcher = FormMatcher;
}
