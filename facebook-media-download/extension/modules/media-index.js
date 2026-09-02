// media-index.js — keeps the harvested media records and joins them back to the
// element the user clicked (spec §6.4). Isolated world, memory only.
//
// This map is a list of what the user has just been looking at on Facebook. It is
// the most sensitive thing the extension touches, so it never reaches disk: no
// chrome.storage, no IndexedDB, gone with the tab (spec §19).

(function () {
  'use strict';

  const TTL = 30 * 60 * 1000;
  const MAX_GROUPS = 500;

  // group: { records: [], touched: number, aliases: Set<string> }
  const groups = new Map();
  const aliases = new Map(); // alias key -> primary key
  const counts = { dom: 0, embedded: 0, graphql: 0 };
  let lastError = null;

  // Two URLs for the same photo differ only in the server-side transform
  // (`stp=dst-jpg_p600x600`), so the pathname is identical across sizes. That is
  // what makes it possible to click a feed thumbnail and get the large copy that
  // arrived in a GraphQL payload (spec §6.4, step 3).
  function pathKeyOf(url) {
    try {
      return `p:${new URL(url).pathname}`;
    } catch (err) {
      return null;
    }
  }

  // The CDN file name carries a content hash plus a size suffix (`…_n.jpg`,
  // `…_s.jpg`). Stripping the suffix joins variants that were served from
  // slightly different paths.
  function hashKeyOf(url) {
    try {
      const segment = new URL(url).pathname.split('/').pop() || '';
      const bare = segment.replace(/\.[a-z0-9]+$/i, '').replace(/_[a-z]$/i, '');
      return bare.length >= 8 ? `h:${bare}` : null;
    } catch (err) {
      return null;
    }
  }

  function idKeyOf(mediaId) {
    return mediaId ? `id:${mediaId}` : null;
  }

  function touch(key) {
    const group = groups.get(key);
    if (!group) return null;
    // Re-inserting moves the entry to the end: Map iteration order is insertion
    // order, which makes the first entry the least recently used.
    groups.delete(key);
    group.touched = Date.now();
    groups.set(key, group);
    return group;
  }

  function evict() {
    const cutoff = Date.now() - TTL;
    for (const [key, group] of groups) {
      // Iteration runs oldest-first, so the first entry that is both fresh and
      // within budget means everything after it is too.
      if (groups.size <= MAX_GROUPS && group.touched >= cutoff) break;
      groups.delete(key);
      for (const alias of group.aliases) {
        if (aliases.get(alias) === key) aliases.delete(alias);
      }
    }
  }

  function resolveKey(keys) {
    for (const key of keys) {
      if (!key) continue;
      if (groups.has(key)) return key;
      const primary = aliases.get(key);
      if (primary && groups.has(primary)) return primary;
    }
    return null;
  }

  function merge(intoKey, fromKey) {
    if (intoKey === fromKey) return;
    const target = groups.get(intoKey);
    const source = groups.get(fromKey);
    if (!target || !source) return;
    target.records.push(...source.records);
    for (const alias of source.aliases) {
      target.aliases.add(alias);
      aliases.set(alias, intoKey);
    }
    groups.delete(fromKey);
    aliases.set(fromKey, intoKey);
  }

  function keysFor(record) {
    const keys = [idKeyOf(record.mediaId)];
    if (record.url) keys.push(pathKeyOf(record.url), hashKeyOf(record.url));
    return keys.filter(Boolean);
  }

  function put(records) {
    for (const record of records || []) {
      if (!record || (!record.url && !record.dashOnly)) continue;
      if (record.expiresAt && record.expiresAt < Date.now()) continue;

      const keys = keysFor(record);
      if (!keys.length) continue;

      // An id always wins as the primary key; it is the one that survives the
      // page re-rendering the same photo at a different size.
      const primary = resolveKey(keys) || keys[0];
      if (!groups.has(primary)) groups.set(primary, { records: [], touched: Date.now(), aliases: new Set() });

      for (const key of keys) {
        const existing = resolveKey([key]);
        if (existing && existing !== primary) merge(primary, existing);
        aliases.set(key, primary);
        groups.get(primary).aliases.add(key);
      }

      const group = touch(primary);
      if (group.records.some((existing) => existing.url === record.url && existing.dashOnly === record.dashOnly)) continue;
      group.records.push(record);
    }

    evict();
  }

  // Records for a media, best first. `urls` are the URLs visible in the DOM for
  // that element; they are only join keys, never the answer on their own.
  function lookup({ mediaId, urls }) {
    const keys = [idKeyOf(mediaId)];
    for (const url of urls || []) keys.push(pathKeyOf(url), hashKeyOf(url));

    const key = resolveKey(keys);
    if (!key) return [];

    const group = touch(key);
    const fresh = group.records.filter((record) => !record.expiresAt || record.expiresAt > Date.now());
    return fresh.slice().sort((a, b) => (b.rank || 0) - (a.rank || 0));
  }

  function noteCounts(next, error) {
    if (next) Object.assign(counts, next);
    if (error !== undefined) lastError = error;
  }

  function stats() {
    return { counts: { ...counts }, groups: groups.size, lastError };
  }

  globalThis.MediaIndex = { put, lookup, stats, noteCounts, pathKeyOf, hashKeyOf, TTL, MAX_GROUPS };
})();
