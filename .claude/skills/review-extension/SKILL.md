---
name: review-extension
description: Review a proposed change to this repository for correctness, security, privacy, and consistency with extension specs. Use when asked to review a diff or implementation.
---

# Review an extension change

1. Inspect status and the complete diff; identify the affected extension and read its spec, manifest, and changelog.
2. Trace changed behavior through every applicable context and message sender/receiver. Check permissions, host access, input validation, storage compatibility, worker lifecycle, and page/extension isolation.
3. Verify behavior changes have matching spec/changelog/version updates where required. Check shared domain-suffix changes against the canonical source and sync script.
4. Report actionable findings first, each with file/line and impact. Separate confirmed defects from questions and mention verification gaps. If there are no findings, say so and summarize residual risk.
