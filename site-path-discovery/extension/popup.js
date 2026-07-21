// popup.js — the extension popup (spec §5.1, §14.1, §14.2).
// Shows the current site, recording state and discovered counts, and offers the
// quick actions (scan / record / robots / sitemap / dashboard).

const app = document.getElementById('app-content');
const toastEl = document.getElementById('toast');

const UNSUPPORTED_RE = /^(chrome|edge|about|file|devtools|view-source|chrome-extension|moz-extension):/i;

let currentTab = null;
let state = null;

function send(msg) {
  return chrome.runtime.sendMessage(msg);
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

  if (!tab || !tab.url || UNSUPPORTED_RE.test(tab.url)) {
    renderUnsupported();
    return;
  }

  const data = await send({ type: 'getPopupData', url: tab.url });
  if (!data || !data.supported) {
    renderUnsupported();
    return;
  }
  state = data;
  render();
}

function renderUnsupported() {
  app.innerHTML = `
    <div class="content">
      <div class="unsupported-msg">
        <div class="icon">🚫</div>
        This page is not supported.<br />
        Please open a normal http/https website.
      </div>
    </div>`;
}

function render() {
  const { ctx, recording, summary } = state;
  app.innerHTML = `
    <div class="content">
      <div class="site-info">
        <div class="site-label">Current site</div>
        <div class="site-domain">${escapeHtml(ctx.origin)}</div>
      </div>

      <div class="status-row">
        <div class="status-text">Recording: ${recording ? '<span class="status-on">ON</span>' : '<span class="status-off">OFF</span>'}</div>
        <span class="badge">${summary.total} paths</span>
      </div>

      <div class="stats-grid">
        <div class="stat"><span class="stat-num">${summary.pages}</span><span class="stat-lbl">Pages</span></div>
        <div class="stat"><span class="stat-num">${summary.apis}</span><span class="stat-lbl">APIs</span></div>
        <div class="stat"><span class="stat-num">${summary.assets}</span><span class="stat-lbl">Assets</span></div>
        <div class="stat"><span class="stat-num">${summary.external}</span><span class="stat-lbl">External</span></div>
      </div>

      <button class="btn btn-primary" id="scan">🔍 Scan current page</button>
      <button class="btn ${recording ? 'btn-danger' : 'btn-secondary'}" id="record">
        ${recording ? '⏹ Stop recording' : '⏺ Start recording'}
      </button>
      <div class="btn-row">
        <button class="btn btn-secondary half" id="robots">robots.txt</button>
        <button class="btn btn-secondary half" id="sitemap">Sitemap</button>
      </div>
      <button class="btn btn-secondary" id="dashboard">📊 Open dashboard</button>
    </div>`;

  document.getElementById('scan').addEventListener('click', onScan);
  document.getElementById('record').addEventListener('click', onRecord);
  document.getElementById('robots').addEventListener('click', onRobots);
  document.getElementById('sitemap').addEventListener('click', onSitemap);
  document.getElementById('dashboard').addEventListener('click', onDashboard);
}

async function refreshSummary() {
  const data = await send({ type: 'getPopupData', url: currentTab.url });
  if (data && data.supported) {
    state = data;
    render();
  }
}

function busy(id, label) {
  const btn = document.getElementById(id);
  if (btn) {
    btn.disabled = true;
    btn.dataset.prev = btn.textContent;
    btn.textContent = label;
  }
}

async function onScan() {
  busy('scan', 'Scanning…');
  const res = await send({ type: 'scanCurrentPage', url: currentTab.url, tabId: currentTab.id });
  if (!res || !res.ok) {
    showToast(res && res.error ? res.error : 'Cannot access this website.', 'error');
    await refreshSummary();
    return;
  }
  showToast(`Scan completed. Found ${res.found} URLs. New: ${res.added}, dup: ${res.updated}.`, 'success');
  await refreshSummary();
}

async function onRecord() {
  const type = state.recording ? 'stopRecording' : 'startRecording';
  await send({ type, url: currentTab.url, tabId: currentTab.id });
  await refreshSummary();
  showToast(state.recording ? 'Recording started.' : 'Recording stopped.', 'success');
}

async function onRobots() {
  busy('robots', 'Reading…');
  const res = await send({ type: 'readRobots', url: currentTab.url });
  if (!res || !res.ok || !res.found) {
    showToast('robots.txt was not found for this site.', 'error');
    render();
    return;
  }
  showToast(`robots.txt: ${res.disallow} disallow, ${res.allow} allow, ${res.sitemaps.length} sitemap(s).`, 'success');
  await refreshSummary();
}

async function onSitemap() {
  busy('sitemap', 'Reading…');
  const res = await send({ type: 'readSitemap', url: currentTab.url });
  if (!res || !res.ok || res.sitemapsRead === 0) {
    showToast('No sitemap found (/sitemap.xml, /sitemap_index.xml, /sitemap-index.xml).', 'error');
    render();
    return;
  }
  showToast(`Sitemaps: ${res.sitemapsRead}. URLs: ${res.urlsFound}. New: ${res.newUrls}.`, 'success');
  await refreshSummary();
}

function onDashboard() {
  const url = chrome.runtime.getURL('dashboard.html') + '?site=' + encodeURIComponent(state.ctx.siteId);
  chrome.tabs.create({ url });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

init();
