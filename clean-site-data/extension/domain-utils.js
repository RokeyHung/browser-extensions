// Domain helpers shared by the popup and the service worker.
// Loaded as a classic script (a <script> tag in popup.html, importScripts() in
// background.js), so everything here lives on the global scope.

// Second-level labels a country registry uses to group registrations rather
// than to name a site: the `com` in `com.vn`, the `co` in `co.uk`. Combined
// with the rule below this covers every country that follows the convention,
// including the ones nobody here thought to write down.
// `web` is deliberately absent: `web.de` is a real site, not a suffix.
const REGISTRY_LABELS = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gob', 'nom']);

// Public suffixes spanning 2+ labels that the rule below cannot derive, so they
// have to be named. Two kinds: hosting providers that isolate each subdomain as
// its own site (without these, cleaning one project would sweep every
// neighbour), and the odd country second-level built on a non-registry label.
const NAMED_SUFFIXES = new Set([
  'me.uk',
  'github.io',
  'gitlab.io',
  'pages.dev',
  'vercel.app',
  'netlify.app',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'workers.dev',
]);

// True for a country second-level suffix such as `com.vn`, `co.id` or `ac.jp`:
// a registry label under a two-letter country TLD. Derived instead of listed so
// an unlisted country still parses correctly — getting this wrong widens the
// cookie scope to every site sharing the suffix.
function isCountrySecondLevel(suffix) {
  const parts = suffix.split('.');
  if (parts.length !== 2) return false;
  const [label, tld] = parts;
  return /^[a-z]{2}$/i.test(tld) && REGISTRY_LABELS.has(label.toLowerCase());
}

// True when `suffix` is a public suffix, i.e. something anyone can register
// under, so it can never be a site on its own.
function isPublicSuffix(suffix) {
  return NAMED_SUFFIXES.has(suffix.toLowerCase()) || isCountrySecondLevel(suffix);
}

// True for hosts that have no meaningful site label: IP addresses and
// single-label hosts such as `localhost` or an intranet name.
function isLiteralHost(hostname) {
  if (!hostname) return true;
  return hostname.includes(':') || /^[\d.]+$/.test(hostname);
}

// Derive the registrable domain (eTLD+1) from a hostname.
// e.g. www.facebook.com -> facebook.com, foo.example.co.uk -> example.co.uk
function getBaseDomain(hostname) {
  if (!hostname) return hostname;
  // IPv4 / IPv6 / single-label hosts: use as-is
  if (isLiteralHost(hostname)) return hostname;

  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (parts.length >= 4 && isPublicSuffix(last3)) return parts.slice(-4).join('.');
  if (isPublicSuffix(last2)) return last3;
  return last2;
}

// The site's own label inside its registrable domain — the part that stays the
// same across subdomains and country TLDs.
// e.g. www.facebook.com -> facebook, foo.example.co.uk -> example
// Returns null when the host has no such label (IPs, localhost).
function getSiteLabel(hostname) {
  if (isLiteralHost(hostname)) return null;
  const base = getBaseDomain(hostname);
  const label = base ? base.split('.')[0] : '';
  if (!label) return null;
  // A bare single-label host is its own base domain; treat it as literal so we
  // never widen the scope to "everything named localhost".
  if (base === hostname && !hostname.includes('.')) return null;
  return label;
}

// How the wildcard scope reads in the UI, e.g. `*.facebook.*`.
function getWildcardPattern(hostname) {
  const label = getSiteLabel(hostname);
  return label ? `*.${label}.*` : null;
}

// True when `hostname` belongs to the given site label, on any subdomain and
// any TLD. e.g. label `facebook` matches m.facebook.com and facebook.com.vn,
// but not facebookcdn.com.
function matchesSiteLabel(hostname, siteLabel) {
  if (!siteLabel) return false;
  return getSiteLabel(hostname) === siteLabel;
}

// Cookie domains carry a leading dot when they are shared with subdomains.
function cookieHost(cookie) {
  return (cookie?.domain || '').replace(/^\./, '');
}
