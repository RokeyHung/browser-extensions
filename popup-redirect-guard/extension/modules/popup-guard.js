// popup-guard.js — helper for the "new tab / pop-under" case (spec §8.5, §8.6).
// Thin wrapper over NavigationGuard.decide for tabs opened by a protected tab.

(function () {
  'use strict';

  const NG = globalThis.NavigationGuard;

  // shouldCloseNewTab(openerUrl, targetUrl, context, trigger)
  //   context = { rule, settings, allowRules }
  // Returns the decision object; caller closes the tab when action === 'block'.
  function evaluateNewTab(openerUrl, targetUrl, context, trigger) {
    return NG.decide(
      {
        sourceUrl: openerUrl,
        targetUrl,
        trigger: trigger || 'new-tab',
        mode: context && context.rule ? context.rule.mode : 'normal',
        hasUserGesture: false,
      },
      context
    );
  }

  globalThis.PopupGuard = { evaluateNewTab };
})();
