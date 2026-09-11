const ASSET_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp',
  'pdf', 'zip', 'rar', 'tar', 'gz', '7z',
  'mp3', 'mp4', 'avi', 'mov', 'wmv', 'wav', 'ogg', 'webm',
  'woff', 'woff2', 'ttf', 'eot', 'otf',
  'css', 'js', 'json', 'xml', 'txt', 'csv',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);

/**
 * Resolve a possibly-relative URL against a base and normalize it:
 * strips the fragment, lower-cases the host, and drops a trailing slash
 * on non-root paths so equivalent URLs dedupe during crawling.
 */
export function normalizeUrl(href, base) {
  if (!href) return null;
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function getScheme(href) {
  try {
    return new URL(href).protocol;
  } catch {
    return null;
  }
}

export function isCrawlableScheme(href) {
  const scheme = getScheme(href);
  return scheme === 'http:' || scheme === 'https:';
}

export function getExtension(pathname) {
  const match = /\.([a-z0-9]+)$/i.exec(pathname.split('?')[0]);
  return match ? match[1].toLowerCase() : '';
}

/** True for URLs that point at a static asset rather than an HTML document. */
export function looksLikeAsset(href) {
  try {
    const url = new URL(href);
    const ext = getExtension(url.pathname);
    return ASSET_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function registrableHost(hostname) {
  const parts = hostname.split('.');
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.');
}

export function isSameOrigin(href, rootHref, { includeSubdomains = false } = {}) {
  try {
    const url = new URL(href);
    const root = new URL(rootHref);
    if (includeSubdomains) {
      return registrableHost(url.hostname) === registrableHost(root.hostname);
    }
    return url.hostname === root.hostname;
  } catch {
    return false;
  }
}

export function matchesPatterns(href, patterns = []) {
  if (!patterns.length) return false;
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) return pattern.test(href);
    return href.includes(pattern);
  });
}

export function withoutQuery(href) {
  try {
    const url = new URL(href);
    url.search = '';
    return url.toString();
  } catch {
    return href;
  }
}
