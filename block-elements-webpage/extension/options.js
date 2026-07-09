// options.js

let allRules = [];
let editingRule = null;
let deletingRule = null;

const searchInput = document.getElementById('search-input');
const rulesContainer = document.getElementById('rules-container');
const statsLabel = document.getElementById('stats-label');

// ─── Load ──────────────────────────────────────────────────────────────────────

async function loadRules() {
  allRules = (await chrome.runtime.sendMessage({ type: 'getRules' })) || [];
  renderRules();
}

// ─── Render ────────────────────────────────────────────────────────────────────

function renderRules() {
  const query = searchInput.value.toLowerCase().trim();
  const filtered = query
    ? allRules.filter((r) => r.domainPattern.toLowerCase().includes(query) || r.selector.toLowerCase().includes(query))
    : allRules;

  statsLabel.textContent = `${filtered.length} of ${allRules.length} filter${allRules.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    rulesContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>${allRules.length === 0 ? 'No filters yet.<br>Use the extension on any website to block elements.' : 'No filters match your search.'}</p>
      </div>
    `;
    return;
  }

  const tableHTML = `
    <table class="rules-table">
      <thead>
        <tr>
          <th>Status</th>
          <th>Domain pattern</th>
          <th>Selector</th>
          <th>Action</th>
          <th>Created from</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map((rule) => renderRuleRow(rule)).join('')}
      </tbody>
    </table>
  `;

  rulesContainer.innerHTML = tableHTML;

  rulesContainer.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      const rule = allRules.find((r) => r.id === id);
      if (!rule) return;

      if (action === 'toggle') toggleRule(rule);
      else if (action === 'edit') openEdit(rule);
      else if (action === 'delete') openDelete(rule);
    });
  });
}

function renderRuleRow(rule) {
  const ruleStr = `${rule.domainPattern}##${rule.selector}`;
  let fromDisplay = '—';
  if (rule.createdFromUrl) {
    try {
      const u = new URL(rule.createdFromUrl);
      const path = u.pathname.length > 1 ? u.pathname.slice(0, 30) : '';
      fromDisplay = u.hostname + path;
    } catch {
      fromDisplay = rule.createdFromUrl.slice(0, 40);
    }
  }

  return `
    <tr class="${rule.enabled ? '' : 'disabled-row'}">
      <td>
        <span class="badge ${rule.enabled ? 'badge-enabled' : 'badge-disabled'}">
          ${rule.enabled ? '✓ Active' : '✕ Off'}
        </span>
      </td>
      <td class="td-domain">${escapeHtml(rule.domainPattern)}</td>
      <td class="td-selector">${escapeHtml(rule.selector)}</td>
      <td>Hide</td>
      <td class="td-from" title="${escapeHtml(rule.createdFromUrl || '')}">
        ${escapeHtml(fromDisplay)}
      </td>
      <td class="td-actions">
        <button class="icon-btn" data-action="toggle" data-id="${rule.id}" title="${rule.enabled ? 'Disable' : 'Enable'}">
          ${rule.enabled ? '⏸' : '▶'}
        </button>
        <button class="icon-btn" data-action="edit" data-id="${rule.id}" title="Edit">✏️</button>
        <button class="icon-btn danger" data-action="delete" data-id="${rule.id}" title="Delete">🗑️</button>
      </td>
    </tr>
  `;
}

// ─── Toggle ────────────────────────────────────────────────────────────────────

async function toggleRule(rule) {
  const updated = { ...rule, enabled: !rule.enabled };
  await chrome.runtime.sendMessage({ type: 'updateRule', rule: updated });
  const idx = allRules.findIndex((r) => r.id === rule.id);
  if (idx !== -1) allRules[idx] = updated;
  renderRules();
}

// ─── Edit modal ────────────────────────────────────────────────────────────────

const editModal = document.getElementById('edit-modal');
const editDomain = document.getElementById('edit-domain');
const editSelector = document.getElementById('edit-selector');
const editHideMode = document.getElementById('edit-hidemode');
const editEnabled = document.getElementById('edit-enabled');

function openEdit(rule) {
  editingRule = rule;
  editDomain.value = rule.domainPattern;
  editSelector.value = rule.selector;
  editHideMode.value = rule.hideMode || 'display-none';
  editEnabled.checked = rule.enabled;
  editModal.style.display = 'flex';
}

function closeEdit() {
  editModal.style.display = 'none';
  editingRule = null;
}

