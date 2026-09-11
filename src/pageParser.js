import * as cheerio from 'cheerio';
import { normalizeUrl, isCrawlableScheme } from './utils/url.js';

const GENERIC_ANCHOR_TEXT = new Set([
  'click here', 'here', 'read more', 'more', 'link', 'this page', 'learn more', 'more info'
]);

function text($el) {
  return $el.text().replace(/\s+/g, ' ').trim();
}

/**
 * Parse a fetched HTML document into a structured PageData object used by
 * every check module. `pageUrl` is the final (post-redirect) URL, used to
 * resolve relative links/assets.
 */
export function parseHtmlPage({ pageUrl, html, headers = {}, status, elapsedMs, sizeBytes, redirectChain = [] }) {
  const $ = cheerio.load(html);

  const title = text($('title').first());
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() ?? null;
  const metaRobots = $('meta[name="robots"]').attr('content')?.trim().toLowerCase() ?? null;
  const canonicalHref = $('link[rel="canonical"]').attr('href') ?? null;
  const canonical = canonicalHref ? normalizeUrl(canonicalHref, pageUrl) : null;
  const lang = $('html').attr('lang')?.trim() ?? null;
  const charset = $('meta[charset]').attr('charset')?.toLowerCase()
    ?? (/charset=([^;"']+)/i.exec($('meta[http-equiv="Content-Type"]').attr('content') || '')?.[1]?.toLowerCase())
    ?? null;
  const viewport = $('meta[name="viewport"]').attr('content')?.trim() ?? null;
  const favicon = $('link[rel="icon"], link[rel="shortcut icon"]').attr('href') ?? null;
  const hasDoctype = /^\s*<!doctype html/i.test(html);

  const headings = { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] };
  const headingOrder = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const level = el.tagName.toLowerCase();
    const t = text($(el));
    headings[level].push(t);
    headingOrder.push(Number(level[1]));
  });

  const images = [];
  $('img').each((_, el) => {
    const $el = $(el);
    images.push({
      src: $el.attr('src') || $el.attr('data-src') || null,
      alt: $el.attr('alt'),
      hasAlt: $el.attr('alt') !== undefined,
      width: $el.attr('width') || null,
      height: $el.attr('height') || null,
      loading: $el.attr('loading') || null
    });
  });

  const links = [];
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href || href.startsWith('#')) return;
    const absoluteUrl = normalizeUrl(href, pageUrl);
    const anchorText = text($el);
    const rel = ($el.attr('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
    links.push({
      href,
      absoluteUrl,
      crawlable: absoluteUrl ? isCrawlableScheme(absoluteUrl) : false,
      text: anchorText,
      isGenericText: GENERIC_ANCHOR_TEXT.has(anchorText.toLowerCase()),
      rel,
      isNoFollow: rel.includes('nofollow'),
      target: $el.attr('target') || null
    });
  });

  const hreflang = [];
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    hreflang.push({ hreflang: $(el).attr('hreflang'), href: $(el).attr('href') });
  });

  const openGraph = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr('property');
    if (prop) openGraph[prop] = $(el).attr('content') ?? '';
  });

  const twitterCard = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) twitterCard[name] = $(el).attr('content') ?? '';
  });

  const structuredData = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      structuredData.push({ valid: true, data: JSON.parse(raw) });
    } catch (error) {
      structuredData.push({ valid: false, error: error.message, raw: raw.slice(0, 200) });
    }
  });

  const forms = [];
  $('form').each((_, el) => {
    forms.push({ action: $(el).attr('action') || '', method: ($(el).attr('method') || 'get').toLowerCase() });
  });

  $('script, style, noscript').remove();
  const bodyText = text($('body'));
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;
  const htmlLength = html.length || 1;
  const textToHtmlRatio = bodyText.length / htmlLength;

  const mixedContentUrls = [];
  if (pageUrl.startsWith('https://')) {
    const $orig = cheerio.load(html);
    $orig('img[src], script[src], link[rel="stylesheet"][href], iframe[src]').each((_, el) => {
      const attr = el.tagName.toLowerCase() === 'link' ? 'href' : 'src';
      const val = $orig(el).attr(attr);
      if (val && val.startsWith('http://')) mixedContentUrls.push(val);
    });
  }

  const scriptsInHead = $('head script[src]').filter((_, el) => !$(el).attr('async') && !$(el).attr('defer')).length;
  const stylesInHead = $('head link[rel="stylesheet"]').length;

  return {
    url: pageUrl,
    status,
    ok: status >= 200 && status < 400,
    headers,
    elapsedMs,
    sizeBytes,
    redirectChain,
    contentType: headers['content-type'] || null,
    html,
    title,
    titleLength: title.length,
    metaDescription,
    metaDescriptionLength: metaDescription?.length ?? 0,
    metaRobots,
    isNoIndex: /noindex/.test(metaRobots || ''),
    canonical,
    isSelfCanonical: canonical ? canonical === pageUrl : null,
    lang,
    charset,
    viewport,
    favicon: favicon ? normalizeUrl(favicon, pageUrl) : null,
    hasDoctype,
    headings,
    headingOrder,
    images,
    links,
    internalLinks: links.filter((l) => l.crawlable),
    hreflang,
    openGraph,
    twitterCard,
    structuredData,
    forms,
    wordCount,
    textToHtmlRatio,
    mixedContentUrls,
    renderBlockingScripts: scriptsInHead,
    renderBlockingStyles: stylesInHead
  };
}
