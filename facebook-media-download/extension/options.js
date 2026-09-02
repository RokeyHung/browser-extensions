// options.js — the seven settings of spec §12, plus the diagnostics report of
// §9.4.
//
// Every control writes on change, one key at a time; Settings.save serialises
// them so two quick edits cannot overwrite each other (spec §14).

const TOKENS = ['author', 'handle', 'postId', 'mediaId', 'index', 'date', 'datetime', 'type', 'quality', 'surface'];

// What the preview is rendered against. Deliberately a post with an accented
// name and a long id: those are the cases where a pattern surprises people.
const SAMPLE_POST = {
  author: 'Nguyễn Văn A',
  handle: 'nguyenvana',
  postId: '9876543210',
  createdAt: '2026-08-31T14:22:00Z',
  surface: 'feed',
};
const SAMPLE_MEDIA = { mediaId: '1234567890123456', kind: 'image', index: 1, ext: 'jpg', key: 'id:1234567890123456' };

const el = (id) => document.getElementById(id);

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

let flashTimer = null;
function flash(text) {
  const node = el('flash');
  node.textContent = text || 'Saved';
  node.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (node.hidden = true), 1400);
}

function renderPreview() {
  const filename = globalThis.Filename.build({
    pattern: el('pattern').value,
    subfolder: el('subfolder').value,
    post: SAMPLE_POST,
    media: SAMPLE_MEDIA,
  });
  el('preview').textContent = `Downloads/${filename}`;
}

function renderTokens() {
  el('tokens').textContent = TOKENS.map((token) => `{${token}}`).join('  ');
}

function apply(settings) {
  el('pattern').value = settings.filenamePattern;
  el('subfolder').value = settings.subfolder;
  el('downloadPoster').checked = settings.downloadPoster;
  el('markDownloaded').checked = settings.markDownloaded;
  el('notifyOnComplete').checked = settings.notifyOnComplete;
  el('historyLimit').value = String(settings.historyLimit);
  for (const radio of document.querySelectorAll('input[name="videoQuality"]')) radio.checked = radio.value === settings.videoQuality;
  renderPreview();
  renderHistoryNote(settings);
}

// Turning history off also turns the marks off. Saying so here is cheaper than
// letting the user discover it by watching the checks disappear (spec §17).
function renderHistoryNote(settings) {
  el('historyNote').textContent = settings.historyLimit
    ? ''
    : 'With history off there is nothing to compare against, so saved media is no longer marked.';
  el('markDownloaded').disabled = !settings.historyLimit;
}

async function save(patch) {
  const response = await send({ type: 'saveSettings', patch });
  if (response && response.success) {
    apply(response.data);
    flash();
  }
}

// ─── Wiring ────────────────────────────────────────────────────────────────────

let patternTimer = null;
for (const field of ['pattern', 'subfolder']) {
  el(field).addEventListener('input', () => {
    renderPreview();
    // Typing a pattern character by character should not mean a storage write
    // per keystroke.
    clearTimeout(patternTimer);
    patternTimer = setTimeout(() => {
      save(field === 'pattern' ? { filenamePattern: el('pattern').value } : { subfolder: el('subfolder').value });
    }, 500);
  });
}

for (const radio of document.querySelectorAll('input[name="videoQuality"]')) {
  radio.addEventListener('change', () => save({ videoQuality: radio.value }));
}

el('downloadPoster').addEventListener('change', () => save({ downloadPoster: el('downloadPoster').checked }));
el('markDownloaded').addEventListener('change', () => save({ markDownloaded: el('markDownloaded').checked }));
el('historyLimit').addEventListener('change', () => save({ historyLimit: Number(el('historyLimit').value) }));

// Notifications are an optional permission, so the toggle has to ask for it
// rather than assume it. Denying the prompt leaves the toggle off, which is the
// truthful state.
el('notifyOnComplete').addEventListener('change', async () => {
  const wanted = el('notifyOnComplete').checked;
  if (!wanted) {
    await save({ notifyOnComplete: false });
    await chrome.permissions.remove({ permissions: ['notifications'] }).catch(() => null);
    return;
  }
  const granted = await chrome.permissions.request({ permissions: ['notifications'] }).catch(() => false);
  if (!granted) {
    el('notifyOnComplete').checked = false;
    flash('Notification permission denied');
    return;
  }
  await save({ notifyOnComplete: true });
});

el('reset').addEventListener('click', async () => {
  const response = await send({ type: 'resetSettings' });
  if (response && response.success) {
    apply(response.data);
    flash('Reset');
  }
});

el('clearHistory').addEventListener('click', async () => {
  if (!confirm('Delete every entry in the download history? The files stay on disk.')) return;
  await send({ type: 'clearHistory' });
  flash('History cleared');
});

el('runDiagnostics').addEventListener('click', async () => {
  const report = el('report');
  report.hidden = false;
  report.textContent = 'Running…';

  const response = await send({ type: 'runDiagnostics', tabId: null });
  if (!response || !response.success) {
    report.textContent = (response && response.error) || 'Could not reach a Facebook tab.';
    return;
  }

  const data = response.data;
  const anchors = Object.entries(data.anchors)
    .map(([name, count]) => `${name} ${count}`)
    .join(' · ');
  const counts = data.harvest.counts;

  report.textContent = [
    `Page       ${data.url}`,
    `Anchors    ${anchors}`,
    `Harvest    graphql ${counts.graphql} · embedded ${counts.embedded} · dom ${counts.dom} · groups ${data.harvest.groups}`,
    `Media      ${data.eligibleMedia} eligible element(s) on screen`,
    `Last error ${data.harvest.lastError || 'none'}`,
    `Extension  ${data.extensionVersion}`,
  ].join('\n');
});

(async function init() {
  renderTokens();
  const response = await send({ type: 'getSettings' });
  apply(response && response.success ? response.data : globalThis.Settings.DEFAULTS);
})();
