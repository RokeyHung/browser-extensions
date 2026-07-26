// selector-generator.js — generate CSS selectors at multiple specificity levels

const SelectorGenerator = (() => {
  const UNSTABLE_PATTERNS = [/^css-[a-z0-9]+$/i, /^sc-[a-z0-9]+$/i, /^jsx-\d+$/, /^[a-f0-9]{6,}$/i, /\d{4,}/];

  function isUnstableClass(cls) {
    return UNSTABLE_PATTERNS.some((p) => p.test(cls));
  }

  function isUnstableId(id) {
    return /^\d+$/.test(id) || /[a-f0-9]{8,}/i.test(id) || /[-_][a-f0-9]{6,}/i.test(id);
  }

  function getStableClasses(element) {
    return Array.from(element.classList).filter((c) => !isUnstableClass(c));
  }

  function hasUnstableClasses(element) {
    return Array.from(element.classList).some((c) => isUnstableClass(c));
  }

  // Level 0: Least specific — single class or tag
  function level0(element) {
    const classes = getStableClasses(element);
    if (classes.length > 0) return '.' + classes[0];
    const tag = element.tagName.toLowerCase();
    if (element.getAttribute('role')) return `${tag}[role="${element.getAttribute('role')}"]`;
    return tag;
  }

  // Level 1: Medium — tag + top 2 stable classes or data attributes
  function level1(element) {
    const tag = element.tagName.toLowerCase();
    const classes = getStableClasses(element);

    if (element.dataset.testid) return `[data-testid="${element.dataset.testid}"]`;
    if (element.dataset.test) return `[data-test="${element.dataset.test}"]`;
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return `${tag}[aria-label="${ariaLabel}"]`;

    if (classes.length > 0) return tag + '.' + classes.slice(0, 2).join('.');
    return tag;
  }

  // Level 2: Specific — ID or tag + all stable classes
  function level2(element) {
    const tag = element.tagName.toLowerCase();
    const classes = getStableClasses(element);

    if (element.id && !isUnstableId(element.id)) return '#' + element.id;
    if (classes.length > 0) return tag + '.' + classes.join('.');
    return level1(element);
  }

  // Level 3: Very specific — full path from body
  function level3(element) {
    const parts = [];
    let current = element;

    while (current && current.tagName && current !== document.documentElement) {
      let seg = current.tagName.toLowerCase();

      if (current.id && !isUnstableId(current.id)) {
        seg += '#' + current.id;
        parts.unshift(seg);
        break;
      }

      const classes = getStableClasses(current);
      if (classes.length > 0) {
        seg += '.' + classes.join('.');
      } else {
        const parent = current.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter((s) => s.tagName === current.tagName);
          if (sameTag.length > 1) {
            seg += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
          }
        }
      }

      parts.unshift(seg);
      current = current.parentElement;
    }

    return parts.join(' > ');
  }

  function generate(element) {
    const selectors = [level0(element), level1(element), level2(element), level3(element)];
    const unstable = hasUnstableClasses(element);

    return {
      selectors,
      unstableWarning: unstable ? 'This selector may be unstable because it contains generated class names.' : null,
    };
  }

  function countMatches(selector) {
    try {
      return document.querySelectorAll(selector).length;
    } catch {
      return -1;
    }
  }

  function isValidSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }

  return { generate, countMatches, isValidSelector, getStableClasses, isUnstableClass, isUnstableId };
})();
