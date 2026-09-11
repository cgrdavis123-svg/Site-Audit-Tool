import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { crawlSite } from '../src/crawler.js';

// A hub page that links to many children, used to make sure maxPages is an
// exact cap even under concurrency (regression test: pages.size was only
// incremented after each fetch completed, so concurrent siblings discovered
// via the hub could all pass a stale check and overshoot the limit).
function startFixtureServer(childCount) {
  const links = Array.from({ length: childCount }, (_, i) => `<a href="/child-${i}">child ${i}</a>`).join('');
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url;
      if (url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><body><h1>Hub</h1>${links}</body></html>`);
      } else if (/^\/child-\d+$/.test(url)) {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><body><h1>Child ${url}</h1></body></html>`);
      } else if (url === '/robots.txt' || url === '/sitemap.xml' || url === '/sitemap_index.xml') {
        res.writeHead(404);
        res.end('not found');
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('crawlSite caps total scheduled pages at maxPages even with high concurrency', async () => {
  const server = await startFixtureServer(30);
  const port = server.address().port;
  try {
    const result = await crawlSite(`http://127.0.0.1:${port}/`, {
      maxPages: 5,
      concurrency: 10,
      useSitemap: false,
      respectRobots: false,
      timeout: 5000
    });
    assert.equal(result.pages.size, 5);
    assert.equal(result.stats.hitPageLimit, true);
  } finally {
    server.close();
  }
});

test('crawlSite crawls every page when under the limit', async () => {
  const server = await startFixtureServer(3);
  const port = server.address().port;
  try {
    const result = await crawlSite(`http://127.0.0.1:${port}/`, {
      maxPages: 100,
      concurrency: 5,
      useSitemap: false,
      respectRobots: false,
      timeout: 5000
    });
    assert.equal(result.pages.size, 4); // hub + 3 children
    assert.equal(result.stats.hitPageLimit, false);
  } finally {
    server.close();
  }
});

test('crawlSite respects maxDepth', async () => {
  const server = await startFixtureServer(3);
  const port = server.address().port;
  try {
    const result = await crawlSite(`http://127.0.0.1:${port}/`, {
      maxPages: 100,
      maxDepth: 0,
      useSitemap: false,
      respectRobots: false,
      timeout: 5000
    });
    assert.equal(result.pages.size, 1); // only the hub page itself
  } finally {
    server.close();
  }
});
