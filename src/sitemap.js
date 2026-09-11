import { XMLParser } from 'fast-xml-parser';
import { fetchUrl } from './httpClient.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Recursively fetch and flatten a sitemap (or sitemap index) into a flat
 * list of { url, lastmod, changefreq, priority, sourceSitemap }.
 * Guards against cycles and caps total sitemaps visited.
 */
export async function loadSitemap(sitemapUrl, options = {}, seen = new Set(), depth = 0) {
  const urls = [];
  const errors = [];
  if (seen.has(sitemapUrl) || depth > 5 || seen.size > 200) return { urls, errors };
  seen.add(sitemapUrl);

  const result = await fetchUrl(sitemapUrl, { ...options, method: 'GET' });
  if (!result.ok || !result.text) {
    errors.push({ sitemapUrl, status: result.status, error: result.error?.message || `HTTP ${result.status}` });
    return { urls, errors };
  }

  let xml;
  try {
    xml = parser.parse(result.text);
  } catch (error) {
    errors.push({ sitemapUrl, error: `Invalid XML: ${error.message}` });
    return { urls, errors };
  }

  if (xml.sitemapindex) {
    const children = toArray(xml.sitemapindex.sitemap);
    for (const child of children) {
      const loc = child.loc?.['#text'] ?? child.loc;
      if (!loc) continue;
      const nested = await loadSitemap(loc, options, seen, depth + 1);
      urls.push(...nested.urls);
      errors.push(...nested.errors);
    }
  } else if (xml.urlset) {
    const entries = toArray(xml.urlset.url);
    for (const entry of entries) {
      const loc = entry.loc?.['#text'] ?? entry.loc;
      if (!loc) continue;
      urls.push({
        url: loc,
        lastmod: entry.lastmod ?? null,
        changefreq: entry.changefreq ?? null,
        priority: entry.priority !== undefined ? Number(entry.priority) : null,
        sourceSitemap: sitemapUrl
      });
    }
  } else {
    errors.push({ sitemapUrl, error: 'Not a recognized <urlset> or <sitemapindex> document' });
  }

  return { urls, errors };
}

/** Try common sitemap locations and robots.txt declarations for an origin. */
export async function discoverSitemaps(origin, robots, options = {}) {
  const candidates = new Set();
  if (robots?.sitemaps?.length) {
    for (const s of robots.sitemaps) candidates.add(s);
  }
  candidates.add(new URL('/sitemap.xml', origin).toString());
  candidates.add(new URL('/sitemap_index.xml', origin).toString());

  const found = [];
  for (const candidate of candidates) {
    const result = await fetchUrl(candidate, { ...options, method: 'GET' });
    if (result.ok && result.status === 200 && result.text && /<urlset|<sitemapindex/.test(result.text)) {
      found.push(candidate);
    }
  }
  return found;
}
