const OPTION_KEYS = ['cookies', 'localStorage', 'sessionStorage', 'indexedDB', 'cacheStorage', 'serviceWorker'];

const LABEL_MAP = {
  cookies: 'Cookies',
  localStorage: 'Local Storage',
  sessionStorage: 'Session Storage',
  indexedDB: 'IndexedDB',
  cacheStorage: 'Cache Storage',
  serviceWorker: 'Service Worker',
};

const DEFAULT_SETTINGS = {
  cookies: true,
  localStorage: true,
  sessionStorage: true,
  indexedDB: true,
  cacheStorage: true,
  serviceWorker: true,
  wildcardDomains: false,
  reload: true,
};

let currentTab = null;
// null when the current host has no site label to widen to (IP, localhost).
let wildcardPattern = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!isValidUrl(tab?.url)) {
    document.getElementById('mainView').style.display = 'none';
    document.getElementById('unsupportedView').classList.add('visible');
    return;
  }

  const { origin, hostname } = new URL(tab.url);
  document.getElementById('siteUrl').textContent = origin;

  wildcardPattern = getWildcardPattern(hostname);
  renderWildcardRow();

  await restoreSettings();
  wireCheckboxSave();

  document.getElementById('btnClean').addEventListener('click', onCleanClick);
}

// Show the pattern the wildcard option actually expands to for this site, e.g.
// `*.facebook.*`. Hosts without a site label cannot be widened, so the row is
// disabled instead of promising something it will not do.
function renderWildcardRow() {
  const row = document.getElementById('wildcardRow');
  const checkbox = document.getElementById('opt-wildcard');
  const hint = document.getElementById('wildcardHint');

  if (!wildcardPattern) {
    checkbox.checked = false;
    checkbox.disabled = true;
    row.classList.add('disabled');
    document.getElementById('wildcardPattern').textContent = 'related domains';
    hint.textContent = 'Not available for IP addresses or single-label hosts.';
    return;
  }

  document.getElementById('wildcardPattern').textContent = wildcardPattern;
}

function isValidUrl(url) {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function restoreSettings() {
  const saved = await chrome.storage.local.get('settings');
  const settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
  for (const key of OPTION_KEYS) {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (el) el.checked = !!settings[key];
  }
  document.getElementById('opt-reload').checked = !!settings.reload;

  // Only honour a saved wildcard preference when this site can actually be
  // widened; renderWildcardRow() already disabled the row otherwise.
  const wildcard = document.getElementById('opt-wildcard');
  if (!wildcard.disabled) wildcard.checked = !!settings.wildcardDomains;
}

function wireCheckboxSave() {
  const checkboxes = document.querySelectorAll('[data-key], #opt-reload, #opt-wildcard');
  checkboxes.forEach((cb) => {
    cb.addEventListener('change', saveSettings);
  });
}

async function saveSettings() {
  const settings = {};
  for (const key of OPTION_KEYS) {
    const el = document.querySelector(`[data-key="${key}"]`);
    settings[key] = el ? el.checked : true;
  }
  settings.reload = document.getElementById('opt-reload').checked;
  settings.wildcardDomains = document.getElementById('opt-wildcard').checked;
  await chrome.storage.local.set({ settings });
}

async function onCleanClick() {
  const options = {};
  for (const key of OPTION_KEYS) {
    const el = document.querySelector(`[data-key="${key}"]`);
    options[key] = el ? el.checked : false;
  }
  options.reload = document.getElementById('opt-reload').checked;
  options.wildcardDomains = document.getElementById('opt-wildcard').checked;

  const nothingSelected = OPTION_KEYS.every((k) => !options[k]);
  if (nothingSelected) return;

  setLoading(true);

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'cleanSiteData',
      tabId: currentTab.id,
      url: currentTab.url,
      origin: new URL(currentTab.url).origin,
      options,
    });
    showResults(response, options);
  } catch (err) {
    showError(err.message || 'Unknown error');
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = document.getElementById('btnClean');
  const loading = document.getElementById('loadingState');
  btn.disabled = on;
  loading.classList.toggle('visible', on);
  if (on) {
    document.getElementById('results').classList.remove('visible');
  }
}

function showResults(response, options) {
  const body = document.getElementById('resultsBody');
  const footer = document.getElementById('resultsFooter');
  body.innerHTML = '';

  let hasError = false;

  for (const key of OPTION_KEYS) {
    if (!options[key]) continue;
    const r = response?.results?.[key];
    const row = document.createElement('div');
    row.className = 'result-row';

    let iconClass = 'success';
    let icon = '✓';
    let msg = '';

    if (!r) {
      iconClass = 'skipped';
      icon = '–';
    } else if (r.success === false) {
      iconClass = 'error';
      icon = '✕';
      msg = r.error || 'Failed';
      hasError = true;
    }

    row.innerHTML = `
      <span class="result-icon ${iconClass}">${icon}</span>
      <span class="result-name">${LABEL_MAP[key]}</span>
      ${msg ? `<span class="result-msg error">${msg}</span>` : ''}
    `;
    body.appendChild(row);
  }

  renderScope(response?.scope);

  footer.textContent = '';
  if (options.reload && response?.reloaded) {
    const target = prettyUrl(response.navigatedTo);
    footer.textContent = target ? `Redirected to ${target}` : 'Tab reloaded.';
  } else if (hasError) {
    footer.textContent = 'Completed with warnings.';
  } else {
    footer.textContent = 'All data cleared.';
  }

  document.getElementById('results').classList.add('visible');
}

// Report what the run actually touched. The wildcard scope is only as wide as
// the hosts Chrome could tell us about (cookie jar + open tabs), so listing them
// is the honest answer to "did it clean my other TLD too?".
function renderScope(scope) {
  const el = document.getElementById('resultsScope');
  el.textContent = '';
  if (!scope?.wildcard) return;

  const hosts = scope.hosts || [];
  const shown = hosts.slice(0, 4).join(', ');
  const rest = hosts.length > 4 ? ` +${hosts.length - 4} more` : '';
  el.textContent = `Scope ${scope.pattern}: ${shown}${rest}`;
}

// "https://animevsub.vn/" -> "animevsub.vn"
function prettyUrl(url) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function showError(msg) {
  const body = document.getElementById('resultsBody');
  body.innerHTML = `<div class="result-row"><span class="result-icon error">✕</span><span class="result-name">${msg}</span></div>`;
  document.getElementById('resultsScope').textContent = '';
  document.getElementById('resultsFooter').textContent = '';
  document.getElementById('results').classList.add('visible');
}

document.addEventListener('DOMContentLoaded', init);
