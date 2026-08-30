// form-matcher.js — domain/path pattern matching and form ranking.
// Loaded in the content script, extension pages and the service worker.
// Wildcard patterns are anchored to the registrable domain — see the
// shared:domain-suffix block below and shared/domain-suffix.js. Spec §7.

if (typeof FormMatcher === 'undefined') {
  var FormMatcher = (() => {
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

    function matchDomainPattern(pattern, hostname) {
      if (!pattern || !hostname) return false;

      // *.website.* — subdomain + TLD wildcard: root domain or any subdomain, any TLD.
      // Anchored to the registrable domain: the label has to BE the site, not
      // merely appear somewhere in the host. Otherwise anyone owning evil.com
      // could serve www.website.evil.com and collect the saved profile.
      if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
        return getSiteLabel(hostname) === pattern.slice(2, -2);
      }

      // *.website.com — subdomain wildcard only (does not match the bare root domain)
      if (pattern.startsWith('*.')) {
        const base = pattern.slice(2);
        return hostname.endsWith('.' + base);
      }

      // website.* — TLD wildcard only (root domain on any TLD, no subdomains)
      if (pattern.endsWith('.*')) {
        const base = pattern.slice(0, -2);
        return getSiteLabel(hostname) === base && getBaseDomain(hostname) === hostname;
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
      // IP address, single-label host, or a bare public suffix — no wildcard
      // makes sense, so propose the host itself rather than a pattern that
      // would autofill this profile across unrelated sites.
      const label = getSiteLabel(hostname);
      return label ? `*.${label}.*` : hostname;
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
