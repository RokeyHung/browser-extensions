// dashboard.js — the full-page explorer (spec §6).
// Attaches to one http(s) target tab, lists every storage area in one table and
// edits entries through the right-hand drawer.

const els = {
  origin: document.getElementById('site-origin'),
  tabPicker: document.getElementById('tab-picker'),
  banner: document.getElementById('banner'),
  summary: document.getElementById('summary'),
  tabs: document.getElementById('tabs'),
  search: document.getElementById('search'),
  allOrigins: document.getElementById('all-origins'),
  allOriginsWrap: document.getElementById('all-origins-wrap'),
  resultCount: document.getElementById('result-count'),
  thead: document.getElementById('thead'),
  rows: document.getElementById('rows'),
  empty: document.getElementById('empty'),
  drawer: document.getElementById('drawer'),
  backdrop: document.getElementById('drawer-backdrop'),
  toast: document.getElementById('toast'),
  importFile: document.getElementById('import-file'),
};

const AREAS = [
  { id: 'local', label: 'Local Storage' },
  { id: 'session', label: 'Session Storage' },
  { id: 'cookies', label: 'Cookies' },
  { id: 'idb', label: 'IndexedDB' },
  { id: 'snapshots', label: 'Snapshots' },
];

const esc = (text) => ValueInspect.escapeHtml(text);

const state = {
  tabId: null,
  context: null,
  area: 'local',
  search: '',
  sort: { column: null, direction: 1 },
  data: { local: null, session: null, cookies: null },
  idb: null,
  snapshots: [],
  showAllOrigins: false,
  loading: false,
};

// ─── Messaging ─────────────────────────────────────────────────────────────────

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error || 'Request failed');
  return response.data;
}

function showToast(text, kind) {
  els.toast.textContent = text;
  els.toast.className = 'toast' + (kind ? ' toast-' + kind : '');
  els.toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (els.toast.hidden = true), 4000);
}

function showBanner(text, kind) {
  if (!text) {
    els.banner.hidden = true;
    return;
  }
  els.banner.className = 'banner' + (kind ? ' banner-' + kind : '');
  els.banner.textContent = text;
  els.banner.hidden = false;
}

// ─── Loading ───────────────────────────────────────────────────────────────────

async function loadTabs() {
  const tabs = await send({ type: 'listTabs' });
  els.tabPicker.innerHTML = tabs
    .map((tab) => `<option value="${tab.id}">${esc(tab.hostname)} — ${esc(ValueInspect.preview(tab.title, 45))}</option>`)
    .join('');
  if (tabs.some((tab) => tab.id === state.tabId)) {
    els.tabPicker.value = String(state.tabId);
  } else if (tabs.length) {
    state.tabId = tabs[0].id;
    els.tabPicker.value = String(state.tabId);
  }
  return tabs;
}

async function loadAll() {
  state.loading = true;
  render();
  try {
    const result = await send({ type: 'readAll', tabId: state.tabId });
    state.context = result.context;
    state.data = { local: result.local, session: result.session, cookies: result.cookies };
    state.idb = null; // re-read lazily when the IndexedDB tab is opened
    showBanner(null);
  } catch (err) {
    state.context = null;
    state.data = { local: null, session: null, cookies: null };
    showBanner(err.message, 'error');
    await loadTabs();
  }
  state.snapshots = await send({ type: 'listSnapshots' }).catch(() => []);
  state.loading = false;
  render();
}

async function loadIndexedDB() {
  try {
    state.idb = await send({ type: 'readIndexedDB', tabId: state.tabId });
  } catch (err) {
    state.idb = { ok: false, error: err.message, databases: [] };
  }
  render();
}

// ─── Derived data ──────────────────────────────────────────────────────────────

function areaCount(area) {
  if (area === 'idb') return state.idb?.ok ? state.idb.databases.length : null;
  if (area === 'snapshots') return visibleSnapshots().length;
  return state.data[area]?.entries?.length ?? null;
}

