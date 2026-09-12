#!/usr/bin/env node
import { Command } from 'commander';
import { startDashboard } from '../src/startDashboard.js';

const program = new Command();

program
  .name('site-audit-dashboard')
  .description('Start a web dashboard for running site audits: enter a URL, click Start, and open the report when it finishes.')
  .option('-p, --port <n>', 'Port to listen on', (v) => parseInt(v, 10))
  .option('-H, --host <host>', 'Host/interface to bind to')
  .option('--reports-dir <dir>', 'Where generated reports are stored')
  .option('--data-file <file>', 'Where job history is persisted')
  .option('--concurrency <n>', 'Number of audits to run at once', (v) => parseInt(v, 10))
  .option('--token <token>', 'Require this token to use the dashboard (or set DASHBOARD_TOKEN)')
  .option('--allow-private-targets', 'Allow auditing private/internal/loopback addresses (disabled by default to prevent SSRF)')
  .action(async (options) => {
    await startDashboard({
      port: options.port,
      host: options.host,
      reportsDir: options.reportsDir,
      dataFile: options.dataFile,
      concurrency: options.concurrency,
      token: options.token,
      allowPrivateTargets: options.allowPrivateTargets || undefined
    });
  });

program.parseAsync(process.argv);
