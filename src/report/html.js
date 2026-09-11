import { writeFile } from 'node:fs/promises';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function scoreClass(score) {
  if (score === null || score === undefined) return 'na';
  if (score >= 90) return 'good';
  if (score >= 50) return 'warn';
  return 'bad';
}

function circularGauge(score, size = 140) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const value = score ?? 0;
  const offset = circumference * (1 - value / 100);
  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="gauge gauge-${scoreClass(score)}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" class="gauge-track" stroke-width="12" fill="none" />
    <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" class="gauge-fill" stroke-width="12" fill="none"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
      transform="rotate(-90 ${size / 2} ${size / 2})" />
    <text x="50%" y="50%" class="gauge-text" dominant-baseline="middle" text-anchor="middle">${score ?? '–'}</text>
  </svg>`;
}

function categoryCards(categories) {
  return Object.entries(categories).map(([key, cat]) => `
    <div class="card category-card">
      <div class="category-card-head">
        <span class="category-name">${esc(cat.label)}</span>
        <span class="category-score sc-${scoreClass(cat.score)}">${cat.skipped ? 'N/A' : cat.score}</span>
      </div>
      <div class="meter"><div class="meter-fill sc-${scoreClass(cat.score)}" style="width:${cat.skipped ? 0 : cat.score}%"></div></div>
      <div class="category-meta">
        ${cat.skipped ? '<span class="pill pill-gray">skipped</span>' : `
          <span class="pill pill-critical">${cat.counts.critical || 0} critical</span>
          <span class="pill pill-high">${cat.counts.high || 0} high</span>
          <span class="pill pill-medium">${cat.counts.medium || 0} medium</span>
          <span class="pill pill-low">${cat.counts.low || 0} low</span>
        `}
      </div>
    </div>`).join('');
}

function issuesTableRows(issues) {
  return issues.map((iss, i) => `
    <tr data-category="${esc(iss.category)}" data-severity="${esc(iss.severity)}" data-idx="${i}">
      <td><span class="badge badge-${esc(iss.severity)}">${esc(iss.severity)}</span></td>
      <td class="cat-cell">${esc(iss.category)}</td>
      <td>
        <div class="issue-title">${esc(iss.title)}</div>
        <div class="issue-desc">${esc(iss.description)}</div>
        <div class="issue-rec">💡 ${esc(iss.recommendation)}</div>
        ${iss.url ? `<div class="issue-url"><a href="${esc(iss.url)}" target="_blank" rel="noopener">${esc(iss.url)}</a></div>` : ''}
      </td>
    </tr>`).join('');
}

function pagesTableRows(pages) {
  return pages.map((p) => `
    <tr>
      <td class="url-cell"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></td>
      <td>${p.status ?? '–'}</td>
      <td>${esc(p.title || '—')}</td>
      <td>${p.wordCount ?? 0}</td>
      <td>${p.elapsedMs ? Math.round(p.elapsedMs) + 'ms' : '–'}</td>
      <td><span class="badge badge-${p.issueCount > 5 ? 'high' : p.issueCount > 0 ? 'medium' : 'info'}">${p.issueCount}</span></td>
    </tr>`).join('');
}

const STYLE = `
:root {
  --bg: #f7f8fa; --surface: #ffffff; --text: #1a1d24; --text-dim: #5b6270;
  --border: #e4e7ec; --accent: #4f46e5;
  --good: #16a34a; --warn: #d97706; --bad: #dc2626; --gray: #9ca3af;
  --critical: #b91c1c; --high: #dc2626; --medium: #d97706; --low: #2563eb; --info: #6b7280;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f1115; --surface: #171a21; --text: #e6e8ec; --text-dim: #9aa1ad; --border: #2a2e37; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1, h2, h3 { margin: 0 0 8px; }
a { color: var(--accent); }
.header { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.header-title { font-size: 22px; font-weight: 700; word-break: break-all; }
.header-sub { color: var(--text-dim); font-size: 13px; margin-top: 4px; }
.gauge-wrap { display: flex; align-items: center; gap: 16px; }
.gauge-text { font-size: 30px; font-weight: 700; fill: var(--text); }
.gauge-track { stroke: var(--border); }
.gauge-good .gauge-fill { stroke: var(--good); }
.gauge-warn .gauge-fill { stroke: var(--warn); }
.gauge-bad .gauge-fill { stroke: var(--bad); }
.gauge-na .gauge-fill { stroke: var(--gray); }
.gauge-fill { stroke-linecap: round; transition: stroke-dashoffset .6s ease; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 28px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
.category-card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.category-name { font-weight: 600; }
.category-score { font-size: 20px; font-weight: 700; }
.sc-good { color: var(--good); } .sc-warn { color: var(--warn); } .sc-bad { color: var(--bad); } .sc-na { color: var(--gray); }
.meter { height: 6px; background: var(--border); border-radius: 4px; overflow: hidden; margin-bottom: 10px; }
.meter-fill { height: 100%; border-radius: 4px; }
.meter-fill.sc-good { background: var(--good); } .meter-fill.sc-warn { background: var(--warn); } .meter-fill.sc-bad { background: var(--bad); } .meter-fill.sc-na { background: var(--gray); }
.category-meta { display: flex; flex-wrap: wrap; gap: 6px; }
.pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--border); color: var(--text-dim); }
.pill-critical { color: var(--critical); } .pill-high { color: var(--high); } .pill-medium { color: var(--medium); } .pill-low { color: var(--low); } .pill-gray { color: var(--gray); }
section { margin-bottom: 32px; }
.section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
.controls { display: flex; gap: 8px; flex-wrap: wrap; }
select, input[type=text] { background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 13px; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 13px; }
th { background: var(--bg); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-dim); }
tr:last-child td { border-bottom: none; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: #fff; }
.badge-critical { background: var(--critical); } .badge-high { background: var(--high); } .badge-medium { background: var(--medium); }
.badge-low { background: var(--low); } .badge-info { background: var(--info); }
.cat-cell { text-transform: capitalize; color: var(--text-dim); }
.issue-title { font-weight: 600; margin-bottom: 2px; }
.issue-desc { color: var(--text-dim); margin-bottom: 4px; }
.issue-rec { color: var(--accent); font-size: 12.5px; margin-bottom: 4px; }
.issue-url a { font-size: 12px; word-break: break-all; }
.url-cell a { word-break: break-all; }
.empty-state { padding: 24px; text-align: center; color: var(--text-dim); }
.warnings { background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--warn); border-radius: 8px; padding: 12px 16px; margin-bottom: 24px; }
.warnings div { margin-bottom: 4px; color: var(--text-dim); font-size: 13px; }
footer { text-align: center; color: var(--text-dim); font-size: 12px; margin-top: 40px; }
`;

const SCRIPT = `
const table = document.getElementById('issues-table');
const categoryFilter = document.getElementById('filter-category');
const severityFilter = document.getElementById('filter-severity');
const searchInput = document.getElementById('filter-search');
const emptyState = document.getElementById('issues-empty');

