// popup.js — the extension popup (spec §5).
// Shows per-area counts for the active tab and offers the quick actions:
// open the explorer, snapshot the current storage, restore a saved snapshot.

const app = document.getElementById('app-content');
const toastEl = document.getElementById('toast');

let currentTab = null;
let state = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.success) throw new Error(response?.error || 'Request failed');
  return response.data;
}

function showToast(text, kind) {
  toastEl.textContent = text;
  toastEl.className = 'toast' + (kind ? ' toast-' + kind : '');
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toastEl.hidden = true), 3500);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab || !/^https?:\/\//i.test(tab.url || '')) {
    renderUnsupported();
    return;
  }

  try {
    state = await send({ type: 'getPopupData', tabId: tab.id });
    render();
  } catch (err) {
    renderUnsupported(err.message);
  }
}

function renderUnsupported(reason) {
  app.innerHTML = `
    <div class="content">
      <div class="unsupported-msg">
        <div class="icon">🚫</div>
        ${ValueInspect.escapeHtml(reason || 'This page is not supported.')}<br />
        Please open a normal http/https website.
      </div>
    </div>`;
}

function render() {
  const { context, counts, errors, snapshots } = state;
  const areaError = errors.local || errors.session;

  const snapshotBlock = snapshots.length
    ? `
      <div class="section-label">Snapshots for this site</div>
      <select class="select" id="snapshot-picker">
        ${snapshots
          .map(
            (item) => `<option value="${item.id}">${ValueInspect.escapeHtml(item.name)} — ${new Date(item.createdAt).toLocaleDateString()}</option>`
          )
          .join('')}
      </select>
      <button class="btn btn-secondary" id="restore">♻️ Restore snapshot</button>`
    : '';

  app.innerHTML = `
    <div class="content">
      <div class="site-info">
        <div class="site-label">Current site</div>
        <div class="site-domain">${ValueInspect.escapeHtml(context.origin)}</div>
      </div>

      <div class="stats-grid">
        <div class="stat"><span class="stat-num">${counts.local}</span><span class="stat-lbl">Local</span></div>
        <div class="stat"><span class="stat-num">${counts.session}</span><span class="stat-lbl">Session</span></div>
        <div class="stat"><span class="stat-num">${counts.cookies}</span><span class="stat-lbl">Cookies</span></div>
        <div class="stat"><span class="stat-num">${counts.idb}</span><span class="stat-lbl">IndexedDB</span></div>
      </div>

      ${areaError ? `<div class="inline-error">${ValueInspect.escapeHtml(areaError)}</div>` : ''}

      <button class="btn btn-primary" id="open">📦 Open explorer</button>
      <button class="btn btn-secondary" id="snapshot">📸 Save snapshot</button>
      ${snapshotBlock}
    </div>`;

  document.getElementById('open').addEventListener('click', onOpen);
  document.getElementById('snapshot').addEventListener('click', onSnapshot);
  document.getElementById('restore')?.addEventListener('click', onRestore);
}

function busy(id, label) {
  const btn = document.getElementById(id);
  if (btn) {
    btn.disabled = true;
    btn.textContent = label;
  }
}

function onOpen() {
  chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?tabId=${currentTab.id}`) });
  window.close();
}

async function onSnapshot() {
  busy('snapshot', 'Saving…');
  try {
    const snapshot = await send({ type: 'createSnapshot', tabId: currentTab.id });
    showToast(
      `Saved "${snapshot.name}" — ${snapshot.stats.local} local, ${snapshot.stats.session} session, ${snapshot.stats.cookies} cookies.`,
      'success'
    );
    state = await send({ type: 'getPopupData', tabId: currentTab.id });
    render();
  } catch (err) {
    showToast(err.message, 'error');
    render();
  }
}

async function onRestore() {
  const snapshotId = document.getElementById('snapshot-picker').value;
  busy('restore', 'Restoring…');
  try {
    const report = await send({
      type: 'restoreSnapshot',
      tabId: currentTab.id,
      snapshotId,
      mode: 'merge',
      reload: true,
    });
    const written = (report.local?.written || 0) + (report.session?.written || 0);
    const cookies = report.cookies?.written || 0;
    showToast(`Restored ${written} entries and ${cookies} cookies. Tab reloaded.`, 'success');
    state = await send({ type: 'getPopupData', tabId: currentTab.id });
    render();
  } catch (err) {
    showToast(err.message, 'error');
    render();
  }
}

init();
