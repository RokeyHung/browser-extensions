// background.js — MV3 service worker. Loads shared modules and wires up
// navigation/network recording, robots & sitemap reading, the limited crawler,
// storage and messaging (spec §13.2).

importScripts(
  'modules/url-normalizer.js',
  'modules/path-classifier.js',
  'modules/dom-scanner.js',
  'modules/network-recorder.js',
  'modules/navigation-recorder.js',
  'modules/robots-reader.js',
  'modules/sitemap-reader.js',
  'modules/crawler.js',
  'modules/storage-repository.js'
);

const N = globalThis.UrlNormalizer;
const Classifier = globalThis.PathClassifier;
const NetRec = globalThis.NetworkRecorder;
const NavRec = globalThis.NavigationRecorder;
const Robots = globalThis.RobotsReader;
const Sitemap = globalThis.SitemapReader;
const Crawler = globalThis.Crawler;
const Store = globalThis.StorageRepo;

// tabId → { origin, hostname, siteId } for the tab's top frame.
const tabOrigin = new Map();
// One crawl at a time: { siteId, controller, state, session }.
let activeCrawl = null;

// ─── Site context helpers ─────────────────────────────────────────────────────

function siteContextFromUrl(url) {
  const u = N.safeUrl(url);
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
  return { siteId: N.siteIdFromOrigin(u.origin), origin: u.origin, hostname: u.hostname };
}

function normalizeOptsFromSettings(settings) {
  return {
    queryMode: settings.queryMode,
    includeHash: settings.includeHash,
    removeTrailingSlash: settings.removeTrailingSlash,
    sortQuery: settings.sortQuery,
  };
}

// Normalize + classify + upsert a batch of raw records under one site.
//   ctx: { siteId, origin, hostname }
//   raw record: { url, base?, source, method?, resourceType?, statusCode?,
//                 discoveredFrom?, timestamp?, contentType?, lastmod?,
//                 robotsDirective?, forcedType?, pathOnly? }
async function ingest(ctx, rawRecords) {
  if (!ctx || !Array.isArray(rawRecords) || rawRecords.length === 0) {
    return { added: 0, updated: 0, total: 0 };
  }
  const settings = await Store.getSettings();
  const site = await Store.getSite(ctx.siteId);
  const scope = (site && site.settings && site.settings.scope) || settings.scope;
  const opts = normalizeOptsFromSettings({ ...settings, ...(site && site.settings) });

  await Store.ensureSite(ctx);

  const out = [];
  for (const r of rawRecords) {
    if (!r || !r.url) continue;
    // Robots paths are relative (e.g. "/admin/") — resolve against the origin.
    const input = r.pathOnly ? ctx.origin.replace(/\/+$/, '') + r.url : r.url;
    const norm = N.normalize(input, r.base, opts);
    if (!norm) continue;

    const external = !N.inScope(norm.normalizedUrl, ctx.origin, scope);
    const type = Classifier.classify({
      path: norm.path,
      resourceType: r.resourceType,
      contentType: r.contentType,
      isExternal: external,
      forcedType: r.forcedType,
    });

    out.push({
      ...norm,
      type,
      method: r.method || null,
      resourceType: r.resourceType || null,
      source: r.source,
      statusCode: r.statusCode != null ? r.statusCode : null,
      discoveredFrom: r.discoveredFrom || null,
      timestamp: r.timestamp || null,
      metadata: r.contentType ? { contentType: r.contentType } : {},
      lastmod: r.lastmod || null,
      robotsDirective: r.robotsDirective || null,
    });
  }

  return Store.upsertPaths(ctx.siteId, out);
}

// ─── Navigation recording (spec §6.2) ────────────────────────────────────────

async function recordNavigation(details, trigger) {
  if (details.frameId !== 0) return; // top frame only
  const ctx = siteContextFromUrl(details.url);
  if (!ctx) return;

  // Track the tab's top origin for network attribution regardless of recording.
  tabOrigin.set(details.tabId, ctx);

  if (!(await Store.isRecording(ctx.siteId))) return;
  const rec = NavRec.buildRecord(details, trigger);
  if (!rec) return;
  await ingest(ctx, [{ url: rec.url, source: 'navigation', method: 'GET', timestamp: rec.timestamp }]);
}

chrome.webNavigation.onCommitted.addListener((d) => recordNavigation(d, 'load'));
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => recordNavigation(d, 'history'));
chrome.webNavigation.onReferenceFragmentUpdated.addListener((d) => recordNavigation(d, 'hash'));

chrome.tabs.onRemoved.addListener((tabId) => tabOrigin.delete(tabId));

// ─── Network recording (spec §6.3) ───────────────────────────────────────────

chrome.webRequest.onCompleted.addListener(
  (details) => {
    handleNetwork(details).catch(() => {});
  },
  { urls: ['http://*/*', 'https://*/*'] }
);

