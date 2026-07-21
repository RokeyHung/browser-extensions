// popup.js

const DM = globalThis.DomainMatcher;
const appEl = document.getElementById('app-content');

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupported(url) {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

async function render() {
  const tab = await getCurrentTab();

  if (!tab || !isSupported(tab.url)) {
    appEl.innerHTML = `
      <div class="unsupported-msg">
        <div class="icon">🚫</div>
        <strong>This page is not supported.</strong><br />
        Please open a normal http/https website.
      </div>
    `;
    return;
  }

  const hostname = new URL(tab.url).hostname;
  const { config, blockedToday } = await chrome.runtime.sendMessage({ type: 'getPopupData', url: tab.url });

  if (config.active) {
    renderEnabled(tab, hostname, config, blockedToday);
  } else {
    renderDisabled(tab, hostname);
  }
}

// ─── Enabled state ─────────────────────────────────────────────────────────────
function renderEnabled(tab, hostname, config, blockedToday) {
  appEl.innerHTML = `
    <div class="content">
      <div class="site-info">
        <div class="site-label">Current site</div>
        <div class="site-domain">${escapeHtml(hostname)}</div>
      </div>

      <div class="status-row">
        <div class="status-text">
          <span class="status-on">✓ Protection enabled</span>
          <span class="pattern">${escapeHtml(config.sitePattern || hostname)}</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-protect" checked />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <div class="mode-block">
        <div class="mode-title">Mode</div>
        <div class="mode-options">
          <div class="mode-opt ${config.mode === 'normal' ? 'selected' : ''}" data-mode="normal">
            Normal <small>Balanced</small>
          </div>
          <div class="mode-opt ${config.mode === 'strict' ? 'selected' : ''}" data-mode="strict">
            Strict <small>Block all</small>
          </div>
        </div>
      </div>

      <div class="stat-line">Blocked today: <strong>${blockedToday}</strong> attempt${blockedToday === 1 ? '' : 's'}</div>

      <button class="btn btn-secondary" id="btn-logs">📋 View blocked attempts</button>
      <button class="btn btn-secondary" id="btn-settings">⚙️ Settings</button>
    </div>
  `;

  document.getElementById('toggle-protect').addEventListener('change', async (e) => {
    if (!e.target.checked) {
      await chrome.runtime.sendMessage({ type: 'updateRule', rule: { id: config.ruleId, enabled: false } });
      notifyTab(tab.id);
      render();
    }
  });

  appEl.querySelectorAll('.mode-opt').forEach((opt) => {
    opt.addEventListener('click', async () => {
      const mode = opt.dataset.mode;
      if (mode === config.mode) return;
      await chrome.runtime.sendMessage({ type: 'updateRule', rule: { id: config.ruleId, mode } });
      notifyTab(tab.id);
      render();
    });
  });

  document.getElementById('btn-logs').addEventListener('click', () => {
    chrome.tabs.create({ url: 'options.html#logs' });
    window.close();
  });
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: 'options.html' });
    window.close();
  });
}

// ─── Disabled state ────────────────────────────────────────────────────────────
function renderDisabled(tab, hostname) {
  const pattern = DM.suggestPattern(hostname);

  appEl.innerHTML = `
    <div class="content">
      <div class="site-info">
        <div class="site-label">Current site</div>
        <div class="site-domain">${escapeHtml(hostname)}</div>
      </div>

      <div class="status-row">
        <div class="status-text"><span class="status-off">Protection is off for this site</span></div>
      </div>

      <button class="btn btn-primary" id="btn-enable-pattern">🛡 Enable for ${escapeHtml(pattern)}</button>
      <button class="btn btn-secondary" id="btn-enable-host">Enable for ${escapeHtml(hostname)} only</button>
      <div class="divider"></div>
      <button class="btn btn-secondary" id="btn-settings">⚙️ Settings</button>
    </div>
  `;

  document.getElementById('btn-enable-pattern').addEventListener('click', () => enable(tab, pattern));
  document.getElementById('btn-enable-host').addEventListener('click', () => enable(tab, hostname));
  document.getElementById('btn-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: 'options.html' });
    window.close();
  });
}

async function enable(tab, sitePattern) {
  const settings = await chrome.runtime.sendMessage({ type: 'getSettings' });
  await chrome.runtime.sendMessage({
    type: 'enableSite',
    sitePattern,
    mode: settings.defaultMode || 'strict',
    includeRoot: true,
  });
  notifyTab(tab.id);
  chrome.runtime.sendMessage({ type: 'reloadTab', tabId: tab.id });
  render();
}

function notifyTab(tabId) {
  chrome.tabs.sendMessage(tabId, { type: 'configChanged' }).catch(() => {});
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

render();
