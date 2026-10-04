# Architecture

- Before changing behavior, read the affected extension's `docs/spec.md`, `CHANGELOG.md`, and `extension/manifest.json`; treat the spec as the behavior source of truth.
- Keep each extension independent. Its `extension/` directory is the loadable product; do not add shared runtime imports across extension directories.
- Preserve the existing classic-script/IIFE/global pattern and manifest/script load order. Check every execution context that loads a changed module.
- The service worker owns cross-context coordination; UI pages send typed runtime messages. Update the spec's Message protocol when adding or changing message types.
- Change only the relevant extension and required documentation. For behavior changes, update its spec, changelog, and manifest version as required by the root guidance.
- Edit shared domain-suffix logic only in `shared/domain-suffix.js`, then use the Make target to sync its copies.
