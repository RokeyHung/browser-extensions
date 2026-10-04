// background.js — MV3 service worker

// ─── Domain matching (duplicated from rule-matcher.js for service worker context) ──

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
  if (pathPattern.endsWith('*')) return pathname.startsWith(pathPattern.slice(0, -1));
  return pathname === pathPattern;
}

// ─── Context menu ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'efParent',
      title: 'Element Filter',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id: 'efBlockElement',
      title: 'Block element',
      parentId: 'efParent',
      contexts: ['all'],
    });
    chrome.contextMenus.create({
      id: 'efInspectElement',
      title: 'Inspect element',
      parentId: 'efParent',
      contexts: ['all'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'efBlockElement') startPickerInTab(tab.id, 'block');
  if (info.menuItemId === 'efInspectElement') startPickerInTab(tab.id, 'inspect');
});

// ─── Picker injection ──────────────────────────────────────────────────────────

async function startPickerInTab(tabId, mode = 'block') {
  try {
    // Ping content script first to check if it's alive
    const pingResult = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
    if (pingResult && pingResult.alive) {
      await chrome.tabs.sendMessage(tabId, { type: 'startPicker', mode });
    } else {
      // Content script not ready — inject via scripting API
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (pickerMode) => window.dispatchEvent(new CustomEvent('elementFilter:startPicker', { detail: { mode: pickerMode } })),
        args: [mode],
      });
    }
  } catch (e) {
    console.error('[EF] Failed to start picker:', e);
  }
}

// ─── Message handling ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'getRulesForUrl':
      getRulesForUrl(msg.url).then(sendResponse);
      return true;

    case 'saveRule':
      saveRule(msg.rule).then(sendResponse);
      return true;

    case 'getRules':
      getAllRules().then(sendResponse);
      return true;

    case 'updateRule':
      updateRule(msg.rule).then(sendResponse);
      return true;

    case 'deleteRule':
      deleteRule(msg.ruleId).then(sendResponse);
      return true;

    // Bulk writes only come from the options page. A content script runs on
    // whatever page the user is on, so it never gets to replace or wipe the
    // whole rule list.
    case 'importRules':
      if (!isExtensionPage(sender)) return sendResponse({ success: false, error: 'Not allowed' });
      importRules(msg.rules).then(sendResponse);
      return true;

    case 'clearRules':
      if (!isExtensionPage(sender)) return sendResponse({ success: false, error: 'Not allowed' });
      clearRules().then(sendResponse);
      return true;

    case 'startPickerInTab':
      startPickerInTab(msg.tabId, msg.mode).then(() => sendResponse({ success: true }));
      return true;

    case 'reloadRulesInTab':
      chrome.tabs.sendMessage(msg.tabId, { type: 'reloadRules' }).catch(() => {});
      sendResponse({ success: true });
      break;
  }
});

// ─── Storage ───────────────────────────────────────────────────────────────────

async function getRulesForUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    const { rules = [], disabledSites = [] } = await chrome.storage.local.get(['rules', 'disabledSites']);

    if (disabledSites.includes(hostname)) return [];

    return rules.filter((rule) => {
      // A rule that is not the right shape is skipped on its own. Letting the
      // matcher throw on it lands in the catch below and returns no rules at
      // all, for every site.
      if (!rule.enabled || !hasRuleShape(rule)) return false;
      return matchDomainPattern(rule.domainPattern, hostname) && matchPathPattern(rule.pathPattern, pathname);
    });
  } catch {
    return [];
  }
}

async function getAllRules() {
  const { rules = [] } = await chrome.storage.local.get('rules');
  return rules;
}

// Rules come back from storage and from imported files, so nothing guarantees
// their shape. The matcher calls string methods on domainPattern; a number there
// used to throw inside getRulesForUrl and switch filtering off everywhere.
function hasRuleShape(rule) {
  return (
    !!rule &&
    typeof rule.domainPattern === 'string' &&
    rule.domainPattern.trim() !== '' &&
    typeof rule.selector === 'string' &&
    rule.selector.trim() !== ''
  );
}

function isExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

// Every write to `rules` — saveRule, updateRule, deleteRule, importRules and
// clearRules — is read-modify-write over the whole array. Two that overlap read
// the same starting state and the second write wins, dropping the first rule
// without a trace. Measured window is under 2ms, so no click can hit it — but a
// second picker in another tab, or an import landing while a rule is being
// created, does not have to be slow to collide. Import and Clear All used to
// write storage straight from the options page, outside this queue, and lost a
// concurrent picker save 10 times out of 10. Chaining every write through one
// promise makes each one read what the previous just wrote.
let writeQueue = Promise.resolve();
function serialise(work) {
  const run = writeQueue.then(work, work);
  writeQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

const saveRule = (rule) => serialise(() => doSaveRule(rule));
const updateRule = (rule) => serialise(() => doUpdateRule(rule));
const deleteRule = (ruleId) => serialise(() => doDeleteRule(ruleId));
const importRules = (incoming) => serialise(() => doImportRules(incoming));
const clearRules = () => serialise(() => chrome.storage.local.set({ rules: [] }).then(() => ({ success: true })));

async function doSaveRule(rule) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const now = new Date().toISOString();
  const newRule = {
    id: 'rule_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    enabled: true,
    ...rule,
    createdAt: now,
    updatedAt: now,
  };
  rules.push(newRule);
  await chrome.storage.local.set({ rules });
  return { success: true, rule: newRule };
}

async function doUpdateRule(updatedRule) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const idx = rules.findIndex((r) => r.id === updatedRule.id);
  if (idx === -1) return { success: false, error: 'Rule not found' };
  updatedRule.updatedAt = new Date().toISOString();
  rules[idx] = updatedRule;
  await chrome.storage.local.set({ rules });
  return { success: true };
}

// The options page has already parsed, validated selectors and dropped
// duplicates; this re-checks the shape because the worker has no DOM to parse
// selectors with and is the last stop before storage.
async function doImportRules(incoming) {
  if (!Array.isArray(incoming)) return { success: false, error: 'Expected an array of rules' };
  const valid = incoming.filter(hasRuleShape);
  const { rules = [] } = await chrome.storage.local.get('rules');
  await chrome.storage.local.set({ rules: [...rules, ...valid] });
  return { success: true, added: valid.length };
}

async function doDeleteRule(ruleId) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const filtered = rules.filter((r) => r.id !== ruleId);
  await chrome.storage.local.set({ rules: filtered });
  return { success: true };
}
