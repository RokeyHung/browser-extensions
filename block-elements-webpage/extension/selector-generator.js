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

  // Class names, ids and attribute values go into a selector verbatim only if
  // they happen to be CSS identifiers. Utility-class frameworks routinely are
  // not — Tailwind's `md:flex` reads as a pseudo-class and `w-1/2` is a syntax
  // error — and an element carrying only such classes used to get four invalid
  // selectors, so Create stayed disabled on every level. CSS.escape also covers
  // quotes inside attribute values (`aria-label='Close "dialog"'`).
  const cls = (names) => names.map((c) => '.' + CSS.escape(c)).join('');
  const attr = (name, value) => `[${name}="${CSS.escape(value)}"]`;

  // Level 0: Least specific — single class or tag
  function level0(element) {
    const classes = getStableClasses(element);
    if (classes.length > 0) return cls([classes[0]]);
    const tag = element.tagName.toLowerCase();
    if (element.getAttribute('role')) return tag + attr('role', element.getAttribute('role'));
    return tag;
  }

  // Level 1: Medium — tag + top 2 stable classes or data attributes
  function level1(element) {
    const tag = element.tagName.toLowerCase();
    const classes = getStableClasses(element);

    if (element.dataset.testid) return attr('data-testid', element.dataset.testid);
    if (element.dataset.test) return attr('data-test', element.dataset.test);
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return tag + attr('aria-label', ariaLabel);

    if (classes.length > 0) return tag + cls(classes.slice(0, 2));
    return tag;
  }

  // Level 2: Specific — ID or tag + all stable classes
  function level2(element) {
    const tag = element.tagName.toLowerCase();
    const classes = getStableClasses(element);

    if (element.id && !isUnstableId(element.id)) return '#' + CSS.escape(element.id);
    if (classes.length > 0) return tag + cls(classes);
    return level1(element);
  }

  // Level 3: Very specific — full path from body
  function level3(element) {
    const parts = [];
    let current = element;

    while (current && current.tagName && current !== document.documentElement) {
      let seg = current.tagName.toLowerCase();

      if (current.id && !isUnstableId(current.id)) {
        seg += '#' + CSS.escape(current.id);
        parts.unshift(seg);
        break;
      }

      const classes = getStableClasses(current);
      if (classes.length > 0) {
        seg += cls(classes);
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

  // A selector has to survive two parsers: querySelector, which preview and the
  // matched count use, and the stylesheet the rule ends up in. Neither is enough
  // alone. `a /*` passes querySelector but, once concatenated into CSS, comments
  // out every rule after it; `.bad {` fails querySelector but parses as a nested
  // style rule and swallows the rules after it. So the selector must also parse
  // as exactly one style rule on a throwaway sheet (spec §7.2).
  function isValidSelector(selector) {
    if (typeof selector !== 'string' || !selector.trim()) return false;
    try {
      document.querySelector(selector);
      const sheet = new CSSStyleSheet();
      sheet.insertRule(`${selector} { display: none !important; }`);
      return sheet.cssRules.length === 1 && sheet.cssRules[0] instanceof CSSStyleRule;
    } catch {
      return false;
    }
  }

  return { generate, countMatches, isValidSelector, getStableClasses, isUnstableClass, isUnstableId };
})();
