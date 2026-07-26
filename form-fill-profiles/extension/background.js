// background.js — MV3 service worker. Orchestrates capture and apply. Spec §12.2.
// No long-lived state here: everything goes through chrome.storage.local.

importScripts('modules/form-matcher.js', 'modules/storage-repository.js');

const CONTENT_FILES = ['modules/label-resolver.js', 'modules/field-selector.js', 'modules/form-scanner.js', 'modules/apply-engine.js', 'content.js'];

// ─── Content script availability ────────────────────────────────────────────────

// Pages loaded before the extension was installed/updated have no content
// script yet — inject it on demand.
async function ensureContentScript(tabId) {
  const pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' }).catch(() => null);
  if (pong?.alive) return true;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return true;
  } catch (err) {
    throw new Error(`Cannot access this page (${err.message})`);
  }
}

function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

// ─── Capture ────────────────────────────────────────────────────────────────────

async function countForms(tabId) {
  await ensureContentScript(tabId);
  return sendToTab(tabId, { type: 'countForms' });
}

async function captureForms(tabId) {
  await ensureContentScript(tabId);
  const settings = await Store.getSettings();
  const result = await sendToTab(tabId, { type: 'scanForms', settings });
  if (!result?.success) throw new Error(result?.error || 'Scan failed');
  return result.snapshot;
}

// Persist one snapshot and open the profile editor for it. Spec §13.1.
async function saveCapturedForm(snapshot, url) {
  const form = await Store.createForm(snapshot, url);
  await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?formId=${form.id}&new=1`) });
  return form;
}

async function recapture(tabId, formId) {
  const form = await Store.getForm(formId);
  if (!form) throw new Error('Form not found');

  const snapshot = await captureForms(tabId);
  // Prefer the form with the same key; fall back to the closest field count.
  const match =
    snapshot.forms.find((item) => item.formKey === form.formKey) ||
    snapshot.forms.slice().sort((a, b) => Math.abs(a.fields.length - form.fields.length) - Math.abs(b.fields.length - form.fields.length))[0];
  if (!match) throw new Error('No form found on this page');

  return Store.recaptureForm(formId, match);
}

// ─── Matching ───────────────────────────────────────────────────────────────────

async function getFormsForUrl(url) {
  const parsed = new URL(url);
  const { forms, profiles } = await Store.read();
  const matched = FormMatcher.getMatchingForms(forms, parsed.hostname, parsed.pathname);
  return matched.map((form) => ({
    form,
    profiles: profiles
      .filter((profile) => profile.formId === form.id)
      .sort((a, b) => {
        if (form.defaultProfileId === a.id) return -1;
        if (form.defaultProfileId === b.id) return 1;
        return String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || ''));
      }),
  }));
}

// ─── Apply ──────────────────────────────────────────────────────────────────────

async function applyProfile(tabId, formId, profileId) {
  const [form, profile, settings] = await Promise.all([Store.getForm(formId), Store.getProfile(profileId), Store.getSettings()]);
  if (!form) throw new Error('Form not found');
  if (!profile) throw new Error('Profile not found');

  await ensureContentScript(tabId);
  const result = await sendToTab(tabId, {
    type: 'applyProfile',
    form,
    values: profile.values || {},
    settings,
  });
  if (!result?.success) throw new Error(result?.error || 'Apply failed');

  if (result.report.counts.filled > 0) await Store.touchProfile(profileId);
  return result.report;
}

// Used by the options page's "Save & apply to tab" — targets the last focused
// http(s) tab rather than the options tab itself.
async function applyProfileToActiveTab(profileId) {
  const profile = await Store.getProfile(profileId);
  if (!profile) throw new Error('Profile not found');
  const form = await Store.getForm(profile.formId);
  if (!form) throw new Error('Form not found');

  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'], currentWindow: true });
  const target = tabs.find((tab) => {
    try {
      const parsed = new URL(tab.url);
      return FormMatcher.matchesUrl(form, parsed.hostname, parsed.pathname);
    } catch {
      return false;
    }
  });
  if (!target) throw new Error('No open tab matches this form');

  const report = await applyProfile(target.id, form.id, profileId);
  await chrome.tabs.update(target.id, { active: true });
  return report;
}

// ─── Messages ───────────────────────────────────────────────────────────────────

const HANDLERS = {
  countForms: (msg) => countForms(msg.tabId),
  captureForms: (msg) => captureForms(msg.tabId),
  saveCapturedForm: (msg) => saveCapturedForm(msg.snapshot, msg.url),
  recaptureForm: (msg) => recapture(msg.tabId, msg.formId),
  getFormsForUrl: (msg) => getFormsForUrl(msg.url),
  applyProfile: (msg) => applyProfile(msg.tabId, msg.formId, msg.profileId),
  applyProfileToActiveTab: (msg) => applyProfileToActiveTab(msg.profileId),
  openOptions: (msg) => chrome.tabs.create({ url: chrome.runtime.getURL(msg.path || 'options.html') }),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = HANDLERS[message?.type];
  if (!handler) return false;

  Promise.resolve(handler(message))
    .then((data) => sendResponse({ success: true, data }))
    .catch((err) => sendResponse({ success: false, error: err.message }));
  return true;
});
