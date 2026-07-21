// navigation-guard.js — the core block/allow decision (spec §15).
// Pure functions; depend on DomainMatcher + AllowlistUtil.

(function () {
  'use strict';

  const DM = globalThis.DomainMatcher;
  const AL = globalThis.AllowlistUtil;

  // decide({ sourceUrl, targetUrl, trigger, mode, hasUserGesture }, context)
  //   context = { rule, settings, allowRules }
  // Returns { action: 'allow' | 'block' | 'confirm', reason }
  function decide(input, context) {
    const { targetUrl, trigger, mode, hasUserGesture } = input;
    const { rule, settings = {}, allowRules = [] } = context || {};

    // 1. Source site not protected → allow.
    if (!rule) return { action: 'allow', reason: 'not-protected' };

    // 2. Invalid target URL → block.
    let target;
    try {
      target = new URL(targetUrl, input.sourceUrl);
    } catch {
      return { action: 'block', reason: 'invalid target URL' };
    }

    // Only http/https navigations are guarded; leave mailto:, tel:, blob: etc.
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return { action: 'allow', reason: 'non-web-scheme' };
    }

    const sourceHost = DM.safeHostname(input.sourceUrl) || '';
    const targetHost = target.hostname.toLowerCase();

    // 3. Same-origin → allow.
    let sourceOrigin = '';
    try {
      sourceOrigin = new URL(input.sourceUrl).origin;
    } catch {
      /* ignore */
    }
    if (sourceOrigin && target.origin === sourceOrigin) {
      return { action: 'allow', reason: 'same-origin' };
    }

    // 4. Same-site and setting allows → allow.
    if (DM.isSameSite(sourceHost, targetHost)) {
      return { action: 'allow', reason: 'same-site' };
    }

    // 5. Target domain whitelisted → allow.
    if (AL.isAllowed(allowRules, sourceHost, targetHost)) {
      return { action: 'allow', reason: 'allowlisted' };
    }

    // Respect per-trigger settings toggles.
    if (!triggerEnabled(trigger, settings)) {
      return { action: 'allow', reason: 'trigger-disabled' };
    }

    // 6. Strict mode → block every external.
    if (mode === 'strict') {
      return { action: 'block', reason: reasonFor(trigger, 'external') };
    }

    // 7. Normal mode.
    if (trigger === 'window.open') {
      return { action: 'block', reason: 'window.open external' };
    }
    if (trigger === 'new-tab' || trigger === 'pop-under') {
      return { action: 'block', reason: reasonFor(trigger, 'external') };
    }
    if (trigger === 'blank-link') {
      // Suspicious external _blank link → block; a clear direct link may confirm.
      return { action: 'block', reason: 'external target=_blank' };
    }
    if (trigger === 'form-submit') {
      return { action: 'block', reason: 'external form submit' };
    }
    if (trigger === 'scripted-redirect') {
      // External redirect not originating from an obvious link → block.
      if (hasUserGesture) return { action: 'confirm', reason: 'external redirect' };
      return { action: 'block', reason: 'scripted redirect external' };
    }

    // Default: a plainly user-initiated external navigation → confirm.
    return { action: 'confirm', reason: 'external navigation' };
  }

  function triggerEnabled(trigger, settings) {
    switch (trigger) {
      case 'window.open':
        return settings.blockWindowOpen !== false;
      case 'blank-link':
        return settings.blockExternalBlank !== false;
      case 'scripted-redirect':
        return settings.blockScriptedRedirect !== false;
      case 'form-submit':
        return settings.blockExternalFormSubmit !== false;
      case 'new-tab':
      case 'pop-under':
        return settings.closeUnwantedNewTabs !== false;
      default:
        return true;
    }
  }

  function reasonFor(trigger, kind) {
    switch (trigger) {
      case 'window.open':
        return 'window.open ' + kind;
      case 'new-tab':
        return 'new tab ' + kind;
      case 'pop-under':
        return 'pop-under';
      case 'blank-link':
        return 'target=_blank ' + kind;
      case 'form-submit':
        return 'form submit ' + kind;
      case 'scripted-redirect':
        return 'scripted redirect ' + kind;
      default:
        return kind + ' navigation';
    }
  }

  globalThis.NavigationGuard = { decide };
})();
