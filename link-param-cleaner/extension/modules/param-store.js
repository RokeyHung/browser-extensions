// param-store.js — the single place that touches chrome.storage.local.
// Keys: sites, logs, settings (spec §9). Loaded in the service worker and in
// extension pages.

if (typeof ParamStore === 'undefined') {
  var ParamStore = (() => {
    const KEYS = { sites: 'sites', logs: 'logs', settings: 'settings' };

    const DEFAULT_SETTINGS = {
      collectEnabled: true,
      storeSampleValues: false,
      showBadge: true,
      logEnabled: true,
      logLimit: 200,
      maxSites: 200,
      maxParamsPerSite: 100,
      warnOnFunctionalParam: true,
    };

    // A stored sample is a fragment of someone's browsing, so it is cut short even
    // when the user asked for samples (spec §16).
    const SAMPLE_MAX_LENGTH = 32;
    const PARAM_NAME_MAX_LENGTH = 100;
    const STATES = new Set(['seen', 'strip', 'ignored']);

    function now() {
      return new Date().toISOString();
    }

    function newId(prefix) {
      return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    }

    // Every mutation here is read-modify-write over one storage key, and the
    // navigation events that drive them overlap: two tabs committing at the same
    // moment both read `sites`, both write it, and one update is lost. Popup
    // Redirect Guard measured exactly that on its per-tab state. One promise
    // chain means each read sees what the previous write left.
    let queue = Promise.resolve();
    function serial(task) {
      const run = queue.then(task);
      queue = run.then(
        () => {},
        () => {}
      );
      return run;
    }

    async function readSites() {
      const stored = await chrome.storage.local.get(KEYS.sites);
      return Array.isArray(stored[KEYS.sites]) ? stored[KEYS.sites] : [];
    }

    async function readLogs() {
      const stored = await chrome.storage.local.get(KEYS.logs);
      return Array.isArray(stored[KEYS.logs]) ? stored[KEYS.logs] : [];
    }

    // ─── Settings ─────────────────────────────────────────────────────────────

    async function getSettings() {
      const stored = await chrome.storage.local.get(KEYS.settings);
      return { ...DEFAULT_SETTINGS, ...(stored[KEYS.settings] || {}) };
    }

    function saveSettings(patch) {
      return serial(async () => {
        const merged = { ...(await getSettings()), ...(patch || {}) };
        await chrome.storage.local.set({ [KEYS.settings]: merged });
        return merged;
      });
    }

    // ─── Sites ────────────────────────────────────────────────────────────────

    function getSites() {
      return readSites();
    }

    async function getSite(id) {
      return (await readSites()).find((site) => site.id === id) || null;
    }

    // One record per registrable domain, so a lookup is an exact match on the
    // site key rather than a pattern walk (spec §8).
    async function findSite(hostnameOrUrl) {
      const site = String(hostnameOrUrl || '').includes('://')
        ? globalThis.DomainUtils.siteOf(hostnameOrUrl)
        : globalThis.DomainUtils.siteOfHostname(hostnameOrUrl);
      if (!site) return null;
      return (await readSites()).find((record) => record.site === site) || null;
    }

    function newSite(site) {
      const stamp = now();
      return {
        id: newId('site'),
        site,
        enabled: true,
        note: '',
        truncated: false,
        params: [],
        stats: { cleanedCount: 0, lastCleanedAt: null },
        createdAt: stamp,
        updatedAt: stamp,
      };
    }

    function watchSite(site) {
      return serial(async () => {
        const sites = await readSites();
        const existing = sites.find((record) => record.site === site);
        if (existing) {
          existing.enabled = true;
          existing.updatedAt = now();
          await chrome.storage.local.set({ [KEYS.sites]: sites });
          return existing;
        }

        const settings = await getSettings();
        // The cap is here and not in the UI because import is the way this gets
        // hit, and a store over the limit makes updateDynamicRules fail for the
        // whole rule set, not just the extra site (spec §6.6).
        if (sites.length >= settings.maxSites) throw new Error(`Watch list is full (${settings.maxSites} sites).`);

        const record = newSite(site);
        sites.push(record);
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return record;
      });
    }

    function setSiteEnabled(id, enabled) {
      return serial(async () => {
        const sites = await readSites();
        const record = sites.find((site) => site.id === id);
        if (!record) throw new Error('Site not found');
        record.enabled = !!enabled;
        record.updatedAt = now();
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return record;
      });
    }

    function setSiteNote(id, note) {
      return serial(async () => {
        const sites = await readSites();
        const record = sites.find((site) => site.id === id);
        if (!record) throw new Error('Site not found');
        record.note = String(note || '').slice(0, 200);
        record.updatedAt = now();
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return record;
      });
    }

    function deleteSite(id) {
      return serial(async () => {
        const sites = await readSites();
        await chrome.storage.local.set({ [KEYS.sites]: sites.filter((site) => site.id !== id) });
        return { ok: true };
      });
    }

    // ─── Params ───────────────────────────────────────────────────────────────

    function normalizeParamName(name) {
      const text = String(name || '').trim();
      if (!text) return { error: 'Enter a param name.' };
      if (text.length > PARAM_NAME_MAX_LENGTH) return { error: `Param names longer than ${PARAM_NAME_MAX_LENGTH} characters are not stored.` };
      if (/[&=#?\s]/.test(text)) return { error: 'A param name cannot contain & = # ? or spaces.' };
      return { name: text };
    }

    function newParam(name, source) {
      const stamp = now();
      return {
        name,
        state: 'seen',
        seen: 0,
        label: globalThis.ParamCatalog.labelFor(name),
        sample: null,
        lastTargetHost: null,
        firstSeenAt: stamp,
        lastSeenAt: source === 'collected' ? stamp : null,
        source,
      };
    }

    function setParamState(id, names, state) {
      if (!STATES.has(state)) throw new Error(`Unknown param state: ${state}`);
      return serial(async () => {
        const sites = await readSites();
        const record = sites.find((site) => site.id === id);
        if (!record) throw new Error('Site not found');

        const wanted = new Set(names || []);
        for (const param of record.params) {
          if (wanted.has(param.name)) param.state = state;
        }
        record.updatedAt = now();
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return record;
      });
    }

    function addParam(id, name) {
      const parsed = normalizeParamName(name);
      if (parsed.error) throw new Error(parsed.error);

      return serial(async () => {
        const sites = await readSites();
        const record = sites.find((site) => site.id === id);
        if (!record) throw new Error('Site not found');
        if (record.params.some((param) => param.name === parsed.name)) throw new Error(`${parsed.name} is already listed.`);

        const settings = await getSettings();
        if (record.params.length >= settings.maxParamsPerSite) throw new Error(`This site already has ${settings.maxParamsPerSite} params.`);

        record.params.push(newParam(parsed.name, 'manual'));
        record.updatedAt = now();
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return record;
      });
    }

    function deleteParams(id, names) {
      return serial(async () => {
        const sites = await readSites();
        const record = sites.find((site) => site.id === id);
        if (!record) throw new Error('Site not found');

        const doomed = new Set(names || []);
        record.params = record.params.filter((param) => !doomed.has(param.name));
        // Room again: new params can be recorded, so drop the warning.
        record.truncated = false;
        record.updatedAt = now();
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return record;
      });
    }

    function stripNamesOf(record) {
      if (!record || !record.enabled) return [];
      return record.params.filter((param) => param.state === 'strip').map((param) => param.name);
    }

    // ─── Recording one navigation ─────────────────────────────────────────────

    // Collection and the "what was removed" log are the same write: one
    // navigation, one read-modify-write. Doing them separately doubled the
    // storage traffic and opened a window where a param was counted but the log
    // entry that explains it was not there yet.
    function record({ site, observed, removed, kept, sourceUrl, targetHost }) {
      return serial(async () => {
        const settings = await getSettings();
        const sites = await readSites();
        const target = sites.find((entry) => entry.site === site);
        if (!target || !target.enabled) return { record: null, logged: false };

        const stamp = now();
        const byName = new Map(target.params.map((param) => [param.name, param]));

        if (settings.collectEnabled) {
          for (const { name, value } of observed || []) {
            const existing = byName.get(name);
            if (existing) {
              // An ignored param keeps its silence: no count, no reordering, but
              // the timestamp still shows it is alive (spec §2.4).
              existing.lastSeenAt = stamp;
              if (existing.state !== 'ignored') {
                existing.seen = (existing.seen || 0) + 1;
                existing.lastTargetHost = targetHost || existing.lastTargetHost;
                if (settings.storeSampleValues && value) existing.sample = String(value).slice(0, SAMPLE_MAX_LENGTH);
              }
              continue;
            }

            // Full: drop the new name and say so, rather than evicting an older
            // param the user may have ticked (spec §7.4).
            if (target.params.length >= settings.maxParamsPerSite) {
              target.truncated = true;
              continue;
            }

            const param = newParam(name, 'collected');
            param.seen = 1;
            param.lastTargetHost = targetHost || null;
            if (settings.storeSampleValues && value) param.sample = String(value).slice(0, SAMPLE_MAX_LENGTH);
            target.params.push(param);
            byName.set(name, param);
          }
        }

        let logged = false;
        if (removed && removed.length) {
          target.stats = target.stats || { cleanedCount: 0, lastCleanedAt: null };
          target.stats.cleanedCount = (target.stats.cleanedCount || 0) + 1;
          target.stats.lastCleanedAt = stamp;

          if (settings.logEnabled) {
            const logs = await readLogs();
            logs.unshift({
              id: newId('log'),
              sourceSite: site,
              sourceUrl: sourceUrl || '',
              targetHost: targetHost || '',
              removed: [...removed],
              kept: [...(kept || [])],
              createdAt: stamp,
            });
            await chrome.storage.local.set({ [KEYS.logs]: logs.slice(0, settings.logLimit) });
            logged = true;
          }
        }

        target.updatedAt = stamp;
        await chrome.storage.local.set({ [KEYS.sites]: sites });
        return { record: target, logged };
      });
    }

    // ─── Logs ─────────────────────────────────────────────────────────────────

    async function getLogs({ site, limit } = {}) {
      const logs = await readLogs();
      const filtered = site ? logs.filter((entry) => entry.sourceSite === site) : logs;
      return limit ? filtered.slice(0, limit) : filtered;
    }

    function clearLogs() {
      return serial(async () => {
        const removed = (await readLogs()).length;
        await chrome.storage.local.set({ [KEYS.logs]: [] });
        return { removed };
      });
    }

    // ─── Export / import ──────────────────────────────────────────────────────

    // What travels is the configuration, not the browsing: no samples, no last
    // target host, no log (spec §9.4, §16).
    async function exportConfig() {
      const [sites, settings] = await Promise.all([readSites(), getSettings()]);
      return {
        version: '1',
        extension: 'link-param-cleaner',
        exportedAt: now(),
        sites: sites.map((site) => ({
          site: site.site,
          enabled: site.enabled !== false,
          note: site.note || '',
          params: site.params.map((param) => ({ name: param.name, state: param.state, seen: param.seen || 0 })),
        })),
        settings,
      };
    }

    function parseImport(payload) {
      if (!payload || typeof payload !== 'object') throw new Error('Not a JSON object.');
      if (payload.extension !== 'link-param-cleaner') throw new Error('This file was not exported by Link Param Cleaner.');
      if (String(payload.version) !== '1') throw new Error(`Unsupported export version: ${payload.version}`);
      if (!Array.isArray(payload.sites)) throw new Error('Missing "sites" array.');
      return payload;
    }

    function importConfig(payload, mode = 'merge') {
      const parsed = parseImport(payload);

      return serial(async () => {
        const settings = await getSettings();
        const existing = mode === 'replace' ? [] : await readSites();
        const byKey = new Map(existing.map((site) => [site.site, site]));
        const skipped = [];
        let sitesTouched = 0;
        let paramsTouched = 0;

        for (const raw of parsed.sites) {
          const normalized = globalThis.DomainUtils.normalizeSiteInput(raw && raw.site);
          if (normalized.error) {
            skipped.push({ site: (raw && raw.site) || '(empty)', reason: normalized.error });
            continue;
          }
          if (!byKey.has(normalized.site) && byKey.size >= settings.maxSites) {
            skipped.push({ site: normalized.site, reason: `Watch list is full (${settings.maxSites} sites).` });
            continue;
          }

          let record = byKey.get(normalized.site);
          if (!record) {
            record = newSite(normalized.site);
            byKey.set(normalized.site, record);
            existing.push(record);
          }
          record.enabled = raw.enabled !== false;
          if (typeof raw.note === 'string') record.note = raw.note.slice(0, 200);
          sitesTouched++;

          const byName = new Map(record.params.map((param) => [param.name, param]));
          for (const rawParam of Array.isArray(raw.params) ? raw.params : []) {
            const parsedName = normalizeParamName(rawParam && rawParam.name);
            if (parsedName.error) {
              skipped.push({ site: normalized.site, reason: `${parsedName.error} (${(rawParam && rawParam.name) || '(empty)'})` });
              continue;
            }
            const state = STATES.has(rawParam.state) ? rawParam.state : 'seen';
            const param = byName.get(parsedName.name);
            if (param) {
              // The file is the thing being imported, so its tick wins — that is
              // the whole point of carrying the config to another machine.
              param.state = state;
            } else {
              if (record.params.length >= settings.maxParamsPerSite) {
                record.truncated = true;
                skipped.push({ site: normalized.site, reason: `Param limit reached, skipped ${parsedName.name}.` });
                continue;
              }
              const created = newParam(parsedName.name, 'manual');
              created.state = state;
              created.seen = Number.isFinite(rawParam.seen) ? rawParam.seen : 0;
              record.params.push(created);
              byName.set(parsedName.name, created);
            }
            paramsTouched++;
          }
          record.updatedAt = now();
        }

        await chrome.storage.local.set({ [KEYS.sites]: existing });
        if (parsed.settings && typeof parsed.settings === 'object') {
          await chrome.storage.local.set({ [KEYS.settings]: { ...settings, ...parsed.settings } });
        }
        return { sites: sitesTouched, params: paramsTouched, skipped, mode };
      });
    }

    return {
      KEYS,
      DEFAULT_SETTINGS,
      getSettings,
      saveSettings,
      getSites,
      getSite,
      findSite,
      watchSite,
      setSiteEnabled,
      setSiteNote,
      deleteSite,
      setParamState,
      addParam,
      deleteParams,
      normalizeParamName,
      stripNamesOf,
      record,
      getLogs,
      clearLogs,
      exportConfig,
      importConfig,
    };
  })();

  if (typeof globalThis !== 'undefined') globalThis.ParamStore = ParamStore;
}
