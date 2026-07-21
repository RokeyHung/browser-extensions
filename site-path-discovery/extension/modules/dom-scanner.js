// dom-scanner.js — extracts candidate URLs out of an HTML string.
// The live-DOM scan happens in content.js (spec §6.1); this module handles the
// crawler case, where the MV3 service worker fetches HTML but has no DOMParser.
// Pure string parsing, attaches to globalThis.

(function () {
  'use strict';

  // Attribute patterns that carry URLs. Kept deliberately simple/robust.
  const ATTR_RES = [
    { re: /<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi, kind: 'a' },
    { re: /<link\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi, kind: 'link' },
    { re: /<script\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, kind: 'script' },
    { re: /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, kind: 'img' },
    { re: /<iframe\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, kind: 'iframe' },
    { re: /<form\b[^>]*?\saction\s*=\s*["']([^"']+)["']/gi, kind: 'form' },
    { re: /<source\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, kind: 'source' },
    { re: /<video\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, kind: 'video' },
    { re: /<audio\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi, kind: 'audio' },
  ];

  function decodeEntities(s) {
    return String(s)
      .replace(/&amp;/g, '&')
      .replace(/&#38;/g, '&')
      .replace(/&#x26;/gi, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  // Returns an array of { raw, kind } candidate URLs found in the HTML.
  function extractFromHtml(html) {
    const out = [];
    const seen = new Set();
    if (!html) return out;
    for (const { re, kind } of ATTR_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(html)) !== null) {
        const raw = decodeEntities(m[1]);
        const dedupeKey = kind + '|' + raw;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push({ raw, kind });
      }
    }
    return out;
  }

  // Anchors only — what the crawler follows for further navigation.
  function extractAnchors(html) {
    return extractFromHtml(html).filter((c) => c.kind === 'a');
  }

  globalThis.DomScanner = { extractFromHtml, extractAnchors };
})();
