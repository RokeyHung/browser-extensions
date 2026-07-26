// background.js — MV3 service worker. Routes every read/write to the right
// backend: injected page functions for web storage & IndexedDB, chrome.cookies
// for cookies, chrome.storage.local for snapshots. Spec §4, §10.

importScripts('modules/page-agent.js', 'modules/cookie-manager.js', 'modules/snapshot-store.js');

// ─── Target tab ─────────────────────────────────────────────────────────────────

function isSupportedUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

async function getTarget(tabId) {
  let tab = null;
  if (tabId != null) {
    tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('Target tab is gone. Pick another tab.');
  } else {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');
  }

  if (!isSupportedUrl(tab.url)) throw new Error('This tab is not an http(s) page.');

  const parsed = new URL(tab.url);
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title || parsed.hostname,
    origin: parsed.origin,
    hostname: parsed.hostname,
  };
}

// Web storage and IndexedDB are per-frame APIs; always target the top frame.
async function runInPage(tabId, func, args = []) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func, args });
    return results?.[0]?.result;
  } catch (err) {
    throw new Error(`Cannot read this page (${err.message})`);
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────────

async function listTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title || '',
    url: tab.url,
    hostname: new URL(tab.url).hostname,
    active: !!tab.active,
  }));
}

async function readAll(tabId) {
  const context = await getTarget(tabId);
  const [web, cookies] = await Promise.all([
    runInPage(context.tabId, PageAgent.readWebStorage, [['local', 'session']]),
    CookieManager.list(context.url).catch((err) => ({ error: err.message })),
  ]);

  return {
    context,
    local: web?.local || { ok: false, error: 'No response from page', entries: [] },
    session: web?.session || { ok: false, error: 'No response from page', entries: [] },
    cookies: Array.isArray(cookies) ? { ok: true, entries: cookies } : { ok: false, error: cookies.error, entries: [] },
  };
}

async function readIndexedDB(tabId) {
  const context = await getTarget(tabId);
  return runInPage(context.tabId, PageAgent.listIndexedDB, []);
}

async function readIdbStore(tabId, dbName, storeName, limit) {
  const context = await getTarget(tabId);
  const settings = await SnapshotStore.getSettings();
  return runInPage(context.tabId, PageAgent.readIdbStore, [{ dbName, storeName, limit: limit || settings.idbRecordLimit }]);
}

async function deleteIdbDatabase(tabId, name) {
  const context = await getTarget(tabId);
  const result = await runInPage(context.tabId, PageAgent.deleteIdbDatabase, [{ name }]);
  if (!result?.ok) throw new Error(result?.error || 'Delete failed');
  return result;
}

// ─── Web storage writes ─────────────────────────────────────────────────────────

async function setEntry({ tabId, area, key, value, previousKey }) {
  if (!key) throw new Error('Key cannot be empty');
  const context = await getTarget(tabId);
  const result = await runInPage(context.tabId, PageAgent.writeEntry, [{ area, key, value: String(value ?? ''), previousKey }]);
  if (!result?.ok) throw new Error(result?.error || 'Write failed');
  return result;
}

async function deleteEntry({ tabId, area, key }) {
  const context = await getTarget(tabId);
  const result = await runInPage(context.tabId, PageAgent.deleteEntry, [{ area, key }]);
  if (!result?.ok) throw new Error(result?.error || 'Delete failed');
  return result;
}

async function clearArea({ tabId, area }) {
  const context = await getTarget(tabId);

  if (area === 'cookies') return CookieManager.clear(context.url);

  const result = await runInPage(context.tabId, PageAgent.clearArea, [{ area }]);
  if (!result?.ok) throw new Error(result?.error || 'Clear failed');
  return result;
}

// ─── Cookie writes ──────────────────────────────────────────────────────────────

async function setCookie({ tabId, cookie, previous }) {
  if (!cookie?.name) throw new Error('Cookie name cannot be empty');
  const context = await getTarget(tabId);
  // A new cookie without an explicit domain belongs to the current host.
  const withDomain = { ...cookie, domain: cookie.domain || context.hostname };
  return CookieManager.set(withDomain, previous);
}

async function deleteCookie({ tabId, cookie }) {
  await getTarget(tabId);
  return CookieManager.remove(cookie);
}

// ─── Snapshots ──────────────────────────────────────────────────────────────────

async function createSnapshot({ tabId, name, note, parts }) {
  const context = await getTarget(tabId);
  const settings = await SnapshotStore.getSettings();
  const includes = {
    local: parts?.local !== false,
    session: parts?.session !== false,
    cookies: parts?.cookies !== false && settings.includeCookiesInSnapshot,
  };

  const areas = [];
  if (includes.local) areas.push('local');
  if (includes.session) areas.push('session');

  const data = { local: [], session: [], cookies: [] };

  if (areas.length) {
    const web = await runInPage(context.tabId, PageAgent.readWebStorage, [areas]);
    for (const area of areas) {
      const result = web?.[area];
      if (!result?.ok) throw new Error(result?.error || `Could not read ${area}Storage`);
      data[area] = result.entries.map((entry) => ({ key: entry.key, value: entry.value }));
    }
  }

  if (includes.cookies) data.cookies = await CookieManager.list(context.url);

  return SnapshotStore.create({
    name,
    note,
    origin: context.origin,
    hostname: context.hostname,
    data,
    includes,
  });
}

