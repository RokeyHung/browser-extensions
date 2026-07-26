// options.js — manage forms, fill and save profiles, settings. Spec §5.4–5.6, §12.5.

const el = (id) => document.getElementById(id);

const EXCLUDED_LABELS = {
  'password-excluded-by-settings': 'excluded — password (enable in Settings)',
  'hidden-excluded-by-settings': 'excluded — hidden field',
  'file-not-supported': 'excluded — file input',
  'sensitive-field': 'excluded — sensitive field',
  'not-visible': 'excluded — not visible',
  disabled: 'excluded — disabled',
  readonly: 'excluded — read-only',
};

let state = {
  forms: [],
  profiles: [],
  settings: {},
  selectedFormId: null,
  editing: null, // { formId, profileId | null }
};

// ─── Utils ────────────────────────────────────────────────────────────────────

function toast(message, isError = false) {
  const node = el('toast');
  node.textContent = message;
  node.classList.toggle('toast-error', isError);
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, 3500);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function usableFields(form) {
  return (form.fields || []).filter((field) => !field.excluded && !field.removed);
}

function showView(name) {
  for (const id of ['formView', 'editorView', 'settingsView', 'placeholderView']) {
    el(id).hidden = id !== name;
  }
}

async function reload() {
  const data = await Store.read();
  state.forms = data.forms;
  state.profiles = data.profiles;
  state.settings = data.settings;
  renderSidebar();
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function renderSidebar() {
  const list = el('sidebarList');
  list.innerHTML = '';
  el('sidebarEmpty').hidden = state.forms.length > 0;

  const bySite = new Map();
  for (const form of state.forms) {
    const key = form.hostname || form.domainPattern;
    if (!bySite.has(key)) bySite.set(key, []);
    bySite.get(key).push(form);
  }

  for (const [site, forms] of [...bySite.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const group = document.createElement('div');
    group.className = 'site-group';

    const heading = document.createElement('div');
    heading.className = 'site-name';
    const profileCount = state.profiles.filter((profile) => forms.some((form) => form.id === profile.formId)).length;
    heading.textContent = `${site} (${forms.length} form, ${profileCount} profile)`;
    group.appendChild(heading);

    for (const form of forms) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'form-item' + (form.id === state.selectedFormId ? ' active' : '');
      item.addEventListener('click', () => selectForm(form.id));

      const title = document.createElement('div');
      title.className = 'form-item-title';
      title.textContent = form.label;

      const meta = document.createElement('div');
      meta.className = 'form-item-meta';
      const count = state.profiles.filter((profile) => profile.formId === form.id).length;
      meta.textContent = `${form.domainPattern} ${form.pathPattern || '*'} · ${usableFields(form).length} fields · ${count} profile`;

      item.append(title, meta);
      group.appendChild(item);
    }
    list.appendChild(group);
  }
}

// ─── Form detail ──────────────────────────────────────────────────────────────

function selectForm(formId) {
  state.selectedFormId = formId;
  state.editing = null;
  renderSidebar();
  renderFormView();
}

function renderFormView() {
  const form = state.forms.find((item) => item.id === state.selectedFormId);
  if (!form) {
    showView('placeholderView');
    return;
  }

  showView('formView');
  el('formLabel').value = form.label;
  el('formSource').textContent = `Captured from ${form.sourceUrl}${form.isOrphan ? ' · fields outside a <form> tag' : ''}`;
  el('schemaWarn').hidden = !form.schemaChanged;
  el('domainPattern').value = form.domainPattern;
  el('pathPattern').value = form.pathPattern || '';
  el('patternError').hidden = true;

  renderProfileTable(form);
  renderFieldTable(form);
}

function renderProfileTable(form) {
  const profiles = state.profiles.filter((profile) => profile.formId === form.id);
  const body = el('profileTableBody');
  body.innerHTML = '';
  el('profileCount').textContent = String(profiles.length);
  el('noProfiles').hidden = profiles.length > 0;
  el('profileTable').hidden = profiles.length === 0;

  for (const profile of profiles) {
    const row = document.createElement('tr');

    const defaultCell = document.createElement('td');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'defaultProfile';
    radio.checked = form.defaultProfileId === profile.id;
    radio.addEventListener('change', async () => {
      await Store.setDefaultProfile(form.id, profile.id);
      await reload();
      renderFormView();
      toast(`"${profile.name}" is now the default profile`);
    });
    defaultCell.appendChild(radio);

    const nameCell = document.createElement('td');
    nameCell.textContent = profile.name;
    if (profile.note) {
      const note = document.createElement('div');
      note.className = 'cell-note';
      note.textContent = profile.note;
      nameCell.appendChild(note);
    }

    const filledCell = document.createElement('td');
    filledCell.textContent = `${Object.keys(profile.values || {}).length} / ${usableFields(form).length}`;

    const usedCell = document.createElement('td');
    usedCell.textContent = String(profile.useCount || 0);

    const lastCell = document.createElement('td');
    lastCell.textContent = formatDate(profile.lastUsedAt);

    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions-cell';
    actionsCell.append(
      actionButton('Edit', () => openEditor(form.id, profile.id)),
      actionButton('Apply to tab', () => applyToTab(profile.id)),
      actionButton('Duplicate', async () => {
        await Store.duplicateProfile(profile.id);
        await reload();
        renderFormView();
        toast('Profile duplicated');
      }),
      actionButton(
        'Delete',
        async () => {
          if (!confirm(`Delete profile "${profile.name}"?`)) return;
          await Store.deleteProfile(profile.id);
          await reload();
          renderFormView();
          toast('Profile deleted');
        },
        'danger'
      )
    );

    row.append(defaultCell, nameCell, filledCell, usedCell, lastCell, actionsCell);
    body.appendChild(row);
  }
}

function actionButton(label, onClick, variant = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `row-btn ${variant}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function renderFieldTable(form) {
  const body = el('fieldTableBody');
  body.innerHTML = '';
  el('fieldCount').textContent = String(usableFields(form).length);

  for (const field of form.fields || []) {
    const row = document.createElement('tr');
    if (field.excluded || field.removed) row.className = 'row-muted';

    const label = document.createElement('td');
    label.textContent = field.labelText;

    const type = document.createElement('td');
    type.textContent = field.kind === 'input' ? `input/${field.type}` : field.kind;

    const name = document.createElement('td');
    name.className = 'mono';
    name.textContent = field.name || '—';

    const status = document.createElement('td');
    if (field.removed) status.textContent = 'removed from form';
    else if (field.excluded) status.textContent = EXCLUDED_LABELS[field.excludedReason] || field.excludedReason;
    else status.textContent = field.required ? 'required' : 'ok';

    row.append(label, type, name, status);
    body.appendChild(row);
  }
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

async function savePatterns() {
  const form = state.forms.find((item) => item.id === state.selectedFormId);
  if (!form) return;

  const domainPattern = el('domainPattern').value.trim();
  const pathPattern = el('pathPattern').value.trim();

  const error = FormMatcher.validateDomainPattern(domainPattern) || FormMatcher.validatePathPattern(pathPattern);
  if (error) {
    el('patternError').textContent = error;
    el('patternError').hidden = false;
    return;
  }

  await Store.updateForm(form.id, {
    domainPattern,
    pathPattern: pathPattern || null,
    label: el('formLabel').value.trim() || form.label,
  });
  await reload();
  renderFormView();
  toast('Patterns saved');
}

// ─── Profile editor ───────────────────────────────────────────────────────────

function openEditor(formId, profileId) {
  state.editing = { formId, profileId: profileId || null };
  const form = state.forms.find((item) => item.id === formId);
  const profile = profileId ? state.profiles.find((item) => item.id === profileId) : null;

  showView('editorView');
  el('editorError').hidden = true;
  el('editorFormInfo').textContent = `${form.label} · ${form.domainPattern} ${form.pathPattern || '*'} · ${usableFields(form).length} fields`;
  el('profileName').value = profile?.name || '';
  el('profileNote').value = profile?.note || '';
  el('profileDefault').checked = profile ? form.defaultProfileId === profile.id : !form.defaultProfileId;

  renderEditorFields(form, profile);
}

// Render the captured snapshot back as a real form to fill in. Spec §5.5.
function renderEditorFields(form, profile) {
  const container = el('editorFields');
  container.innerHTML = '';
  const values = profile?.values || {};

  for (const field of form.fields || []) {
    const wrapper = document.createElement('div');
    wrapper.className = 'editor-field';

    const label = document.createElement('div');
    label.className = 'editor-label';
    label.textContent = field.labelText;

    const meta = document.createElement('span');
    meta.className = 'editor-meta';
    const typeText = field.kind === 'input' ? `input/${field.type}` : field.kind;
    meta.textContent = `${typeText}${field.name ? `, name="${field.name}"` : ''}${field.required ? ', required' : ''}`;
    label.appendChild(meta);
    wrapper.appendChild(label);

    if (field.excluded || field.removed) {
      const note = document.createElement('div');
      note.className = 'editor-excluded';
      note.textContent = field.removed
        ? 'This field is no longer in the form — its value is kept but skipped when applying.'
        : EXCLUDED_LABELS[field.excludedReason] || field.excludedReason;
      wrapper.appendChild(note);
      container.appendChild(wrapper);
      continue;
    }

    wrapper.appendChild(buildInput(field, values[field.fieldId]));
    container.appendChild(wrapper);
  }
}

function buildInput(field, value) {
  const setId = (node) => {
    node.dataset.fieldId = field.fieldId;
    return node;
  };

  if (field.kind === 'select') {
    const select = setId(document.createElement('select'));
    select.className = 'input';
    select.multiple = field.type === 'select-multiple';
    if (select.multiple) select.size = Math.min(6, (field.options || []).length || 2);
    else select.append(new Option('— not set —', ''));

    const stored = Array.isArray(value) ? value : value != null ? [value] : [];
    const storedValues = stored.map((item) => (item && typeof item === 'object' ? item.value : item)).map(String);

    for (const option of field.options || []) {
      const node = new Option(option.label, option.value);
      node.selected = storedValues.includes(String(option.value));
      select.appendChild(node);
    }
    return select;
  }

  if (field.kind === 'radio') {
    const group = document.createElement('div');
    group.className = 'radio-group';
    group.dataset.fieldId = field.fieldId;
    for (const option of field.options || []) {
      const row = document.createElement('label');
      row.className = 'radio-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `radio_${field.fieldId}`;
      radio.value = option.value;
      radio.checked = String(value ?? '') === String(option.value);
      const text = document.createElement('span');
      text.textContent = option.label;
      row.append(radio, text);
      group.appendChild(row);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'row-btn';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      group.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.checked = false;
      });
    });
    group.appendChild(clear);
    return group;
  }

  if (field.type === 'checkbox') {
    const row = document.createElement('label');
    row.className = 'check';
    const input = setId(document.createElement('input'));
    input.type = 'checkbox';
    input.checked = value === true;
    const text = document.createElement('span');
    text.textContent = 'checked';
    row.append(input, text);
    return row;
  }

  if (field.kind === 'textarea' || field.kind === 'contenteditable') {
    const textarea = setId(document.createElement('textarea'));
    textarea.className = 'input';
    textarea.rows = 3;
    textarea.value = value != null ? String(value) : '';
    textarea.placeholder = field.placeholder || '';
    return textarea;
  }

  const input = setId(document.createElement('input'));
  input.className = 'input';
  // Keep the native type for pickers (date, color…) but never render a real
  // password box — the value must stay readable in the editor.
  input.type = field.type === 'password' ? 'text' : field.type || 'text';
  input.value = value != null ? String(value) : '';
  input.placeholder = field.placeholder || '';
  return input;
}

// Read the editor back into a values object keyed by fieldId. Spec §8.2.
function collectValues(form) {
  const values = {};

  for (const field of form.fields || []) {
    if (field.excluded || field.removed) continue;

    if (field.kind === 'radio') {
      const checked = document.querySelector(`input[name="radio_${field.fieldId}"]:checked`);
      if (checked) values[field.fieldId] = checked.value;
      continue;
    }

    const node = document.querySelector(`[data-field-id="${field.fieldId}"]`);
    if (!node) continue;

    if (field.kind === 'select') {
      const selected = Array.from(node.selectedOptions).filter((option) => option.value !== '');
      if (!selected.length) continue;
      if (field.type === 'select-multiple') {
        values[field.fieldId] = selected.map((option) => ({ value: option.value, label: option.textContent }));
      } else {
        values[field.fieldId] = { value: selected[0].value, label: selected[0].textContent };
      }
      continue;
    }

    if (field.type === 'checkbox') {
      values[field.fieldId] = node.checked;
      continue;
    }

    if (node.value !== '') values[field.fieldId] = node.value;
  }

  return values;
}

async function saveProfile() {
  const { formId, profileId } = state.editing;
  const form = state.forms.find((item) => item.id === formId);
  const name = el('profileName').value.trim();

  if (!name) {
    el('editorError').textContent = 'Profile name is required';
    el('editorError').hidden = false;
    return null;
  }

  const payload = {
    name,
    note: el('profileNote').value.trim(),
    values: collectValues(form),
    isDefault: el('profileDefault').checked,
  };

  let saved;
  if (profileId) {
    saved = await Store.updateProfile(profileId, payload);
    if (payload.isDefault) await Store.setDefaultProfile(formId, profileId);
    else if (form.defaultProfileId === profileId) await Store.setDefaultProfile(formId, null);
  } else {
    saved = await Store.createProfile(formId, payload);
  }

  await reload();
  state.selectedFormId = formId;
  state.editing = { formId, profileId: saved.id };
  toast(`Profile "${saved.name}" saved`);
  return saved;
}

async function applyToTab(profileId) {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'applyProfileToActiveTab', profileId });
    if (!response?.success) throw new Error(response?.error || 'Apply failed');
    const { counts } = response.data;
    toast(`Filled ${counts.filled} field(s) · not found ${counts.notFound} · skipped ${counts.skipped}`);
    await reload();
  } catch (err) {
    toast(err.message, true);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function renderSettings() {
  showView('settingsView');
  el('setShowApplyResult').checked = !!state.settings.showApplyResult;
  el('setDispatchEvents').checked = !!state.settings.dispatchEvents;
  el('setRetry').checked = !!state.settings.retryDynamicForms;
  el('setRetryWindow').value = String(state.settings.retryWindowMs ?? 3000);
  el('setIncludePassword').checked = !!state.settings.includePasswordFields;
  el('setIncludeHidden').checked = !!state.settings.includeHiddenFields;
}

async function saveSettingsFromForm() {
  state.settings = await Store.saveSettings({
    showApplyResult: el('setShowApplyResult').checked,
    dispatchEvents: el('setDispatchEvents').checked,
    retryDynamicForms: el('setRetry').checked,
    retryWindowMs: Math.max(0, Number(el('setRetryWindow').value) || 0),
    includePasswordFields: el('setIncludePassword').checked,
    includeHiddenFields: el('setIncludeHidden').checked,
  });
  toast('Settings saved');
}

// ─── Export / import ──────────────────────────────────────────────────────────

async function exportAll(formIds) {
  const payload = await Store.exportData(formIds);
  if (!payload.forms.length) {
    toast('Nothing to export', true);
    return;
  }
  if (Exporter.containsPasswordValue(payload)) {
    const proceed = confirm('This export contains password field values in plain text. Continue?');
    if (!proceed) return;
  }
  Exporter.download(payload);
  toast(`Exported ${payload.forms.length} form(s), ${payload.profiles.length} profile(s)`);
}

async function importFromFile(file) {
  try {
    const payload = await Exporter.readFile(file);
    const error = Store.validateImport(payload);
    if (error) throw new Error(error);

    const answer = prompt(
      'Existing forms with the same pattern: type "merge" to add profiles, "replace" to overwrite, "skip" to keep them as they are.',
      'merge'
    );
    if (answer === null) return;
    const strategy = ['merge', 'replace', 'skip'].includes(answer.trim()) ? answer.trim() : 'merge';

    const result = await Store.importData(payload, strategy);
    if (!result.success) throw new Error(result.error);

    await reload();
    const { stats } = result;
    toast(
      `Imported: ${stats.formsAdded} new form(s), ${stats.formsMerged} merged, ${stats.formsReplaced} replaced, ` +
        `${stats.formsSkipped} skipped, ${stats.profilesAdded} profile(s)`
    );
  } catch (err) {
    toast(err.message, true);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function wire() {
  el('btnSettings').addEventListener('click', renderSettings);
  el('btnCloseSettings').addEventListener('click', () => {
    if (state.selectedFormId) renderFormView();
    else showView('placeholderView');
  });
  el('btnExport').addEventListener('click', () => exportAll(null));
  el('btnImport').addEventListener('click', () => el('importFile').click());
  el('importFile').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (file) await importFromFile(file);
    event.target.value = '';
  });

  el('btnSavePatterns').addEventListener('click', savePatterns);
  el('btnExportForm').addEventListener('click', () => exportAll([state.selectedFormId]));
  el('btnAddProfile').addEventListener('click', () => openEditor(state.selectedFormId, null));
  el('btnDeleteForm').addEventListener('click', async () => {
    const form = state.forms.find((item) => item.id === state.selectedFormId);
    if (!form || !confirm(`Delete form "${form.label}" and all of its profiles?`)) return;
    await Store.deleteForm(form.id);
    state.selectedFormId = null;
    await reload();
    showView('placeholderView');
    toast('Form deleted');
  });

  el('btnSaveProfile').addEventListener('click', async () => {
    const saved = await saveProfile();
    if (saved) renderFormView();
  });
  el('btnSaveApply').addEventListener('click', async () => {
    const saved = await saveProfile();
    if (saved) await applyToTab(saved.id);
  });
  el('btnCancelEdit').addEventListener('click', () => {
    state.editing = null;
    renderFormView();
  });

  for (const id of ['setShowApplyResult', 'setDispatchEvents', 'setRetry', 'setIncludePassword', 'setIncludeHidden']) {
    el(id).addEventListener('change', saveSettingsFromForm);
  }
  el('setRetryWindow').addEventListener('change', saveSettingsFromForm);

  el('btnClearAll').addEventListener('click', async () => {
    if (!confirm('Delete every saved form and profile? This cannot be undone.')) return;
    await Store.clearAll();
    state.selectedFormId = null;
    await reload();
    showView('placeholderView');
    toast('All data deleted');
  });
}

async function init() {
  wire();
  await reload();

  // Opened right after a capture: jump straight into the new profile editor.
  const params = new URLSearchParams(location.search);
  const formId = params.get('formId');
  if (formId && state.forms.some((form) => form.id === formId)) {
    state.selectedFormId = formId;
    renderSidebar();
    if (params.get('new') === '1') openEditor(formId, null);
    else renderFormView();
    return;
  }

  showView('placeholderView');
}

document.addEventListener('DOMContentLoaded', init);
