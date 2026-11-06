export function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .split('+')
    .join('-')
    .split('/')
    .join('_')
    .replace(/=+$/, '');
}

export function fromBase64Url(b64Url: string): string {
  let b64 = b64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return atob(b64);
  }
}

export function getPlayableStreamUrl(streamUrl: string): string {
  if (!streamUrl) return '';
  let normalized = streamUrl
    .trim()
    .replace('s2129134.cdn.mytvn.net', 's2129134.cdn.mytvnet.vn')
    .replace('vips-livecdn.fptplay.net', 'live.fptplay53.net');

  // Strip any localhost / 127.0.0.1 / current-host prefix so proxy & player routes are relative
  normalized = normalized.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i, '/');

  if (typeof window !== 'undefined' && window.location?.host) {
    const host = window.location.host;
    if (normalized.startsWith(`http://${host}/`)) {
      normalized = normalized.slice(`http://${host}`.length);
    } else if (normalized.startsWith(`https://${host}/`)) {
      normalized = normalized.slice(`https://${host}`.length);
    }
  }

  // Also sanitize any encoded localhost prefix inside query params (e.g. /api/player?url=http%3A%2F%2Flocalhost%3A3000%2F...)
  if (normalized.startsWith('/api/player')) {
    normalized = normalized.replace(
      /https?%3A%2F%2F(localhost|127\.0\.0\.1)(%3A\d+)?%2F/gi,
      '%2F'
    );
  }

  return normalized;
}

export function getDirectFromDashProxyUrl(streamUrl: string): string {
  if (!streamUrl) return '';
  const match = streamUrl.match(/\/proxy\/dash\/([^/]+)\/(.+)$/);
  if (match) {
    const baseDir = fromBase64Url(match[1]);
    if (baseDir.startsWith('http://') || baseDir.startsWith('https://')) {
      return `${baseDir}${match[2]}`.replace(
        's2129134.cdn.mytvn.net',
        's2129134.cdn.mytvnet.vn'
      );
    }
  }
  return '';
}

export function getDashProxyFallbackUrl(streamUrl: string): string {
  if (!streamUrl) return '';
  if (streamUrl.includes('/proxy/dash/')) return streamUrl;
  const direct = streamUrl
    .trim()
    .replace('s2129134.cdn.mytvn.net', 's2129134.cdn.mytvnet.vn');
  if (
    (direct.startsWith('http://') || direct.startsWith('https://')) &&
    (direct.includes('.mpd') || direct.includes('manifest'))
  ) {
    const baseTarget = direct.substring(0, direct.lastIndexOf('/') + 1);
    const filePart = direct.substring(direct.lastIndexOf('/') + 1) || 'manifest.mpd';
    const b64 = toBase64Url(baseTarget);
    return `/proxy/dash/${b64}/${filePart}`;
  }
  return '';
}

export function parseMultipleUrls(rawStr: string): string[] {
  if (!rawStr) return [];
  return rawStr
    .split(/[\s,;]+/)
    .map((u) => u.trim())
    .filter((u) => u.startsWith('http://') || u.startsWith('https://'));
}

