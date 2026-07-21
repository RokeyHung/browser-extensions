// allowlist.js — decide whether a target domain is allowed for a source site.
// Depends on DomainMatcher (loaded first via importScripts / manifest order).

(function () {
  'use strict';

  const DM = globalThis.DomainMatcher;

  // Does an allowlist entry's allowedDomain cover this target hostname?
  // Accepts exact host and any subdomain of the allowed domain.
  function domainCovers(allowedDomain, targetHostname) {
    if (!allowedDomain || !targetHostname) return false;
    allowedDomain = allowedDomain.toLowerCase();
    targetHostname = targetHostname.toLowerCase();
    if (allowedDomain === targetHostname) return true;
    return targetHostname.endsWith('.' + allowedDomain);
  }

  // isAllowed(allowRules, sourceHostname, targetHostname)
  //   - global scope entries apply to every source site.
  //   - per-site entries apply only when sourcePattern matches the source host.
  function isAllowed(allowRules, sourceHostname, targetHostname) {
    if (!Array.isArray(allowRules)) return false;
    for (const entry of allowRules) {
      if (!entry || entry.enabled === false) continue;
      if (!domainCovers(entry.allowedDomain, targetHostname)) continue;

      if (entry.scope === 'global') return true;

      // per-site
      if (DM.matchDomainPattern(entry.sourcePattern, sourceHostname, true)) return true;
    }
    return false;
  }

  globalThis.AllowlistUtil = { isAllowed, domainCovers };
})();
