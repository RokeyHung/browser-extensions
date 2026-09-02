// form-scanner.js — capture the forms and fields of the current page.
// Runs in the content script context. Spec §6.

if (typeof FormScanner === 'undefined') {
  var FormScanner = (() => {
    const CONTROL_QUERY = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
    const NON_FIELD_INPUT_TYPES = new Set(['submit', 'button', 'reset', 'image']);
    const SENSITIVE = /otp|captcha|cvv|cvc|card.?number|security.?code|one.?time|verification.?code/i;
    const MAX_FIELDS_PER_FORM = 500;
    const ORPHAN_KEY = '__orphan__';

    function hash(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
      return (h >>> 0).toString(16);
    }

    function isVisible(el) {
      if (!el.isConnected) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && el.type !== 'hidden') return false;
      return true;
    }

    function kindOf(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') return 'input';
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select') return 'select';
      return 'contenteditable';
    }

    function typeOf(el) {
      const kind = kindOf(el);
      if (kind === 'input') return (el.getAttribute('type') || 'text').toLowerCase();
      if (kind === 'select') return el.multiple ? 'select-multiple' : 'select-one';
      return kind;
    }

    function isScannable(el) {
      const kind = kindOf(el);
      if (kind === 'input' && NON_FIELD_INPUT_TYPES.has(typeOf(el))) return false;
      // Skip our own UI, should it ever be injected into the page.
      if (el.closest('[data-form-fill-profiles]')) return false;
      return true;
    }

    // Reason this field will not be stored, or null when it is usable. Spec §6.5.
    function exclusionReason(el, labelText, settings) {
      const type = typeOf(el);
      const name = el.getAttribute('name') || '';
      const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();

      if (type === 'file') return 'file-not-supported';
      if (type === 'password' && !settings.includePasswordFields) return 'password-excluded-by-settings';
      if (type === 'hidden' && !settings.includeHiddenFields) return 'hidden-excluded-by-settings';
      if (el.disabled) return 'disabled';
      if (el.readOnly) return 'readonly';
      if (autocomplete === 'one-time-code') return 'sensitive-field';
      if (SENSITIVE.test(name) || SENSITIVE.test(labelText)) return 'sensitive-field';
      if (type !== 'hidden' && !settings.includeHiddenFields && !isVisible(el)) return 'not-visible';
      return null;
    }

    function optionsOf(el) {
      return Array.from(el.options || []).map((opt) => ({
        value: opt.value,
        label: LabelResolver.clean(opt.textContent) || opt.value,
      }));
    }

    function currentValue(el) {
      const kind = kindOf(el);
      if (kind === 'select') {
        if (el.multiple) return Array.from(el.selectedOptions).map((o) => o.value);
        return el.value;
      }
      if (kind === 'contenteditable') return el.textContent || '';
      if (el.type === 'checkbox') return el.checked;
      return el.value;
    }

    // Group controls by the form they belong to. Controls outside any <form>
    // land in a single pseudo-form. Spec §6.1.
    function groupControls(settings) {
      const groups = new Map();

      for (const el of document.querySelectorAll(CONTROL_QUERY)) {
        if (!isScannable(el)) continue;
        const formEl = el.form || el.closest('form') || null;
        const key = formEl || ORPHAN_KEY;
        if (!groups.has(key)) groups.set(key, []);
        const bucket = groups.get(key);
        if (bucket.length < MAX_FIELDS_PER_FORM) bucket.push(el);
      }

      return groups;
    }

    // Heading before legend: `querySelector('legend')` returns the first legend
    // anywhere inside the form, which on the very common "heading + a fieldset
    // grouping the radios" shape is the group's name, not the form's — a signup
    // form came out labelled "Preferred contact". A legend is still the right
    // answer when it is the only thing naming the form, so it stays as the next
    // fallback.
    function formLabelOf(formEl, index) {
      if (!formEl) return 'Fields outside form';
      const aria = formEl.getAttribute('aria-label');
      if (aria) return LabelResolver.clean(aria);
      const heading = formEl.querySelector('h1, h2, h3, h4');
      if (heading?.textContent.trim()) return LabelResolver.clean(heading.textContent);
      const legend = formEl.querySelector('legend');
      if (legend?.textContent.trim()) return LabelResolver.clean(legend.textContent);
      if (formEl.id && !FieldSelector.isRandomId(formEl.id)) return `Form #${formEl.id}`;
      if (formEl.name) return `Form ${formEl.name}`;
      if (document.title) return `${LabelResolver.clean(document.title).slice(0, 60)} form`;
      return `Form #${index + 1}`;
    }

    function pad(n) {
      return String(n).padStart(2, '0');
    }

    // Build the field list of one group, folding radios with the same name into
    // a single field. Spec §6.2.
    function buildFields(controls, container, settings) {
      const fields = [];
      const radioGroups = new Map();
      // Position of the field among the controls of the same kind, used as the
      // last-resort way to find it again at apply time. Spec §9.2.
      const kindCounters = { input: 0, textarea: 0, select: 0, contenteditable: 0 };
      let index = 0;

      for (const el of controls) {
        const type = typeOf(el);
        const name = el.getAttribute('name') || '';

        if (type === 'radio' && name) {
          if (!radioGroups.has(name)) radioGroups.set(name, []);
          radioGroups.get(name).push(el);
          continue;
        }

        const labelText = LabelResolver.resolve(el, index);
        const kind = kindOf(el);
        const excludedReason = exclusionReason(el, labelText, settings);

        fields.push({
          fieldId: `f_${pad(++index)}`,
          kind,
          type,
          name: name || null,
          id: el.id || null,
          selector: FieldSelector.generate(el, container),
          testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-qa') || null,
          labelText,
          placeholder: el.getAttribute('placeholder') || null,
          required: !!el.required,
          domIndex: kindCounters[kind]++,
          options: kind === 'select' ? optionsOf(el) : null,
          currentValue: excludedReason ? null : currentValue(el),
          excluded: !!excludedReason,
          excludedReason,
        });
      }

      // Radio groups keep the label of the group plus the label of each option.
      for (const [name, elements] of radioGroups) {
        const labelText = LabelResolver.resolveGroup(elements, index);
        const excludedReason = exclusionReason(elements[0], labelText, settings);
        const checked = elements.find((el) => el.checked);

        fields.push({
          fieldId: `f_${pad(++index)}`,
          kind: 'radio',
          type: 'radio',
          name,
          id: elements[0].id || null,
          selector: FieldSelector.generate(elements[0], container),
          testId: null,
          labelText,
          placeholder: null,
          required: elements.some((el) => el.required),
          domIndex: 0,
          options: elements.map((el) => ({ value: el.value, label: LabelResolver.resolveOption(el) })),
          currentValue: excludedReason ? null : (checked?.value ?? null),
          excluded: !!excludedReason,
          excludedReason,
        });
      }

      return fields;
    }

    function signatureOf(formEl, fields) {
      const identity = formEl
        ? formEl.id || formEl.getAttribute('name') || (formEl.action ? new URL(formEl.action, location.href).pathname : '')
        : ORPHAN_KEY;
      const names = fields
        .map((f) => f.name || f.labelText)
        .sort()
        .join(',');
      return `${identity || 'form'}:${names}`;
    }

    // Snapshot of every form on the page. Spec §6.7.
    function scan(settings) {
      const options = {
        includePasswordFields: false,
        includeHiddenFields: false,
        ...(settings || {}),
      };

      const groups = groupControls(options);
      const forms = [];
      let index = 0;

      for (const [key, controls] of groups) {
        const formEl = key === ORPHAN_KEY ? null : key;
        const container = formEl || document;
        const fields = buildFields(controls, container, options);
        if (!fields.length) continue;

        const signature = signatureOf(formEl, fields);
        forms.push({
          formKey: hash(signature),
          signature,
          formLabel: formLabelOf(formEl, index),
          containerSelector: formEl ? FieldSelector.generateContainer(formEl) : null,
          isOrphan: !formEl,
          sourceUrl: location.href,
          hostname: location.hostname,
          pathname: location.pathname,
          fieldCount: fields.filter((f) => !f.excluded).length,
          excludedCount: fields.filter((f) => f.excluded).length,
          fields,
        });
        index++;
      }

      return {
        url: location.href,
        hostname: location.hostname,
        pathname: location.pathname,
        title: document.title,
        forms,
      };
    }

    // Cheap count for the popup — no selector generation.
    function count() {
      let fields = 0;
      const formEls = new Set();
      for (const el of document.querySelectorAll(CONTROL_QUERY)) {
        if (!isScannable(el)) continue;
        fields++;
        formEls.add(el.form || el.closest('form') || ORPHAN_KEY);
      }
      return { forms: formEls.size, fields };
    }

    return { scan, count, hash };
  })();
}