document.getElementById('edit-close').addEventListener('click', closeEdit);
document.getElementById('edit-cancel').addEventListener('click', closeEdit);

document.getElementById('edit-save').addEventListener('click', async () => {
  if (!editingRule) return;

  const selector = editSelector.value.trim();
  if (!selector) {
    editSelector.focus();
    return;
  }

  const updated = {
    ...editingRule,
    domainPattern: editDomain.value.trim() || editingRule.domainPattern,
    selector,
    hideMode: editHideMode.value,
    enabled: editEnabled.checked,
  };

  await chrome.runtime.sendMessage({ type: 'updateRule', rule: updated });
  const idx = allRules.findIndex((r) => r.id === editingRule.id);
  if (idx !== -1) allRules[idx] = updated;
  closeEdit();
  renderRules();
});

// ─── Delete modal ──────────────────────────────────────────────────────────────

const deleteModal = document.getElementById('delete-modal');
const deleteRuleStr = document.getElementById('delete-rule-str');

function openDelete(rule) {
  deletingRule = rule;
  deleteRuleStr.textContent = `${rule.domainPattern}##${rule.selector}`;
  deleteModal.style.display = 'flex';
}

function closeDelete() {
  deleteModal.style.display = 'none';
  deletingRule = null;
}

document.getElementById('delete-close').addEventListener('click', closeDelete);
document.getElementById('delete-cancel').addEventListener('click', closeDelete);

document.getElementById('delete-confirm').addEventListener('click', async () => {
  if (!deletingRule) return;
  await chrome.runtime.sendMessage({ type: 'deleteRule', ruleId: deletingRule.id });
  allRules = allRules.filter((r) => r.id !== deletingRule.id);
  closeDelete();
  renderRules();
});

// Close modals on backdrop click
[editModal, deleteModal].forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      editModal.style.display = 'none';
      deleteModal.style.display = 'none';
    }
  });
});

// ─── Search ────────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', renderRules);

// ─── Filter by site from URL param ────────────────────────────────────────────

const urlParams = new URLSearchParams(location.search);
const siteFilter = urlParams.get('site');
if (siteFilter) {
  searchInput.value = siteFilter;
}

// ─── Clear All ────────────────────────────────────────────────────────────────

const clearModal = document.getElementById('clear-modal');
const clearCount = document.getElementById('clear-count');

document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (allRules.length === 0) return;
  clearCount.textContent = `${allRules.length} filter${allRules.length !== 1 ? 's' : ''}`;
  clearModal.style.display = 'flex';
});

function closeClearModal() {
  clearModal.style.display = 'none';
}

document.getElementById('clear-close').addEventListener('click', closeClearModal);
document.getElementById('clear-cancel').addEventListener('click', closeClearModal);
clearModal.addEventListener('click', (e) => {
  if (e.target === clearModal) closeClearModal();
});

document.getElementById('clear-confirm').addEventListener('click', async () => {
  await chrome.storage.local.set({ rules: [] });
  allRules = [];
  closeClearModal();
  renderRules();
});

// ─── Export ────────────────────────────────────────────────────────────────────

const exportDropdown = document.getElementById('export-dropdown');

document.getElementById('btn-export').addEventListener('click', (e) => {
  e.stopPropagation();
  exportDropdown.classList.toggle('open');
});

document.addEventListener('click', () => exportDropdown.classList.remove('open'));

document.getElementById('export-json').addEventListener('click', () => {
  exportDropdown.classList.remove('open');
  const payload = {
    version: '1',
    exportedAt: new Date().toISOString(),
    rules: allRules,
  };
  downloadFile('element-filter-rules.json', JSON.stringify(payload, null, 2), 'application/json');
});

document.getElementById('export-text').addEventListener('click', () => {
  exportDropdown.classList.remove('open');
  const lines = [
    '# Element Filter rules',
    `# Exported: ${new Date().toISOString()}`,
    `# Total: ${allRules.length} rule(s)`,
    '',
    ...allRules.map((r) => {
      const prefix = r.enabled ? '' : '# [disabled] ';
      return `${prefix}${r.domainPattern}##${r.selector}`;
    }),
  ];
  downloadFile('element-filter-rules.txt', lines.join('\n'), 'text/plain');
});

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Import ────────────────────────────────────────────────────────────────────

const importFileInput = document.getElementById('import-file-input');
const importModal = document.getElementById('import-modal');
const importModalBody = document.getElementById('import-modal-body');

