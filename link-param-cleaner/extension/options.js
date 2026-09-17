// options.js — watched sites, the param table of the selected site, the
// activity log and settings. Spec §11.

let sites = [];
let settings = {};
let selectedId = null;
let paramFilter = '';

async function send(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response) throw new Error('The extension service worker did not respond.');
  if (!response.success) throw new Error(response.error);
  return response.data;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fmtAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function emptyState(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
}

function status(message, isError) {
  const el = document.getElementById('sites-status');
  el.textContent = message;
  el.className = isError ? 'status-error' : 'muted';
  if (message) setTimeout(() => (el.textContent === message ? (el.textContent = '') : null), 6000);
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
  if (location.hash.startsWith('#activity')) activateTab('activity');
}

function activateTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'panel-' + name));
  if (name === 'activity') renderActivity();
}

// ─── Sites ───────────────────────────────────────────────────────────────────

async function loadSites() {
  sites = await send('listSites');

  // The popup links here with the site it was showing, so the right table is
  // already open when the page loads.
  const wanted = decodeURIComponent((location.hash.match(/#site=(.+)$/) || [])[1] || '');
  if (wanted) {
    const match = sites.find((site) => site.site === wanted);
    if (match) selectedId = match.id;
  }
  if (!sites.some((site) => site.id === selectedId)) selectedId = sites.length ? sites[0].id : null;

  renderSiteList();
  renderParamPane();
}

function renderSiteList() {
  const search = document.getElementById('site-search').value.trim().toLowerCase();
  const visible = search ? sites.filter((site) => site.site.includes(search)) : sites;
  const container = document.getElementById('site-list');

  if (!sites.length) {
    container.innerHTML = emptyState('👁', 'No watched sites yet.<br />Open a site and click the extension icon, or add a domain above.');
    return;
  }
  if (!visible.length) {
    container.innerHTML = `<div class="site-empty">No site matches “${escapeHtml(search)}”.</div>`;
    return;
  }

  container.innerHTML = visible
    .map((site) => {
      const stripped = site.params.filter((param) => param.state === 'strip').length;
      return `
        <div class="site-row ${site.id === selectedId ? 'selected' : ''}" data-site="${site.id}">
          <div class="site-row-main">
            <div class="site-row-name ${site.enabled ? '' : 'paused'}">${escapeHtml(site.site)}</div>
            <div class="site-row-meta">${site.params.length} param${site.params.length === 1 ? '' : 's'} · ${stripped} removed · ${
              (site.stats && site.stats.cleanedCount) || 0
            } cleaned</div>
          </div>
          ${site.enabled ? '' : '<span class="badge badge-off">paused</span>'}
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('[data-site]').forEach((row) =>
    row.addEventListener('click', () => {
      selectedId = row.dataset.site;
      paramFilter = '';
      renderSiteList();
      renderParamPane();
    })
  );
}

function selectedSite() {
  return sites.find((site) => site.id === selectedId) || null;
}

function renderParamPane() {
  const pane = document.getElementById('param-pane');
  const site = selectedSite();

  if (!site) {
    pane.innerHTML = emptyState('🔗', 'Pick a site on the left to see the params it attaches to outbound links.');
    return;
  }

  const search = paramFilter.toLowerCase();
  const params = [...site.params].sort((a, b) => (b.seen || 0) - (a.seen || 0) || a.name.localeCompare(b.name));
  const visible = search ? params.filter((param) => param.name.toLowerCase().includes(search)) : params;

  pane.innerHTML = `
    <div class="pane-head">
      <div>
        <h3>${escapeHtml(site.site)}</h3>
        <div class="muted">watched since ${fmtTime(site.createdAt)}</div>
      </div>
      <div class="pane-head-actions">
        <label class="toggle">
          <input type="checkbox" id="pane-enabled" ${site.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
        <button class="action-btn action-btn-danger" id="pane-delete">Stop watching</button>
      </div>
    </div>

    ${site.truncated ? `<div class="warn-bar">This site hit the ${settings.maxParamsPerSite}-param limit; new params are no longer recorded. Delete the ones you do not use.</div>` : ''}

    <div class="param-toolbar">
      <input type="text" id="param-search" class="search-input" placeholder="Search params…" value="${escapeHtml(paramFilter)}" />
      <button class="action-btn" data-bulk="all">Select all</button>
      <button class="action-btn" data-bulk="none">Clear all</button>
      <button class="action-btn" data-bulk="tracking">Select all tracking</button>
      <span class="toolbar-group">
        <input type="text" id="prefix-input" class="search-input narrow" placeholder="utm_" />
        <button class="action-btn" id="btn-prefix">Select matching</button>
      </span>
      <span class="toolbar-group">
        <input type="text" id="new-param" class="search-input narrow" placeholder="param name" />
        <button class="action-btn" id="btn-add-param">➕ Add param</button>
      </span>
    </div>

    ${visible.length ? paramTable(visible) : emptyState('🔍', params.length ? 'No param matches that search.' : 'No params seen yet on links leaving this site.')}
  `;

  wireParamPane(site);
}

function paramTable(params) {
  return `
    <table class="data-table">
      <thead>
        <tr><th class="tick-col">Remove</th><th>Param</th><th>Seen</th><th>Last seen</th><th>Last target</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${params.map(paramRow).join('')}
      </tbody>
    </table>
  `;
}

function paramRow(param) {
  const badges = [
    param.label === 'tracking' ? '<span class="badge badge-track">tracking</span>' : '',
    param.label === 'functional' ? '<span class="badge badge-func">may be needed</span>' : '',
    param.source === 'manual' ? '<span class="badge badge-manual">manual</span>' : '',
  ].join(' ');

  return `
    <tr class="${param.state === 'ignored' ? 'row-ignored' : ''}">
      <td class="tick-col">
        <input type="checkbox" data-param="${escapeHtml(param.name)}" ${param.state === 'strip' ? 'checked' : ''} ${
          param.state === 'ignored' ? 'disabled' : ''
        } />
      </td>
      <td><span class="mono">${escapeHtml(param.name)}</span> ${badges}${
        param.sample ? `<div class="muted">sample: ${escapeHtml(param.sample)}</div>` : ''
      }</td>
      <td>${param.seen || 0}</td>
      <td class="nowrap">${fmtAgo(param.lastSeenAt)}</td>
      <td class="mono">${escapeHtml(param.lastTargetHost || '—')}</td>
      <td class="nowrap">
        <button class="icon-btn" data-ignore="${escapeHtml(param.name)}" title="${param.state === 'ignored' ? 'Unignore' : 'Ignore'}">${
          param.state === 'ignored' ? '🔔' : '🔕'
        }</button>
        <button class="icon-btn danger" data-delete="${escapeHtml(param.name)}" title="Delete">🗑️</button>
      </td>
    </tr>
  `;
}

function wireParamPane(site) {
  const pane = document.getElementById('param-pane');

  document.getElementById('pane-enabled').addEventListener('change', async (event) => {
    await send('setSiteEnabled', { id: site.id, enabled: event.target.checked });
    await loadSites();
  });

  document.getElementById('pane-delete').addEventListener('click', async () => {
    if (!confirm(`Stop watching ${site.site}? Its params and ticks are deleted.`)) return;
    await send('unwatchSite', { id: site.id });
    selectedId = null;
    await loadSites();
  });

  const search = document.getElementById('param-search');
  search.addEventListener('input', () => {
    paramFilter = search.value;
    renderParamPane();
    const again = document.getElementById('param-search');
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  });

  pane.querySelectorAll('[data-param]').forEach((input) =>
    input.addEventListener('change', async () => {
      const param = site.params.find((entry) => entry.name === input.dataset.param);
      if (input.checked && param && param.label === 'functional' && settings.warnOnFunctionalParam) {
        if (!confirm(`${param.name} is often something the destination page needs. Remove it anyway?`)) {
          input.checked = false;
          return;
        }
      }
      await setStates([input.dataset.param], input.checked ? 'strip' : 'seen');
    })
  );

  pane.querySelectorAll('[data-bulk]').forEach((button) =>
    button.addEventListener('click', async () => {
      const kind = button.dataset.bulk;
      const candidates = site.params.filter((param) => param.state !== 'ignored');
      if (kind === 'all') {
        // Bulk "select all" deliberately skips the warning: the user asked for
        // every param on this site, and a modal per functional name would be a
        // queue of prompts rather than a decision.
        await setStates(
          candidates.map((param) => param.name),
          'strip'
        );
      } else if (kind === 'none') {
        await setStates(
          candidates.map((param) => param.name),
          'seen'
        );
      } else {
        await setStates(
          candidates.filter((param) => param.label === 'tracking').map((param) => param.name),
          'strip'
        );
      }
    })
  );

  document.getElementById('btn-prefix').addEventListener('click', async () => {
    const prefix = document.getElementById('prefix-input').value.trim().toLowerCase();
    if (!prefix) return;
    // Stored one full name at a time: `removeParams` has no wildcards, so a
    // pattern here would be a promise the rule cannot keep (spec §6.3).
    const names = site.params.filter((param) => param.state !== 'ignored' && param.name.toLowerCase().startsWith(prefix)).map((param) => param.name);
    if (!names.length) {
      status(`No param starts with “${prefix}”.`, true);
      return;
    }
    await setStates(names, 'strip');
    status(`Selected ${names.length} param${names.length === 1 ? '' : 's'}.`);
  });

  document.getElementById('btn-add-param').addEventListener('click', async () => {
    const input = document.getElementById('new-param');
    try {
      await send('addParam', { id: site.id, name: input.value });
      input.value = '';
      await loadSites();
    } catch (err) {
      status(err.message, true);
    }
  });

  pane.querySelectorAll('[data-ignore]').forEach((button) =>
    button.addEventListener('click', async () => {
      const param = site.params.find((entry) => entry.name === button.dataset.ignore);
      await setStates([button.dataset.ignore], param.state === 'ignored' ? 'seen' : 'ignored');
    })
  );

  pane.querySelectorAll('[data-delete]').forEach((button) =>
    button.addEventListener('click', async () => {
      await send('deleteParams', { id: site.id, names: [button.dataset.delete] });
      await loadSites();
    })
  );
}

async function setStates(names, state) {
  if (!names.length) return;
  await send('setParamState', { id: selectedId, names, state });
  await loadSites();
}

// ─── Add site ────────────────────────────────────────────────────────────────

function initSiteForm() {
  const input = document.getElementById('site-input');

  async function add() {
    try {
      const result = await send('watchSite', { site: input.value });
      input.value = '';
      selectedId = result.record.id;
      await loadSites();
      // Say so when the input was narrowed, rather than storing something else
      // than what was typed (spec §8).
      status(result.changed ? `Added as ${result.site} — params are filed per registrable domain.` : `Now watching ${result.site}.`);
    } catch (err) {
      status(err.message, true);
    }
  }

  document.getElementById('site-add').addEventListener('click', add);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });
  document.getElementById('site-search').addEventListener('input', renderSiteList);
}

// ─── Import / export ─────────────────────────────────────────────────────────

function initTransfer() {
  document.getElementById('btn-export').addEventListener('click', async () => {
    const payload = await send('exportConfig');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `link-param-cleaner-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    status(`Exported ${payload.sites.length} site${payload.sites.length === 1 ? '' : 's'}.`);
  });

  const file = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => file.click());

  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0];
    file.value = '';
    if (!chosen) return;

    let payload;
    try {
      payload = JSON.parse(await chosen.text());
    } catch (err) {
      status(`Could not read that file: ${err.message}`, true);
      return;
    }

    const replace = confirm('OK: replace the current watch list with the file.\nCancel: merge the file into what is already here.');
    try {
      const result = await send('importConfig', { payload, mode: replace ? 'replace' : 'merge' });
      await loadSites();
      const skipped = result.skipped.length ? `, ${result.skipped.length} skipped (${escapeHtml(result.skipped[0].reason)})` : '';
      status(`Imported ${result.sites} site${result.sites === 1 ? '' : 's'}, ${result.params} param${result.params === 1 ? '' : 's'}${skipped}.`);
    } catch (err) {
      status(err.message, true);
    }
  });
}

