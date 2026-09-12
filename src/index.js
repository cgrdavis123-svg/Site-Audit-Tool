import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG } from '../config/defaults.js';
import { crawlSite } from './crawler.js';
import { createLogger } from './utils/logger.js';
import { checkSeoPage, checkSeoSite } from './checks/seo.js';
import { checkTechnicalPage, checkTechnicalSite } from './checks/technical.js';
import { checkSecurityPage } from './checks/security.js';
import { checkContentPage, checkContentSite } from './checks/content.js';
import { checkLinksPage, checkLinksSite } from './checks/links.js';
import { checkPerformanceHeuristics, runLighthouseAudit } from './checks/performance.js';
import { runAccessibilityAudit } from './checks/accessibility.js';
import { computeScores } from './scoring.js';
import { writeJsonReport } from './report/json.js';
import { writeHtmlReport } from './report/html.js';
import { writeCsvReport } from './report/csv.js';
import { printConsoleReport } from './report/console.js';

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function summarizePage(page, issueCountByUrl) {
  return {
    url: page.url,
    status: page.status,
    ok: page.ok,
    title: page.title || null,
    wordCount: page.wordCount || 0,
    elapsedMs: page.elapsedMs || 0,
    sizeBytes: page.sizeBytes || 0,
    depth: page.depth ?? null,
    discoveredVia: page.discoveredVia || null,
    issueCount: issueCountByUrl.get(page.url) || 0
  };
}

/**
 * Run a full site audit: crawl, run all check modules, score results,
 * and write the requested report formats. Returns the full report object.
 */
