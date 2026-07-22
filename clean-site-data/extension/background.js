chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'cleanSiteData') {
    handleClean(message)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ error: err.message, results: {} });
      });
    return true; // keep message channel open for async
  }
});

async function handleClean({ tabId, url, origin, options }) {
  const results = {};

  // 1. Cookies (via chrome.cookies API)
  //    Cleared across the whole registrable domain (eTLD+1) — parent domain and
  //    every subdomain — not just the exact hostname of the tab. This is what
  //    actually logs you out of sites like Facebook, whose auth cookies live on
  //    `.facebook.com` while the tab is on `www.facebook.com`.
  if (options.cookies) {
    results.cookies = await clearCookies(url);
  }

  // 2. Page-level storage (localStorage, sessionStorage, IndexedDB, Cache, SW)
  //    Injected into the page context to access page APIs
  const pageOptions = {
    localStorage: !!options.localStorage,
    sessionStorage: !!options.sessionStorage,
    indexedDB: !!options.indexedDB,
    cacheStorage: !!options.cacheStorage,
    serviceWorker: !!options.serviceWorker,
  };

  const anyPageOption = Object.values(pageOptions).some(Boolean);
  if (anyPageOption) {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: clearPageData,
        args: [pageOptions],
      });
      const pageResults = injectionResults?.[0]?.result || {};
      Object.assign(results, pageResults);
    } catch (err) {
      // If script injection fails, mark all requested page options as failed
      for (const [key, enabled] of Object.entries(pageOptions)) {
        if (enabled) results[key] = { success: false, error: err.message };
      }
    }
  }

  // 3. browsingData API scoped to the site's registrable domain.
  //    Using `origins` makes Chrome clear data for the whole eTLD+1, catching
  //    HttpOnly cookies, partitioned cookies and storage the page script cannot
  //    reach. Runs after the page injection to catch anything left behind.
  const dataToRemove = {};
  if (options.cookies) dataToRemove.cookies = true;
  if (options.localStorage) dataToRemove.localStorage = true;
  if (options.indexedDB) dataToRemove.indexedDB = true;
  if (options.cacheStorage) dataToRemove.cacheStorage = true;
  if (options.serviceWorker) dataToRemove.serviceWorkers = true;

  if (Object.keys(dataToRemove).length > 0) {
    try {
      await chrome.browsingData.remove({ origins: [origin] }, dataToRemove);
    } catch (_err) {
      // browsingData is supplementary; the steps above already attempted these
    }
  }

  // 4. Reload tab
  let reloaded = false;
  if (options.reload) {
    try {
      await chrome.tabs.reload(tabId);
      reloaded = true;
    } catch (_err) {
      // non-critical
    }
  }

  return { results, reloaded };
}

// Effective TLDs that span 2+ labels. Used to derive the registrable domain
// (eTLD+1) so we don't accidentally treat a public suffix as a real site.
// Includes country-code second-level domains and popular hosting providers that
// isolate each subdomain as a separate site.
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

// Derive the registrable domain (eTLD+1) from a hostname.
// e.g. www.facebook.com -> facebook.com, foo.example.co.uk -> example.co.uk
function getBaseDomain(hostname) {
  if (!hostname) return hostname;
  // IPv4 / IPv6 / single-label hosts: use as-is
  if (hostname.includes(':') || /^[\d.]+$/.test(hostname)) return hostname;

  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (parts.length >= 4 && EFFECTIVE_TLDS.has(last3)) return parts.slice(-4).join('.');
  if (EFFECTIVE_TLDS.has(last2)) return last3;
  return last2;
}

async function clearCookies(url) {
  try {
    const { hostname } = new URL(url);
    const baseDomain = getBaseDomain(hostname);

    // getAll({ domain }) returns cookies for `domain` AND all of its subdomains,
    // which covers the parent-domain cookies (e.g. `.facebook.com`) that the
    // per-hostname query used to miss.
    const cookies = await chrome.cookies.getAll({ domain: baseDomain });

    let removed = 0;
    let failed = 0;

    for (const cookie of cookies) {
      const scheme = cookie.secure ? 'https' : 'http';
      const cleanDomain = cookie.domain.replace(/^\./, '');
      const cookieUrl = `${scheme}://${cleanDomain}${cookie.path || '/'}`;

      const details = { url: cookieUrl, name: cookie.name };
      if (cookie.storeId) details.storeId = cookie.storeId;
      if (cookie.partitionKey) details.partitionKey = cookie.partitionKey;

      try {
        await chrome.cookies.remove(details);
        removed++;
      } catch (_e) {
        failed++;
      }
    }

    return { success: failed === 0, removed, failed };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// This function runs inside the page context (via executeScript)
async function clearPageData(options) {
  const results = {};

  if (options.localStorage) {
    try {
      localStorage.clear();
      results.localStorage = { success: true };
    } catch (e) {
      results.localStorage = { success: false, error: e.message };
    }
  }

  if (options.sessionStorage) {
    try {
      sessionStorage.clear();
      results.sessionStorage = { success: true };
    } catch (e) {
      results.sessionStorage = { success: false, error: e.message };
    }
  }

  if (options.indexedDB) {
    try {
      if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
        const dbs = await indexedDB.databases();
        await Promise.all(
          dbs.map(
            (db) =>
              new Promise((resolve) => {
                const req = indexedDB.deleteDatabase(db.name);
                req.onsuccess = resolve;
                req.onerror = resolve;
                req.onblocked = resolve;
              })
          )
        );
      }
      results.indexedDB = { success: true };
    } catch (e) {
      results.indexedDB = { success: false, error: e.message };
    }
  }

  if (options.cacheStorage) {
    try {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      results.cacheStorage = { success: true };
    } catch (e) {
      results.cacheStorage = { success: false, error: e.message };
    }
  }

  if (options.serviceWorker) {
    try {
      if (navigator.serviceWorker) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((r) => r.unregister()));
      }
      results.serviceWorker = { success: true };
    } catch (e) {
      results.serviceWorker = { success: false, error: e.message };
    }
  }

  return results;
}
