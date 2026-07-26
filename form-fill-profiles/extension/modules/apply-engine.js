// apply-engine.js — write a profile's values into the live form on the page.
// Runs in the content script context. Spec §9.

if (typeof ApplyEngine === 'undefined') {
  var ApplyEngine = (() => {
    const TEXT_LIKE = new Set([
      'text',
      'email',
      'tel',
      'url',
      'search',
      'password',
      'number',
      'date',
      'time',
      'datetime-local',
      'month',
      'week',
      'range',
      'color',
      'hidden',
      'textarea',
    ]);

    // ─── Value writing ─────────────────────────────────────────────────────────

    // React (and other frameworks) track the value on their own copy of the
    // element; going through the prototype setter is what makes them notice.
    function setNativeValue(el, value) {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor?.set) descriptor.set.call(el, value);
      else el.value = value;
    }

    function fire(el, type) {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    }

    function dispatchAll(el, settings) {
      if (!settings.dispatchEvents) return;
      el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      fire(el, 'input');
      fire(el, 'change');
      el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    }

    function writeTextLike(el, value, settings) {
      setNativeValue(el, value == null ? '' : String(value));
      dispatchAll(el, settings);
      return { ok: true };
    }

    function writeCheckbox(el, value, settings) {
      const want = value === true || value === 'true' || value === 'on';
      if (el.checked === want) return { ok: true };
      // A programmatic click flips the state and fires input+change the way a
      // real user interaction does, which UI libraries listen for.
      if (settings.dispatchEvents) el.click();
      else el.checked = want;
      if (el.checked !== want) {
        el.checked = want;
        dispatchAll(el, settings);
      }
      return { ok: true };
    }

    function writeRadio(el, value, settings, container) {
      const scope = container || document;
      const name = el.getAttribute('name');
      const group = name ? Array.from(scope.querySelectorAll(`input[type="radio"][name="${FieldSelector.escape(name)}"]`)) : [el];
      const target = group.find((radio) => radio.value === String(value));
      if (!target) return { ok: false, reason: 'option-missing' };
      if (!target.checked) {
        if (settings.dispatchEvents) target.click();
        else target.checked = true;
        if (!target.checked) {
          target.checked = true;
          dispatchAll(target, settings);
        }
      }
      return { ok: true };
    }

    // Stored selects keep both value and label so a changed option value can
    // still be matched by its text. Spec §9.3.
    function findOption(el, stored) {
      const wanted = stored && typeof stored === 'object' ? stored : { value: stored, label: null };
      const options = Array.from(el.options);
      let option = options.find((o) => o.value === String(wanted.value ?? ''));
      if (!option && wanted.label) {
        const label = String(wanted.label).trim().toLowerCase();
        option = options.find((o) => (o.textContent || '').trim().toLowerCase() === label);
      }
      return option;
    }

    function writeSelectOne(el, value, settings) {
      const option = findOption(el, value);
      if (!option) return { ok: false, reason: 'option-missing' };
      setNativeValue(el, option.value);
      dispatchAll(el, settings);
      return { ok: true };
    }

    function writeSelectMultiple(el, value, settings) {
      const wanted = Array.isArray(value) ? value : [value];
      const matched = wanted.map((item) => findOption(el, item)).filter(Boolean);
      if (!matched.length) return { ok: false, reason: 'option-missing' };
      for (const option of el.options) option.selected = matched.includes(option);
      dispatchAll(el, settings);
      return { ok: true, partial: matched.length !== wanted.length };
    }

    function writeContentEditable(el, value, settings) {
      el.textContent = value == null ? '' : String(value);
      if (settings.dispatchEvents) {
        fire(el, 'input');
        fire(el, 'change');
      }
      return { ok: true };
    }

    function writeField(field, el, value, settings, container) {
      if (field.kind === 'radio') return writeRadio(el, value, settings, container);
      if (field.kind === 'select') {
        return field.type === 'select-multiple' ? writeSelectMultiple(el, value, settings) : writeSelectOne(el, value, settings);
      }
      if (field.kind === 'contenteditable') return writeContentEditable(el, value, settings);
      if (field.type === 'checkbox') return writeCheckbox(el, value, settings);
      if (field.type === 'file') return { ok: false, reason: 'file-not-supported' };
      if (TEXT_LIKE.has(field.type) || field.kind === 'textarea') return writeTextLike(el, value, settings);
      // Unknown input type — treat it as text rather than skipping it.
      return writeTextLike(el, value, settings);
    }

    // ─── Field resolution ──────────────────────────────────────────────────────

    function queryAll(scope, selector) {
      if (!selector) return [];
      try {
        return Array.from(scope.querySelectorAll(selector));
      } catch {
        return [];
      }
    }

    function tagsFor(field) {
      if (field.kind === 'select') return ['select'];
      if (field.kind === 'textarea') return ['textarea'];
      if (field.kind === 'contenteditable') return ['[contenteditable="true"]', '[contenteditable=""]'];
      return ['input'];
    }

    function pick(matches, field) {
      if (matches.length === 1) return matches[0];
      if (matches.length > 1 && field.domIndex < matches.length) return matches[field.domIndex];
      return null;
    }

    function byLabelText(scope, field) {
      if (!field.labelText) return [];
      const wanted = field.labelText.trim().toLowerCase();
      const matches = [];
      for (const label of queryAll(scope, 'label')) {
        if ((label.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() !== wanted) continue;
        const forId = label.getAttribute('for');
        const control = forId ? scope.querySelector(`#${FieldSelector.escape(forId)}`) : label.querySelector('input, textarea, select');
        if (control) matches.push(control);
      }
      return matches;
    }

    // Try every identifier the snapshot stored, most reliable first. Spec §9.2.
    function resolve(field, container) {
      const scope = container || document;
      const tags = tagsFor(field);
      const attempts = [];

      attempts.push(() => queryAll(scope, field.selector));

      if (field.name) {
        const name = FieldSelector.escape(field.name);
        if (field.kind === 'radio') attempts.push(() => queryAll(scope, `input[type="radio"][name="${name}"]`).slice(0, 1));
        else attempts.push(() => tags.flatMap((tag) => queryAll(scope, `${tag}[name="${name}"]`)));
      }

      if (field.id && !FieldSelector.isRandomId(field.id)) {
        attempts.push(() => queryAll(scope, `#${FieldSelector.escape(field.id)}`));
      }

      if (field.testId) {
        const value = FieldSelector.escape(field.testId);
        attempts.push(() => ['data-testid', 'data-test', 'data-qa', 'data-cy'].flatMap((attr) => queryAll(scope, `[${attr}="${value}"]`)));
      }

      attempts.push(() => byLabelText(scope, field));

      if (field.placeholder) {
        const value = FieldSelector.escape(field.placeholder);
        attempts.push(() => tags.flatMap((tag) => queryAll(scope, `${tag}[placeholder="${value}"]`)));
      }

      if (field.labelText) {
        const value = FieldSelector.escape(field.labelText);
        attempts.push(() => tags.flatMap((tag) => queryAll(scope, `${tag}[aria-label="${value}"]`)));
      }

      // Last resort: position among the controls of the same kind.
      attempts.push(() => {
        const all = tags.flatMap((tag) => queryAll(scope, tag));
        const el = all[field.domIndex];
        return el ? [el] : [];
      });

      for (const attempt of attempts) {
        const el = pick(attempt(), field);
        if (el) return el;
      }
      return null;
    }

    // ─── Apply ─────────────────────────────────────────────────────────────────

    function hasValue(value) {
      if (value === undefined) return false;
      if (value === null) return false;
      if (Array.isArray(value)) return value.length > 0;
      return true;
    }

    function fillableFields(form, values) {
      return (form.fields || []).filter((field) => {
        if (field.excluded || field.removed) return false;
        return hasValue(values[field.fieldId]);
      });
    }

    function fillOnce(form, values, settings, pending, report) {
      const container = form.containerSelector ? document.querySelector(form.containerSelector) : null;
      const scope = container || document;

      for (const field of [...pending]) {
        const el = resolve(field, scope);
        if (!el) continue;

        let result;
        try {
          result = writeField(field, el, values[field.fieldId], settings, scope);
        } catch (err) {
          result = { ok: false, reason: err.message };
        }

        pending.delete(field);
        if (result.ok) report.filled.push({ fieldId: field.fieldId, label: field.labelText, partial: !!result.partial });
        else report.failed.push({ fieldId: field.fieldId, label: field.labelText, reason: result.reason });
      }
    }

    // Fields that render late (SPA, multi-step forms) are retried inside the
    // configured window; each field is only written once. Spec §9.5.
    function waitAndRetry(form, values, settings, pending, report) {
      return new Promise((resolve_) => {
        const deadline = Date.now() + Math.max(0, settings.retryWindowMs || 0);
        let timer = null;
        let observer = null;

        const stop = () => {
          if (timer) clearInterval(timer);
          if (observer) observer.disconnect();
          resolve_();
        };

        const tick = () => {
          fillOnce(form, values, settings, pending, report);
          if (!pending.size || Date.now() >= deadline) stop();
        };

        timer = setInterval(tick, 300);
        observer = new MutationObserver(() => tick());
        observer.observe(document.documentElement, { childList: true, subtree: true });
      });
    }

    async function apply(form, values, settings) {
      const options = { dispatchEvents: true, retryDynamicForms: true, retryWindowMs: 3000, ...(settings || {}) };
      const report = { filled: [], failed: [], notFound: [], skipped: [] };

      for (const field of form.fields || []) {
        if (field.excluded) {
          report.skipped.push({ fieldId: field.fieldId, label: field.labelText, reason: field.excludedReason });
        } else if (field.removed) {
          report.skipped.push({ fieldId: field.fieldId, label: field.labelText, reason: 'field-removed-from-form' });
        } else if (!hasValue(values[field.fieldId])) {
          report.skipped.push({ fieldId: field.fieldId, label: field.labelText, reason: 'no-value-in-profile' });
        }
      }

      const pending = new Set(fillableFields(form, values));
      fillOnce(form, values, options, pending, report);

      if (pending.size && options.retryDynamicForms) {
        await waitAndRetry(form, values, options, pending, report);
      }

      for (const field of pending) {
        report.notFound.push({ fieldId: field.fieldId, label: field.labelText, reason: 'selector-no-longer-matches' });
      }

      report.counts = {
        filled: report.filled.length,
        failed: report.failed.length,
        notFound: report.notFound.length,
        skipped: report.skipped.length,
      };
      return report;
    }

    return { apply, resolve };
  })();
}
