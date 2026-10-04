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

// Per-tab state read on navigation events. MV3 stops the worker when it goes
// idle and the event that restarts it is often the very navigation we need the
// previous URL for, so this cannot live in a Map: after any idle period the
// guard would see no `prevUrl` and wave the redirect through. storage.session
// keeps it for the life of the browser session and is cleared with it.
// patch() is read-modify-write over one stored object, and the events that call
// it overlap constantly: closing a tab deletes its entry while the next tab's
// first commit records its URL, on the same key. Unserialised, one of the two
// writes is lost — measured as a tab whose `prevUrl` was never stored, so the
// redirect right after it was waved through. Every write goes through one
// promise chain so each read sees what the previous write left.
let sessionQueue = Promise.resolve();
const Session = {
  async get(key) {
    return (await chrome.storage.session.get(key))[key] || {};
  },
  async set(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  patch(key, tabId, value) {
    const run = sessionQueue.then(async () => {
      const map = await Session.get(key);
      const previous = map[tabId];
      if (value === undefined) delete map[tabId];
      else map[tabId] = value;
      await Session.set(key, map);
      return previous;
    });
    sessionQueue = run.then(
      () => {},
      () => {}
    );
    return run;
  },
};

const SESSION_KEYS = { opener: 'openerByTab', lastUrl: 'lastTopUrlByTab', gesture: 'lastGestureByTab', restores: 'restoresByTab' };

// How recently the user must have interacted for a navigation to count as
// theirs rather than a script's.
const USER_GESTURE_WINDOW_MS = 1500;

// Restoring a tab re-runs the page, and a page that redirects on load simply
// redirects again — measured as an unbounded restore/redirect loop that pins the
// tab flickering. After this many restores for one tab inside the window the
// guard stops fighting and leaves the tab where it is: the block is still
// logged and the toast still explains it, but the user gets a stable page
// instead of a spinning one. Stopping is the lesser evil; there is no way to
// cancel a committed navigation from MV3 without declarativeNetRequest.
const RESTORE_LIMIT = 3;
const RESTORE_WINDOW_MS = 10000;

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
    siteOrigin: originOf(url),
    baseDomain: DM.getBaseDomain(hostname),
    settings: ctx.settings,
    allowedHosts,
  };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

// The page a message speaks for. A subframe is judged by the tab it sits in,
// as the new-tab guard below already judges it: a player or ad iframe from
// another domain has no rule of its own, so until 1.1.5 its content script got
// `active: false` and its window.open went straight through to the worker,
// which closed the tab after it had opened (spec §8.2). sender.tab.url comes
// from the browser, not from the frame.
function siteUrlFor(sender, claimedUrl) {
  if (sender.tab && sender.frameId !== 0 && sender.tab.url) return sender.tab.url;
  return claimedUrl || (sender.tab && sender.tab.url);
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

chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId != null) {
    await Session.patch(SESSION_KEYS.opener, tab.id, tab.openerTabId);
  }
});

// Tabs this worker has closed, so the early path and the commit path below
// never both log and toast the same tab. Entries are not dropped in onRemoved:
// the commit path's event can still be in flight after removal, and tab ids are
// not reused within a session. Losing the set to a worker restart costs at most
// one duplicate log entry — the second tabs.remove() just fails.
const closingTabs = new Set();

// Chrome announces a tab opened by a page here, with its target URL, before the
// navigation commits. Closing at commit — the only path until 1.1.5 — let the
// ad page commit first in 10 of 10 measured runs (tab closed 42–48ms after the
// click); closing here, it committed in 2 of 10 (closed 32–41ms). The ad
// request itself still goes out: cancelling it would take declarativeNetRequest.
// A tab that starts on about:blank (`window.open('')` then `w.location = ad`)
// has nothing to judge yet and is left to the commit path.
chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (!/^https?:/i.test(details.url)) return;
  await handleOpenedTab(details.tabId, details.url, details.sourceTabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await Session.patch(SESSION_KEYS.opener, tabId, undefined);
  await Session.patch(SESSION_KEYS.lastUrl, tabId, undefined);
  await Session.patch(SESSION_KEYS.gesture, tabId, undefined);
  await Session.patch(SESSION_KEYS.restores, tabId, undefined);
  pendingToasts.delete(tabId);
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return; // top frame only
  const { tabId, url } = details;

  // Record where this tab is on EVERY top-frame commit, before choosing a path.
  // Doing it only in the same-tab branch meant a tab whose first commit went
  // down the popup branch never got a `prevUrl`, so the next navigation in it —
  // the redirect an ad script fires straight after opening — had nothing to be
  // compared against and was waved through.
  const prevUrl = await Session.patch(SESSION_KEYS.lastUrl, tabId, url);

  // Case A: tab was opened by another tab → maybe an unwanted popup.
  const openers = await Session.get(SESSION_KEYS.opener);
  if (openers[tabId] != null) {
    await handleOpenedTab(tabId, url, openers[tabId]);
    return;
  }

  // Case B: same-tab navigation → maybe a scripted external redirect.
  await handleSameTabNavigation(tabId, url, prevUrl);
});

