---
name: implement-issue
description: Implement a bug fix or feature in one of this repository's browser extensions. Use when asked to change extension behavior or address an issue.
---

# Implement an issue

1. Inspect `git status`; preserve unrelated changes. Identify the target extension from the request.
2. Read its `docs/spec.md`, `CHANGELOG.md`, manifest, and the specific code paths. Check root `CLAUDE.md` for shared conventions.
3. Trace the full flow across UI, runtime messages, service worker, content/page contexts, storage, and manifest permissions as relevant.
4. Make the smallest coherent implementation. Do not add packages/build tools. Update spec, changelog, and version for behavior changes in line with repository guidance.
5. Run `make check` when available. Give a concrete browser verification path; distinguish what was actually verified from what remains unverified.
6. Summarize changed files, behavior, checks, and any permission/security implications. Do not commit unless asked.
