// result.js — the result page: one screenshot, shown at a size that fits, plus
// the tools for marking it up before sharing it (spec §11).
//
// The blob is read straight from IndexedDB rather than requested from the
// worker: a Blob cannot cross chrome.runtime.sendMessage, and a 20MB image
// would be a poor thing to push through a message port even if it could.

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const Store = globalThis.ImageStore;
const C = globalThis.Settings.C;

const TEXT_COLOR = '#dc2626';
const TEXT_BASE_SIZE = 18; // CSS pixels of the captured page

// Sizes and swatches are expressed in CSS pixels of the captured page and then
// multiplied by the capture's scale, so a 4px line looks the same on a 1× and a
// 2× shot (spec §11.2).
const PALETTE = ['#dc2626', '#ea580c', '#eab308', '#16a34a', '#2563eb', '#7c3aed', '#111827', '#ffffff'];
// Presets for the two size boxes. Both boxes are editable, like a word
// processor's font size: the list is a shortcut, not the whole range.
const WIDTHS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const TEXT_SIZES = [10, 12, 14, 16, 18, 24, 32, 48, 64, 96];
const WIDTH_RANGE = { min: 1, max: 200, fallback: 4 };
const TEXT_RANGE = { min: 6, max: 400, fallback: 18 };
const HIGHLIGHT_ALPHA = 0.45;
const FILL_TOLERANCE = 32; // per channel, 0–255

// Tools that draw with the current colour and width, as opposed to Crop and
// Redact which change the image itself.
const DRAW_TOOLS = new Set(['pen', 'line', 'arrow', 'rect', 'ellipse', 'highlight', 'eraser']);

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
  color: TEXT_COLOR,
  width: WIDTH_RANGE.fallback,
  textPx: TEXT_BASE_SIZE,
  filled: false,
  editor: null,
  zoom: 'fit',
  selection: null,
  draft: null, // the shape being dragged out right now
};

// Line widths and text sizes are authored in page CSS pixels; the image is in
// device pixels, so everything drawn on it has to be multiplied through.
function imageScale() {
  return viewer.page.meta.scale || 1;
}

function scaled(value) {
  return Math.max(1, Math.round(value * imageScale()));
}

// Text is measured in CSS pixels of the original page and then multiplied by the
// capture's scale, so a label is the same apparent size on a 1× and a 2× shot —
// written in image pixels it would come out half-size on a retina capture.
function textSize() {
  return Math.max(TEXT_RANGE.min, Math.round(viewer.textPx * imageScale()));
}

// A combobox in the word-processor sense: type any number, or open the list and
// pick one. Chrome draws no dropdown affordance for <input list=…> — neither for
// type=number nor type=text — so the arrow and the list are ours, otherwise the
// control just looks like a plain box and nobody discovers the presets.
function sizeCombo(id, label, presets, value) {
  return `
    <span class="size">
      ${label}
      <span class="combo" data-combo="${id}">
        <input type="text" id="${id}" class="size-input" value="${value}" inputmode="numeric" autocomplete="off" />
        <button type="button" class="combo-arrow" aria-label="${label} size presets" tabindex="-1">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6L8 10.5L12.5 6" /></svg>
        </button>
        <ul class="combo-list" hidden>
          ${presets.map((preset) => `<li><button type="button" class="combo-option" data-value="${preset}">${preset}</button></li>`).join('')}
        </ul>
      </span>
    </span>`;
}