async function handleOpenedTab(tabId, targetUrl, openerTabId) {
  // `window.open('')` commits about:blank first, and that commit used to be
  // judged — "not a web URL, allow" — which deleted the opener record. The ad
  // navigation that follows races it: measured, when the delete landed first
  // the ad commit looked like a same-tab navigation from about:blank and the ad
  // tab stayed open with nothing logged, in 3 of 10 runs. about:blank is not a
  // destination; keep the record for the navigation that is.
  if (!/^https?:/i.test(targetUrl)) return;

  let openerTab;
  try {
    openerTab = await chrome.tabs.get(openerTabId);
  } catch {
    await Session.patch(SESSION_KEYS.opener, tabId, undefined);
    return;
  }

  const ctx = await getContext(openerTab.url);
  if (!ctx.rule) {
    await Session.patch(SESSION_KEYS.opener, tabId, undefined);
    return;
  }

  const decision = PG.evaluateNewTab(openerTab.url, targetUrl, ctx, 'new-tab');
  if (decision.action !== 'block') {
    await Session.patch(SESSION_KEYS.opener, tabId, undefined); // legitimate child tab
    return;
  }

  // Close the unwanted tab, refocus the opener, notify + log.
  if (closingTabs.has(tabId)) return;
  closingTabs.add(tabId);
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    /* already gone */
  }
  await Session.patch(SESSION_KEYS.opener, tabId, undefined);

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

async function handleSameTabNavigation(tabId, url, prevUrl) {
  if (!prevUrl || prevUrl === url) return;

  const ctx = await getContext(prevUrl);
  if (!ctx.rule) return;

  // Chrome does not tag every scripted redirect. Measured on Chrome 152, for a
  // page redirecting itself 600ms after load with no interaction:
  //   location.replace → transitionQualifiers ["client_redirect"]
  //   location.assign  → []
  //   location.href =  → []
  // Requiring that qualifier, as this did until 1.1.1, let two of the three
  // forms straight through. What actually separates a redirect from a user
  // following a link is whether the user just did something, which the content
  // script reports; a navigation with no recent gesture is the script's.
  //
  // And only interaction aimed at a link or a submit control counts. A click on
  // the player that opens a tab and sends this one to an ad is interaction too,
  // and in normal mode it let the pop-under redirect stay (spec §6.1).
  const gesture = (await Session.get(SESSION_KEYS.gesture))[tabId];
  const hasUserGesture = !!gesture && gesture.onLink === true && Date.now() - gesture.at < USER_GESTURE_WINDOW_MS;

  const decision = NG.decide({ sourceUrl: prevUrl, targetUrl: url, trigger: 'scripted-redirect', mode: ctx.rule.mode, hasUserGesture }, ctx);
  if (decision.action !== 'block') return;

  // Restore the tab to where it was before the redirect, unless this tab has
  // already been restored too many times in a row.
  const restores = await Session.get(SESSION_KEYS.restores);
  const record = restores[tabId] && Date.now() - restores[tabId].since < RESTORE_WINDOW_MS ? restores[tabId] : { since: Date.now(), count: 0 };
  const giveUp = record.count >= RESTORE_LIMIT;

  if (!giveUp) {
    try {
      await chrome.tabs.update(tabId, { url: prevUrl });
      await Session.patch(SESSION_KEYS.lastUrl, tabId, prevUrl);
    } catch {
      return;
    }
    record.count++;
    restores[tabId] = record;
    await Session.set(SESSION_KEYS.restores, restores);
  }

  const { show } = await recordBlocked(
    {
      sourceUrl: prevUrl,
      targetUrl: url,
      reason: giveUp ? `${decision.reason} (kept redirecting; stopped restoring)` : decision.reason,
      mode: ctx.rule.mode,
      action: giveUp ? 'gave-up' : 'blocked',
      ruleId: ctx.rule.id,
    },
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
  // Top frame only: subframes now run the content script too (about:blank ads
  // included) and would answer for a toast they never draw.
  chrome.tabs.sendMessage(tabId, { type: 'guardToast', payload }, { frameId: 0 }).catch(() => {
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
    case 'userGesture': {
      const tabId = sender?.tab?.id;
      if (tabId != null) Session.patch(SESSION_KEYS.gesture, tabId, { at: Date.now(), onLink: msg.onLink === true });
      sendResponse({ ok: true });
      return false;
    }

    case 'getSiteConfig': {
      const url = siteUrlFor(sender, msg.url);
      (async () => {
        const config = await buildSiteConfig(url);
        // Attach any toasts queued for this tab (e.g. after a redirect restore).
        // Only the top frame draws toasts; a subframe asking first used to take
        // them and drop them.
        if (sender.tab && sender.frameId === 0) {
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
        const sourceUrl = siteUrlFor(sender, msg.sourceUrl);
        const ctx = await getContext(sourceUrl);
        const result = await recordBlocked(
          {
            sourceUrl,
            targetUrl: msg.targetUrl,
            reason: msg.reason,
            mode: ctx.rule ? ctx.rule.mode : 'normal',
            ruleId: ctx.rule ? ctx.rule.id : null,
          },
          { rateLimit: true }
        );
        // A subframe cannot draw the toast itself; the top frame of its tab does.
        if (sender.tab && sender.frameId !== 0 && result.show && ctx.settings.showToast !== false) {
          sendToast(sender.tab.id, {
            targetUrl: msg.targetUrl,
            targetHostname: DM.safeHostname(msg.targetUrl) || msg.targetUrl,
            reason: msg.reason,
            sourceHostname: DM.safeHostname(sourceUrl),
            suppressed: result.suppressed,
          });
        }
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
