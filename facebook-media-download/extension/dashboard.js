// dashboard.js — the download history (spec §17).
//
// Rows are metadata: what was saved, from which post, how big, when. The point of
// the page is answering "did I already save this, and where did it come from" —
// and giving a way to try again when a link was still alive.

const PAGE_SIZE = 50;

const el = (id) => document.getElementById(id);
let offset = 0;
let query = '';
let total = 0;

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

let flashTimer = null;
function flash(text) {
  const node = el('flash');
  node.textContent = text;
  node.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (node.hidden = true), 2600);
}

function rowHtml(entry) {
  const warnings = (entry.warnings || []).filter(Boolean);
  return `
    <div class="entry" data-key="${escapeHtml(entry.key)}">
      <span class="badge ${entry.kind === 'video' ? 'is-video' : 'is-photo'}">${entry.kind === 'video' ? 'VIDEO' : 'PHOTO'}</span>
      <div class="entry-main">
        <div class="entry-name">${escapeHtml(entry.filename)}</div>
        <div class="entry-meta">
          ${escapeHtml(entry.author || 'unknown')} · ${formatDate(entry.downloadedAt)}
          ${entry.bytes ? ` · ${formatBytes(entry.bytes)}` : ''}${entry.quality ? ` · ${escapeHtml(entry.quality)}` : ''}
        </div>
        ${warnings.length ? `<div class="entry-warning">${escapeHtml(warnings.join(' '))}</div>` : ''}
      </div>
      <div class="entry-actions">
        ${entry.postUrl ? `<a class="link" href="${escapeHtml(entry.postUrl)}" target="_blank" rel="noreferrer">Open post</a>` : ''}
        <button class="link" data-action="redownload" type="button">Save again</button>
        <button class="link danger" data-action="remove" type="button">Remove</button>
      </div>
    </div>
  `;
}

async function load() {
  const response = await send({ type: 'listHistory', offset, limit: PAGE_SIZE, query });
  const data = response && response.success ? response.data : { items: [], total: 0 };
  total = data.total;

  el('list').innerHTML = data.items.length
    ? data.items.map(rowHtml).join('')
    : '<p class="empty">Nothing here yet. Save a photo or a video and it will show up.</p>';

  el('count').textContent = total ? `${total} entr${total === 1 ? 'y' : 'ies'}` : '';
  el('range').textContent = total ? `${Math.min(offset + 1, total)}–${Math.min(offset + PAGE_SIZE, total)} of ${total}` : '';
  el('prev').disabled = offset === 0;
  el('next').disabled = offset + PAGE_SIZE >= total;
}

el('list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const key = button.closest('.entry').getAttribute('data-key');

  if (button.dataset.action === 'remove') {
    await send({ type: 'removeHistory', key });
    load();
    return;
  }

  button.disabled = true;
  button.textContent = 'Saving…';
  const response = await send({ type: 'redownload', key });
  button.disabled = false;
  button.textContent = 'Save again';
  // A stored link is often past its expiry by now; that is a fact about
  // Facebook's CDN, not a failure to hide (spec §16.4).
  flash(response && response.success ? 'Saved again.' : (response && response.error) || 'Could not save it again.');
});

let searchTimer = null;
el('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = el('search').value;
    offset = 0;
    load();
  }, 250);
});

el('prev').addEventListener('click', () => {
  offset = Math.max(0, offset - PAGE_SIZE);
  load();
});

el('next').addEventListener('click', () => {
  if (offset + PAGE_SIZE < total) offset += PAGE_SIZE;
  load();
});

el('clear').addEventListener('click', async () => {
  if (!confirm('Delete every entry? The files stay in your Downloads folder.')) return;
  await send({ type: 'clearHistory' });
  offset = 0;
  load();
});

load();