function textFont(size) {
  return `600 ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
}

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
      <div class="tools" id="tool-row">
        <button type="button" class="btn tool is-active" data-tool="crop">Crop</button>
        <button type="button" class="btn tool" data-tool="redact">Redact</button>
        <select id="redact-style" class="mini">
          <option value="blur">Blur</option>
          <option value="solid">Solid</option>
        </select>
        <span class="sep"></span>
        <button type="button" class="btn tool" data-tool="pen">Pen</button>
        <button type="button" class="btn tool" data-tool="line">Line</button>
        <button type="button" class="btn tool" data-tool="arrow">Arrow</button>
        <button type="button" class="btn tool" data-tool="rect">Rect</button>
        <button type="button" class="btn tool" data-tool="ellipse">Ellipse</button>
        <button type="button" class="btn tool" data-tool="highlight">Highlight</button>
        <button type="button" class="btn tool" data-tool="text">Text</button>
        <span class="sep"></span>
        <button type="button" class="btn tool" data-tool="fill">Fill</button>
        <button type="button" class="btn tool" data-tool="eraser">Eraser</button>
        <button type="button" class="btn tool" data-tool="pick" title="Pick a colour from the image">Pick</button>
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

    <div class="toolbar styles">
      <div class="tools">
        <span class="swatches" id="swatches">
          ${PALETTE.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}
        </span>
        <input type="color" id="custom-color" class="color" value="${TEXT_COLOR}" title="Custom colour" />
        <span class="sep"></span>
        ${sizeCombo('line-width', 'Line', WIDTHS, WIDTH_RANGE.fallback)} ${sizeCombo('text-size', 'Text', TEXT_SIZES, TEXT_RANGE.fallback)}
        <span class="sep"></span>
        <label class="checkbox"><input type="checkbox" id="filled" /> Filled shapes</label>
      </div>
      <div class="tools">
        <button type="button" class="btn" id="undo">Undo</button>
        <button type="button" class="btn" id="reset">Reset</button>
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
    markActive('.tool', button);
  });

  app.querySelector('#redact-style').addEventListener('change', (event) => (viewer.redactStyle = event.target.value));

  app.querySelector('#swatches').addEventListener('click', (event) => {
    const swatch = event.target.closest('[data-color]');
    if (swatch) setColor(swatch.dataset.color);
  });
  app.querySelector('#custom-color').addEventListener('input', (event) => setColor(event.target.value));

  bindSize(app.querySelector('#line-width'), WIDTH_RANGE, (value) => (viewer.width = value));
  bindSize(app.querySelector('#text-size'), TEXT_RANGE, (value) => (viewer.textPx = value));

  app.querySelector('#filled').addEventListener('change', (event) => (viewer.filled = event.target.checked));

  for (const button of app.querySelectorAll('.zoom')) {
    button.addEventListener('click', () => {
      closeTextEditor();
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

  bindCanvas(app.querySelector('#canvas'));
}

async function loadPart(index) {
  closeTextEditor();
  viewer.part = index;
  if (viewer.bitmap) viewer.bitmap.close();
  viewer.bitmap = await createImageBitmap(viewer.blobs[index]);
  replay();
}

// Every edit is a command replayed from the untouched capture, so undo is
// exact and the stored blob is never modified (spec §11.2).
function cloneCanvas(source) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d').drawImage(source, 0, 0);
  return copy;
}

function applyRedact(ctx, command, source) {
  // Redaction destroys the pixels here and now — the exported file cannot be
  // un-blurred, which is the only kind of redaction worth offering.
  if (command.style === 'solid') {
    ctx.fillStyle = '#111827';
    ctx.fillRect(command.x, command.y, command.w, command.h);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(command.x, command.y, command.w, command.h);
  ctx.clip();
  ctx.filter = 'blur(14px)';
  ctx.drawImage(source, 0, 0);
  ctx.restore();
}

function cropCanvas(source, command) {
  const cropped = document.createElement('canvas');
  cropped.width = command.w;
  cropped.height = command.h;
  cropped.getContext('2d').drawImage(source, command.x, command.y, command.w, command.h, 0, 0, command.w, command.h);
  return cropped;
}

function replay() {
  const stack = viewer.stacks[viewer.part];
  let current = cloneCanvas(viewer.bitmap);
  let ctx = current.getContext('2d');

  // The eraser needs somewhere to copy clean pixels back from: the image with
  // crops and redactions applied but without any drawing. It costs a second
  // full-size canvas, so it only exists when something actually erases.
  let clean = stack.some((command) => command.type === 'eraser') ? cloneCanvas(current) : null;

  for (const command of stack) {
    if (command.type === 'crop') {
      current = cropCanvas(current, command);
      ctx = current.getContext('2d');
      if (clean) clean = cropCanvas(clean, command);
      continue;
    }
    if (command.type === 'redact') {
      applyRedact(ctx, command, current);
      if (clean) applyRedact(clean.getContext('2d'), command, clean);
      continue;
    }
    if (command.type === 'fill') {
      floodFill(current, command.x, command.y, command.color);
      continue;
    }
    drawCommand(ctx, command, clean);
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
  // clientWidth already excludes the scrollbar; the padding has to come off too,
  // and it has to be the real padding rather than a number typed here — being
  // 8px optimistic is enough to put a horizontal scrollbar under an image that
  // was supposed to fit.
  const style = getComputedStyle(stage);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const available = Math.max(200, stage.clientWidth - padding);
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

  // Crop and Redact show a marquee; the drawing tools show the actual shape, at
  // display scale, so the preview and the result cannot disagree.
  if (viewer.selection) {
    const { x, y, w, h } = viewer.selection;
    ctx.save();
    ctx.strokeStyle = '#5546CB';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x * scale, y * scale, w * scale, h * scale);
    ctx.restore();
  }

  if (viewer.draft) {
    ctx.save();
    ctx.scale(scale, scale);
    drawCommand(ctx, viewer.draft, viewer.work);
    ctx.restore();
  }
}

// One pointer handler for every tool: click-only tools act on mousedown, the
// rest build a draft shape that is previewed while dragging and committed on
// release.
function bindCanvas(canvas) {
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

  const draftFrom = (a, b) => {
    const base = { color: viewer.color, width: scaled(viewer.width) };
    if (viewer.tool === 'pen' || viewer.tool === 'eraser') return { type: viewer.tool, points: [a], ...base };
    if (viewer.tool === 'line' || viewer.tool === 'arrow') return { type: viewer.tool, x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...base };
    return { type: viewer.tool, ...rectBetween(a, b), filled: viewer.filled, ...base };
  };

  canvas.addEventListener('mousedown', (event) => {
    const point = toImage(event);

    // Text is placed by a click, not dragged out like a rectangle.
    if (viewer.tool === 'text') {
      // Without this, mousedown's default action moves focus to the canvas
      // straight after this handler, the fresh text box blurs, and its blur
      // handler closes it again — the box appears and vanishes in the same
      // click, so nothing can ever be typed into it.
      event.preventDefault();
      openTextEditor(canvas, point);
      return;
    }

    if (viewer.tool === 'pick') {
      const pixel = viewer.work.getContext('2d', { willReadFrequently: true }).getImageData(point.x, point.y, 1, 1).data;
      const hex = `#${[pixel[0], pixel[1], pixel[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      setColor(hex);
      showToast(`Picked ${hex}`);
      return;
    }

    if (viewer.tool === 'fill') {
      viewer.stacks[viewer.part].push({ type: 'fill', x: point.x, y: point.y, color: viewer.color });
      replay();
      return;
    }

    start = point;
    if (DRAW_TOOLS.has(viewer.tool)) viewer.draft = draftFrom(point, point);
    else viewer.selection = { ...point, w: 0, h: 0 };
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!start) return;
    const point = toImage(event);
    if (viewer.draft) {
      if (viewer.draft.points) viewer.draft.points.push(point);
      else viewer.draft = draftFrom(start, point);
    } else {
      viewer.selection = rectBetween(start, point);
    }
    paint();
  });

  window.addEventListener('mouseup', (event) => {
    if (!start) return;
    const point = toImage(event);
    const from = start;
    start = null;

    if (viewer.draft) {
      const draft = viewer.draft;
      viewer.draft = null;
      // A stray click with a shape tool should not leave an invisible speck.
      const isStroke = !!draft.points;
      const long = isStroke || Math.abs(point.x - from.x) + Math.abs(point.y - from.y) >= 4;
      if (long) {
        viewer.stacks[viewer.part].push(draft);
        replay();
      } else {
        paint();
      }
      return;
    }

    const rect = rectBetween(from, point);
    viewer.selection = null;
    if (rect.w < 4 || rect.h < 4) {
      paint();
      return;
    }
    viewer.stacks[viewer.part].push(viewer.tool === 'crop' ? { type: 'crop', ...rect } : { type: 'redact', style: viewer.redactStyle, ...rect });
    replay();
  });
}

