// network-recorder.js — turns chrome.webRequest details into path records.
// Only metadata is captured: URL, method, resourceType, status, initiator,
// tabId, timestamp. No headers, no bodies (spec §6.3, §17).

(function () {
  'use strict';

  // chrome.webRequest resourceType → best-effort extension type.
  // Final classification is refined by PathClassifier with scope awareness.
  const RESOURCE_TYPE_HINT = {
    xmlhttprequest: 'api',
    fetch: 'api',
    websocket: 'api',
    script: 'asset',
    stylesheet: 'asset',
    image: 'asset',
    imageset: 'asset',
    font: 'asset',
    media: 'asset',
    object: 'asset',
    main_frame: 'page',
    sub_frame: 'page',
    ping: 'api',
    csp_report: 'api',
    other: null,
  };

  // Build a raw record from an onCompleted/onBeforeRequest details object.
  // Returns { url, method, resourceType, source, statusCode, discoveredFrom,
  //           tabId, timestamp, typeHint }.
  function buildRecord(details) {
    if (!details || !details.url) return null;
    const initiator = details.initiator || details.documentUrl || null;
    return {
      url: details.url,
      method: (details.method || 'GET').toUpperCase(),
      resourceType: details.type || null,
      source: 'network',
      statusCode: details.statusCode != null ? details.statusCode : null,
      discoveredFrom: initiator,
      tabId: details.tabId,
      timestamp: new Date(details.timeStamp || Date.now()).toISOString(),
      typeHint: RESOURCE_TYPE_HINT[details.type] || null,
    };
  }

  globalThis.NetworkRecorder = { RESOURCE_TYPE_HINT, buildRecord };
})();
