import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSitemap } from '../src/sitemap.js';

const URLSET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc><lastmod>2024-01-01</lastmod></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;

const INDEX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/xml']]),
    arrayBuffer: async () => Buffer.from(body, 'utf-8')
  };
}

function withHeadersInterface(res) {
  const map = res.headers;
  res.headers = { entries: () => map.entries(), get: (k) => map.get(k) ?? null };
  return res;
}

test('loadSitemap parses a flat urlset', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => withHeadersInterface(fakeResponse(URLSET_XML));
  t.after(() => { global.fetch = originalFetch; });

  const { urls, errors } = await loadSitemap('https://example.com/sitemap.xml');
  assert.equal(errors.length, 0);
  assert.equal(urls.length, 2);
  assert.equal(urls[0].url, 'https://example.com/');
  assert.equal(urls[0].lastmod, '2024-01-01');
});

test('loadSitemap recurses into a sitemap index', async (t) => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call++;
    return withHeadersInterface(fakeResponse(call === 1 ? INDEX_XML : URLSET_XML));
  };
  t.after(() => { global.fetch = originalFetch; });

  const { urls, errors } = await loadSitemap('https://example.com/sitemap_index.xml');
  assert.equal(errors.length, 0);
  assert.equal(urls.length, 2);
  assert.equal(call, 2);
});

test('loadSitemap reports errors for invalid XML', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => withHeadersInterface(fakeResponse('not xml at all <<<'));
  t.after(() => { global.fetch = originalFetch; });

  const { urls, errors } = await loadSitemap('https://example.com/sitemap.xml');
  assert.equal(urls.length, 0);
  assert.equal(errors.length, 1);
});

test('loadSitemap reports errors for unreachable sitemaps', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => withHeadersInterface(fakeResponse('', { ok: false, status: 404 }));
  t.after(() => { global.fetch = originalFetch; });

  const { urls, errors } = await loadSitemap('https://example.com/sitemap.xml');
  assert.equal(urls.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].status, 404);
});
