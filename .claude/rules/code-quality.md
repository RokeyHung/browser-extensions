# Code quality

- Follow nearby code style: plain JavaScript, classic scripts, IIFEs/globals, single quotes, and the repo Prettier configuration (`printWidth: 150`).
- Keep the diff focused. Reuse existing helpers and patterns; do not refactor unrelated code or add abstractions for one-off use.
- Preserve compatibility with the extension's declared browser APIs and current data formats. Handle rejected Chrome API calls and missing tabs/frames where the surrounding flow expects them.
- Comments explain constraints, browser quirks, or rationale. Keep spec section references in file headers consistent with the affected spec.
- Do not hand-edit generated icons or copied shared blocks; use their existing generators/synchronization scripts.
