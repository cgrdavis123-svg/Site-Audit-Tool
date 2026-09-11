import { issue, SEVERITY } from './helpers.js';

const SLOW_MS = 1000;
const VERY_SLOW_MS = 3000;
const LARGE_PAGE_BYTES = 2 * 1024 * 1024;
const COMPRESSIBLE_THRESHOLD_BYTES = 10 * 1024;

export function checkTechnicalPage(page) {
  const issues = [];
  const url = page.url;

  if (page.error) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.CRITICAL, id: 'request-failed', url,
      title: 'Request failed',
      description: page.error,
      recommendation: 'Investigate connectivity, DNS, or server errors preventing this page from loading.' }));
    return issues;
  }

  if (page.status >= 500) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.CRITICAL, id: 'server-error', url,
      title: `Server error (HTTP ${page.status})`,
      description: `The server returned a ${page.status} status code.`,
      recommendation: 'Investigate the server-side error and fix it.' }));
  } else if (page.status >= 400) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.HIGH, id: 'client-error', url,
      title: `Broken page (HTTP ${page.status})`,
      description: `The server returned a ${page.status} status code.`,
      recommendation: 'Fix the broken URL or set up a proper redirect.' }));
  }

  if (page.redirectChain?.length > 2) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'long-redirect-chain', url,
      title: 'Long redirect chain',
      description: `${page.redirectChain.length} redirects before reaching the final URL.`,
      recommendation: 'Point links directly at the final destination URL to avoid redirect chains.',
      meta: { chain: page.redirectChain.map((r) => r.url) } }));
  } else if (page.redirectChain?.length === 1) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.INFO, id: 'single-redirect', url,
      title: 'Page is reached via a redirect',
      description: `Redirected from ${page.redirectChain[0].url}.`,
      recommendation: 'Update internal links to point directly at the final URL when possible.' }));
  }

  if (page.nonHtml || !page.ok) return issues;

  if (!page.hasDoctype) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.LOW, id: 'missing-doctype', url,
      title: 'Missing <!DOCTYPE html>',
      description: 'The document does not declare a doctype.',
      recommendation: 'Add <!DOCTYPE html> as the first line of the document to avoid quirks mode.' }));
  }

  if (!page.charset) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'missing-charset', url,
      title: 'Missing character encoding declaration',
      description: 'No <meta charset> was found.',
      recommendation: 'Add <meta charset="utf-8"> as early as possible in <head>.' }));
  }

  if (!page.viewport) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.HIGH, id: 'missing-viewport', url,
      title: 'Missing viewport meta tag',
      description: 'No <meta name="viewport"> tag; the page may not render correctly on mobile devices.',
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' }));
  }

  if (page.mixedContentUrls?.length) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.HIGH, id: 'mixed-content', url,
      title: 'Mixed content: insecure resources on an HTTPS page',
      description: `${page.mixedContentUrls.length} resource(s) are loaded over plain HTTP.`,
      recommendation: 'Update resource URLs to use HTTPS.',
      meta: { examples: page.mixedContentUrls.slice(0, 5) } }));
  }

  if (page.sizeBytes > LARGE_PAGE_BYTES) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'large-page-size', url,
      title: 'Large page size',
      description: `Page HTML is ${(page.sizeBytes / 1024 / 1024).toFixed(2)} MB.`,
      recommendation: 'Reduce page weight by trimming markup, lazy-loading content, or paginating.' }));
  }

  if (page.sizeBytes > COMPRESSIBLE_THRESHOLD_BYTES) {
    const encoding = page.headers?.['content-encoding'];
    if (!encoding) {
      issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'no-compression', url,
        title: 'Response is not compressed',
        description: 'No Content-Encoding header (e.g. gzip/br) was present on a sizeable response.',
        recommendation: 'Enable gzip or Brotli compression on the server.' }));
    }
  }

  if (page.elapsedMs > VERY_SLOW_MS) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.HIGH, id: 'very-slow-response', url,
      title: 'Very slow server response',
      description: `Response took ${Math.round(page.elapsedMs)}ms.`,
      recommendation: 'Investigate server-side performance (database queries, caching, CDN).' }));
  } else if (page.elapsedMs > SLOW_MS) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.LOW, id: 'slow-response', url,
      title: 'Slow server response',
      description: `Response took ${Math.round(page.elapsedMs)}ms.`,
      recommendation: 'Consider server-side caching or a CDN to speed up response times.' }));
  }

  const cacheControl = page.headers?.['cache-control'];
  if (!cacheControl) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.INFO, id: 'missing-cache-control', url,
      title: 'Missing Cache-Control header',
      description: 'No Cache-Control header was sent for this document.',
      recommendation: 'Set an appropriate Cache-Control header to improve repeat-visit performance.' }));
  }

  return issues;
}

/** Site-wide technical checks: robots.txt, sitemap health, URL consistency. */
export function checkTechnicalSite({ robots, sitemaps, origin }) {
  const issues = [];

  if (!robots.exists) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'missing-robots-txt', url: origin,
      title: 'Missing robots.txt',
      description: `No robots.txt found at ${new URL('/robots.txt', origin)}.`,
      recommendation: 'Add a robots.txt file to guide crawler behavior and declare your sitemap.' }));
  } else {
    const disallowsAll = robots.groups.some((g) =>
      g.agents.includes('*') && g.rules.some((r) => r.type === 'disallow' && r.path === '/'));
    if (disallowsAll) {
      issues.push(issue({ category: 'technical', severity: SEVERITY.CRITICAL, id: 'robots-disallows-all', url: robots.url,
        title: 'robots.txt blocks all crawlers',
        description: 'robots.txt contains "User-agent: *" with "Disallow: /", blocking the entire site from search engines.',
        recommendation: 'Remove the blanket disallow rule if the site should be indexed.' }));
    }
    if (!robots.sitemaps.length) {
      issues.push(issue({ category: 'technical', severity: SEVERITY.LOW, id: 'robots-missing-sitemap', url: robots.url,
        title: 'robots.txt does not reference a sitemap',
        description: 'No "Sitemap:" directive was found in robots.txt.',
        recommendation: 'Add a Sitemap directive pointing to your XML sitemap.' }));
    }
  }

  if (!sitemaps.discovered.length) {
    issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'missing-sitemap', url: origin,
      title: 'No XML sitemap found',
      description: 'No sitemap.xml/sitemap_index.xml was discovered and none is declared in robots.txt.',
      recommendation: 'Generate and publish an XML sitemap to help search engines discover your pages.' }));
  }

  if (sitemaps.errors.length) {
    for (const err of sitemaps.errors.slice(0, 10)) {
      issues.push(issue({ category: 'technical', severity: SEVERITY.MEDIUM, id: 'sitemap-error', url: err.sitemapUrl,
        title: 'Sitemap could not be read',
        description: err.error,
        recommendation: 'Fix the XML syntax or make sure the sitemap URL is reachable.' }));
    }
  }

  return issues;
}
