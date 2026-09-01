// background.js — MV3 service worker: captures the page in front of the user
// (spec §4, §6, §15).
//
// One page, one shot, no crawling and no extra tabs. captureVisibleTab can only
// photograph what is on screen, so the capture happens in the tab the user
// invoked the extension on — which is also what grants the activeTab permission
// it needs.

importScripts('modules/settings.js', 'modules/image-store.js', 'modules/stitcher.js', 'modules/filename.js', 'modules/capture-page.js');

const C = globalThis.Settings.C;
const Store = globalThis.ImageStore;
const Capture = globalThis.CapturePage;

// The whole of the runtime state: at most one capture at a time.
let run = null; // { id, tabId, url, hostname, status, done, total, error }
let stopRequested = false;

function isCapturable(url) {
  return /^https?:\/\//i.test(url || '');
}

function publicRun() {
  if (!run) return null;
  const { id, url, hostname, status, done, total, error } = run;
  return { id, url, hostname, status, done, total, error };
}

async function persistRun() {
  if (!run) return;
  await chrome.storage.session.set({ activeRun: { id: run.id, tabId: run.tabId, status: run.status } });
  await chrome.action.setBadgeBackgroundColor({ color: '#5546CB' });
  await chrome.action.setBadgeText({ text: run.status === 'running' ? '…' : '' });
}

async function notifyOverlay(message) {
  if (!run) return;
  await chrome.tabs.sendMessage(run.tabId, message).catch(() => null);
}

// ─── Saving to disk (spec §16) ─────────────────────────────────────────────────

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: 'Create object URLs for the captured screenshot so it can be saved to disk.',
  });
}

function waitForDownload(downloadId) {
  return new Promise((resolve) => {
    function onChanged(delta) {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(delta.state.current);
      }
    }
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

// A service worker has no URL.createObjectURL, and a 20MB data: URL is not
// something chrome.downloads will swallow — hence the offscreen document, whose
// only job is minting object URLs (spec §16.1).
async function savePage(page) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'fpcPrepareDownload', id: page.id });
  const urls = (response && response.urls) || [];

  for (let i = 0; i < urls.length; i++) {
    const filename = globalThis.Filename.forPage({
      url: page.meta.url,
      hostname: page.meta.hostname,
      part: i + 1,
      parts: urls.length,
      format: page.meta.format,
    });
    const downloadId = await chrome.downloads.download({ url: urls[i], filename, saveAs: false });
    // Revoking before the file is written truncates it.
    await waitForDownload(downloadId);
  }

  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'fpcReleaseUrls', urls }).catch(() => null);
  await Store.removePage(page.id);
  await chrome.offscreen.closeDocument().catch(() => null);
}

// ─── The capture ───────────────────────────────────────────────────────────────

async function startCapture({ tabId, afterCapture }) {
  if (run && (run.status === 'running' || run.status === 'stopping')) throw new Error('A capture is already running.');

  const tab = await chrome.tabs.get(tabId);
  if (!tab || !isCapturable(tab.url)) throw new Error('This page is not supported.');

  const settings = await globalThis.Settings.get();
  // The popup's one control writes the same key the options page writes, so a
  // choice made in either place is simply the choice (spec §14).
  if (afterCapture === 'preview' || afterCapture === 'download') {
    settings.afterCapture = afterCapture;
    await globalThis.Settings.save({ afterCapture });
  }

  await Store.clear();
  stopRequested = false;
  run = {
    id: `cap_${Date.now()}`,
    tabId,
    url: tab.url,
    hostname: new URL(tab.url).hostname,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
  };
  await persistRun();

  // Deliberately not awaited: the popup closes the moment it is told the capture
  // started, and captureVisibleTab needs the focus the popup is holding.
  runCapture(settings).catch((err) => console.error('[full-page-capture] capture failed', err));

  return { ok: true, id: run.id };
}

async function runCapture(settings) {
  const timing = { interval: C.CAPTURE_INTERVAL };

  try {
    const tab = await chrome.tabs.get(run.tabId);
    await chrome.scripting.executeScript({ target: { tabId: run.tabId, frameIds: [0] }, files: ['content.js'] });
    await notifyOverlay({ type: 'fpcStart', url: run.url });

    const result = await Capture.capture({
      tabId: run.tabId,
      windowId: tab.windowId,
      settings,
      timing,
      isCancelled: () => stopRequested,
      onProgress: (done, total) => {
        run.done = done;
        run.total = total;
      },
    });

    const page = { id: run.id, index: 1, createdAt: Date.now(), meta: result.meta, thumb: result.thumb };
    await Store.putPage(page, result.blobs);

    if (settings.afterCapture === 'download') {
      await savePage(page);
    } else {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`result.html?page=${encodeURIComponent(page.id)}`) });
    }
    run.status = 'done';
  } catch (err) {
    run.status = err && err.cancelled ? 'stopped' : 'failed';
    run.error = (err && err.message) || String(err);
    if (run.status === 'failed') await notifyOverlay({ type: 'fpcError', message: run.error });
  } finally {
    await notifyOverlay({ type: 'fpcDone' });
    await persistRun();
    await chrome.action.setBadgeText({ text: '' });
    await chrome.storage.session.remove('activeRun');
  }
}

async function stopCapture() {
  stopRequested = true;
  if (run && run.status === 'running') {
    run.status = 'stopping';
    await persistRun();
  }
  return { ok: true };
}

// ─── Messaging (spec §15.1) ────────────────────────────────────────────────────

const handlers = {
  async getPopupState() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const settings = await globalThis.Settings.get();
    return {
      supported: !!(tab && isCapturable(tab.url)),
      tabId: tab ? tab.id : null,
      hostname: tab && isCapturable(tab.url) ? new URL(tab.url).hostname : '',
      settings,
      run: publicRun(),
    };
  },

  startCapture,
  stopCapture,

  getSettings: () => globalThis.Settings.get(),
  saveSettings: ({ patch }) => globalThis.Settings.save(patch),
  resetSettings: () => globalThis.Settings.reset(),
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Offscreen traffic is addressed and answered elsewhere.
  if (!message || message.target === 'offscreen') return false;
  const handler = handlers[message.type];
  if (!handler) return false;

  Promise.resolve(handler(message, sender))
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: (err && err.message) || String(err) }));
  return true;
});

// The keyboard shortcut grants activeTab on the current tab, exactly as opening
// the popup does — that is what makes capturing possible without asking for
// access to every site at install time (spec §18).
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isCapturable(tab.url)) return;
  if (run && run.status === 'running') return;
  await startCapture({ tabId: tab.id }).catch((err) => console.error('[full-page-capture]', err));
});

// Closing the tab mid-capture means stop.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (run && tabId === run.tabId) stopRequested = true;
});

// ─── Recovery (spec §15.3) ─────────────────────────────────────────────────────

// A killed worker must not leave the page frozen with its header hidden.
(async function recoverInterrupted() {
  const bag = await chrome.storage.session.get('activeRun');
  const active = bag && bag.activeRun;
  if (!active) return;

  await chrome.storage.session.remove('activeRun');
  await chrome.action.setBadgeText({ text: '' });

  if (typeof active.tabId === 'number') {
    await chrome.scripting
      .executeScript({ target: { tabId: active.tabId, frameIds: [0] }, func: () => window.__fpcPrepare && window.__fpcPrepare.unfreeze() })
      .catch(() => null);
  }
})();
