// value-inspect.js — value type detection and formatting helpers for the UI.
// Spec §6.5, §6.6. Loaded in extension pages only.

if (typeof ValueInspect === 'undefined') {
  var ValueInspect = (() => {
    const JWT_RE = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*$/;

    function byteLength(text) {
      return new TextEncoder().encode(String(text ?? '')).length;
    }

    function formatSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function parseJson(text) {
      const trimmed = String(text ?? '').trim();
      if (!trimmed || !/^[[{]/.test(trimmed)) return null;
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? parsed : null;
      } catch (_err) {
        return null;
      }
    }

    // 'json' | 'jwt' | 'number' | 'boolean' | 'null' | 'text'
    function detectType(value) {
      const text = String(value ?? '');
      const trimmed = text.trim();
      if (!trimmed) return 'text';
      if (trimmed === 'null') return 'null';
      if (trimmed === 'true' || trimmed === 'false') return 'boolean';
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) return 'number';
      if (JWT_RE.test(trimmed) && decodeJwt(trimmed)) return 'jwt';
      if (parseJson(trimmed)) return 'json';
      return 'text';
    }

    function preview(value, length = 120) {
      const text = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      return text.length > length ? `${text.slice(0, length)}…` : text;
    }

    function prettyJson(value) {
      const parsed = parseJson(value);
      if (!parsed) return null;
      return JSON.stringify(parsed, null, 2);
    }

    function minifyJson(value) {
      const parsed = parseJson(value);
      if (!parsed) return null;
      return JSON.stringify(parsed);
    }

    function base64UrlDecode(segment) {
      const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
      // Handle multi-byte characters in the payload (names, emails…).
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    // Read-only decode of the header and payload. Signature is never verified —
    // this is for inspection, not for trusting the token. Spec §6.6.
    function decodeJwt(value) {
      const parts = String(value ?? '')
        .trim()
        .split('.');
      if (parts.length !== 3) return null;
      try {
        const header = JSON.parse(base64UrlDecode(parts[0]));
        const payload = JSON.parse(base64UrlDecode(parts[1]));
        if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;
        return { header, payload };
      } catch (_err) {
        return null;
      }
    }

    function formatTimestamp(seconds) {
      const date = new Date(Number(seconds) * 1000);
      if (Number.isNaN(date.getTime())) return String(seconds);
      const relative = date.getTime() - Date.now();
      const suffix = relative < 0 ? 'expired' : 'valid';
      return `${date.toLocaleString()} (${suffix})`;
    }

    function formatCookieExpiry(cookie) {
      if (!cookie.expirationDate) return 'Session';
      return new Date(cookie.expirationDate * 1000).toLocaleString();
    }

    // Value for a datetime-local input, in local time.
    function toDatetimeLocal(epochSeconds) {
      if (!epochSeconds) return '';
      const date = new Date(epochSeconds * 1000);
      if (Number.isNaN(date.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function fromDatetimeLocal(text) {
      if (!text) return null;
      const time = new Date(text).getTime();
      return Number.isNaN(time) ? null : Math.floor(time / 1000);
    }

    function escapeHtml(text) {
      return String(text ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }

    return {
      byteLength,
      formatSize,
      detectType,
      preview,
      parseJson,
      prettyJson,
      minifyJson,
      decodeJwt,
      formatTimestamp,
      formatCookieExpiry,
      toDatetimeLocal,
      fromDatetimeLocal,
      escapeHtml,
    };
  })();

  if (typeof globalThis !== 'undefined') globalThis.ValueInspect = ValueInspect;
}
