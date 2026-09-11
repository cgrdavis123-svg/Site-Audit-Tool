import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt, isAllowedByRobots } from '../src/robots.js';

const SAMPLE = `
User-agent: *
Disallow: /admin
Disallow: /private/
Allow: /private/public-page
Crawl-delay: 2

User-agent: Googlebot
Disallow:

Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-news.xml
`;

test('parseRobotsTxt extracts groups and sitemaps', () => {
  const parsed = parseRobotsTxt(SAMPLE);
  assert.equal(parsed.sitemaps.length, 2);
  assert.equal(parsed.groups.length, 2);
  assert.deepEqual(parsed.groups[0].agents, ['*']);
  assert.equal(parsed.groups[0].crawlDelay, 2);
});

test('isAllowedByRobots blocks disallowed paths for the wildcard agent', () => {
  const parsed = parseRobotsTxt(SAMPLE);
  assert.equal(isAllowedByRobots(parsed, '/admin/users', '*'), false);
  assert.equal(isAllowedByRobots(parsed, '/private/secret', '*'), false);
  assert.equal(isAllowedByRobots(parsed, '/about', '*'), true);
});

test('isAllowedByRobots lets a more specific Allow rule win', () => {
  const parsed = parseRobotsTxt(SAMPLE);
  assert.equal(isAllowedByRobots(parsed, '/private/public-page', '*'), true);
});

test('isAllowedByRobots uses agent-specific group when present', () => {
  const parsed = parseRobotsTxt(SAMPLE);
  assert.equal(isAllowedByRobots(parsed, '/admin/users', 'Googlebot'), true);
});

test('parseRobotsTxt handles an empty document permissively', () => {
  const parsed = parseRobotsTxt('');
  assert.equal(isAllowedByRobots(parsed, '/anything', '*'), true);
});
