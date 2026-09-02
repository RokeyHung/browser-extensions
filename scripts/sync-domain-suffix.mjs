#!/usr/bin/env node
// Copy the canonical domain-suffix block from shared/domain-suffix.js into each
// extension that needs it. Extensions can only load files from inside their own
// folder, so the code has to be duplicated — this keeps the duplicates honest.
//
//   node scripts/sync-domain-suffix.mjs          rewrite the copies
//   node scripts/sync-domain-suffix.mjs --check  fail if any copy has drifted
//
// A destination opts in by having both marker lines; the block between them is
// replaced wholesale and re-indented to match the marker's own indentation, so
// it drops cleanly inside an IIFE or at the top level of a classic script.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'shared/domain-suffix.js';

const START = 'shared:domain-suffix — generated';
const END = '<<< shared:domain-suffix <<<';

const TARGETS = [
  'clean-site-data/extension/domain-utils.js',
  'form-fill-profiles/extension/modules/form-matcher.js',
  'popup-redirect-guard/extension/injected-guard.js',
  'popup-redirect-guard/extension/modules/domain-matcher.js',
  'storage-explorer/extension/modules/cookie-manager.js',
];

// The marker lines are part of the block, so a copy carries its own proof of
// where it came from.
function extractBlock(lines, file) {
  const start = lines.findIndex((line) => line.includes(START));
  const end = lines.findIndex((line) => line.includes(END));
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${file}: missing or malformed shared:domain-suffix markers`);
  }
  return { start, end, body: lines.slice(start, end + 1) };
}

const sourceLines = readFileSync(resolve(ROOT, SOURCE), 'utf8').split('\n');
const canonical = extractBlock(sourceLines, SOURCE).body;

const check = process.argv.includes('--check');
const drifted = [];
let written = 0;

for (const file of TARGETS) {
  const path = resolve(ROOT, file);
  const lines = readFileSync(path, 'utf8').split('\n');
  const { start, end } = extractBlock(lines, file);

  const indent = lines[start].match(/^\s*/)[0];
  const block = canonical.map((line) => (line.trim() ? indent + line : ''));

  const current = lines.slice(start, end + 1);
  if (current.join('\n') === block.join('\n')) continue;

  if (check) {
    drifted.push(file);
    continue;
  }
  writeFileSync(path, [...lines.slice(0, start), ...block, ...lines.slice(end + 1)].join('\n'));
  console.log(`synced ${file}`);
  written++;
}

if (check) {
  if (drifted.length) {
    console.error(`domain-suffix copies out of sync:\n${drifted.map((f) => `  ${f}`).join('\n')}\nRun: make sync-domain-suffix`);
    process.exit(1);
  }
  console.log(`domain-suffix: ${TARGETS.length} copies in sync`);
} else {
  console.log(written ? `domain-suffix: ${written} file(s) updated` : 'domain-suffix: already in sync');
}
