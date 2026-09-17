// rule-builder.js — turns watched sites into declarativeNetRequest dynamic
// rules. The only place rules are created, so what Chrome enforces can never
// disagree with what the options page shows. Spec §6.

if (typeof RuleBuilder === 'undefined') {
  var RuleBuilder = (() => {
    // One rule per site that has something ticked. Ids are positional because
    // sync() replaces the whole set every time: nothing outside this module ever
    // refers to a rule id, so there is nothing for a stable id to be stable for,
    // and a full replace is what makes an orphaned rule impossible after a site
    // is deleted.
    function buildRules(sites) {
      const rules = [];

      for (const site of Array.isArray(sites) ? sites : []) {
        const removeParams = globalThis.ParamStore.stripNamesOf(site);
        if (!removeParams.length) continue;

        rules.push({
          id: rules.length + 1,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: { transform: { queryTransform: { removeParams } } },
          },
          condition: {
            // The watched site is where the navigation comes FROM. A navigation
            // the browser started — omnibox, bookmark, history — carries no
            // initiator, so it never matches and a URL the user pasted himself is
            // never touched (spec §6.1).
            initiatorDomains: [site.site],
            // …and it has to be going somewhere else. initiatorDomains and
            // excludedRequestDomains both cover subdomains, so this pair is
            // exactly "leaving the site" (spec §2.2).
            excludedRequestDomains: [site.site],
            resourceTypes: ['main_frame'],
            // Redirecting a POST would turn it into a GET and drop the body: a
            // form that silently stops working is a worse bug than a tracking
            // param (spec §6.4).
            requestMethods: ['get'],
          },
        });
      }

      return rules;
    }

    async function sync() {
      const sites = await globalThis.ParamStore.getSites();
      const rules = buildRules(sites);
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existing.map((rule) => rule.id),
        addRules: rules,
      });
      return rules;
    }

    return { buildRules, sync };
  })();

  if (typeof globalThis !== 'undefined') globalThis.RuleBuilder = RuleBuilder;
}
