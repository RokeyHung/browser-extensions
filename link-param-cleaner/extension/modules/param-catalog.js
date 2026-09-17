// param-catalog.js — labels for param names we recognise. Spec §7.5.
//
// The catalog only ever *labels*. It never ticks a param and never feeds a rule:
// the extension removes what the user ticked and nothing else. `ref` is tracking
// on one site and a required argument on the next, and this table has no way to
// tell which — so its output is an ordering hint and a warning, not a verdict.
// Loaded in the service worker and in extension pages.

if (typeof ParamCatalog === 'undefined') {
  var ParamCatalog = (() => {
    // Names whose only job is to identify the click or the campaign. Removing
    // them changes nothing the user can see on the destination page.
    const TRACKING = new Set([
      'fbclid',
      'gclid',
      'gclsrc',
      'dclid',
      'gbraid',
      'wbraid',
      'msclkid',
      'twclid',
      'ttclid',
      'yclid',
      'igshid',
      'igsh',
      'mibextid',
      'epik',
      'li_fat_id',
      'rb_clickid',
      's_kwcid',
      'mc_cid',
      'mc_eid',
      '_ga',
      '_gl',
      '_openstat',
      'ref_src',
      'ref_url',
      'cmpid',
      'campaign_id',
      'xtor',
      'spm',
      'scm',
      'share_source',
      'share_medium',
      'from_source',
      'source_type',
      // YouTube attaches `si` to every share link; it identifies the share, not
      // the video.
      'si',
    ]);

    const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'matomo_', 'piwik_', 'hsa_', 'vero_', 'oly_', 'mkt_'];

    // Names that routinely carry the meaning of the destination URL. Ticking one
    // is allowed — sometimes it really is tracking — but it gets a warning first,
    // because a wrong tick here breaks the link instead of cleaning it.
    const FUNCTIONAL = new Set([
      'id',
      'q',
      'query',
      's',
      'search',
      'k',
      'p',
      'page',
      'v',
      't',
      'tab',
      'type',
      'category',
      'cat',
      'sort',
      'order',
      'filter',
      'view',
      'mode',
      'lang',
      'hl',
      'locale',
      'currency',
      'token',
      'access_token',
      'code',
      'state',
      'key',
      'sig',
      'signature',
      'hash',
      'session',
      'sid',
      'redirect',
      'redirect_uri',
      'return_to',
      'returnurl',
      'next',
      'url',
      'u',
      'start',
      'offset',
      'limit',
      'size',
      'date',
      'from',
      'to',
    ]);

    function labelFor(name) {
      const key = String(name || '').toLowerCase();
      if (!key) return null;
      if (TRACKING.has(key)) return 'tracking';
      if (TRACKING_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'tracking';
      if (FUNCTIONAL.has(key)) return 'functional';
      return null;
    }

    return { labelFor, TRACKING, TRACKING_PREFIXES, FUNCTIONAL };
  })();

  if (typeof globalThis !== 'undefined') globalThis.ParamCatalog = ParamCatalog;
}
