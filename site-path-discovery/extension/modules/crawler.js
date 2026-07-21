// crawler.js — bounded BFS crawler (spec §6.6, §14.5, AC-08/09).
// Safety rails: max depth, max pages, per-request delay, stop flag, optional
// robots.txt respect, no external domains, no forms, no side-effecting actions.
// Only GET fetches of same-scope HTML; extracts links via DomScanner.

(function () {
  'use strict';

  const N = globalThis.UrlNormalizer;
  const DomScanner = globalThis.DomScanner;
  const RobotsReader = globalThis.RobotsReader;

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Build a simple robots.txt matcher (prefix based, longest-match wins).
  function buildRobotsMatcher(robots) {
    const disallow = (robots && robots.disallow) || [];
    const allow = (robots && robots.allow) || [];
    return function isAllowed(pathname) {
      let decision = true;
      let best = -1;
      for (const rule of disallow) {
        if (rule && pathname.startsWith(rule) && rule.length > best) {
          best = rule.length;
          decision = false;
        }
      }
      for (const rule of allow) {
        if (rule && pathname.startsWith(rule) && rule.length > best) {
          best = rule.length;
          decision = true;
        }
      }
      return decision;
    };
  }

  // Create a crawl controller.
  //   config: { startUrl, scope, maxDepth, maxPages, requestDelayMs,
  //             respectRobotsTxt, includeQueryParams }
  //   hooks:  { onRecords(records), onProgress(state), normalizeOpts, robots }
  function createCrawler(config, hooks) {
    const cfg = {
      scope: 'same-origin',
      maxDepth: 2,
      maxPages: 100,
      requestDelayMs: 500,
      respectRobotsTxt: true,
      includeQueryParams: false,
      ...config,
    };
    const onRecords = (hooks && hooks.onRecords) || (() => {});
    const onProgress = (hooks && hooks.onProgress) || (() => {});
    const normalizeOpts = (hooks && hooks.normalizeOpts) || {};

    let stopped = false;
    const state = { scannedPages: 0, queued: 0, discoveredPaths: 0, errors: [] };

    const startNorm = N.normalize(cfg.startUrl, undefined, normalizeOpts);
    const origin = startNorm ? startNorm.origin : cfg.startUrl;

    const isAllowedByRobots = cfg.respectRobotsTxt && hooks && hooks.robots ? buildRobotsMatcher(hooks.robots) : () => true;

    function stop() {
      stopped = true;
    }

    async function run() {
      if (!startNorm) {
        state.errors.push({ url: cfg.startUrl, error: 'invalid start URL' });
        return finish();
      }

      const visited = new Set();
      // queue items: { url, depth }
      const queue = [{ url: startNorm.normalizedUrl, depth: 0 }];
      visited.add(startNorm.normalizedUrl);

      while (queue.length && state.scannedPages < cfg.maxPages && !stopped) {
        const { url, depth } = queue.shift();
        state.queued = queue.length;

        const norm = N.normalize(url, undefined, normalizeOpts);
        if (!norm) continue;
        if (cfg.respectRobotsTxt && !isAllowedByRobots(norm.path)) continue;

        let html;
        try {
          const res = await fetch(norm.url, { credentials: 'omit', redirect: 'follow' });
          state.scannedPages++;
          const contentType = res.headers.get('content-type') || '';
          // Record the page itself.
          emit([{ ...norm, type: 'page', source: 'crawl', method: 'GET', statusCode: res.status, discoveredFrom: url, metadata: { contentType } }]);
          if (!res.ok || !/text\/html|application\/xhtml/i.test(contentType)) {
            if (!res.ok) state.errors.push({ url: norm.url, status: res.status });
            onProgress({ ...state });
            await delay(cfg.requestDelayMs);
            continue;
          }
          html = await res.text();
        } catch (e) {
          state.scannedPages++;
          state.errors.push({ url: norm.url, error: String(e) });
          onProgress({ ...state });
          await delay(cfg.requestDelayMs);
          continue;
        }

        // Extract every candidate link on the page for discovery.
        const candidates = DomScanner.extractFromHtml(html);
        const records = [];
        const nextLinks = [];
        for (const c of candidates) {
          const cn = N.normalize(c.raw, norm.url, normalizeOpts);
          if (!cn) continue;
          const external = !N.inScope(cn.normalizedUrl, origin, cfg.scope);
          records.push({
            ...cn,
            source: 'crawl',
            discoveredFrom: norm.url,
            type: external ? 'external' : undefined, // background refines non-external
            _kind: c.kind,
            _external: external,
          });
          if (c.kind === 'a' && !external) nextLinks.push(cn.normalizedUrl);
        }
        emit(records);

        // Enqueue in-scope anchors for the next depth.
        if (depth < cfg.maxDepth) {
          for (const link of nextLinks) {
            if (visited.has(link)) continue;
            if (state.scannedPages + queue.length >= cfg.maxPages) break;
            visited.add(link);
            queue.push({ url: link, depth: depth + 1 });
          }
        }

        state.queued = queue.length;
        onProgress({ ...state });
        await delay(cfg.requestDelayMs);
      }

      return finish();
    }

    function emit(records) {
      if (!records || !records.length) return;
      state.discoveredPaths += records.length;
      onRecords(records);
    }

    function finish() {
      onProgress({ ...state, done: true, stopped });
      return { ...state, stopped };
    }

    return { run, stop, getState: () => ({ ...state }), origin };
  }

  globalThis.Crawler = { createCrawler, buildRobotsMatcher };
})();