function visibleSnapshots() {
  if (state.showAllOrigins || !state.context) return state.snapshots;
  return state.snapshots.filter((item) => item.origin === state.context.origin);
}

function areaBytes(area) {
  const entries = state.data[area]?.entries || [];
  if (area === 'cookies') {
    return entries.reduce((sum, cookie) => sum + ValueInspect.byteLength(cookie.name) + ValueInspect.byteLength(cookie.value), 0);
  }
  return entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
}

// Rows for the active tab, already filtered and sorted.
function currentRows() {
  const query = state.search.trim().toLowerCase();
  let rows = [];

  if (state.area === 'local' || state.area === 'session') {
    rows = (state.data[state.area]?.entries || []).map((entry) => ({
      ...entry,
      type: ValueInspect.detectType(entry.value),
    }));
    if (query) rows = rows.filter((row) => `${row.key} ${row.value}`.toLowerCase().includes(query));
  } else if (state.area === 'cookies') {
    rows = state.data.cookies?.entries || [];
    if (query) rows = rows.filter((row) => `${row.name} ${row.value} ${row.domain}`.toLowerCase().includes(query));
  } else if (state.area === 'idb') {
    for (const db of state.idb?.databases || []) {
      if (!db.stores.length) {
        rows.push({ db: db.name, version: db.version, store: null, count: null, error: db.error });
        continue;
      }
      for (const store of db.stores) {
        rows.push({ db: db.name, version: db.version, store: store.name, count: store.count });
      }
    }
    if (query) rows = rows.filter((row) => `${row.db} ${row.store || ''}`.toLowerCase().includes(query));
  } else if (state.area === 'snapshots') {
    rows = visibleSnapshots();
    if (query) rows = rows.filter((row) => `${row.name} ${row.origin} ${row.note || ''}`.toLowerCase().includes(query));
  }

  const { column, direction } = state.sort;
  if (column) {
    rows = [...rows].sort((a, b) => {
      const left = a[column] ?? '';
      const right = b[column] ?? '';
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
  }

  return rows;
}

// ─── Render ────────────────────────────────────────────────────────────────────

function render() {
  els.origin.textContent = state.context ? state.context.origin : 'No target tab';
  renderSummary();
  renderTabs();
  renderTable();
  els.allOriginsWrap.hidden = state.area !== 'snapshots';
}

function renderSummary() {
  const cards = [
    { label: 'Local', count: areaCount('local'), sub: ValueInspect.formatSize(areaBytes('local')) },
    { label: 'Session', count: areaCount('session'), sub: ValueInspect.formatSize(areaBytes('session')) },
    { label: 'Cookies', count: areaCount('cookies'), sub: ValueInspect.formatSize(areaBytes('cookies')) },
    { label: 'IndexedDB', count: areaCount('idb'), sub: state.idb ? 'databases' : 'open tab to load' },
    { label: 'Snapshots', count: state.snapshots.length, sub: 'saved' },
  ];

  els.summary.innerHTML = cards
    .map(
      (card) => `
      <div class="sum-card">
        <span class="sum-num">${card.count === null ? '—' : card.count}</span>
        <span class="sum-lbl">${esc(card.label)}</span>
        <span class="sum-sub">${esc(card.sub)}</span>
      </div>`
    )
    .join('');
}

function renderTabs() {
  els.tabs.innerHTML = AREAS.map((area) => {
    const count = areaCount(area.id);
    return `<button class="tab ${state.area === area.id ? 'active' : ''}" data-area="${area.id}">
      ${esc(area.label)} <span class="tab-count">${count === null ? '' : count}</span>
    </button>`;
  }).join('');

  els.tabs.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.area = btn.dataset.area;
      state.sort = { column: null, direction: 1 };
      if (state.area === 'idb' && !state.idb) {
        render();
        loadIndexedDB();
        return;
      }
      render();
    });
  });
}

