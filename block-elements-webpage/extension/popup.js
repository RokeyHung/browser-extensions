// popup.js

const appEl = document.getElementById('app-content');

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupported(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

async function render() {
  const tab = await getCurrentTab();

  if (!tab || !isSupported(tab.url)) {
    appEl.innerHTML = `
      <div class="unsupported-msg">
        <div class="icon">🚫</div>
        <strong>This page is not supported.</strong><br>
        Please open a normal http/https website.
      </div>
    `;
    return;
  }

  const url = new URL(tab.url);
  const hostname = url.hostname;

  // Get matching rules
  const rules = await chrome.runtime.sendMessage({ type: 'getRulesForUrl', url: tab.url });
  const activeCount = (rules || []).filter((r) => r.enabled).length;

  // Get sitewide enabled setting
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
  const siteEnabled = !disabledSites.includes(hostname);

  appEl.innerHTML = `
    <div class="content">
      <div class="site-info">
        <div class="site-label">Current site</div>
        <div class="site-domain">${escapeHtml(hostname)}</div>
        <div class="site-stat">
          Active rules on this site: <strong>${activeCount}</strong>
        </div>
      </div>

      <button class="btn btn-primary" id="btn-block">
        ✚ Block element
      </button>
      <button class="btn btn-secondary" id="btn-site-rules">
        📋 Show rules for this site
      </button>
      <button class="btn btn-secondary" id="btn-manage">
        ⚙️ Manage all filters
      </button>

      <div class="toggle-row">
        <span class="toggle-label">Enable filtering on this site</span>
        <label class="toggle">
          <input type="checkbox" id="toggle-site" ${siteEnabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  `;

  document.getElementById('btn-block').addEventListener('click', async () => {
    if (!siteEnabled) return;
    await chrome.runtime.sendMessage({ type: 'startPickerInTab', tabId: tab.id });
    window.close();
  });

  document.getElementById('btn-site-rules').addEventListener('click', () => {
    chrome.tabs.create({ url: `options.html?site=${encodeURIComponent(hostname)}` });
    window.close();
  });

  document.getElementById('btn-manage').addEventListener('click', () => {
    chrome.tabs.create({ url: 'options.html' });
    window.close();
  });

  document.getElementById('toggle-site').addEventListener('change', async (e) => {
    const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
    let updated;
    if (e.target.checked) {
      updated = disabledSites.filter((s) => s !== hostname);
    } else {
      if (!disabledSites.includes(hostname)) disabledSites.push(hostname);
      updated = disabledSites;
    }
    await chrome.storage.local.set({ disabledSites: updated });
    // Tell content script to reload rules
    chrome.runtime.sendMessage({ type: 'reloadRulesInTab', tabId: tab.id }).catch(() => {});
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

render();
