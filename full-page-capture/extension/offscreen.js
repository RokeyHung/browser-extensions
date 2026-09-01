// offscreen.js — mints object URLs, and nothing else (spec §16.1).
//
// A service worker has no URL.createObjectURL, and chrome.downloads needs a
// URL; a 20MB image as a data: URL is not something it will accept. An
// offscreen document is the supported way out: an invisible page with a real
// DOM. It cannot call chrome.downloads itself, so the actual download stays in
// the worker.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;

  if (message.type === 'fpcPrepareDownload') {
    globalThis.ImageStore.getBlobs(message.id)
      .then((blobs) => sendResponse({ urls: blobs.map((blob) => URL.createObjectURL(blob)) }))
      .catch((err) => sendResponse({ urls: [], error: (err && err.message) || String(err) }));
    return true;
  }

  if (message.type === 'fpcReleaseUrls') {
    for (const url of message.urls || []) URL.revokeObjectURL(url);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
