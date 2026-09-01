// options.js — three controls, no save button (spec §13). Each change is
// written straight through, because a settings page with three switches has
// nothing to batch.

const saved = document.getElementById('saved');

function fields() {
  return { preloadLazyImages: document.getElementById('preloadLazyImages') };
}

function radio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function fill(settings) {
  const { preloadLazyImages } = fields();
  preloadLazyImages.checked = settings.preloadLazyImages;
  radio('format', settings.format);
  radio('afterCapture', settings.afterCapture);
}

function flashSaved() {
  saved.hidden = false;
  clearTimeout(flashSaved.timer);
  flashSaved.timer = setTimeout(() => (saved.hidden = true), 1200);
}

async function patch(change) {
  await globalThis.Settings.save(change);
  flashSaved();
}

async function init() {
  fill(await globalThis.Settings.get());

  const { preloadLazyImages } = fields();
  preloadLazyImages.addEventListener('change', () => patch({ preloadLazyImages: preloadLazyImages.checked }));

  for (const input of document.querySelectorAll('input[name="format"]')) {
    input.addEventListener('change', () => patch({ format: input.value }));
  }
  for (const input of document.querySelectorAll('input[name="afterCapture"]')) {
    input.addEventListener('change', () => patch({ afterCapture: input.value }));
  }

  document.getElementById('reset').addEventListener('click', async () => {
    fill(await globalThis.Settings.reset());
    flashSaved();
  });
}

init();
