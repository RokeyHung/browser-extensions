---
name: debug-extension
description: Diagnose and fix a browser-extension bug by tracing its reproduction across MV3 contexts. Use for errors, regressions, and unexpected extension behavior.
---

# Debug an extension

1. Read `git status` and preserve existing edits. Identify the extension and obtain the failing URL, steps, expected result, and observed result when available.
2. Read the extension spec and trace the path through manifest, worker, content scripts, UI, storage, and message protocol. Check worker restart, tab/frame, permission, and page-world boundaries.
3. Reproduce using the available browser setup before changing code when possible. Separate observed facts from hypotheses.
4. Fix the root cause with a focused diff. Update spec, changelog, and version for behavior changes as repository guidance requires.
5. Run `make check`; report browser reproduction evidence or clearly state why runtime verification was unavailable.
