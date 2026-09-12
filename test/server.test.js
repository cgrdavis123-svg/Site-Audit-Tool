import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

function fakeJobManager(overrides = {}) {
  const jobs = new Map();
  return {
    list: () => [...jobs.values()],
    get: (id) => jobs.get(id),
    createJob: ({ url }) => {
      if (!/^https?:\/\//.test(url || '')) {
        throw Object.assign(new Error('Please enter a valid URL, including http:// or https://.'), { statusCode: 400 });
      }
      const job = { id: 'job-1', url, status: 'queued', createdAt: Date.now() };
      jobs.set(job.id, job);
      return job;
    },
    deleteJob: (id) => {
      const job = jobs.get(id);
      if (job?.status === 'running') throw Object.assign(new Error('Cannot delete a job that is still queued or running.'), { statusCode: 409 });
      jobs.delete(id);
      return true;
    },
    ...overrides
  };
}

async function startServer(appOptions) {
  const app = createApp({ publicDir, reportsDir: publicDir, jobManager: fakeJobManager(), ...appOptions });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('GET / serves the dashboard when no token is configured', async () => {
  const server = await startServer({ token: null });
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /Site Audit Dashboard/);
  } finally {
    server.close();
  }
});

test('POST /api/audits creates a job and GET fetches it back', async () => {
  const server = await startServer({ token: null });
  try {
    const port = server.address().port;
    const createRes = await fetch(`http://127.0.0.1:${port}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    });
    assert.equal(createRes.status, 201);
    const job = await createRes.json();
    assert.equal(job.url, 'https://example.com');

    const getRes = await fetch(`http://127.0.0.1:${port}/api/audits/${job.id}`);
    assert.equal(getRes.status, 200);
    const fetched = await getRes.json();
    assert.equal(fetched.id, job.id);
  } finally {
    server.close();
  }
});

test('POST /api/audits rejects an invalid URL with 400', async () => {
  const server = await startServer({ token: null });
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/audits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not-a-url' })
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /valid URL/);
  } finally {
    server.close();
  }
});

test('GET /api/audits/:id returns 404 for an unknown job', async () => {
  const server = await startServer({ token: null });
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/audits/does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test('API routes require the configured token', async () => {
  const server = await startServer({ token: 'secret123' });
  try {
    const port = server.address().port;
    const unauthed = await fetch(`http://127.0.0.1:${port}/api/audits`);
    assert.equal(unauthed.status, 401);

    const withHeader = await fetch(`http://127.0.0.1:${port}/api/audits`, {
      headers: { 'X-Dashboard-Token': 'secret123' }
    });
    assert.equal(withHeader.status, 200);

    const withWrongHeader = await fetch(`http://127.0.0.1:${port}/api/audits`, {
      headers: { 'X-Dashboard-Token': 'wrong' }
    });
    assert.equal(withWrongHeader.status, 401);
  } finally {
    server.close();
  }
});

test('GET / serves the login page when a token is required and not provided', async () => {
  const server = await startServer({ token: 'secret123' });
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/`);
    const body = await res.text();
    assert.match(body, /Sign in/);
  } finally {
    server.close();
  }
});

test('POST /api/login sets a cookie that authenticates subsequent requests', async () => {
  const server = await startServer({ token: 'secret123' });
  try {
    const port = server.address().port;
    const loginRes = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'secret123' })
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.headers.get('set-cookie');
    assert.match(cookie, /dashboard_token=secret123/);

    const rawCookie = cookie.split(';')[0];
    const apiRes = await fetch(`http://127.0.0.1:${port}/api/audits`, {
      headers: { Cookie: rawCookie }
    });
    assert.equal(apiRes.status, 200);
  } finally {
    server.close();
  }
});

test('POST /api/login rejects an incorrect token', async () => {
  const server = await startServer({ token: 'secret123' });
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong' })
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test('DELETE /api/audits/:id surfaces the manager error status code', async () => {
  const jobManager = fakeJobManager();
  jobManager.deleteJob = () => { throw Object.assign(new Error('Cannot delete a job that is still queued or running.'), { statusCode: 409 }); };
  const app = createApp({ publicDir, reportsDir: publicDir, jobManager, token: null });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/audits/job-1`, { method: 'DELETE' });
    assert.equal(res.status, 409);
  } finally {
    server.close();
  }
});
