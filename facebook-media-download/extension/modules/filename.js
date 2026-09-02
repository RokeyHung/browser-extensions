// filename.js — turns a post plus a media record into the path chrome.downloads
// writes (spec §13). Service worker only: the content script never decides where
// a file lands.

(function () {
  'use strict';

  // Everything a file system or a download manager objects to, control characters
  // included. `/` is handled separately because it is the legal separator inside
  // the subfolder setting.
  // eslint-disable-next-line no-control-regex
  const INVALID = /[\\:*?"<>|\x00-\x1f]/g;
  const MAX_PATH = 180;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function dateTokens(iso) {
    const date = iso ? new Date(iso) : new Date();
    const safe = Number.isFinite(date.getTime()) ? date : new Date();
    const ymd = `${safe.getFullYear()}-${pad(safe.getMonth() + 1)}-${pad(safe.getDate())}`;
    return { date: ymd, datetime: `${ymd}_${pad(safe.getHours())}-${pad(safe.getMinutes())}-${pad(safe.getSeconds())}` };
  }

  // Applied to one path segment. The order matters: `..` has to go after the
  // invalid-character pass, or `.` sequences left by a replacement could rebuild
  // it (spec §13.2).
  function sanitizeSegment(text) {
    return String(text || '')
      .replace(INVALID, '-')
      .replace(/\.{2,}/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.]+|[\s.]+$/g, '')
      .trim();
  }

  function sanitizeSubfolder(text) {
    return String(text || '')
      .split('/')
      .map(sanitizeSegment)
      .filter(Boolean)
      .join('/');
  }

  // Cuts from the middle, keeping the tail. The end of a name holds {index} and
  // {quality}: dropping it would make every photo in an album share one name and
  // let conflictAction quietly renumber them into nonsense (spec §13.2).
  function fit(name, budget) {
    if (name.length <= budget) return name;
    if (budget < 16) return name.slice(0, Math.max(1, budget));
    const tail = Math.min(24, Math.floor(budget / 3));
    return `${name.slice(0, budget - tail - 1)}-${name.slice(-tail)}`;
  }

  function tokensFor({ post, media }) {
    const times = dateTokens(post && post.createdAt);
    return {
      author: (post && post.author) || 'unknown',
      handle: (post && post.handle) || 'unknown',
      postId: (post && post.postId) || 'no-id',
      mediaId: media.mediaId || (media.key || '').replace(/^[a-z]+:/, '').slice(0, 8) || 'no-id',
      index: String(media.index || 1),
      date: times.date,
      datetime: times.datetime,
      type: media.kind === 'video' ? 'video' : 'photo',
      quality: media.kind === 'video' ? media.quality || '' : '',
      surface: (post && post.surface) || 'feed',
    };
  }

  function render(pattern, tokens) {
    return String(pattern || '').replace(/\{(\w+)\}/g, (match, name) => (name in tokens ? tokens[name] : match));
  }

  // The extension is never part of the pattern: letting a user type one is how a
  // file called .jpg ends up holding an MP4 (spec §13.1).
  function extensionOf(media) {
    const ext = String(media.ext || '').toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
    return media.kind === 'video' ? 'mp4' : 'jpg';
  }

  function build({ pattern, subfolder, post, media, posterOf }) {
    const tokens = tokensFor({ post, media });
    const ext = posterOf ? 'jpg' : extensionOf(media);

    let name = sanitizeSegment(render(pattern, tokens));
    if (posterOf) name = sanitizeSegment(`${name}-poster`);
    if (!name) name = 'facebook-media';

    const folder = sanitizeSubfolder(subfolder);
    const budget = MAX_PATH - (folder ? folder.length + 1 : 0) - ext.length - 1;
    const file = `${fit(name, Math.max(8, budget))}.${ext}`;
    return folder ? `${folder}/${file}` : file;
  }

  globalThis.Filename = { build, render, tokensFor, sanitizeSegment, sanitizeSubfolder, fit, MAX_PATH };
})();
