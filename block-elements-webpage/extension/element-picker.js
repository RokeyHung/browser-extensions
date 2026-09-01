// element-picker.js — Block Element / Inspect Element UI
//
// One picker, two tabs: "Block" creates a filter rule, "Inspect" reports what
// element-inspector.js found. Both operate on the same picked element, so you
// can check what you are about to hide before hiding it.

const ElementPicker = (() => {
  let active = false;
  let currentTarget = null;
  let selectors = [];
  let unstableWarning = null;
  let currentLevel = 2;
  let customSelector = '';
  let isCustom = false;
  let scopeOption = 'exact';
  let customDomain = '';
  let previewActive = false;
  let activeTab = 'block';
  let report = null;

  let overlayEl = null;
  let highlightEl = null;
  let tooltipEl = null;
  let panelEl = null;

  // Names for the four levels produced by SelectorGenerator, in slider order.
  const LEVEL_LABELS = ['Least specific', 'Medium', 'Specific', 'Full path'];

  // Second-level labels a registry uses to group registrations rather than to
  // name a site: the `co` in `co.uk`, the `com` in `com.vn`.
  const REGISTRY_LABELS = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gob', 'nom']);

  // The site's own label, for the "any TLD" scope button — `shop` for
  // shop.test, www.shop.test, news.shop.test and shop.co.uk alike.
  //
  // Taking hostname-minus-last-label instead produced `news.shop` and `shop.co`,
  // neither of which any host can match, so the button silently wrote rules that
  // never fired. Stepping left past registry labels covers the ccSLD shapes
  // without shipping a public suffix list; this only suggests a pattern, and
  // Custom is there for the cases the guess gets wrong.
  // Returns null for hosts with no label to generalise (localhost, an IP).
  function siteLabel(hostname) {
    const parts = hostname.replace(/^www\./, '').split('.');
    if (parts.length < 2 || /^\d+$/.test(parts[parts.length - 1])) return null;
    let i = parts.length - 2;
    while (i > 0 && REGISTRY_LABELS.has(parts[i])) i--;
    return parts[i] || null;
  }

  // ─── Entry ────────────────────────────────────────────────────────────────

  // mode: 'block' (default) or 'inspect' — decides which tab opens first.
  function activate(mode) {
    if (active) return;
    active = true;
    activeTab = mode === 'inspect' ? 'inspect' : 'block';
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
    report = null;
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
    unstableWarning = result.unstableWarning;
    currentLevel = 2;
    isCustom = false;
    previewActive = false;
    scopeOption = 'exact';
    report = null;

    panelEl = document.createElement('div');
    panelEl.id = 'ef-panel';
    document.documentElement.appendChild(panelEl);

    renderPanel();
  }

  // Re-renders header, tab bar, body and footer for the active tab. Selector
  // state (level, custom text, scope) lives in module scope, so switching tabs
  // and coming back keeps whatever was typed.
  function renderPanel() {
    const isInspect = activeTab === 'inspect';

    // Tabs are the top row of the panel: the old header title just repeated the
    // active tab's name.
    panelEl.innerHTML = `
      <div class="ef-panel-header ef-header-tabs">
        <div class="ef-tabs">
          <button class="ef-tab ${isInspect ? '' : 'ef-tab-active'}" data-tab="block">Block</button>
          <button class="ef-tab ${isInspect ? 'ef-tab-active' : ''}" data-tab="inspect">Inspect</button>
        </div>
        <button id="ef-close-btn" title="Cancel (Esc)">&#x2715;</button>
      </div>
      ${isInspect ? buildInspectHTML() : buildBlockHTML(location.hostname)}
    `;

    panelEl.querySelector('#ef-close-btn').addEventListener('click', deactivate);
    panelEl.querySelectorAll('.ef-tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    if (isInspect) {
      attachInspectListeners();
    } else {
      attachPanelListeners();
      updateLevelIndicator();
      updateMatchCount();
      highlightMatchedElements();
    }
  }

  function switchTab(tab) {
    if (tab === activeTab) return;
    // Preview hides the element, which would make every computed style read as
    // "not visible" — restore it before inspecting.
    if (tab === 'inspect') {
      restorePreview();
      clearHighlights();
    }
    activeTab = tab;
    renderPanel();
  }

  function buildBlockHTML(hostname) {
    const baseDomain = hostname.replace(/^www\./, '');
    const root = siteLabel(hostname);

    return `
      <div class="ef-panel-body">
        <div class="ef-field">
          <div class="ef-label">Site</div>
          <div class="ef-site-value">${escapeHtml(hostname)}</div>
        </div>

        <div class="ef-field">
          <div class="ef-label">Apply to</div>
          <div class="ef-radio-group" id="ef-scope-group">
            <label><input type="radio" name="ef-scope" value="exact" ${scopeOption === 'exact' ? 'checked' : ''}> ${escapeHtml(baseDomain)} <span style="color:#9ca3af">(+ www &amp; subdomains)</span></label>
            ${root ? `<label><input type="radio" name="ef-scope" value="wildcard-sub" ${scopeOption === 'wildcard-sub' ? 'checked' : ''}> *.${escapeHtml(baseDomain)}</label>` : ''}
            ${root ? `<label><input type="radio" name="ef-scope" value="wildcard-tld" ${scopeOption === 'wildcard-tld' ? 'checked' : ''}> ${escapeHtml(root)}.*</label>` : ''}
            <label><input type="radio" name="ef-scope" value="custom" ${scopeOption === 'custom' ? 'checked' : ''}> Custom</label>
          </div>
          <input type="text" id="ef-custom-domain" placeholder="e.g. *.example.*" value="${escapeHtml(customDomain)}" style="display:${scopeOption === 'custom' ? 'block' : 'none'};margin-top:6px;width:100%;box-sizing:border-box;border:1px solid #e0e7ff;border-radius:6px;padding:6px 8px;font-size:12px;outline:none;">
        </div>

        <div class="ef-field">
          <div class="ef-label">Selector</div>
          <textarea id="ef-selector-edit" class="ef-selector-edit"></textarea>
          ${unstableWarning ? `<div class="ef-unstable-warning">&#9888; ${escapeHtml(unstableWarning)}</div>` : ''}
        </div>

        <div class="ef-field">
          <div class="ef-label ef-label-row">
            <span>Specificity</span>
            <span class="ef-level-badge" id="ef-level-badge"></span>
          </div>
          <div class="ef-slider-container">
            <span class="ef-slider-label">less</span>
            <input type="range" id="ef-specificity" class="ef-slider" min="0" max="3" value="${currentLevel}" step="1">
            <span class="ef-slider-label">more</span>
          </div>
          <div class="ef-ticks">
            ${LEVEL_LABELS.map((label, index) => `<button class="ef-tick" data-level="${index}" title="${escapeHtml(label)}">${index + 1}</button>`).join('')}
          </div>
          <div class="ef-match-count" id="ef-match-count">Checking…</div>
        </div>
      </div>
      <div class="ef-panel-footer">
        <button class="ef-btn ef-btn-ghost" id="ef-preview-btn">${previewActive ? 'Restore' : 'Preview'}</button>
        <button class="ef-btn ef-btn-secondary" id="ef-cancel-btn">Cancel</button>
        <button class="ef-btn ef-btn-primary" id="ef-create-btn">Create</button>
      </div>
    `;
  }

  function attachPanelListeners() {
    panelEl.querySelector('#ef-cancel-btn').addEventListener('click', deactivate);
    panelEl.querySelector('#ef-preview-btn').addEventListener('click', togglePreview);
    panelEl.querySelector('#ef-create-btn').addEventListener('click', createRule);

    const slider = panelEl.querySelector('#ef-specificity');
    slider.addEventListener('input', () => setLevel(parseInt(slider.value, 10)));

    // The numbered ticks do the same job as the slider. They exist because a
    // native range input is easy for page CSS to wash out, and because the
    // level names are otherwise invisible.
    panelEl.querySelectorAll('.ef-tick').forEach((tick) => {
      tick.addEventListener('click', () => setLevel(Number(tick.dataset.level)));
    });

    const selectorEdit = panelEl.querySelector('#ef-selector-edit');
    selectorEdit.value = getCurrentSelector();
    selectorEdit.addEventListener('input', () => {
      isCustom = true;
      customSelector = selectorEdit.value.trim();
      updateLevelIndicator();
      updateMatchCount();
      clearHighlights();
      highlightMatchedElements();
    });

    const customDomainInput = panelEl.querySelector('#ef-custom-domain');
    customDomainInput.addEventListener('input', () => {
      customDomain = customDomainInput.value;
    });

    const scopeRadios = panelEl.querySelectorAll('input[name="ef-scope"]');
    scopeRadios.forEach((r) => {
      r.addEventListener('change', () => {
        scopeOption = r.value;
        customDomainInput.style.display = scopeOption === 'custom' ? 'block' : 'none';
      });
    });
  }

  function setLevel(level) {
    currentLevel = level;
    isCustom = false;

    const slider = panelEl && panelEl.querySelector('#ef-specificity');
    if (slider) slider.value = String(level);

    updateLevelIndicator();
    syncSelectorToPanel();
    clearHighlights();
    highlightMatchedElements();
  }

  // Shows which level is active as text, so it does not depend on the slider
  // thumb being visible.
  function updateLevelIndicator() {
    if (!panelEl) return;

    const badge = panelEl.querySelector('#ef-level-badge');
    if (badge) badge.textContent = isCustom ? 'edited by hand' : `${currentLevel + 1}/4 · ${LEVEL_LABELS[currentLevel]}`;

    panelEl.querySelectorAll('.ef-tick').forEach((tick) => {
      tick.classList.toggle('ef-tick-active', !isCustom && Number(tick.dataset.level) === currentLevel);
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
    const root = siteLabel(hostname);

    let domainPattern;
    switch (scopeOption) {
      case 'wildcard-sub':
        domainPattern = '*.' + baseDomain;
        break;
      case 'wildcard-tld':
        // The radio is only offered when there is a label to generalise, but a
        // stale scopeOption could still arrive here — fall back rather than
        // write "null.*".
        domainPattern = root ? root + '.*' : baseDomain;
        break;
      case 'custom': {
        const customInput = panelEl.querySelector('#ef-custom-domain');
        domainPattern = (customInput && customInput.value.trim()) || hostname;
        break;
      }
      default:
        // bare domain (without www.) — matcher applies it to the root domain, www. and subdomains
        domainPattern = baseDomain;
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

    sendToBackground({ type: 'saveRule', rule }, (res) => {
      if (res && res.success) {
        showSuccess(rule);
      } else {
        showPanelError('Could not save the filter. Check the console for details.');
      }
    });
  }

  // A content script keeps running after the extension is reloaded or updated,
  // but its chrome.runtime is torn down — sendMessage then throws and the click
  // appears to do nothing. Detect that and say what to do instead.
  function sendToBackground(message, callback) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
      showPanelError('Element Filter was reloaded or updated. Refresh this page (F5), then pick the element again.');
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          showPanelError(`Extension not reachable: ${chrome.runtime.lastError.message}. Refresh this page and try again.`);
          return;
        }
        callback(res);
      });
    } catch (err) {
      showPanelError(`Extension not reachable: ${err.message}. Refresh this page and try again.`);
    }
  }

  function showPanelError(message) {
    if (!panelEl) return;
    const body = panelEl.querySelector('.ef-panel-body');
    if (!body) return;

    let box = panelEl.querySelector('#ef-panel-error');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ef-panel-error';
      box.className = 'ef-panel-error';
      body.insertBefore(box, body.firstChild);
    }
    box.textContent = message;
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

  // ─── Inspect tab ──────────────────────────────────────────────────────────

  function buildInspectHTML() {
    report = report || ElementInspector.inspect(currentTarget);
    const r = report;

    const identity = [r.tag, r.id ? `#${r.id}` : '', r.stableClasses.length ? `.${r.stableClasses.join('.')}` : ''].filter(Boolean).join('');

    return `
      <div class="ef-panel-body ef-inspect-body">
        <div class="ef-insp-identity">${escapeHtml(identity)}</div>
        ${r.text ? `<div class="ef-insp-text">“${escapeHtml(r.text)}”</div>` : ''}

        <div class="ef-insp-section">
          <div class="ef-label">CSS selectors</div>
          ${r.selectors
            .map((selector, index) => {
              const count = r.selectorMatches[index];
              const badge = count === 1 ? 'ef-count-unique' : count === 0 || count === -1 ? 'ef-count-bad' : 'ef-count-many';
              return `
                <div class="ef-insp-sel">
                  <div class="ef-insp-sel-head">
                    <span class="ef-insp-sel-level">${LEVEL_LABELS[index]}</span>
                    <span class="ef-insp-count ${badge}">${count === -1 ? 'invalid' : `${count} match${count === 1 ? '' : 'es'}`}</span>
                    <button class="ef-copy" data-copy="${escapeHtml(selector)}">Copy</button>
                  </div>
                  <code class="ef-code">${escapeHtml(selector)}</code>
                </div>`;
            })
            .join('')}
          ${r.unstableWarning ? `<div class="ef-unstable-warning">&#9888; ${escapeHtml(r.unstableWarning)}</div>` : ''}
        </div>

        <div class="ef-insp-section">
          <div class="ef-label">
            XPath
            <span class="ef-insp-count ${r.xpathMatches === 1 ? 'ef-count-unique' : r.xpathMatches < 1 ? 'ef-count-bad' : 'ef-count-many'}">${r.xpathMatches === -1 ? 'invalid' : `${r.xpathMatches} match${r.xpathMatches === 1 ? '' : 'es'}`}</span>
          </div>
          <div class="ef-insp-sel">
            <code class="ef-code">${escapeHtml(r.xpath)}</code>
            <button class="ef-copy ef-copy-block" data-copy="${escapeHtml(r.xpath)}">Copy XPath</button>
          </div>
        </div>

        ${buildContrastHTML(r)}

        <div class="ef-insp-section">
          <div class="ef-label">Accessibility</div>
          ${
            r.findings.length
              ? r.findings
                  .map(
                    (finding) => `
                      <div class="ef-finding ef-finding-${finding.level}">
                        <span class="ef-finding-dot"></span>
                        <span>${escapeHtml(finding.message)}</span>
                      </div>`
                  )
                  .join('')
              : '<div class="ef-finding ef-finding-ok"><span class="ef-finding-dot"></span><span>No issues found in these checks.</span></div>'
          }
          ${
            r.accessibleName
              ? `<div class="ef-insp-kv"><span>Accessible name</span><span>${escapeHtml(r.accessibleName.name)} <em>(${escapeHtml(r.accessibleName.from)})</em></span></div>`
              : ''
          }
        </div>

        <div class="ef-insp-section">
          <div class="ef-label">Computed styles</div>
          <div class="ef-insp-kv"><span>Size</span><span>${r.box.width} × ${r.box.height}</span></div>
          <div class="ef-insp-kv"><span>Display</span><span>${escapeHtml(r.styles.display)}</span></div>
          <div class="ef-insp-kv"><span>Position</span><span>${escapeHtml(r.styles.position)}${r.styles.zIndex !== 'auto' ? ` · z-index ${escapeHtml(r.styles.zIndex)}` : ''}</span></div>
          <div class="ef-insp-kv"><span>Font</span><span>${escapeHtml(r.styles.font)}</span></div>
          <div class="ef-insp-kv"><span>Overflow</span><span>${escapeHtml(r.styles.overflow)}</span></div>
          <div class="ef-insp-kv"><span>Opacity</span><span>${escapeHtml(r.styles.opacity)}</span></div>
          <div class="ef-insp-kv"><span>Margin</span><span>${escapeHtml(r.boxModel.margin)}</span></div>
          <div class="ef-insp-kv"><span>Border</span><span>${escapeHtml(r.boxModel.border)}</span></div>
          <div class="ef-insp-kv"><span>Padding</span><span>${escapeHtml(r.boxModel.padding)}</span></div>
        </div>
      </div>
      <div class="ef-panel-footer">
        <button class="ef-btn ef-btn-secondary" id="ef-insp-close">Close</button>
        <button class="ef-btn ef-btn-primary" id="ef-insp-block">Block this</button>
      </div>
    `;
  }

  function buildContrastHTML(r) {
    if (!r.contrast) {
      return `
        <div class="ef-insp-section">
          <div class="ef-label">Contrast</div>
          <div class="ef-insp-muted">No direct text in this element — pick the element that holds the text.</div>
        </div>`;
    }

    if (r.contrast.unsupported) {
      return `
        <div class="ef-insp-section">
          <div class="ef-label">Contrast</div>
          <div class="ef-insp-muted">Colour uses a format this checker cannot read.</div>
        </div>`;
    }

    const c = r.contrast;
    const verdict = c.passesAAA ? 'AAA' : c.passesAA ? 'AA' : 'Fail';
    const verdictClass = c.passesAAA ? 'ef-pass-aaa' : c.passesAA ? 'ef-pass-aa' : 'ef-pass-fail';

    return `
      <div class="ef-insp-section">
        <div class="ef-label">Contrast</div>
        <div class="ef-contrast-row">
          <span class="ef-swatch" style="background:${c.foregroundHex}"></span>
          <span class="ef-swatch" style="background:${c.backgroundHex}"></span>
          <span class="ef-contrast-ratio">${c.ratio}:1</span>
          <span class="ef-contrast-verdict ${verdictClass}">${verdict}</span>
        </div>
        <div class="ef-insp-kv"><span>Text</span><span>${escapeHtml(c.foreground)}</span></div>
        <div class="ef-insp-kv"><span>Background</span><span>${escapeHtml(c.background)}</span></div>
        <div class="ef-insp-kv"><span>Threshold</span><span>${c.largeText ? 'large text — AA 3:1, AAA 4.5:1' : 'normal text — AA 4.5:1, AAA 7:1'}</span></div>
      </div>`;
  }

  function attachInspectListeners() {
    panelEl.querySelector('#ef-insp-close').addEventListener('click', deactivate);
    panelEl.querySelector('#ef-insp-block').addEventListener('click', () => switchTab('block'));

    panelEl.querySelectorAll('.ef-copy').forEach((btn) => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.copy, btn));
    });
  }

  // clipboard.writeText is blocked on some pages by permissions policy, so fall
  // back to the old execCommand path rather than failing silently.
  async function copyToClipboard(text, btn) {
    const label = btn.textContent;
    let ok = true;

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const scratch = document.createElement('textarea');
        scratch.value = text;
        scratch.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(scratch);
        scratch.select();
        ok = document.execCommand('copy');
        scratch.remove();
      } catch {
        ok = false;
      }
    }

    btn.textContent = ok ? 'Copied' : 'Failed';
    setTimeout(() => {
      btn.textContent = label;
    }, 1200);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return { activate, deactivate, isActive: () => active };
})();
