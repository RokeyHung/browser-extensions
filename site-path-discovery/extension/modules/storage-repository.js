// storage-repository.js — the single place that touches chrome.storage.local.
// Stores site records, path records (keyed by site + normalizedUrl), crawl
// sessions, recording state and user settings. Never stores cookies, tokens,
// storage or response bodies (spec §11, §17).

(function () {
  'use strict';

  const KEYS = {
    sites: 'sites', // { [siteId]: siteRecord }
    paths: 'paths', // { [siteId]: { [normalizedUrl]: pathRecord } }
    crawls: 'crawls', // { [siteId]: crawlSession[] }
    recording: 'recording', // { [siteId]: true }
    settings: 'settings',
  };

  const DEFAULT_SETTINGS = {
    scope: 'same-origin', // 'same-origin' | 'same-site' | 'any'
    queryMode: 'query-keys-only', // 'ignore' | 'query-keys-only' | 'keep-full'
    includeHash: false,
    removeTrailingSlash: true,
    sortQuery: true,
    crawl: {
      scope: 'same-origin',
      maxDepth: 2,
      maxPages: 100,
      requestDelayMs: 500,
      respectRobotsTxt: true,
      includeQueryParams: false,
    },
  };

  const MAX_PATHS_PER_SITE = 20000;

  function newId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  }

  async function readKey(key, fallback) {
    const stored = await chrome.storage.local.get(key);
    return stored[key] === undefined ? fallback : stored[key];
  }

  // ── Settings ────────────────────────────────────────────────────────────────
  async function getSettings() {
    const stored = await readKey(KEYS.settings, {});
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      crawl: { ...DEFAULT_SETTINGS.crawl, ...(stored.crawl || {}) },
    };
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const merged = { ...current, ...patch, crawl: { ...current.crawl, ...(patch && patch.crawl) } };
    await chrome.storage.local.set({ [KEYS.settings]: merged });
    return merged;
  }

  // ── Sites ─────────────────────────────────────────────────────────────────
  async function getSites() {
    return readKey(KEYS.sites, {});
  }

  async function getSite(siteId) {
    const sites = await getSites();
    return sites[siteId] || null;
  }

  // Ensure a site record exists for an origin; returns it.
  async function ensureSite({ siteId, origin, hostname }) {
    const sites = await getSites();
    const now = new Date().toISOString();
    if (!sites[siteId]) {
      const settings = await getSettings();
      sites[siteId] = {
        siteId,
        origin,
        hostname,
        createdAt: now,
        updatedAt: now,
        settings: {
          scope: settings.scope,
          queryMode: settings.queryMode,
          includeHash: settings.includeHash,
        },
      };
    } else {
      sites[siteId].updatedAt = now;
    }
    await chrome.storage.local.set({ [KEYS.sites]: sites });
    return sites[siteId];
  }

  async function deleteSite(siteId) {
    const [sites, paths, crawls, recording] = await Promise.all([
      getSites(),
      readKey(KEYS.paths, {}),
      readKey(KEYS.crawls, {}),
      readKey(KEYS.recording, {}),
    ]);
    delete sites[siteId];
    delete paths[siteId];
    delete crawls[siteId];
    delete recording[siteId];
    await chrome.storage.local.set({
      [KEYS.sites]: sites,
      [KEYS.paths]: paths,
      [KEYS.crawls]: crawls,
      [KEYS.recording]: recording,
    });
  }

  // ── Path records ────────────────────────────────────────────────────────────
  async function getPathsMap(siteId) {
    const all = await readKey(KEYS.paths, {});
    return all[siteId] || {};
  }

  async function getPaths(siteId) {
    const map = await getPathsMap(siteId);
    return Object.values(map);
  }

  // Upsert a batch of discovered records for one site. Deduplicates by
  // normalizedUrl, merging source/discoveredFrom and bumping seenCount (spec §16.6).
  // Each incoming record: { normalizedUrl, url, origin, hostname, path, queryKeys,
  //   type, method, resourceType, source, statusCode, discoveredFrom, metadata,
  //   lastmod, robotsDirective }
  // Returns { added, updated, total }.
  async function upsertPaths(siteId, records) {
    if (!Array.isArray(records) || records.length === 0) {
      const map = await getPathsMap(siteId);
      return { added: 0, updated: 0, total: Object.keys(map).length };
    }

    const all = await readKey(KEYS.paths, {});
    const map = all[siteId] || {};
    const now = new Date().toISOString();
    let added = 0;
    let updated = 0;

    for (const rec of records) {
      if (!rec || !rec.normalizedUrl) continue;
      const key = rec.normalizedUrl;
      const existing = map[key];

      if (!existing) {
        if (Object.keys(map).length >= MAX_PATHS_PER_SITE) continue;
        map[key] = {
          id: newId('path'),
          siteId,
          url: rec.url || rec.normalizedUrl,
          normalizedUrl: key,
          origin: rec.origin || '',
          hostname: rec.hostname || '',
          path: rec.path || '/',
          queryKeys: rec.queryKeys || [],
          type: rec.type || 'page',
          method: rec.method || null,
          resourceType: rec.resourceType || null,
          source: uniqArray(asArray(rec.source)),
          statusCode: rec.statusCode != null ? rec.statusCode : null,
          firstSeenAt: rec.timestamp || now,
          lastSeenAt: rec.timestamp || now,
          seenCount: 1,
          discoveredFrom: uniqArray(asArray(rec.discoveredFrom)),
          metadata: rec.metadata || {},
          lastmod: rec.lastmod || null,
          robotsDirective: rec.robotsDirective || null,
        };
        added++;
      } else {
        existing.lastSeenAt = rec.timestamp || now;
        existing.seenCount = (existing.seenCount || 1) + 1;
        existing.source = uniqArray([...(existing.source || []), ...asArray(rec.source)]);
        existing.discoveredFrom = uniqArray([...(existing.discoveredFrom || []), ...asArray(rec.discoveredFrom)]).slice(0, 25);
        if (rec.method && !existing.method) existing.method = rec.method;
        if (rec.statusCode != null) existing.statusCode = rec.statusCode;
        if (rec.resourceType && !existing.resourceType) existing.resourceType = rec.resourceType;
        if (rec.lastmod && !existing.lastmod) existing.lastmod = rec.lastmod;
        if (rec.robotsDirective && !existing.robotsDirective) existing.robotsDirective = rec.robotsDirective;
        // Prefer a more specific type over a generic "page" guess.
        if (rec.type && existing.type === 'page' && rec.type !== 'page') existing.type = rec.type;
        if (rec.metadata) existing.metadata = { ...existing.metadata, ...rec.metadata };
        updated++;
      }
    }

    all[siteId] = map;
    await chrome.storage.local.set({ [KEYS.paths]: all });
    return { added, updated, total: Object.keys(map).length };
  }

  async function clearPaths(siteId) {
    const all = await readKey(KEYS.paths, {});
    delete all[siteId];
    await chrome.storage.local.set({ [KEYS.paths]: all });
  }

  // ── Crawl sessions ──────────────────────────────────────────────────────────
  async function getCrawls(siteId) {
    const all = await readKey(KEYS.crawls, {});
    return all[siteId] || [];
  }

  async function saveCrawl(siteId, session) {
    const all = await readKey(KEYS.crawls, {});
    const list = all[siteId] || [];
    const idx = list.findIndex((c) => c.id === session.id);
    if (idx === -1) list.unshift(session);
    else list[idx] = session;
    all[siteId] = list.slice(0, 20);
    await chrome.storage.local.set({ [KEYS.crawls]: all });
    return session;
  }

  // ── Recording state ─────────────────────────────────────────────────────────
  async function getRecordingState() {
    return readKey(KEYS.recording, {});
  }

  async function isRecording(siteId) {
    const state = await getRecordingState();
    return !!state[siteId];
  }

  async function setRecording(siteId, on) {
    const state = await getRecordingState();
    if (on) state[siteId] = true;
    else delete state[siteId];
    await chrome.storage.local.set({ [KEYS.recording]: state });
    return !!state[siteId];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function asArray(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v.filter(Boolean) : [v];
  }
  function uniqArray(arr) {
    return [...new Set(arr.filter(Boolean))];
  }

  globalThis.StorageRepo = {
    KEYS,
    DEFAULT_SETTINGS,
    newId,
    getSettings,
    saveSettings,
    getSites,
    getSite,
    ensureSite,
    deleteSite,
    getPaths,
    getPathsMap,
    upsertPaths,
    clearPaths,
    getCrawls,
    saveCrawl,
    getRecordingState,
    isRecording,
    setRecording,
  };
})();
