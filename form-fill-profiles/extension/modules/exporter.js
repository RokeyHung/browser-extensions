// exporter.js — download/read the JSON export file. Runs in extension pages. Spec §14.

if (typeof Exporter === 'undefined') {
  var Exporter = (() => {
    const FILE_NAME = 'form-fill-profiles.json';

    function download(payload, fileName = FILE_NAME) {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }

    // Any profile holding a password field value is worth warning about before
    // it lands in a plain-text file. Spec §14.1.
    function containsPasswordValue(payload) {
      const passwordFieldIds = new Map();
      for (const form of payload.forms || []) {
        const ids = (form.fields || []).filter((field) => field.type === 'password').map((field) => field.fieldId);
        if (ids.length) passwordFieldIds.set(form.id, new Set(ids));
      }
      return (payload.profiles || []).some((profile) => {
        const ids = passwordFieldIds.get(profile.formId);
        if (!ids) return false;
        return Object.keys(profile.values || {}).some((fieldId) => ids.has(fieldId));
      });
    }

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            resolve(JSON.parse(String(reader.result)));
          } catch (err) {
            reject(new Error(`File is not valid JSON: ${err.message}`));
          }
        };
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsText(file);
      });
    }

    return { FILE_NAME, download, readFile, containsPasswordValue };
  })();
}
