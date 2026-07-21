// background.js — MV3 service worker. Loads shared modules and wires up the
// tab / navigation guards, storage API and messaging.

importScripts(
  'modules/domain-matcher.js',
  'modules/allowlist.js',
  'modules/navigation-guard.js',
  'modules/popup-guard.js',
  'modules/block-log.js',
  'modules/storage-repository.js'
);

const DM = globalThis.DomainMatcher;
const NG = globalThis.NavigationGuard;
const PG = globalThis.PopupGuard;
const BL = globalThis.BlockLog;
const Store = globalThis.StorageRepo;

// New tab → opener tab, so we can attribute popups to a protected site.
const openerMap = new Map();
// Last committed top-frame URL per tab, for scripted-redirect restore.
const lastTopUrl = new Map();
// Toasts to show once a (reloaded) tab's content script comes back.
const pendingToasts = new Map(); // tabId → [payload]

const toastLimiter = BL.createRateLimiter({ windowMs: 10000, maxToasts: 4 });

// ─── Context helpers ─────────────────────────────────────────────────────────

async function getContext(url) {
  const hostname = DM.safeHostname(url);
  if (!hostname) return { rule: null, settings: {}, allowRules: [] };

  const [rules, settings, allowRules] = await Promise.all([Store.getRules(), Store.getSettings(), Store.getAllowRules()]);

  const rule = DM.findProtectedRule(rules, hostname);
  const effectiveSettings = rule ? { ...settings, ...(rule.settings || {}) } : settings;
  return { rule, settings: effectiveSettings, allowRules, hostname };
}

// Config handed to the content script / injected guard for a page.
async function buildSiteConfig(url) {
  const ctx = await getContext(url);
  const hostname = ctx.hostname || '';

  const allowedHosts = (ctx.allowRules || [])
    .filter((a) => a.enabled !== false)
    .filter((a) => a.scope === 'global' || DM.matchDomainPattern(a.sourcePattern, hostname, true))
    .map((a) => a.allowedDomain);

  return {
    active: !!ctx.rule,
    mode: ctx.rule ? ctx.rule.mode : 'normal',
    ruleId: ctx.rule ? ctx.rule.id : null,
    sitePattern: ctx.rule ? ctx.rule.sitePattern : null,
    sourceHostname: hostname,
    baseDomain: DM.getBaseDomain(hostname),
    settings: ctx.settings,
    allowedHosts,
  };
}

// ─── Blocked-attempt logging ─────────────────────────────────────────────────

async function recordBlocked({ sourceUrl, targetUrl, reason, mode, action, ruleId }, { rateLimit } = {}) {
  const settings = await Store.getSettings();
  const entry = BL.buildEntry({ sourceUrl, targetUrl, reason, mode, action: action || 'blocked' });

  if (settings.keepLog !== false) {
    await Store.addLog(entry);
  }
  if (ruleId) await Store.incrementBlockedCount(ruleId);

  let show = true;
  let suppressed = 0;
  if (rateLimit) {
    const verdict = toastLimiter.allow(entry.sourceHostname);
    show = verdict.show;
    suppressed = verdict.suppressed;
  }
  return { entry, show, suppressed };
}

// ─── New-tab / pop-under guard (spec §8.5, §8.6) ─────────────────────────────

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId != null) {
    openerMap.set(tab.id, tab.openerTabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openerMap.delete(tabId);
  lastTopUrl.delete(tabId);
  pendingToasts.delete(tabId);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top frame only
  const { tabId, url } = details;

  // Case A: tab was opened by another tab → maybe an unwanted popup.
  if (openerMap.has(tabId)) {
    await handleOpenedTab(tabId, url, details);
    return;
  }

  // Case B: same-tab navigation → maybe a scripted external redirect.
  await handleSameTabNavigation(tabId, url, details);
});

async function handleOpenedTab(tabId, targetUrl, details) {
  const openerTabId = openerMap.get(tabId);
  let openerTab;
  try {
    openerTab = await chrome.tabs.get(openerTabId);
  } catch {
    openerMap.delete(tabId);
    return;
  }

  const ctx = await getContext(openerTab.url);
  if (!ctx.rule) {
    openerMap.delete(tabId);
    return;
  }

  const decision = PG.evaluateNewTab(openerTab.url, targetUrl, ctx, 'new-tab');
  if (decision.action !== 'block') {
    openerMap.delete(tabId); // legitimate child tab — stop tracking
    return;
  }

  // Close the unwanted tab, refocus the opener, notify + log.
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
  openerMap.delete(tabId);

  try {
    await chrome.tabs.update(openerTabId, { active: true });
    if (openerTab.windowId != null) {
      await chrome.windows.update(openerTab.windowId, { focused: true });
    }
  } catch {
    /* ignore */
  }

  const { show } = await recordBlocked(
    {
      sourceUrl: openerTab.url,
      targetUrl,
      reason: decision.reason,
      mode: ctx.rule.mode,
      ruleId: ctx.rule.id,
    },
    { rateLimit: true }
  );

  if (show && ctx.settings.showToast !== false) {
    sendToast(openerTabId, {
      targetUrl,
      targetHostname: DM.safeHostname(targetUrl) || targetUrl,
      reason: decision.reason,
      sourceHostname: DM.safeHostname(openerTab.url),
    });
  }
}

