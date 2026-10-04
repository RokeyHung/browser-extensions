// injected-guard.js — runs in the page's MAIN world at document_start.
// Overrides window.open, form.submit() and clicks on detached links — in this
// realm and in every same-origin child frame — before page scripts run, and
// reports blocks back to the content script via postMessage (spec §8.1, §13.4).
//
// It cannot use chrome.* APIs, so the content script pushes it a plain config
// object (PRG_CONFIG) and it makes a synchronous local decision.

(function () {
  'use strict';

  let config = { active: false };

  // ── Local, self-contained target evaluation (mirror of NavigationGuard) ──
  // This runs in the page world with no access to chrome.* or the extension's
  // modules, so the shared block is inlined here too. It has to agree with
  // DomainMatcher exactly: `config.baseDomain` is computed by the service
  // worker, and any disagreement here would block the site's own navigations.

  // >>> shared:domain-suffix — generated, do not edit (make sync-domain-suffix) >>>
  // Derive the registrable domain (eTLD+1) from a hostname. Getting this wrong is
  // not cosmetic: a base domain of `co.id` makes every unrelated .co.id site look
  // like the same site, which silently widens cookie queries, autofill scope and
  // same-site checks to strangers.

  // Second-level labels a country registry uses to group registrations rather
  // than to name a site: the `com` in `com.vn`, the `co` in `co.uk`. Paired with
  // the two-letter country TLD test below this covers every country following the
  // convention, including the ones nobody here thought to write down.
  // `web` is deliberately absent: `web.de` is a real site, not a suffix.
  const REGISTRY_LABELS = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gob', 'nom']);

  // Public suffixes spanning 2+ labels that the rule cannot derive, so they have
  // to be named. Mostly hosting providers that isolate each subdomain as its own
  // site — without these, treating `alice.github.io` as a site would sweep in
  // every neighbouring project.
  const NAMED_SUFFIXES = new Set([
    'me.uk',
    'github.io',
    'gitlab.io',
    'pages.dev',
    'vercel.app',
    'netlify.app',
    'web.app',
    'firebaseapp.com',
    'herokuapp.com',
    'workers.dev',
  ]);

  // True for a country second-level suffix such as `com.vn`, `co.id` or `ac.jp`:
  // a registry label under a two-letter country TLD.
  function isCountrySecondLevel(suffix) {
    const parts = suffix.split('.');
    if (parts.length !== 2) return false;
    const [label, tld] = parts;
    return /^[a-z]{2}$/i.test(tld) && REGISTRY_LABELS.has(label.toLowerCase());
  }

  // True when `suffix` is something anyone can register under, so it can never be
  // a site on its own.
  function isPublicSuffix(suffix) {
    return NAMED_SUFFIXES.has(suffix.toLowerCase()) || isCountrySecondLevel(suffix);
  }

  // True for hosts with no meaningful site label: IP addresses and single-label
  // hosts such as `localhost` or an intranet name.
  function isLiteralHost(hostname) {
    if (!hostname) return true;
    return hostname.includes(':') || /^[\d.]+$/.test(hostname);
  }

  // e.g. www.facebook.com -> facebook.com, foo.example.co.uk -> example.co.uk
  function getBaseDomain(hostname) {
    if (!hostname) return hostname;
    if (isLiteralHost(hostname)) return hostname;

    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;

    const last2 = parts.slice(-2).join('.');
    const last3 = parts.slice(-3).join('.');
    if (parts.length >= 4 && isPublicSuffix(last3)) return parts.slice(-4).join('.');
    if (isPublicSuffix(last2)) return last3;
    return last2;
  }

  // The site's own label inside its registrable domain — the part that stays the
  // same across subdomains and country TLDs.
  // e.g. www.facebook.com -> facebook, foo.example.co.uk -> example
  // Returns null when the host has no such label (IPs, localhost).
  function getSiteLabel(hostname) {
    if (isLiteralHost(hostname)) return null;
    const base = getBaseDomain(hostname);
    const label = base ? base.split('.')[0] : '';
    if (!label) return null;
    // A bare single-label host is its own base domain; treat it as literal so we
    // never widen the scope to "everything named localhost".
    if (base === hostname && !hostname.includes('.')) return null;
    return label;
  }
  // <<< shared:domain-suffix <<<

  function allowed(host) {
    const hosts = config.allowedHosts || [];
    return hosts.some((h) => host === h || host.endsWith('.' + h));
  }

  // Returns { block, reason } for a candidate navigation.
  function evaluate(rawUrl, trigger) {
    if (!config.active) return { block: false };

    let target;
    try {
      target = new URL(rawUrl, location.href);
    } catch {
      return { block: true, reason: 'invalid target URL' };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return { block: false };

    // Compared against the tab's site, not this frame's: in a player iframe
    // from another domain, "same origin as me" is exactly the ad network.
    if (target.origin === (config.siteOrigin || location.origin)) return { block: false };
    const targetHost = target.hostname.toLowerCase();
    if (getBaseDomain(targetHost) === config.baseDomain) return { block: false };
    if (allowed(targetHost)) return { block: false };

    const s = config.settings || {};
    if (trigger === 'window.open' && s.blockWindowOpen === false) return { block: false };
    if (trigger === 'scripted-redirect' && s.blockScriptedRedirect === false) return { block: false };
    if (trigger === 'blank-link' && s.blockExternalBlank === false) return { block: false };
    if (trigger === 'form-submit' && s.blockExternalFormSubmit === false) return { block: false };

    const reasonMap = {
      'window.open': 'window.open external',
      'scripted-redirect': 'scripted redirect external',
      'blank-link': 'external target=_blank',
      'form-submit': 'external form submit',
    };
    return { block: true, reason: reasonMap[trigger] || 'external navigation', targetUrl: target.href };
  }

  function report(targetUrl, reason, trigger) {
    window.postMessage({ __prg: true, kind: 'blocked', targetUrl, reason, trigger }, '*');
  }

  // ── Where a link/form target lands (mirror of content.js) ───────────────
  // A navigation that stays inside a subframe is that frame's business; only
  // one that opens a tab or takes over the top page is something the tab-level
  // rule speaks for (spec §8.2).
  function opensNewContext(win, target) {
    const t = String(target || '').toLowerCase();
    if (!t || t === '_self' || t === '_parent' || t === '_top') return false;
    if (t === '_blank') return true;
    // Any other name opens a new tab unless a frame on the page already has it.
    return !Array.from(win.document.querySelectorAll('iframe[name], frame[name]')).some((f) => f.name === target);
  }

  function landsInTab(win, target) {
    const t = String(target || '').toLowerCase();
    if (win.top === win) return true;
    return t === '_top' || (t === '_parent' && win.parent === win.top);
  }

  // ── Per-realm patches ───────────────────────────────────────────────────
  // Every same-origin child frame (about:blank, srcdoc) is a fresh realm with
  // its own untouched window.open, HTMLFormElement.prototype.submit and so on.
  // Content scripts reach such a frame late or not at all, and with no config
  // yet, so `iframe.contentWindow.open(ad)` straight after appendChild went past
  // the guard — measured as a tab that opened and was closed by the worker
  // 40ms later. The parent patches the child itself, synchronously, when the
  // page first touches it, sharing this realm's config.
  const guardedRealms = new WeakSet();

  function guardRealm(win) {
    try {
      if (guardedRealms.has(win)) return;
      guardedRealms.add(win);
    } catch {
      return; // cross-origin WindowProxy: not ours to patch
    }
    try {
      patchOpen(win);
      patchFrameAccess(win);
      patchDetachedLinks(win);
      patchFormSubmit(win);
    } catch {
      /* realm torn down mid-patch */
    }
  }

  function patchOpen(win) {
    const originalOpen = win.open;
    win.open = function (url, target, features) {
      const decision = evaluate(url || 'about:blank', 'window.open');
      if (decision.block) {
        report(decision.targetUrl || String(url), decision.reason, 'window.open');
        return null;
      }
      return originalOpen.call(win, url, target, features);
    };
  }

  function patchFrameAccess(win) {
    const proto = win.HTMLIFrameElement.prototype;
    const hook = (prop, toWindow) => {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.get) return;
      Object.defineProperty(proto, prop, {
        ...desc,
        get() {
          const value = desc.get.call(this);
          try {
            const child = toWindow(value);
            if (child) guardRealm(child);
          } catch {
            /* cross-origin */
          }
          return value;
        },
      });
    };
    hook('contentWindow', (w) => w);
    hook('contentDocument', (d) => d && d.defaultView);
  }

  // A link that is never attached to the document dispatches its click on a
  // detached tree, so the content script's capture listener on `document`
  // never sees it: `a.click()` and `a.dispatchEvent(click)` on an anchor built
  // in memory opened the ad anyway. Attached links stay with the content script.
  function patchDetachedLinks(win) {
    const blocks = (el, event) => {
      const anchor = el && el.closest ? el.closest('a[href], area[href]') : null;
      if (!anchor || anchor.isConnected) return false;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return false;

      const newTab = opensNewContext(win, anchor.target) || !!(event && (event.ctrlKey || event.metaKey || event.shiftKey));
      if (!newTab && (config.mode !== 'strict' || !landsInTab(win, anchor.target))) return false;

      const decision = evaluate(anchor.href, 'blank-link');
      if (!decision.block) return false;
      report(decision.targetUrl, decision.reason, 'blank-link');
      return true;
    };

    const originalClick = win.HTMLElement.prototype.click;
    win.HTMLElement.prototype.click = function () {
      if (blocks(this, null)) return;
      return originalClick.call(this);
    };

    const originalDispatch = win.EventTarget.prototype.dispatchEvent;
    win.EventTarget.prototype.dispatchEvent = function (event) {
      if (event && event.type === 'click' && blocks(this, event)) return false;
      return originalDispatch.call(this, event);
    };
  }

  // form.submit() fires no `submit` event — that is the spec, not a bug — so the
  // content script's submit listener cannot see it. requestSubmit() does fire
  // one and is left to the content script.
  function patchFormSubmit(win) {
    const originalSubmit = win.HTMLFormElement.prototype.submit;
    win.HTMLFormElement.prototype.submit = function () {
      const action = this.getAttribute('action');
      if (action && (opensNewContext(win, this.target) || landsInTab(win, this.target))) {
        const decision = evaluate(this.action, 'form-submit');
        if (decision.block) {
          report(decision.targetUrl, decision.reason, 'form-submit');
          return;
        }
      }
      return originalSubmit.call(this);
    };
  }

  guardRealm(window);

  // ── location.assign / location.replace are NOT patched here ─────────────
  // They cannot be. Every member of `Location` is [LegacyUnforgeable]: an own,
  // non-writable, non-configurable property of the instance, precisely so a
  // page cannot lie to itself about where it is. Measured on Chrome 152:
  //
  //   Object.getOwnPropertyDescriptor(location, 'assign')
  //     → { writable: false, configurable: false, enumerable: true }
  //   Object.defineProperty(location, 'assign', …)  → TypeError
  //   location.assign = fn                          → TypeError
  //   patching Location.prototype                   → TypeError
  //
  // Until 1.1.1 this file tried anyway. It read the method off
  // Object.getPrototypeOf(location), where it does not exist, so
  // `if (typeof original !== 'function') return` bailed out before the
  // defineProperty that would have thrown — no patch, no error, and nothing to
  // suggest the redirect guard was inert. Scripted redirects are handled by the
  // service worker's webNavigation layer instead (background.js).

  // ── Receive config from the content script ──────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__prg !== true) return;
    if (data.kind === 'config' && data.config) {
      config = data.config;
    }
  });
})();
