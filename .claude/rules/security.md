# Security and privacy

- Treat page content, URLs, imported files, stored values, and messages from other contexts as untrusted input. Validate types, ranges, URLs, and ownership before acting.
- Insert untrusted text with safe DOM APIs such as `textContent`; do not build executable HTML or use `eval`, `new Function`, or remote code.
- Keep secrets, cookies, tokens, and personal form/storage data out of source, logs, changelogs, and telemetry. These extensions are local-only; do not add network transmission.
- Scope cookie, browsing-data, storage, tab, and injected-script operations to the intended site/tab. Use the shared registrable-domain helper where applicable; do not reimplement its security-sensitive logic.
- For changes touching permissions, host access, cookies, auth, tab URLs, downloads, clipboard, injection, or imported data, inspect and describe the security/privacy impact and update the relevant spec.
