// result.js — the result page: one screenshot, shown at a size that fits, with
// the two edits worth making before sharing it (spec §11).
//
// The blob is read straight from IndexedDB rather than requested from the
// worker: a Blob cannot cross chrome.runtime.sendMessage, and a 20MB image
// would be a poor thing to push through a message port even if it could.

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const Store = globalThis.ImageStore;
const C = globalThis.Settings.C;

function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => (toastEl.hidden = true), 3000);
}

function pathOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch (err) {
    return url || '';
  }
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can truncate the write on slower disks.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ─── Viewer ────────────────────────────────────────────────────────────────────

const viewer = {
  page: null,
  blobs: [],
  part: 0,
  bitmap: null, // the untouched capture for this part
  work: null, // full-resolution canvas with the command stack applied
  stacks: [], // one command stack per part; replayed, so nothing is destructive
  tool: 'crop',
  redactStyle: 'blur',
  zoom: 'fit',
  selection: null,
};

async function renderViewer(pageId) {
  const page = await Store.getPage(pageId);
  if (!page) {
    app.innerHTML = '<p class="empty">This capture is gone. The workspace only holds the most recent one.</p>';
    return;
  }
  viewer.page = page;
  viewer.blobs = await Store.getBlobs(pageId);
  viewer.stacks = viewer.blobs.map(() => []);
  viewer.part = 0;

  const warnings = page.meta.warnings || [];
  app.innerHTML = `
    <header class="bar">
      <div class="bar-main">
        <img class="bar-logo" src="icons/icon48.png" alt="" />
        <div>
          <div class="bar-title">${escapeHtml(page.meta.title || pathOf(page.meta.url))}</div>
          <div class="bar-sub"><a href="${escapeHtml(page.meta.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.meta.url)}</a> · ${page.meta.width} × ${page.meta.height}</div>
        </div>
      </div>
    </header>

    <div class="toolbar">
      <div class="tools">
        <button type="button" class="btn tool is-active" data-tool="crop">Crop</button>
        <button type="button" class="btn tool" data-tool="redact">Redact</button>
        <select id="redact-style" class="mini">
          <option value="blur">Blur</option>
          <option value="solid">Solid</option>
        </select>
        <span class="sep"></span>
        <button type="button" class="btn" id="undo">Undo</button>
        <button type="button" class="btn" id="reset">Reset</button>
      </div>
      <div class="tools">
        <button type="button" class="btn zoom is-active" data-zoom="fit">Fit</button>
        <button type="button" class="btn zoom" data-zoom="1">100%</button>
        <span class="sep"></span>
        <button type="button" class="btn" id="copy">Copy</button>
        <button type="button" class="btn btn-primary" id="png">PNG</button>
        <button type="button" class="btn" id="jpeg">JPEG</button>
      </div>
    </div>

    ${
      viewer.blobs.length > 1
        ? `<div class="parts">${viewer.blobs
            .map((_, i) => `<button type="button" class="btn part ${i === 0 ? 'is-active' : ''}" data-part="${i}">Part ${i + 1}</button>`)
            .join('')}</div>`
        : ''
    }

    <div class="stage"><canvas id="canvas"></canvas></div>
    ${warnings.length ? `<footer class="warnings">${warnings.map((w) => `<div>${escapeHtml(w)}</div>`).join('')}</footer>` : ''}
  `;

  wireViewer();
  await loadPart(0);
}

function wireViewer() {
  app.querySelector('.tools').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    viewer.tool = button.dataset.tool;
    for (const tool of app.querySelectorAll('.tool')) tool.classList.toggle('is-active', tool === button);
  });

  app.querySelector('#redact-style').addEventListener('change', (event) => (viewer.redactStyle = event.target.value));

  for (const button of app.querySelectorAll('.zoom')) {
    button.addEventListener('click', () => {
      viewer.zoom = button.dataset.zoom === 'fit' ? 'fit' : 1;
      for (const other of app.querySelectorAll('.zoom')) other.classList.toggle('is-active', other === button);
      paint();
    });
  }

  for (const button of app.querySelectorAll('.part')) {
    button.addEventListener('click', async () => {
      for (const other of app.querySelectorAll('.part')) other.classList.toggle('is-active', other === button);
      await loadPart(Number(button.dataset.part));
    });
  }

  app.querySelector('#undo').addEventListener('click', undo);
  app.querySelector('#reset').addEventListener('click', () => {
    viewer.stacks[viewer.part] = [];
    replay();
  });

  app.querySelector('#png').addEventListener('click', () => exportImage('png'));
  app.querySelector('#jpeg').addEventListener('click', () => exportImage('jpeg'));
  app.querySelector('#copy').addEventListener('click', copyImage);

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
  });

  bindSelection(app.querySelector('#canvas'));
}

async function loadPart(index) {
  viewer.part = index;
  if (viewer.bitmap) viewer.bitmap.close();
  viewer.bitmap = await createImageBitmap(viewer.blobs[index]);
  replay();
}