function applyFilters() {
  const cat = categoryFilter.value;
  const sev = severityFilter.value;
  const query = searchInput.value.trim().toLowerCase();
  let visible = 0;
  for (const row of table.tBodies[0].rows) {
    const matchesCat = cat === 'all' || row.dataset.category === cat;
    const matchesSev = sev === 'all' || row.dataset.severity === sev;
    const matchesQuery = !query || row.textContent.toLowerCase().includes(query);
    const show = matchesCat && matchesSev && matchesQuery;
    row.style.display = show ? '' : 'none';
    if (show) visible++;
  }
  emptyState.style.display = visible === 0 ? 'block' : 'none';
}
categoryFilter.addEventListener('change', applyFilters);
severityFilter.addEventListener('change', applyFilters);
searchInput.addEventListener('input', applyFilters);
`;

export function renderHtmlReport(report) {
  const { meta, scores, issues, pages, lighthouse, accessibility } = report;
  const categories = Object.keys(scores.categories);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Site Audit Report — ${esc(meta.startUrl)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div>
      <div class="header-title">Site Audit Report</div>
      <div class="header-sub">${esc(meta.startUrl)}</div>
      <div class="header-sub">${meta.pagesCrawled} page(s) crawled &middot; generated ${esc(new Date(meta.generatedAt).toLocaleString())} &middot; ${(meta.durationMs / 1000).toFixed(1)}s</div>
    </div>
    <div class="gauge-wrap">
      ${circularGauge(scores.overall)}
      <div>
        <div style="font-weight:600;">Overall Score</div>
        <div class="header-sub">${scores.totalIssues} issue(s) found</div>
      </div>
    </div>
  </div>

  ${meta.warnings?.length ? `<div class="warnings">${meta.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join('')}</div>` : ''}

  <section>
    <div class="section-head"><h2>Category Scores</h2></div>
    <div class="grid">${categoryCards(scores.categories)}</div>
  </section>

  ${lighthouse?.available && lighthouse.results?.length ? `
  <section>
    <div class="section-head"><h2>Lighthouse Metrics (sampled pages)</h2></div>
    <table>
      <thead><tr><th>URL</th><th>Perf</th><th>A11y</th><th>Best Practices</th><th>SEO</th><th>LCP</th><th>CLS</th><th>TBT</th></tr></thead>
      <tbody>
        ${lighthouse.results.map((r) => `<tr>
          <td class="url-cell">${esc(r.url)}</td>
          <td>${r.scores.performance ?? '–'}</td>
          <td>${r.scores.accessibility ?? '–'}</td>
          <td>${r.scores['best-practices'] ?? '–'}</td>
          <td>${r.scores.seo ?? '–'}</td>
          <td>${esc(r.metrics.largestContentfulPaint || '–')}</td>
          <td>${esc(r.metrics.cumulativeLayoutShift || '–')}</td>
          <td>${esc(r.metrics.totalBlockingTime || '–')}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>` : ''}

  <section>
    <div class="section-head">
      <h2>All Issues (${issues.length})</h2>
      <div class="controls">
        <input type="text" id="filter-search" placeholder="Search issues…">
        <select id="filter-category">
          <option value="all">All categories</option>
          ${categories.map((c) => `<option value="${esc(c)}">${esc(scores.categories[c].label)}</option>`).join('')}
        </select>
        <select id="filter-severity">
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </div>
    </div>
    <table id="issues-table">
      <thead><tr><th>Severity</th><th>Category</th><th>Details</th></tr></thead>
      <tbody>${issuesTableRows(issues)}</tbody>
    </table>
    <div id="issues-empty" class="empty-state" style="display:none;">No issues match the current filters.</div>
  </section>

  <section>
    <div class="section-head"><h2>Pages Crawled (${pages.length})</h2></div>
    <table>
      <thead><tr><th>URL</th><th>Status</th><th>Title</th><th>Words</th><th>Response</th><th>Issues</th></tr></thead>
      <tbody>${pagesTableRows(pages)}</tbody>
    </table>
  </section>

  <footer>Generated by site-audit-tool${accessibility && !accessibility.available ? ' — accessibility checks skipped' : ''}</footer>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

export async function writeHtmlReport(report, filePath) {
  await writeFile(filePath, renderHtmlReport(report), 'utf-8');
  return filePath;
}
