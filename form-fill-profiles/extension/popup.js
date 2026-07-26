// popup.js — current path, matched forms, apply. Spec §5.1–5.3, §12.4.

const REASON_LABELS = {
  'password-excluded-by-settings': 'password excluded by settings',
  'hidden-excluded-by-settings': 'hidden field excluded by settings',
  'file-not-supported': 'file input not supported',
  'sensitive-field': 'sensitive field (OTP/CVV/captcha)',
  'not-visible': 'not visible on the page',
  disabled: 'field is disabled',
  readonly: 'field is read-only',
  'no-value-in-profile': 'no value in profile',
  'field-removed-from-form': 'field no longer in form',
  'option-missing': 'option not found in the list',
  'selector-no-longer-matches': 'not found on the page',
};

const el = (id) => document.getElementById(id);

let currentTab = null;
let matches = []; // [{ form, profiles }]
let selectedFormIndex = 0;
let capturedSnapshot = null;
let settings = { showApplyResult: true };

// ─── Messaging ────────────────────────────────────────────────────────────────

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error || 'Unknown error');
  return response.data;
}

// ─── View helpers ─────────────────────────────────────────────────────────────

function show(id, visible) {
  el(id).hidden = !visible;
}

function setLoading(on, text = 'Working...') {
  el('loadingText').textContent = text;
  show('loading', on);
  for (const id of ['btnCapture', 'btnApply', 'btnRecapture', 'btnContinue', 'btnAddProfile']) {
    el(id).disabled = on;
  }
}

function showError(message) {
  el('errorBox').textContent = message;
  show('errorBox', true);
}

function clearError() {
  show('errorBox', false);
}

function isValidUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderEmptyState(counts) {
  show('emptyState', true);
  show('matchedState', false);
  el('detectedText').textContent = counts ? `Forms detected on page: ${counts.forms} (${counts.fields} fields)` : 'Could not read this page.';
}

function renderMatched() {
  show('emptyState', false);
  show('matchedState', true);

  const select = el('formSelect');
  select.innerHTML = '';
  matches.forEach(({ form, profiles }, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    const fieldCount = (form.fields || []).filter((field) => !field.excluded && !field.removed).length;
    option.textContent = `${form.label} — ${fieldCount} fields, ${profiles.length} profile(s)`;
    select.appendChild(option);
  });
  select.value = String(selectedFormIndex);
  select.hidden = matches.length === 1;

  const { form, profiles } = matches[selectedFormIndex];
  el('formPattern').textContent = `${form.domainPattern}  ${form.pathPattern || '*'}`;

  const list = el('profileList');
  list.innerHTML = '';

  if (!profiles.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'This form has no profile yet. Add one to start filling.';
    list.appendChild(empty);
    el('btnApply').disabled = true;
    return;
  }

  el('btnApply').disabled = false;
  profiles.forEach((profile, index) => {
    const row = document.createElement('label');
    row.className = 'profile-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'profile';
    radio.value = profile.id;
    radio.checked = profile.id === form.defaultProfileId || (!form.defaultProfileId && index === 0);

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = profile.name;

    row.append(radio, name);
    if (profile.id === form.defaultProfileId) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'default';
      row.appendChild(badge);
    }
    list.appendChild(row);
  });
}