// Every edit is a command replayed from the untouched capture, so undo is
// exact and the stored blob is never modified (spec §11.2).
function replay() {
  const canvas = document.createElement('canvas');
  canvas.width = viewer.bitmap.width;
  canvas.height = viewer.bitmap.height;
  let ctx = canvas.getContext('2d');
  ctx.drawImage(viewer.bitmap, 0, 0);
  let current = canvas;

  for (const command of viewer.stacks[viewer.part]) {
    if (command.type === 'crop') {
      const cropped = document.createElement('canvas');
      cropped.width = command.w;
      cropped.height = command.h;
      cropped.getContext('2d').drawImage(current, command.x, command.y, command.w, command.h, 0, 0, command.w, command.h);
      current = cropped;
      ctx = current.getContext('2d');
      continue;
    }
    // Redaction destroys the pixels here and now — the exported file cannot be
    // un-blurred, which is the only kind of redaction worth offering.
    if (command.style === 'solid') {
      ctx.fillStyle = '#111827';
      ctx.fillRect(command.x, command.y, command.w, command.h);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(command.x, command.y, command.w, command.h);
      ctx.clip();
      ctx.filter = 'blur(14px)';
      ctx.drawImage(current, 0, 0);
      ctx.restore();
    }
  }

  viewer.work = current;
  paint();
}

function undo() {
  if (!viewer.stacks[viewer.part].length) return;
  viewer.stacks[viewer.part].pop();
  replay();
}

function displayScale() {
  if (viewer.zoom !== 'fit') return 1;
  const stage = app.querySelector('.stage');
  const available = Math.max(200, stage.clientWidth - 32);
  return Math.min(1, available / viewer.work.width);
}

function paint() {
  const canvas = app.querySelector('#canvas');
  const scale = displayScale();
  canvas.width = Math.max(1, Math.round(viewer.work.width * scale));
  canvas.height = Math.max(1, Math.round(viewer.work.height * scale));
  const ctx = canvas.getContext('2d');
  // Below 100% the browser's smoothing is what you want; above it, nearest
  // neighbour, so inspecting a pixel shows the pixel.
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(viewer.work, 0, 0, canvas.width, canvas.height);

  if (viewer.selection) {
    const { x, y, w, h } = viewer.selection;
    ctx.save();
    ctx.strokeStyle = '#5546CB';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x * scale, y * scale, w * scale, h * scale);
    ctx.restore();
  }
}

function bindSelection(canvas) {
  let start = null;

  const toImage = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scale = displayScale();
    return {
      x: Math.round((event.clientX - rect.left) / scale),
      y: Math.round((event.clientY - rect.top) / scale),
    };
  };

  const rectBetween = (a, b) => ({
    x: Math.max(0, Math.min(a.x, b.x)),
    y: Math.max(0, Math.min(a.y, b.y)),
    w: Math.min(viewer.work.width, Math.abs(a.x - b.x)),
    h: Math.min(viewer.work.height, Math.abs(a.y - b.y)),
  });

  canvas.addEventListener('mousedown', (event) => {
    start = toImage(event);
    viewer.selection = { ...start, w: 0, h: 0 };
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!start) return;
    viewer.selection = rectBetween(start, toImage(event));
    paint();
  });

  window.addEventListener('mouseup', (event) => {
    if (!start) return;
    const rect = rectBetween(start, toImage(event));
    start = null;
    viewer.selection = null;
    if (rect.w < 4 || rect.h < 4) {
      paint();
      return;
    }
    viewer.stacks[viewer.part].push(viewer.tool === 'crop' ? { type: 'crop', ...rect } : { type: 'redact', style: viewer.redactStyle, ...rect });
    replay();
  });
}

function currentFilename(format) {
  return globalThis.Filename.forPage({
    url: viewer.page.meta.url,
    hostname: viewer.page.meta.hostname,
    part: viewer.part + 1,
    parts: viewer.blobs.length,
    format,
  });
}

function toBlob(format) {
  return new Promise((resolve) => {
    if (format === 'jpeg') {
      // JPEG has no alpha; without a white backdrop transparent pixels come out
      // black.
      const flat = document.createElement('canvas');
      flat.width = viewer.work.width;
      flat.height = viewer.work.height;
      const ctx = flat.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(viewer.work, 0, 0);
      flat.toBlob(resolve, 'image/jpeg', C.JPEG_QUALITY);
    } else {
      viewer.work.toBlob(resolve, 'image/png');
    }
  });
}

async function exportImage(format) {
  const blob = await toBlob(format);
  saveBlob(blob, currentFilename(format));
}

async function copyImage() {
  try {
    const blob = await toBlob('png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('Copied to clipboard');
  } catch (err) {
    showToast('Click the page, then press Copy again.');
  }
}

// ─── Entry ─────────────────────────────────────────────────────────────────────

const pageParam = new URLSearchParams(location.search).get('page');
if (pageParam) renderViewer(pageParam);
else app.innerHTML = '<p class="empty">Nothing to show. Capture a page from the toolbar button.</p>';

window.addEventListener('resize', () => {
  if (viewer.work) paint();
});