async function handleNetwork(details) {
  if (details.tabId == null || details.tabId < 0) return; // no owning tab
  const ctx = tabOrigin.get(details.tabId) || siteContextFromUrl(details.documentUrl || details.initiator);
  if (!ctx) return;
  if (!(await Store.isRecording(ctx.siteId))) return;

  const rec = NetRec.buildRecord(details);
  if (!rec) return;
  await ingest(ctx, [
    {
      url: rec.url,
      source: 'network',
      method: rec.method,
      resourceType: rec.resourceType,
      statusCode: rec.statusCode,
      discoveredFrom: rec.discoveredFrom,
      timestamp: rec.timestamp,
    },
  ]);
}

// ─── Robots / sitemap (spec §14.3, §14.4) ────────────────────────────────────

async function readRobots(ctx) {
  const result = await Robots.fetchRobots(ctx.origin);
  if (!result.found) return { found: false, status: result.status };

  const records = [];
  for (const p of result.disallow) records.push({ url: p, pathOnly: true, source: 'robots', forcedType: 'robots-path', robotsDirective: 'Disallow' });
  for (const p of result.allow) records.push({ url: p, pathOnly: true, source: 'robots', forcedType: 'robots-path', robotsDirective: 'Allow' });
  const upsert = await ingest(ctx, records);

  return {
    found: true,
    disallow: result.disallow.length,
    allow: result.allow.length,
    sitemaps: result.sitemaps,
    added: upsert.added,
  };
}

async function readSitemap(ctx, seeds) {
  // Also pull any Sitemap: lines declared in robots.txt.
  let robotsSeeds = seeds || [];
  if (!robotsSeeds.length) {
    const robots = await Robots.fetchRobots(ctx.origin);
    if (robots.found && robots.sitemaps.length) robotsSeeds = robots.sitemaps;
  }

  const result = await Sitemap.collect(ctx.origin, robotsSeeds);
  const records = result.urls.map((u) => ({ url: u.loc, source: 'sitemap', forcedType: 'sitemap', lastmod: u.lastmod }));
  const upsert = await ingest(ctx, records);

  return {
    sitemapsRead: result.sitemapsRead,
    urlsFound: result.urls.length,
    newUrls: upsert.added,
    tried: result.tried,
    errors: result.errors,
  };
}

// ─── Limited crawler (spec §14.5) ────────────────────────────────────────────

async function startCrawl(ctx, config) {
  if (activeCrawl && activeCrawl.state && !activeCrawl.state.done) {
    return { started: false, error: 'A crawl is already running.' };
  }
  const settings = await Store.getSettings();
  const site = await Store.getSite(ctx.siteId);
  const opts = normalizeOptsFromSettings({ ...settings, ...(site && site.settings) });
  const cfg = { ...settings.crawl, ...(config || {}), startUrl: (config && config.startUrl) || ctx.origin + '/' };

  let robots = null;
  if (cfg.respectRobotsTxt) {
    const r = await Robots.fetchRobots(ctx.origin);
    if (r.found) robots = r;
  }

  const session = {
    id: Store.newId('crawl'),
    siteId: ctx.siteId,
    startUrl: cfg.startUrl,
    scope: cfg.scope,
    maxDepth: cfg.maxDepth,
    maxPages: cfg.maxPages,
    requestDelayMs: cfg.requestDelayMs,
    respectRobotsTxt: cfg.respectRobotsTxt,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    scannedPages: 0,
    discoveredPaths: 0,
    errors: [],
  };

  const controller = Crawler.createCrawler(cfg, {
    normalizeOpts: opts,
    robots,
    onRecords: (records) => {
      // Records already carry provenance; ingest normalizes + classifies again.
      ingest(
        ctx,
        records.map((r) => ({
          url: r.url || r.normalizedUrl,
          source: 'crawl',
          method: r.method || 'GET',
          statusCode: r.statusCode,
          discoveredFrom: r.discoveredFrom,
          contentType: r.metadata && r.metadata.contentType,
        }))
      ).catch(() => {});
    },
    onProgress: (state) => {
      if (!activeCrawl) return;
      activeCrawl.state = state;
      session.scannedPages = state.scannedPages;
      session.discoveredPaths = state.discoveredPaths;
      session.errors = state.errors;
      if (state.done) {
        session.status = state.stopped ? 'stopped' : 'completed';
        session.endedAt = new Date().toISOString();
        Store.saveCrawl(ctx.siteId, session).catch(() => {});
      }
      chrome.runtime.sendMessage({ type: 'crawlProgress', siteId: ctx.siteId, state, session }).catch(() => {});
    },
  });

  activeCrawl = { siteId: ctx.siteId, controller, state: { scannedPages: 0, queued: 0, discoveredPaths: 0, errors: [], done: false }, session };
  await Store.saveCrawl(ctx.siteId, session);

  // Fire and forget; progress flows through onProgress.
  controller.run().then((final) => {
    session.status = final.stopped ? 'stopped' : 'completed';
    session.endedAt = new Date().toISOString();
    session.scannedPages = final.scannedPages;
    session.discoveredPaths = final.discoveredPaths;
    session.errors = final.errors;
    Store.saveCrawl(ctx.siteId, session).catch(() => {});
  });

  return { started: true, session };
}

