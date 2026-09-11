import { issue, SEVERITY } from './helpers.js';

const MANY_LINKS_THRESHOLD = 150;

export function checkLinksPage(page) {
  const issues = [];
  if (!page.ok || page.nonHtml) return issues;
  const url = page.url;

  const linkCount = (page.links || []).length;
  if (linkCount > MANY_LINKS_THRESHOLD) {
    issues.push(issue({ category: 'links', severity: SEVERITY.INFO, id: 'excessive-links', url,
      title: 'Excessive number of links on the page',
      description: `Found ${linkCount} links on a single page.`,
      recommendation: 'Consider reducing the number of links to help crawlers and users focus on important content.' }));
  }

  return issues;
}

/** Site-wide link checks: broken links (with their source pages) and orphaned pages. */
export function checkLinksSite({ pages, linkGraph, linkStatuses, startUrl }) {
  const issues = [];

  for (const [target, sources] of linkGraph) {
    let status = null;
    let ok = true;
    let errorMsg = null;

    if (pages.has(target)) {
      const p = pages.get(target);
      status = p.status;
      ok = p.ok;
      errorMsg = p.error || null;
    } else if (linkStatuses.has(target)) {
      const s = linkStatuses.get(target);
      status = s.status;
      ok = s.ok;
      errorMsg = s.error;
    } else {
      continue;
    }

    if (!ok || status === 0 || status >= 400) {
      const severity = status >= 500 || status === 0 ? SEVERITY.HIGH : SEVERITY.MEDIUM;
      issues.push(issue({ category: 'links', severity, id: 'broken-internal-link', url: [...sources][0],
        title: `Broken internal link (${status || 'no response'})`,
        description: `Link to ${target} ${errorMsg ? `failed: ${errorMsg}` : `returned HTTP ${status}`}. Linked from ${sources.size} page(s).`,
        recommendation: 'Fix or remove the broken link, or add a redirect to a valid URL.',
        meta: { target, sources: [...sources].slice(0, 10), status } }));
    }
  }

  for (const [url, page] of pages) {
    if (url === startUrl) continue;
    if (!page.ok || page.nonHtml || page.skipped) continue;
    const incoming = linkGraph.get(page.url);
    if ((!incoming || incoming.size === 0) && page.discoveredVia !== 'link') {
      issues.push(issue({ category: 'links', severity: SEVERITY.LOW, id: 'orphan-page', url: page.url,
        title: 'Orphan page',
        description: 'This page was found via the sitemap but has no internal links pointing to it from crawled pages.',
        recommendation: 'Add internal links to this page so users and search engines can discover it through normal navigation.' }));
    }
  }

  return issues;
}
