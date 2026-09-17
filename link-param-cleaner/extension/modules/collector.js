// collector.js — the decisions behind "was this navigation worth recording, and
// what did it carry". Pure functions over URLs and webNavigation details, so the
// service worker stays wiring. Spec §7.

if (typeof Collector === 'undefined') {
  var Collector = (() => {
    // A navigation the user started from inside the page. Everything a page can
    // trigger by itself also arrives as 'link' — Popup Redirect Guard measured
    // that for location.href, assign and replace — but that is fine here: the
    // worst a script-driven navigation costs us is one extra row in a table.
    // What this list is really for is keeping the omnibox, bookmarks and history
    // out, because those are not the site handing out a link (spec §7.3).
    const COLLECTABLE_TRANSITIONS = new Set(['link', 'form_submit']);
    const DISQUALIFYING_QUALIFIERS = new Set(['from_address_bar']);

    function isCollectableTransition(details) {
      if (!details || !COLLECTABLE_TRANSITIONS.has(details.transitionType)) return false;
      return !(details.transitionQualifiers || []).some((qualifier) => DISQUALIFYING_QUALIFIERS.has(qualifier));
    }

    // Param names in order of first appearance, one entry per name. A name
    // repeated in the same URL is one observation: `removeParams` deletes every
    // copy, so counting them separately would inflate the number the user reads
    // without telling them anything new (spec §7.4).
    function extractParams(url) {
      const parsed = globalThis.DomainUtils.safeUrl(url);
      if (!parsed) return [];

      const seen = new Map();
      for (const [name, value] of parsed.searchParams) {
        if (!name || name.length > 100) continue;
        if (!seen.has(name)) seen.set(name, value);
      }
      return [...seen].map(([name, value]) => ({ name, value }));
    }

    // What the request actually lost between the URL Chrome was asked for and
    // the URL it committed. Derived rather than predicted: if a rule did not fire
    // for some reason, nothing gets logged, and the log stays a record of what
    // happened instead of what was supposed to (spec §7.1).
    function diffParams(originalUrl, committedUrl) {
      const before = extractParams(originalUrl).map((param) => param.name);
      const after = new Set(extractParams(committedUrl).map((param) => param.name));
      const removed = before.filter((name) => !after.has(name));
      const kept = before.filter((name) => after.has(name));
      return { removed, kept };
    }

    // Same destination, different query — which is what a param-stripping
    // redirect looks like from the outside. Used to keep the pending record
    // pointing at the URL that still had the params on it.
    function isSameTarget(a, b) {
      const left = globalThis.DomainUtils.safeUrl(a);
      const right = globalThis.DomainUtils.safeUrl(b);
      if (!left || !right) return false;
      return left.origin === right.origin && left.pathname === right.pathname;
    }

    // The three URL-level conditions of spec §7.3; the site lookup is the
    // caller's, because only it can read storage.
    function isCollectableNavigation(sourceUrl, targetUrl) {
      const source = globalThis.DomainUtils.safeUrl(sourceUrl);
      const target = globalThis.DomainUtils.safeUrl(targetUrl);
      if (!source || !target) return false;
      if (!target.search) return false;
      return !globalThis.DomainUtils.isSameSite(source.hostname, target.hostname);
    }

    return {
      COLLECTABLE_TRANSITIONS,
      isCollectableTransition,
      isCollectableNavigation,
      extractParams,
      diffParams,
      isSameTarget,
    };
  })();

  if (typeof globalThis !== 'undefined') globalThis.Collector = Collector;
}
