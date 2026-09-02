// json-scan.js — walks a parsed Facebook payload and picks out media nodes
// (spec §6.2). Runs in the page's MAIN world.
//
// It matches on the SHAPE of a node, never on a path of keys. Facebook's key
// paths (`__bbox.result.data.…`) are rewritten every few months, while "an
// object that has a playable_url" has survived every rewrite so far — the same
// reason yt-dlp's Facebook extractor keys off field names rather than location.
//
// MAIN-world scripts share globals with the page, so this file hands its API
// over on a single well-known name that injected-harvest.js takes and deletes,
// leaving nothing of ours on the page's window.

globalThis.__fbmsJsonScan = (() => {
  'use strict';

  const VideoPick = globalThis.__fbmsVideoPick;

  // Budgets. A feed payload is routinely several MB; without a ceiling this walk
  // is the thing that makes scrolling stutter (spec §6.2, §22).
  const MAX_DEPTH = 32;
  const MAX_NODES = 200000;
  const MAX_STRING = 8192;

  // Both the photo CDN (scontent-*) and the video CDN (video-*) live under
  // fbcdn.net, so the suffix is the check. The service worker re-validates every
  // URL before it downloads anything (spec §16.1) — this test is about not
  // collecting junk, not about safety.
  function isFbcdn(url) {
    if (typeof url !== 'string' || url.length > MAX_STRING) return false;
    if (!url.startsWith('https://')) return false;
    try {
      const host = new URL(url).hostname;
      return host === 'fbcdn.net' || host.endsWith('.fbcdn.net');
    } catch (err) {
      return false;
    }
  }

  // `oe` is the URL's expiry, hex seconds since the epoch. Reading it lets the
  // index drop links that can no longer be downloaded instead of failing at the
  // moment the user finally clicks (spec §2.3, §16.4).
  function expiryOf(url) {
    try {
      const oe = new URL(url).searchParams.get('oe');
      if (!oe) return null;
      const seconds = parseInt(oe, 16);
      return Number.isFinite(seconds) && seconds > 1000000000 ? seconds * 1000 : null;
    } catch (err) {
      return null;
    }
  }

  function num(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  // Facebook ids are numeric strings. `pfbid…` story ids and base64 cursors are
  // deliberately not accepted: they are opaque, per-viewer and unstable, so
  // joining media to them would make the "already downloaded" mark flicker
  // between sessions (spec §2.2, §14).
  function isNumericId(value) {
    return typeof value === 'string' && value.length >= 6 && value.length <= 24 && /^\d+$/.test(value);
  }

  function imageCandidate(node) {
    const uri = typeof node.uri === 'string' ? node.uri : typeof node.url === 'string' ? node.url : null;
    if (!uri || !isFbcdn(uri)) return null;

    // Width and height are required, not optional. A bare `{ uri }` node is
    // usually an avatar or an emoji sprite, and admitting it would let a 40px
    // image win the join against the photo the user actually asked for — the
    // exact class of silent wrong download that R8 forbids.
    const width = num(node.width);
    const height = num(node.height);
    if (!width || !height) return null;

    return { url: uri, width, height };
  }

  // Nodes worth stopping on, tested cheaply before the more expensive extraction.
  const VIDEO_KEYS = [
    'playable_url',
    'playable_url_quality_hd',
    'browser_native_sd_url',
    'browser_native_hd_url',
    'hd_src',
    'sd_src',
    'dash_manifest',
    'dash_manifest_xml_string',
    'dash_manifests',
    'progressive_urls',
    'videoDeliveryResponseFragment',
    'all_video_dash_prefetch_representations',
  ];

  function looksLikeVideo(node) {
    for (const key of VIDEO_KEYS) {
      if (key in node) return true;
    }
    return false;
  }

  // Walks `root`, calling back for every object. Iterative rather than recursive:
  // a 32-deep recursion over a multi-megabyte payload is a stack overflow waiting
  // for the one page that nests deeper than expected.
  //
  // `nearestId` is carried down the stack so an image node several levels below a
  // `{ __typename: "Photo", id: "…" }` still knows which photo it belongs to.
  function walk(root, visit) {
    const seen = new WeakSet();
    const stack = [{ value: root, depth: 0, nearestId: null }];
    let budget = MAX_NODES;

    while (stack.length) {
      const frame = stack.pop();
      const value = frame.value;
      if (!value || typeof value !== 'object') continue;
      if (frame.depth > MAX_DEPTH) continue;
      if (budget-- <= 0) return { truncated: true };
      if (seen.has(value)) continue;
      seen.add(value);

      let nearestId = frame.nearestId;
      if (!Array.isArray(value)) {
        if (isNumericId(value.id)) nearestId = value.id;
        // A video's own id beats an enclosing story id for naming the file.
        if (isNumericId(value.videoId)) nearestId = value.videoId;
        visit(value, nearestId);
      }

      for (const key in value) {
        const child = value[key];
        if (child && typeof child === 'object') stack.push({ value: child, depth: frame.depth + 1, nearestId });
      }
    }

    return { truncated: false };
  }

  // Returns flat media records (spec §2.3). One record per candidate URL: the
  // index on the other side of the message port groups and ranks them, so
  // nothing here has to know about the user's quality setting.
  function scan(root, source) {
    const records = [];
    const now = Date.now();

    function push(record) {
      if (records.length >= 400) return; // one payload should not flood the index
      records.push({ ...record, source, harvestedAt: now });
    }

    const result = walk(root, (node, nearestId) => {
      if (looksLikeVideo(node)) {
        const video = VideoPick.fromNode(node);
        const mediaId = isNumericId(node.id) ? node.id : nearestId;
        if (video.candidates.length) {
          for (const candidate of video.candidates) {
            push({
              mediaId,
              kind: 'video',
              url: candidate.url,
              width: candidate.width,
              height: candidate.height,
              quality: candidate.quality,
              rank: candidate.rank,
              poster: video.poster,
              expiresAt: expiryOf(candidate.url),
            });
          }
        } else if (video.dashOnly) {
          // Recorded on purpose: without it the button would report "no stream
          // found", which is a different problem with a different answer
          // (spec §8.3, §21).
          push({ mediaId, kind: 'video', url: null, dashOnly: true, poster: video.poster });
        }
        return;
      }

      const image = imageCandidate(node);
      if (image) {
        push({
          mediaId: nearestId,
          kind: 'image',
          url: image.url,
          width: image.width,
          height: image.height,
          rank: image.width * image.height,
          expiresAt: expiryOf(image.url),
        });
      }
    });

    return { records, truncated: result.truncated };
  }

  return { scan, walk, isFbcdn, expiryOf, isNumericId };
})();
