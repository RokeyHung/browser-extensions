# Browser extension behavior

- All current extensions are Manifest V3. Preserve MV3 and the current worker model; do not introduce a build step, framework, package dependency, or ES module without an explicit request.
- Treat service workers as restartable: persist required state and do not rely on timers or globals surviving suspension.
- Respect context boundaries: page DOM APIs belong in content/page code, not the service worker. Do not assume content scripts share the page's JavaScript world.
- Preserve manifest script order and all existing initialization/teardown behavior. Validate sender, message type, and payload at message boundaries.
- Prefer the narrowest permissions and host access that satisfy the feature. Never add or broaden a permission silently; explain the need and its user impact in the change.
- Keep data in the existing browser storage layer and preserve current export/import formats unless the spec is intentionally revised.