async function handleSameTabNavigation(tabId, url, details) {
  const prevUrl = lastTopUrl.get(tabId);
  lastTopUrl.set(tabId, url);
  if (!prevUrl || prevUrl === url) return;

  const qualifiers = details.transitionQualifiers || [];
  const isClientRedirect = qualifiers.includes('client_redirect');
  if (!isClientRedirect) return;

  const ctx = await getContext(prevUrl);
  if (!ctx.rule) return;

  const decision = NG.decide({ sourceUrl: prevUrl, targetUrl: url, trigger: 'scripted-redirect', mode: ctx.rule.mode, hasUserGesture: false }, ctx);
  if (decision.action !== 'block') return;

  // Restore the tab to where it was before the redirect.
  try {
    await chrome.tabs.update(tabId, { url: prevUrl });
    lastTopUrl.set(tabId, prevUrl);
  } catch {
    return;
  }

  const { show } = await recordBlocked(
    { sourceUrl: prevUrl, targetUrl: url, reason: decision.reason, mode: ctx.rule.mode, ruleId: ctx.rule.id },
    { rateLimit: true }
  );

  if (show && ctx.settings.showToast !== false) {
    // The tab is reloading prevUrl — queue the toast for when content returns.
    queueToast(tabId, {
      targetUrl: url,
      targetHostname: DM.safeHostname(url) || url,
      reason: decision.reason,
      sourceHostname: DM.safeHostname(prevUrl),
    });
  }
}

// ─── Toast delivery ──────────────────────────────────────────────────────────

function sendToast(tabId, payload) {
  chrome.tabs.sendMessage(tabId, { type: 'guardToast', payload }).catch(() => {
    // Content not ready — queue for next load.
    queueToast(tabId, payload);
  });
}

function queueToast(tabId, payload) {
  const list = pendingToasts.get(tabId) || [];
  list.push(payload);
  pendingToasts.set(tabId, list);
}

// ─── Messaging ───────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'getSiteConfig': {
      const url = msg.url || (sender.tab && sender.tab.url);
      (async () => {
        const config = await buildSiteConfig(url);
        // Attach any toasts queued for this tab (e.g. after a redirect restore).
        if (sender.tab) {
          const queued = pendingToasts.get(sender.tab.id);
          if (queued && queued.length) {
            config.pendingToasts = queued;
            pendingToasts.delete(sender.tab.id);
          }
        }
        sendResponse(config);
      })();
      return true;
    }

    case 'reportBlocked': {
      (async () => {
        const ctx = await getContext(msg.sourceUrl);
        const result = await recordBlocked(
          {
            sourceUrl: msg.sourceUrl,
            targetUrl: msg.targetUrl,
            reason: msg.reason,
            mode: ctx.rule ? ctx.rule.mode : 'normal',
            ruleId: ctx.rule ? ctx.rule.id : null,
          },
          { rateLimit: true }
        );
        sendResponse({ logged: true, show: result.show, suppressed: result.suppressed });
      })();
      return true;
    }

    case 'openOnce': {
      chrome.tabs.create({ url: msg.url, active: true }).then(
        () => sendResponse({ success: true }),
        (e) => sendResponse({ success: false, error: String(e) })
      );
      return true;
    }

    case 'alwaysAllow': {
      (async () => {
        const sourceHost = DM.safeHostname(msg.sourceUrl);
        const rules = await Store.getRules();
        const rule = DM.findProtectedRule(rules, sourceHost);
        const sourcePattern = rule ? rule.sitePattern : sourceHost;
        const allow = await Store.addAllow({
          sourcePattern,
          allowedDomain: msg.targetHostname,
          scope: 'per-site',
        });
        sendResponse({ success: true, allow });
      })();
      return true;
    }

    // ── Popup / options API ──
    case 'getPopupData': {
      (async () => {
        const config = await buildSiteConfig(msg.url);
        const logs = await Store.getLogs();
        const today = new Date().toDateString();
        const blockedToday = logs.filter((l) => l.sourceHostname === config.sourceHostname && new Date(l.createdAt).toDateString() === today).length;
        sendResponse({ config, blockedToday });
      })();
      return true;
    }

    case 'enableSite': {
      Store.createRule({
        sitePattern: msg.sitePattern,
        mode: msg.mode,
        includeRoot: msg.includeRoot,
      }).then((rule) => sendResponse({ success: true, rule }));
      return true;
    }

    case 'getRules':
      Store.getRules().then(sendResponse);
      return true;
    case 'updateRule':
      Store.updateRule(msg.rule).then((rule) => sendResponse({ success: true, rule }));
      return true;
    case 'importRules':
      Store.importRules(msg.rules).then((result) => sendResponse({ success: true, ...result }));
      return true;
    case 'deleteRule':
      Store.deleteRule(msg.ruleId).then(() => sendResponse({ success: true }));
      return true;

    case 'getAllowRules':
      Store.getAllowRules().then(sendResponse);
      return true;
    case 'addAllow':
      Store.addAllow(msg.allow).then((allow) => sendResponse({ success: true, allow }));
      return true;
    case 'deleteAllow':
      Store.deleteAllow(msg.allowId).then(() => sendResponse({ success: true }));
      return true;

    case 'getLogs':
      Store.getLogs().then(sendResponse);
      return true;
    case 'clearLogs':
      Store.clearLogs().then(() => sendResponse({ success: true }));
      return true;

    case 'getSettings':
      Store.getSettings().then(sendResponse);
      return true;
    case 'saveSettings':
      Store.saveSettings(msg.settings).then((s) => sendResponse({ success: true, settings: s }));
      return true;

    case 'reloadTab':
      if (sender.tab) chrome.tabs.reload(sender.tab.id).catch(() => {});
      if (msg.tabId) chrome.tabs.reload(msg.tabId).catch(() => {});
      sendResponse({ success: true });
      break;
  }
});
