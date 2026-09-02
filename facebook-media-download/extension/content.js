// content.js — everything the user touches on facebook.com (spec §9.5, §10).
// Isolated world, running from document_start on every Facebook page.
//
// Two rules shape this file:
//
//   * It adds exactly ONE element to Facebook's DOM: a closed shadow host that
//     holds the button, the marks and the menu. Facebook rebuilds its feed
//     constantly, so a button attached to a post would be thrown away with it —
//     and hundreds of injected nodes would be a memory leak with a UI on top
//     (spec §9.5).
//   * It never blocks. Nothing here waits on the worker before the page responds
//     to the user.

(function () {
  'use strict';

  const S = globalThis.FbSelectors;
  const PostContext = globalThis.PostContext;
  const ImagePick = globalThis.ImagePick;
  const MediaIndex = globalThis.MediaIndex;

  const TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const MARK_BATCH_MS = 400;
  const THROTTLE_MS = 250;
  const MAX_MARKS = 40;

  let settings = { markDownloaded: true, videoQuality: 'highest' };
  let hovered = null; // the media element under the pointer
  let activeKey = null; // key of the media the button is currently showing
  const downloaded = new Set(); // keys known to be in the history
  const unknown = new Set(); // keys not yet asked about
  let marksDirty = true;

  // ─── Talking to the harvester in the MAIN world (spec §6.3, §15.4) ───────────

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.__fbms !== 1 || data.token !== TOKEN) return;

    if (data.kind === 'records') {
      MediaIndex.put(data.records);
      marksDirty = true;
    } else if (data.kind === 'stats') {
      MediaIndex.noteCounts(data.counts, data.lastError);
      report();
    }
  });

  function hello() {
    window.postMessage({ __fbms: 1, kind: 'hello', token: TOKEN }, location.origin);
  }

  // The MAIN-world script and this one are both injected at document_start and
  // the order between worlds is not guaranteed, so the handshake is repeated
  // until records start arriving. It is idempotent on the other side.
  hello();
  document.addEventListener('DOMContentLoaded', hello);
  window.addEventListener('load', hello);

  let reportTimer = null;
  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      send({ type: 'reportHarvest', stats: MediaIndex.stats() });
    }, 1000);
  }

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (err) {
      // The extension was reloaded or updated under a live page; the next full
      // page load fixes it and there is nothing useful to say here.
      return Promise.resolve(null);
    }
  }

  // ─── The one element we add to the page (spec §9.5) ──────────────────────────

  const host = document.createElement('div');
  host.setAttribute('data-fbms', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      button { font: 600 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .btn {
        position: absolute; display: none; align-items: center; justify-content: center; gap: 5px;
        min-width: 32px; height: 32px; padding: 0 8px; border: 0; border-radius: 8px;
        background: rgba(28, 30, 33, 0.82); color: #fff; cursor: pointer; pointer-events: auto;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); backdrop-filter: blur(2px);
      }
      .btn:hover { background: rgba(8, 102, 255, 0.95); }
      .btn.is-done { background: rgba(22, 128, 74, 0.92); }
      .btn.is-error { background: rgba(180, 35, 24, 0.94); }
      .btn.is-working { background: rgba(28, 30, 33, 0.82); cursor: progress; }
      .btn svg { width: 16px; height: 16px; display: block; }
      .spin { animation: fbms-spin 0.8s linear infinite; transform-origin: 50% 50%; }
      @keyframes fbms-spin { to { transform: rotate(360deg); } }
      .mark {
        position: absolute; width: 18px; height: 18px; border-radius: 50%;
        background: rgba(22, 128, 74, 0.92); color: #fff; pointer-events: none;
        display: flex; align-items: center; justify-content: center;
      }
      .mark svg { width: 11px; height: 11px; }
      .menu {
        position: absolute; display: none; min-width: 132px; padding: 4px; border-radius: 10px;
        background: rgba(28, 30, 33, 0.96); pointer-events: auto; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      }
      .menu button {
        display: block; width: 100%; padding: 7px 10px; border: 0; border-radius: 7px;
        background: transparent; color: #fff; text-align: left; cursor: pointer;
      }
      .menu button:hover { background: rgba(255, 255, 255, 0.14); }
      .toast {
        position: absolute; display: none; max-width: 280px; padding: 8px 11px; border-radius: 9px;
        background: rgba(28, 30, 33, 0.96); color: #fff; pointer-events: auto;
        font: 500 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
      }
    </style>
    <button class="btn" id="media" type="button" title="Save this media"></button>
    <button class="btn" id="post" type="button" title="Save every media in this post"></button>
    <div class="menu" id="menu"></div>
    <div class="toast" id="toast"></div>
    <div id="marks"></div>
  `;

  const el = (id) => root.getElementById(id);
  const ICON = {
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4 10-10"/></svg>',
    error:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 6v8"/><path d="M12 18h.01"/></svg>',
    spinner:
      '<svg class="spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>',
  };

  function attach() {
    if (host.isConnected) return;
    (document.body || document.documentElement).appendChild(host);
  }
  attach();
  document.addEventListener('DOMContentLoaded', attach);

  // ─── Button state (spec §10.4) ───────────────────────────────────────────────

  function setState(button, state, text) {
    button.classList.remove('is-done', 'is-error', 'is-working');
    if (state !== 'idle') button.classList.add(`is-${state}`);
    const icon = state === 'done' ? ICON.check : state === 'error' ? ICON.error : state === 'working' ? ICON.spinner : ICON.download;
    button.innerHTML = icon + (text ? `<span>${text}</span>` : '');
  }

  function showToast(message, x, y) {
    const toast = el('toast');
    toast.textContent = message;
    toast.style.display = 'block';
    toast.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 300))}px`;
    toast.style.top = `${Math.max(8, y)}px`;
    clearTimeout(showToast.timer);
    // Errors do not fade on their own — the user has to know the file is not on
    // disk (spec §10.4). This toast only carries the reason text, which is safe
    // to dismiss on the next interaction.
    showToast.timer = setTimeout(() => (toast.style.display = 'none'), 6000);
  }

  function hideExtras() {
    el('menu').style.display = 'none';
    el('toast').style.display = 'none';
  }

  // ─── Resolving what a click should download (spec §6.4) ──────────────────────

  function keyOf(media) {
    if (media.mediaId) return `id:${media.mediaId}`;
    return MediaIndex.hashKeyOf(media.url) || MediaIndex.pathKeyOf(media.url) || media.url;
  }

  function extensionOf(url, kind) {
    try {
      const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
      if (match) return match[1].toLowerCase();
    } catch (err) {
      // fall through
    }
    return kind === 'video' ? 'mp4' : 'jpg';
  }

  // { media } or { error, reason }
  function resolveMedia(element) {
    const kind = element.tagName === 'VIDEO' ? 'video' : 'image';
    const domCandidates = ImagePick.elementCandidates(element);
    const mediaId = ImagePick.mediaIdFor(element);
    const records = MediaIndex.lookup({ mediaId, urls: domCandidates.map((candidate) => candidate.url) });
    const typed = records.filter((record) => record.kind === kind);

    if (kind === 'video') {
      const playable = typed.filter((record) => record.url);
      if (!playable.length) {
        // Split audio/video is a different failure from "nothing found", and the
        // user can act on the difference (spec §8.3, §21).
        const split = typed.some((record) => record.dashOnly);
        return { error: split ? 'Split audio/video not supported yet.' : 'Could not find a downloadable stream.' };
      }
      const poster = typed.find((record) => record.poster);
      return {
        media: playable.map((record) => ({
          mediaId: mediaId || record.mediaId || '',
          kind: 'video',
          url: record.url,
          width: record.width,
          height: record.height,
          quality: record.quality,
          label: record.height ? `${record.height}p` : record.quality === 'hd' ? 'HD' : 'SD',
          poster: poster ? poster.poster : null,
          source: record.source,
          ext: extensionOf(record.url, 'video'),
        })),
      };
    }

    const best = typed[0];
    const fallback = domCandidates.find((candidate) => !candidate.poster);
    if (!best && !fallback) return { error: 'Could not find the full-size image.' };

    // A harvested record beats the DOM only when it is actually bigger. The feed
    // sometimes renders a copy larger than anything in the payload, and taking
    // the payload blindly would quietly downgrade the file (R8).
    const useRecord = best && (!fallback || (best.rank || 0) >= (fallback.rank || 0));
    const chosen = useRecord ? best : fallback;

    return {
      media: [
        {
          mediaId: mediaId || (useRecord ? best.mediaId : '') || '',
          kind: 'image',
          url: chosen.url,
          width: chosen.width || null,
          height: chosen.height || null,
          quality: '',
          label: chosen.width ? `${chosen.width} × ${chosen.height || '?'}` : '',
          source: useRecord ? chosen.source : 'dom',
          ext: extensionOf(chosen.url, 'image'),
          // Said out loud rather than hidden: the user is getting a resized copy
          // because that is all the page ever loaded (spec §7.2, §21).
          warning: useRecord ? null : 'Only a resized copy was available.',
        },
      ],
    };
  }

  function describe(resolved) {
    const first = resolved.media[0];
    const type = first.kind === 'video' ? 'MP4' : (first.ext || 'jpg').toUpperCase();
    return first.label ? `${type} · ${first.label}` : type;
  }

  // ─── Downloading (spec §15.1, §16) ───────────────────────────────────────────

  async function dispatch(button, element, mediaList) {
    const post = PostContext.resolve(element);
    const payload = {
      postId: post.postId,
      postUrl: post.postUrl,
      author: post.author,
      handle: post.handle,
      authorId: post.authorId,
      createdAt: post.createdAt,
      surface: post.surface,
    };

    const media = mediaList.map((item, index) => ({ ...item, index: index + 1, key: keyOf(item) }));
    activeKey = media[0].key;
    setState(button, 'working');

    const response = await send({ type: 'downloadMedia', post: payload, media });
    if (!response || !response.success) {
      setState(button, 'error');
      const rect = button.getBoundingClientRect();
      showToast((response && response.error) || 'The extension could not start the download.', rect.left, rect.bottom + 6);
    }
  }

  function chooseThenDispatch(button, element, resolved) {
    const options = resolved.media;
    // "Ask" only means anything when there is more than one stream to ask about
    // (spec §8.2).
    if (settings.videoQuality !== 'ask' || options.length < 2 || options[0].kind !== 'video') {
      dispatch(button, element, [options[0]]);
      return;
    }

    const menu = el('menu');
    menu.innerHTML = '';
    for (const option of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = option.label || option.quality || 'Video';
      item.addEventListener('click', () => {
        menu.style.display = 'none';
        dispatch(button, element, [option]);
      });
      menu.appendChild(item);
    }
    const rect = button.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 6}px`;
  }

  el('media').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideExtras();
    if (!hovered) return;
    const resolved = resolveMedia(hovered);
    if (resolved.error) {
      setState(el('media'), 'error');
      const rect = el('media').getBoundingClientRect();
      showToast(resolved.error, rect.left, rect.bottom + 6);
      return;
    }
    chooseThenDispatch(el('media'), hovered, resolved);
  });

  el('post').addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hideExtras();
    if (!hovered) return;

    const post = PostContext.resolve(hovered);
    const elements = ImagePick.mediaElementsIn(post.root);
    const media = [];
    const problems = [];
    for (const element of elements) {
      const resolved = resolveMedia(element);
      if (resolved.error) problems.push(resolved.error);
      else media.push(resolved.media[0]);
    }

    if (!media.length) {
      setState(el('post'), 'error', String(elements.length || ''));
      const rect = el('post').getBoundingClientRect();
      showToast(problems[0] || 'Nothing downloadable in this post.', rect.left - 200, rect.bottom + 6);
      return;
    }
    dispatch(el('post'), hovered, media);
  });

  // ─── Hover placement (spec §10.1) ────────────────────────────────────────────

  function mediaUnderPointer(x, y) {
    // elementsFromPoint rather than event.target: Facebook lays transparent
    // overlays over its photos, so the element receiving the mouse event is
    // usually not the <img> the user is pointing at.
    const stack = document.elementsFromPoint(x, y).slice(0, 12);
    for (const node of stack) {
      if (node === host) continue;
      if ((node.tagName === 'IMG' || node.tagName === 'VIDEO') && ImagePick.isEligible(node)) return node;
    }
    return null;
  }

  function place(element) {
    const media = el('media');
    const postButton = el('post');
    hovered = element;

    if (!element) {
      media.style.display = 'none';
      postButton.style.display = 'none';
      return;
    }

    const rect = element.getBoundingClientRect();
    const key = (function () {
      const id = ImagePick.mediaIdFor(element);
      const candidates = ImagePick.elementCandidates(element);
      return id ? `id:${id}` : candidates[0] ? MediaIndex.hashKeyOf(candidates[0].url) || candidates[0].url : null;
    })();

    activeKey = key;
    setState(media, key && downloaded.has(key) ? 'done' : 'idle');
    media.style.display = 'flex';
    media.style.left = `${Math.round(rect.right - 40)}px`;
    // Videos keep their own controls in the top-right on hover; 44px down clears
    // them (spec §10.1).
    media.style.top = `${Math.round(rect.top + (element.tagName === 'VIDEO' ? 52 : 8))}px`;

    const post = PostContext.resolve(element);
    const siblings = ImagePick.mediaElementsIn(post.root);
    if (siblings.length >= 2 && post.root) {
      const postRect = post.root.getBoundingClientRect();
      setState(postButton, 'idle', String(siblings.length));
      postButton.style.display = 'flex';
      postButton.style.left = `${Math.round(postRect.right - 62)}px`;
      postButton.style.top = `${Math.round(Math.max(8, postRect.top + 8))}px`;
    } else {
      postButton.style.display = 'none';
    }
  }

  // The pointer position is tracked separately because the button is placed from
  // a hit test, not from event.target — and mouseover does not always carry
  // usable coordinates for the element the user means.
  const lastPointer = { x: 0, y: 0 };
  document.addEventListener(
    'mousemove',
    (event) => {
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
    },
    { passive: true, capture: true }
  );

  // Coalesced: moving across a post fires mouseover on every span and div along
  // the way, and each one would otherwise cost an elementsFromPoint call.
  let hoverTimer = null;
  document.addEventListener(
    'mouseover',
    () => {
      if (hoverTimer) return;
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        const element = mediaUnderPointer(lastPointer.x, lastPointer.y);
        if (element !== hovered) place(element);
      }, 40);
    },
    true
  );

  // ─── "Already downloaded" marks (spec §17) ───────────────────────────────────

  const marked = []; // { element, node }

  function drawMarks() {
    const container = el('marks');
    if (!settings.markDownloaded) {
      container.innerHTML = '';
      marked.length = 0;
      return;
    }

    const wanted = [];
    for (const element of document.querySelectorAll('img, video')) {
      if (wanted.length >= MAX_MARKS) break;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (!ImagePick.isEligible(element)) continue;

      const id = ImagePick.mediaIdFor(element);
      const candidates = ImagePick.elementCandidates(element);
      const key = id ? `id:${id}` : candidates[0] ? MediaIndex.hashKeyOf(candidates[0].url) || candidates[0].url : null;
      if (!key) continue;

      if (downloaded.has(key)) wanted.push({ element, key });
      else if (!unknown.has(key)) unknown.add(key);
    }

    container.innerHTML = '';
    marked.length = 0;
    for (const item of wanted) {
      const node = document.createElement('div');
      node.className = 'mark';
      node.innerHTML = ICON.check;
      container.appendChild(node);
      marked.push({ element: item.element, node });
    }
    positionMarks();
  }

  function positionMarks() {
    for (const { element, node } of marked) {
      const rect = element.getBoundingClientRect();
      node.style.left = `${Math.round(rect.right - 26)}px`;
      node.style.top = `${Math.round(rect.bottom - 26)}px`;
      node.style.display = rect.bottom < 0 || rect.top > window.innerHeight ? 'none' : 'flex';
    }
  }

  async function askAboutUnknown() {
    if (!unknown.size) return;
    const keys = [...unknown].slice(0, 60);
    unknown.clear();
    const response = await send({ type: 'queryDownloaded', keys });
    const known = response && response.success ? response.data.downloaded : null;
    if (!known) return;
    let changed = false;
    for (const key of Object.keys(known)) {
      if (!downloaded.has(key)) {
        downloaded.add(key);
        changed = true;
      }
    }
    if (changed) marksDirty = true;
  }

  setInterval(() => {
    if (!settings.markDownloaded) return;
    if (marksDirty) {
      marksDirty = false;
      drawMarks();
    }
    askAboutUnknown();
  }, MARK_BATCH_MS);

  // One observer for the whole page, throttled. Facebook virtualises its feed:
  // per-post observers would mean hundreds of them, which is the reliable way to
  // make scrolling stutter (spec §9.5, §22).
  let throttleTimer = null;
  const observer = new MutationObserver(() => {
    if (throttleTimer) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      marksDirty = true;
      if (hovered && !hovered.isConnected) place(null);
    }, THROTTLE_MS);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let scrollFrame = null;
  window.addEventListener(
    'scroll',
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        positionMarks();
        // The buttons are anchored to a rect that just moved; re-deriving them on
        // the next hover is cheaper and less jittery than following the scroll.
        if (hovered) place(null);
        hideExtras();
      });
    },
    { passive: true, capture: true }
  );

  // ─── Messages from the worker (spec §15.3) ───────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message) return false;

    if (message.type === 'fbmsProgress') {
      if (message.state === 'done') {
        downloaded.add(message.mediaKey);
        marksDirty = true;
      }
      if (message.mediaKey === activeKey) {
        const button = el('post').style.display === 'flex' && message.batch ? el('post') : el('media');
        setState(button, message.state === 'done' ? 'done' : message.state === 'error' ? 'error' : 'working');
        if (message.state === 'error' && message.reason) {
          const rect = button.getBoundingClientRect();
          showToast(message.reason, rect.left, rect.bottom + 6);
        }
      }
      return false;
    }

    if (message.type === 'fbmsSettingsChanged') {
      settings = message.settings;
      marksDirty = true;
      return false;
    }

    if (message.type === 'fbmsShortcut') {
      const element = hovered || mediaUnderPointer(lastPointer.x, lastPointer.y);
      // No media under the pointer means the user pressed the shortcut for
      // something else; saying nothing is the right answer (spec §10.5).
      if (element) {
        place(element);
        el('media').click();
      }
      return false;
    }

    if (message.type === 'fbmsReharvest') {
      // The worker hit an expired link. Editing the old URL is not an option
      // (R3), so the only thing that can help is a record harvested since —
      // which is exactly what the index may now hold (spec §16.4).
      const records = MediaIndex.lookup({ mediaId: message.mediaId, urls: [] });
      const fresh = records.find((record) => record.url);
      sendResponse(fresh ? { url: fresh.url, quality: fresh.quality || '' } : null);
      return true;
    }

    if (message.type === 'fbmsDiagnostics') {
      sendResponse({
        url: location.href,
        anchors: S.probe(document),
        harvest: MediaIndex.stats(),
        eligibleMedia: [...document.querySelectorAll('img, video')].filter((node) => ImagePick.isEligible(node)).length,
      });
      return true;
    }

    return false;
  });

  send({ type: 'getSettings' }).then((response) => {
    if (response && response.success) settings = response.data;
  });
})();
