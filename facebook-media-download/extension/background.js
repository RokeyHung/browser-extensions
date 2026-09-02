// background.js — MV3 service worker: the router, the download queue and the
// only place that talks to chrome.downloads (spec §4, §15, §16).
//
// The content script decides *what* the user asked for; this file decides
// *whether and where* it gets written. That split is not tidiness: the content
// script lives inside a page Facebook controls, and it receives records from the
// MAIN world, so nothing it says about a URL can be taken on trust (§16.1).

importScripts('modules/settings.js', 'modules/filename.js', 'modules/history-store.js');

const C = globalThis.Settings.C;
const Filename = globalThis.Filename;
const History = globalThis.HistoryStore;

const harvestByTab = new Map(); // tabId -> stats reported by the content script
const queue = [];
let running = 0;

// ─── URL validation (spec §16.1) ───────────────────────────────────────────────

// The last line of defence. Even if a hostile page script defeated the token
// handshake and the content script's own checks, the worst it can achieve is a
// file from Facebook's own CDN — not an executable from somewhere else.
function isAllowedMediaUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'fbcdn.net' || host.endsWith('.fbcdn.net') || host === 'facebook.com' || host.endsWith('.facebook.com');
  } catch (err) {
    return false;
  }
}

// ─── Download plumbing (spec §16.2, §16.3) ─────────────────────────────────────

function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    function onChanged(delta) {
      if (delta.id !== downloadId) return;
      if (delta.state && (delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve({ state: delta.state.current, error: delta.error ? delta.error.current : null });
      }
    }
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

async function bytesOf(downloadId) {
  const [item] = await chrome.downloads.search({ id: downloadId });
  return item ? item.fileSize || item.totalBytes || 0 : 0;
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Fetch a media file the browser refused to download directly, so it can be saved.',
  });
}

// The fallback path: fetch the bytes ourselves and hand chrome.downloads an
// object URL. A service worker has no URL.createObjectURL, which is the whole
// reason an offscreen document exists here (spec §16.3).
async function downloadViaOffscreen(url, filename) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'fbmsFetch', url });
  if (!response || !response.objectUrl) throw new Error((response && response.error) || 'Could not fetch the file.');

  try {
    const downloadId = await chrome.downloads.download({ url: response.objectUrl, filename, conflictAction: 'uniquify' });
    // Revoking before the file is written truncates it.
    const outcome = await waitForDownload(downloadId);
    if (outcome.state !== 'complete') throw new Error(outcome.error || 'The download was interrupted.');
    return { downloadId, bytes: response.bytes || (await bytesOf(downloadId)) };
  } finally {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'fbmsRelease', url: response.objectUrl }).catch(() => null);
    await chrome.offscreen.closeDocument().catch(() => null);
  }
}

const EXPIRED_ERRORS = new Set(['SERVER_FORBIDDEN', 'SERVER_UNAUTHORIZED', 'SERVER_BAD_CONTENT', 'SERVER_FAILED']);

async function writeFile(url, filename) {
  const warnings = [];

  let downloadId = null;
  try {
    downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
  } catch (err) {
    return { ...(await downloadViaOffscreen(url, filename)), warnings, viaOffscreen: true };
  }

  const outcome = await waitForDownload(downloadId);
  if (outcome.state === 'complete') return { downloadId, bytes: await bytesOf(downloadId), warnings };

  // Another download manager hooking chrome.downloads is a documented hazard for
  // this class of extension; naming it beats letting the user assume we broke
  // (spec §16.5).
  if (outcome.error === 'USER_CANCELED') {
    return { downloadId: null, bytes: 0, cancelled: true, warnings: ['Download was cancelled — possibly by another download manager extension.'] };
  }

  if (EXPIRED_ERRORS.has(outcome.error)) {
    const result = await downloadViaOffscreen(url, filename);
    return { ...result, warnings, viaOffscreen: true };
  }

  throw new Error(outcome.error || 'The download was interrupted.');
}

// ─── One media item (spec §16) ────────────────────────────────────────────────

function tell(tabId, message) {
  if (typeof tabId !== 'number') return;
  chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

// A link that has expired cannot be repaired by editing it (R3), so the only
// move left is to ask the page for a fresher record and try that once (§16.4).
async function reharvest(tabId, media) {
  const response = await chrome.tabs.sendMessage(tabId, { type: 'fbmsReharvest', mediaId: media.mediaId, key: media.key }).catch(() => null);
  return response && response.url && isAllowedMediaUrl(response.url) ? response : null;
}

async function runJob(job) {
  const { tabId, post, media, settings, batch } = job;
  tell(tabId, { type: 'fbmsProgress', mediaKey: media.key, state: 'working', batch });

  try {
    if (!isAllowedMediaUrl(media.url)) throw new Error('Blocked a download from an unexpected host.');

    const filename = Filename.build({ pattern: settings.filenamePattern, subfolder: settings.subfolder, post, media });
    let result;
    try {
      result = await writeFile(media.url, filename);
    } catch (err) {
      const fresh = await reharvest(tabId, media);
      if (!fresh) throw new Error('Link expired. Refresh the post and try again.');
      result = await writeFile(fresh.url, filename);
    }

    if (result.cancelled) {
      tell(tabId, { type: 'fbmsProgress', mediaKey: media.key, state: 'error', reason: result.warnings[0], batch });
      return;
    }

    if (settings.downloadPoster && media.poster && isAllowedMediaUrl(media.poster)) {
      const posterName = Filename.build({ pattern: settings.filenamePattern, subfolder: settings.subfolder, post, media, posterOf: true });
      await writeFile(media.poster, posterName).catch(() => null);
    }

    if (settings.historyLimit) {
      await History.put({
        key: media.key,
        mediaId: media.mediaId || '',
        postId: post.postId || '',
        postUrl: post.postUrl || '',
        author: post.author || '',
        filename,
        url: media.url,
        kind: media.kind,
        quality: media.quality || '',
        bytes: result.bytes || 0,
        downloadedAt: Date.now(),
        warnings: [...(media.warning ? [media.warning] : []), ...result.warnings],
      });
      await History.trim(settings.historyLimit);
    }

    tell(tabId, { type: 'fbmsProgress', mediaKey: media.key, state: 'done', batch });

    if (settings.notifyOnComplete && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Saved',
        message: filename,
      });
    }
  } catch (err) {
    // History is a convenience; a failed download must not become a silent
    // success, so the reason travels back to the button (spec R8, §10.4).
    tell(tabId, { type: 'fbmsProgress', mediaKey: media.key, state: 'error', reason: (err && err.message) || String(err), batch });
  }
}

