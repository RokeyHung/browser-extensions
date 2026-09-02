// video-pick.js — turns a Facebook video node into downloadable candidates,
// ordered by the quality ladder (spec §2.6, §8). Runs in the page's MAIN world,
// next to json-scan.js, because this is knowledge about Facebook's payloads
// rather than about the extension's UI.
//
// Why this file exists at all: Facebook plays video through MSE, so <video>.src
// is a blob: URL pointing at a buffer inside the page. There is no way to reach
// the file from the DOM (spec §8.1). Every video the extension can save comes
// from one of the shapes below.
//
// The field names are the ones yt-dlp's Facebook extractor has kept working
// across schema changes; treat that list as the maintained one and add to it
// rather than inventing names.

globalThis.__fbmsVideoPick = (() => {
  'use strict';

  // Ordered worst-to-best is a bug magnet, so rank is explicit and higher wins.
  const RANK = { hd: 300, sd: 100, dash: 200 };

  const PROGRESSIVE_KEYS = [
    ['playable_url_quality_hd', 'hd'],
    ['browser_native_hd_url', 'hd'],
    ['hd_src', 'hd'],
    ['playable_url', 'sd'],
    ['browser_native_sd_url', 'sd'],
    ['sd_src', 'sd'],
  ];

  const AUDIO_CODEC = /(mp4a|opus|ac-3|ec-3)/i;
  const VIDEO_CODEC = /(avc1|avc3|hvc1|hev1|vp0?9|vp8|av01)/i;

  function isUsableUrl(value) {
    return typeof value === 'string' && value.startsWith('https://') && !value.endsWith('.mpd');
  }

  function label(quality, height) {
    if (height) return `${height}p`;
    return quality === 'hd' ? 'HD' : 'SD';
  }

  // Facebook stores the manifest either as raw XML or percent-encoded XML,
  // depending on which branch of the payload it came from.
  function decodeManifest(text) {
    if (typeof text !== 'string' || !text) return null;
    const trimmed = text.trim();
    if (trimmed.startsWith('<')) return trimmed;
    if (trimmed.startsWith('%3C') || trimmed.startsWith('%3c')) {
      try {
        return decodeURIComponent(trimmed.replace(/\+/g, ' '));
      } catch (err) {
        return null;
      }
    }
    return null;
  }

  function codecsOf(representation) {
    const own = representation.getAttribute('codecs') || '';
    const parent = representation.parentElement ? representation.parentElement.getAttribute('codecs') || '' : '';
    return `${own} ${parent}`;
  }

  function mimeOf(representation) {
    const own = representation.getAttribute('mimeType') || '';
    const parent = representation.parentElement ? representation.parentElement.getAttribute('mimeType') || '' : '';
    return `${own} ${parent}`;
  }

  // A DASH representation is only useful to us when a single BaseURL holds both
  // streams. Facebook usually splits audio and video into separate
  // representations, and joining those needs an MP4 remuxer — see spec §8.3 for
  // why v1 refuses instead of shipping a silent video.
  function fromDashXml(xml) {
    const candidates = [];
    let splitStreams = false;

    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.querySelector('parsererror')) return { candidates, splitStreams };

    for (const representation of doc.querySelectorAll('Representation')) {
      const base = representation.querySelector('BaseURL');
      const url = base && base.textContent ? base.textContent.trim() : '';
      const codecs = codecsOf(representation);
      const muxed = AUDIO_CODEC.test(codecs) && VIDEO_CODEC.test(codecs);

      if (!isUsableUrl(url) || !muxed) {
        if (mimeOf(representation).includes('video')) splitStreams = true;
        continue;
      }

      const height = parseInt(representation.getAttribute('height') || '', 10) || null;
      candidates.push({
        url,
        quality: 'dash',
        width: parseInt(representation.getAttribute('width') || '', 10) || null,
        height,
        rank: RANK.dash + (height || 0),
        label: label('dash', height),
      });
    }

    return { candidates, splitStreams };
  }

  // The newer `all_video_dash_prefetch_representations` branch carries the same
  // information as JSON instead of XML. Same rule applies: muxed only.
  function fromJsonRepresentations(list) {
    const candidates = [];
    let splitStreams = false;

    for (const group of Array.isArray(list) ? list : []) {
      for (const representation of (group && group.representations) || []) {
        const url = representation && (representation.base_url || representation.baseUrl);
        const codecs = `${(representation && representation.codecs) || ''}`;
        const muxed = AUDIO_CODEC.test(codecs) && VIDEO_CODEC.test(codecs);
        if (!isUsableUrl(url) || !muxed) {
          if (`${(representation && representation.mime_type) || ''}`.includes('video')) splitStreams = true;
          continue;
        }
        const height = representation.height || null;
        candidates.push({
          url,
          quality: 'dash',
          width: representation.width || null,
          height,
          rank: RANK.dash + (height || 0),
          label: label('dash', height),
        });
      }
    }

    return { candidates, splitStreams };
  }

  function posterOf(node) {
    const thumb = node.preferred_thumbnail || node.thumbnailImage || node.image;
    const image = thumb && (thumb.image || thumb);
    const uri = image && (image.uri || image.url);
    return typeof uri === 'string' && uri.startsWith('https://') ? uri : null;
  }

  // { candidates: [{ url, quality, width, height, rank, label }], dashOnly, poster }
  function fromNode(node) {
    const candidates = [];
    let splitStreams = false;

    for (const [key, quality] of PROGRESSIVE_KEYS) {
      const url = node[key];
      if (!isUsableUrl(url)) continue;
      const height = typeof node.height === 'number' ? node.height : null;
      candidates.push({
        url,
        quality,
        width: typeof node.width === 'number' ? node.width : null,
        height: quality === 'hd' ? height : null,
        rank: RANK[quality] + (quality === 'hd' ? height || 0 : 0),
        label: label(quality, quality === 'hd' ? height : null),
      });
    }

    // The current shape: everything moved under videoDeliveryResponseFragment,
    // with the old fields left behind on a branch labelled "legacy".
    const delivery = node.videoDeliveryResponseFragment && node.videoDeliveryResponseFragment.videoDeliveryResponseResult;
    if (delivery) {
      for (const entry of delivery.progressive_urls || []) {
        const url = entry && (entry.progressive_url || entry.url);
        if (!isUsableUrl(url)) continue;
        const quality = `${(entry.metadata && entry.metadata.quality) || ''}`.toUpperCase() === 'HD' ? 'hd' : 'sd';
        candidates.push({ url, quality, width: null, height: null, rank: RANK[quality], label: label(quality, null) });
      }
      for (const entry of delivery.dash_manifests || []) {
        const xml = decodeManifest(entry && entry.manifest_xml);
        if (!xml) continue;
        const parsed = fromDashXml(xml);
        candidates.push(...parsed.candidates);
        splitStreams = splitStreams || parsed.splitStreams;
      }
    }

    for (const key of ['dash_manifest', 'dash_manifest_xml_string']) {
      const xml = decodeManifest(node[key]);
      if (!xml) continue;
      const parsed = fromDashXml(xml);
      candidates.push(...parsed.candidates);
      splitStreams = splitStreams || parsed.splitStreams;
    }

    if (node.all_video_dash_prefetch_representations) {
      const parsed = fromJsonRepresentations(node.all_video_dash_prefetch_representations);
      candidates.push(...parsed.candidates);
      splitStreams = splitStreams || parsed.splitStreams;
    }

    const unique = [];
    const seen = new Set();
    for (const candidate of candidates.sort((a, b) => b.rank - a.rank)) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      unique.push(candidate);
    }

    return { candidates: unique, dashOnly: unique.length === 0 && splitStreams, poster: posterOf(node) };
  }

  return { fromNode, fromDashXml, RANK };
})();
