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

  // 3. browsingData API as fallback/supplement for IndexedDB, Cache, SW
  //    Runs after page injection to catch data the script may have missed
  const browsingDataTypes = {};
  if (options.indexedDB) browsingDataTypes.indexedDB = true;
  if (options.cacheStorage) browsingDataTypes.cacheStorage = true;
  if (options.serviceWorker) browsingDataTypes.serviceWorkers = true;
  if (options.localStorage) browsingDataTypes.localStorage = true;

  if (Object.keys(browsingDataTypes).length > 0) {
    try {
      await chrome.browsingData.remove({ origins: [origin] }, browsingDataTypes);
    } catch (_err) {
      // browsingData is supplementary; page script already attempted these
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

async function clearCookies(url) {
  try {
    const { hostname } = new URL(url);
    const domains = [hostname, `.${hostname}`];
    const seen = new Set();

    for (const domain of domains) {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const cookie of cookies) {
        const key = `${cookie.domain}::${cookie.path}::${cookie.name}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const scheme = cookie.secure ? 'https' : 'http';
        const cleanDomain = cookie.domain.replace(/^\./, '');
        const cookieUrl = `${scheme}://${cleanDomain}${cookie.path}`;

        try {
          await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
        } catch (_e) {
          // skip individual cookie removal failures
        }
      }
    }
    return { success: true };
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
