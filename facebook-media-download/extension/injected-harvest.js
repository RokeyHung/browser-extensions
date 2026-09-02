// injected-harvest.js — reads media URLs out of Facebook's own traffic
// (spec §6.2, §6.3). Runs in the page's MAIN world at document_start.
//
// Why it has to be here, and not in the content script or the worker:
//
//   * Video URLs only ever appear inside GraphQL responses. MV3's webRequest
//     cannot read a response body and declarativeNetRequest cannot either, so
//     wrapping fetch/XHR in the page world is the only way to see them (§6.5).
//   * Those responses cannot be re-fetched later: the endpoint needs a doc_id,
//     session tokens and internal variables that change constantly. Whatever is
//     not caught as it goes past is gone (§6.3).
//
// R6 governs every line below: this file READS. It must return the page its own
// untouched response, must never throw into page code, and must never delay a
// request. A Facebook that breaks because of this extension is worse than an
// extension that saves nothing.

(function () {
  'use strict';

  if (window.__fbmsHarvestInstalled) return;
  window.__fbmsHarvestInstalled = true;

  // json-scan.js and video-pick.js published themselves on globals so this file
  // could pick them up; taking them away again leaves the page's window as we
  // found it.
  const JsonScan = globalThis.__fbmsJsonScan;
  const VideoPick = globalThis.__fbmsVideoPick;
  delete globalThis.__fbmsJsonScan;
  delete globalThis.__fbmsVideoPick;
  if (!JsonScan || !VideoPick) return;

  const SCAN_BUDGET_MS = 8;
  const QUEUE_MAX = 20;
  const EMBEDDED_WATCH_MS = 5000;
  const PENDING_MAX = 200;

  let token = null;
  let pending = []; // records harvested before the content script said hello
  const counts = { dom: 0, embedded: 0, graphql: 0 };
  let lastError = null;

  const queue = []; // { text, source }
  let draining = false;

  const idle =
    window.requestIdleCallback ||
    function (fn) {
      return setTimeout(() => fn({ timeRemaining: () => SCAN_BUDGET_MS }), 16);
    };

  // ─── Handing records to the content script (spec §15.4) ──────────────────────

  function emit(records) {
    if (!records.length) return;
    if (!token) {
      // Keep the first payloads: the feed's opening GraphQL calls can land before
      // the content script has had a chance to introduce itself.
      pending = pending.concat(records).slice(-PENDING_MAX);
      return;
    }
    window.postMessage({ __fbms: 1, kind: 'records', token, records }, location.origin);
  }

  function emitStats() {
    if (!token) return;
    window.postMessage({ __fbms: 1, kind: 'stats', token, counts: { ...counts }, lastError }, location.origin);
  }

  window.addEventListener('message', (event) => {
    // Same window, same origin, and the shape we published. The token stops
    // accidental crosstalk and casual injection; it is not a secret from the page
    // — anything in the MAIN world can watch these messages. The boundary that
    // actually matters is the worker re-checking every URL's host before it
    // downloads (spec §16.1).
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.__fbms !== 1 || data.kind !== 'hello' || typeof data.token !== 'string') return;

    token = data.token;
    if (pending.length) {
      emit(pending);
      pending = [];
    }
    emitStats();
  });

  // ─── Scanning ────────────────────────────────────────────────────────────────

  // Facebook's GraphQL responses are frequently several JSON objects separated by
  // newlines (streamed @defer chunks), and its older /ajax/ endpoints prefix the
  // body with `for (;;);` to make it invalid as a script. A single JSON.parse of
  // the whole body fails on both, silently, for every video on the page.
  function parsePayload(text) {
    const objects = [];
    for (const rawLine of text.split('\n')) {
      let line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('for (;;);')) line = line.slice(9);
      if (!line.startsWith('{') && !line.startsWith('[')) continue;
      try {
        objects.push(JSON.parse(line));
      } catch (err) {
        // One malformed chunk must not cost the whole response.
      }
    }
    return objects;
  }

  function scanText(text, source) {
    let found = 0;
    for (const root of parsePayload(text)) {
      const result = JsonScan.scan(root, source);
      if (result.truncated) lastError = 'json-scan: node budget reached on a payload';
      if (result.records.length) {
        emit(result.records);
        found += result.records.length;
      }
    }
    if (found) {
      counts[source] += found;
      emitStats();
    }
  }

  function drain(deadline) {
    draining = false;
    const started = Date.now();
    while (queue.length && (deadline.timeRemaining() > 1 || Date.now() - started < SCAN_BUDGET_MS)) {
      const job = queue.shift();
      try {
        scanText(job.text, job.source);
      } catch (err) {
        lastError = `scan failed: ${(err && err.message) || err}`;
      }
      if (Date.now() - started >= SCAN_BUDGET_MS) break;
    }
    if (queue.length) schedule();
  }

  function schedule() {
    if (draining) return;
    draining = true;
    idle(drain, { timeout: 1000 });
  }

  function enqueue(text, source) {
    if (typeof text !== 'string' || text.length < 32) return;
    // Dropping the oldest is right: the newest payload describes what the user is
    // looking at now, and a backlog only builds while scrolling fast.
    if (queue.length >= QUEUE_MAX) queue.shift();
    queue.push({ text, source });
    schedule();
  }

  // ─── fetch (spec §6.3) ───────────────────────────────────────────────────────

  function interesting(url) {
    if (typeof url !== 'string') return false;
    return url.includes('/api/graphql') || url.includes('/graphql') || url.includes('/ajax/');
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    try {
      return String(input);
    } catch (err) {
      return '';
    }
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    try {
      if (!interesting(urlOf(args[0]))) return promise;
      return promise.then((response) => {
        try {
          // clone() has to happen before the page reads the body: reading the
          // original consumes it, and the page would be handed an empty
          // response. The clone is read on our own time, off the hot path.
          if (response && response.ok && response.body) {
            response
              .clone()
              .text()
              .then((text) => enqueue(text, 'graphql'))
              .catch(() => {});
          }
        } catch (err) {
          // Never let harvesting change what the page receives.
        }
        return response;
      });
    } catch (err) {
      return promise;
    }
  };

  // ─── XMLHttpRequest ──────────────────────────────────────────────────────────
  // Older parts of Facebook still use XHR, and they carry the same payloads.

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      this.__fbmsUrl = url;
    } catch (err) {
      // Some frozen instances refuse the property; harvesting is optional here.
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    try {
      if (interesting(urlOf(this.__fbmsUrl))) {
        this.addEventListener('loadend', () => {
          try {
            if (this.readyState === 4 && this.status >= 200 && this.status < 300) {
              const type = this.responseType;
              if (type === '' || type === 'text') enqueue(this.responseText, 'graphql');
            }
          } catch (err) {
            // responseText throws for some responseTypes; nothing to do.
          }
        });
      }
    } catch (err) {
      // Fall through to the real send no matter what.
    }
    return originalSend.apply(this, args);
  };

  // ─── Embedded payloads (spec §6.2) ───────────────────────────────────────────
  // The first screen is rendered from <script type="application/json" data-sjs>
  // blocks streamed into the document, before any GraphQL call happens.

  const seenScripts = new WeakSet();

  function scanScript(node) {
    if (!node || node.tagName !== 'SCRIPT' || seenScripts.has(node)) return;
    const type = node.getAttribute('type') || '';
    if (!type.includes('json')) return;
    seenScripts.add(node);
    enqueue(node.textContent || '', 'embedded');
  }

  function scanExistingScripts() {
    for (const node of document.querySelectorAll('script[type*="json"]')) scanScript(node);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) scanScript(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', scanExistingScripts);

  // Embedded blocks only appear during the initial render; after that everything
  // arrives over fetch. Disconnecting keeps one observer off the page for the
  // rest of a session that may last hours (spec §22).
  window.addEventListener('load', () => {
    scanExistingScripts();
    setTimeout(() => observer.disconnect(), EMBEDDED_WATCH_MS);
  });
})();
