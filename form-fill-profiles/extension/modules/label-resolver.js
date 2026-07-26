// label-resolver.js — find a human-readable label for a form field.
// Runs in the content script context. Spec §6.3.

if (typeof LabelResolver === 'undefined') {
  var LabelResolver = (() => {
    const MAX_LENGTH = 120;

    function clean(text) {
      if (!text) return '';
      return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    }

    function fromLabelFor(el) {
      if (!el.id) return '';
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        return label ? clean(label.textContent) : '';
      } catch {
        return '';
      }
    }

    // A wrapping <label> also contains the control itself (and, for a select, all
    // of its option text) — strip controls before reading the text.
    function fromAncestorLabel(el) {
      const label = el.closest('label');
      if (!label) return '';
      const clone = label.cloneNode(true);
      clone.querySelectorAll('input, textarea, select, button, option').forEach((n) => n.remove());
      return clean(clone.textContent);
    }

    function fromAriaLabelledBy(el) {
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (!ids.length) return '';
      const text = ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
      return clean(text);
    }

    // Text that belongs to a different field must not become this field's label,
    // otherwise a field with no label of its own inherits its neighbour's.
    function belongsToAnotherField(sib, el) {
      if (sib.matches('input, textarea, select, button')) return true;
      if (sib.querySelector('input, textarea, select')) return true;
      const forId = sib.tagName === 'LABEL' ? sib.getAttribute('for') : null;
      return !!forId && forId !== el.id;
    }

    // Walk backwards from the field looking for the nearest text that is not
    // itself part of another control.
    function fromPrecedingText(el) {
      let node = el;
      for (let depth = 0; depth < 3 && node; depth++) {
        let sib = node.previousSibling;
        while (sib) {
          if (sib.nodeType === Node.TEXT_NODE) {
            const text = clean(sib.textContent);
            if (text) return text;
          } else if (sib.nodeType === Node.ELEMENT_NODE) {
            const tag = sib.tagName.toLowerCase();
            if (tag !== 'script' && tag !== 'style' && !belongsToAnotherField(sib, el)) {
              const text = clean(sib.textContent);
              if (text) return text;
            }
          }
          sib = sib.previousSibling;
        }
        node = node.parentElement;
      }
      return '';
    }

    function fromFieldsetLegend(el) {
      const legend = el.closest('fieldset')?.querySelector('legend');
      return legend ? clean(legend.textContent) : '';
    }

    // Label of a single control.
    function resolve(el, index) {
      return (
        fromLabelFor(el) ||
        fromAncestorLabel(el) ||
        clean(el.getAttribute('aria-label')) ||
        fromAriaLabelledBy(el) ||
        clean(el.getAttribute('placeholder')) ||
        clean(el.getAttribute('title')) ||
        fromPrecedingText(el) ||
        clean(el.getAttribute('name')) ||
        `Field #${index + 1}`
      );
    }

    // Label of a radio group. `label[for]` / wrapping label belong to the single
    // option ("Male"), not the group, so they are skipped here.
    function resolveGroup(elements, index) {
      const first = elements[0];
      return (
        fromFieldsetLegend(first) ||
        clean(first.getAttribute('aria-label')) ||
        fromAriaLabelledBy(first) ||
        clean(first.getAttribute('name')) ||
        `Field #${index + 1}`
      );
    }

    // Label shown for one option inside a radio group.
    function resolveOption(el) {
      return fromLabelFor(el) || fromAncestorLabel(el) || clean(el.getAttribute('aria-label')) || clean(el.value) || '(empty)';
    }

    return { resolve, resolveGroup, resolveOption, clean };
  })();
}