function markActive(selector, active) {
  for (const el of app.querySelectorAll(selector)) el.classList.toggle('is-active', el === active);
}

// An editable size box: pick from the list or type a number. Empty or nonsense
// input falls back rather than poisoning the next shape with NaN.
function bindSize(input, range, apply) {
  const combo = input.closest('.combo');
  const list = combo.querySelector('.combo-list');
  const closeList = () => (list.hidden = true);

  combo.querySelector('.combo-arrow').addEventListener('click', () => {
    list.hidden = !list.hidden;
    if (!list.hidden) input.focus();
  });

  list.addEventListener('click', (event) => {
    const option = event.target.closest('[data-value]');
    if (!option) return;
    input.value = option.dataset.value;
    apply(Number(option.dataset.value));
    closeList();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') list.hidden = false;
    else if (event.key === 'Escape' || event.key === 'Enter') closeList();
  });

  document.addEventListener('click', (event) => {
    if (!combo.contains(event.target)) closeList();
  });

  const read = () => {
    // Number('') is 0, which is finite — left to itself an emptied box would
    // clamp to the minimum and silently draw hairlines.
    const raw = input.value.trim();
    if (raw === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.min(range.max, Math.max(range.min, Math.round(value)));
  };
  input.addEventListener('input', () => {
    const value = read();
    if (value !== null) apply(value);
  });
  input.addEventListener('blur', () => {
    const value = read();
    input.value = String(value === null ? range.fallback : value);
    apply(Number(input.value));
  });
}

function setColor(color) {
  viewer.color = color;
  const custom = app.querySelector('#custom-color');
  if (custom && custom.value !== color) custom.value = color;
  markActive('.swatch', app.querySelector(`.swatch[data-color="${color}"]`));
}

// ─── Drawing ───────────────────────────────────────────────────────────────────

function strokeStyleFor(ctx, command) {
  ctx.strokeStyle = command.color;
  ctx.fillStyle = command.color;
  ctx.lineWidth = command.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function pathOfCommand(ctx, command) {
  ctx.beginPath();
  // Anything carrying `points` is a freehand stroke — pen and eraser both. Keyed
  // on the type instead, the eraser fell through to the two-point branch and
  // built its path out of undefined coordinates, so it silently erased nothing.
  if (command.points) {
    const points = command.points;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    // A single dot still deserves to be visible.
    if (points.length === 1) ctx.lineTo(points[0].x + 0.01, points[0].y);
  } else {
    ctx.moveTo(command.x1, command.y1);
    ctx.lineTo(command.x2, command.y2);
  }
}

// Draws one command in image coordinates. Used both for the committed stack and
// for the live preview, so what is dragged out is exactly what lands.
function drawCommand(ctx, command, source) {
  if (command.type === 'text') {
    ctx.save();
    ctx.font = textFont(command.size);
    ctx.textBaseline = 'top';
    ctx.fillStyle = command.color;
    // A thin light halo so the label stays legible over dark screenshots
    // without needing a background box behind it.
    ctx.lineWidth = Math.max(2, command.size / 8);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineJoin = 'round';
    ctx.strokeText(command.text, command.x, command.y);
    ctx.fillText(command.text, command.x, command.y);
    ctx.restore();
    return;
  }

  if (command.type === 'pen' || command.type === 'line') {
    ctx.save();
    strokeStyleFor(ctx, command);
    pathOfCommand(ctx, command);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (command.type === 'arrow') {
    ctx.save();
    strokeStyleFor(ctx, command);
    const angle = Math.atan2(command.y2 - command.y1, command.x2 - command.x1);
    const length = Math.hypot(command.x2 - command.x1, command.y2 - command.y1);
    const head = Math.min(Math.max(command.width * 3.2, 12), Math.max(length, 1));

    // The shaft stops at the back of the head instead of running to the tip. A
    // round cap on a thick line reaches half a line-width past wherever it ends,
    // so a shaft drawn to the tip pokes a blob out through the arrowhead.
    const shaft = Math.max(0, length - head * 0.9);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(command.x1, command.y1);
    ctx.lineTo(command.x1 + Math.cos(angle) * shaft, command.y1 + Math.sin(angle) * shaft);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(command.x2, command.y2);
    ctx.lineTo(command.x2 - head * Math.cos(angle - Math.PI / 7), command.y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(command.x2 - head * Math.cos(angle + Math.PI / 7), command.y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  if (command.type === 'rect' || command.type === 'ellipse') {
    ctx.save();
    strokeStyleFor(ctx, command);
    ctx.beginPath();
    if (command.type === 'rect') ctx.rect(command.x, command.y, command.w, command.h);
    else ctx.ellipse(command.x + command.w / 2, command.y + command.h / 2, command.w / 2, command.h / 2, 0, 0, Math.PI * 2);
    command.filled ? ctx.fill() : ctx.stroke();
    ctx.restore();
    return;
  }

  if (command.type === 'highlight') {
    ctx.save();
    // Multiply is what a real highlighter does: it darkens towards the ink
    // colour instead of painting over the text underneath.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.fillStyle = command.color;
    ctx.fillRect(command.x, command.y, command.w, command.h);
    ctx.restore();
    return;
  }

  if (command.type === 'eraser') {
    // Erasing means putting the untouched pixels back, not painting white — and
    // `source` is the image with crops and redactions already applied, so a
    // redacted area can never be erased back into view.
    if (!source) return;
    ctx.save();
    strokeStyleFor(ctx, command);
    const pattern = ctx.createPattern(source, 'no-repeat');
    if (pattern) {
      ctx.strokeStyle = pattern;
      pathOfCommand(ctx, command);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// Scanline flood fill. Works on the canvas as it stands at this point in the
// stack, so filling after a crop or a redaction behaves the way it looks.
function floodFill(canvas, x, y, hex) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  if (x < 0 || y < 0 || x >= width || y >= height) return;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const at = (px, py) => (py * width + px) * 4;
  const start = at(x, y);
  const target = [data[start], data[start + 1], data[start + 2]];
  const fill = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  if (Math.abs(target[0] - fill[0]) + Math.abs(target[1] - fill[1]) + Math.abs(target[2] - fill[2]) === 0) return;

  const matches = (index) =>
    Math.abs(data[index] - target[0]) <= FILL_TOLERANCE &&
    Math.abs(data[index + 1] - target[1]) <= FILL_TOLERANCE &&
    Math.abs(data[index + 2] - target[2]) <= FILL_TOLERANCE;

  const paint = (index) => {
    data[index] = fill[0];
    data[index + 1] = fill[1];
    data[index + 2] = fill[2];
    data[index + 3] = 255;
  };

  const stack = [[x, y]];
  while (stack.length) {
    const [sx, sy] = stack.pop();
    let left = sx;
    while (left > 0 && matches(at(left - 1, sy))) left--;
    let right = sx;
    while (right < width - 1 && matches(at(right + 1, sy))) right++;

    for (let px = left; px <= right; px++) {
      paint(at(px, sy));
      if (sy > 0 && matches(at(px, sy - 1))) stack.push([px, sy - 1]);
      if (sy < height - 1 && matches(at(px, sy + 1))) stack.push([px, sy + 1]);
    }
  }
  ctx.putImageData(image, 0, 0);
}

// Type where it will land: an input is laid over the canvas at the click point,
// with the same font at the same on-screen scale, so nothing jumps when it is
// committed to pixels.
function openTextEditor(canvas, at) {
  closeTextEditor();

  const scale = displayScale();
  const size = textSize();
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'text-input';
  input.style.left = `${canvas.offsetLeft + at.x * scale}px`;
  input.style.top = `${canvas.offsetTop + at.y * scale}px`;
  input.style.font = textFont(size * scale);
  input.style.color = viewer.color;
  input.style.minWidth = `${Math.max(40, size * scale * 4)}px`;

  // Removing the input fires `blur`, so both paths have to be one-shot —
  // otherwise Enter commits twice and Escape commits the text it was cancelling.
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const text = input.value.trim();
    closeTextEditor();
    if (!text) return;
    viewer.stacks[viewer.part].push({ type: 'text', x: at.x, y: at.y, text, size, color: viewer.color });
    replay();
  };
  const cancel = () => {
    if (settled) return;
    settled = true;
    closeTextEditor();
  };

  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // Ctrl+Z belongs to the text box while typing
    if (event.key === 'Enter') commit();
    else if (event.key === 'Escape') cancel();
  });
  app.querySelector('.stage').appendChild(input);
  viewer.editor = input;
  input.focus();

  // The blur listener goes on only once the box actually holds focus. Attaching
  // it before that lets any focus churn during the opening click close the box
  // immediately — the same failure as above, arriving by a different route.
  requestAnimationFrame(() => {
    if (viewer.editor === input) input.addEventListener('blur', commit);
  });
}

function closeTextEditor() {
  if (!viewer.editor) return;
  const input = viewer.editor;
  viewer.editor = null;
  input.remove();
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
  if (!viewer.work) return;
  // An open text box was positioned and sized for the old scale.
  closeTextEditor();
  paint();
});
