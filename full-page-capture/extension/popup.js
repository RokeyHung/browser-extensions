// popup.js — one button and one question (spec §12).
//
// Where the result should go is worth asking every time, because it changes per
// capture: this one to look at, the next one straight to disk. Everything else
// is an option or a constant.

const app = document.getElementById('app-content');

let state = null;
let poll = null;

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response || !response.success) throw new Error((response && response.error) || 'Request failed');
  return response.data;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function isRunning(run) {
  return !!run && (run.status === 'running' || run.status === 'stopping');
}

async function init() {
  try {
    state = await send({ type: 'getPopupState' });
  } catch (err) {
    renderUnsupported(err.message);
    return;
  }
  render();
}

function render() {
  if (isRunning(state.run)) renderProgress();
  else if (!state.supported) renderUnsupported();
  else renderIdle();
}

function renderUnsupported(reason) {
  stopPolling();
  app.innerHTML = `
    <div class="content">
      <p class="unsupported">${escapeHtml(reason || 'This page is not supported.')}</p>
      <p class="unsupported-hint">Open a normal http:// or https:// website and try again.</p>
    </div>`;
}

function renderIdle() {
  stopPolling();
  const settings = state.settings;

  app.innerHTML = `
    <div class="content">
      <div class="site" title="${escapeHtml(state.hostname)}">${escapeHtml(state.hostname)}</div>

      <button type="button" id="start" class="primary">Capture this page</button>

      <div class="field">
        <span class="field-label">When done</span>
        <div class="segmented" id="after">
          <button type="button" data-after="preview" class="${settings.afterCapture === 'preview' ? 'is-active' : ''}">Preview</button>
          <button type="button" data-after="download" class="${settings.afterCapture === 'download' ? 'is-active' : ''}">Save</button>
        </div>
      </div>

      <a class="options-link" href="#" id="options">Options</a>
    </div>`;

  app.querySelector('#after').addEventListener('click', (event) => {
    const button = event.target.closest('[data-after]');
    if (!button) return;
    state.settings.afterCapture = button.dataset.after;
    renderIdle();
  });

  app.querySelector('#options').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  app.querySelector('#start').addEventListener('click', async () => {
    const button = app.querySelector('#start');
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
      await send({ type: 'startCapture', tabId: state.tabId, afterCapture: state.settings.afterCapture });
    } catch (err) {
      renderUnsupported(err.message);
      return;
    }
    // The capture tab cannot take focus while the popup holds it, and
    // captureVisibleTab only photographs the focused tab — so the popup gets
    // out of the way immediately (spec §12).
    window.close();
  });
}

function renderProgress() {
  const run = state.run;
  const total = Math.max(run.total || 1, run.done);
  const percent = Math.round((run.done / Math.max(1, total)) * 100);

  app.innerHTML = `
    <div class="content">
      <div class="site">${escapeHtml(run.hostname)}</div>
      <div class="progress-line">Screen <strong>${run.done}</strong> of ${total}</div>
      <div class="track"><div class="bar" style="width:${percent}%"></div></div>
      <div class="progress-detail">${run.status === 'stopping' ? 'Stopping…' : 'Capturing'}</div>
      <button type="button" id="stop" class="primary danger" ${run.status === 'stopping' ? 'disabled' : ''}>Stop</button>
    </div>`;

  app.querySelector('#stop').addEventListener('click', async () => {
    await send({ type: 'stopCapture' }).catch(() => null);
    refresh();
  });

  startPolling();
}

// The popup closes the moment the capture starts, so it cannot hold live state.
// This only matters when the popup is re-opened mid-capture (spec §6.3).
function startPolling() {
  if (poll) return;
  poll = setInterval(refresh, 800);
}

function stopPolling() {
  if (!poll) return;
  clearInterval(poll);
  poll = null;
}

async function refresh() {
  try {
    state = await send({ type: 'getPopupState' });
  } catch (err) {
    return;
  }
  render();
}

init();
