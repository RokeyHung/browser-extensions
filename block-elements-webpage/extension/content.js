// content.js — main content script: applies rules and coordinates picker

(function () {
  'use strict';

  const STYLE_ID = 'ef-injected-rules';
  let appliedSelectors = [];
  let mutationDebounce = null;

  // ─── Initialization ────────────────────────────────────────────────────────

  function init() {
    loadAndApplyRules();
    observeDOMChanges();
    listenForMessages();
    listenForPickerTrigger();
  }

  // ─── Rule application ──────────────────────────────────────────────────────

  function loadAndApplyRules() {
    // After the extension is reloaded or updated, this script keeps running but
    // chrome.runtime is gone — bail out instead of throwing on every page load.
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;

    try {
      chrome.runtime.sendMessage({ type: 'getRulesForUrl', url: location.href }, (rules) => {
        if (chrome.runtime.lastError || !rules) return;
        applyRules(rules);
      });
    } catch (_err) {
      // Extension context invalidated; already-applied rules stay in place.
    }
  }

  function applyRules(rules) {
    const enabledSelectors = rules.filter((r) => r.enabled && r.selector).map((r) => r.selector);

    appliedSelectors = enabledSelectors;
    injectStyleTag(enabledSelectors);
  }

  function injectStyleTag(selectors) {
    let styleEl = document.getElementById(STYLE_ID);

    if (selectors.length === 0) {
      if (styleEl) styleEl.remove();
      return;
    }

    const css = selectors.map((s) => `${s} { display: none !important; }`).join('\n');

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent = css;
  }

  // ─── MutationObserver for dynamic content ─────────────────────────────────

  function observeDOMChanges() {
    const observer = new MutationObserver(() => {
      if (mutationDebounce) clearTimeout(mutationDebounce);
      mutationDebounce = setTimeout(() => {
        // Re-inject style to catch newly added elements
        injectStyleTag(appliedSelectors);
      }, 150);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ─── Message handling ──────────────────────────────────────────────────────

  function listenForMessages() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      switch (msg.type) {
        case 'startPicker':
          ElementPicker.activate(msg.mode);
          sendResponse({ success: true });
          break;

        case 'stopPicker':
          ElementPicker.deactivate();
          sendResponse({ success: true });
          break;

        case 'reloadRules':
          loadAndApplyRules();
          sendResponse({ success: true });
          break;

        case 'ping':
          sendResponse({ alive: true });
          break;
      }
    });
  }

  // ─── Listen for custom event from background (injected script) ────────────

  function listenForPickerTrigger() {
    window.addEventListener('elementFilter:startPicker', (e) => {
      ElementPicker.activate(e.detail && e.detail.mode);
    });
  }

  // ─── Start ────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
