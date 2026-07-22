// rule-matcher.js — domain pattern matching, loaded in content script context

const RuleMatcher = (() => {
  function matchDomainPattern(pattern, hostname) {
    if (!pattern) return false;

    // *.website.* — subdomain + TLD wildcard: root domain or any subdomain, any TLD
    if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
      const middle = pattern.slice(2, -2);
      const parts = hostname.split('.');
      const idx = parts.indexOf(middle);
      // middle label present and followed by at least a TLD label (idx >= 0 allows the root domain too)
      return idx >= 0 && idx < parts.length - 1;
    }

    // *.website.com — subdomain wildcard only (does not match the bare root domain)
    if (pattern.startsWith('*.')) {
      const base = pattern.slice(2);
      return hostname.endsWith('.' + base);
    }

    // website.* — TLD wildcard only (root domain on any TLD)
    if (pattern.endsWith('.*')) {
      const base = pattern.slice(0, -2);
      const parts = hostname.split('.');
      return parts[0] === base && parts.length >= 2;
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
