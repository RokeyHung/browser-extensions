# Git workflow

- Inspect `git status` and the diff before editing; preserve unrelated and pre-existing changes. Never discard, stage, or rewrite user changes.
- Use scoped Conventional Commit subjects, for example `fix(full-page-capture): ...`; use English for commit subjects and bodies.
- Do not commit, push, amend, or force-push unless explicitly requested. The existing `/commit` command commits only already staged files; keep that boundary.
- Do not stage files automatically. Report the checks run and any remaining verification gap.
