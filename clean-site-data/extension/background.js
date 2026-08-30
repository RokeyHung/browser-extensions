importScripts('./domain-utils.js');

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

  // 0. Work out which domains this run is allowed to touch.
  const scope = await resolveScope(url, origin, !!options.wildcardDomains);

  // 1. Cookies (via chrome.cookies API)
  //    Cleared across the whole registrable domain (eTLD+1) — parent domain and
  //    every subdomain — not just the exact hostname of the tab. This is what
  //    actually logs you out of sites like Facebook, whose auth cookies live on
  //    `.facebook.com` while the tab is on `www.facebook.com`.
  if (options.cookies) {
    results.cookies = await clearCookies(scope);
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

    // Other open tabs inside the scope are cleaned best-effort and do not
    // change what the popup reports. Worth doing because sessionStorage lives
    // per tab and `browsingData` cannot reach it at all.
    for (const otherTabId of scope.tabIds) {
      if (otherTabId === tabId) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: otherTabId },
          func: clearPageData,
          args: [pageOptions],
        });
      } catch (_err) {
        // tab may be discarded, protected or navigating — skip it
      }
    }
  }

  // 3. browsingData API scoped to every origin in the scope.
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
      await chrome.browsingData.remove({ origins: scope.origins }, dataToRemove);
    } catch (_err) {
      // One bad origin rejects the whole call, so fall back to the tab's own
      // origin, which is the case that matters most.
      try {
        await chrome.browsingData.remove({ origins: [origin] }, dataToRemove);
      } catch (_e) {
        // browsingData is supplementary; the steps above already attempted these
      }
    }
  }

  // 4. Send the tab back to the site's homepage (origin root), e.g. a tab on
  //    https://animevsub.vn/phim/abc-123 lands on https://animevsub.vn/.
  //    Deep links often 404 or bounce to a login wall once the session is gone,
  //    so the homepage is the reliable place to land after cleaning.
  let reloaded = false;
  let navigatedTo = null;
  if (options.reload) {
    const homeUrl = getHomeUrl(url, origin);
    try {
      if (homeUrl && !isSameUrl(url, homeUrl)) {
        await chrome.tabs.update(tabId, { url: homeUrl });
        navigatedTo = homeUrl;
      } else {
        await chrome.tabs.reload(tabId);
        navigatedTo = homeUrl || url;
      }
      reloaded = true;
    } catch (_err) {
      // non-critical
    }
  }

  return {
    results,
    reloaded,
    navigatedTo,
    scope: { pattern: scope.pattern, hosts: scope.hosts, wildcard: scope.wildcard },
  };
}

// What this run is allowed to touch.
// - Default: the site's registrable domain (eTLD+1) and its subdomains, e.g. a
//   tab on `www.facebook.com` covers `facebook.com` and `m.facebook.com`.
// - Wildcard (`*.site.*`): every domain sharing the site's label, on any
//   subdomain and any TLD — so `facebook.com.vn` and `login.facebook.net` come
//   along too. Chrome has no API that enumerates storage origins, so the host
//   list is built from the two places a site actually shows up: the cookie jar
//   and the open tabs.
async function resolveScope(url, origin, wildcard) {
  const { hostname } = new URL(url);
  const siteLabel = wildcard ? getSiteLabel(hostname) : null;
  // A host with no site label (IP, localhost) has nothing to widen to.
  const effectiveWildcard = !!siteLabel;

  const cookies = await getScopedCookies(hostname, siteLabel);

  const hosts = new Set([hostname]);
  for (const cookie of cookies) {
    const host = cookieHost(cookie);
    if (host) hosts.add(host);
  }

  const tabIds = [];
  if (effectiveWildcard) {
    for (const tab of await getMatchingTabs(siteLabel)) {
      hosts.add(new URL(tab.url).hostname);
      tabIds.push(tab.id);
    }
  }

  // `origins` needs full origins. The tab's own origin keeps its scheme and
  // port; the hosts discovered around it are addressed over https, which is
  // what they are served on in practice.
  const origins = new Set([origin]);
  for (const host of hosts) origins.add(`https://${host}`);

  return {
    hostname,
    cookies,
    tabIds,
    hosts: [...hosts],
    origins: [...origins],
    wildcard: effectiveWildcard,
    pattern: effectiveWildcard ? `*.${siteLabel}.*` : getBaseDomain(hostname),
  };
}

// Cookies inside the scope. `getAll({ domain })` already covers a domain plus
// all of its subdomains, but it cannot express "any TLD", so the wildcard case
// reads the jar once and filters it by site label.
async function getScopedCookies(hostname, siteLabel) {
  try {
    if (!siteLabel) {
      return await chrome.cookies.getAll({ domain: getBaseDomain(hostname) });
    }
    const all = await chrome.cookies.getAll({});
    return all.filter((cookie) => matchesSiteLabel(cookieHost(cookie), siteLabel));
  } catch (_err) {
    return [];
  }
}

// Open http(s) tabs whose host belongs to the same site label.
async function getMatchingTabs(siteLabel) {
  try {
    const tabs = await chrome.tabs.query({});
    return tabs.filter((tab) => {
      if (!tab.id || !tab.url) return false;
      try {
        const { protocol, hostname } = new URL(tab.url);
        if (protocol !== 'http:' && protocol !== 'https:') return false;
        return matchesSiteLabel(hostname, siteLabel);
      } catch (_err) {
        return false;
      }
    });
  } catch (_err) {
    return [];
  }
}

// Root URL of the site the tab is on. Keeps the scheme and the exact hostname
// (including subdomain) and drops path, query and hash.
function getHomeUrl(url, origin) {
  try {
    return `${new URL(url).origin}/`;
  } catch (_err) {
    return origin ? `${origin}/` : null;
  }
}

// True when the tab is effectively already sitting on the homepage, so we should
// force a reload instead of a same-URL navigation Chrome may serve from cache.
function isSameUrl(current, homeUrl) {
  try {
    const a = new URL(current);
    return a.pathname === '/' && !a.search && `${a.origin}/` === homeUrl;
  } catch (_err) {
    return false;
  }
}

// Remove every cookie the scope collected. Scope resolution already decided
// which domains those are (registrable domain, or `*.site.*` when the wildcard
// option is on).
async function clearCookies(scope) {
  try {
    let removed = 0;
    let failed = 0;

    for (const cookie of scope.cookies) {
      const scheme = cookie.secure ? 'https' : 'http';
      const cookieUrl = `${scheme}://${cookieHost(cookie)}${cookie.path || '/'}`;

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
