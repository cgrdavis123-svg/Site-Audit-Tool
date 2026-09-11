import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, isSameOrigin, looksLikeAsset, matchesPatterns, isCrawlableScheme } from '../src/utils/url.js';

test('normalizeUrl resolves relative URLs against a base', () => {
  assert.equal(normalizeUrl('/about', 'https://example.com/'), 'https://example.com/about');
  assert.equal(normalizeUrl('page.html', 'https://example.com/blog/'), 'https://example.com/blog/page.html');
});

test('normalizeUrl strips fragments and trailing slashes', () => {
  assert.equal(normalizeUrl('https://example.com/about/#section', 'https://example.com/'), 'https://example.com/about');
  assert.equal(normalizeUrl('https://example.com/', 'https://example.com/'), 'https://example.com/');
});

test('normalizeUrl lower-cases the hostname', () => {
  assert.equal(normalizeUrl('https://ExAmple.COM/Path', 'https://example.com/'), 'https://example.com/Path');
});

test('normalizeUrl rejects non-http(s) schemes', () => {
  assert.equal(normalizeUrl('mailto:test@example.com', 'https://example.com/'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://example.com/'), null);
});

test('normalizeUrl returns null for invalid input', () => {
  assert.equal(normalizeUrl(null, 'https://example.com/'), null);
  assert.equal(normalizeUrl('http://[not-valid-ipv6', 'https://example.com/'), null);
});

test('isSameOrigin respects exact host by default', () => {
  assert.equal(isSameOrigin('https://example.com/x', 'https://example.com/'), true);
  assert.equal(isSameOrigin('https://blog.example.com/x', 'https://example.com/'), false);
});

test('isSameOrigin allows subdomains when requested', () => {
  assert.equal(isSameOrigin('https://blog.example.com/x', 'https://example.com/', { includeSubdomains: true }), true);
  assert.equal(isSameOrigin('https://evil-example.com/x', 'https://example.com/', { includeSubdomains: true }), false);
});

test('looksLikeAsset detects static file extensions', () => {
  assert.equal(looksLikeAsset('https://example.com/logo.png'), true);
  assert.equal(looksLikeAsset('https://example.com/style.css?v=2'), true);
  assert.equal(looksLikeAsset('https://example.com/about'), false);
});

test('matchesPatterns supports substrings and regex', () => {
  assert.equal(matchesPatterns('https://example.com/blog/post-1', ['/blog/']), true);
  assert.equal(matchesPatterns('https://example.com/blog/post-1', [/post-\d+/]), true);
  assert.equal(matchesPatterns('https://example.com/about', ['/blog/']), false);
});

test('isCrawlableScheme accepts only http/https', () => {
  assert.equal(isCrawlableScheme('https://example.com'), true);
  assert.equal(isCrawlableScheme('mailto:a@b.com'), false);
});
