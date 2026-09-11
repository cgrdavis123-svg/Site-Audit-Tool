import { existsSync } from 'node:fs';
import { issue, SEVERITY } from './helpers.js';

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

/**
 * Cheap, dependency-free performance heuristics computed directly from
 * the parsed HTML (no browser required). Complements the optional
 * Lighthouse audit, which measures real render performance.
 */
export function checkPerformanceHeuristics(page) {
  const issues = [];
  if (!page.ok || page.nonHtml) return issues;
  const url = page.url;

  if (page.renderBlockingScripts > 0) {
    issues.push(issue({ category: 'performance', severity: SEVERITY.LOW, id: 'render-blocking-scripts', url,
      title: 'Render-blocking scripts in <head>',
      description: `${page.renderBlockingScripts} script(s) in <head> lack async/defer attributes.`,
      recommendation: 'Add async or defer to non-critical scripts, or move them before </body>.' }));
  }

  if (page.renderBlockingStyles > 4) {
    issues.push(issue({ category: 'performance', severity: SEVERITY.INFO, id: 'many-blocking-stylesheets', url,
      title: 'Many render-blocking stylesheets',
      description: `${page.renderBlockingStyles} <link rel="stylesheet"> tags found in <head>.`,
      recommendation: 'Combine stylesheets or inline critical CSS to reduce render-blocking requests.' }));
  }

  const imagesMissingDimensions = (page.images || []).filter((img) => !img.width || !img.height);
  if (imagesMissingDimensions.length) {
    issues.push(issue({ category: 'performance', severity: SEVERITY.LOW, id: 'images-missing-dimensions', url,
      title: 'Images missing explicit width/height',
      description: `${imagesMissingDimensions.length} of ${page.images.length} image(s) lack width/height attributes, risking layout shift.`,
      recommendation: 'Set explicit width and height (or aspect-ratio) on <img> tags to prevent cumulative layout shift.' }));
  }

  return issues;
}

async function loadDeps(logger) {
  try {
    const [lighthouseModule, chromeLauncher, playwrightModule] = await Promise.all([
      import('lighthouse'),
      import('chrome-launcher'),
      import('playwright').catch(() => null)
    ]);
    return {
      lighthouse: lighthouseModule.default,
      launch: chromeLauncher.launch,
      chromium: playwrightModule?.chromium
    };
  } catch (error) {
    logger?.debug(`Lighthouse checks unavailable: ${error.message}`);
    return null;
  }
}

function scoreToSeverity(score) {
  if (score === null) return null;
  if (score < 0.5) return SEVERITY.HIGH;
  if (score < 0.7) return SEVERITY.MEDIUM;
  if (score < 0.9) return SEVERITY.LOW;
  return null;
}

/**
 * Run Google Lighthouse against a sample of URLs for real-world
 * performance metrics (Core Web Vitals) and best-practice audits.
 * Returns { available, results: [{url, scores, metrics, opportunities}], issues }.
 */
export async function runLighthouseAudit(urls, { logger, timeout = 60000 } = {}) {
  const deps = await loadDeps(logger);
  if (!deps) {
    return {
      available: false,
      reason: 'lighthouse and/or chrome-launcher are not installed. Run `npm install lighthouse chrome-launcher` to enable deep performance audits.',
      results: [],
      issues: []
    };
  }

  const { lighthouse, launch, chromium } = deps;
  const chromePath = (() => {
    try {
      const p = chromium?.executablePath?.();
      // chrome-launcher spawns this path directly; a stale/mismatched path
      // (e.g. playwright's manifest pointing at a browser revision that
      // isn't actually downloaded) would crash with an unhandled spawn
      // error rather than a catchable rejection, so verify it first.
      return p && existsSync(p) ? p : undefined;
    } catch {
      return undefined;
    }
  })();

  let chrome;
  const results = [];
  const issues = [];

  try {
    chrome = await launch({
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
      chromePath: chromePath || undefined
    });
  } catch (error) {
    logger?.debug(`Failed to launch Chrome for Lighthouse: ${error.message}`);
    return {
      available: false,
      reason: `Could not launch Chrome for Lighthouse audits: ${error.message}. Try running \`npx playwright install chromium\` or install Chrome.`,
      results: [],
      issues: []
    };
  }

  try {
    for (const url of urls) {
      try {
        const runnerResult = await Promise.race([
          lighthouse(url, { port: chrome.port, onlyCategories: CATEGORIES, logLevel: 'error' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Lighthouse timed out')), timeout))
        ]);
        if (!runnerResult?.lhr) continue;
        const lhr = runnerResult.lhr;

        const scores = {};
        for (const cat of CATEGORIES) {
          scores[cat] = lhr.categories[cat] ? Math.round(lhr.categories[cat].score * 100) : null;
        }

        const metrics = {
          firstContentfulPaint: lhr.audits['first-contentful-paint']?.displayValue,
          largestContentfulPaint: lhr.audits['largest-contentful-paint']?.displayValue,
          totalBlockingTime: lhr.audits['total-blocking-time']?.displayValue,
          cumulativeLayoutShift: lhr.audits['cumulative-layout-shift']?.displayValue,
          speedIndex: lhr.audits['speed-index']?.displayValue
        };

        const opportunities = Object.values(lhr.audits)
          .filter((a) => a.details?.type === 'opportunity' && a.numericValue > 0)
          .sort((a, b) => b.numericValue - a.numericValue)
          .slice(0, 5)
          .map((a) => ({ title: a.title, description: a.description, savingsMs: Math.round(a.numericValue) }));

        results.push({ url, scores, metrics, opportunities });

        for (const cat of CATEGORIES) {
          const score = lhr.categories[cat]?.score ?? null;
          const severity = scoreToSeverity(score);
          if (severity) {
            issues.push(issue({
              category: cat === 'performance' ? 'performance' : cat === 'accessibility' ? 'accessibility' : 'technical',
              severity,
              id: `lighthouse-${cat}-score`,
              url,
              title: `Low Lighthouse ${cat} score (${Math.round(score * 100)}/100)`,
              description: `Lighthouse ${cat} category score is ${Math.round(score * 100)} out of 100.`,
              recommendation: `Review the Lighthouse report for ${url} for detailed ${cat} improvement opportunities.`,
              meta: { score: Math.round(score * 100) }
            }));
          }
        }

        for (const opp of opportunities) {
          if (opp.savingsMs >= 300) {
            issues.push(issue({
              category: 'performance',
              severity: opp.savingsMs > 1000 ? SEVERITY.MEDIUM : SEVERITY.LOW,
              id: 'lighthouse-opportunity',
              url,
              title: opp.title,
              description: `${opp.description} Estimated savings: ~${opp.savingsMs}ms.`,
              recommendation: opp.title,
              meta: { savingsMs: opp.savingsMs }
            }));
          }
        }
      } catch (error) {
        logger?.debug(`Lighthouse audit failed for ${url}: ${error.message}`);
      }
    }
  } finally {
    if (chrome) await chrome.kill();
  }

  return { available: true, results, issues };
}
