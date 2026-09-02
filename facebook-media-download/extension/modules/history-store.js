// history-store.js — the download history, in the extension's own IndexedDB
// (spec §17). Service worker only.
//
// Metadata only: key, file name, post URL, size, timestamp. Never the bytes, the
// thumbnail or the caption. The file is already in Downloads; keeping a second
// copy of anything sensitive inside the extension would buy nothing and cost the
// user something (spec §19).

(function () {
  'use strict';

  const DB_NAME = 'fbms';
  const DB_VERSION = 1;
  const STORE = 'downloads';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('byDownloadedAt', 'downloadedAt');
          store.createIndex('byPostId', 'postId');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function tx(mode, run) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE, mode);
          const store = transaction.objectStore(STORE);
          let result;
          try {
            result = run(store);
          } catch (err) {
            reject(err);
            return;
          }
          transaction.oncomplete = () => resolve(result && result.__request ? result.__request.result : result);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        })
    );
  }

  function wrap(request) {
    return { __request: request };
  }

  async function put(entry) {
    await tx('readwrite', (store) => wrap(store.put(entry)));
    return entry;
  }

  async function get(key) {
    return tx('readonly', (store) => wrap(store.get(key)));
  }

  // The one call the content script makes on a schedule, so it is a single
  // transaction over N keys rather than N transactions (spec §17).
  async function has(keys) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const found = {};
      for (const key of keys) {
        const request = store.getKey(key);
        request.onsuccess = () => {
          if (request.result !== undefined) found[key] = true;
        };
      }
      transaction.oncomplete = () => resolve(found);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function list({ offset = 0, limit = 50, query = '' } = {}) {
    const db = await open();
    const needle = String(query || '')
      .trim()
      .toLowerCase();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const index = transaction.objectStore(STORE).index('byDownloadedAt');
      const items = [];
      let total = 0;

      // Newest first, and the cursor is walked rather than the whole store read:
      // a 5000-entry history should not be materialised to show 50 rows.
      index.openCursor(null, 'prev').onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) return;
        const entry = cursor.value;
        const haystack = `${entry.filename} ${entry.author || ''} ${entry.postUrl || ''}`.toLowerCase();
        if (!needle || haystack.includes(needle)) {
          if (total >= offset && items.length < limit) items.push(entry);
          total++;
        }
        cursor.continue();
      };

      transaction.oncomplete = () => resolve({ items, total });
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function count() {
    return tx('readonly', (store) => wrap(store.count()));
  }

  // Entries older than the limit go, oldest first. Called after every write; the
  // cursor stops as soon as the surplus is gone.
  async function trim(limit) {
    if (!limit) return;
    const total = await count();
    let surplus = total - limit;
    if (surplus <= 0) return;

    const db = await open();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const index = transaction.objectStore(STORE).index('byDownloadedAt');
      index.openCursor().onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor || surplus <= 0) return;
        cursor.delete();
        surplus--;
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function remove(key) {
    await tx('readwrite', (store) => wrap(store.delete(key)));
    return { ok: true };
  }

  async function clear() {
    await tx('readwrite', (store) => wrap(store.clear()));
    return { ok: true };
  }

  async function stats() {
    const db = await open();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const totalRequest = store.count();
      const todayRequest = store.index('byDownloadedAt').count(IDBKeyRange.lowerBound(startOfDay.getTime()));
      transaction.oncomplete = () => resolve({ total: totalRequest.result || 0, today: todayRequest.result || 0 });
      transaction.onerror = () => reject(transaction.error);
    });
  }

  globalThis.HistoryStore = { put, get, has, list, count, trim, remove, clear, stats };
})();
