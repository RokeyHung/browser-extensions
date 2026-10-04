---
name: test-extension
description: Choose and perform practical verification for one of the unpacked Chrome extensions. Use when asked to test or verify an extension.
---

# Verify an extension

1. Inspect the extension manifest and spec to identify the affected entry points, permissions, messages, and expected behavior.
2. Run `make check` for the repository's available automated checks. Do not describe it as a runtime test: there is no test runner, linter, or typechecker.
3. If Chrome is available, load `<extension>/extension/` as unpacked and exercise the changed behavior on a suitable fixture/site. Check relevant worker and page contexts, including reload/restart where applicable.
4. Report exact checks, outcomes, and gaps. Do not invent measurements or claim a browser test that was not performed.
