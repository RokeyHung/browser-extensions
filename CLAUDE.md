# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A monorepo of seven independent Chrome MV3 extensions. There is **no build step, no `package.json`, no `node_modules`** — on purpose. What lives in `<extension>/extension/` is exactly what the browser loads. Never introduce a bundler, a framework, or a dependency install as part of a feature; if something needs tooling, it goes in `Makefile` + `scripts/` and runs through `npx`.

Extensions: [block-elements-webpage/](block-elements-webpage/) (Element Filter), [clean-site-data/](clean-site-data/), [form-fill-profiles/](form-fill-profiles/), [full-page-capture/](full-page-capture/), [popup-redirect-guard/](popup-redirect-guard/), [site-path-discovery/](site-path-discovery/), [storage-explorer/](storage-explorer/).

## Commands

```bash
make help                 # list targets
make format               # prettier --write . (pinned 3.4.2 via npx)
make format-check         # fail on drift, change nothing
make sync-domain-suffix   # push shared/domain-suffix.js into its copies
make check-domain-suffix  # fail if a copy drifted
make check                # format-check + check-domain-suffix — run before committing
```

Icons are generated, not committed by hand: `cd <extension>/extension && node generate-icons.js` redraws `icons/*.png` from a hand-written PNG encoder using only Node built-ins.

There is no test runner and no lint beyond Prettier (`printWidth: 150`, single quotes). Behaviour is verified by loading the unpacked extension (`chrome://extensions` → Load unpacked → `<extension>/extension/`) or by driving Chrome for Testing against a fixture page. The changelogs quote real measurements from those runs; when fixing a bug, reproduce it and record the number.

## Per-extension layout

```
<extension>/
  docs/spec.md      numbered-section spec — the source of truth
  CHANGELOG.md      Keep a Changelog + SemVer, mirrors manifest version
  extension/        everything the browser loads
    manifest.json   MV3; content scripts listed in dependency order
    background.js   service worker; importScripts(...) its modules
    modules/*.js    one concern each
    popup.{html,js} / options.{html,js} / dashboard.{html,js} / result.{html,js}
    styles/*.css    popup.css is the base; dashboard/options/result load after it
    generate-icons.js
```

`element-filter-rules.json` and `popup-guard-sites.json` at an extension's root are **exported user data** produced by that extension's options page, kept as backups. Nothing loads them at runtime.

## Code conventions

**Classic scripts, globals, no modules.** A module in `modules/` is an IIFE assigned to one global (`const RuleMatcher = (() => {...})()` or `globalThis.Settings`). The same file gets loaded by `importScripts()` in the service worker and by a `<script>` tag in extension pages, so files loaded in both contexts guard themselves:

```js
if (typeof SnapshotStore === 'undefined') {
  var SnapshotStore = (() => { ... })();
}
```

**The service worker is the router.** Popups, options and dashboards hold no logic of their own: they `chrome.runtime.sendMessage` a typed message, the worker fans it out to `chrome.scripting.executeScript`, `chrome.cookies`, `chrome.storage`, and returns a plain object. Each spec has a "Message protocol" section listing every message type — add new types there first.

**Comments cite the spec.** File headers say what the file is and reference sections (`// stitcher.js — assembles tiles ... (spec §7.8, §8)`). Comments explain _why_ — the constraint, the browser quirk, the rejected alternative — not what the next line does. Match that density; it is deliberately high and is the main design record next to the spec.

**Code, code comments and commit messages are in English. Specs and changelogs are in Vietnamese.**

## shared/domain-suffix.js

Registrable-domain (eTLD+1) derivation is security-relevant: getting it wrong widens cookie clearing, autofill scope and same-site checks to unrelated sites. Extensions cannot load files outside their own folder, so the block is **copied** into six destinations listed in [scripts/sync-domain-suffix.mjs](scripts/sync-domain-suffix.mjs).

Edit [shared/domain-suffix.js](shared/domain-suffix.js) only — between the `>>> shared:domain-suffix` / `<<< shared:domain-suffix` markers — then `make sync-domain-suffix`. Never edit a copy; `make check` fails on drift.

## Changing behaviour

A behaviour change is three edits, not one: the code, the matching `docs/spec.md` section, and a `CHANGELOG.md` entry with a bumped `manifest.json` version. Changelog entries are written as findings — what broke, how it was measured, why the fix is the right shape — matching the existing entries.

## Commits

Conventional subjects, scoped by extension folder: `fix(full-page-capture): ...`, `feat(storage-explorer): ...`, `docs: ...`. Types in use: `feat`, `fix`, `chore`, `docs`, `refactor`. Subject and body are in **English**, with the body explaining cause → evidence → fix.

History before `e0c1250` (2026-09-01) is in Vietnamese. Those commits are not being rewritten — match the English convention going forward and read the older ones as-is.

`/commit` ([.claude/commands/commit.md](.claude/commands/commit.md)) commits **only what is already staged** (never `git add`, never `--amend`, never force). It does not push — pushing stays a deliberate step you take yourself.

A global pre-commit hook blocks commits unless `git config user.allowedemails` / `user.allowednames` whitelist the current identity, and runs gitleaks via the `pre-commit` tool. A failing commit is usually one of those two, not the diff.