async function restoreSnapshot({ tabId, snapshotId, mode = 'merge', parts, reload }) {
  const context = await getTarget(tabId);
  const snapshot = await SnapshotStore.get(snapshotId);
  if (!snapshot) throw new Error('Snapshot not found');

  const wanted = {
    local: parts?.local !== false && snapshot.includes.local,
    session: parts?.session !== false && snapshot.includes.session,
    cookies: parts?.cookies !== false && snapshot.includes.cookies,
  };

  const report = {
    origin: context.origin,
    originMismatch: snapshot.origin !== context.origin,
    mode,
    local: null,
    session: null,
    cookies: null,
    reloaded: false,
  };

  for (const area of ['local', 'session']) {
    if (!wanted[area]) continue;
    const result = await runInPage(context.tabId, PageAgent.restoreWebStorage, [{ area, mode, entries: snapshot.data[area] || [] }]);
    if (!result?.ok) throw new Error(result?.error || `Could not restore ${area}Storage`);
    report[area] = { written: result.written, failed: result.failed };
  }

  if (wanted.cookies) {
    report.cookies = await CookieManager.restore(context.url, snapshot.data.cookies || [], mode);
  }

  // Apps read storage at boot, so a reload is what actually applies the state.
  if (reload) {
    await chrome.tabs.reload(context.tabId).catch(() => {});
    report.reloaded = true;
  }

  return report;
}

// ─── Popup summary ──────────────────────────────────────────────────────────────

async function getPopupData(tabId) {
  const context = await getTarget(tabId);
  const [web, cookies, idb, snapshots] = await Promise.all([
    runInPage(context.tabId, PageAgent.readWebStorage, [['local', 'session']]).catch(() => null),
    CookieManager.list(context.url).catch(() => []),
    runInPage(context.tabId, PageAgent.listIndexedDB, []).catch(() => null),
    SnapshotStore.list(context.origin),
  ]);

  return {
    context,
    counts: {
      local: web?.local?.entries?.length ?? 0,
      session: web?.session?.entries?.length ?? 0,
      cookies: cookies.length,
      idb: idb?.ok ? idb.databases.length : 0,
    },
    errors: {
      local: web?.local?.ok === false ? web.local.error : null,
      session: web?.session?.ok === false ? web.session.error : null,
    },
    snapshots: snapshots.map((item) => ({ id: item.id, name: item.name, createdAt: item.createdAt, stats: item.stats })),
  };
}

// ─── Messages ───────────────────────────────────────────────────────────────────

const HANDLERS = {
  getContext: (msg) => getTarget(msg.tabId),
  listTabs: () => listTabs(),
  getPopupData: (msg) => getPopupData(msg.tabId),
  readAll: (msg) => readAll(msg.tabId),
  readIndexedDB: (msg) => readIndexedDB(msg.tabId),
  readIdbStore: (msg) => readIdbStore(msg.tabId, msg.dbName, msg.storeName, msg.limit),
  deleteIdbDatabase: (msg) => deleteIdbDatabase(msg.tabId, msg.name),
  setEntry: (msg) => setEntry(msg),
  deleteEntry: (msg) => deleteEntry(msg),
  clearArea: (msg) => clearArea(msg),
  setCookie: (msg) => setCookie(msg),
  deleteCookie: (msg) => deleteCookie(msg),
  createSnapshot: (msg) => createSnapshot(msg),
  listSnapshots: (msg) => SnapshotStore.list(msg.origin),
  getSnapshot: (msg) => SnapshotStore.get(msg.snapshotId),
  restoreSnapshot: (msg) => restoreSnapshot(msg),
  renameSnapshot: (msg) => {
    const patch = {};
    if (msg.name !== undefined) patch.name = msg.name;
    if (msg.note !== undefined) patch.note = msg.note;
    return SnapshotStore.update(msg.snapshotId, patch);
  },
  deleteSnapshot: (msg) => SnapshotStore.remove(msg.snapshotId),
  exportSnapshots: (msg) => SnapshotStore.exportSnapshots(msg.snapshotIds),
  importSnapshots: (msg) => SnapshotStore.importSnapshots(msg.payload),
  getSettings: () => SnapshotStore.getSettings(),
  saveSettings: (msg) => SnapshotStore.saveSettings(msg.patch),
  openDashboard: (msg) => chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?tabId=${msg.tabId}`) }),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  Promise.resolve(handler(message))
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // keep the message channel open for the async response
});
