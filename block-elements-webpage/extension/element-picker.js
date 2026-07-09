// element-picker.js — Block Element Mode UI

const ElementPicker = (() => {
  let active = false;
  let currentTarget = null;
  let selectors = [];
  let currentLevel = 2;
  let customSelector = '';
  let isCustom = false;
  let scopeOption = 'exact';
  let previewActive = false;

  let overlayEl = null;
  let highlightEl = null;
  let tooltipEl = null;
  let panelEl = null;

  // ─── Entry ────────────────────────────────────────────────────────────────

  function activate() {
    if (active) return;
    active = true;
    document.body.classList.add('ef-picking');
    createChrome();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onPageClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.body.classList.remove('ef-picking');
    restorePreview();
    destroyChrome();
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onPageClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    currentTarget = null;
    selectors = [];
    panelEl = null;
  }

  // ─── Chrome elements (overlay / highlight / tooltip) ─────────────────────

  function createChrome() {
    overlayEl = document.createElement('div');
    overlayEl.id = 'ef-overlay';
    document.documentElement.appendChild(overlayEl);

    highlightEl = document.createElement('div');
    highlightEl.id = 'ef-highlight';
    document.documentElement.appendChild(highlightEl);

    tooltipEl = document.createElement('div');
    tooltipEl.id = 'ef-tooltip';
    document.documentElement.appendChild(tooltipEl);
  }

  function destroyChrome() {
    [overlayEl, highlightEl, tooltipEl, panelEl].forEach((el) => el && el.remove());
    overlayEl = highlightEl = tooltipEl = panelEl = null;
  }

  function positionHighlight(el) {
    if (!highlightEl || !el) return;
    const rect = el.getBoundingClientRect();
    highlightEl.style.top = rect.top + 'px';
    highlightEl.style.left = rect.left + 'px';
    highlightEl.style.width = rect.width + 'px';
    highlightEl.style.height = rect.height + 'px';
    highlightEl.style.display = 'block';
  }

  function positionTooltip(el, text) {
    if (!tooltipEl) return;
    const rect = el.getBoundingClientRect();
    tooltipEl.textContent = text;
    tooltipEl.style.display = 'block';

    const tipRect = tooltipEl.getBoundingClientRect();
    let top = rect.top - tipRect.height - 6;
    let left = rect.left;

    if (top < 4) top = rect.bottom + 6;
    if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
    if (left < 4) left = 4;

    tooltipEl.style.top = top + 'px';
    tooltipEl.style.left = left + 'px';
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  function onMouseOver(e) {
    if (!active || panelEl) return;
    const el = e.target;
    if (isPickerElement(el)) return;

    currentTarget = el;
    const { selectors: sels } = SelectorGenerator.generate(el);
    selectors = sels;
    const selector = selectors[Math.min(currentLevel, selectors.length - 1)];

    positionHighlight(el);
    positionTooltip(el, selector);
    e.stopPropagation();
  }

  function onPageClick(e) {
    if (!active || panelEl) return;
    const el = e.target;
    if (isPickerElement(el)) return;

    e.preventDefault();
    e.stopPropagation();

    // Freeze position
    if (highlightEl) highlightEl.style.outline = '3px solid #4F46E5';
    if (tooltipEl) tooltipEl.style.display = 'none';

    openPanel(el);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') deactivate();
  }

  function isPickerElement(el) {
    return el && (el.id === 'ef-overlay' || el.id === 'ef-highlight' || el.id === 'ef-tooltip' || el.id === 'ef-panel' || el.closest('#ef-panel'));
  }

  // ─── Panel ────────────────────────────────────────────────────────────────

  function openPanel(element) {
    currentTarget = element;
    const result = SelectorGenerator.generate(element);
    selectors = result.selectors;
    currentLevel = 2;
    isCustom = false;
    previewActive = false;
    scopeOption = 'exact';

    const hostname = location.hostname;

    panelEl = document.createElement('div');
    panelEl.id = 'ef-panel';
    panelEl.innerHTML = buildPanelHTML(hostname, result);
    document.documentElement.appendChild(panelEl);

    attachPanelListeners(result.unstableWarning);
    updateMatchCount();
    highlightMatchedElements();
  }

  function buildPanelHTML(hostname, result) {
    const baseDomain = hostname.replace(/^www\./, '');
    const parts = baseDomain.split('.');
    const root = parts.slice(0, -1).join('.');

    return `
      <div class="ef-panel-header">
        <span>Block Element</span>
        <button id="ef-close-btn" title="Cancel (Esc)">&#x2715;</button>
      </div>
      <div class="ef-panel-body">
        <div class="ef-field">
          <div class="ef-label">Site</div>
          <div class="ef-site-value">${escapeHtml(hostname)}</div>
        </div>

        <div class="ef-field">
          <div class="ef-label">Apply to</div>
          <div class="ef-radio-group" id="ef-scope-group">
            <label><input type="radio" name="ef-scope" value="exact" checked> ${escapeHtml(hostname)} only</label>
            ${root ? `<label><input type="radio" name="ef-scope" value="wildcard-sub"> *.${escapeHtml(baseDomain)}</label>` : ''}
            ${root ? `<label><input type="radio" name="ef-scope" value="wildcard-tld"> ${escapeHtml(root)}.*</label>` : ''}
            <label><input type="radio" name="ef-scope" value="custom"> Custom</label>
          </div>
          <input type="text" id="ef-custom-domain" placeholder="e.g. *.example.*" style="display:none;margin-top:6px;width:100%;box-sizing:border-box;border:1px solid #e0e7ff;border-radius:6px;padding:6px 8px;font-size:12px;outline:none;">
        </div>

        <div class="ef-field">
          <div class="ef-label">Selector</div>
          <textarea id="ef-selector-edit" class="ef-selector-edit"></textarea>
          ${result.unstableWarning ? `<div class="ef-unstable-warning">&#9888; ${escapeHtml(result.unstableWarning)}</div>` : ''}
        </div>

        <div class="ef-field">
          <div class="ef-label">Specificity</div>
          <div class="ef-slider-container">
            <span class="ef-slider-label">less</span>
            <input type="range" id="ef-specificity" class="ef-slider" min="0" max="3" value="${currentLevel}" step="1">
            <span class="ef-slider-label">more</span>
          </div>
          <div class="ef-match-count" id="ef-match-count">Checking…</div>
        </div>
      </div>
      <div class="ef-panel-footer">
        <button class="ef-btn ef-btn-ghost" id="ef-preview-btn">Preview</button>
        <button class="ef-btn ef-btn-secondary" id="ef-cancel-btn">Cancel</button>
        <button class="ef-btn ef-btn-primary" id="ef-create-btn">Create</button>
      </div>
    `;
  }

  function attachPanelListeners(unstableWarning) {
    panelEl.querySelector('#ef-close-btn').addEventListener('click', deactivate);
    panelEl.querySelector('#ef-cancel-btn').addEventListener('click', deactivate);
    panelEl.querySelector('#ef-preview-btn').addEventListener('click', togglePreview);
    panelEl.querySelector('#ef-create-btn').addEventListener('click', createRule);

    const slider = panelEl.querySelector('#ef-specificity');
    slider.addEventListener('input', () => {
      currentLevel = parseInt(slider.value, 10);
      isCustom = false;
      syncSelectorToPanel();
      clearHighlights();
      highlightMatchedElements();
    });

    const selectorEdit = panelEl.querySelector('#ef-selector-edit');
    selectorEdit.value = getCurrentSelector();
    selectorEdit.addEventListener('input', () => {
      isCustom = true;
      customSelector = selectorEdit.value.trim();
      updateMatchCount();
      clearHighlights();
      highlightMatchedElements();
    });

    const scopeRadios = panelEl.querySelectorAll('input[name="ef-scope"]');
    scopeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        scopeOption = r.value;
        const customDomainInput = panelEl.querySelector('#ef-custom-domain');
        customDomainInput.style.display = scopeOption === 'custom' ? 'block' : 'none';
      });
    });
  }

  function getCurrentSelector() {
    if (isCustom) return customSelector;
    return selectors[Math.min(currentLevel, selectors.length - 1)] || '';
  }

  function syncSelectorToPanel() {
    const edit = panelEl && panelEl.querySelector('#ef-selector-edit');
    if (edit) edit.value = getCurrentSelector();
    updateMatchCount();
  }

  function updateMatchCount() {
    const countEl = panelEl && panelEl.querySelector('#ef-match-count');
    if (!countEl) return;

    const sel = getCurrentSelector();
    if (!sel) {
      countEl.textContent = 'No selector';
      countEl.className = 'ef-match-count ef-warning';
      setCreateDisabled(true);
      return;
    }

    if (!SelectorGenerator.isValidSelector(sel)) {
      countEl.textContent = 'Invalid CSS selector';
      countEl.className = 'ef-match-count ef-error';
      setCreateDisabled(true);
      return;
    }

    const count = SelectorGenerator.countMatches(sel);
    if (count === 0) {
      countEl.textContent = 'No elements matched this selector';
      countEl.className = 'ef-match-count ef-warning';
      setCreateDisabled(false); // allow save with warning
    } else {
      countEl.textContent = `Matched elements: ${count}`;
      countEl.className = 'ef-match-count';
      setCreateDisabled(false);
    }
  }

  function setCreateDisabled(disabled) {
    const btn = panelEl && panelEl.querySelector('#ef-create-btn');
    if (btn) btn.disabled = disabled;
  }

  // ─── Highlight matched elements ───────────────────────────────────────────

  const HIGHLIGHT_CLASS = 'ef-selector-match';
  const HIGHLIGHT_STYLE_ID = 'ef-selector-match-style';

  function highlightMatchedElements() {
    removeHighlightStyle();
    const sel = getCurrentSelector();
    if (!sel || !SelectorGenerator.isValidSelector(sel)) return;

    const style = document.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `${sel} { outline: 2px solid #F59E0B !important; background: rgba(245,158,11,0.1) !important; }`;
    document.head.appendChild(style);
  }

  function clearHighlights() {
    removeHighlightStyle();
  }

  function removeHighlightStyle() {
    const s = document.getElementById(HIGHLIGHT_STYLE_ID);
    if (s) s.remove();
  }

  // ─── Preview ──────────────────────────────────────────────────────────────

  const PREVIEW_STYLE_ID = 'ef-preview-style';

  function togglePreview() {
    const btn = panelEl.querySelector('#ef-preview-btn');
    if (previewActive) {
      restorePreview();
      btn.textContent = 'Preview';
    } else {
      const sel = getCurrentSelector();
      if (!sel || !SelectorGenerator.isValidSelector(sel)) return;
      const style = document.createElement('style');
      style.id = PREVIEW_STYLE_ID;
      style.textContent = `${sel} { display: none !important; }`;
      document.head.appendChild(style);
      previewActive = true;
      btn.textContent = 'Restore';
    }
  }

  function restorePreview() {
    const s = document.getElementById(PREVIEW_STYLE_ID);
    if (s) s.remove();
    previewActive = false;
  }

  // ─── Create rule ──────────────────────────────────────────────────────────

  function createRule() {
    const selector = getCurrentSelector();
    if (!selector || !SelectorGenerator.isValidSelector(selector)) return;

    const hostname = location.hostname;
    const baseDomain = hostname.replace(/^www\./, '');
    const parts = baseDomain.split('.');
    const root = parts.slice(0, -1).join('.');

    let domainPattern;
    switch (scopeOption) {
      case 'wildcard-sub':
        domainPattern = '*.' + baseDomain;
        break;
      case 'wildcard-tld':
        domainPattern = root + '.*';
        break;
      case 'custom': {
        const customInput = panelEl.querySelector('#ef-custom-domain');
        domainPattern = (customInput && customInput.value.trim()) || hostname;
        break;
      }
      default:
        domainPattern = hostname;
    }

    const rule = {
      enabled: true,
      domainPattern,
      pathPattern: null,
      selector,
      action: 'hide',
      hideMode: 'display-none',
      createdFromUrl: location.href,
      matchedCountAtCreation: SelectorGenerator.countMatches(selector),
    };

    chrome.runtime.sendMessage({ type: 'saveRule', rule }, (res) => {
      if (res && res.success) {
        showSuccess(rule);
      }
    });
  }

  function showSuccess(rule) {
    restorePreview();
    clearHighlights();

    // Apply hide immediately
    const styleId = 'ef-applied-' + Date.now();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `${rule.selector} { display: none !important; }`;
    document.head.appendChild(style);

    const ruleStr = `${rule.domainPattern}##${rule.selector}`;

    panelEl.innerHTML = `
      <div class="ef-panel-header">
        <span>Filter Created</span>
        <button id="ef-close-btn2" title="Close">&#x2715;</button>
      </div>
      <div class="ef-panel-body">
        <div class="ef-success-msg">${escapeHtml(ruleStr)}</div>
        <p style="font-size:12px;color:#6b7280;margin:0;">Element is now hidden. The filter will apply automatically on future visits.</p>
      </div>
      <div class="ef-panel-footer">
        <button class="ef-btn ef-btn-primary" id="ef-done-btn" style="flex:none;width:100%">Done</button>
      </div>
    `;

    panelEl.querySelector('#ef-close-btn2').addEventListener('click', deactivate);
    panelEl.querySelector('#ef-done-btn').addEventListener('click', deactivate);

    if (highlightEl) highlightEl.style.display = 'none';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { activate, deactivate, isActive: () => active };
})();
