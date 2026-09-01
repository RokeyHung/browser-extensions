// page-metrics.js — runs INSIDE the page (spec §7.1).
//
// Injected with chrome.scripting.executeScript({ files: [...] }), not passed as
// a `func`: Chrome stringifies a `func` and drops its scope, which would mean
// re-inlining every helper into every call. As a file it keeps its scope, and
// what it registers on `window` lives in the extension's isolated world — the
// same world content.js runs in, so the resolved scroller can be remembered
// across calls instead of shuttling a selector back and forth.

(function () {
  'use strict';

  const MAX_ELEMENTS = 20000; // a DOM walk on a huge page must not hang the tab

  // The element that actually scrolls. Many SPAs park `overflow: hidden` on
  // <body> and scroll a div; capturing the document in that case yields one
  // screenful and nothing else.
  function pickScroller() {
    const doc = document;
    const de = doc.documentElement;
    const root = doc.scrollingElement || de;
    if (root && root.scrollHeight > root.clientHeight + 4) return root;

    let best = null;
    const all = doc.querySelectorAll('*');
    const limit = Math.min(all.length, MAX_ELEMENTS);
    const viewportArea = de.clientWidth * de.clientHeight;
    for (let i = 0; i < limit; i++) {
      const el = all[i];
      if (el.scrollHeight <= el.clientHeight + 32) continue;
      const style = getComputedStyle(el);
      if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height < viewportArea * 0.5) continue;
      if (!best || el.scrollHeight > best.scrollHeight) best = el;
    }
    return best || root;
  }

  function measure() {
    const doc = document;
    const de = doc.documentElement;
    const scroller = pickScroller();
    window.__fpcScroller = scroller;

    const isDoc = scroller === doc.scrollingElement || scroller === de || scroller === doc.body;

    // The slice of the viewport that belongs to the scroller. For the document
    // this is the client box, which excludes the scrollbar — that is how the
    // scrollbar stays out of the final image (spec §7.6).
    let captureRect;
    if (isDoc) {
      captureRect = { x: 0, y: 0, width: de.clientWidth, height: de.clientHeight };
    } else {
      const rect = scroller.getBoundingClientRect();
      const style = getComputedStyle(scroller);
      captureRect = {
        x: Math.max(0, Math.round(rect.left + (parseFloat(style.borderLeftWidth) || 0))),
        y: Math.max(0, Math.round(rect.top + (parseFloat(style.borderTopWidth) || 0))),
        width: Math.round(scroller.clientWidth),
        height: Math.round(scroller.clientHeight),
      };
    }

    const contentHeight = Math.max(scroller.scrollHeight, captureRect.height);
    const contentWidth = Math.max(scroller.scrollWidth, captureRect.width);

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      clientWidth: de.clientWidth,
      clientHeight: de.clientHeight,
      scrollbarWidth: window.innerWidth - de.clientWidth,
      devicePixelRatio: window.devicePixelRatio,
      captureRect,
      contentWidth,
      contentHeight,
      scrollerKind: isDoc ? 'document' : (scroller.tagName || 'element').toLowerCase(),
      scrollable: contentHeight > captureRect.height + 4,
      horizontalOverflow: contentWidth > captureRect.width + 4,
      originalScrollY: scroller.scrollTop,
      title: doc.title || '',
      url: location.href,
    };
  }

  window.__fpcMetrics = { measure };
})();
