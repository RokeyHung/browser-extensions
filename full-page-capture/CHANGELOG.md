# Changelog

## 1.0.0

First implementation, following `docs/spec.md`.

- **Capture the whole page you are looking at**, full length, by scrolling and stitching on `OffscreenCanvas` at the display's real device pixels — no resampling, no downscaling (§5, §7). Tiles are drawn from the scroll position the browser actually reports, so long pages come out without seams.
- **No host permissions.** The extension asks for access to nothing at install time: `activeTab`, granted by your click or `Alt+Shift+S`, is all a capture of the current tab needs (§18).
- **Nothing is opened, navigated or crawled.** The page is already on screen, so the first screenful is shot ~0.8s after the click.
- **Fixed and sticky elements** are hidden from the second screenful on, sticky ones unstuck rather than hidden; animations, transitions and videos are frozen; lazy images are forced to load first. All of it is undone in a `finally`, including after a failure or a stop.
- **Images too large for Chrome's canvas limits are split into parts**, never scaled down (§8).
- **Result page** with crop and redact (blur or solid, destroying the pixels for real), undo, fit/100% zoom, PNG/JPEG export and copy to clipboard (§11).
- **Save to disk mode** writes the file through an offscreen document and deletes it from the workspace as soon as it lands (§16).
- **Three settings, one button, one choice in the popup** — where the result goes (§12, §13). Everything else is an internal constant.
- **No history, no network requests at all, no `debugger` permission** (§19).

Verified end to end in Chrome for Testing over CDP: a real `Alt+Shift+S` invocation captures a 3858px page as 10 screenfuls in 5.9s with no host permissions; the stitched PNG is full length with the fixed header appearing exactly once.

### Dropped before release

An earlier draft captured the **whole site**: robots.txt + sitemap + link crawling, a queue, a second tab, a thumbnail gallery. Trying it showed why that was wrong — standing on `/docs/a` it went off to `/blog` and `/pricing`, it opened a tab and wandered for minutes, it stalled on `robots.txt` before the first shot, and it forced the `<all_urls>` permission because `captureVisibleTab` accepts nothing weaker. Removing the crawl layer fixed all four at once. Also dropped along the way: the `chrome.debugger` 2×/3× engine, per-capture mode selection, the region/element pickers, the manual scroll-area picker, arrow/box/text annotation, PDF export, and every page-count control.
