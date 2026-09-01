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

  async function freeze({ preloadLazyImages, lazyTimeout }) {
    const doc = document;
    const el = scroller();
    const state = {
      originalScrollY: el.scrollTop,
      originalScrollX: el.scrollLeft,
      videos: [],
      overflow: null,
      fixed: [],
      hidden: false,
    };
    window.__fpcState = state;
    window.__fpcCancel = false;

    // Smooth scrolling turns every step into an animation we would have to wait
    // out; transitions and animations make two tiles disagree about the same
    // row of pixels.
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      'html,body{scroll-behavior:auto !important}' +
      '*,*::before,*::after{animation-play-state:paused !important;transition:none !important}' +
      '.__fpc_hidden{visibility:hidden !important}' +
      '.__fpc_unstick{position:static !important}';
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

    // Fixed and sticky elements repeat on every tile unless dealt with. Collected
    // once here so the per-tile path is a class toggle rather than a DOM walk.
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_ELEMENT);
    let seen = 0;
    while (walker.nextNode() && seen < 20000) {
      seen++;
      const node = walker.currentNode;
      if (node.hasAttribute('data-fpc-overlay')) continue;
      const position = getComputedStyle(node).position;
      if (position !== 'fixed' && position !== 'sticky') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      state.fixed.push({ el: node, sticky: position === 'sticky' });
    }

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
    // image. From tile 1 on it would be a band repeating down the page. Sticky
    // elements are unstuck rather than hidden — they are usually real content,
    // such as a table's column headings.
    if (index > 0 && !state.hidden) {
      for (const entry of state.fixed) entry.el.classList.add(entry.sticky ? '__fpc_unstick' : '__fpc_hidden');
      state.hidden = true;
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

    for (const entry of state.fixed) entry.el.classList.remove('__fpc_hidden', '__fpc_unstick');

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