function stopCrawl() {
  if (activeCrawl && activeCrawl.controller) {
    activeCrawl.controller.stop();
    return { stopped: true };
  }
  return { stopped: false };
}

// ─── Summary helper ──────────────────────────────────────────────────────────

async function summarize(siteId) {
  const paths = await Store.getPaths(siteId);
  const s = { total: paths.length, pages: 0, apis: 0, assets: 0, external: 0, robots: 0, sitemap: 0 };
  for (const p of paths) {
    if (p.type === 'page') s.pages++;
    else if (p.type === 'api') s.apis++;
    else if (p.type === 'asset') s.assets++;
    else if (p.type === 'external') s.external++;
    else if (p.type === 'robots-path') s.robots++;
    else if (p.type === 'sitemap') s.sitemap++;
  }
  return s;
}

// ─── Messaging (spec §13) ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'getPopupData': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ supported: false });
          const [recording, summary] = await Promise.all([Store.isRecording(ctx.siteId), summarize(ctx.siteId)]);
          return sendResponse({ supported: true, ctx, recording, summary });
        }

        // Content script hands us the URLs it scanned from the live DOM.
        case 'domScanResult': {
          const ctx = siteContextFromUrl(msg.pageUrl);
          if (!ctx) return sendResponse({ ok: false });
          const records = (msg.urls || []).map((raw) => ({ url: raw, base: msg.pageUrl, source: 'dom-link', discoveredFrom: msg.pageUrl }));
          const result = await ingest(ctx, records);
          return sendResponse({ ok: true, ...result, found: (msg.urls || []).length });
        }

        case 'scanCurrentPage': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ ok: false, supported: false });
          // Ask the content script to scan; fall back to injecting it.
          try {
            const res = await chrome.tabs.sendMessage(msg.tabId, { type: 'scanDom' });
            const records = (res.urls || []).map((raw) => ({ url: raw, base: msg.url, source: 'dom-link', discoveredFrom: msg.url }));
            const result = await ingest(ctx, records);
            return sendResponse({ ok: true, found: (res.urls || []).length, ...result });
          } catch {
            // Content script not present (e.g. freshly installed) — inject and retry.
            try {
              await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, files: ['content.js'] });
              const res = await chrome.tabs.sendMessage(msg.tabId, { type: 'scanDom' });
              const records = (res.urls || []).map((raw) => ({ url: raw, base: msg.url, source: 'dom-link', discoveredFrom: msg.url }));
              const result = await ingest(ctx, records);
              return sendResponse({ ok: true, found: (res.urls || []).length, ...result });
            } catch (e) {
              return sendResponse({ ok: false, error: 'Cannot access this website.' });
            }
          }
        }

        case 'startRecording': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ ok: false });
          tabOrigin.set(msg.tabId, ctx);
          await Store.setRecording(ctx.siteId, true);
          return sendResponse({ ok: true, recording: true });
        }
        case 'stopRecording': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ ok: false });
          await Store.setRecording(ctx.siteId, false);
          return sendResponse({ ok: true, recording: false });
        }

        case 'readRobots': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ ok: false });
          return sendResponse({ ok: true, ...(await readRobots(ctx)) });
        }
        case 'readSitemap': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ ok: false });
          return sendResponse({ ok: true, ...(await readSitemap(ctx, msg.seeds)) });
        }

        case 'startCrawl': {
          const ctx = siteContextFromUrl(msg.url);
          if (!ctx) return sendResponse({ ok: false });
          return sendResponse({ ok: true, ...(await startCrawl(ctx, msg.config)) });
        }
        case 'stopCrawl':
          return sendResponse({ ok: true, ...stopCrawl() });
        case 'getCrawlStatus': {
          const running = activeCrawl && activeCrawl.state && !activeCrawl.state.done;
          return sendResponse({ running: !!running, state: activeCrawl ? activeCrawl.state : null, siteId: activeCrawl ? activeCrawl.siteId : null });
        }

        case 'getPaths': {
          const paths = await Store.getPaths(msg.siteId);
          return sendResponse({ paths });
        }
        case 'getSummary':
          return sendResponse({ summary: await summarize(msg.siteId) });
        case 'getSite':
          return sendResponse({ site: await Store.getSite(msg.siteId) });
        case 'getSites':
          return sendResponse({ sites: await Store.getSites() });
        case 'getCrawls':
          return sendResponse({ crawls: await Store.getCrawls(msg.siteId) });

        case 'clearSite':
          await Store.clearPaths(msg.siteId);
          return sendResponse({ ok: true });
        case 'deleteSite':
          await Store.deleteSite(msg.siteId);
          return sendResponse({ ok: true });

        case 'getSettings':
          return sendResponse({ settings: await Store.getSettings() });
        case 'saveSettings':
          return sendResponse({ ok: true, settings: await Store.saveSettings(msg.settings) });

        default:
          return sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async response
});
