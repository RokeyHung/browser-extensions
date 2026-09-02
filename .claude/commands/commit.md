---
description: Commit staged changes with an English message
allowed-tools: ['Bash']
---

Commit **only what is already staged**. Do not push.

Optional hint from the user about what the change is: $ARGUMENTS

## Rules

- **Never stage anything.** Do not run `git add`, `git commit -a`, or `git stash`.
  Unstaged and untracked files must stay untouched — if the user staged a subset
  on purpose, committing more would silently defeat that.
- **Never rewrite history.** No `git commit --amend`, no rebase.
- **Never push.** Pushing is a separate, deliberate step the user takes.
- Write the commit message **entirely in English** — subject and body.

## Steps

1. Inspect what is staged:
   - `git status --short`
   - `git diff --cached --stat`
   - `git diff --cached` (read the actual diff, not just filenames)
   - `git log -5 --format='%s'` to match the repo's subject style
2. **Stop and report** if `git diff --cached --quiet` succeeds — nothing is
   staged, so there is nothing to commit. Do not stage anything to fix this.
3. **Stop and ask** if the current branch is not `main`. Report the branch name
   and let the user decide; do not switch branches.
4. Write the commit message:
   - Subject: `<type>: <what changed>` in imperative mood, ≤ 72 chars.
     Types used in this repo: `feat`, `fix`, `chore`, `docs`, `refactor`.
   - Body: bullets explaining **why** and any non-obvious decision or trade-off,
     wrapped at 72 chars. Skip the body only for genuinely trivial changes.
   - Describe only what the staged diff actually contains.
5. Commit with `git commit -F -` and a heredoc, appending these trailers:

   ```
   AI-Assisted: true
   AI-Model: Claude Code
   AI-Tasks: <comma-separated, e.g. implementation, refactor, docs, icon-generation>
   AI-Contribution: <0-100>%
   Prompts-Used: <one-line summary of the prompts that led to this change>
   Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
   ```

   `AI-Contribution` scale: 0-20% human-led (AI just typed what was dictated),
   21-40% human designed / AI implemented, 41-60% even collaboration,
   61-80% AI-led with human integration, 81-100% AI wrote essentially all of it.

6. Report the short SHA and the subject line. Say plainly that nothing was
   pushed, and leave it to the user to push when they are ready.
