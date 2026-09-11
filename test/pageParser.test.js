import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlPage } from '../src/pageParser.js';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Example Page Title That Is Fine</title>
  <meta name="description" content="A reasonably sized meta description used for testing purposes here.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/page">
  <meta property="og:title" content="Example">
  <meta property="og:description" content="Example description">
  <meta property="og:image" content="https://example.com/img.png">
  <script type="application/ld+json">{"@type": "WebPage"}</script>
</head>
<body>
  <h1>Main Heading</h1>
  <h2>Sub heading</h2>
  <p>Some body text with a decent number of words to avoid thin content warnings in other tests.</p>
  <img src="/a.png" alt="An image">
  <img src="/b.png">
  <a href="/internal-page" rel="nofollow">Internal link</a>
  <a href="https://external.com/page" target="_blank">External</a>
  <a href="http://insecure.com/x">Insecure</a>
</body>
</html>`;

test('parseHtmlPage extracts title, meta, canonical, headings', () => {
  const page = parseHtmlPage({ pageUrl: 'https://example.com/page', html: HTML, headers: {}, status: 200, elapsedMs: 50, sizeBytes: HTML.length });
  assert.equal(page.title, 'Example Page Title That Is Fine');
  assert.ok(page.metaDescriptionLength > 0);
  assert.equal(page.canonical, 'https://example.com/page');
  assert.equal(page.isSelfCanonical, true);
  assert.equal(page.headings.h1.length, 1);
  assert.equal(page.headings.h2.length, 1);
  assert.equal(page.lang, 'en');
  assert.equal(page.charset, 'utf-8');
  assert.ok(page.viewport.includes('width=device-width'));
});

test('parseHtmlPage extracts images with alt info', () => {
  const page = parseHtmlPage({ pageUrl: 'https://example.com/page', html: HTML, headers: {}, status: 200, elapsedMs: 50, sizeBytes: HTML.length });
  assert.equal(page.images.length, 2);
  assert.equal(page.images[0].hasAlt, true);
  assert.equal(page.images[1].hasAlt, false);
});

test('parseHtmlPage extracts links with rel and target info', () => {
  const page = parseHtmlPage({ pageUrl: 'https://example.com/page', html: HTML, headers: {}, status: 200, elapsedMs: 50, sizeBytes: HTML.length });
  const internal = page.links.find((l) => l.href === '/internal-page');
  assert.equal(internal.isNoFollow, true);
  assert.equal(internal.absoluteUrl, 'https://example.com/internal-page');
  const external = page.links.find((l) => l.href.includes('external.com'));
  assert.equal(external.target, '_blank');
});

test('parseHtmlPage flags mixed content only on https pages', () => {
  const page = parseHtmlPage({ pageUrl: 'https://example.com/page', html: '<img src="http://insecure.com/a.png">', headers: {}, status: 200, elapsedMs: 10, sizeBytes: 10 });
  assert.equal(page.mixedContentUrls.length, 1);
  const httpPage = parseHtmlPage({ pageUrl: 'http://example.com/page', html: '<img src="http://insecure.com/a.png">', headers: {}, status: 200, elapsedMs: 10, sizeBytes: 10 });
  assert.equal(httpPage.mixedContentUrls.length, 0);
});

test('parseHtmlPage parses valid and invalid JSON-LD', () => {
  const withBadJson = `<script type="application/ld+json">{not valid json}</script>`;
  const page = parseHtmlPage({ pageUrl: 'https://example.com/page', html: withBadJson, headers: {}, status: 200, elapsedMs: 10, sizeBytes: 10 });
  assert.equal(page.structuredData.length, 1);
  assert.equal(page.structuredData[0].valid, false);
});

test('parseHtmlPage computes word count and text-to-html ratio', () => {
  const page = parseHtmlPage({ pageUrl: 'https://example.com/page', html: HTML, headers: {}, status: 200, elapsedMs: 10, sizeBytes: HTML.length });
  assert.ok(page.wordCount > 5);
  assert.ok(page.textToHtmlRatio > 0 && page.textToHtmlRatio < 1);
});
