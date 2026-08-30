// domain-suffix.js — canonical registrable-domain (eTLD+1) derivation.
//
// This is the SOURCE OF TRUTH. Browser extensions can only load files from
// inside their own folder, so this block is copied into each extension by
// `make sync-domain-suffix`. Edit here, never in the copies.
//
// Everything between the two markers below is what gets copied; the script
// re-indents it to match each destination. Run `make check-domain-suffix` to
// fail the build when a copy has drifted.
//
// Consumers: clean-site-data, form-fill-profiles, popup-redirect-guard,
// site-path-discovery, storage-explorer.

// >>> shared:domain-suffix — generated, do not edit (make sync-domain-suffix) >>>
// Derive the registrable domain (eTLD+1) from a hostname. Getting this wrong is
// not cosmetic: a base domain of `co.id` makes every unrelated .co.id site look
// like the same site, which silently widens cookie queries, autofill scope and
// same-site checks to strangers.

// Second-level labels a country registry uses to group registrations rather
// than to name a site: the `com` in `com.vn`, the `co` in `co.uk`. Paired with
// the two-letter country TLD test below this covers every country following the
// convention, including the ones nobody here thought to write down.
// `web` is deliberately absent: `web.de` is a real site, not a suffix.
const REGISTRY_LABELS = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'ac', 'or', 'ne', 'go', 'mil', 'gob', 'nom']);

// Public suffixes spanning 2+ labels that the rule cannot derive, so they have
// to be named. Mostly hosting providers that isolate each subdomain as its own
// site — without these, treating `alice.github.io` as a site would sweep in
// every neighbouring project.
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
// a registry label under a two-letter country TLD.
function isCountrySecondLevel(suffix) {
  const parts = suffix.split('.');
  if (parts.length !== 2) return false;
  const [label, tld] = parts;
  return /^[a-z]{2}$/i.test(tld) && REGISTRY_LABELS.has(label.toLowerCase());
}

// True when `suffix` is something anyone can register under, so it can never be
// a site on its own.
function isPublicSuffix(suffix) {
  return NAMED_SUFFIXES.has(suffix.toLowerCase()) || isCountrySecondLevel(suffix);
}

// True for hosts with no meaningful site label: IP addresses and single-label
// hosts such as `localhost` or an intranet name.
function isLiteralHost(hostname) {
  if (!hostname) return true;
  return hostname.includes(':') || /^[\d.]+$/.test(hostname);
}

// e.g. www.facebook.com -> facebook.com, foo.example.co.uk -> example.co.uk
function getBaseDomain(hostname) {
  if (!hostname) return hostname;
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
// <<< shared:domain-suffix <<<
