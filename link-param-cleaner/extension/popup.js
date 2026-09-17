// popup.js — current site, the params it was seen attaching to outbound links,
// and a checkbox per param. Spec §10.

const appEl = document.getElementById('app-content');

// How many rows fit before the list gets its own scrollbar and a link to the
// full table.
const VISIBLE_PARAMS = 8;

let state = null;

async function send(type, payload) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response) throw new Error('The extension service worker did not respond.');
  if (!response.success) throw new Error(response.error);
  return response.data;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Ticked first, then the names the catalog recognises as tracking, then by how
// often they turned up: the param a user came here to remove should be the one
// under the cursor (spec §10.2).
function sortParams(params) {
  const rank = (param) => (param.state === 'strip' ? 0 : param.label === 'tracking' ? 1 : 2);
  return [...params]
    .filter((param) => param.state !== 'ignored')
    .sort((a, b) => rank(a) - rank(b) || (b.seen || 0) - (a.seen || 0) || a.name.localeCompare(b.name));
}

function openOptions(hash) {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html' + (hash || '')) });
  window.close();
}

// ─── Render ──────────────────────────────────────────────────────────────────

async function render() {
  state = await send('getPopupState');

  if (!state.supported) {
    appEl.innerHTML = `
      <div class="unsupported-msg">
        <div class="icon">🔗</div>
        <strong>This page is not supported.</strong><br />
        Open a normal http/https website.
        <div class="spacer"></div>
        <button class="btn btn-secondary" id="btn-options">⚙️ Manage all sites</button>
      </div>
    `;
    document.getElementById('btn-options').addEventListener('click', () => openOptions());
    return;
  }

  if (state.record) renderWatched();
  else renderUnwatched();
}

function siteCard() {
  const extra = state.hostname !== state.site ? `<div class="site-sub">${escapeHtml(state.hostname)}</div>` : '';
  return `
    <div class="site-info">
      <div class="site-label">Current site</div>
      <div class="site-domain">${escapeHtml(state.site)}</div>
      ${extra}
    </div>
  `;
}

function renderUnwatched() {
  appEl.innerHTML = `
    <div class="content">
      ${siteCard()}
      <div class="status-row">
        <div class="status-text">
          <span class="status-off">Not watched</span>
          <span class="pattern">No params are being removed here.</span>
        </div>
      </div>
      <button class="btn btn-primary" id="btn-watch">👁 Watch this site</button>
      <button class="btn btn-secondary" id="btn-options">⚙️ Manage all sites</button>
    </div>
  `;

  document.getElementById('btn-watch').addEventListener('click', async () => {
    await send('watchSite', { site: state.site });
    render();
  });
  document.getElementById('btn-options').addEventListener('click', () => openOptions());
}

