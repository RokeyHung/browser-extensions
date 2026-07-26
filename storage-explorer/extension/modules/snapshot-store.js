// snapshot-store.js — CRUD over chrome.storage.local for snapshots and settings.
// Loaded in the service worker and in extension pages. Spec §8, §9.

if (typeof SnapshotStore === 'undefined') {
  var SnapshotStore = (() => {
    const DEFAULT_SETTINGS = {
      confirmDestructive: true,
      reloadAfterRestore: true,
      includeCookiesInSnapshot: true,
      previewLength: 120,
      idbRecordLimit: 100,
    };

    function now() {
      return new Date().toISOString();
    }

    function newId(prefix) {
      return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }

    async function read() {
      const data = await chrome.storage.local.get(['snapshots', 'settings']);
      return {
        snapshots: data.snapshots || [],
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
      };
    }

    // ─── Settings ──────────────────────────────────────────────────────────────

    async function getSettings() {
      const { settings } = await read();
      return settings;
    }

    async function saveSettings(patch) {
      const settings = { ...(await getSettings()), ...patch };
      await chrome.storage.local.set({ settings });
      return settings;
    }

    // ─── Snapshots ─────────────────────────────────────────────────────────────

    async function list(origin) {
      const { snapshots } = await read();
      const filtered = origin ? snapshots.filter((item) => item.origin === origin) : snapshots;
      return filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    }

    async function get(snapshotId) {
      const { snapshots } = await read();
      return snapshots.find((item) => item.id === snapshotId) || null;
    }

    async function write(snapshots) {
      await chrome.storage.local.set({ snapshots });
    }

    function defaultName(hostname) {
      const date = new Date();
      const hh = String(date.getHours()).padStart(2, '0');
      const mm = String(date.getMinutes()).padStart(2, '0');
      return `${hostname} ${hh}:${mm}`;
    }

    function byteLength(text) {
      // TextEncoder is available in the service worker and in extension pages.
      return new TextEncoder().encode(String(text ?? '')).length;
    }

    function computeStats(data) {
      let bytes = 0;
      for (const entry of data.local || []) bytes += byteLength(entry.key) + byteLength(entry.value);
      for (const entry of data.session || []) bytes += byteLength(entry.key) + byteLength(entry.value);
      for (const cookie of data.cookies || []) bytes += byteLength(cookie.name) + byteLength(cookie.value);
      return {
        local: (data.local || []).length,
        session: (data.session || []).length,
        cookies: (data.cookies || []).length,
        bytes,
      };
    }

    async function create({ name, note, origin, hostname, data, includes }) {
      const { snapshots } = await read();
      const snapshot = {
        id: newId('snap'),
        name: name || defaultName(hostname),
        note: note || '',
        origin,
        hostname,
        createdAt: now(),
        includes: {
          local: !!includes?.local,
          session: !!includes?.session,
          cookies: !!includes?.cookies,
        },
        data: {
          local: data.local || [],
          session: data.session || [],
          cookies: data.cookies || [],
        },
        stats: computeStats(data),
      };
      snapshots.push(snapshot);
      await write(snapshots);
      return snapshot;
    }

    async function update(snapshotId, patch) {
      const { snapshots } = await read();
      const index = snapshots.findIndex((item) => item.id === snapshotId);
      if (index === -1) return null;
      snapshots[index] = { ...snapshots[index], ...patch, id: snapshotId };
      await write(snapshots);
      return snapshots[index];
    }

    async function remove(snapshotId) {
      const { snapshots } = await read();
      await write(snapshots.filter((item) => item.id !== snapshotId));
      return { ok: true };
    }

    async function clearAll() {
      await write([]);
    }

    // ─── Export / import ───────────────────────────────────────────────────────

    async function exportSnapshots(snapshotIds) {
      const { snapshots } = await read();
      const selected = snapshotIds?.length ? snapshots.filter((item) => snapshotIds.includes(item.id)) : snapshots;
      return { version: '1', exportedAt: now(), snapshots: selected };
    }

    function validateImport(payload) {
      if (!payload || typeof payload !== 'object') return 'File is not a valid JSON object';
      if (payload.version !== '1') return `Unsupported version: ${payload.version}`;
      if (!Array.isArray(payload.snapshots)) return 'Missing "snapshots" array';
      for (const snapshot of payload.snapshots) {
        if (!snapshot.origin || !snapshot.data) return 'A snapshot record is malformed';
      }
      return null;
    }

    // Ids are regenerated so an import never overwrites an existing snapshot.
    async function importSnapshots(payload) {
      const error = validateImport(payload);
      if (error) return { success: false, error };

      const { snapshots } = await read();
      let added = 0;
      for (const incoming of payload.snapshots) {
        const data = {
          local: incoming.data.local || [],
          session: incoming.data.session || [],
          cookies: incoming.data.cookies || [],
        };
        snapshots.push({
          ...incoming,
          id: newId('snap'),
          name: incoming.name || defaultName(incoming.hostname || incoming.origin),
          hostname: incoming.hostname || new URL(incoming.origin).hostname,
          createdAt: incoming.createdAt || now(),
          importedAt: now(),
          // A hand-edited file may omit `includes`; derive it from the payload so
          // the UI never reads undefined flags.
          includes: {
            local: incoming.includes?.local ?? data.local.length > 0,
            session: incoming.includes?.session ?? data.session.length > 0,
            cookies: incoming.includes?.cookies ?? data.cookies.length > 0,
          },
          data,
          stats: incoming.stats || computeStats(data),
        });
        added++;
      }
      await write(snapshots);
      return { success: true, added };
    }

    return {
      DEFAULT_SETTINGS,
      read,
      getSettings,
      saveSettings,
      list,
      get,
      create,
      update,
      remove,
      clearAll,
      defaultName,
      computeStats,
      exportSnapshots,
      validateImport,
      importSnapshots,
    };
  })();

  if (typeof globalThis !== 'undefined') globalThis.SnapshotStore = SnapshotStore;
}
