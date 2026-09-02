// post-context.js — works out which post a media element belongs to, and who
// wrote it (spec §9.2). Isolated world.
//
// Every step here is allowed to fail on its own. A missing author costs the
// {author} token and nothing else; the file still downloads. Blocking a download
// because a name could not be read would be a worse bug than an odd filename.

(function () {
  'use strict';

  const S = globalThis.FbSelectors;

  function surfaceOf(href) {
    const url = String(href || '');
    if (/\/reel\//.test(url)) return 'reel';
    if (/\/watch\b/.test(url)) return 'watch';
    if (/\/photo(\.php)?\b/.test(url)) return 'photo';
    if (/\/posts\/|\/permalink\.php|\/story\.php|\/videos\//.test(url)) return 'permalink';
    return 'feed';
  }

  // { id, kind } for the first permalink-shaped link, or null.
  function matchPermalink(href) {
    for (const pattern of S.PERMALINK_PATTERNS) {
      const match = pattern.re.exec(href);
      if (match) return { id: match[pattern.idFrom], kind: pattern.kind };
    }
    return null;
  }

  // The post box around a media element, tried in the order of how much the
  // markup is trusted (spec §9.2).
  function findPostRoot(element) {
    return (
      S.closest(element, 'feedUnit') ||
      S.closest(element, 'article') ||
      // Last resort: climb until an ancestor contains a permalink link. Capped
      // because an unbounded climb ends at <body>, which is not a post.
      (function climb() {
        let node = element;
        for (let depth = 0; node && depth < 25; depth++) {
          if (node.querySelector && [...node.querySelectorAll('a[href]')].some((a) => matchPermalink(a.getAttribute('href') || ''))) return node;
          node = node.parentElement;
        }
        return null;
      })()
    );
  }

  function absolute(href) {
    try {
      return new URL(href, location.origin).href;
    } catch (err) {
      return null;
    }
  }

  function permalinkIn(root) {
    if (!root) return null;
    for (const anchor of root.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      const match = matchPermalink(href);
      if (match) return { ...match, url: absolute(href) };
    }
    return null;
  }

  // The author link is the first profile-shaped link in the top of the post.
  // "Top" matters: a post that tags people or quotes a share has profile links
  // further down, and the first one in document order is the writer.
  function findAuthor(root) {
    if (!root) return { author: '', handle: '', authorId: '' };

    const rootTop = root.getBoundingClientRect().top;
    const rootHeight = Math.max(1, root.getBoundingClientRect().height);

    for (const anchor of root.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('/') && !href.startsWith('https://www.facebook.com')) continue;
      if (matchPermalink(href)) continue;

      let path;
      try {
        path = new URL(href, location.origin);
      } catch (err) {
        continue;
      }

      const segment = path.pathname.split('/').filter(Boolean)[0] || '';
      const profileId = path.pathname === '/profile.php' ? path.searchParams.get('id') || '' : '';
      if (!profileId && (!segment || S.RESERVED_SEGMENTS.has(segment))) continue;

      const text = (anchor.textContent || '').trim();
      if (!text || text.length > 80) continue;

      // Only the header area: below a third of the post height it is a comment,
      // a tag or a shared post's author, not this post's.
      const offset = anchor.getBoundingClientRect().top - rootTop;
      if (offset > rootHeight / 3) continue;

      return { author: text, handle: profileId || segment, authorId: profileId };
    }

    return { author: '', handle: '', authorId: '' };
  }

  // Facebook renders relative times ("2h") with no machine-readable timestamp in
  // the general case. The old attributes are still checked because they cost
  // nothing when absent; when nothing is found the caller falls back to the
  // download date (spec §13.1).
  function findCreatedAt(root) {
    if (!root) return null;
    const utime = root.querySelector('[data-utime]');
    if (utime) {
      const seconds = parseInt(utime.getAttribute('data-utime'), 10);
      if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
    }
    const time = root.querySelector('time[datetime]');
    if (time) {
      const parsed = Date.parse(time.getAttribute('datetime'));
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }
    return null;
  }

  // Media on a permalink/watch/reel page often has no post box around it at all;
  // the page URL is the post.
  function fromLocation() {
    const match = matchPermalink(location.pathname + location.search);
    return {
      postId: match ? match.id : '',
      postUrl: location.href,
      kind: match ? match.kind : '',
    };
  }

  function resolve(element) {
    const root = findPostRoot(element);
    const link = permalinkIn(root) || (root ? null : { ...fromLocation() });
    const fallback = fromLocation();
    const author = findAuthor(root);

    const postUrl = (link && link.url) || fallback.postUrl || location.href;
    return {
      root,
      postId: (link && link.id) || fallback.postId || '',
      postUrl,
      surface: surfaceOf(postUrl === location.href ? location.pathname + location.search : postUrl),
      createdAt: findCreatedAt(root),
      ...author,
    };
  }

  globalThis.PostContext = { resolve, findPostRoot, findAuthor, matchPermalink, surfaceOf, permalinkIn };
})();
