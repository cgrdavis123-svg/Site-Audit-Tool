#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';
import { JobManager } from '../src/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const program = new Command();

program
  .name('site-audit-dashboard')
  .description('Start a web dashboard for running site audits: enter a URL, click Start, and open the report when it finishes.')
  .option('-p, --port <n>', 'Port to listen on', (v) => parseInt(v, 10), Number(process.env.PORT) || 3000)
  .option('-H, --host <host>', 'Host/interface to bind to', process.env.HOST || '0.0.0.0')
  .option('--reports-dir <dir>', 'Where generated reports are stored', process.env.SITE_AUDIT_REPORTS_DIR || path.join(repoRoot, 'dashboard-data', 'reports'))
  .option('--data-file <file>', 'Where job history is persisted', process.env.SITE_AUDIT_DATA_FILE || path.join(repoRoot, 'dashboard-data', 'jobs.json'))
  .option('--concurrency <n>', 'Number of audits to run at once', (v) => parseInt(v, 10), Number(process.env.SITE_AUDIT_CONCURRENCY) || 1)
  .option('--token <token>', 'Require this token to use the dashboard (or set DASHBOARD_TOKEN)', process.env.DASHBOARD_TOKEN)
  .option('--allow-private-targets', 'Allow auditing private/internal/loopback addresses (disabled by default to prevent SSRF)', false)
  .action(async (options) => {
    const jobManager = new JobManager({
      reportsDir: path.resolve(options.reportsDir),
      dataFile: path.resolve(options.dataFile),
      concurrency: Math.max(1, options.concurrency),
      allowPrivateTargets: options.allowPrivateTargets
    });
    await jobManager.init();

    const app = createApp({
      jobManager,
      publicDir: path.join(repoRoot, 'public'),
      reportsDir: path.resolve(options.reportsDir),
      token: options.token || null
    });

    app.listen(options.port, options.host, () => {
      const displayHost = options.host === '0.0.0.0' ? 'localhost' : options.host;
      console.log(`Site Audit Dashboard running at http://${displayHost}:${options.port}`);
      if (options.token) {
        console.log('Access token required — sign in with the configured token.');
      } else {
        console.log('⚠ No access token configured (--token / DASHBOARD_TOKEN). Anyone who can reach this URL can');
        console.log('  submit audit jobs. Set a token before exposing this to the public internet.');
      }
      if (options.allowPrivateTargets) {
        console.log('⚠ --allow-private-targets is set: this server will crawl private/internal/loopback addresses.');
      }
    });
  });

program.parseAsync(process.argv);
