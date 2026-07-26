// cookie-manager.js — chrome.cookies wrapper scoped to the registrable domain
// (eTLD+1). Spec §2.3, §7.2. Loaded in the service worker only.

if (typeof CookieManager === 'undefined') {
  var CookieManager = (() => {
    // Effective TLDs that span 2+ labels, so we don't treat a public suffix as a
    // real site. Same list as the Clean Site Data extension.
    const EFFECTIVE_TLDS = new Set([
      'co.uk',
      'org.uk',
      'me.uk',
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

    // e.g. www.facebook.com -> facebook.com, foo.example.co.uk -> example.co.uk
    function getBaseDomain(hostname) {
      if (!hostname) return hostname;
      if (hostname.includes(':') || /^[\d.]+$/.test(hostname)) return hostname;

      const parts = hostname.split('.');
      if (parts.length <= 2) return hostname;

      const last2 = parts.slice(-2).join('.');
      const last3 = parts.slice(-3).join('.');
      if (parts.length >= 4 && EFFECTIVE_TLDS.has(last3)) return parts.slice(-4).join('.');
      if (EFFECTIVE_TLDS.has(last2)) return last3;
      return last2;
    }

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
