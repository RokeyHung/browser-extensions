// fb-selectors.js — every assumption this extension makes about Facebook's DOM,
// in one file (spec §9.3, rule R7).
//
// Facebook's class names are generated (`x1i10hfl x1qjc9v5 …`) and change with
// each deploy, and its labels are localised — "Like" is "Thích" for a Vietnamese
// account. Anything anchored to either breaks within weeks. What survives is
// markup that exists for a reason other than styling: ARIA roles (accessibility)
// and data-pagelet / data-visualcompletion (Facebook's own performance
// instrumentation).
//
// Each entry carries why it is believed to work and when it was last checked, and
// every entry is probeable so the diagnostics page can say which one went dark
// rather than leaving the user with a button that silently stopped appearing
// (spec §9.4).

(function () {
  'use strict';

  const ENTRIES = {
    feedUnit: {
      sel: '[data-pagelet^="FeedUnit"]',
      why: 'One feed story. data-pagelet exists for Facebook’s own render timing, not for CSS.',
      checked: '2026-09-02',
    },
    article: {
      sel: '[role="article"]',
      why: 'Post container on permalink/group pages. ARIA role, kept because screen readers depend on it.',
      checked: '2026-09-02',
    },
    theaterImage: {
      sel: 'img[data-visualcompletion="media-vc-image"]',
      why: 'The full-size image in the photo viewer. Undocumented but stable; the common anchor for this job.',
      checked: '2026-09-02',
    },
    dialog: {
      sel: '[role="dialog"]',
      why: 'Lightbox / composer container; used to tell "viewing a photo" from "writing a post".',
      checked: '2026-09-02',
    },
    composer: {
      sel: '[role="textbox"]',
      why: 'Post composer. Media inside one is an upload preview and must never get a button (spec §10.1).',
      checked: '2026-09-02',
    },
  };

  // Links that identify a post. Order matters only for readability; matching is
  // by first hit.
  const PERMALINK_PATTERNS = [
    { re: /\/photo(?:\.php)?\/?\?(?:.*&)?fbid=(\d+)/, kind: 'photo', idFrom: 1 },
    { re: /\/watch\/?\?(?:.*&)?v=(\d+)/, kind: 'video', idFrom: 1 },
    { re: /\/videos\/(?:[^/]+\/)?(\d+)/, kind: 'video', idFrom: 1 },
    { re: /\/reel\/(\d+)/, kind: 'reel', idFrom: 1 },
    { re: /\/permalink\.php\?(?:.*&)?story_fbid=([\w.]+)/, kind: 'post', idFrom: 1 },
    { re: /\/story\.php\?(?:.*&)?story_fbid=([\w.]+)/, kind: 'post', idFrom: 1 },
    { re: /\/groups\/[^/]+\/posts\/([\w.]+)/, kind: 'post', idFrom: 1 },
    { re: /\/[^/]+\/posts\/([\w.]+)/, kind: 'post', idFrom: 1 },
    { re: /\/share\/[pvr]\/([\w-]+)/, kind: 'post', idFrom: 1 },
  ];

  // First path segment values that name a Facebook feature rather than a person,
  // so a link starting with one of them is not an author link.
  const RESERVED_SEGMENTS = new Set([
    'photo',
    'photo.php',
    'photos',
    'video',
    'videos',
    'watch',
    'reel',
    'reels',
    'groups',
    'events',
    'marketplace',
    'permalink.php',
    'story.php',
    'hashtag',
    'search',
    'pages',
    'people',
    'help',
    'privacy',
    'policies',
    'settings',
    'notes',
    'media',
    'l.php',
    'login',
    'business',
    'ads',
    'gaming',
    'stories',
    'messages',
    'friends',
    'bookmarks',
    'saved',
  ]);

  function get(name) {
    const entry = ENTRIES[name];
    return entry ? entry.sel : null;
  }

  function closest(element, name) {
    const sel = get(name);
    return sel && element && element.closest ? element.closest(sel) : null;
  }

  // Runs every selector against the live document and reports what it found.
  // This is the whole point of the registry: when Facebook changes something, the
  // answer to "what broke" is a number, not a guess (spec §9.4).
  function probe(doc) {
    const report = {};
    for (const [name, entry] of Object.entries(ENTRIES)) {
      try {
        report[name] = doc.querySelectorAll(entry.sel).length;
      } catch (err) {
        report[name] = -1;
      }
    }
    return report;
  }

  globalThis.FbSelectors = { ENTRIES, PERMALINK_PATTERNS, RESERVED_SEGMENTS, get, closest, probe };
})();
