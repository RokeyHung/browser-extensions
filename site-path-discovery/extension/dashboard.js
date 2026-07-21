// dashboard.js — results manager (spec §5.2, §5.3, §14.5, §15).
// Summary, filterable/sortable/paginated path table, detail drawer, crawl
// control and JSON/CSV export.

const Exporter = globalThis.Exporter;
const PAGE_SIZE = 50;

const TABS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'page', label: 'Pages', match: (p) => p.type === 'page' },
  { key: 'api', label: 'APIs', match: (p) => p.type === 'api' },
  { key: 'asset', label: 'Assets', match: (p) => p.type === 'asset' },
  { key: 'external', label: 'External', match: (p) => p.type === 'external' },
  { key: 'sitemap', label: 'Sitemap', match: (p) => p.source && p.source.includes('sitemap') },
  { key: 'robots', label: 'Robots', match: (p) => p.type === 'robots-path' },
  { key: 'visited', label: 'Visited', match: (p) => p.source && p.source.includes('navigation') },
];

const el = (id) => document.getElementById(id);
const toastEl = el('toast');

let siteId = null;
let site = null;
let allPaths = [];
let activeTab = 'all';
let searchTerm = '';
let sortKey = 'lastSeenAt';
let sortDir = 'desc';
let page = 1;

function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function showToast(text, kind) {
  toastEl.textContent = text;
  toastEl.className = 'toast' + (kind ? ' toast-' + kind : '');
  toastEl.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => (toastEl.hidden = true), 3800);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString();
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(location.search);
  const wanted = params.get('site');

  const { sites } = await send({ type: 'getSites' });
  const ids = Object.keys(sites || {});
  const picker = el('site-picker');
  picker.innerHTML = ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(sites[id].origin)}</option>`).join('');

  siteId = wanted && sites[wanted] ? wanted : ids[0] || null;
  if (siteId) picker.value = siteId;

  picker.addEventListener('change', () => {
    siteId = picker.value;
    loadSite();
  });

  wireToolbar();
  wireTable();

  // Live crawl progress.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'crawlProgress' && msg.siteId === siteId) {
      renderCrawlProgress(msg.state);
      if (msg.state.done) {
        loadPaths();
      }
    }
  });

  if (!siteId) {
    el('site-origin').textContent = 'No site scanned yet — open a website and use the popup.';
    renderSummary({ total: 0, pages: 0, apis: 0, assets: 0, external: 0, robots: 0, sitemap: 0 });
    renderTabs();
    renderTable();
    return;
  }
  await loadSite();
}

async function loadSite() {
  const { site: s } = await send({ type: 'getSite', siteId });
  site = s;
  el('site-origin').textContent = s ? s.origin : siteId;
  await loadPaths();
  await maybeResumeCrawl();
}

async function loadPaths() {
  const { paths } = await send({ type: 'getPaths', siteId });
  allPaths = paths || [];
  renderSummary(Exporter.summarize(allPaths));
  renderTabs();
  renderTable();
}

// ── Summary + tabs ────────────────────────────────────────────────────────────

function renderSummary(s) {
  el('summary').innerHTML = [
    ['Total', s.total],
    ['Pages', s.pages],
    ['APIs', s.apis],
    ['Assets', s.assets],
    ['External', s.external],
    ['Sitemap', s.sitemap],
    ['Robots', s.robots],
  ]
    .map(([label, n]) => `<div class="sum-card"><span class="sum-num">${n}</span><span class="sum-lbl">${label}</span></div>`)
    .join('');
}

function tabCount(tab) {
  return allPaths.filter(tab.match).length;
}

function renderTabs() {
  el('tabs').innerHTML = TABS.map(
    (t) =>
      `<button class="tab ${t.key === activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label} <span class="tab-count">${tabCount(t)}</span></button>`
  ).join('');
  el('tabs')
    .querySelectorAll('.tab')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        page = 1;
        renderTabs();
        renderTable();
      })
    );
}

// ── Table ─────────────────────────────────────────────────────────────────────

