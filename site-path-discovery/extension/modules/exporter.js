// exporter.js — builds JSON and CSV export payloads (spec §15).
// Used by the dashboard. Pure functions, attaches to globalThis.

(function () {
  'use strict';

  function summarize(paths) {
    const summary = { total: paths.length, pages: 0, apis: 0, assets: 0, external: 0, robots: 0, sitemap: 0 };
    for (const p of paths) {
      switch (p.type) {
        case 'page':
          summary.pages++;
          break;
        case 'api':
          summary.apis++;
          break;
        case 'asset':
          summary.assets++;
          break;
        case 'external':
          summary.external++;
          break;
        case 'robots-path':
          summary.robots++;
          break;
        case 'sitemap':
          summary.sitemap++;
          break;
      }
    }
    return summary;
  }

  function toJSON(site, paths) {
    return JSON.stringify(
      {
        site: site ? site.origin : '',
        exportedAt: new Date().toISOString(),
        summary: summarize(paths),
        paths,
      },
      null,
      2
    );
  }

  const CSV_COLUMNS = ['type', 'method', 'url', 'path', 'source', 'statusCode', 'firstSeenAt', 'lastSeenAt', 'seenCount', 'discoveredFrom'];

  function csvCell(value) {
    if (value == null) return '';
    let s = Array.isArray(value) ? value.join(' | ') : String(value);
    if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(paths) {
    const rows = [CSV_COLUMNS.join(',')];
    for (const p of paths) {
      rows.push(CSV_COLUMNS.map((col) => csvCell(p[col])).join(','));
    }
    return rows.join('\n');
  }

  globalThis.Exporter = { summarize, toJSON, toCSV, CSV_COLUMNS };
})();