// Three at a time. Firing twelve requests at once for a twelve-photo album is
// how the CDN starts answering 429 (spec §16.2).
function pump() {
  while (running < C.MAX_CONCURRENT_DOWNLOADS && queue.length) {
    const job = queue.shift();
    running++;
    runJob(job).finally(() => {
      running--;
      pump();
    });
  }
}

async function downloadMedia({ post, media }, sender) {
  const settings = await globalThis.Settings.get();
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const list = (media || []).filter((item) => item && item.url);
  if (!list.length) throw new Error('Nothing to download.');

  for (const item of list) queue.push({ tabId, post: post || {}, media: item, settings, batch: list.length > 1 });
  pump();
  return { queued: list.length, ids: list.map((item) => item.key) };
}

// ─── Message router (spec §15.1, §15.2) ───────────────────────────────────────

const handlers = {
  downloadMedia,

  queryDownloaded: ({ keys }) => History.has(keys || []).then((downloaded) => ({ downloaded })),

  reportHarvest: (message, sender) => {
    if (sender && sender.tab) harvestByTab.set(sender.tab.id, { ...message.stats, at: Date.now() });
    return { ok: true };
  },

  async getPopupState() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const onFacebook = !!(tab && /^https?:\/\/([\w-]+\.)*facebook\.com\//i.test(tab.url || ''));
    const stats = tab ? harvestByTab.get(tab.id) : null;
    const counts = (stats && stats.counts) || { dom: 0, embedded: 0, graphql: 0 };
    const history = await History.stats().catch(() => ({ total: 0, today: 0 }));

    return {
      onFacebook,
      tabId: tab ? tab.id : null,
      path: onFacebook ? new URL(tab.url).host + new URL(tab.url).pathname : '',
      harvested: counts.dom + counts.embedded + counts.graphql,
      counts,
      today: history.today,
      total: history.total,
    };
  },

  listHistory: (message) => History.list(message),
  clearHistory: () => History.clear(),
  removeHistory: ({ key }) => History.remove(key),

  // Re-downloading uses the URL stored with the entry. It is often expired by
  // now, and that is reported plainly rather than papered over: the honest fix is
  // to open the post again (spec §16.4).
  async redownload({ key }) {
    const entry = await History.get(key);
    if (!entry) throw new Error('That entry is gone from the history.');
    if (!isAllowedMediaUrl(entry.url)) throw new Error('Stored link is not a Facebook media URL.');

    const filename = entry.filename.split('/').pop();
    const result = await writeFile(entry.url, entry.filename.includes('/') ? entry.filename : filename).catch((err) => {
      throw new Error(`Link expired. Open the post and save it again. (${(err && err.message) || err})`);
    });
    return { ok: true, bytes: result.bytes };
  },

  async runDiagnostics({ tabId }) {
    const target = typeof tabId === 'number' ? tabId : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (typeof target !== 'number') throw new Error('No tab to inspect.');
    const report = await chrome.tabs.sendMessage(target, { type: 'fbmsDiagnostics' }).catch(() => null);
    if (!report) throw new Error('Open a Facebook tab and reload it, then run this again.');
    return { ...report, extensionVersion: chrome.runtime.getManifest().version };
  },

  getSettings: () => globalThis.Settings.get(),
  resetSettings: () => globalThis.Settings.reset().then(broadcastSettings),
  saveSettings: ({ patch }) => globalThis.Settings.save(patch).then(broadcastSettings),
};

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({ url: ['*://*.facebook.com/*'] });
  for (const tab of tabs) tell(tab.id, { type: 'fbmsSettingsChanged', settings });
  return settings;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === 'offscreen') return false;
  const handler = handlers[message.type];
  if (!handler) return false;

  Promise.resolve(handler(message, sender))
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: (err && err.message) || String(err) }));
  return true;
});

// ─── Keyboard shortcut (spec §10.5) ───────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'download-hovered-media') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\/([\w-]+\.)*facebook\.com\//i.test(tab.url || '')) return;
  tell(tab.id, { type: 'fbmsShortcut' });
});

chrome.tabs.onRemoved.addListener((tabId) => harvestByTab.delete(tabId));
