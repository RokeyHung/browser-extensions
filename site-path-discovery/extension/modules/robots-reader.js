// robots-reader.js — fetches and parses /robots.txt (spec §6.4, §14.3).
// Extracts Allow / Disallow paths and Sitemap URLs. Paths are informational
// only — they are NOT crawl permission.

(function () {
  'use strict';

  // Parse robots.txt text into { allow[], disallow[], sitemaps[] }.
  function parse(text) {
    const allow = [];
    const disallow = [];
    const sitemaps = [];
    if (!text) return { allow, disallow, sitemaps };

    const lines = text.split(/\r?\n/);
    for (let line of lines) {
      const hash = line.indexOf('#');
      if (hash !== -1) line = line.slice(0, hash);
      line = line.trim();
      if (!line) continue;

      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const field = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (!value) continue;

      if (field === 'allow') allow.push(value);
      else if (field === 'disallow') disallow.push(value);
      else if (field === 'sitemap') sitemaps.push(value);
    }
    return {
      allow: [...new Set(allow)],
      disallow: [...new Set(disallow)],
      sitemaps: [...new Set(sitemaps)],
    };
  }

  // Fetch + parse. Returns { found, status, allow, disallow, sitemaps } or
  // { found:false } on 404 / network error.
  async function fetchRobots(origin) {
    const url = origin.replace(/\/+$/, '') + '/robots.txt';
    try {
      const res = await fetch(url, { credentials: 'omit', redirect: 'follow' });
      if (!res.ok) return { found: false, status: res.status, allow: [], disallow: [], sitemaps: [] };
      const text = await res.text();
      const parsed = parse(text);
      return { found: true, status: res.status, url, ...parsed };
    } catch (e) {
      return { found: false, status: 0, error: String(e), allow: [], disallow: [], sitemaps: [] };
    }
  }

  globalThis.RobotsReader = { parse, fetchRobots };
})();