let pendingImportRules = [];

document.getElementById('btn-import').addEventListener('click', () => {
  importFileInput.value = '';
  importFileInput.click();
});

importFileInput.addEventListener('change', () => {
  const file = importFileInput.files[0];
  if (!file) return;
  readAndParseFile(file);
});

function readAndParseFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    try {
      const parsed = parseImport(text, file.name);
      showImportPreview(parsed);
    } catch (err) {
      showImportError(err.message);
    }
  };
  reader.readAsText(file);
}

function parseImport(text, filename) {
  // Try JSON first
  if (filename.endsWith('.json') || text.trimStart().startsWith('{')) {
    const data = JSON.parse(text);
    if (!data.rules || !Array.isArray(data.rules)) {
      throw new Error('Invalid JSON format. Expected { "rules": [...] }');
    }
    return data.rules
      .filter((r) => r.domainPattern && r.selector)
      .map((r) => ({ domainPattern: r.domainPattern, selector: r.selector, enabled: r.enabled !== false, hideMode: r.hideMode || 'display-none' }));
  }

  // Parse as adblock-style text
  const results = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^(.+?)##(.+)$/);
    if (!match) continue;

    results.push({ domainPattern: match[1].trim(), selector: match[2].trim(), enabled: true, hideMode: 'display-none' });
  }

  if (results.length === 0) {
    throw new Error('No valid rules found in the file. Expected format: domain##selector');
  }

  return results;
}

function showImportPreview(parsed) {
  // Classify each parsed rule: new vs duplicate
  const existingKeys = new Set(allRules.map((r) => `${r.domainPattern}##${r.selector}`));

  pendingImportRules = parsed.map((r) => ({
    ...r,
    isDuplicate: existingKeys.has(`${r.domainPattern}##${r.selector}`),
  }));

  const newCount = pendingImportRules.filter((r) => !r.isDuplicate).length;
  const skipCount = pendingImportRules.filter((r) => r.isDuplicate).length;

  importModalBody.innerHTML = `
    <p class="import-summary">
      Found <strong>${pendingImportRules.length}</strong> rule(s) —
      <strong>${newCount}</strong> new, <strong>${skipCount}</strong> duplicate(s) will be skipped.
    </p>
    <div class="import-preview">
      ${pendingImportRules
        .map((r) => {
          const tag = r.isDuplicate ? '<span class="import-tag import-tag-skip">SKIP</span>' : '<span class="import-tag import-tag-new">NEW</span>';
          return `<div class="import-preview-item">${tag} ${escapeHtml(r.domainPattern)}##${escapeHtml(r.selector)}</div>`;
        })
        .join('')}
    </div>
  `;

  document.getElementById('import-confirm').disabled = newCount === 0;
  importModal.style.display = 'flex';
}

function showImportError(msg) {
  pendingImportRules = [];
  importModalBody.innerHTML = `<div class="import-error-msg">⚠ ${escapeHtml(msg)}</div>`;
  document.getElementById('import-confirm').disabled = true;
  importModal.style.display = 'flex';
}

function closeImportModal() {
  importModal.style.display = 'none';
  pendingImportRules = [];
}

document.getElementById('import-close').addEventListener('click', closeImportModal);
document.getElementById('import-cancel').addEventListener('click', closeImportModal);
importModal.addEventListener('click', (e) => {
  if (e.target === importModal) closeImportModal();
});

document.getElementById('import-confirm').addEventListener('click', async () => {
  const toAdd = pendingImportRules.filter((r) => !r.isDuplicate);
  if (toAdd.length === 0) {
    closeImportModal();
    return;
  }

  const now = new Date().toISOString();
  const newRules = toAdd.map((r) => ({
    id: 'rule_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
    enabled: r.enabled,
    domainPattern: r.domainPattern,
    pathPattern: null,
    selector: r.selector,
    action: 'hide',
    hideMode: r.hideMode || 'display-none',
    createdFromUrl: null,
    createdAt: now,
    updatedAt: now,
    matchedCountAtCreation: null,
  }));

  // Save all at once via background
  const { rules: existing = [] } = await chrome.storage.local.get('rules');
  await chrome.storage.local.set({ rules: [...existing, ...newRules] });

  allRules = [...allRules, ...newRules];
  closeImportModal();
  renderRules();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Init ──────────────────────────────────────────────────────────────────────

loadRules();
