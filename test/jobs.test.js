import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JobManager } from '../src/jobs.js';

async function makeManager(overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'site-audit-jobs-'));
  const manager = new JobManager({
    reportsDir: path.join(dir, 'reports'),
    dataFile: path.join(dir, 'jobs.json'),
    concurrency: 1,
    assertPublicHostFn: async () => {},
    runAuditFn: async () => ({
      scores: { overall: 88, categories: {}, totalIssues: 3, totalCounts: {} },
      meta: { pagesCrawled: 5, pagesLimitHit: false, durationMs: 10, warnings: [] }
    }),
    ...overrides
  });
  await manager.init();
  return { manager, dir };
}

function waitFor(fn, timeoutMs = 2000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, 10);
    };
    tick();
  });
}

test('createJob rejects invalid URLs', async () => {
  const { manager, dir } = await makeManager();
  try {
    assert.throws(() => manager.createJob({ url: 'not a url', options: {} }), /valid URL/);
    assert.throws(() => manager.createJob({ url: 'ftp://example.com', options: {} }), /http/);
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('createJob runs a job to completion and records a summary', async () => {
  const { manager, dir } = await makeManager();
  try {
    const job = manager.createJob({ url: 'https://example.com', options: {} });
    assert.ok(job.status === 'queued' || job.status === 'running');
    await waitFor(() => manager.get(job.id).status === 'done');
    const finished = manager.get(job.id);
    assert.equal(finished.summary.overall, 88);
    assert.equal(finished.reportUrl, `/reports/${job.id}/report.html`);
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a job that fails SSRF validation is marked as an error, not left running', async () => {
  const { manager, dir } = await makeManager({
    assertPublicHostFn: async () => { throw new Error('Refusing to audit a private/internal address'); }
  });
  try {
    const job = manager.createJob({ url: 'http://127.0.0.1/', options: {} });
    await waitFor(() => manager.get(job.id).status === 'error');
    assert.match(manager.get(job.id).error, /private\/internal/);
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('jobs run one at a time when concurrency is 1', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const { manager, dir } = await makeManager({
    runAuditFn: async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
      return { scores: { overall: 100, categories: {}, totalIssues: 0, totalCounts: {} }, meta: { pagesCrawled: 1, pagesLimitHit: false, durationMs: 1, warnings: [] } };
    }
  });
  try {
    const jobs = [
      manager.createJob({ url: 'https://a.example.com', options: {} }),
      manager.createJob({ url: 'https://b.example.com', options: {} }),
      manager.createJob({ url: 'https://c.example.com', options: {} })
    ];
    await waitFor(() => jobs.every((j) => manager.get(j.id).status === 'done'));
    assert.equal(maxConcurrent, 1);
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('sanitizeOptions clamps out-of-range values from untrusted input', async () => {
  const { manager, dir } = await makeManager();
  try {
    const job = manager.createJob({ url: 'https://example.com', options: { maxPages: 999999, maxDepth: -5 } });
    assert.equal(job.options.maxPages, 500);
    assert.equal(job.options.maxDepth, 0);
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('deleteJob refuses to remove an active job', async () => {
  const { manager, dir } = await makeManager({
    runAuditFn: () => new Promise((r) => setTimeout(() => r({
      scores: { overall: 100, categories: {}, totalIssues: 0, totalCounts: {} },
      meta: { pagesCrawled: 1, pagesLimitHit: false, durationMs: 1, warnings: [] }
    }), 200))
  });
  try {
    const job = manager.createJob({ url: 'https://example.com', options: {} });
    await waitFor(() => manager.get(job.id).status === 'running');
    assert.throws(() => manager.deleteJob(job.id), /still queued or running/);
    await waitFor(() => manager.get(job.id).status === 'done');
    assert.equal(manager.deleteJob(job.id), true);
    assert.equal(manager.get(job.id), undefined);
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});

test('init() marks jobs left running from a previous process as interrupted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'site-audit-jobs-'));
  const dataFile = path.join(dir, 'jobs.json');
  const reportsDir = path.join(dir, 'reports');
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify([
    { id: 'abc', url: 'https://example.com', options: {}, status: 'running', createdAt: 1, startedAt: 1, finishedAt: null, progress: {}, error: null, summary: null, reportUrl: null }
  ]));
  let manager;
  try {
    manager = new JobManager({ reportsDir, dataFile, assertPublicHostFn: async () => {}, runAuditFn: async () => ({}) });
    await manager.init();
    assert.equal(manager.get('abc').status, 'interrupted');
  } finally {
    await manager.flush();
    await rm(dir, { recursive: true, force: true });
  }
});
