// cookie-manager.js — chrome.cookies wrapper scoped to the registrable domain
// (eTLD+1). Spec §2.3, §7.2. Loaded in the service worker only.

if (typeof CookieManager === 'undefined') {
  var CookieManager = (() => {
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

    // URL a cookie is reachable at — required by cookies.set/remove.
    function cookieUrl(cookie) {
      const scheme = cookie.secure ? 'https' : 'http';
      const host = String(cookie.domain || '').replace(/^\./, '');
      return `${scheme}://${host}${cookie.path || '/'}`;
    }

    function toRow(cookie) {
      return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        hostOnly: !!cookie.hostOnly,
        session: !!cookie.session,
        sameSite: cookie.sameSite || 'unspecified',
        expirationDate: cookie.expirationDate ?? null,
        storeId: cookie.storeId || null,
        partitionKey: cookie.partitionKey || null,
        url: cookieUrl(cookie),
        size: cookie.name.length + String(cookie.value || '').length,
      };
    }

    // Cookies for the whole registrable domain — parent domain and every
    // subdomain — which is where session cookies usually live.
    async function list(url) {
      const { hostname } = new URL(url);
      const cookies = await chrome.cookies.getAll({ domain: getBaseDomain(hostname) });
      return cookies.map(toRow).sort((a, b) => a.name.localeCompare(b.name));
    }

    async function remove(cookie) {
      const details = { url: cookie.url || cookieUrl(cookie), name: cookie.name };
      if (cookie.storeId) details.storeId = cookie.storeId;
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;
      const result = await chrome.cookies.remove(details);
      if (!result) throw new Error(`Could not delete cookie "${cookie.name}"`);
      return { ok: true };
    }

    // Create or update one cookie. `previous` is the pre-edit version: when the
    // identity fields changed, the old cookie is removed first so an edit does
    // not leave a duplicate behind.
    async function set(cookie, previous) {
      const identityChanged =
        previous &&
        (previous.name !== cookie.name || previous.domain !== cookie.domain || previous.path !== cookie.path || previous.secure !== cookie.secure);
      if (identityChanged) await remove(previous).catch(() => {});

      const details = {
        url: cookieUrl(cookie),
        name: cookie.name,
        value: String(cookie.value ?? ''),
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        sameSite: cookie.sameSite || 'unspecified',
      };
      // A host-only cookie must be set without `domain`, otherwise Chrome widens
      // it to the whole domain including subdomains.
      if (!cookie.hostOnly && cookie.domain) details.domain = cookie.domain;
      if (cookie.expirationDate) details.expirationDate = Number(cookie.expirationDate);
      if (cookie.storeId) details.storeId = cookie.storeId;
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;

      const saved = await chrome.cookies.set(details);
      if (!saved) {
        // The most common rejection: SameSite=None requires Secure.
        const hint = details.sameSite === 'no_restriction' && !details.secure ? ' (SameSite=None requires Secure)' : '';
        throw new Error(`Chrome rejected cookie "${cookie.name}"${hint}`);
      }
      return toRow(saved);
    }

    async function clear(url) {
      const cookies = await list(url);
      let removed = 0;
      const failed = [];
      for (const cookie of cookies) {
        try {
          await remove(cookie);
          removed++;
        } catch (err) {
          failed.push({ name: cookie.name, error: err.message });
        }
      }
      return { removed, failed };
    }

    // Restore snapshot cookies. mode 'replace' clears the domain first.
    async function restore(url, cookies, mode) {
      if (mode === 'replace') await clear(url);
      let written = 0;
      const failed = [];
      for (const cookie of cookies) {
        try {
          await set(cookie, null);
          written++;
        } catch (err) {
          failed.push({ name: cookie.name, error: err.message });
        }
      }
      return { written, failed };
    }

    return { getBaseDomain, cookieUrl, toRow, list, set, remove, clear, restore };
  })();

  if (typeof globalThis !== 'undefined') globalThis.CookieManager = CookieManager;
}
