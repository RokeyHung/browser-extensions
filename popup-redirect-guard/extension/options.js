// options.js

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });
  if (location.hash === '#logs') activateTab('logs');
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
}

// ─── Protected Sites ─────────────────────────────────────────────────────────
let cachedSites = [];

async function renderSites() {
  const rules = (await chrome.runtime.sendMessage({ type: 'getRules' })) || [];
  cachedSites = rules;
  const container = document.getElementById('sites-container');

  if (rules.length === 0) {
    container.innerHTML = emptyState('🛡', 'No protected sites yet.<br />Open a website and click the extension icon to enable protection.');
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Status</th><th>Pattern</th><th>Mode</th><th>Blocked</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${rules.map(siteRow).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-toggle]').forEach((el) =>
    el.addEventListener('change', async (e) => {
      await chrome.runtime.sendMessage({ type: 'updateRule', rule: { id: el.dataset.toggle, enabled: e.target.checked } });
      renderSites();
    })
  );
  container.querySelectorAll('[data-mode-select]').forEach((el) =>
    el.addEventListener('change', async () => {
      await chrome.runtime.sendMessage({ type: 'updateRule', rule: { id: el.dataset.modeSelect, mode: el.value } });
      renderSites();
    })
  );
  container.querySelectorAll('[data-delete]').forEach((el) =>
    el.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'deleteRule', ruleId: el.dataset.delete });
      renderSites();
    })
  );
}

function siteRow(rule) {
  return `
    <tr>
      <td>
        <label class="toggle">
          <input type="checkbox" data-toggle="${rule.id}" ${rule.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td class="mono">${escapeHtml(rule.sitePattern)}</td>
      <td>
        <select data-mode-select="${rule.id}" class="action-btn">
          <option value="normal" ${rule.mode === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="strict" ${rule.mode === 'strict' ? 'selected' : ''}>Strict</option>
        </select>
      </td>
      <td>${rule.blockedCount || 0}</td>
      <td class="nowrap">
        <button class="icon-btn danger" data-delete="${rule.id}" title="Delete">🗑️</button>
      </td>
    </tr>
  `;
}

