// content.js — the in-page progress overlay (spec §9). Injected for the
// duration of a capture, never a persistent content script.
//
// It carries its own CSS inside a closed shadow root rather than using
// insertCSS: a shadow root does not accept injected stylesheets, and the
// alternative — linking a web-accessible resource — would leak the extension's
// ID to any page that cared to look. The only trace left in the DOM is one
// element marked data-fpc-overlay, which page-prepare.js hides for every shot
// so the overlay never photographs itself.

(function () {
  'use strict';

  const ATTRIBUTE = 'data-fpc-overlay';
  if (document.querySelector(`[${ATTRIBUTE}]`)) return;

  const host = document.createElement('div');
  host.setAttribute(ATTRIBUTE, '');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:0;pointer-events:none';
  const root = host.attachShadow({ mode: 'closed' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .shield {
        position: fixed; inset: 0; pointer-events: auto; cursor: progress;
        background: transparent;
      }
      .card {
        position: fixed; right: 16px; bottom: 16px; width: 300px;
        box-sizing: border-box; padding: 12px 14px; border-radius: 12px;
        background: rgba(17, 24, 39, 0.94); color: #f9fafb;
        font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35); pointer-events: auto;
      }
      .title { font-weight: 600; }
      .url {
        margin-top: 2px; color: #9ca3af; font-size: 12px; font-weight: 400;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .track { height: 4px; margin: 10px 0 8px; border-radius: 2px; background: rgba(255, 255, 255, 0.16); overflow: hidden; }
      .bar { height: 100%; width: 0; background: linear-gradient(90deg, #5546CB, #8b7cf6); transition: width 120ms linear; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .detail { color: #9ca3af; font-size: 12px; font-weight: 400; }
      .stop {
        border: 0; border-radius: 7px; padding: 5px 12px; cursor: pointer;
        background: #f3f4f6; color: #111827; font-family: inherit; font-size: 12px; font-weight: 600;
      }
      .stop:hover { background: #fff; }
      .error { margin-top: 8px; color: #fca5a5; font-size: 12px; font-weight: 400; }
    </style>
    <div class="shield"></div>
    <div class="card">
      <div class="title" id="title">Preparing…</div>
      <div class="url" id="url"></div>
      <div class="track"><div class="bar" id="bar"></div></div>
      <div class="row">
        <span class="detail" id="detail">Starting</span>
        <button class="stop" id="stop" type="button">Stop</button>
      </div>
      <div class="error" id="error" hidden></div>
    </div>
  `;

  const el = (id) => root.getElementById(id);
  (document.body || document.documentElement).appendChild(host);

  function stop() {
    // Two channels on purpose: the flag is read by the injected page functions
    // between shots (same isolated world, no round trip), and the message
    // reaches the worker, which owns the capture.
    window.__fpcCancel = true;
    el('title').textContent = 'Stopping…';
    el('stop').disabled = true;
    chrome.runtime.sendMessage({ type: 'stopCapture' }).catch(() => null);
  }

  el('stop').addEventListener('click', stop);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') stop();
    },
    true
  );

  function formatEta(ms) {
    if (!ms || ms < 1000) return '';
    return ` · ~${Math.round(ms / 1000)}s left`;
  }

  // Called directly by page-prepare.js after every shot — same world, so the
  // per-tile progress costs no messaging at all (spec §15.2).
  host.__fpcProgress = (done, total, etaMs) => {
    el('bar').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
    el('detail').textContent = `Screen ${done} / ${total}${formatEta(etaMs)}`;
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'fpcStart') {
      el('title').textContent = 'Capturing this page';
      try {
        el('url').textContent = new URL(message.url).pathname;
      } catch (err) {
        el('url').textContent = message.url || '';
      }
      el('detail').textContent = 'Preparing';
      el('bar').style.width = '0%';
    } else if (message.type === 'fpcPhase') {
      el('detail').textContent = message.label;
    } else if (message.type === 'fpcError') {
      el('error').hidden = false;
      el('error').textContent = message.message;
    } else if (message.type === 'fpcDone') {
      host.remove();
    }
  });
})();
