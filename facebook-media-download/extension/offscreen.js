// offscreen.js — fetches a media file and mints an object URL for it, and
// nothing else (spec §16.3).
//
// Only used when chrome.downloads refuses the URL directly. A service worker has
// no URL.createObjectURL, so this invisible page with a real DOM is the supported
// way to produce one. It cannot call chrome.downloads itself; the download stays
// in the worker.

const MAX_BYTES = 512 * 1024 * 1024;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return false;

  if (message.type === 'fbmsFetch') {
    // credentials: 'omit' is deliberate. Facebook's CDN URLs carry their own
    // signature, so cookies add nothing — and not sending them means no session
    // can leak out through a URL that turned out to be someone else's (§16.3).
    fetch(message.url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`CDN answered ${response.status}.`);
        const declared = Number(response.headers.get('content-length') || 0);
        if (declared > MAX_BYTES) throw new Error('File is too large to fetch this way.');

        const blob = await response.blob();
        if (blob.size > MAX_BYTES) throw new Error('File is too large to fetch this way.');
        sendResponse({ objectUrl: URL.createObjectURL(blob), contentType: blob.type, bytes: blob.size });
      })
      .catch((err) => sendResponse({ error: (err && err.message) || String(err) }));
    return true;
  }

  if (message.type === 'fbmsRelease') {
    if (message.url) URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
