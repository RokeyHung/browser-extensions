// filename.js — the naming rule for the files the extension writes (spec §16.3).
//
// Host plus path, which is the only thing that distinguishes one screenshot
// from another. No user-facing template: the browser already appends (1), (2)
// for repeats of the same page, which is exactly the right behaviour.

(function () {
  'use strict';

  // Everything a file system or a download manager can object to, control
  // characters included, collapsed into single dashes.
  // eslint-disable-next-line no-control-regex
  const INVALID = /[/\\:*?"<>|#%&=+\s\x00-\x1f-]+/g;
  const MAX_LENGTH = 120;

  function slug(text) {
    return String(text || '')
      .replace(INVALID, '-')
      .replace(/^-|-$/g, '');
  }

  // Paths come out of URL percent-encoded, and a `%20` slugged verbatim reads
  // as "20" in the middle of a word. A malformed escape is left alone rather
  // than costing us the whole name.
  function decodePath(pathname) {
    try {
      return decodeURIComponent(pathname);
    } catch (err) {
      return pathname;
    }
  }

  // { url, hostname, part, parts, format }
  function forPage({ url, hostname, part, parts, format }) {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch (err) {
      parsed = null;
    }

    const host = slug(hostname || (parsed && parsed.hostname) || 'site');
    const path = slug(decodePath((parsed && parsed.pathname) || '').replace(/^\/+|\/+$/g, '')) || 'index';
    const suffix = parts > 1 ? `-${part}of${parts}` : '';
    const extension = format === 'jpeg' ? 'jpg' : 'png';

    const stem = `${host}-${path}${suffix}`;
    return `${stem.slice(0, MAX_LENGTH)}.${extension}`;
  }

  globalThis.Filename = { forPage, slug };
})();