// ─── Protected Sites import / export ─────────────────────────────────────────
function initSitesActions() {
  const fileInput = document.getElementById('sites-file');
  const statusEl = document.getElementById('sites-status');

  document.getElementById('sites-export').addEventListener('click', () => {
    if (cachedSites.length === 0) {
      showSitesStatus('Nothing to export yet.');
      return;
    }
    const payload = {
      version: '1',
      type: 'popup-redirect-guard-sites',
      exportedAt: new Date().toISOString(),
      sites: cachedSites.map((r) => ({
        sitePattern: r.sitePattern,
        mode: r.mode,
        enabled: r.enabled,
        includeRoot: r.includeRoot,
        settings: r.settings,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'popup-guard-sites.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('sites-import').addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      let sites;
      try {
        const data = JSON.parse(e.target.result);
        sites = Array.isArray(data) ? data : data.sites || data.rules;
        if (!Array.isArray(sites)) throw new Error('no sites array');
      } catch {
        showSitesStatus('⚠ Invalid file. Expected a Popup Guard sites export (JSON).', true);
        return;
      }
      const res = await chrome.runtime.sendMessage({ type: 'importRules', rules: sites });
      const parts = [`${res.added} added`];
      if (res.skipped) parts.push(`${res.skipped} duplicate(s) skipped`);
      if (res.invalid) parts.push(`${res.invalid} invalid`);
      showSitesStatus(parts.join(', '));
      renderSites();
    };
    reader.readAsText(file);
  });

  function showSitesStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.style.color = isError ? '#dc2626' : '#6b7280';
    if (!isError) setTimeout(() => (statusEl.textContent = ''), 4000);
  }
}

// ─── Allowlist ───────────────────────────────────────────────────────────────
async function renderAllow() {
  const allowRules = (await chrome.runtime.sendMessage({ type: 'getAllowRules' })) || [];
  const container = document.getElementById('allow-container');

  if (allowRules.length === 0) {
    container.innerHTML = emptyState('✅', 'No allowlist entries.<br />Add trusted domains that should never be blocked.');
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Source pattern</th><th>Allowed domain</th><th>Scope</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${allowRules
          .map(
            (a) => `
          <tr>
            <td class="mono">${escapeHtml(a.scope === 'global' ? '(any site)' : a.sourcePattern)}</td>
            <td class="mono">${escapeHtml(a.allowedDomain)}</td>
            <td><span class="muted">${escapeHtml(a.scope || 'per-site')}</span></td>
            <td class="nowrap"><button class="icon-btn danger" data-delete-allow="${a.id}" title="Delete">🗑️</button></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-delete-allow]').forEach((el) =>
    el.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'deleteAllow', allowId: el.dataset.deleteAllow });
      renderAllow();
    })
  );
}

function initAllowForm() {
  document.getElementById('allow-add').addEventListener('click', async () => {
    const sourceEl = document.getElementById('allow-source');
    const domainEl = document.getElementById('allow-domain');
    const allowedDomain = domainEl.value.trim().toLowerCase();
    if (!allowedDomain) {
      domainEl.focus();
      return;
    }
    const sourcePattern = sourceEl.value.trim().toLowerCase();
    await chrome.runtime.sendMessage({
      type: 'addAllow',
      allow: {
        sourcePattern: sourcePattern || '*',
        allowedDomain,
        scope: sourcePattern ? 'per-site' : 'global',
      },
    });
    sourceEl.value = '';
    domainEl.value = '';
    renderAllow();
  });
}

// ─── Logs ────────────────────────────────────────────────────────────────────
let cachedLogs = [];

async function renderLogs() {
  cachedLogs = (await chrome.runtime.sendMessage({ type: 'getLogs' })) || [];
  const container = document.getElementById('logs-container');

  if (cachedLogs.length === 0) {
    container.innerHTML = emptyState('📋', 'No blocked attempts logged yet.');
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Time</th><th>Source</th><th>Blocked URL</th><th>Reason</th><th>Mode</th></tr>
      </thead>
      <tbody>
        ${cachedLogs
          .map(
            (l) => `
          <tr>
            <td class="nowrap muted">${escapeHtml(fmtTime(l.createdAt))}</td>
            <td class="mono">${escapeHtml(l.sourceHostname)}</td>
            <td class="mono" title="${escapeHtml(l.targetUrl)}">${escapeHtml(l.targetHostname || l.targetUrl)}</td>
            <td>${escapeHtml(l.reason)}</td>
            <td><span class="badge ${l.mode === 'strict' ? 'badge-strict' : 'badge-normal'}">${escapeHtml(l.mode)}</span></td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function initLogActions() {
  document.getElementById('logs-clear').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clearLogs' });
    renderLogs();
  });
  document.getElementById('logs-export').addEventListener('click', () => {
    const payload = { version: '1', exportedAt: new Date().toISOString(), logs: cachedLogs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'popup-guard-logs.json';
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────
const SETTING_TOGGLES = [
  ['blockWindowOpen', 'Block window.open', 'Stop scripts from opening new windows/tabs to external sites'],
  ['blockExternalBlank', 'Block external target="_blank"', 'Block links that open external sites in a new tab'],
  ['blockScriptedRedirect', 'Block scripted redirects', 'Restore the page if a script redirects you off-site'],
  ['blockPopUnder', 'Block pop-under behavior', 'Close background tabs opened to external ad pages'],
  ['blockExternalFormSubmit', 'Block external form submit', 'Block forms that submit to another domain'],
  ['closeUnwantedNewTabs', 'Close unwanted new tabs', 'Automatically close external tabs opened by protected sites'],
  ['showToast', 'Show toast when blocked', 'Display an on-page notification for each block'],
  ['keepLog', 'Keep block log', 'Store blocked attempts so you can review them later'],
];

async function renderSettings() {
  const settings = (await chrome.runtime.sendMessage({ type: 'getSettings' })) || {};
  const container = document.getElementById('settings-container');

  const toggles = SETTING_TOGGLES.map(
    ([key, label, hint]) => `
    <div class="setting-row">
      <div class="setting-label">${label}<small>${hint}</small></div>
      <label class="toggle">
        <input type="checkbox" data-setting="${key}" ${settings[key] !== false ? 'checked' : ''} />
        <span class="toggle-slider"></span>
      </label>
    </div>`
  ).join('');

  container.innerHTML = `
    ${toggles}
    <div class="setting-row">
      <div class="setting-label">Default mode for newly protected sites</div>
      <div class="mode-radio">
        <label><input type="radio" name="defaultMode" value="normal" ${settings.defaultMode !== 'strict' ? 'checked' : ''} /> Normal</label>
        <label><input type="radio" name="defaultMode" value="strict" ${settings.defaultMode === 'strict' ? 'checked' : ''} /> Strict</label>
      </div>
    </div>
  `;

  container
    .querySelectorAll('[data-setting]')
    .forEach((el) =>
      el.addEventListener('change', () => chrome.runtime.sendMessage({ type: 'saveSettings', settings: { [el.dataset.setting]: el.checked } }))
    );
  container.querySelectorAll('[name="defaultMode"]').forEach((el) =>
    el.addEventListener('change', () => {
      if (el.checked) chrome.runtime.sendMessage({ type: 'saveSettings', settings: { defaultMode: el.value } });
    })
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function emptyState(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
}

// ─── Init ────────────────────────────────────────────────────────────────────
initTabs();
initSitesActions();
initAllowForm();
initLogActions();
renderSites();
renderAllow();
renderLogs();
renderSettings();
