// navigation-recorder.js — builds path records from webNavigation events:
// full page loads, SPA history.pushState/replaceState and hash changes
// (spec §6.2). Pure record building; the background wires up the listeners.

(function () {
  'use strict';

  // trigger: 'load' | 'history' | 'reference-fragment' (hash)
  function buildRecord(details, trigger) {
    if (!details || !details.url) return null;
    return {
      url: details.url,
      type: 'page',
      source: 'navigation',
      method: 'GET',
      tabId: details.tabId,
      trigger: trigger || 'load',
      timestamp: new Date(details.timeStamp || Date.now()).toISOString(),
      // Where the user came from is not always known; the SPA/hash events give us
      // the prior URL in details.url only, so discoveredFrom is filled by caller.
      discoveredFrom: null,
    };
  }

  globalThis.NavigationRecorder = { buildRecord };
})();
