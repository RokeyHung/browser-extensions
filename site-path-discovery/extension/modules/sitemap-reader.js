// sitemap-reader.js — fetches and parses sitemaps (spec §6.5, §14.4).
// Supports <urlset>, <sitemapindex> (recursed with a cap), and plain-text
// sitemaps. Gzip is handled transparently by fetch when the server sets the
// right headers. Runs in the MV3 worker (no DOMParser) → regex parsing.

(function () {
  'use strict';

  const DEFAULT_CANDIDATES = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];
  const MAX_SITEMAPS = 25; // safety cap on index recursion
  const MAX_URLS = 5000; // safety cap on collected URLs

  function extractTag(block, tag) {
    const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i').exec(block);
    return m ? decodeXml(m[1].trim()) : null;
  }

  function decodeXml(s) {
    return String(s)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  // Parse one sitemap document. Returns { kind:'index'|'urlset'|'text',
  //   sitemaps[], urls:[{loc, lastmod}] }.
  function parse(text, contentType) {
    const trimmed = (text || '').trim();

    const isXml = /^</.test(trimmed) || /<(urlset|sitemapindex)\b/i.test(trimmed);
    if (!isXml) {
      // Plain-text sitemap: one URL per line.
      const urls = trimmed
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l))
        .map((loc) => ({ loc, lastmod: null }));
      return { kind: 'text', sitemaps: [], urls };
    }

    // Sitemap index → collect child sitemap URLs.
    if (/<sitemapindex\b/i.test(trimmed)) {
      const sitemaps = [];
      const re = /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi;
      let m;
      while ((m = re.exec(trimmed)) !== null) {
        const loc = extractTag(m[1], 'loc');
        if (loc) sitemaps.push(loc);
      }
      return { kind: 'index', sitemaps, urls: [] };
    }

    // Regular urlset.
    const urls = [];
    const re = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
    let m;
    while ((m = re.exec(trimmed)) !== null) {
      const loc = extractTag(m[1], 'loc');
      if (loc) urls.push({ loc, lastmod: extractTag(m[1], 'lastmod') });
    }
    // Fallback: <loc> tags not wrapped in <url>.
    if (urls.length === 0) {
      const locRe = /<loc>([\s\S]*?)<\/loc>/gi;
      while ((m = locRe.exec(trimmed)) !== null) {
        const loc = decodeXml(m[1]);
        if (loc) urls.push({ loc, lastmod: null });
      }
    }
    return { kind: 'urlset', sitemaps: [], urls };
  }

  async function fetchText(url) {
    const res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
    if (!res.ok) return { ok: false, status: res.status, text: '' };
    const text = await res.text();
    return { ok: true, status: res.status, text, contentType: res.headers.get('content-type') || '' };
  }

  // Discover + read sitemaps for a site.
  //   origin: "https://example.com"
  //   seeds:  extra sitemap URLs (e.g. from robots.txt Sitemap: lines)
  // Returns { sitemapsRead, urls:[{loc,lastmod}], tried[], errors[] }.
  async function collect(origin, seeds) {
    const base = origin.replace(/\/+$/, '');
    const queue = [];
    const seen = new Set();
    const tried = [];
    const errors = [];
    const urls = [];
    let sitemapsRead = 0;

    for (const s of seeds || []) if (s) queue.push(s);
    for (const c of DEFAULT_CANDIDATES) queue.push(base + c);

    while (queue.length && sitemapsRead < MAX_SITEMAPS && urls.length < MAX_URLS) {
      const sm = queue.shift();
      if (!sm || seen.has(sm)) continue;
      seen.add(sm);
      tried.push(sm);

      let doc;
      try {
        doc = await fetchText(sm);
      } catch (e) {
        errors.push({ url: sm, error: String(e) });
        continue;
      }
      if (!doc.ok) {
        errors.push({ url: sm, status: doc.status });
        continue;
      }

      sitemapsRead++;
      const parsed = parse(doc.text, doc.contentType);
      for (const child of parsed.sitemaps) if (!seen.has(child)) queue.push(child);
      for (const u of parsed.urls) {
        urls.push(u);
        if (urls.length >= MAX_URLS) break;
      }
    }

    return { sitemapsRead, urls, tried, errors };
  }

  globalThis.SitemapReader = { DEFAULT_CANDIDATES, parse, collect };
})();
