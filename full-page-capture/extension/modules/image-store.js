// image-store.js — IndexedDB workspace for exactly one capture (spec §10).
//
// Not a history. The store is wiped at the start of every capture, and in
// "save to disk" mode the image is deleted the moment its file lands. Blobs
// cannot travel through chrome.runtime.sendMessage, so this is also the hand-off
// between the service worker, the result page and the offscreen document.
//
// Shared by all three contexts, hence a classic script on globalThis.

(function () {
  'use strict';

  const DB_NAME = 'fpc';
  const DB_VERSION = 1;

  // The record and its pixels live in separate stores so that reading the
  // metadata never drags a 20MB blob into memory with it.
  const PAGES = 'pages';
  const BLOBS = 'blobs';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Run `work(tx)` and settle when the whole transaction commits, not when the
  // individual requests fire — a write that resolves before commit can be lost
  // if the service worker is killed a moment later.
  async function write(storeNames, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
      work(tx);
    });
  }

  async function read(storeName, fn) {
    const db = await open();
    const tx = db.transaction([storeName], 'readonly');
    return request(fn(tx.objectStore(storeName)));
  }

  async function clear() {
    await write([PAGES, BLOBS], (tx) => {
      tx.objectStore(PAGES).clear();
      tx.objectStore(BLOBS).clear();
    });
  }

  // page: { id, createdAt, meta, thumb }
  // blobs: array of Blob, one per part (spec §8)
  async function putPage(page, blobs) {
    await write([PAGES, BLOBS], (tx) => {
      tx.objectStore(PAGES).put(page);
      tx.objectStore(BLOBS).put({ id: page.id, blobs });
    });
    return page;
  }

  async function listPages() {
    const all = (await read(PAGES, (store) => store.getAll())) || [];
    return all.sort((a, b) => a.index - b.index);
  }

  async function getPage(id) {
    return (await read(PAGES, (store) => store.get(id))) || null;
  }

  async function getBlobs(id) {
    const rec = await read(BLOBS, (store) => store.get(id));
    return (rec && rec.blobs) || [];
  }

  async function removePage(id) {
    await write([PAGES, BLOBS], (tx) => {
      tx.objectStore(PAGES).delete(id);
      tx.objectStore(BLOBS).delete(id);
    });
  }

  globalThis.ImageStore = { open, clear, putPage, listPages, getPage, getBlobs, removePage };
})();
