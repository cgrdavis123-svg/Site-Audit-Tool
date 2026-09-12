import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { runAudit } from './index.js';
import { assertPublicHost } from './utils/ssrfGuard.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Whitelist and clamp options coming from an untrusted web client. */
function sanitizeOptions(raw = {}) {
  return {
    maxPages: clamp(raw.maxPages, 1, 500, 100),
    maxDepth: clamp(raw.maxDepth, 0, 10, 5),
    respectRobots: raw.ignoreRobots ? false : true,
    includeSubdomains: !!raw.includeSubdomains,
    checkExternalLinks: !!raw.checkExternalLinks,
    accessibility: !!raw.accessibility,
    lighthouse: !!raw.lighthouse
  };
}

function buildSummary(report) {
  const categories = {};
  for (const [key, cat] of Object.entries(report.scores.categories)) {
    categories[key] = { label: cat.label, score: cat.score, issueCount: cat.issueCount, skipped: !!cat.skipped };
  }
  return {
    overall: report.scores.overall,
    categories,
    totalIssues: report.scores.totalIssues,
    totalCounts: report.scores.totalCounts,
    pagesCrawled: report.meta.pagesCrawled,
    pagesLimitHit: report.meta.pagesLimitHit,
    durationMs: report.meta.durationMs,
    warnings: report.meta.warnings
  };
}

/**
 * Manages the lifecycle of dashboard-submitted audit jobs: a bounded
 * FIFO queue (so a shared-hosting box isn't asked to crawl N sites at
 * once), JSON persistence so history survives a process restart, and
 * automatic pruning of old report directories.
 */
export class JobManager {
  constructor({
    reportsDir,
    dataFile,
    concurrency = 1,
    maxQueueLength = 20,
    maxHistory = 200,
    allowPrivateTargets = false,
    defaultConfig = {},
    runAuditFn = runAudit,
    assertPublicHostFn = assertPublicHost
  }) {
    this.reportsDir = reportsDir;
    this.dataFile = dataFile;
    this.concurrency = concurrency;
    this.maxQueueLength = maxQueueLength;
    this.maxHistory = maxHistory;
    this.allowPrivateTargets = allowPrivateTargets;
    this.defaultConfig = defaultConfig;
    this.runAuditFn = runAuditFn;
    this.assertPublicHostFn = assertPublicHostFn;

    this.jobs = new Map();
    this.queue = [];
    this.activeCount = 0;
    this._persistPromise = Promise.resolve();
  }

  async init() {
    await mkdir(this.reportsDir, { recursive: true });
    await mkdir(path.dirname(this.dataFile), { recursive: true });
    try {
      const raw = await readFile(this.dataFile, 'utf-8');
      const saved = JSON.parse(raw);
      for (const job of saved) {
        // A process restart means anything that was mid-flight never
        // finished; surface that honestly instead of leaving it stuck
        // "running" forever.
        if (ACTIVE_STATUSES.has(job.status)) {
          job.status = 'interrupted';
          job.error = job.error || 'Server restarted while this audit was in progress.';
          job.finishedAt = job.finishedAt || Date.now();
        }
        this.jobs.set(job.id, job);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await this._persist();
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id) {
    return this.jobs.get(id);
  }

  createJob({ url, options }) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw Object.assign(new Error('Please enter a valid URL, including http:// or https://.'), { statusCode: 400 });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw Object.assign(new Error('Only http:// and https:// URLs can be audited.'), { statusCode: 400 });
    }

    const activeCount = [...this.jobs.values()].filter((j) => ACTIVE_STATUSES.has(j.status)).length;
    if (activeCount >= this.maxQueueLength) {
      throw Object.assign(new Error('Too many audits are already queued. Please try again shortly.'), { statusCode: 429 });
    }

    const id = randomUUID();
    const job = {
      id,
      url: parsed.toString(),
      options: sanitizeOptions(options),
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      progress: { message: 'Queued…' },
      error: null,
      summary: null,
      reportUrl: null
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this._persist();
    this._pump();
    return job;
  }

  deleteJob(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (ACTIVE_STATUSES.has(job.status)) {
      throw Object.assign(new Error('Cannot delete a job that is still queued or running.'), { statusCode: 409 });
    }
    this.jobs.delete(id);
    this._persist();
    rm(path.join(this.reportsDir, id), { recursive: true, force: true }).catch(() => {});
    return true;
  }

  _pump() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift();
      const job = this.jobs.get(id);
      if (!job) continue;
      this.activeCount++;
      this._execute(job).finally(() => {
        this.activeCount--;
        this._pump();
      });
    }
  }

  async _execute(job) {
    job.status = 'running';
    job.startedAt = Date.now();
    job.progress = { message: 'Starting…' };
    await this._persist();

    try {
      await this.assertPublicHostFn(job.url, { allowPrivate: this.allowPrivateTargets });

      const outputDir = path.join(this.reportsDir, job.id);
      const report = await this.runAuditFn({
        ...this.defaultConfig,
        ...job.options,
        url: job.url,
        outputDir,
        formats: ['html', 'json'],
        quiet: true,
        onStatus: (stage, detail) => {
          job.progress = { stage, ...detail };
        }
      });

      job.status = 'done';
      job.summary = buildSummary(report);
      job.reportUrl = `/reports/${job.id}/report.html`;
    } catch (error) {
      job.status = 'error';
      job.error = error.message;
    } finally {
      job.finishedAt = Date.now();
      job.progress = null;
      await this._persist();
      await this._pruneHistory();
    }
  }

  async _pruneHistory() {
    const finished = [...this.jobs.values()]
      .filter((j) => !ACTIVE_STATUSES.has(j.status))
      .sort((a, b) => b.finishedAt - a.finishedAt);
    const toRemove = finished.slice(this.maxHistory);
    for (const job of toRemove) {
      this.jobs.delete(job.id);
      rm(path.join(this.reportsDir, job.id), { recursive: true, force: true }).catch(() => {});
    }
    if (toRemove.length) await this._persist();
  }

  // Serialize writes so concurrent status changes can't interleave and
  // corrupt the file; write-to-temp-then-rename keeps a crash from ever
  // leaving a half-written JSON file behind.
  _persist() {
    this._persistPromise = this._persistPromise.then(() => this._writeNow()).catch(() => {});
    return this._persistPromise;
  }

  /** Resolves once every persistence write queued so far has completed. */
  flush() {
    return this._persistPromise;
  }

  async _writeNow() {
    const tmpFile = `${this.dataFile}.tmp`;
    await writeFile(tmpFile, JSON.stringify([...this.jobs.values()], null, 2), 'utf-8');
    await rename(tmpFile, this.dataFile);
  }
}
