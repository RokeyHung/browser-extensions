// image-pick.js — reads the image candidates a page element can offer, and
// decides which media element deserves a button at all (spec §7, §10.1).
// Isolated world.
//
// The DOM is the weakest of the three harvest layers: a feed <img> is usually a
// server-resized copy (`stp=dst-jpg_p600x600`). It is kept because it always
// exists, and because a resized photo saved with a warning beats no photo at all
// — unlike video, where the DOM has nothing usable at any quality (spec §8.1).

(function () {
  'use strict';

  const S = globalThis.FbSelectors;
  const MIN_EDGE = 120;

  function isFbcdn(url) {
    try {
      const host = new URL(url, location.href).hostname;
      return host === 'fbcdn.net' || host.endsWith('.fbcdn.net');
    } catch (err) {
      return false;
    }
  }

  // "srcset" is a comma-separated list of "url descriptor" pairs. The largest `w`
  // is the biggest copy the page was prepared to load, and it is already signed,
  // which is the only kind of large URL this extension is allowed to use (R3).
  function fromSrcset(value) {
    const out = [];
    for (const part of String(value || '').split(',')) {
      const bits = part.trim().split(/\s+/);
      const url = bits[0];
      if (!url || !isFbcdn(url)) continue;
      const descriptor = bits[1] || '';
      const width = /^(\d+)w$/.test(descriptor) ? parseInt(descriptor, 10) : 0;
      out.push({ url, width, height: 0, rank: width * width });
    }
    return out;
  }

  function elementCandidates(element) {
    if (!element) return [];
    const out = [];

    if (element.tagName === 'IMG') {
      out.push(...fromSrcset(element.getAttribute('srcset')));
      for (const url of [element.currentSrc, element.getAttribute('src')]) {
        if (url && isFbcdn(url)) {
          // naturalWidth is the decoded size of what is actually on screen, so it
          // ranks honestly against the srcset entries.
          const width = element.naturalWidth || 0;
          out.push({ url, width, height: element.naturalHeight || 0, rank: width * (element.naturalHeight || width) });
        }
      }
    } else if (element.tagName === 'VIDEO') {
      // <video>.src is a blob: URL and worthless (spec §8.1); the poster is a
      // real CDN image and is all the DOM has to offer here.
      const poster = element.getAttribute('poster');
      if (poster && isFbcdn(poster)) out.push({ url: poster, width: 0, height: 0, rank: 0, poster: true });
    }

    return out.sort((a, b) => b.rank - a.rank);
  }

  // The photo id, when the DOM happens to spell it out. Facebook wraps feed
  // photos in a link to their permalink, and that link carries the fbid — the
  // strongest join key the index can be given (spec §6.4).
  function mediaIdFor(element) {
    let node = element;
    for (let depth = 0; node && depth < 12; depth++) {
      if (node.tagName === 'A') {
        const match = globalThis.PostContext.matchPermalink(node.getAttribute('href') || '');
        if (match && /^\d+$/.test(match.id)) return match.id;
      }
      node = node.parentElement;
    }

    // In the photo viewer and on /watch and /reel, the page URL is the media.
    const own = globalThis.PostContext.matchPermalink(location.pathname + location.search);
    return own && /^\d+$/.test(own.id) ? own.id : '';
  }

  // Whether this element should get a download button. Getting this wrong in the
  // permissive direction turns the feed into a minefield of buttons over avatars
  // and reaction icons (spec §10.1).
  function isEligible(element) {
    if (!element || (element.tagName !== 'IMG' && element.tagName !== 'VIDEO')) return false;
    if (S.closest(element, 'composer')) return false;

    const rect = element.getBoundingClientRect();
    if (Math.min(rect.width, rect.height) < MIN_EDGE) return false;

    if (element.tagName === 'VIDEO') return true;
    return elementCandidates(element).length > 0;
  }

  // All the media elements inside a post, in the order they appear on screen —
  // the order the {index} token counts in (spec §10.3, §13.1).
  function mediaElementsIn(root) {
    if (!root) return [];
    return [...root.querySelectorAll('img, video')].filter(isEligible);
  }

  globalThis.ImagePick = { elementCandidates, mediaIdFor, isEligible, mediaElementsIn, fromSrcset, isFbcdn, MIN_EDGE };
})();
