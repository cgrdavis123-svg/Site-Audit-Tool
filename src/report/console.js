import { colorize } from '../utils/logger.js';

const SEVERITY_COLOR = { critical: 'red', high: 'red', medium: 'yellow', low: 'cyan', info: 'gray' };
const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

function scoreColor(score) {
  if (score === null) return 'gray';
  if (score >= 90) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

function bar(score, width = 20) {
  if (score === null) return colorize('n/a'.padEnd(width), 'gray');
  const filled = Math.round((score / 100) * width);
  return colorize('█'.repeat(filled), scoreColor(score)) + colorize('░'.repeat(width - filled), 'gray');
}

/** Render a human-readable summary of the audit report to stdout. */
export function printConsoleReport(report) {
  const { meta, scores, topIssues } = report;
  const lines = [];

  lines.push('');
  lines.push(colorize('━'.repeat(60), 'gray'));
  lines.push(colorize(`  Site Audit Report — ${meta.startUrl}`, 'bold'));
  lines.push(colorize(`  ${meta.pagesCrawled} page(s) crawled in ${(meta.durationMs / 1000).toFixed(1)}s`, 'dim'));
  lines.push(colorize('━'.repeat(60), 'gray'));
  lines.push('');
  lines.push(`  ${colorize('Overall Score', 'bold')}: ${colorize(String(scores.overall), scoreColor(scores.overall))}/100  ${bar(scores.overall)}`);
  lines.push('');

  for (const [key, cat] of Object.entries(scores.categories)) {
    const scoreStr = cat.skipped ? colorize('skipped', 'gray') : `${String(cat.score).padStart(3)}/100`;
    lines.push(`  ${cat.label.padEnd(15)} ${scoreStr}  ${bar(cat.score, 24)}  ${colorize(`${cat.issueCount} issue(s)`, 'dim')}`);
  }

  lines.push('');
  lines.push(`  ${colorize('Issues by severity:', 'bold')}`);
  const counts = scores.totalCounts;
  lines.push(
    '  ' +
      SEVERITY_ORDER.map((sev) => colorize(`${sev}: ${counts[sev] || 0}`, SEVERITY_COLOR[sev])).join('   ')
  );

  if (topIssues.length) {
    lines.push('');
    lines.push(`  ${colorize('Top issues:', 'bold')}`);
    for (const iss of topIssues.slice(0, 15)) {
      lines.push(`  ${colorize(`[${iss.severity}]`, SEVERITY_COLOR[iss.severity]).padEnd(20)} ${iss.title}`);
      if (iss.url) lines.push(`      ${colorize(iss.url, 'dim')}`);
    }
  }

  if (meta.warnings?.length) {
    lines.push('');
    for (const w of meta.warnings) lines.push(`  ${colorize('⚠', 'yellow')} ${w}`);
  }

  lines.push('');
  console.log(lines.join('\n'));
}
