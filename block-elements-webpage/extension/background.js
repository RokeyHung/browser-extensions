// background.js — MV3 service worker

// ─── Domain matching (duplicated from rule-matcher.js for service worker context) ──

function matchDomainPattern(pattern, hostname) {
  if (!pattern) return false;

  if (pattern.startsWith('*.') && pattern.endsWith('.*')) {
    const middle = pattern.slice(2, -2);
    const parts = hostname.split('.');
    const idx = parts.indexOf(middle);
    return idx > 0 && idx < parts.length - 1;
  }

  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return hostname.endsWith('.' + base);
  }

  if (pattern.endsWith('.*')) {
    const base = pattern.slice(0, -2);
    const parts = hostname.split('.');
    return parts[0] === base && parts.length >= 2;
  }

  return hostname === pattern;
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
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'efBlockElement') {
    startPickerInTab(tab.id);
  }
});

// ─── Picker injection ──────────────────────────────────────────────────────────

async function startPickerInTab(tabId) {
  try {
    // Ping content script first to check if it's alive
    const pingResult = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
    if (pingResult && pingResult.alive) {
      await chrome.tabs.sendMessage(tabId, { type: 'startPicker' });
    } else {
      // Content script not ready — inject via scripting API
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.dispatchEvent(new CustomEvent('elementFilter:startPicker')),
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

    case 'startPickerInTab':
      startPickerInTab(msg.tabId).then(() => sendResponse({ success: true }));
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
      if (!rule.enabled) return false;
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

async function saveRule(rule) {
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

async function updateRule(updatedRule) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const idx = rules.findIndex((r) => r.id === updatedRule.id);
  if (idx === -1) return { success: false, error: 'Rule not found' };
  updatedRule.updatedAt = new Date().toISOString();
  rules[idx] = updatedRule;
  await chrome.storage.local.set({ rules });
  return { success: true };
}

async function deleteRule(ruleId) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const filtered = rules.filter((r) => r.id !== ruleId);
  await chrome.storage.local.set({ rules: filtered });
  return { success: true };
}
