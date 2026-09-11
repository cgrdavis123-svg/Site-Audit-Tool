import { fetchUrl } from './httpClient.js';
import { parseHtmlPage } from './pageParser.js';
import { loadRobotsTxt } from './robots.js';
import { discoverSitemaps, loadSitemap } from './sitemap.js';
import { WorkQueue, runPool } from './utils/concurrency.js';
import { normalizeUrl, isSameOrigin, matchesPatterns, looksLikeAsset, isCrawlableScheme } from './utils/url.js';

/**
 * Crawl a site starting from `startUrl`, respecting robots.txt (unless
 * disabled), discovering pages via links and the XML sitemap, and
 * returning parsed page data plus link-graph and broken-link information
 * needed by the audit checks.
 */
export async function crawlSite(startUrl, options = {}) {
  const {
    maxPages = 100,
    maxDepth = 5,
    concurrency = 5,
    delayMs = 0,
    timeout = 15000,
    retries = 2,
    userAgent,
    respectRobots = true,
    includeSubdomains = false,
    includePatterns = [],
    excludePatterns = [],
    useSitemap = true,
    checkExternalLinks = false,
    linkCheckConcurrency = 10,
    onPageCrawled = () => {},
    onProgress = () => {},
    logger = null
  } = options;

  const normalizedStart = normalizeUrl(startUrl, startUrl);
  const origin = new URL(normalizedStart).origin;
  const fetchOpts = { timeout, retries, userAgent };

  logger?.debug('Loading robots.txt…');
  const robots = respectRobots
    ? await loadRobotsTxt(origin, fetchOpts)
    : { exists: false, groups: [], sitemaps: [], isAllowed: () => true };

  let sitemapUrls = [];
  let sitemapErrors = [];
  let discoveredSitemaps = [];
  if (useSitemap) {
    logger?.debug('Discovering sitemap(s)…');
    discoveredSitemaps = await discoverSitemaps(origin, robots, fetchOpts);
    for (const sitemapUrl of discoveredSitemaps) {
      const { urls, errors } = await loadSitemap(sitemapUrl, fetchOpts);
      sitemapUrls.push(...urls);
      sitemapErrors.push(...errors);
    }
  }

  const pages = new Map(); // url -> pageData
  const linkGraph = new Map(); // target url -> Set(source urls)
  const externalLinks = new Map(); // target url -> Set(source urls)
  const depthOf = new Map();
  const queuedOrVisited = new Set();
  const allInternalTargets = new Set();

  function passesFilters(url) {
    if (includePatterns.length && !matchesPatterns(url, includePatterns)) return false;
    if (excludePatterns.length && matchesPatterns(url, excludePatterns)) return false;
    return true;
  }

  function recordLink(targetUrl, sourceUrl, isInternal) {
    const map = isInternal ? linkGraph : externalLinks;
    if (!map.has(targetUrl)) map.set(targetUrl, new Set());
    map.get(targetUrl).add(sourceUrl);
  }

  let crawledCount = 0;
  // Gate scheduling (not just completion) against maxPages: pages.size only
  // grows once a fetch finishes, so with concurrency > 1 checking it inside
  // onTask lets sibling links slip in before earlier ones finish and the
  // limit would be overshot by up to `concurrency` pages. Since JS is
  // single-threaded and there's no await between the check and increment
  // in enqueue() below, this counter is an exact, race-free cap on
  // scheduled work.
  let scheduledCount = 0;

  function enqueue(url, depth, via) {
    if (queuedOrVisited.has(url) || scheduledCount >= maxPages) return;
    scheduledCount++;
    queuedOrVisited.add(url);
    depthOf.set(url, depth);
    queue.push({ url, depth, via }, url);
  }

  const queue = new WorkQueue({
    concurrency,
    onTask: async ({ url, depth, via }) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));

      const path = (() => {
        try {
          const u = new URL(url);
          return u.pathname + u.search;
        } catch {
          return '/';
        }
      })();

      if (respectRobots && !robots.isAllowed(path, userAgent || '*')) {
        pages.set(url, { url, status: 0, ok: false, skipped: 'robots', wordCount: 0, links: [], images: [] });
        return;
      }

      onProgress({ crawled: crawledCount, queued: queue.size(), current: url });
      const result = await fetchUrl(url, fetchOpts);
      crawledCount++;

      const finalUrl = result.finalUrl;
      const contentType = result.headers?.['content-type'] || '';
      let pageData;

      if (result.error) {
        pageData = {
          url, finalUrl, status: 0, ok: false, error: result.error.message,
          redirectChain: result.redirectChain, wordCount: 0, links: [], images: []
        };
      } else if (contentType.includes('text/html') && result.text) {
        pageData = parseHtmlPage({
          pageUrl: finalUrl,
          html: result.text,
          headers: result.headers,
          status: result.status,
          elapsedMs: result.elapsedMs,
          sizeBytes: result.sizeBytes,
          redirectChain: result.redirectChain
        });
        pageData.requestedUrl = url;
        pageData.depth = depth;
        pageData.discoveredVia = via;

        for (const link of pageData.links) {
          if (!link.absoluteUrl || !link.crawlable) continue;
          const sameOrigin = isSameOrigin(link.absoluteUrl, origin, { includeSubdomains });
          if (sameOrigin) {
            allInternalTargets.add(link.absoluteUrl);
            recordLink(link.absoluteUrl, finalUrl, true);
            if (
              depth + 1 <= maxDepth &&
              passesFilters(link.absoluteUrl) &&
              !looksLikeAsset(link.absoluteUrl)
            ) {
              enqueue(link.absoluteUrl, depth + 1, 'link');
            }
          } else {
            recordLink(link.absoluteUrl, finalUrl, false);
          }
        }
      } else {
        pageData = {
          url, finalUrl, status: result.status, ok: result.ok,
          contentType, headers: result.headers, sizeBytes: result.sizeBytes,
          elapsedMs: result.elapsedMs, redirectChain: result.redirectChain,
          nonHtml: true, wordCount: 0, links: [], images: []
        };
      }

      pages.set(url, pageData);
      onPageCrawled(pageData);
    }
  });

  enqueue(normalizedStart, 0, 'seed');

  if (useSitemap) {
    for (const entry of sitemapUrls) {
      if (scheduledCount >= maxPages) break;
      const normalized = normalizeUrl(entry.url, origin);
      if (!normalized) continue;
      if (!isSameOrigin(normalized, origin, { includeSubdomains })) continue;
      if (!passesFilters(normalized) || looksLikeAsset(normalized)) continue;
      enqueue(normalized, 0, 'sitemap');
    }
  }

  await queue.onIdle();

  // Verify status of internal links that were discovered but never crawled
  // (e.g. beyond maxPages/maxDepth), plus optionally external links, so
  // broken-link checks aren't limited to pages we fully rendered.
  const uncheckedInternal = [...allInternalTargets].filter((u) => !pages.has(u));
  const externalTargets = checkExternalLinks ? [...externalLinks.keys()] : [];
  const linkStatuses = new Map();

  const toVerify = [...uncheckedInternal, ...externalTargets];
  if (toVerify.length) {
    logger?.debug(`Verifying ${toVerify.length} additional link target(s)…`);
    await runPool(toVerify, async (url) => {
      const result = await fetchUrl(url, { ...fetchOpts, method: 'GET', timeout: Math.min(timeout, 10000), retries: 1 });
      linkStatuses.set(url, {
        status: result.status,
        ok: result.ok,
        error: result.error?.message || null,
        redirectChain: result.redirectChain
      });
    }, linkCheckConcurrency);
  }

  return {
    origin,
    startUrl: normalizedStart,
    robots,
    sitemaps: { discovered: discoveredSitemaps, urls: sitemapUrls, errors: sitemapErrors },
    pages,
    linkGraph,
    externalLinks,
    linkStatuses,
    stats: {
      pagesCrawled: pages.size,
      hitPageLimit: scheduledCount >= maxPages
    }
  };
}
