import { SEVERITY_WEIGHT } from './checks/helpers.js';

const CATEGORY_WEIGHTS = {
  seo: 20,
  technical: 20,
  security: 20,
  performance: 15,
  accessibility: 15,
  content: 5,
  links: 5
};

const CATEGORY_LABELS = {
  seo: 'SEO',
  technical: 'Technical',
  security: 'Security',
  performance: 'Performance',
  accessibility: 'Accessibility',
  content: 'Content',
  links: 'Links'
};

function issueImpact(iss) {
  const affected = iss.meta?.urls?.length || iss.meta?.sources?.length || 1;
  return SEVERITY_WEIGHT[iss.severity] * Math.min(affected, 10);
}

/**
 * Compute per-category (0-100) and an overall weighted score from the
 * full list of issues found across the crawl. Categories with no data
 * (e.g. accessibility skipped because playwright isn't installed) are
 * excluded and their weight redistributed across the remaining categories.
 */
export function computeScores(issues, { pageCount = 1, skippedCategories = [] } = {}) {
  const byCategory = {};
  for (const category of Object.keys(CATEGORY_WEIGHTS)) {
    byCategory[category] = { issues: [], totalImpact: 0 };
  }
  for (const iss of issues) {
    if (!byCategory[iss.category]) byCategory[iss.category] = { issues: [], totalImpact: 0 };
    byCategory[iss.category].issues.push(iss);
    byCategory[iss.category].totalImpact += issueImpact(iss);
  }

  const activeCategories = Object.keys(CATEGORY_WEIGHTS).filter((c) => !skippedCategories.includes(c));
  const totalActiveWeight = activeCategories.reduce((sum, c) => sum + CATEGORY_WEIGHTS[c], 0);

  const categories = {};
  let overall = 0;

  for (const category of activeCategories) {
    const data = byCategory[category] || { issues: [], totalImpact: 0 };
    const avgImpactPerPage = data.totalImpact / Math.max(1, pageCount);
    const score = Math.max(0, Math.min(100, Math.round(100 - avgImpactPerPage)));
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const iss of data.issues) counts[iss.severity] = (counts[iss.severity] || 0) + 1;

    categories[category] = {
      label: CATEGORY_LABELS[category] || category,
      score,
      issueCount: data.issues.length,
      counts,
      weight: CATEGORY_WEIGHTS[category]
    };
    overall += score * (CATEGORY_WEIGHTS[category] / totalActiveWeight);
  }

  for (const category of skippedCategories) {
    categories[category] = {
      label: CATEGORY_LABELS[category] || category,
      score: null,
      issueCount: 0,
      counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      weight: 0,
      skipped: true
    };
  }

  const totalCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const iss of issues) totalCounts[iss.severity] = (totalCounts[iss.severity] || 0) + 1;

  return {
    overall: Math.round(overall),
    categories,
    totalIssues: issues.length,
    totalCounts
  };
}
