import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtmlPage } from '../src/pageParser.js';
import { checkSeoPage, checkSeoSite } from '../src/checks/seo.js';
import { checkTechnicalPage, checkTechnicalSite } from '../src/checks/technical.js';
import { checkSecurityPage } from '../src/checks/security.js';
import { checkContentPage } from '../src/checks/content.js';
import { checkLinksSite } from '../src/checks/links.js';

function makePage(url, html, overrides = {}) {
  return parseHtmlPage({
    pageUrl: url,
    html,
    headers: overrides.headers || {},
    status: overrides.status ?? 200,
    elapsedMs: overrides.elapsedMs ?? 100,
    sizeBytes: overrides.sizeBytes ?? html.length,
    redirectChain: overrides.redirectChain ?? []
  });
}

test('checkSeoPage flags missing title, description, h1, alt text', () => {
  const page = makePage('https://example.com/', '<html><body><img src="a.png"></body></html>');
  const issues = checkSeoPage(page);
  const ids = issues.map((i) => i.id);
  assert.ok(ids.includes('missing-title'));
  assert.ok(ids.includes('missing-meta-description'));
  assert.ok(ids.includes('missing-h1'));
  assert.ok(ids.includes('images-missing-alt'));
  assert.ok(ids.includes('missing-canonical'));
  assert.ok(ids.includes('missing-lang'));
});

test('checkSeoPage does not flag a well-formed page', () => {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
    <title>A perfectly reasonable page title</title>
    <meta name="description" content="${'x'.repeat(120)}">
    <link rel="canonical" href="https://example.com/">
    <meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i">
    </head><body><h1>Heading</h1><img src="a.png" alt="desc"></body></html>`;
  const page = makePage('https://example.com/', html);
  const issues = checkSeoPage(page);
  const ids = issues.map((i) => i.id);
  assert.ok(!ids.includes('missing-title'));
  assert.ok(!ids.includes('missing-meta-description'));
  assert.ok(!ids.includes('missing-h1'));
  assert.ok(!ids.includes('images-missing-alt'));
  assert.ok(!ids.includes('missing-canonical'));
});

test('checkSeoPage flags multiple H1s', () => {
  const page = makePage('https://example.com/', '<html><body><h1>One</h1><h1>Two</h1></body></html>');
  const ids = checkSeoPage(page).map((i) => i.id);
  assert.ok(ids.includes('multiple-h1'));
});

test('checkSeoSite flags duplicate titles across pages', () => {
  const p1 = makePage('https://example.com/a', '<html><head><title>Same Title Here</title></head><body>content</body></html>');
  const p2 = makePage('https://example.com/b', '<html><head><title>Same Title Here</title></head><body>content</body></html>');
  const issues = checkSeoSite([p1, p2]);
  assert.ok(issues.some((i) => i.id === 'duplicate-title'));
});

test('checkTechnicalPage flags server errors and missing viewport/charset', () => {
  const page = makePage('https://example.com/', '<html><body>hi</body></html>');
  const ids = checkTechnicalPage(page).map((i) => i.id);
  assert.ok(ids.includes('missing-viewport'));
  assert.ok(ids.includes('missing-charset'));
  assert.ok(ids.includes('missing-doctype'));
});

test('checkTechnicalPage flags 5xx and 4xx as critical/high', () => {
  const errorPage = { url: 'https://example.com/broken', status: 500, ok: false, redirectChain: [] };
  const issues = checkTechnicalPage(errorPage);
  assert.equal(issues[0].id, 'server-error');
  assert.equal(issues[0].severity, 'critical');
});

test('checkTechnicalPage flags long redirect chains', () => {
  const page = makePage('https://example.com/final', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="w"></head><body>hi</body></html>', {
    redirectChain: [{ url: 'a' }, { url: 'b' }, { url: 'c' }]
  });
  const ids = checkTechnicalPage(page).map((i) => i.id);
  assert.ok(ids.includes('long-redirect-chain'));
});

test('checkTechnicalSite does not treat an empty Disallow as blocking everything', () => {
  const issues = checkTechnicalSite({
    robots: { exists: true, url: 'https://example.com/robots.txt', groups: [{ agents: ['*'], rules: [{ type: 'disallow', path: '' }] }], sitemaps: ['https://example.com/sitemap.xml'] },
    sitemaps: { discovered: ['https://example.com/sitemap.xml'], urls: [], errors: [] },
    origin: 'https://example.com'
  });
  assert.ok(!issues.some((i) => i.id === 'robots-disallows-all'));
});

test('checkTechnicalSite flags a real blanket Disallow: / for the wildcard agent', () => {
  const issues = checkTechnicalSite({
    robots: { exists: true, url: 'https://example.com/robots.txt', groups: [{ agents: ['*'], rules: [{ type: 'disallow', path: '/' }] }], sitemaps: [] },
    sitemaps: { discovered: [], urls: [], errors: [] },
    origin: 'https://example.com'
  });
  assert.ok(issues.some((i) => i.id === 'robots-disallows-all'));
});

test('checkTechnicalSite flags missing robots.txt and sitemap', () => {
  const issues = checkTechnicalSite({
    robots: { exists: false, groups: [], sitemaps: [] },
    sitemaps: { discovered: [], urls: [], errors: [] },
    origin: 'https://example.com'
  });
  const ids = issues.map((i) => i.id);
  assert.ok(ids.includes('missing-robots-txt'));
  assert.ok(ids.includes('missing-sitemap'));
});

test('checkSecurityPage flags plain HTTP and missing security headers', () => {
  const page = makePage('http://example.com/', '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>hi</body></html>');
  const ids = checkSecurityPage(page).map((i) => i.id);
  assert.ok(ids.includes('no-https'));
});

test('checkSecurityPage flags missing HSTS/CSP on HTTPS pages', () => {
  const page = makePage('https://example.com/', '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>hi</body></html>');
  const ids = checkSecurityPage(page).map((i) => i.id);
  assert.ok(ids.includes('missing-hsts'));
  assert.ok(ids.includes('missing-csp'));
});

test('checkSecurityPage flags target=_blank without rel=noopener', () => {
  const page = makePage('https://example.com/', '<a href="https://x.com" target="_blank">x</a>');
  const ids = checkSecurityPage(page).map((i) => i.id);
  assert.ok(ids.includes('target-blank-no-noopener'));
});

test('checkContentPage flags thin content', () => {
  const page = makePage('https://example.com/', '<html><body><p>Too short.</p></body></html>');
  const ids = checkContentPage(page).map((i) => i.id);
  assert.ok(ids.includes('thin-content'));
});

test('checkLinksSite flags broken internal links', () => {
  const linkGraph = new Map([['https://example.com/missing', new Set(['https://example.com/'])]]);
  const pages = new Map([['https://example.com/missing', { status: 404, ok: false }]]);
  const issues = checkLinksSite({ pages, linkGraph, linkStatuses: new Map(), startUrl: 'https://example.com/' });
  assert.ok(issues.some((i) => i.id === 'broken-internal-link'));
});
