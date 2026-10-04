# Verification

- There is no automated test runner, linter, or typechecker. Do not claim runtime behavior is tested unless the extension was actually loaded or exercised in Chrome.
- For every change, run the narrowest relevant checks; run `make check` before presenting a finished change when the environment supports it. It checks formatting and shared domain-suffix copies only.
- For behavior changes, identify a concrete browser reproduction/verification path. If Chrome verification is unavailable, say so and distinguish static checks from runtime evidence.
- When changing shared domain-suffix logic or its copies, run `make check-domain-suffix`; do not hand-edit generated copies.
- Add no test framework or test dependency unless explicitly requested. Record measured behavior in changelogs only when actually measured.