function filteredPaths() {
  const tab = TABS.find((t) => t.key === activeTab) || TABS[0];
  let list = allPaths.filter(tab.match);
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    list = list.filter(
      (p) =>
        (p.normalizedUrl || '').toLowerCase().includes(q) || (p.path || '').toLowerCase().includes(q) || (p.method || '').toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => {
    let av = a[sortKey];
    let bv = b[sortKey];
    av = av == null ? '' : av;
    bv = bv == null ? '' : bv;
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return list;
}

function renderTable() {
  const list = filteredPaths();
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * PAGE_SIZE;
  const rows = list.slice(start, start + PAGE_SIZE);

  el('result-count').textContent = `${list.length} result${list.length === 1 ? '' : 's'}`;
  el('empty').hidden = list.length !== 0;

  el('rows').innerHTML = rows
    .map(
      (p, i) => `
    <tr data-idx="${start + i}">
      <td><span class="type-tag type-${escapeHtml(p.type)}">${escapeHtml(prettyType(p.type))}</span></td>
      <td class="mono">${escapeHtml(p.method || '')}</td>
      <td class="url-cell mono" title="${escapeHtml(p.normalizedUrl)}">${escapeHtml(p.normalizedUrl)}</td>
      <td class="mono small">${escapeHtml((p.source || []).join(', '))}</td>
      <td class="mono">${p.statusCode != null ? escapeHtml(p.statusCode) : ''}</td>
      <td class="small">${escapeHtml(fmtTime(p.firstSeenAt))}</td>
      <td class="small">${escapeHtml(fmtTime(p.lastSeenAt))}</td>
    </tr>`
    )
    .join('');

  el('rows')
    .querySelectorAll('tr')
    .forEach((tr) => tr.addEventListener('click', () => openDrawer(list[Number(tr.dataset.idx)])));

  renderPagination(list.length, totalPages);
}

function prettyType(t) {
  if (t === 'robots-path') return 'Robots';
  if (t === 'api') return 'API';
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

function renderPagination(total, totalPages) {
  if (totalPages <= 1) {
    el('pagination').innerHTML = '';
    return;
  }
  el('pagination').innerHTML = `
    <button class="btn btn-secondary sm" id="prev" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>
    <span class="page-info">Page ${page} / ${totalPages}</span>
    <button class="btn btn-secondary sm" id="next" ${page === totalPages ? 'disabled' : ''}>Next ›</button>`;
  const prev = el('prev');
  const next = el('next');
  if (prev)
    prev.addEventListener('click', () => {
      page--;
      renderTable();
    });
  if (next)
    next.addEventListener('click', () => {
      page++;
      renderTable();
    });
}

function wireTable() {
  el('search').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    page = 1;
    renderTable();
  });
  document.querySelectorAll('.path-table th[data-sort]').forEach((th) =>
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortKey = key;
        sortDir = 'asc';
      }
      renderTable();
    })
  );
}

// ── Detail drawer (spec §5.3) ─────────────────────────────────────────────────

