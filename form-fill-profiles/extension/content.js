// content.js — bridge between the background worker and the page's forms. Spec §12.3.
// The scanner only runs when asked; nothing is read while the user types.

if (!window.__formFillProfilesReady) {
  window.__formFillProfilesReady = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'ping':
        sendResponse({ alive: true });
        return false;

      case 'countForms':
        try {
          sendResponse({ success: true, ...FormScanner.count() });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return false;

      case 'scanForms':
        try {
          sendResponse({ success: true, snapshot: FormScanner.scan(message.settings) });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
        return false;

      case 'applyProfile':
        ApplyEngine.apply(message.form, message.values, message.settings)
          .then((report) => sendResponse({ success: true, report }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async: apply may wait for late-rendering fields

      default:
        return false;
    }
  });
}
