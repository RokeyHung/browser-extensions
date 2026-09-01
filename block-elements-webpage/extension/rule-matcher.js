// rule-matcher.js — domain pattern matching, loaded in content script context

const RuleMatcher = (() => {
  // True when `base` appears as a run of whole labels inside `hostname` with at
  // least one label left after it. Requiring a trailing label is what stops a
  // pattern from matching a bare TLD, and matching whole labels is what keeps
  // `shop.*` off `myshop.com`.
  //
  // `base` may be several labels ("example.co"), so a hand-written pattern like
  // `example.co.*` still works.
  function hasLabelRun(hostname, base) {
    const want = base.split('.');
    const parts = hostname.split('.');
    for (let i = 0; i + want.length < parts.length; i++) {
      if (want.every((label, k) => parts[i + k] === label)) return true;
    }
    return false;
  }

  function matchDomainPattern(pattern, hostname) {
    if (!pattern) return false;

    // *.website.* — the label anywhere in the host, any TLD (spec §6.4)
    if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
      return hasLabelRun(hostname, pattern.slice(2, -2));
    }

    // *.website.com — subdomain wildcard only (does not match the bare root domain)
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return hostname.endsWith('.' + base);
    }

    // website.* — the label on any TLD, at the root or under any subdomain.
    // Deliberately as wide as `*.website.*` (spec §6.3): a rule made from the
    // "any TLD" scope button has to cover the page it was made on, and on
    // `news.shop.test` that page is a subdomain.
    if (pattern.endsWith('.*')) {
      return hasLabelRun(hostname, pattern.slice(0, -2));
    }

    // exact / bare domain — also matches www. and any subdomain
    // e.g. "example.com" matches example.com, www.example.com, m.example.com
    let base = pattern;
    if (base.startsWith('www.') && base.slice(4).includes('.')) base = base.slice(4);
    return hostname === pattern || hostname === base || hostname.endsWith('.' + base);
  }

  function matchPathPattern(pathPattern, pathname) {
    if (!pathPattern) return true;
    if (pathPattern === '*') return true;
    if (pathPattern.endsWith('*')) {
      return pathname.startsWith(pathPattern.slice(0, -1));
    }
    return pathname === pathPattern;
  }

  function parseRule(ruleString) {
    // format: domain##selector  or  domain#@#selector
    const exceptionMatch = ruleString.match(/^(.+?)#@#(.+)$/);
    if (exceptionMatch) {
      return { domainPattern: exceptionMatch[1], selector: exceptionMatch[2], isException: true };
    }

    const standardMatch = ruleString.match(/^(.+?)##(.+)$/);
    if (standardMatch) {
      return { domainPattern: standardMatch[1], selector: standardMatch[2], isException: false };
    }

    return null;
  }

  function getMatchingRules(rules, hostname, pathname) {
    return rules.filter((rule) => {
      if (!rule.enabled) return false;
      if (!matchDomainPattern(rule.domainPattern, hostname)) return false;
      if (!matchPathPattern(rule.pathPattern, pathname)) return false;
      return true;
    });
  }

  function buildRuleString(rule) {
    return `${rule.domainPattern}##${rule.selector}`;
  }

  return { matchDomainPattern, matchPathPattern, parseRule, getMatchingRules, buildRuleString };
})();