function openDrawer(p) {
  if (!p) return;
  const rows = [
    ['URL', p.normalizedUrl],
    ['Raw URL', p.url],
    ['Type', prettyType(p.type)],
    ['Method', p.method || '—'],
    ['Source', (p.source || []).join(', ') || '—'],
    ['Status', p.statusCode != null ? p.statusCode : '—'],
    ['Query keys', (p.queryKeys || []).join(', ') || '—'],
    ['Resource type', p.resourceType || '—'],
    ['Robots directive', p.robotsDirective || '—'],
    ['Last modified', p.lastmod || '—'],
    ['Seen count', p.seenCount],
    ['First seen', fmtTime(p.firstSeenAt)],
    ['Last seen', fmtTime(p.lastSeenAt)],
    ['Discovered from', (p.discoveredFrom || []).join('\n') || '—'],
  ];
  el('drawer').innerHTML = `
    <div class="drawer-head">
      <h2>Path detail</h2>
      <button class="drawer-close" id="drawer-close">✕</button>
    </div>
    <dl class="detail-list">
      ${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd class="mono">${escapeHtml(v)}</dd>`).join('')}
    </dl>`;
  el('drawer').hidden = false;
  el('drawer-backdrop').hidden = false;
  el('drawer-close').addEventListener('click', closeDrawer);
}

function closeDrawer() {
  el('drawer').hidden = true;
  el('drawer-backdrop').hidden = true;
}

// ── Toolbar actions ───────────────────────────────────────────────────────────

function wireToolbar() {
  el('scan').addEventListener('click', onScan);
  el('robots').addEventListener('click', onRobots);
  el('sitemap').addEventListener('click', onSitemap);
  el('crawl').addEventListener('click', toggleCrawlPanel);
  el('export-json').addEventListener('click', onExportJson);
  el('export-csv').addEventListener('click', onExportCsv);
  el('clear').addEventListener('click', onClear);
  el('drawer-backdrop').addEventListener('click', closeDrawer);

  el('crawl-cancel').addEventListener('click', () => (el('crawl-panel').hidden = true));
  el('crawl-start').addEventListener('click', onStartCrawl);
  el('crawl-stop').addEventListener('click', () => send({ type: 'stopCrawl' }));
}

// Find an open tab that belongs to this site so we can scan/act on it.
async function findSiteTab() {
  if (!site) return null;
  const tabs = await chrome.tabs.query({ url: [site.origin + '/*'] });
  return tabs && tabs.length ? tabs[0] : null;
}

async function onScan() {
  const tab = await findSiteTab();
  if (!tab) {
    showToast('Open this site in a tab first, then scan.', 'error');
    return;
  }
  const res = await send({ type: 'scanCurrentPage', url: tab.url, tabId: tab.id });
  if (!res || !res.ok) {
    showToast(res && res.error ? res.error : 'Scan failed.', 'error');
    return;
  }
  showToast(`Scan completed. Found ${res.found} URLs. New: ${res.added}.`, 'success');
  await loadPaths();
}

async function onRobots() {
  const res = await send({ type: 'readRobots', url: site.origin });
  if (!res || !res.ok || !res.found) {
    showToast('robots.txt was not found for this site.', 'error');
    return;
  }
  showToast(`robots.txt: ${res.disallow} disallow, ${res.allow} allow, ${res.sitemaps.length} sitemap(s).`, 'success');
  await loadPaths();
}

async function onSitemap() {
  showToast('Reading sitemap…');
  const res = await send({ type: 'readSitemap', url: site.origin });
  if (!res || !res.ok || res.sitemapsRead === 0) {
    showToast('No sitemap found (tried /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml).', 'error');
    return;
  }
  showToast(`Sitemaps: ${res.sitemapsRead}. URLs: ${res.urlsFound}. New: ${res.newUrls}.`, 'success');
  await loadPaths();
}

// ── Crawl ──────────────────────────────────────────────────────────────────────

async function toggleCrawlPanel() {
  const panel = el('crawl-panel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  const { settings } = await send({ type: 'getSettings' });
  const c = settings.crawl;
  el('c-start').value = (site ? site.origin : '') + '/';
  el('c-scope').value = c.scope;
  el('c-depth').value = c.maxDepth;
  el('c-pages').value = c.maxPages;
  el('c-delay').value = c.requestDelayMs;
  el('c-robots').checked = c.respectRobotsTxt;
  el('crawl-config').hidden = false;
  el('crawl-progress').hidden = true;
}

async function onStartCrawl() {
  const config = {
    startUrl: el('c-start').value.trim() || site.origin + '/',
    scope: el('c-scope').value,
    maxDepth: Number(el('c-depth').value) || 0,
    maxPages: Number(el('c-pages').value) || 1,
    requestDelayMs: Number(el('c-delay').value) || 0,
    respectRobotsTxt: el('c-robots').checked,
  };
  const res = await send({ type: 'startCrawl', url: site.origin, config });
  if (!res || !res.ok || !res.started) {
    showToast(res && res.error ? res.error : 'Could not start crawl.', 'error');
    return;
  }
  el('crawl-config').hidden = true;
  el('crawl-progress').hidden = false;
  renderCrawlProgress({ scannedPages: 0, queued: 0, discoveredPaths: 0, errors: [] });
}

async function maybeResumeCrawl() {
  const status = await send({ type: 'getCrawlStatus' });
  if (status && status.running && status.siteId === siteId) {
    el('crawl-panel').hidden = false;
    el('crawl-config').hidden = true;
    el('crawl-progress').hidden = false;
    renderCrawlProgress(status.state);
  }
}

function renderCrawlProgress(state) {
  if (!state) return;
  const cfgPages = Number(el('c-pages').value) || '∞';
  el('crawl-stats').innerHTML = `
    <div><strong>${state.scannedPages}</strong> / ${cfgPages} pages scanned</div>
    <div>Queue: <strong>${state.queued || 0}</strong></div>
    <div>Discovered paths: <strong>${state.discoveredPaths}</strong></div>
    <div>Errors: <strong>${(state.errors || []).length}</strong></div>`;
  if (state.done) {
    el('crawl-progress').querySelector('h3').textContent = state.stopped ? 'Crawl stopped' : 'Crawl completed';
    el('crawl-stop').textContent = 'Close';
    el('crawl-stop').onclick = () => (el('crawl-panel').hidden = true);
  }
}

// ── Export (spec §15) ──────────────────────────────────────────────────────────

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp() {
  const host = site ? site.hostname : 'site';
  const day = new Date().toISOString().slice(0, 10);
  return `path-discovery-${host}-${day}`;
}

function onExportJson() {
  if (!allPaths.length) return showToast('Nothing to export.', 'error');
  download(fileStamp() + '.json', Exporter.toJSON(site, allPaths), 'application/json');
}

function onExportCsv() {
  if (!allPaths.length) return showToast('Nothing to export.', 'error');
  download(fileStamp() + '.csv', Exporter.toCSV(allPaths), 'text/csv');
}

async function onClear() {
  if (!confirm('Clear all discovered paths for this site? This cannot be undone.')) return;
  await send({ type: 'clearSite', siteId });
  await loadPaths();
  showToast('Scan data cleared for this site.', 'success');
}

init();
