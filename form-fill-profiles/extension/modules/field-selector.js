// field-selector.js — build a stable CSS selector for a field or form container.
// Runs in the content script context. Spec §6.4.

if (typeof FieldSelector === 'undefined') {
  var FieldSelector = (() => {
    // ids/classes that look generated and will change on the next deploy
    const RANDOM_TOKEN = /(^|[-_:])([0-9a-f]{8,}|\d{4,})([-_:]|$)/i;
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const UNSTABLE_CLASS =
      /^(css-|sc-|jsx-|emotion-|makeStyles-|ng-|v-|svelte-|is-|has-|active$|focus|hover|error|invalid|dirty|touched|selected$|open$|show$|hidden$)/i;

    const STABLE_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy', 'name', 'aria-label', 'placeholder'];
    const MAX_DEPTH = 4;

    function isRandomId(id) {
      if (!id) return true;
      return UUID.test(id) || RANDOM_TOKEN.test(id);
    }

    function esc(value) {
      const text = String(value);
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
      return text.replace(/["\\]/g, '\\$&');
    }

    function isUnique(selector, root) {
      try {
        return root.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    }

    function stableClasses(el) {
      return Array.from(el.classList).filter((c) => c && !UNSTABLE_CLASS.test(c) && !RANDOM_TOKEN.test(c));
    }

    // Candidate selectors for one element, most stable first.
    function candidates(el) {
      const tag = el.tagName.toLowerCase();
      const list = [];

      if (el.id && !isRandomId(el.id)) list.push(`#${esc(el.id)}`);

      for (const attr of STABLE_ATTRS) {
        const value = el.getAttribute(attr);
        if (value) list.push(`${tag}[${attr}="${esc(value)}"]`);
      }

      if (tag === 'input') {
        const type = el.getAttribute('type') || 'text';
        const name = el.getAttribute('name');
        if (name) list.push(`input[type="${esc(type)}"][name="${esc(name)}"]`);
      }

      const classes = stableClasses(el);
      if (classes.length) list.push(`${tag}.${classes.map(esc).join('.')}`);

      return list;
    }

    function nthOfType(el) {
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      if (sameTag.length === 1) return tag;
      return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }

    // Shortest path selector, walking up at most MAX_DEPTH levels.
    function pathSelector(el, root) {
      const parts = [];
      let node = el;
      for (let depth = 0; depth < MAX_DEPTH && node && node !== root && node.nodeType === Node.ELEMENT_NODE; depth++) {
        parts.unshift(nthOfType(node));
        const selector = parts.join(' > ');
        if (isUnique(selector, root)) return selector;
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    // Selector for `el`, resolved inside `root` (a form container or document).
    function generate(el, root) {
      const scope = root || document;
      for (const candidate of candidates(el)) {
        if (isUnique(candidate, scope)) return candidate;
      }
      // Not unique on its own — prefix the closest identifiable ancestor.
      for (const candidate of candidates(el)) {
        let parent = el.parentElement;
        for (let depth = 0; depth < MAX_DEPTH && parent && parent !== scope; depth++) {
          for (const parentCandidate of candidates(parent)) {
            const combined = `${parentCandidate} ${candidate}`;
            if (isUnique(combined, scope)) return combined;
          }
          parent = parent.parentElement;
        }
      }
      return pathSelector(el, scope);
    }

    // Selector for a form element, resolved against the document.
    function generateContainer(formEl) {
      if (!formEl) return null;
      return generate(formEl, document);
    }

    return { generate, generateContainer, isRandomId, escape: esc };
  })();
}
