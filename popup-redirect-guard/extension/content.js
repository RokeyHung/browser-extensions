// content.js — isolated-world content script (document_start).
// Fetches protection config, forwards it to the MAIN-world guard, intercepts
// link/form navigations, and renders the "blocked" toast.

(function () {
  'use strict';

  const DM = globalThis.DomainMatcher;
  let config = { active: false };

  // ─── Bootstrap ──────────────────────────────────────────────────────────
  function init() {
    requestConfig();
    document.addEventListener('click', onClickCapture, true);
    document.addEventListener('submit', onSubmitCapture, true);
    window.addEventListener('message', onGuardMessage);
    if (contextAlive()) chrome.runtime.onMessage.addListener(onRuntimeMessage);
  }

  // ─── Extension context lifetime ─────────────────────────────────────────
  // This script keeps running after the extension is reloaded, updated or
  // disabled, but its chrome.runtime is torn down. That matters more here than
  // in a passive extension: interception would keep calling preventDefault()
  // using stale config while being unable to report, show a toast or offer
  // "Open once" — every external link on the page would die silently.

  let stoodDown = false;

  function contextAlive() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  }

  // Give the page back to the user: stop intercepting here and tell the
  // MAIN-world guard to stop patching window.open.
  function standDown() {
    if (stoodDown) return;
    stoodDown = true;
    config = { active: false };
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('submit', onSubmitCapture, true);
    pushConfigToGuard();
    dismissToast();
  }

  // Returns false when the message could not be sent.
  function sendMessage(message, callback) {
    if (!contextAlive()) {
      standDown();
      return false;
    }
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) return;
        if (callback) callback(resp);
      });
      return true;
    } catch {
      standDown();
      return false;
    }
  }

  function requestConfig() {
    sendMessage({ type: 'getSiteConfig', url: location.href }, (resp) => {
      if (!resp) return;
      config = resp;
      pushConfigToGuard();
      if (Array.isArray(resp.pendingToasts)) {
        resp.pendingToasts.forEach((p) => showToast(p));
      }
    });
  }

  function pushConfigToGuard() {
    // Strip the fields the MAIN-world guard needs (no functions / chrome refs).
    window.postMessage(
      {
        __prg: true,
        kind: 'config',
        config: {
          active: config.active,
          mode: config.mode,
          baseDomain: config.baseDomain,
          allowedHosts: config.allowedHosts || [],
          settings: config.settings || {},
        },
      },
      '*'
    );
  }

  // ─── Local target evaluation (link / form triggers) ─────────────────────
  function baseDomain(host) {
    return DM.getBaseDomain(host);
  }

  function isAllowedHost(host) {
    return (config.allowedHosts || []).some((h) => host === h || host.endsWith('.' + h));
  }

  // Returns { block, reason } for a link/form target.
  function evaluate(rawUrl, trigger) {
    if (!config.active) return { block: false };

    let target;
    try {
      target = new URL(rawUrl, location.href);
    } catch {
      return { block: true, reason: 'invalid target URL' };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return { block: false };
    if (target.origin === location.origin) return { block: false };

    const host = target.hostname.toLowerCase();
    if (baseDomain(host) === config.baseDomain) return { block: false };
    if (isAllowedHost(host)) return { block: false };

    const s = config.settings || {};
    if (trigger === 'blank-link' && s.blockExternalBlank === false) return { block: false };
    if (trigger === 'form-submit' && s.blockExternalFormSubmit === false) return { block: false };

    const reason = trigger === 'form-submit' ? 'external form submit' : 'external target=_blank';
    return { block: true, reason, targetUrl: target.href };
  }

  // ─── Click interception (spec §8.2, §8.3) ────────────────────────────────
  function onClickCapture(e) {
    if (!config.active) return;
    // Check before any preventDefault: never block what we cannot report on.
    if (!contextAlive()) return standDown();
    const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    const opensNewTab = anchor.target === '_blank' || e.ctrlKey || e.metaKey;
    // In strict mode any external link is a candidate; in normal mode only _blank.
    if (config.mode !== 'strict' && !opensNewTab) return;

    const decision = evaluate(href, 'blank-link');
    if (!decision.block) return;

    e.preventDefault();
    e.stopPropagation();
    onBlocked(decision);
  }

  // ─── Form submit interception (spec §8.7) ────────────────────────────────
  function onSubmitCapture(e) {
    if (!config.active) return;
    if (!contextAlive()) return standDown();
    const form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    const action = form.getAttribute('action');
    if (!action) return;

    const decision = evaluate(action, 'form-submit');
    if (!decision.block) return;

    e.preventDefault();
    e.stopPropagation();
    onBlocked(decision);
  }

  // ─── Guard (MAIN world) → content messages ──────────────────────────────
  function onGuardMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__prg !== true) return;
    if (data.kind === 'blocked') {
      onBlocked({ block: true, reason: data.reason, targetUrl: data.targetUrl });
    }
  }

  // ─── Background → content messages ───────────────────────────────────────
  function onRuntimeMessage(msg, _sender, sendResponse) {
    if (msg.type === 'guardToast') {
      showToast(msg.payload);
      sendResponse({ ok: true });
    } else if (msg.type === 'ping') {
      sendResponse({ alive: true });
    } else if (msg.type === 'configChanged') {
      requestConfig();
      sendResponse({ ok: true });
    }
  }

  // ─── Report + toast ──────────────────────────────────────────────────────
  function onBlocked(decision) {
    const settings = config.settings || {};
    sendMessage({ type: 'reportBlocked', sourceUrl: location.href, targetUrl: decision.targetUrl, reason: decision.reason }, (resp) => {
      if (resp && resp.show === false) return; // rate-limited
      if (settings.showToast === false) return;
      showToast({
        targetUrl: decision.targetUrl,
        targetHostname: hostnameOf(decision.targetUrl),
        reason: decision.reason,
        sourceHostname: config.sourceHostname,
        suppressed: resp ? resp.suppressed : 0,
      });
    });
  }

  function hostnameOf(url) {
    try {
      return new URL(url, location.href).hostname;
    } catch {
      return url;
    }
  }

  // ─── Toast UI (spec §5.2, §16) ───────────────────────────────────────────
  let toastEl = null;
  let toastTimer = null;

  function showToast(payload) {
    // Only render the toast in the top frame to avoid nested duplicates.
    if (window.top !== window.self) return;

    const container = ensureToastContainer();
    if (!container) return;

    const target = payload.targetHostname || hostnameOf(payload.targetUrl) || 'unknown';
    const url = payload.targetUrl || '';

    toastEl = document.createElement('div');
    toastEl.className = 'prg-toast';
    toastEl.innerHTML = `
      <div class="prg-toast-head">
        <span class="prg-toast-shield">🛡</span>
        <span class="prg-toast-title">Blocked unwanted popup</span>
        <button class="prg-toast-x" data-prg="dismiss" title="Dismiss">✕</button>
      </div>
      <div class="prg-toast-domain">${escapeHtml(target)}</div>
      <div class="prg-toast-reason">${escapeHtml(payload.reason || 'external navigation')}</div>
      <div class="prg-toast-actions">
        <button class="prg-btn prg-btn-primary" data-prg="open">Open once</button>
        <button class="prg-btn" data-prg="allow">Always allow</button>
        <button class="prg-btn prg-btn-ghost" data-prg="dismiss">Dismiss</button>
      </div>
    `;

    container.innerHTML = '';
    container.appendChild(toastEl);

    toastEl.querySelectorAll('[data-prg]').forEach((btn) => {
      btn.addEventListener('click', () => handleToastAction(btn.dataset.prg, url, target));
    });

    resetToastTimer();
  }

  function handleToastAction(action, url, targetHostname) {
    if (action === 'open') {
      // If the extension is gone, open it from here rather than leaving the
      // user with a link that does nothing.
      if (!sendMessage({ type: 'openOnce', url }) && url) {
        window.open(url, '_blank', 'noopener');
      }
    } else if (action === 'allow') {
      sendMessage(
        { type: 'alwaysAllow', sourceUrl: location.href, targetHostname },
        () => requestConfig() // refresh config + guard so it stops blocking
      );
    }
    dismissToast();
  }

  function ensureToastContainer() {
    if (!document.body && !document.documentElement) return null;
    let host = document.getElementById('prg-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'prg-toast-host';
      (document.body || document.documentElement).appendChild(host);
    }
    return host;
  }

  function resetToastTimer() {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(dismissToast, 5000);
  }

  function dismissToast() {
    if (toastTimer) clearTimeout(toastTimer);
    const host = document.getElementById('prg-toast-host');
    if (host) host.innerHTML = '';
    toastEl = null;
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── Start ───────────────────────────────────────────────────────────────
  init();
})();
