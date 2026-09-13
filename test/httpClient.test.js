import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchUrl } from '../src/httpClient.js';

test('fetchUrl surfaces a DNS failure cause instead of a bare "fetch failed"', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('getaddrinfo ENOTFOUND www.example-does-not-exist.invalid');
    throw err;
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await fetchUrl('https://www.example-does-not-exist.invalid/', { retries: 0 });
  assert.equal(result.ok, false);
  assert.match(result.error.message, /ENOTFOUND/);
  assert.notEqual(result.error.message, 'fetch failed');
});

test('fetchUrl surfaces every attempt from an AggregateError (IPv6-then-IPv4 failure)', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = new AggregateError([
      Object.assign(new Error('connect ETIMEDOUT 2606:4700::1:443'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' })
    ], 'connection attempts failed');
    throw err;
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await fetchUrl('https://flaky.example/', { retries: 0 });
  assert.match(result.error.message, /ETIMEDOUT/);
  assert.match(result.error.message, /ECONNREFUSED/);
});

test('fetchUrl surfaces a TLS/certificate failure cause', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = new Error('certificate has expired');
    throw err;
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await fetchUrl('https://expired.example/', { retries: 0 });
  assert.match(result.error.message, /certificate has expired/);
});

test('fetchUrl still reports a timeout distinctly from other network errors', async (t) => {
  const originalFetch = global.fetch;
  // Never resolves on its own; rely on the AbortSignal to reject, like a
  // real hung connection would.
  global.fetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
  t.after(() => { global.fetch = originalFetch; });

  const result = await fetchUrl('https://slow.example/', { retries: 0, timeout: 20 });
  assert.match(result.error.message, /timed out/);
});

test('fetchUrl falls back to the raw error message when there is no cause chain', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('something unexpected');
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await fetchUrl('https://example.com/', { retries: 0 });
  assert.equal(result.error.message, 'something unexpected');
});
