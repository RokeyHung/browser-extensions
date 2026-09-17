// background.js — MV3 service worker. Watches navigations to collect params and
// to see what the rules actually removed, keeps the dynamic rule set in step
// with the store, and answers the popup and options page. Spec §5.1, §7, §12.

importScripts('modules/domain-utils.js', 'modules/param-catalog.js', 'modules/param-store.js', 'modules/rule-builder.js', 'modules/collector.js');

// A navigation between onBeforeNavigate and onCommitted. In RAM on purpose: it
// is worth one observation, and the rules — the thing that must not be lost —
// live in Chrome, not here (spec §7.2, §15).
const pending = new Map(); // tabId → { originalUrl, sourceUrl, sourceSite, at }

// How long a pending navigation is still believable. Longer than a slow page
// load, short enough that a tab reused an hour later does not inherit it.
const PENDING_TTL_MS = 60000;

// ─── Source of a navigation ──────────────────────────────────────────────────

// At onBeforeNavigate the tab still reports the page it is leaving: tab.url is
// only updated on commit, and the new URL sits in tab.pendingUrl. So the source
// can be read back from the tab itself and there is no per-tab map to keep in
// sync — one less thing to lose when MV3 stops the worker, which it likes to do
// at exactly this moment.
async function sourceUrlFor(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;

  if (globalThis.DomainUtils.safeUrl(tab.url)) return tab.url;

  // A target="_blank" link opens a tab with no URL of its own yet; the page that
  // spawned it is the source (spec §7.2).
  if (tab.openerTabId != null) {
    const opener = await chrome.tabs.get(tab.openerTabId).catch(() => null);
    if (opener && globalThis.DomainUtils.safeUrl(opener.url)) return opener.url;
  }
  return null;
}

// ─── Watch list cache ────────────────────────────────────────────────────────

// Every top-level navigation in the browser asks "is this site watched?", and
// for almost everyone the answer is no. Keeping the answer in RAM turns that
// into a Set lookup instead of a storage read plus a tabs.get per navigation.
// Invalidated by storage.onChanged, so a change made in any extension page — or
// by an import — is picked up without anyone having to remember to call this.
let watchedCache = null;

async function watchedSites() {
  if (!watchedCache) {
    const sites = await globalThis.ParamStore.getSites();
    watchedCache = new Set(sites.filter((site) => site.enabled).map((site) => site.site));
  }
  return watchedCache;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sites) watchedCache = null;
});

// ─── Badge ───────────────────────────────────────────────────────────────────

async function setBadge(tabId, count) {
  const settings = await globalThis.ParamStore.getSettings();
  const text = settings.showBadge && count > 0 ? String(count) : '';
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: '#5546cb' }).catch(() => {});
}

// ─── Navigation listeners ────────────────────────────────────────────────────

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  // A DNR redirect produces a second onBeforeNavigate for the cleaned URL. Keep
  // the first one: it is the only place the removed params are still visible,
  // and overwriting it would make the extension blind to exactly what it strips.
  const existing = pending.get(details.tabId);
  if (existing && Date.now() - existing.at < PENDING_TTL_MS && globalThis.Collector.isSameTarget(existing.originalUrl, details.url)) return;

  // Cheapest checks first: a URL with no query has nothing to collect, and with
  // an empty watch list there is nothing to ask the tab about.
  const target = globalThis.DomainUtils.safeUrl(details.url);
  if (!target || !target.search) return;

  const watched = await watchedSites();
  if (!watched.size) return;

  const sourceUrl = await sourceUrlFor(details.tabId);
  if (!sourceUrl) return;
  if (!globalThis.Collector.isCollectableNavigation(sourceUrl, details.url)) return;

  const sourceSite = globalThis.DomainUtils.siteOf(sourceUrl);
  if (!watched.has(sourceSite)) return;

  pending.set(details.tabId, { originalUrl: details.url, sourceUrl, sourceSite, at: Date.now() });
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const entry = pending.get(details.tabId);
  pending.delete(details.tabId);

  // Any top-level commit ends whatever the badge was counting: the number
  // belongs to the page that is being replaced (spec §14).
  if (!entry) {
    await setBadge(details.tabId, 0);
    return;
  }

  const stale = Date.now() - entry.at > PENDING_TTL_MS;
  const elsewhere = !globalThis.Collector.isSameTarget(entry.originalUrl, details.url);
  if (stale || elsewhere || !globalThis.Collector.isCollectableTransition(details)) {
    await setBadge(details.tabId, 0);
    return;
  }

  const observed = globalThis.Collector.extractParams(entry.originalUrl);
  const { removed, kept } = globalThis.Collector.diffParams(entry.originalUrl, details.url);

  await globalThis.ParamStore.record({
    site: entry.sourceSite,
    observed,
    removed,
    kept,
    sourceUrl: entry.sourceUrl,
    targetHost: globalThis.DomainUtils.hostnameOf(details.url),
  });

  await setBadge(details.tabId, removed.length);
});