function renderWatched() {
  const record = state.record;
  const params = sortParams(record.params || []);
  const stripped = params.filter((param) => param.state === 'strip').length;
  const cleaned = (record.stats && record.stats.cleanedCount) || 0;
  const hasTracking = params.some((param) => param.label === 'tracking' && param.state !== 'strip');

  const list = params.length
    ? `<div class="param-list${params.length > VISIBLE_PARAMS ? ' scrolling' : ''}">${params.map(paramRow).join('')}</div>`
    : `<div class="param-empty">No params yet. Click a few links to other sites and they will show up here.</div>`;

  const overflow = params.length > VISIBLE_PARAMS ? `<button class="link-btn" id="btn-see-all">See all ${params.length} →</button>` : '';

  const lastClean = state.lastClean
    ? `<div class="stat-line last-clean">${escapeHtml(state.lastClean.targetHost)} · removed ${escapeHtml(
        state.lastClean.removed.join(', ')
      )} · ${timeAgo(state.lastClean.createdAt)}</div>`
    : '';

  appEl.innerHTML = `
    <div class="content">
      ${siteCard()}

      <div class="status-row">
        <div class="status-text">
          <span class="${record.enabled ? 'status-on' : 'status-off'}">${record.enabled ? '✓ Watching this site' : 'Paused'}</span>
          <span class="pattern">${params.length} param${params.length === 1 ? '' : 's'} seen · ${stripped} removed · ${cleaned} link${
            cleaned === 1 ? '' : 's'
          } cleaned</span>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-site" ${record.enabled ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>

      ${record.truncated ? `<div class="warn-bar">Param limit reached for this site. Delete unused params in the options page.</div>` : ''}
      <div id="confirm-slot"></div>

      ${list}
      ${overflow}

      ${hasTracking ? `<button class="btn btn-secondary" id="btn-select-tracking">🔗 Select all tracking</button>` : ''}
      <button class="btn btn-secondary" id="btn-options">⚙️ Manage params</button>
      ${lastClean}
    </div>
  `;

  document.getElementById('toggle-site').addEventListener('change', async (event) => {
    await send('setSiteEnabled', { id: record.id, enabled: event.target.checked });
    render();
  });

  appEl.querySelectorAll('[data-param]').forEach((input) =>
    input.addEventListener('change', (event) =>
      onParamToggle(
        event.target,
        record,
        params.find((param) => param.name === input.dataset.param)
      )
    )
  );

  const selectTracking = document.getElementById('btn-select-tracking');
  if (selectTracking) {
    selectTracking.addEventListener('click', async () => {
      const names = params.filter((param) => param.label === 'tracking' && param.state !== 'strip').map((param) => param.name);
      await send('setParamState', { id: record.id, names, state: 'strip' });
      render();
    });
  }

  const seeAll = document.getElementById('btn-see-all');
  if (seeAll) seeAll.addEventListener('click', () => openOptions(`#site=${encodeURIComponent(record.site)}`));
  document.getElementById('btn-options').addEventListener('click', () => openOptions(`#site=${encodeURIComponent(record.site)}`));
}

function paramRow(param) {
  const badge =
    param.label === 'tracking'
      ? '<span class="badge badge-track">tracking</span>'
      : param.label === 'functional'
        ? '<span class="badge badge-func">may be needed</span>'
        : '';

  return `
    <label class="param-row">
      <input type="checkbox" data-param="${escapeHtml(param.name)}" ${param.state === 'strip' ? 'checked' : ''} />
      <span class="param-name">${escapeHtml(param.name)}</span>
      ${badge}
      <span class="param-seen">×${param.seen || 0}</span>
    </label>
  `;
}

// ─── Ticking a param ─────────────────────────────────────────────────────────

async function onParamToggle(input, record, param) {
  const state_ = input.checked ? 'strip' : 'seen';

  // Removing a param the destination may need breaks the link instead of
  // cleaning it, so ticking one asks first (spec §7.5, §10.2). The prompt is
  // inline: a window.confirm() in a browser action popup takes focus away and
  // the popup closes under it, taking the answer with it.
  if (state_ === 'strip' && param && param.label === 'functional' && state.settings.warnOnFunctionalParam) {
    input.checked = false;
    askFunctionalConfirm(record, param);
    return;
  }

  await send('setParamState', { id: record.id, names: [param.name], state: state_ });
  render();
}

function askFunctionalConfirm(record, param) {
  const slot = document.getElementById('confirm-slot');
  slot.innerHTML = `
    <div class="warn-bar">
      <div><strong>${escapeHtml(param.name)}</strong> is often something the destination page needs. Remove it anyway?</div>
      <div class="warn-actions">
        <button class="action-btn" id="confirm-cancel">Keep it</button>
        <button class="action-btn action-btn-primary" id="confirm-ok">Remove it</button>
      </div>
    </div>
  `;

  document.getElementById('confirm-cancel').addEventListener('click', () => {
    slot.innerHTML = '';
  });
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    await send('setParamState', { id: record.id, names: [param.name], state: 'strip' });
    render();
  });
}

render().catch((err) => {
  appEl.innerHTML = `<div class="unsupported-msg"><div class="icon">⚠️</div>${escapeHtml(err.message)}</div>`;
});
