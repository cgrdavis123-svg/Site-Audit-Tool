import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScores } from '../src/scoring.js';
import { issue, SEVERITY } from '../src/checks/helpers.js';

test('computeScores returns 100 for every category with no issues', () => {
  const scores = computeScores([], { pageCount: 10, skippedCategories: [] });
  assert.equal(scores.overall, 100);
  for (const cat of Object.values(scores.categories)) {
    assert.equal(cat.score, 100);
  }
});

test('computeScores lowers category score proportionally to severity', () => {
  const issues = [
    issue({ category: 'security', severity: SEVERITY.CRITICAL, id: 'x', title: 't', description: 'd', recommendation: 'r', url: 'https://a.com' })
  ];
  const scores = computeScores(issues, { pageCount: 1, skippedCategories: [] });
  assert.ok(scores.categories.security.score < 100);
  assert.equal(scores.categories.seo.score, 100);
});

test('computeScores excludes skipped categories from the overall weighted average', () => {
  const scores = computeScores([], { pageCount: 1, skippedCategories: ['accessibility'] });
  assert.equal(scores.categories.accessibility.skipped, true);
  assert.equal(scores.overall, 100);
});

test('computeScores never goes below 0 or above 100', () => {
  const manyIssues = Array.from({ length: 50 }, () =>
    issue({ category: 'seo', severity: SEVERITY.CRITICAL, id: 'x', title: 't', description: 'd', recommendation: 'r' }));
  const scores = computeScores(manyIssues, { pageCount: 1, skippedCategories: [] });
  assert.ok(scores.categories.seo.score >= 0);
  assert.ok(scores.categories.seo.score <= 100);
});

test('computeScores weighs issues affecting more pages more heavily', () => {
  const narrow = [issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'x', title: 't', description: 'd', recommendation: 'r', meta: { urls: ['a'] } })];
  const wide = [issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'x', title: 't', description: 'd', recommendation: 'r', meta: { urls: ['a', 'b', 'c', 'd', 'e'] } })];
  const scoreNarrow = computeScores(narrow, { pageCount: 10, skippedCategories: [] }).categories.seo.score;
  const scoreWide = computeScores(wide, { pageCount: 10, skippedCategories: [] }).categories.seo.score;
  assert.ok(scoreWide < scoreNarrow);
});