const COLUMNS = {
  local: [
    { key: 'key', label: 'Key' },
    { key: 'type', label: 'Type' },
    { key: 'size', label: 'Size' },
    { key: 'value', label: 'Value' },
  ],
  cookies: [
    { key: 'name', label: 'Name' },
    { key: 'value', label: 'Value' },
    { key: 'domain', label: 'Domain' },
    { key: 'path', label: 'Path' },
    { key: 'expirationDate', label: 'Expires' },
    { key: 'flags', label: 'Flags' },
  ],
  idb: [
    { key: 'db', label: 'Database' },
    { key: 'version', label: 'Version' },
    { key: 'store', label: 'Object store' },
    { key: 'count', label: 'Records' },
  ],
  snapshots: [
    { key: 'name', label: 'Name' },
    { key: 'origin', label: 'Origin' },
    { key: 'createdAt', label: 'Created' },
    { key: 'contents', label: 'Contents' },
    { key: 'actions', label: '' },
  ],
};

function columnsFor(area) {
  if (area === 'session') return COLUMNS.local;
  return COLUMNS[area] || COLUMNS.local;
}

function renderTable() {
  const columns = columnsFor(state.area);
  els.thead.innerHTML = `<tr>${columns
    .map(
      (col) => `<th data-sort="${col.key}">${esc(col.label)}${state.sort.column === col.key ? (state.sort.direction === 1 ? ' ▲' : ' ▼') : ''}</th>`
    )
    .join('')}</tr>`;

  els.thead.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const column = th.dataset.sort;
      if (column === 'actions' || column === 'flags' || column === 'contents') return;
      state.sort = state.sort.column === column ? { column, direction: -state.sort.direction } : { column, direction: 1 };
      renderTable();
    });
  });

  const rows = currentRows();
  els.resultCount.textContent = state.loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'}`;

  const areaError =
    state.area === 'idb'
      ? state.idb && !state.idb.ok
        ? state.idb.error
        : null
      : state.data[state.area] && state.data[state.area].ok === false
        ? state.data[state.area].error
        : null;

  if (areaError) {
    els.rows.innerHTML = '';
    els.empty.hidden = false;
    els.empty.textContent = areaError;
    return;
  }

  if (!rows.length) {
    els.rows.innerHTML = '';
    els.empty.hidden = false;
    els.empty.textContent = state.loading ? 'Loading…' : emptyMessage();
    return;
  }

  els.empty.hidden = true;
  els.rows.innerHTML = rows.map((row, index) => renderRow(row, index)).join('');

  els.rows.querySelectorAll('tr[data-index]').forEach((tr) => {
    tr.addEventListener('click', (event) => {
      if (event.target.closest('[data-action]')) return;
      openDrawer(rows[Number(tr.dataset.index)]);
    });
  });

  els.rows.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const row = rows[Number(btn.closest('tr').dataset.index)];
      onSnapshotAction(btn.dataset.action, row);
    });
  });
}

function emptyMessage() {
  if (state.area === 'snapshots') return 'No snapshots yet. Use "Save snapshot" to capture the current storage.';
  if (state.area === 'idb') return 'This site has no IndexedDB databases.';
  return 'This area is empty.';
}

