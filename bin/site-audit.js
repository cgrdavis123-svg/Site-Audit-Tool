#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { runAudit } from '../src/index.js';
import { createLogger } from '../src/utils/logger.js';

function collect(value, previous) {
  return previous.concat([value]);
}

async function loadConfigFile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (resolved.endsWith('.json')) {
    return JSON.parse(await readFile(resolved, 'utf-8'));
  }
  const mod = await import(pathToFileURL(resolved).toString());
  return mod.default || mod;
}

function openInBrowser(filePath) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '""', filePath] : [filePath];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

const program = new Command();

program
  .name('site-audit')
  .description('In-depth, advanced site audit tool: crawls a website and audits SEO, technical health, security, performance, accessibility, content quality and link integrity.')
  .version('1.0.0')
  .argument('<url>', 'The URL to audit (e.g. https://example.com)')
  .option('--max-pages <n>', 'Maximum number of pages to crawl', (v) => parseInt(v, 10))
  .option('--max-depth <n>', 'Maximum link depth to follow from the start URL', (v) => parseInt(v, 10))
  .option('--concurrency <n>', 'Number of concurrent requests', (v) => parseInt(v, 10))
  .option('--delay <ms>', 'Delay between requests in milliseconds', (v) => parseInt(v, 10))
  .option('--timeout <ms>', 'Per-request timeout in milliseconds', (v) => parseInt(v, 10))
  .option('--retries <n>', 'Number of retries for failed requests', (v) => parseInt(v, 10))
  .option('--user-agent <ua>', 'Custom User-Agent header')
  .option('--ignore-robots', 'Ignore robots.txt rules while crawling')
  .option('--include-subdomains', 'Treat subdomains of the target as internal')
  .option('--no-sitemap', 'Do not discover or crawl the XML sitemap')
  .option('--check-external-links', 'Verify external links return a valid HTTP status')
  .option('--include <pattern>', 'Only crawl URLs containing this substring (repeatable)', collect, [])
  .option('--exclude <pattern>', 'Skip URLs containing this substring (repeatable)', collect, [])
  .option('--a11y', 'Run accessibility audits (requires playwright + axe-core)')
  .option('--accessibility-pages <n>', 'Number of pages to run accessibility audits on', (v) => parseInt(v, 10))
  .option('--lighthouse', 'Run Google Lighthouse audits (requires lighthouse + chrome-launcher)')
  .option('--lighthouse-pages <n>', 'Number of pages to run Lighthouse audits on', (v) => parseInt(v, 10))
  .option('-o, --output <dir>', 'Output directory for report files')
  .option('-f, --format <formats>', 'Comma-separated report formats: html,json,csv,all')
  .option('--fail-under <score>', 'Exit with a non-zero status if the overall score is below this value', (v) => parseInt(v, 10))
  .option('-c, --config <file>', 'Path to a JSON or JS config file')
  .option('--open', 'Open the HTML report in your browser when done')
  .option('-q, --quiet', 'Suppress console output except errors')
  .option('-v, --verbose', 'Print verbose debug logging')
  .action(async (url, options) => {
    const logger = createLogger({ quiet: options.quiet, verbose: options.verbose });
    try {
      let fileConfig = {};
      if (options.config) fileConfig = await loadConfigFile(options.config);

      const cliConfig = {
        url,
        ...(options.maxPages !== undefined && { maxPages: options.maxPages }),
        ...(options.maxDepth !== undefined && { maxDepth: options.maxDepth }),
        ...(options.concurrency !== undefined && { concurrency: options.concurrency }),
        ...(options.delay !== undefined && { delayMs: options.delay }),
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(options.retries !== undefined && { retries: options.retries }),
        ...(options.userAgent !== undefined && { userAgent: options.userAgent }),
        ...(options.ignoreRobots && { respectRobots: false }),
        ...(options.includeSubdomains && { includeSubdomains: true }),
        ...(options.sitemap === false && { useSitemap: false }),
        ...(options.checkExternalLinks && { checkExternalLinks: true }),
        ...(options.include?.length && { includePatterns: options.include }),
        ...(options.exclude?.length && { excludePatterns: options.exclude }),
        ...(options.a11y && { accessibility: true }),
        ...(options.accessibilityPages !== undefined && { accessibilityPages: options.accessibilityPages }),
        ...(options.lighthouse && { lighthouse: true }),
        ...(options.lighthousePages !== undefined && { lighthousePages: options.lighthousePages }),
        ...(options.output !== undefined && { outputDir: options.output }),
        ...(options.format !== undefined && {
          formats: options.format === 'all' ? ['html', 'json', 'csv'] : options.format.split(',').map((f) => f.trim())
        }),
        ...(options.failUnder !== undefined && { failUnder: options.failUnder }),
        ...(options.quiet && { quiet: true }),
        ...(options.verbose && { verbose: true })
      };

      const config = { ...fileConfig, ...cliConfig };
      const report = await runAudit(config);

      if (options.open && config.formats?.includes('html')) {
        openInBrowser(path.resolve(config.outputDir || './site-audit-report', 'report.html'));
      }

      if (config.failUnder !== null && config.failUnder !== undefined && report.scores.overall < config.failUnder) {
        logger.error(`Overall score ${report.scores.overall} is below the required threshold of ${config.failUnder}.`);
        process.exitCode = 1;
      }
    } catch (error) {
      logger.error(error.stack || error.message);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
