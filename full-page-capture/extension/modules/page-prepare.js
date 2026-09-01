// page-prepare.js — runs INSIDE the page (spec §7.2, §7.4). Injected as a file
// alongside page-metrics.js, for the same reason (see that file's header).
//
// Everything it mutates is recorded in `window.__fpcState` and undone by
// unfreeze(), which the orchestrator always calls from a `finally`. A page left
// scrolled to the middle with its header missing is a bug the user would blame
// on their own site, not on us.

(function () {
  'use strict';

  const STYLE_ID = '__fpc_freeze';

  function scroller() {
    return window.__fpcScroller || document.scrollingElement || document.documentElement;
  }

  function frames(n) {
    return new Promise((resolve) => {
      let seen = 0;
      const step = () => (++seen >= n ? resolve() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // The progress overlay is ours, so it must never appear in a tile — not even
  // in tile 0, where the page's own fixed elements are deliberately kept.
  // Hidden for the shot, shown again immediately after.
  function setOverlayVisible(visible) {
    const host = document.querySelector('[data-fpc-overlay]');
    if (host) host.style.visibility = visible ? '' : 'hidden';
  }

  // Walk the page once so IntersectionObserver-driven images actually load,
  // then wait for them to decode. This is the slowest part of a capture and the
  // one setting that turns it off exists for people capturing static sites.
  async function preloadImages(el, timeout) {
    for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
    for (const img of document.querySelectorAll('img[decoding]')) img.decoding = 'sync';

    const step = Math.max(200, el.clientHeight);
    const end = Math.max(el.scrollHeight, el.clientHeight);
    for (let y = 0; y < end; y += step) {
      el.scrollTop = y;
      await frames(1);
    }

    const pending = Array.from(document.images)
      .filter((img) => !img.complete)
      .map((img) => img.decode().catch(() => {}));
    await Promise.race([Promise.all(pending), sleep(timeout)]);

    el.scrollTop = 0;
    await frames(2);
  }

  // Elements that stay put while the page scrolls, so they would otherwise be
  // photographed once per screenful.
  //
  // This has to run again on every shot, not once up front. A very common app-bar
  // pattern is a header that is `static` at the top of the page and only becomes
  // `fixed` once a scroll handler adds a class — at scroll 0, which is where a
  // one-shot scan runs, there is nothing to find. Already-known elements are
  // skipped, so repeat scans only pay for elements that are new.
  // Open shadow roots are walked too. A TreeWalker stops at the shadow boundary,
  // and web components are exactly where today's sticky bars, cookie banners and
  // chat widgets live — measured on a fixture, a bar in a shadow root repeated on
  // all five screenfuls. A *closed* root stays invisible to us; nothing can be
  // done about that from outside (§7.4).
  function collectPinned(state) {
    const doc = document;
    const roots = [doc.body || doc.documentElement];
    let seen = 0;

    while (roots.length && seen < 20000) {
      const walker = doc.createTreeWalker(roots.shift(), NodeFilter.SHOW_ELEMENT);
      while (walker.nextNode() && seen < 20000) {
        seen++;
        const node = walker.currentNode;
        if (node.shadowRoot) roots.push(node.shadowRoot);
        if (state.known.has(node) || node.hasAttribute('data-fpc-overlay')) continue;
        const position = getComputedStyle(node).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        state.known.add(node);
        state.fixed.push({ el: node, sticky: position === 'sticky', hidden: false });
      }
    }
    return state.fixed.length;
  }

  // Sticky elements are unstuck rather than hidden — they are usually real
  // content, such as a table's column headings.
  //
  // Inline styles, not classes: a class would depend on the <style> element in
  // the document, and document styles do not cross into a shadow root. Anything
  // found inside a web component would have been collected and then not hidden.
  function hidePinned(state) {
    for (const entry of state.fixed) {
      if (entry.hidden) continue;
      const property = entry.sticky ? 'position' : 'visibility';
      entry.property = property;
      entry.previous = entry.el.style.getPropertyValue(property);
      entry.priority = entry.el.style.getPropertyPriority(property);
      entry.el.style.setProperty(property, entry.sticky ? 'static' : 'hidden', 'important');
      entry.hidden = true;
    }
  }

  async function freeze({ preloadLazyImages, lazyTimeout }) {
    const doc = document;
    const el = scroller();
    const state = {
      originalScrollY: el.scrollTop,
      originalScrollX: el.scrollLeft,
      videos: [],
      overflow: null,
      fixed: [],
      known: new Set(),
    };
    window.__fpcState = state;
    window.__fpcCancel = false;

    // Smooth scrolling turns every step into an animation we would have to wait
    // out; transitions and animations make two tiles disagree about the same
    // row of pixels.
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'html,body{scroll-behavior:auto !important}' + '*,*::before,*::after{animation-play-state:paused !important;transition:none !important}';
    (doc.head || doc.documentElement).appendChild(style);

    for (const video of doc.querySelectorAll('video')) {
      if (video.paused) continue;
      state.videos.push(video);
      try {
        video.pause();
      } catch (err) {
        // A video that refuses to pause is not worth failing a capture over.
      }
    }

    // A modal that locked the page would otherwise cap the capture at one
    // screenful.
    if (getComputedStyle(el).overflowY === 'hidden') {
      state.overflow = { el, value: el.style.getPropertyValue('overflow-y'), priority: el.style.getPropertyPriority('overflow-y') };
      el.style.setProperty('overflow-y', 'auto', 'important');
    }

    if (preloadLazyImages) await preloadImages(el, lazyTimeout);

    collectPinned(state);

    el.scrollTop = 0;
    await frames(2);

    // Re-measured: lazy loading routinely makes the page taller than it was
    // when it was first measured.
    return {
      fixedCount: state.fixed.length,
      contentHeight: Math.max(el.scrollHeight, el.clientHeight),
    };
  }

  async function beforeShot({ y, index, settleDelay }) {
    const state = window.__fpcState;
    if (!state) return { actualScrollY: 0, cancelled: true };
    const el = scroller();

    el.scrollTop = y;
    el.scrollLeft = 0;

    // Tile 0 keeps the header: that is where it genuinely belongs in the final
    // image. From tile 1 on it would be a band repeating down the page.
    if (index > 0) {
      // One frame first, so the page's own scroll handler has run and any bar
      // that pins itself on scroll is already `fixed` when we look.
      await frames(1);
      collectPinned(state);
      hidePinned(state);
    }

    setOverlayVisible(false);
    await frames(2);
    if (settleDelay > 0) await sleep(settleDelay);

    // The browser rounds scrollTop and stops early at the end of the page, so
    // the position the tile is drawn at comes from here, never from `y`
    // (spec R4).
    return { actualScrollY: el.scrollTop, cancelled: !!window.__fpcCancel };
  }

  function afterShot({ done, total, etaMs }) {
    setOverlayVisible(true);
    const host = document.querySelector('[data-fpc-overlay]');
    if (host && typeof host.__fpcProgress === 'function') host.__fpcProgress(done, total, etaMs);
    return { cancelled: !!window.__fpcCancel };
  }

  function unfreeze() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();

    const state = window.__fpcState;
    if (!state) return { ok: true };

    for (const entry of state.fixed) {
      if (!entry.hidden) continue;
      if (entry.previous) entry.el.style.setProperty(entry.property, entry.previous, entry.priority);
      else entry.el.style.removeProperty(entry.property);
    }

    if (state.overflow) {
      const { el, value, priority } = state.overflow;
      if (value) el.style.setProperty('overflow-y', value, priority);
      else el.style.removeProperty('overflow-y');
    }

    for (const video of state.videos) {
      const played = video.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    }

    const el = scroller();
    el.scrollTop = state.originalScrollY;
    el.scrollLeft = state.originalScrollX;

    setOverlayVisible(true);
    window.__fpcState = null;
    return { ok: true };
  }

  window.__fpcPrepare = { freeze, beforeShot, afterShot, unfreeze };
})();