function renderRow(row, index) {
  if (state.area === 'local' || state.area === 'session') {
    return `<tr data-index="${index}">
      <td class="key-cell mono">${esc(row.key)}</td>
      <td><span class="type-tag type-${row.type}">${row.type}</span></td>
      <td class="small">${ValueInspect.formatSize(row.size ?? 0)}</td>
      <td class="value-cell mono">${esc(ValueInspect.preview(row.value, 160))}</td>
    </tr>`;
  }

  if (state.area === 'cookies') {
    const flags = [row.secure ? 'S' : '', row.httpOnly ? 'H' : '', row.partitionKey ? 'P' : ''].filter(Boolean).join(' ');
    return `<tr data-index="${index}">
      <td class="key-cell mono">${esc(row.name)}</td>
      <td class="value-cell mono">${esc(ValueInspect.preview(row.value, 80))}</td>
      <td class="small mono">${esc(row.domain)}</td>
      <td class="small mono">${esc(row.path)}</td>
      <td class="small">${esc(ValueInspect.formatCookieExpiry(row))}</td>
      <td class="small mono">${esc(flags)}</td>
    </tr>`;
  }

  if (state.area === 'idb') {
    return `<tr data-index="${index}">
      <td class="key-cell mono">${esc(row.db)}</td>
      <td class="small">${row.version ?? '—'}</td>
      <td class="mono">${row.store ? esc(row.store) : `<span class="muted">${esc(row.error || 'no object stores')}</span>`}</td>
      <td class="small">${row.count ?? '—'}</td>
    </tr>`;
  }

  const contents = [
    row.includes.local ? `${row.stats.local} local` : '',
    row.includes.session ? `${row.stats.session} session` : '',
    row.includes.cookies ? `${row.stats.cookies} cookies` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return `<tr data-index="${index}">
    <td class="key-cell">${esc(row.name)}</td>
    <td class="small mono">${esc(row.origin)}</td>
    <td class="small">${new Date(row.createdAt).toLocaleString()}</td>
    <td class="small">${esc(contents)} <span class="muted">(${ValueInspect.formatSize(row.stats.bytes)})</span></td>
    <td class="row-actions">
      <button class="btn sm btn-primary" data-action="restore">Restore</button>
      <button class="btn sm btn-secondary" data-action="export">Export</button>
      <button class="btn sm btn-danger" data-action="delete">Delete</button>
    </td>
  </tr>`;
}

// ─── Drawer ────────────────────────────────────────────────────────────────────

function closeDrawer() {
  els.drawer.hidden = true;
  els.backdrop.hidden = true;
  els.drawer.innerHTML = '';
}

function openDrawer(row) {
  if (state.area === 'local' || state.area === 'session') return openEntryDrawer(row);
  if (state.area === 'cookies') return openCookieDrawer(row);
  if (state.area === 'idb') return openIdbDrawer(row);
  if (state.area === 'snapshots') return openSnapshotDrawer(row);
}

function drawerShell(title, body) {
  els.drawer.innerHTML = `
    <div class="drawer-head">
      <h2>${esc(title)}</h2>
      <button class="drawer-close" id="drawer-close">✕</button>
    </div>
    ${body}`;
  els.drawer.hidden = false;
  els.backdrop.hidden = false;
  els.drawer.scrollTop = 0;
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
}

function jwtPanel(value) {
  const decoded = ValueInspect.decodeJwt(value);
  if (!decoded) return '';
  const exp = decoded.payload.exp ? `<div class="jwt-exp">exp: ${esc(ValueInspect.formatTimestamp(decoded.payload.exp))}</div>` : '';
  return `
    <div class="jwt-panel">
      <div class="jwt-title">JWT (decoded, signature not verified)</div>
      ${exp}
      <pre class="jwt-body">${esc(JSON.stringify(decoded.payload, null, 2))}</pre>
    </div>`;
}

function openEntryDrawer(row) {
  const isNew = !row;
  const key = row?.key ?? '';
  const value = row?.value ?? '';

  drawerShell(
    isNew ? 'New entry' : 'Edit entry',
    `
    <label class="field">
      <span>Key</span>
      <input type="text" id="f-key" class="mono" value="${esc(key)}" />
    </label>
    <label class="field">
      <span>Value <em id="value-meta">${esc(ValueInspect.detectType(value))} · ${ValueInspect.formatSize(ValueInspect.byteLength(value))}</em></span>
      <textarea id="f-value" class="mono value-input">${esc(value)}</textarea>
    </label>
    <div class="drawer-actions">
      <button class="btn sm btn-secondary" id="a-format">Format JSON</button>
      <button class="btn sm btn-secondary" id="a-minify">Minify</button>
      <button class="btn sm btn-secondary" id="a-copy">Copy value</button>
    </div>
    <div id="jwt-slot">${jwtPanel(value)}</div>
    <div class="drawer-footer">
      <button class="btn btn-primary" id="a-save">Save</button>
      ${isNew ? '' : '<button class="btn btn-danger" id="a-delete">Delete</button>'}
    </div>`
  );

  const keyInput = document.getElementById('f-key');
  const valueInput = document.getElementById('f-value');

  const refreshMeta = () => {
    const current = valueInput.value;
    document.getElementById('value-meta').textContent =
      `${ValueInspect.detectType(current)} · ${ValueInspect.formatSize(ValueInspect.byteLength(current))}`;
    document.getElementById('jwt-slot').innerHTML = jwtPanel(current);
  };
  valueInput.addEventListener('input', refreshMeta);

  document.getElementById('a-format').addEventListener('click', () => {
    const pretty = ValueInspect.prettyJson(valueInput.value);
    if (!pretty) return showToast('Value is not valid JSON.', 'error');
    valueInput.value = pretty;
    refreshMeta();
  });

  document.getElementById('a-minify').addEventListener('click', () => {
    const minified = ValueInspect.minifyJson(valueInput.value);
    if (!minified) return showToast('Value is not valid JSON.', 'error');
    valueInput.value = minified;
    refreshMeta();
  });

  document.getElementById('a-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(valueInput.value);
    showToast('Value copied.', 'success');
  });

  document.getElementById('a-save').addEventListener('click', async () => {
    try {
      await send({
        type: 'setEntry',
        tabId: state.tabId,
        area: state.area,
        key: keyInput.value,
        value: valueInput.value,
        previousKey: isNew ? null : key,
      });
      closeDrawer();
      showToast('Entry saved.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('a-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete "${key}" from ${state.area}Storage?`)) return;
    try {
      await send({ type: 'deleteEntry', tabId: state.tabId, area: state.area, key });
      closeDrawer();
      showToast('Entry deleted.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openCookieDrawer(row) {
  const isNew = !row;
  const cookie = row || {
    name: '',
    value: '',
    domain: state.context?.hostname || '',
    path: '/',
    secure: state.context?.origin.startsWith('https') ?? true,
    httpOnly: false,
    hostOnly: true,
    sameSite: 'lax',
    expirationDate: null,
  };

  const sameSiteOptions = ['unspecified', 'no_restriction', 'lax', 'strict']
    .map((option) => `<option value="${option}" ${cookie.sameSite === option ? 'selected' : ''}>${option}</option>`)
    .join('');

  drawerShell(
    isNew ? 'New cookie' : `Cookie: ${cookie.name}`,
    `
    <label class="field"><span>Name</span><input type="text" id="c-name" class="mono" value="${esc(cookie.name)}" /></label>
    <label class="field"><span>Value</span><textarea id="c-value" class="mono value-input short">${esc(cookie.value)}</textarea></label>
    <div class="field-row">
      <label class="field"><span>Domain</span><input type="text" id="c-domain" class="mono" value="${esc(cookie.domain)}" /></label>
      <label class="field"><span>Path</span><input type="text" id="c-path" class="mono" value="${esc(cookie.path || '/')}" /></label>
    </div>
    <label class="field">
      <span>Expires <em>empty = session cookie</em></span>
      <input type="datetime-local" id="c-expires" value="${ValueInspect.toDatetimeLocal(cookie.expirationDate)}" />
    </label>
    <label class="field"><span>SameSite</span><select id="c-samesite">${sameSiteOptions}</select></label>
    <div class="check-row">
      <label><input type="checkbox" id="c-secure" ${cookie.secure ? 'checked' : ''} /> Secure</label>
      <label><input type="checkbox" id="c-httponly" ${cookie.httpOnly ? 'checked' : ''} /> HttpOnly</label>
      <label><input type="checkbox" id="c-hostonly" ${cookie.hostOnly ? 'checked' : ''} /> Host only</label>
    </div>
    ${jwtPanel(cookie.value)}
    <div class="drawer-footer">
      <button class="btn btn-primary" id="c-save">Save</button>
      ${isNew ? '' : '<button class="btn btn-danger" id="c-delete">Delete</button>'}
    </div>`
  );

  document.getElementById('c-save').addEventListener('click', async () => {
    const next = {
      name: document.getElementById('c-name').value.trim(),
      value: document.getElementById('c-value').value,
      domain: document.getElementById('c-domain').value.trim(),
      path: document.getElementById('c-path').value.trim() || '/',
      secure: document.getElementById('c-secure').checked,
      httpOnly: document.getElementById('c-httponly').checked,
      hostOnly: document.getElementById('c-hostonly').checked,
      sameSite: document.getElementById('c-samesite').value,
      expirationDate: ValueInspect.fromDatetimeLocal(document.getElementById('c-expires').value),
      storeId: cookie.storeId,
      partitionKey: cookie.partitionKey,
    };
    try {
      await send({ type: 'setCookie', tabId: state.tabId, cookie: next, previous: isNew ? null : cookie });
      closeDrawer();
      showToast('Cookie saved.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('c-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete cookie "${cookie.name}"?`)) return;
    try {
      await send({ type: 'deleteCookie', tabId: state.tabId, cookie });
      closeDrawer();
      showToast('Cookie deleted.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function openIdbDrawer(row) {
  drawerShell(`${row.db}${row.store ? ' › ' + row.store : ''}`, '<div class="muted">Loading records…</div>');

  let body = '';
  if (row.store) {
    try {
      const result = await send({ type: 'readIdbStore', tabId: state.tabId, dbName: row.db, storeName: row.store });
      if (!result?.ok) {
        body = `<div class="inline-error">${esc(result?.error || 'Could not read this object store')}</div>`;
      } else if (!result.records.length) {
        body = '<div class="muted">This object store is empty.</div>';
      } else {
        body = `
          ${result.truncated ? '<div class="muted">Showing the first records only.</div>' : ''}
          ${result.records
            .map(
              (record) => `
              <div class="record">
                <div class="record-key mono">${esc(record.key)}</div>
                <pre class="record-value mono">${esc(record.value)}</pre>
              </div>`
            )
            .join('')}`;
      }
    } catch (err) {
      body = `<div class="inline-error">${esc(err.message)}</div>`;
    }
  } else {
    body = `<div class="muted">${esc(row.error || 'This database has no object stores.')}</div>`;
  }

  drawerShell(
    `${row.db}${row.store ? ' › ' + row.store : ''}`,
    `
    <div class="drawer-note">Records are read-only in this version.</div>
    <div class="records">${body}</div>
    <div class="drawer-footer">
      <button class="btn btn-danger" id="idb-delete">Delete database</button>
    </div>`
  );

  document.getElementById('idb-delete').addEventListener('click', async () => {
    if (!confirm(`Delete the whole IndexedDB database "${row.db}"? This cannot be undone.`)) return;
    try {
      const result = await send({ type: 'deleteIdbDatabase', tabId: state.tabId, name: row.db });
      closeDrawer();
      showToast(
        result.blocked ? 'Delete is blocked by another tab holding the database — close it and the delete will finish.' : 'Database deleted.',
        result.blocked ? 'error' : 'success'
      );
      await loadIndexedDB();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openSnapshotDrawer(snapshot) {
  const mismatch = state.context && snapshot.origin !== state.context.origin;

  drawerShell(
    snapshot.name,
    `
    ${mismatch ? `<div class="banner banner-warn">This snapshot is from ${esc(snapshot.origin)} but the target tab is ${esc(state.context.origin)}.</div>` : ''}
    <label class="field"><span>Name</span><input type="text" id="s-name" value="${esc(snapshot.name)}" /></label>
    <label class="field"><span>Note</span><input type="text" id="s-note" value="${esc(snapshot.note || '')}" /></label>
    <dl class="detail-list">
      <dt>Origin</dt><dd class="mono">${esc(snapshot.origin)}</dd>
      <dt>Created</dt><dd>${new Date(snapshot.createdAt).toLocaleString()}</dd>
      <dt>Contents</dt><dd>${snapshot.stats.local} local · ${snapshot.stats.session} session · ${snapshot.stats.cookies} cookies · ${ValueInspect.formatSize(snapshot.stats.bytes)}</dd>
    </dl>

    <div class="section-label">Restore</div>
    <div class="check-row">
      <label><input type="checkbox" id="r-local" ${snapshot.includes.local ? 'checked' : 'disabled'} /> localStorage</label>
      <label><input type="checkbox" id="r-session" ${snapshot.includes.session ? 'checked' : 'disabled'} /> sessionStorage</label>
      <label><input type="checkbox" id="r-cookies" ${snapshot.includes.cookies ? 'checked' : 'disabled'} /> cookies</label>
    </div>
    <label class="field">
      <span>Mode</span>
      <select id="r-mode">
        <option value="merge">Merge — overwrite matching keys, keep the rest</option>
        <option value="replace">Replace — wipe the area first</option>
      </select>
    </label>
    <label class="check-single"><input type="checkbox" id="r-reload" checked /> Reload tab after restore</label>

    <div class="drawer-footer">
      <button class="btn btn-primary" id="s-restore">♻️ Restore</button>
      <button class="btn btn-secondary" id="s-save">Save name</button>
      <button class="btn btn-danger" id="s-delete">Delete</button>
    </div>`
  );

  document.getElementById('s-restore').addEventListener('click', async () => {
    try {
      const report = await send({
        type: 'restoreSnapshot',
        tabId: state.tabId,
        snapshotId: snapshot.id,
        mode: document.getElementById('r-mode').value,
        parts: {
          local: document.getElementById('r-local').checked,
          session: document.getElementById('r-session').checked,
          cookies: document.getElementById('r-cookies').checked,
        },
        reload: document.getElementById('r-reload').checked,
      });
      closeDrawer();
      showToast(restoreSummary(report), report.cookies?.failed?.length ? 'error' : 'success');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('s-save').addEventListener('click', async () => {
    try {
      await send({
        type: 'renameSnapshot',
        snapshotId: snapshot.id,
        name: document.getElementById('s-name').value.trim() || snapshot.name,
        note: document.getElementById('s-note').value,
      });
      closeDrawer();
      showToast('Snapshot updated.', 'success');
      await loadAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('s-delete').addEventListener('click', () => onSnapshotAction('delete', snapshot));
}

function restoreSummary(report) {
  const parts = [];
  if (report.local) parts.push(`${report.local.written} local`);
  if (report.session) parts.push(`${report.session.written} session`);
  if (report.cookies) parts.push(`${report.cookies.written} cookies`);
  const failed = report.cookies?.failed?.length || 0;
  return `Restored ${parts.join(', ') || 'nothing'}${failed ? ` — ${failed} cookie(s) rejected: ${report.cookies.failed[0].error}` : ''}${report.reloaded ? '. Tab reloaded.' : ''}`;
}

// ─── Snapshot row actions ──────────────────────────────────────────────────────

async function onSnapshotAction(action, snapshot) {
  if (action === 'delete') {
    if (!confirm(`Delete snapshot "${snapshot.name}"?`)) return;
    await send({ type: 'deleteSnapshot', snapshotId: snapshot.id });
    closeDrawer();
    showToast('Snapshot deleted.', 'success');
    await loadAll();
    return;
  }

  if (action === 'export') {
    const payload = await send({ type: 'exportSnapshots', snapshotIds: [snapshot.id] });
    downloadJson(payload, `storage-snapshot-${snapshot.hostname}-${snapshot.id}.json`);
    return;
  }

  if (action === 'restore') openSnapshotDrawer(snapshot);
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Toolbar ───────────────────────────────────────────────────────────────────

async function onAdd() {
  if (state.area === 'cookies') return openCookieDrawer(null);
  if (state.area === 'local' || state.area === 'session') return openEntryDrawer(null);
  showToast('Adding entries is only supported for local, session and cookies.', 'error');
}

async function onSnapshotSave() {
  try {
    const snapshot = await send({ type: 'createSnapshot', tabId: state.tabId });
    showToast(`Saved "${snapshot.name}".`, 'success');
    await loadAll();
    state.area = 'snapshots';
    render();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function onExport() {
  if (state.area === 'snapshots') {
    const payload = await send({ type: 'exportSnapshots', snapshotIds: visibleSnapshots().map((item) => item.id) });
    downloadJson(payload, `storage-snapshots-${Date.now()}.json`);
    return;
  }

  const payload = {
    version: '1',
    exportedAt: new Date().toISOString(),
    origin: state.context?.origin,
    area: state.area,
    entries: currentRows(),
  };
  downloadJson(payload, `${state.area}-${state.context?.hostname || 'site'}.json`);
}

async function onImport(file) {
  try {
    const payload = JSON.parse(await file.text());
    const result = await send({ type: 'importSnapshots', payload });
    if (!result.success) throw new Error(result.error);
    showToast(`Imported ${result.added} snapshot(s).`, 'success');
    state.area = 'snapshots';
    await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function onClear() {
  if (state.area === 'idb' || state.area === 'snapshots') {
    showToast('Clear works on local, session and cookies. Delete IndexedDB databases one by one.', 'error');
    return;
  }
  const label = state.area === 'cookies' ? 'cookies for this domain' : `${state.area}Storage`;
  if (!confirm(`Delete all ${label} of ${state.context?.origin}? This cannot be undone.`)) return;

  try {
    const result = await send({ type: 'clearArea', tabId: state.tabId, area: state.area });
    showToast(`Cleared ${result.removed ?? 0} item(s).`, 'success');
    await loadAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Wiring ────────────────────────────────────────────────────────────────────

document.getElementById('refresh').addEventListener('click', loadAll);
document.getElementById('add').addEventListener('click', onAdd);
document.getElementById('snapshot').addEventListener('click', onSnapshotSave);
document.getElementById('export').addEventListener('click', onExport);
document.getElementById('import').addEventListener('click', () => els.importFile.click());
document.getElementById('clear').addEventListener('click', onClear);

els.importFile.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) onImport(file);
  event.target.value = '';
});

els.tabPicker.addEventListener('change', () => {
  state.tabId = Number(els.tabPicker.value);
  loadAll();
});

els.search.addEventListener('input', () => {
  state.search = els.search.value;
  renderTable();
});

els.allOrigins.addEventListener('change', () => {
  state.showAllOrigins = els.allOrigins.checked;
  render();
});

els.backdrop.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.drawer.hidden) closeDrawer();
});

// The target tab may close or navigate while the dashboard is open.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.tabId) {
    showBanner('The target tab was closed. Pick another tab.', 'error');
    loadTabs();
  }
});

async function init() {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tabId'));
  state.tabId = Number.isFinite(tabId) && tabId > 0 ? tabId : null;

  const tabs = await loadTabs();
  if (!state.tabId && tabs.length) state.tabId = tabs[0].id;
  if (!state.tabId) {
    showBanner('No http(s) tab is open. Open a website first, then reload this page.', 'error');
    return;
  }
  await loadAll();
}

init();
