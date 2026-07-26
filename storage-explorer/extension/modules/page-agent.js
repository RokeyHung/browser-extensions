// page-agent.js — functions that run inside the page context via
// chrome.scripting.executeScript. Spec §4, §7.1, §7.3.
//
// IMPORTANT: Chrome serializes these with Function.prototype.toString(), so each
// exported function must be SELF-CONTAINED — no references to module scope, no
// shared helpers. Duplication here is deliberate.

if (typeof PageAgent === 'undefined') {
  var PageAgent = (() => {
    // Read every entry of the requested web storage areas.
    // areas: ('local' | 'session')[]
    function readWebStorage(areas) {
      const encoder = new TextEncoder();
      const out = {};

      for (const area of areas) {
        try {
          const store = area === 'session' ? window.sessionStorage : window.localStorage;
          const entries = [];
          for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (key === null) continue;
            const value = store.getItem(key) ?? '';
            entries.push({ key, value, size: encoder.encode(key).length + encoder.encode(value).length });
          }
          out[area] = { ok: true, entries };
        } catch (err) {
          // Storage can throw when the site runs with cookies blocked or inside
          // a sandboxed frame. Keep the other area usable.
          out[area] = { ok: false, error: err.message, entries: [] };
        }
      }

      return out;
    }

    // Create or update one entry. `previousKey` renames (delete + set).
    function writeEntry(payload) {
      try {
        const store = payload.area === 'session' ? window.sessionStorage : window.localStorage;
        if (payload.previousKey && payload.previousKey !== payload.key) store.removeItem(payload.previousKey);
        store.setItem(payload.key, payload.value);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    function deleteEntry(payload) {
      try {
        const store = payload.area === 'session' ? window.sessionStorage : window.localStorage;
        store.removeItem(payload.key);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    function clearArea(payload) {
      try {
        const store = payload.area === 'session' ? window.sessionStorage : window.localStorage;
        const removed = store.length;
        store.clear();
        return { ok: true, removed };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // Restore snapshot entries. mode: 'merge' keeps untouched keys, 'replace'
    // wipes the area first. Spec §8.2.
    function restoreWebStorage(payload) {
      try {
        const store = payload.area === 'session' ? window.sessionStorage : window.localStorage;
        if (payload.mode === 'replace') store.clear();
        let written = 0;
        const failed = [];
        for (const entry of payload.entries) {
          try {
            store.setItem(entry.key, entry.value);
            written++;
          } catch (err) {
            failed.push({ key: entry.key, error: err.message });
          }
        }
        return { ok: true, written, failed };
      } catch (err) {
        return { ok: false, error: err.message, written: 0, failed: [] };
      }
    }

    // List IndexedDB databases with their object stores and record counts.
    // Opens each database without a version so no upgrade is triggered.
    async function listIndexedDB() {
      if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
        return { ok: false, error: 'This browser cannot list IndexedDB databases', databases: [] };
      }

      let infos;
      try {
        infos = await indexedDB.databases();
      } catch (err) {
        return { ok: false, error: err.message, databases: [] };
      }

      const databases = [];
      for (const info of infos) {
        if (!info || !info.name) continue;

        const db = await new Promise((resolve) => {
          let settled = false;
          const done = (value) => {
            if (!settled) {
              settled = true;
              resolve(value);
            }
          };
          try {
            const req = indexedDB.open(info.name);
            req.onsuccess = () => done(req.result);
            req.onerror = () => done(null);
            req.onblocked = () => done(null);
            setTimeout(() => done(null), 3000);
          } catch (_err) {
            done(null);
          }
        });

        if (!db) {
          databases.push({ name: info.name, version: info.version ?? null, stores: [], error: 'Could not open database' });
          continue;
        }

        const stores = [];
        for (const storeName of Array.from(db.objectStoreNames)) {
          const count = await new Promise((resolve) => {
            try {
              const req = db.transaction(storeName, 'readonly').objectStore(storeName).count();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => resolve(null);
            } catch (_err) {
              resolve(null);
            }
          });
          stores.push({ name: storeName, count });
        }

        databases.push({ name: db.name, version: db.version, stores });
        db.close();
      }

      return { ok: true, databases };
    }

    // Read up to `limit` records of one object store. Values are stringified in
    // the page because executeScript results must be JSON-serializable.
    async function readIdbStore(payload) {
      const describe = (value, depth) => {
        if (value === null || value === undefined) return value === null ? null : undefined;
        if (typeof value === 'bigint') return `${value}n`;
        if (typeof value !== 'object') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof Blob !== 'undefined' && value instanceof Blob) return `[Blob ${value.size} bytes${value.type ? ' ' + value.type : ''}]`;
        if (typeof File !== 'undefined' && value instanceof File) return `[File ${value.name} ${value.size} bytes]`;
        if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
        if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength} bytes]`;
        if (value instanceof Map) return `[Map ${value.size} entries]`;
        if (value instanceof Set) return `[Set ${value.size} entries]`;
        if (depth > 4) return '[…]';
        if (Array.isArray(value)) return value.slice(0, 200).map((item) => describe(item, depth + 1));
        const out = {};
        for (const key of Object.keys(value)) {
          try {
            out[key] = describe(value[key], depth + 1);
          } catch (_err) {
            out[key] = '[unreadable]';
          }
        }
        return out;
      };

      const db = await new Promise((resolve) => {
        try {
          const req = indexedDB.open(payload.dbName);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (_err) {
          resolve(null);
        }
      });

      if (!db) return { ok: false, error: 'Could not open database', records: [] };
      if (!db.objectStoreNames.contains(payload.storeName)) {
        db.close();
        return { ok: false, error: 'Object store not found', records: [] };
      }

      const limit = payload.limit || 100;
      const records = [];
      let truncated = false;

      try {
        await new Promise((resolve, reject) => {
          const req = db.transaction(payload.storeName, 'readonly').objectStore(payload.storeName).openCursor();
          req.onerror = () => reject(new Error(req.error ? req.error.message : 'Cursor failed'));
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return resolve();
            if (records.length >= limit) {
              truncated = true;
              return resolve();
            }
            let json;
            try {
              json = JSON.stringify(describe(cursor.value, 0), null, 2);
            } catch (err) {
              json = `[unserializable: ${err.message}]`;
            }
            records.push({ key: String(cursor.key), value: json ?? 'undefined' });
            cursor.continue();
          };
        });
      } catch (err) {
        db.close();
        return { ok: false, error: err.message, records };
      }

      db.close();
      return { ok: true, records, truncated };
    }

    function deleteIdbDatabase(payload) {
      return new Promise((resolve) => {
        try {
          const req = indexedDB.deleteDatabase(payload.name);
          req.onsuccess = () => resolve({ ok: true, blocked: false });
          req.onerror = () => resolve({ ok: false, error: req.error ? req.error.message : 'Delete failed' });
          // onblocked fires when another tab still holds a connection; the delete
          // completes once that tab closes, so report it instead of hanging.
          req.onblocked = () => resolve({ ok: true, blocked: true });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      });
    }

    return {
      readWebStorage,
      writeEntry,
      deleteEntry,
      clearArea,
      restoreWebStorage,
      listIndexedDB,
      readIdbStore,
      deleteIdbDatabase,
    };
  })();

  if (typeof globalThis !== 'undefined') globalThis.PageAgent = PageAgent;
}
