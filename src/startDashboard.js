import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.js';
import { JobManager } from './jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function envFlag(value) {
  return /^(1|true|yes)$/i.test(String(value ?? ''));
}

function withDefault(value, fallback) {
  return value !== undefined ? value : fallback;
}

/**
 * Build the JobManager + Express app and start listening. Every option
 * falls back to an environment variable when not provided at all — but a
 * caller that explicitly passes `null` (e.g. the desktop app forcing "no
 * token" regardless of the shell's environment) gets exactly that, since
 * only `undefined` triggers the environment/default fallback.
 */
export async function startDashboard(options = {}) {
  const port = withDefault(options.port, Number(process.env.PORT) || 3000);
  const host = withDefault(options.host, process.env.HOST || '0.0.0.0');
  const reportsDir = path.resolve(withDefault(options.reportsDir, process.env.SITE_AUDIT_REPORTS_DIR || path.join(repoRoot, 'dashboard-data', 'reports')));
  const dataFile = path.resolve(withDefault(options.dataFile, process.env.SITE_AUDIT_DATA_FILE || path.join(repoRoot, 'dashboard-data', 'jobs.json')));
  const concurrency = Math.max(1, withDefault(options.concurrency, Number(process.env.SITE_AUDIT_CONCURRENCY) || 1));
  const token = withDefault(options.token, process.env.DASHBOARD_TOKEN || null);
  const allowPrivateTargets = withDefault(options.allowPrivateTargets, envFlag(process.env.SITE_AUDIT_ALLOW_PRIVATE_TARGETS));

  const jobManager = new JobManager({ reportsDir, dataFile, concurrency, allowPrivateTargets });
  await jobManager.init();

  const app = createApp({
    jobManager,
    publicDir: path.join(repoRoot, 'public'),
    reportsDir,
    token
  });

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const actualPort = server.address().port;
      const displayHost = host === '0.0.0.0' ? 'localhost' : host;
      console.log(`Site Audit Dashboard running at http://${displayHost}:${actualPort}`);
      const isLoopbackOnly = host === '127.0.0.1' || host === 'localhost' || host === '::1';
      if (token) {
        console.log('Access token required — sign in with the configured token.');
      } else if (!isLoopbackOnly) {
        console.log('⚠ No access token configured (--token / DASHBOARD_TOKEN). Anyone who can reach this URL can');
        console.log('  submit audit jobs. Set a token before exposing this to the public internet.');
      }
      if (allowPrivateTargets) {
        console.log('⚠ Private/internal/loopback audit targets are allowed on this instance.');
      }
      resolve(server);
    });
    server.on('error', reject);
  });
}