export const FALLBACK_CLEAR_KEYS: Record<string, { kid: string; key: string }> = {
  hbo: { kid: '09ddfe3d63863cafaeb79d0546b098ab', key: '3de0f38dcf014827dfd5bec38743c6a2' },
  wtv: { kid: '086d09a40bff3a00aa6dd4dbaf9c13b2', key: '34f1908cfe2e05ee060046d40f14aec9' },
  warner: { kid: '086d09a40bff3a00aa6dd4dbaf9c13b2', key: '34f1908cfe2e05ee060046d40f14aec9' },
  wbtv: { kid: '086d09a40bff3a00aa6dd4dbaf9c13b2', key: '34f1908cfe2e05ee060046d40f14aec9' },
  max: { kid: 'acb4c23471063327adc732e283c0847f', key: 'e9868f5f473d0fd8699ede48d531c2b0' },
  cinemax: { kid: 'acb4c23471063327adc732e283c0847f', key: 'e9868f5f473d0fd8699ede48d531c2b0' },
  cn: { kid: '3c20166660a93a75ac77db81567389f7', key: '3cc1add43aecce3fe31c9c6a2a5b8c21' },
  cartoon: { kid: '3c20166660a93a75ac77db81567389f7', key: '3cc1add43aecce3fe31c9c6a2a5b8c21' },
  dreamwork: { kid: '67dae20527c63dadaaae609aa91577cb', key: '59328f621d56767bc5ff9404a8940683' },
  dreamworks: { kid: '67dae20527c63dadaaae609aa91577cb', key: '59328f621d56767bc5ff9404a8940683' },
  cbb: { kid: 'cca73a006b4b39a595207ceb5ed9ca0a', key: 'b833d1f40c261ef78896f97e06f80cdc' },
  cbeebies: { kid: 'cca73a006b4b39a595207ceb5ed9ca0a', key: 'b833d1f40c261ef78896f97e06f80cdc' },
  axn: { kid: '9d29f87efdec3c9fab368f724a62ad0e', key: '6f1c09c035eab36323d60d1454db3d20' },
  cinemaworld: { kid: 'ee7915564d7439d09bd3556ffccc87a4', key: 'b35e12a75a42a6f9184723a90ff42d9c' },
  'cinema world': { kid: 'ee7915564d7439d09bd3556ffccc87a4', key: 'b35e12a75a42a6f9184723a90ff42d9c' },
  discoveryasia: { kid: '934907b134be3963a6263a453846924c', key: '788e2835fb98568aed2f47bbdc091515' },
  'discovery asia': { kid: '934907b134be3963a6263a453846924c', key: '788e2835fb98568aed2f47bbdc091515' },
  dscasia: { kid: '934907b134be3963a6263a453846924c', key: '788e2835fb98568aed2f47bbdc091515' },
  'dsc.smil': { kid: 'eb4160ea553a321d899553e4e796fec2', key: 'bea5a07157e0c4d17b11ab399517f952' },
  'discovery channel': { kid: 'eb4160ea553a321d899553e4e796fec2', key: 'bea5a07157e0c4d17b11ab399517f952' },
  discoveryhd: { kid: 'eb4160ea553a321d899553e4e796fec2', key: 'bea5a07157e0c4d17b11ab399517f952' },
  'animal planet': { kid: 'ec6f072c7125377a9bc0ae61598095f4', key: '1d5388e0781415ebcec9914f5ad75875' },
  animalplanet: { kid: 'ec6f072c7125377a9bc0ae61598095f4', key: '1d5388e0781415ebcec9914f5ad75875' },
  'ap.smil': { kid: 'ec6f072c7125377a9bc0ae61598095f4', key: '1d5388e0781415ebcec9914f5ad75875' },
  bbcearth: { kid: '5014941a2c42379880b5edf72304c165', key: 'f3fa0fe3cd39a52f4eefd36ff7161e89' },
  'bbc earth': { kid: '5014941a2c42379880b5edf72304c165', key: 'f3fa0fe3cd39a52f4eefd36ff7161e89' },
  bbclifestyle: { kid: '58b949986ed13294bc01b0f330abc527', key: '23e8c5f2fe202906ac2d6554d9527299' },
  'bbc lifestyle': { kid: '58b949986ed13294bc01b0f330abc527', key: '23e8c5f2fe202906ac2d6554d9527299' },
  bbcworldnews: { kid: 'c7ba46086dda345a929e29bf155e459c', key: 'd374b8f39904bf572689ea347ae86591' },
  'bbc news': { kid: 'c7ba46086dda345a929e29bf155e459c', key: 'd374b8f39904bf572689ea347ae86591' },
  'bbc world': { kid: 'c7ba46086dda345a929e29bf155e459c', key: 'd374b8f39904bf572689ea347ae86591' },
  bloomberg: { kid: '1071393f8fc237f3a9a28028142110f7', key: '7a0f8c3c72e0ffff811d534c929c57c2' },
  cnn: { kid: '714cc8ed05a03abb9ac61bd4bbd1d8a0', key: '1acf58ff8d4cd87c2d3c12d22248efb1' },
  'fashion tv': { kid: 'c1d9f25701023508bfa6737e3a8c7001', key: '30c3613e9b06e0f7cc201014f31bf5d8' },
  fashiontv: { kid: 'c1d9f25701023508bfa6737e3a8c7001', key: '30c3613e9b06e0f7cc201014f31bf5d8' },
  ftv: { kid: 'c1d9f25701023508bfa6737e3a8c7001', key: '30c3613e9b06e0f7cc201014f31bf5d8' },
  tlc: { kid: 'b6908629732639ada4814a6208296d9c', key: '7ca9bf03623f77b5e2f16df0b53f274d' },
  'travel living': { kid: 'b6908629732639ada4814a6208296d9c', key: '7ca9bf03623f77b5e2f16df0b53f274d' },
  boomerang: { kid: 'b1f0d759e914369db388b3b0dc815971', key: '5678d317e17007a88a9b9539e4526512' },
  cartoonito: { kid: 'b1f0d759e914369db388b3b0dc815971', key: '5678d317e17007a88a9b9539e4526512' },
  dmax: { kid: '53b26f904ae03a20b56477cfb9c5dca2', key: '0c64ccfb978e7390bd33344075492aec' },
};

export function cleanStreamUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  const pipeIdx = rawUrl.indexOf('|');
  const base = pipeIdx !== -1 ? rawUrl.substring(0, pipeIdx).trim() : rawUrl.trim();
  return getPlayableStreamUrl(base);
}

export function extractClearKeyFromStream(opts: {
  streamUrl?: string;
  streamName?: string;
  kidHex?: string;
  keyHex?: string;
  drmLicenseUri?: string;
}): { kid: string; key: string } | null {
  if (opts.kidHex && opts.keyHex) {
    return {
      kid: opts.kidHex.replace(/-/g, '').toLowerCase(),
      key: opts.keyHex.replace(/-/g, '').toLowerCase(),
    };
  }
  const url = `${opts.streamUrl || ''} ${opts.drmLicenseUri || ''}`;
  const ckMatch = url.match(/\/api\/clearkey\/([0-9a-fA-F]{32})\/([0-9a-fA-F]{32})/);
  if (ckMatch) {
    return { kid: ckMatch[1].toLowerCase(), key: ckMatch[2].toLowerCase() };
  }
  const sLower = `${url} ${opts.streamName || ''}`.toLowerCase();
  for (const k of Object.keys(FALLBACK_CLEAR_KEYS)) {
    if (sLower.includes(k)) {
      return FALLBACK_CLEAR_KEYS[k];
    }
  }
  return null;
}
