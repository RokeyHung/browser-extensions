// popup.js — status, not controls (spec §11).
//
// There is no place to paste a link and no list of media to pick from: saving
// happens on the post the user is looking at. What the popup answers is "is this
// thing working right now", and the harvested count is the honest answer —
// when Facebook changes its payloads that number goes to zero long before
// anything else shows it.

const content = document.getElementById('app-content');

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => null);
}

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
}

function renderUnsupported() {
  content.innerHTML = `
    <div class="content">
      <p class="unsupported">Open a Facebook tab to use this extension.</p>
      <p class="unsupported-hint">The download buttons appear on the photos and videos of the post you are looking at.</p>
      <div class="button-row" style="margin-top: 14px">
        <button class="secondary" id="history" type="button">History</button>
        <button class="secondary" id="options" type="button">Options</button>
      </div>
    </div>
  `;
  bindNav();
}

function renderState(state) {
  const harvestClass = state.harvested === 0 ? ' is-zero' : '';
  content.innerHTML = `
    <div class="content">
      <div class="site">${escapeHtml(state.path)}</div>
      <div class="stats">
        <div class="stat">
          <span class="stat-label">Media found on this page</span>
          <span class="stat-value${harvestClass}">${state.harvested}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Saved today</span>
          <span class="stat-value">${state.today}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Saved all time</span>
          <span class="stat-value">${state.total}</span>
        </div>
      </div>
      ${
        state.harvested === 0
          ? '<p class="unsupported-hint">Nothing found yet — scroll the page a little, or reload it if the buttons never show up.</p>'
          : ''
      }
      <div class="button-row" style="margin-top: 14px">
        <button class="secondary" id="history" type="button">History</button>
        <button class="secondary" id="options" type="button">Options</button>
      </div>
      <p class="footnote">Nothing leaves your computer.</p>
    </div>
  `;
  bindNav();
}

function bindNav() {
  const history = document.getElementById('history');
  const options = document.getElementById('options');
  if (history) history.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
  if (options) options.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

(async function init() {
  const response = await send({ type: 'getPopupState' });
  if (!response || !response.success) {
    renderUnsupported();
    return;
  }
  if (!response.data.onFacebook) renderUnsupported();
  else renderState(response.data);
})();