chrome.tabs.onRemoved.addListener((tabId) => pending.delete(tabId));

// Rules live in Chrome and the store lives in storage.local; a crash, an update
// or an import gone wrong can leave them disagreeing. Re-derive on every start:
// the store is the source of truth, always.
chrome.runtime.onInstalled.addListener(() => globalThis.RuleBuilder.sync().catch(() => {}));
chrome.runtime.onStartup.addListener(() => globalThis.RuleBuilder.sync().catch(() => {}));

// ─── Popup / options state ───────────────────────────────────────────────────

async function getPopupState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = tab ? globalThis.DomainUtils.safeUrl(tab.url) : null;
  const settings = await globalThis.ParamStore.getSettings();

  if (!parsed) return { supported: false, settings };

  const hostname = parsed.hostname.toLowerCase();
  const site = globalThis.DomainUtils.getBaseDomain(hostname);
  const record = (await globalThis.ParamStore.getSites()).find((entry) => entry.site === site) || null;
  const [lastClean] = record ? await globalThis.ParamStore.getLogs({ site, limit: 1 }) : [];

  return { supported: true, tabId: tab.id, hostname, site, record, settings, lastClean: lastClean || null };
}

// Every state change re-derives the rules before answering, so the UI never
// shows a tick that Chrome is not enforcing yet (spec §12).
async function withRuleSync(result) {
  await globalThis.RuleBuilder.sync();
  return result;
}

async function watchSite(input) {
  const normalized = globalThis.DomainUtils.normalizeSiteInput(input);
  if (normalized.error) throw new Error(normalized.error);
  const record = await globalThis.ParamStore.watchSite(normalized.site);
  return withRuleSync({ record, site: normalized.site, changed: !!normalized.changed });
}

// ─── Messages ────────────────────────────────────────────────────────────────

const HANDLERS = {
  getPopupState: () => getPopupState(),
  listSites: () => globalThis.ParamStore.getSites(),
  watchSite: (msg) => watchSite(msg.site),
  unwatchSite: (msg) => globalThis.ParamStore.deleteSite(msg.id).then(withRuleSync),
  setSiteEnabled: (msg) => globalThis.ParamStore.setSiteEnabled(msg.id, msg.enabled).then(withRuleSync),
  setSiteNote: (msg) => globalThis.ParamStore.setSiteNote(msg.id, msg.note),
  setParamState: (msg) => globalThis.ParamStore.setParamState(msg.id, msg.names, msg.state).then(withRuleSync),
  addParam: (msg) => globalThis.ParamStore.addParam(msg.id, msg.name).then(withRuleSync),
  deleteParams: (msg) => globalThis.ParamStore.deleteParams(msg.id, msg.names).then(withRuleSync),
  listLog: (msg) => globalThis.ParamStore.getLogs({ site: msg.site, limit: msg.limit }),
  clearLog: () => globalThis.ParamStore.clearLogs(),
  getSettings: () => globalThis.ParamStore.getSettings(),
  // No setting takes part in rule generation, so this one does not re-sync.
  setSettings: (msg) => globalThis.ParamStore.saveSettings(msg.patch),
  exportConfig: () => globalThis.ParamStore.exportConfig(),
  importConfig: (msg) => globalThis.ParamStore.importConfig(msg.payload, msg.mode).then(withRuleSync),
  syncRules: () => globalThis.RuleBuilder.sync().then((rules) => ({ rules })),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message && message.type];
  if (!handler) return false;

  Promise.resolve(handler(message))
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true; // keep the message channel open for the async response
});
