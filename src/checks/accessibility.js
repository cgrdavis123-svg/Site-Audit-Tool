import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { issue, SEVERITY } from './helpers.js';

const require = createRequire(import.meta.url);

const IMPACT_TO_SEVERITY = {
  critical: SEVERITY.CRITICAL,
  serious: SEVERITY.HIGH,
  moderate: SEVERITY.MEDIUM,
  minor: SEVERITY.LOW
};

async function loadDeps(logger) {
  try {
    const [{ chromium }, axeSourcePath] = await Promise.all([
      import('playwright'),
      Promise.resolve(require.resolve('axe-core/axe.min.js'))
    ]);
    const axeSource = readFileSync(axeSourcePath, 'utf-8');
    return { chromium, axeSource };
  } catch (error) {
    logger?.debug(`Accessibility checks unavailable: ${error.message}`);
    return null;
  }
}

/**
 * Run axe-core accessibility audits against a sample of crawled pages
 * using a headless browser. Returns { available, issues, pagesAudited }.
 * Gracefully reports unavailability if playwright/axe-core aren't installed.
 */
export async function runAccessibilityAudit(urls, { logger, timeout = 20000 } = {}) {
  const deps = await loadDeps(logger);
  if (!deps) {
    return {
      available: false,
      reason: 'playwright and/or axe-core are not installed. Run `npm install playwright axe-core` and `npx playwright install chromium` to enable accessibility audits.',
      issues: [],
      pagesAudited: 0
    };
  }

  const { chromium, axeSource } = deps;
  const issues = [];
  let browser;
  let pagesAudited = 0;

  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    logger?.debug(`Failed to launch browser for accessibility audit: ${error.message}`);
    return {
      available: false,
      reason: `Could not launch a browser for accessibility audits: ${error.message}. Try running \`npx playwright install chromium\`.`,
      issues: [],
      pagesAudited: 0
    };
  }

  try {
    const context = await browser.newContext();

    for (const url of urls) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout });
        await page.addScriptTag({ content: axeSource });
        const results = await page.evaluate(async () => {
          // eslint-disable-next-line no-undef
          return axe.run(document, { resultTypes: ['violations'] });
        });
        pagesAudited++;

        for (const violation of results.violations) {
          const severity = IMPACT_TO_SEVERITY[violation.impact] || SEVERITY.MEDIUM;
          issues.push(issue({
            category: 'accessibility',
            severity,
            id: `axe-${violation.id}`,
            url,
            title: violation.help,
            description: `${violation.description} (${violation.nodes.length} element(s) affected).`,
            recommendation: `See ${violation.helpUrl} for how to fix this. Affects: ${violation.nodes
              .slice(0, 3)
              .map((n) => n.target.join(' '))
              .join('; ')}`,
            meta: {
              wcagTags: violation.tags.filter((t) => /wcag/i.test(t)),
              nodeCount: violation.nodes.length,
              helpUrl: violation.helpUrl
            }
          }));
        }
      } catch (error) {
        logger?.debug(`Accessibility audit failed for ${url}: ${error.message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  return { available: true, issues, pagesAudited };
}