function renderPicker(snapshot) {
  capturedSnapshot = snapshot;
  show('emptyState', false);
  show('matchedState', false);
  show('pickerState', true);

  const list = el('pickerList');
  list.innerHTML = '';

  snapshot.forms.forEach((form, index) => {
    const row = document.createElement('label');
    row.className = 'profile-row';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'captured';
    radio.value = String(index);
    radio.checked = index === 0;

    const name = document.createElement('span');
    name.className = 'profile-name';
    name.textContent = `${form.formLabel} — ${form.fieldCount} fields`;

    row.append(radio, name);

    if (form.excludedCount) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${form.excludedCount} excluded`;
      row.appendChild(badge);
    }
    list.appendChild(row);
  });
}

function renderReport(report) {
  const { counts } = report;

  // With the report turned off, only surface the headline numbers.
  if (!settings.showApplyResult) {
    el('resultsTitle').textContent = 'Apply completed';
    el('resultsBody').textContent = `Filled ${counts.filled} field(s).`;
    show('results', true);
    return;
  }
  el('resultsTitle').textContent = 'Apply completed';

  const body = el('resultsBody');
  body.innerHTML = '';

  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.textContent = `Filled: ${counts.filled} · Not found: ${counts.notFound} · Skipped: ${counts.skipped}${
    counts.failed ? ` · Failed: ${counts.failed}` : ''
  }`;
  body.appendChild(summary);

  const groups = [
    ['Not found', report.notFound],
    ['Failed', report.failed],
    ['Skipped', report.skipped],
  ];

  for (const [title, items] of groups) {
    if (!items.length) continue;
    const heading = document.createElement('div');
    heading.className = 'group-title';
    heading.textContent = `${title} (${items.length})`;
    body.appendChild(heading);

    for (const item of items.slice(0, 8)) {
      const row = document.createElement('div');
      row.className = 'group-row';
      row.textContent = `${item.label} — ${REASON_LABELS[item.reason] || item.reason}`;
      body.appendChild(row);
    }
    if (items.length > 8) {
      const more = document.createElement('div');
      more.className = 'group-row muted';
      more.textContent = `…and ${items.length - 8} more`;
      body.appendChild(more);
    }
  }

  show('results', true);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function loadMatches() {
  matches = await send({ type: 'getFormsForUrl', url: currentTab.url });
  if (matches.length) {
    selectedFormIndex = 0;
    renderMatched();
    return;
  }
  const counts = await send({ type: 'countForms', tabId: currentTab.id }).catch(() => null);
  renderEmptyState(counts);
}

async function onCapture() {
  clearError();
  show('results', false);
  setLoading(true, 'Scanning page...');
  try {
    const snapshot = await send({ type: 'captureForms', tabId: currentTab.id });
    if (!snapshot.forms.length) {
      showError('No form field found on this page. The form may render later — try again after it loads.');
      return;
    }
    if (snapshot.forms.length === 1) {
      await saveForm(snapshot.forms[0], snapshot.url);
      return;
    }
    renderPicker(snapshot);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

async function saveForm(formSnapshot, url) {
  await send({ type: 'saveCapturedForm', snapshot: formSnapshot, url });
  window.close(); // the options page opens in a new tab
}

async function onContinuePicker() {
  const checked = document.querySelector('input[name="captured"]:checked');
  if (!checked || !capturedSnapshot) return;
  setLoading(true, 'Saving form...');
  try {
    await saveForm(capturedSnapshot.forms[Number(checked.value)], capturedSnapshot.url);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

async function onApply() {
  const checked = document.querySelector('input[name="profile"]:checked');
  if (!checked) return;

  clearError();
  show('results', false);
  setLoading(true, 'Filling form...');
  try {
    const report = await send({
      type: 'applyProfile',
      tabId: currentTab.id,
      formId: matches[selectedFormIndex].form.id,
      profileId: checked.value,
    });
    renderReport(report);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

async function onRecapture() {
  clearError();
  show('results', false);
  setLoading(true, 'Re-scanning form...');
  try {
    const { summary } = await send({
      type: 'recaptureForm',
      tabId: currentTab.id,
      formId: matches[selectedFormIndex].form.id,
    });
    el('resultsTitle').textContent = 'Re-capture completed';
    el('resultsBody').textContent =
      `Unchanged: ${summary.unchanged} · Updated selector: ${summary.updated} · ` +
      `New: ${summary.added.length} · Removed: ${summary.removed.length}`;
    show('results', true);
    await loadMatches();
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

function openOptions(query = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${query}`) });
  window.close();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  el('btnManage').addEventListener('click', () => openOptions());

  if (!isValidUrl(tab?.url)) {
    show('mainView', false);
    show('unsupportedView', true);
    return;
  }

  const parsed = new URL(tab.url);
  el('siteUrl').textContent = `${parsed.hostname}${FormMatcher.normalizePath(parsed.pathname)}`;

  const stored = await chrome.storage.local.get('settings');
  settings = { showApplyResult: true, ...(stored.settings || {}) };

  el('btnCapture').addEventListener('click', onCapture);
  el('btnApply').addEventListener('click', onApply);
  el('btnRecapture').addEventListener('click', onRecapture);
  el('btnContinue').addEventListener('click', onContinuePicker);
  el('btnCancelPicker').addEventListener('click', () => {
    show('pickerState', false);
    loadMatches();
  });
  el('btnAddProfile').addEventListener('click', () => {
    openOptions(`?formId=${matches[selectedFormIndex].form.id}&new=1`);
  });
  el('formSelect').addEventListener('change', (event) => {
    selectedFormIndex = Number(event.target.value);
    show('results', false);
    renderMatched();
  });

  try {
    await loadMatches();
  } catch (err) {
    showError(err.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