export async function runAudit(userConfig = {}) {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const logger = createLogger({ quiet: config.quiet, verbose: config.verbose });
  const startedAt = Date.now();
  const warnings = [];
  // Optional caller-supplied hook for phase-level progress (used by the
  // dashboard's job manager); the CLI doesn't pass one and relies on the
  // logger instead.
  const onStatus = typeof config.onStatus === 'function' ? config.onStatus : () => {};

  logger.info(`Starting audit of ${config.url}`);
  onStatus('crawling', { message: `Crawling ${config.url}…` });
  const crawl = await crawlSite(config.url, {
    maxPages: config.maxPages,
    maxDepth: config.maxDepth,
    concurrency: config.concurrency,
    delayMs: config.delayMs,
    timeout: config.timeout,
    retries: config.retries,
    userAgent: config.userAgent,
    respectRobots: config.respectRobots,
    includeSubdomains: config.includeSubdomains,
    includePatterns: config.includePatterns,
    excludePatterns: config.excludePatterns,
    useSitemap: config.useSitemap,
    checkExternalLinks: config.checkExternalLinks,
    linkCheckConcurrency: config.linkCheckConcurrency,
    logger,
    onProgress: ({ crawled, queued, current }) => {
      logger.progress(`Crawled ${crawled} page(s), ${queued} queued — ${current}`);
      onStatus('crawling', { crawled, queued, current });
    }
  });
  logger.endProgress();
  logger.success(`Crawled ${crawl.pages.size} page(s).`);

  const pageList = [...crawl.pages.values()];
  const htmlPages = pageList.filter((p) => p.ok && !p.nonHtml && !p.skipped);

  const issues = [];
  const issueCountByUrl = new Map();
  function addIssues(list) {
    for (const iss of list) {
      issues.push(iss);
      if (iss.url) issueCountByUrl.set(iss.url, (issueCountByUrl.get(iss.url) || 0) + 1);
    }
  }

  logger.info('Running per-page checks…');
  onStatus('checking', { message: `Running SEO/technical/security/content checks on ${pageList.length} page(s)…` });
  for (const page of pageList) {
    addIssues(checkSeoPage(page));
    addIssues(checkTechnicalPage(page));
    addIssues(checkSecurityPage(page));
    addIssues(checkContentPage(page));
    addIssues(checkLinksPage(page));
    addIssues(checkPerformanceHeuristics(page));
  }

  logger.info('Running site-wide checks…');
  addIssues(checkSeoSite(htmlPages));
  addIssues(checkTechnicalSite({ robots: crawl.robots, sitemaps: crawl.sitemaps, origin: crawl.origin }));
  addIssues(checkContentSite(htmlPages));
  addIssues(checkLinksSite({
    pages: crawl.pages,
    linkGraph: crawl.linkGraph,
    linkStatuses: crawl.linkStatuses,
    startUrl: crawl.startUrl
  }));

  let accessibility = { available: false, issues: [], pagesAudited: 0 };
  if (config.accessibility) {
    logger.info('Running accessibility audit (this may take a while)…');
    onStatus('accessibility', { message: 'Running accessibility audit (this may take a while)…' });
    const sample = htmlPages.slice(0, config.accessibilityPages).map((p) => p.url);
    accessibility = await runAccessibilityAudit(sample, { logger, timeout: config.timeout });
    if (!accessibility.available) warnings.push(accessibility.reason);
    else addIssues(accessibility.issues);
  }

  let lighthouse = { available: false, results: [], issues: [] };
  if (config.lighthouse) {
    logger.info('Running Lighthouse audit (this may take a while)…');
    onStatus('lighthouse', { message: 'Running Lighthouse audit (this may take a while)…' });
    const sample = htmlPages.slice(0, config.lighthousePages).map((p) => p.url);
    lighthouse = await runLighthouseAudit(sample, { logger, timeout: config.timeout * 4 });
    if (!lighthouse.available) warnings.push(lighthouse.reason);
    else addIssues(lighthouse.issues);
  }

  onStatus('scoring', { message: 'Scoring results…' });
  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.seq - b.seq);

  const skippedCategories = [];
  if (!(config.accessibility && accessibility.available && accessibility.pagesAudited > 0)) {
    skippedCategories.push('accessibility');
  }

  const scores = computeScores(issues, { pageCount: Math.max(1, htmlPages.length), skippedCategories });

  const brokenLinkCount = issues.filter((i) => i.id === 'broken-internal-link').length;

  const report = {
    meta: {
      tool: 'site-audit-tool',
      version: '1.0.0',
      startUrl: crawl.startUrl,
      origin: crawl.origin,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      pagesCrawled: crawl.pages.size,
      pagesLimitHit: crawl.stats.hitPageLimit,
      warnings
    },
    scores,
    issues,
    topIssues: issues.slice(0, 30),
    pages: pageList.map((p) => summarizePage(p, issueCountByUrl)),
    robots: {
      exists: crawl.robots.exists,
      url: crawl.robots.url,
      sitemapCount: crawl.robots.sitemaps?.length || 0
    },
    sitemap: {
      discovered: crawl.sitemaps.discovered,
      urlCount: crawl.sitemaps.urls.length,
      errors: crawl.sitemaps.errors
    },
    links: {
      internalCount: crawl.linkGraph.size,
      externalCount: crawl.externalLinks.size,
      brokenCount: brokenLinkCount
    },
    accessibility: { available: accessibility.available, pagesAudited: accessibility.pagesAudited },
    lighthouse: { available: lighthouse.available, results: lighthouse.results }
  };

  if (config.formats?.length) {
    onStatus('writing-reports', { message: 'Writing report(s)…' });
    await mkdir(config.outputDir, { recursive: true });
    for (const format of config.formats) {
      const filePath = path.join(config.outputDir, `report.${format}`);
      if (format === 'json') await writeJsonReport(report, filePath);
      else if (format === 'html') await writeHtmlReport(report, filePath);
      else if (format === 'csv') await writeCsvReport(report, filePath);
      logger.success(`Wrote ${format.toUpperCase()} report to ${filePath}`);
    }
  }

  if (!config.quiet) printConsoleReport(report);
  onStatus('done', { message: 'Audit complete.' });

  return report;
}

export { DEFAULT_CONFIG };
