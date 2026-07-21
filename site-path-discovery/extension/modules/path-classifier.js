// path-classifier.js — assigns each discovered URL to a group:
// page | api | asset | external | robots | sitemap  (spec §7).
// Robots/sitemap are provenance-driven and passed in explicitly; the rest is
// inferred from resourceType, path shape and file extension.

(function () {
  'use strict';

  const ASSET_EXT = new Set([
    'js',
    'mjs',
    'css',
    'map',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'avif',
    'ico',
    'bmp',
    'woff',
    'woff2',
    'ttf',
    'otf',
    'eot',
    'mp4',
    'webm',
    'ogg',
    'mp3',
    'wav',
    'm4a',
    'mov',
    'pdf',
    'zip',
    'gz',
    'wasm',
  ]);

  const API_RESOURCE_TYPES = new Set(['xmlhttprequest', 'fetch', 'websocket']);
  const ASSET_RESOURCE_TYPES = new Set(['script', 'stylesheet', 'image', 'font', 'media']);
  const PAGE_RESOURCE_TYPES = new Set(['main_frame', 'document', 'sub_frame']);

  const API_PATH_RE = /(^|\/)(api|v\d+|rest|graphql|gql|rpc|oauth|auth)(\/|$)/i;

  function extensionOf(pathname) {
    const clean = String(pathname || '').split(/[?#]/)[0];
    const seg = clean.split('/').pop() || '';
    const dot = seg.lastIndexOf('.');
    if (dot <= 0) return '';
    return seg.slice(dot + 1).toLowerCase();
  }

  function looksLikeApiPath(pathname) {
    return API_PATH_RE.test(String(pathname || ''));
  }

  function looksLikeAsset(pathname) {
    return ASSET_EXT.has(extensionOf(pathname));
  }

  // Map a webRequest resourceType to a group (best-effort, pre-scope).
  function fromResourceType(resourceType) {
    if (!resourceType) return null;
    if (API_RESOURCE_TYPES.has(resourceType)) return 'api';
    if (ASSET_RESOURCE_TYPES.has(resourceType)) return 'asset';
    if (PAGE_RESOURCE_TYPES.has(resourceType)) return 'page';
    return null;
  }

  // Full classification.
  //   input: { normalizedUrl, path, resourceType, contentType, sourceOrigin }
  //   source scope is decided by the caller via `isExternal`.
  function classify({ path, resourceType, contentType, isExternal, forcedType } = {}) {
    if (forcedType) return forcedType; // robots / sitemap provenance wins
    if (isExternal) return 'external';

    const ct = String(contentType || '').toLowerCase();
    if (ct.includes('application/json') || ct.includes('/graphql')) return 'api';

    const byResource = fromResourceType(resourceType);
    if (byResource === 'asset') return 'asset';
    if (byResource === 'api') return 'api';

    if (looksLikeAsset(path)) return 'asset';
    if (looksLikeApiPath(path)) return 'api';

    if (byResource === 'page') return 'page';

    // Default: treat as a page route.
    return 'page';
  }

  globalThis.PathClassifier = {
    classify,
    fromResourceType,
    looksLikeApiPath,
    looksLikeAsset,
    extensionOf,
  };
})();
