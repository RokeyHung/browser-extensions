// content.js — scans the live DOM of the current page for candidate URLs
// (spec §6.1, §13.3). Reads only element URL attributes; never touches cookies,
// storage or page text. Responds to `scanDom` messages from the background.

(function () {
  'use strict';

  // element selector → attribute holding the URL.
  const TARGETS = [
    ['a[href]', 'href'],
    ['link[href]', 'href'],
    ['script[src]', 'src'],
    ['img[src]', 'src'],
    ['iframe[src]', 'src'],
    ['form[action]', 'action'],
    ['source[src]', 'src'],
    ['video[src]', 'src'],
    ['audio[src]', 'src'],
  ];

  function scanDom() {
    const urls = new Set();
    for (const [selector, attr] of TARGETS) {
      let nodes;
      try {
        nodes = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of nodes) {
        const raw = el.getAttribute(attr);
        if (!raw) continue;
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (/^(javascript:|data:|blob:|mailto:|tel:|about:)/i.test(trimmed)) continue;
        // Resolve to absolute using the element's resolved property when available.
        let abs = trimmed;
        try {
          abs = new URL(trimmed, document.baseURI).href;
        } catch {
          continue;
        }
        urls.add(abs);
      }
      // srcset (img/source) can carry several URLs.
      if (selector === 'img[src]' || selector === 'source[src]') {
        // handled below to avoid double loop cost
      }
    }

    // Pick up srcset candidates too.
    try {
      document.querySelectorAll('img[srcset], source[srcset]').forEach((el) => {
        const srcset = el.getAttribute('srcset');
        if (!srcset) return;
        srcset.split(',').forEach((part) => {
          const u = part.trim().split(/\s+/)[0];
          if (!u) return;
          try {
            urls.add(new URL(u, document.baseURI).href);
          } catch {
            /* ignore */
          }
        });
      });
    } catch {
      /* ignore */
    }

    return [...urls];
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'scanDom') {
      sendResponse({ urls: scanDom(), pageUrl: location.href });
      return true;
    }
  });
})();