// ─── Activity ────────────────────────────────────────────────────────────────

async function renderActivity() {
  const filter = document.getElementById('activity-filter');
  const chosen = filter.value;

  filter.innerHTML = `<option value="">All sites</option>${sites.map((site) => `<option value="${escapeHtml(site.site)}">${escapeHtml(site.site)}</option>`).join('')}`;
  filter.value = chosen;

  const logs = await send('listLog', { site: chosen || undefined, limit: 500 });
  const container = document.getElementById('activity-container');

  if (!logs.length) {
    container.innerHTML = emptyState('📋', 'Nothing cleaned yet.<br />Tick a param on a watched site, then click a link that carries it.');
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>When</th><th>From</th><th>To</th><th>Removed</th><th>Kept</th></tr>
      </thead>
      <tbody>
        ${logs
          .map(
            (log) => `
          <tr>
            <td class="nowrap">${fmtTime(log.createdAt)}</td>
            <td class="mono" title="${escapeHtml(log.sourceUrl)}">${escapeHtml(log.sourceSite)}</td>
            <td class="mono">${escapeHtml(log.targetHost)}</td>
            <td class="mono removed">${escapeHtml(log.removed.join(', '))}</td>
            <td class="mono muted">${escapeHtml(log.kept.join(', ') || '—')}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function initActivity() {
  document.getElementById('activity-filter').addEventListener('change', renderActivity);
  document.getElementById('activity-clear').addEventListener('click', async () => {
    if (!confirm('Clear the activity log?')) return;
    await send('clearLog');
    renderActivity();
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTING_TOGGLES = [
  ['collectEnabled', 'Collect params', 'Record the param names watched sites attach to links leaving them'],
  ['storeSampleValues', 'Store a sample value', 'Off by default — query strings routinely carry tokens, emails and search terms'],
  ['showBadge', 'Badge the toolbar icon', 'Show how many params were removed on the current tab'],
  ['logEnabled', 'Keep an activity log', 'Stores the source URL and destination host of each cleaned link, in this browser only'],
  ['warnOnFunctionalParam', 'Warn before removing a functional param', 'Ask first for names like id, q or token'],
];

const SETTING_NUMBERS = [
  ['logLimit', 'Activity log entries kept', 10, 2000],
  ['maxSites', 'Maximum watched sites', 1, 2000],
  ['maxParamsPerSite', 'Maximum params per site', 5, 500],
];

async function renderSettings() {
  settings = await send('getSettings');
  const container = document.getElementById('settings-container');

  container.innerHTML = `
    ${SETTING_TOGGLES.map(
      ([key, label, hint]) => `
      <div class="setting-row">
        <div class="setting-label">${label}<small>${hint}</small></div>
        <label class="toggle">
          <input type="checkbox" data-setting="${key}" ${settings[key] ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>`
    ).join('')}
    ${SETTING_NUMBERS.map(
      ([key, label, min, max]) => `
      <div class="setting-row">
        <div class="setting-label">${label}</div>
        <input type="number" class="number-input" data-number="${key}" min="${min}" max="${max}" value="${settings[key]}" />
      </div>`
    ).join('')}
  `;

  container.querySelectorAll('[data-setting]').forEach((input) =>
    input.addEventListener('change', async () => {
      settings = await send('setSettings', { patch: { [input.dataset.setting]: input.checked } });
      renderParamPane();
    })
  );

  container.querySelectorAll('[data-number]').forEach((input) =>
    input.addEventListener('change', async () => {
      const value = Number(input.value);
      if (!Number.isFinite(value) || value < Number(input.min) || value > Number(input.max)) {
        input.value = settings[input.dataset.number];
        return;
      }
      settings = await send('setSettings', { patch: { [input.dataset.number]: value } });
    })
  );
}

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  initTabs();
  initSiteForm();
  initTransfer();
  initActivity();
  await renderSettings();
  await loadSites();
}

init().catch((err) => status(err.message, true));
