// storage-repository.js — the single place that touches chrome.storage.local.
// Keys: rules (site protection), allowRules, logs, settings.

(function () {
  'use strict';

  const KEYS = {
    rules: 'rules',
    allowRules: 'allowRules',
    logs: 'logs',
    settings: 'settings',
  };

  const MAX_LOGS_PER_SITE = 1000;

  const DEFAULT_SETTINGS = {
    blockWindowOpen: true,
    blockExternalBlank: true,
    blockScriptedRedirect: true,
    blockPopUnder: true,
    blockExternalFormSubmit: true,
    closeUnwantedNewTabs: true,
    showToast: true,
    keepLog: true,
    defaultMode: 'normal',
  };

  const DEFAULT_RULE_SETTINGS = {
    blockWindowOpen: true,
    blockExternalBlank: true,
    blockScriptedRedirect: true,
    blockExternalFormSubmit: true,
    closeUnwantedNewTabs: true,
    showToast: true,
  };

  function newId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  async function getSettings() {
    const stored = await chrome.storage.local.get(KEYS.settings);
    return { ...DEFAULT_SETTINGS, ...(stored[KEYS.settings] || {}) };
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const merged = { ...current, ...patch };
    await chrome.storage.local.set({ [KEYS.settings]: merged });
    return merged;
  }

  // ── Site protection rules ────────────────────────────────────────────────
  async function getRules() {
    const stored = await chrome.storage.local.get(KEYS.rules);
    return stored[KEYS.rules] || [];
  }

  async function createRule({ sitePattern, mode, includeRoot, settings }) {
    const rules = await getRules();
    // Avoid duplicate pattern rules.
    const existing = rules.find((r) => r.sitePattern === sitePattern);
    if (existing) {
      existing.enabled = true;
      existing.updatedAt = new Date().toISOString();
      await chrome.storage.local.set({ [KEYS.rules]: rules });
      return existing;
    }
    const now = new Date().toISOString();
    const rule = {
      id: newId('rule'),
      enabled: true,
      sitePattern,
      mode: mode || 'strict',
      includeRoot: includeRoot !== false,
      settings: { ...DEFAULT_RULE_SETTINGS, ...(settings || {}) },
      blockedCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    rules.push(rule);
    await chrome.storage.local.set({ [KEYS.rules]: rules });
    return rule;
  }

  async function updateRule(updated) {
    const rules = await getRules();
    const idx = rules.findIndex((r) => r.id === updated.id);
    if (idx === -1) return null;
    updated.updatedAt = new Date().toISOString();
    rules[idx] = { ...rules[idx], ...updated };
    await chrome.storage.local.set({ [KEYS.rules]: rules });
    return rules[idx];
  }

  async function deleteRule(ruleId) {
    const rules = await getRules();
    await chrome.storage.local.set({ [KEYS.rules]: rules.filter((r) => r.id !== ruleId) });
  }

  // Merge imported protection rules. Skips any whose sitePattern already exists.
  // Returns { added, skipped, invalid }.
  async function importRules(incoming) {
    const rules = await getRules();
    const existing = new Set(rules.map((r) => r.sitePattern));
    const now = new Date().toISOString();
    let added = 0;
    let skipped = 0;
    let invalid = 0;

    for (const raw of Array.isArray(incoming) ? incoming : []) {
      const sitePattern = raw && typeof raw.sitePattern === 'string' ? raw.sitePattern.trim().toLowerCase() : '';
      if (!sitePattern) {
        invalid++;
        continue;
      }
      if (existing.has(sitePattern)) {
        skipped++;
        continue;
      }
      rules.push({
        id: newId('rule'),
        enabled: raw.enabled !== false,
        sitePattern,
        mode: raw.mode === 'strict' ? 'strict' : raw.mode === 'normal' ? 'normal' : 'strict',
        includeRoot: raw.includeRoot !== false,
        settings: { ...DEFAULT_RULE_SETTINGS, ...(raw.settings || {}) },
        blockedCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      existing.add(sitePattern);
      added++;
    }

    if (added > 0) await chrome.storage.local.set({ [KEYS.rules]: rules });
    return { added, skipped, invalid };
  }

  async function incrementBlockedCount(ruleId) {
    const rules = await getRules();
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    rule.blockedCount = (rule.blockedCount || 0) + 1;
    await chrome.storage.local.set({ [KEYS.rules]: rules });
  }

  // ── Allowlist ─────────────────────────────────────────────────────────────
  async function getAllowRules() {
    const stored = await chrome.storage.local.get(KEYS.allowRules);
    return stored[KEYS.allowRules] || [];
  }

  async function addAllow({ sourcePattern, allowedDomain, scope }) {
    const allowRules = await getAllowRules();
    const dup = allowRules.find((a) => a.allowedDomain === allowedDomain && a.sourcePattern === sourcePattern && a.scope === (scope || 'per-site'));
    if (dup) return dup;
    const rule = {
      id: newId('allow'),
      enabled: true,
      sourcePattern: sourcePattern || '*',
      allowedDomain,
      scope: scope || 'per-site',
      createdAt: new Date().toISOString(),
    };
    allowRules.push(rule);
    await chrome.storage.local.set({ [KEYS.allowRules]: allowRules });
    return rule;
  }

  async function deleteAllow(allowId) {
    const allowRules = await getAllowRules();
    await chrome.storage.local.set({ [KEYS.allowRules]: allowRules.filter((a) => a.id !== allowId) });
  }

  // ── Blocked logs ──────────────────────────────────────────────────────────
  async function getLogs() {
    const stored = await chrome.storage.local.get(KEYS.logs);
    return stored[KEYS.logs] || [];
  }

  async function addLog(entry) {
    const logs = await getLogs();
    logs.unshift(entry);

    // Cap per-site to MAX_LOGS_PER_SITE (keep newest).
    const perSite = new Map();
    const pruned = [];
    for (const log of logs) {
      const host = log.sourceHostname || '';
      const count = perSite.get(host) || 0;
      if (count < MAX_LOGS_PER_SITE) {
        pruned.push(log);
        perSite.set(host, count + 1);
      }
    }
    await chrome.storage.local.set({ [KEYS.logs]: pruned });
    return entry;
  }

  async function clearLogs() {
    await chrome.storage.local.set({ [KEYS.logs]: [] });
  }

  globalThis.StorageRepo = {
    KEYS,
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    getRules,
    createRule,
    updateRule,
    deleteRule,
    importRules,
    incrementBlockedCount,
    getAllowRules,
    addAllow,
    deleteAllow,
    getLogs,
    addLog,
    clearLogs,
  };
})();
