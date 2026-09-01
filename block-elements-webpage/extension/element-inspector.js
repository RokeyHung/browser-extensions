// element-inspector.js — read-only analysis of a picked element: selectors,
// XPath, key computed styles, WCAG contrast ratio and accessibility findings.
// Pure computation, no UI and no DOM mutation — element-picker.js renders it.

const ElementInspector = (() => {
  // ─── XPath ──────────────────────────────────────────────────────────────────

  // Absolute path, or a path anchored at the nearest ancestor with a stable id.
  // The anchored form survives layout changes much better than /html/body/div[3].
  function getXPath(element) {
    if (!element || element.nodeType !== 1) return '';

    const parts = [];
    let current = element;

    while (current && current.nodeType === 1) {
      if (current.id && !SelectorGenerator.isUnstableId(current.id)) {
        parts.unshift(`*[@id="${current.id}"]`);
        return '//' + parts.join('/');
      }

      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }

      const sameTag = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}[${sameTag.indexOf(current) + 1}]` : tag);
      current = parent;
    }

    return '/' + parts.join('/');
  }

  function countXPathMatches(xpath) {
    try {
      return document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
    } catch {
      return -1;
    }
  }

  // ─── Colour maths (WCAG 2.1) ────────────────────────────────────────────────

  // Computed styles normally serialize to rgb()/rgba(). Newer colour syntaxes
  // (oklch, color()) can survive as-is, in which case we give up and let the
  // caller mark the result uncertain rather than guessing.
  function parseColor(value) {
    if (!value) return null;
    if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    const match = value.match(/^rgba?\(([^)]+)\)$/i);
    if (!match) return null;

    const parts = match[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;

    return {
      r: parseFloat(parts[0]),
      g: parseFloat(parts[1]),
      b: parseFloat(parts[2]),
      a: parts.length > 3 ? parseFloat(parts[3]) : 1,
    };
  }

  function formatColor(color) {
    if (!color) return 'unknown';
    const rgb = `${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}`;
    return color.a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${round(color.a, 2)})`;
  }

  // Alpha-composite `front` over `back`.
  function blend(front, back) {
    const alpha = front.a + back.a * (1 - front.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
      g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
      b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
      a: alpha,
    };
  }

  function relativeLuminance(color) {
    const channel = (value) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  // Walk up compositing background colours until we reach an opaque one. Any
  // background-image on the way means the real backdrop is a picture or gradient
  // we cannot sample, so the ratio becomes an estimate.
  function effectiveBackground(element) {
    let accumulated = null;
    let uncertain = false;
    let source = null;

    for (let el = element; el; el = el.parentElement) {
      const styles = getComputedStyle(el);
      if (styles.backgroundImage && styles.backgroundImage !== 'none') uncertain = true;

      const color = parseColor(styles.backgroundColor);
      if (!color) {
        uncertain = true;
        continue;
      }
      if (color.a === 0) continue;

      accumulated = accumulated ? blend(accumulated, color) : color;
      if (!source) source = el;
      if (accumulated.a >= 0.999) break;
    }

    // Nothing opaque found: the browser canvas shows through, which is white by
    // default. Composite whatever we collected over it.
    //
    // This is the *certain* case, not an uncertain one: no ancestor painted
    // anything, so white is exactly what is behind the text. Flagging it as an
    // estimate put "Background involves an image or gradient" on every plain
    // text element of every page that never sets a background-color — which is
    // most pages — and made the one honest use of the flag meaningless.
    // `uncertain` now means only what its message says: an image, a gradient,
    // or a colour we could not parse.
    const canvas = { r: 255, g: 255, b: 255, a: 1 };
    const final = accumulated ? blend(accumulated, canvas) : canvas;

    return { color: final, uncertain, source };
  }

  // ─── Text ───────────────────────────────────────────────────────────────────

  function hasDirectText(element) {
    return Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
  }

  function visibleText(element, limit = 80) {
    const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
  }

  // WCAG large text: 18.66px+ bold, or 24px+ at any weight.
  function isLargeText(styles) {
    const size = parseFloat(styles.fontSize) || 0;
    const weight = parseInt(styles.fontWeight, 10) || 400;
    return size >= 24 || (size >= 18.66 && weight >= 700);
  }

  function analyseContrast(element) {
    const styles = getComputedStyle(element);
    if (!hasDirectText(element)) return null;

    const background = effectiveBackground(element);
    const rawColor = parseColor(styles.color);
    if (!rawColor) return { unsupported: true };

    // Translucent text sits on top of the background too.
    const foreground = rawColor.a >= 1 ? rawColor : blend(rawColor, background.color);
    const ratio = contrastRatio(foreground, background.color);
    const large = isLargeText(styles);

    return {
      ratio: round(ratio, 2),
      foreground: formatColor(foreground),
      background: formatColor(background.color),
      foregroundHex: toHex(foreground),
      backgroundHex: toHex(background.color),
      largeText: large,
      passesAA: ratio >= (large ? 3 : 4.5),
      passesAAA: ratio >= (large ? 4.5 : 7),
      uncertain: background.uncertain,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
    };
  }

  // ─── Accessible name ────────────────────────────────────────────────────────

  const INTERACTIVE_TAGS = new Set(['A', 'BUTTON', 'SUMMARY']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option']);
  const LABELLABLE = new Set(['INPUT', 'SELECT', 'TEXTAREA']);
  const NO_LABEL_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

  function isInteractive(element) {
    const role = element.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (INTERACTIVE_TAGS.has(element.tagName)) return true;
    if (element.tagName === 'INPUT') return !['hidden'].includes(element.type);
    return false;
  }

  // Simplified accname resolution — enough to catch the common failures without
  // reimplementing the whole spec.
  function accessibleName(element) {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
      if (text) return { name: text, from: 'aria-labelledby' };
    }

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return { name: ariaLabel.trim(), from: 'aria-label' };

    if (element.tagName === 'IMG') {
      const alt = element.getAttribute('alt');
      if (alt && alt.trim()) return { name: alt.trim(), from: 'alt' };
    }

    if (LABELLABLE.has(element.tagName) && element.labels && element.labels.length) {
      const text = Array.from(element.labels)
        .map((label) => (label.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
      if (text) return { name: text, from: '<label>' };
    }

    const own = visibleText(element);
    if (own) return { name: own, from: 'text content' };

    const nestedAlt = element.querySelector && element.querySelector('img[alt]');
    if (nestedAlt) {
      const alt = nestedAlt.getAttribute('alt');
      if (alt && alt.trim()) return { name: alt.trim(), from: 'nested img alt' };
    }

    const title = element.getAttribute('title');
    if (title && title.trim()) return { name: title.trim(), from: 'title' };

    const placeholder = element.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return { name: placeholder.trim(), from: 'placeholder' };

    return null;
  }

  // ─── Accessibility checks ───────────────────────────────────────────────────

  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function checkAccessibility(element, contrast) {
    const findings = [];
    const styles = getComputedStyle(element);
    const name = accessibleName(element);

    // Images
    if (element.tagName === 'IMG') {
      const alt = element.getAttribute('alt');
      if (alt === null) {
        findings.push({ level: 'error', message: 'Image has no alt attribute — screen readers will read the file name.' });
      } else if (!alt.trim()) {
        findings.push({ level: 'info', message: 'alt="" — treated as decorative and skipped by screen readers.' });
      }
    }

    // Interactive elements need a name
    if (isInteractive(element)) {
      const isNamelessInput = element.tagName === 'INPUT' && NO_LABEL_INPUT_TYPES.has(element.type) && !element.value;
      if (!name) {
        findings.push({ level: 'error', message: `<${element.tagName.toLowerCase()}> is interactive but has no accessible name.` });
      } else if (name.from === 'title' || name.from === 'placeholder') {
        findings.push({ level: 'warn', message: `Accessible name comes from ${name.from}, which is unreliable. Prefer visible text or aria-label.` });
      }
      if (isNamelessInput) findings.push({ level: 'warn', message: 'Button input has no value or label.' });
    }

    // Form controls need a label
    if (LABELLABLE.has(element.tagName) && !NO_LABEL_INPUT_TYPES.has(element.type || '')) {
      const labelled = name && ['<label>', 'aria-label', 'aria-labelledby'].includes(name.from);
      if (!labelled) findings.push({ level: 'error', message: 'Form control has no associated <label> or aria-label.' });
    }

    // Links
    if (element.tagName === 'A' && !element.hasAttribute('href')) {
      findings.push({ level: 'warn', message: '<a> without href is not focusable or keyboard-activatable.' });
    }

    // Custom controls must be reachable
    const role = element.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role) && !INTERACTIVE_TAGS.has(element.tagName) && element.tabIndex < 0) {
      findings.push({ level: 'error', message: `role="${role}" without tabindex — cannot be reached by keyboard.` });
    }

    const tabindex = parseInt(element.getAttribute('tabindex'), 10);
    if (tabindex > 0) {
      findings.push({ level: 'warn', message: `tabindex="${tabindex}" overrides the natural tab order and usually causes bugs.` });
    }

    // Hidden from assistive tech but still operable
    if (element.getAttribute('aria-hidden') === 'true') {
      const focusable = element.matches(FOCUSABLE) || element.querySelector(FOCUSABLE);
      if (focusable)
        findings.push({ level: 'error', message: 'aria-hidden="true" wraps focusable content — keyboard users reach an invisible control.' });
    }

    // Contrast
    if (contrast && !contrast.unsupported) {
      const threshold = contrast.largeText ? 3 : 4.5;
      if (!contrast.passesAA) {
        findings.push({
          level: 'error',
          message: `Contrast ${contrast.ratio}:1 is below the WCAG AA minimum of ${threshold}:1 for this text size.`,
        });
      } else if (!contrast.passesAAA) {
        findings.push({ level: 'info', message: `Contrast ${contrast.ratio}:1 passes AA but not AAA.` });
      }
      if (contrast.uncertain) {
        findings.push({ level: 'info', message: 'Background involves an image or gradient — the ratio is an estimate.' });
      }
    }

    // Invisible to everyone
    if (styles.display === 'none' || styles.visibility === 'hidden' || parseFloat(styles.opacity) === 0) {
      findings.push({ level: 'info', message: 'Element is not visible (display/visibility/opacity).' });
    }

    return { findings, name };
  }

  // ─── Formatting helpers ─────────────────────────────────────────────────────

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function toHex(color) {
    const hex = (value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, '0');
    return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
  }

  // "10px 10px 10px 10px" → "10px"; "0px 8px 0px 8px" → "0px 8px"
  function shorthand(top, right, bottom, left) {
    if (top === right && right === bottom && bottom === left) return top;
    if (top === bottom && right === left) return `${top} ${right}`;
    return `${top} ${right} ${bottom} ${left}`;
  }

  function shortFontFamily(family) {
    const first = String(family)
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    return first || 'inherit';
  }

  // ─── Public entry ───────────────────────────────────────────────────────────

  function inspect(element) {
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const { selectors, unstableWarning } = SelectorGenerator.generate(element);
    const bestSelector = selectors[2] || selectors[0];
    const xpath = getXPath(element);
    const contrast = analyseContrast(element);
    const { findings, name } = checkAccessibility(element, contrast);

    return {
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      classes: Array.from(element.classList),
      stableClasses: SelectorGenerator.getStableClasses(element),
      text: visibleText(element),

      selectors,
      selectorMatches: selectors.map((selector) => SelectorGenerator.countMatches(selector)),
      bestSelector,
      unstableWarning,
      xpath,
      xpathMatches: countXPathMatches(xpath),

      box: {
        width: round(rect.width, 1),
        height: round(rect.height, 1),
        top: round(rect.top, 1),
        left: round(rect.left, 1),
      },
      boxModel: {
        margin: shorthand(styles.marginTop, styles.marginRight, styles.marginBottom, styles.marginLeft),
        border: shorthand(styles.borderTopWidth, styles.borderRightWidth, styles.borderBottomWidth, styles.borderLeftWidth),
        padding: shorthand(styles.paddingTop, styles.paddingRight, styles.paddingBottom, styles.paddingLeft),
      },
      styles: {
        display: styles.display,
        position: styles.position,
        zIndex: styles.zIndex,
        opacity: styles.opacity,
        visibility: styles.visibility,
        overflow: styles.overflow,
        font: `${styles.fontSize}/${styles.lineHeight} ${styles.fontWeight} ${shortFontFamily(styles.fontFamily)}`,
        color: styles.color,
        background: styles.backgroundColor,
      },

      accessibleName: name,
      contrast,
      findings,
    };
  }

  return {
    inspect,
    getXPath,
    countXPathMatches,
    contrastRatio,
    effectiveBackground,
    accessibleName,
    parseColor,
  };
})();
