# Site Audit Tool

An in-depth, advanced site auditing CLI for Node.js. It crawls a website and
audits **SEO**, **technical health**, **security**, **performance**,
**accessibility**, **content quality**, and **link integrity** — then produces
a scored HTML dashboard, machine-readable JSON, and CSV reports.

## Features

- **Real crawler** — breadth-first crawl with concurrency control, robots.txt
  compliance, XML sitemap discovery (including sitemap indexes), redirect
  chain tracking, retries/timeouts, and same-origin/subdomain rules.
- **SEO checks** — titles, meta descriptions, headings, canonical tags,
  Open Graph/Twitter cards, structured data (JSON-LD) validation, alt text,
  duplicate titles/descriptions across the site.
- **Technical checks** — broken pages (4xx/5xx), redirect chains, missing
  viewport/charset/doctype, mixed content, page weight, compression, missing
  robots.txt/sitemap.
- **Security checks** — HTTPS enforcement, HSTS, CSP, X-Frame-Options,
  X-Content-Type-Options, Referrer-Policy, Permissions-Policy, cookie flags,
  server/version disclosure, insecure form actions, `target="_blank"` without
  `rel="noopener"`.
- **Content checks** — thin content, text-to-HTML ratio, Flesch readability
  score, duplicate content detection across pages.
- **Link checks** — broken internal links (with source pages), orphan pages,
  optional external link verification.
- **Optional deep audits** — real accessibility testing via
  [axe-core](https://github.com/dequelabs/axe-core) driven by a headless
  browser (Playwright), and real Core Web Vitals via
  [Lighthouse](https://github.com/GoogleChrome/lighthouse). Both are optional
  dependencies; the tool degrades gracefully with a clear warning if they
  aren't installed or a browser can't be launched.
- **Weighted scoring** — an overall 0-100 score plus a per-category score,
  weighted by issue severity and how many pages/URLs each issue affects.
- **Multiple report formats** — polished self-contained HTML dashboard
  (filterable issue table, per-page breakdown, gauges), full JSON for CI/
  tooling integration, and CSV for spreadsheets.
- **CI-friendly** — `--fail-under <score>` exits non-zero when the overall
  score falls below a threshold.
- **Usable as a library** — `import { runAudit } from 'site-audit-tool'`.

## Installation

```bash
npm install
```

The core crawler and checks (SEO/technical/security/content/links) have no
heavy dependencies. Accessibility and Lighthouse audits require the optional
dependencies `playwright`, `axe-core`, `lighthouse`, and `chrome-launcher`
(installed automatically via `npm install`, unless your environment excludes
optional dependencies). Accessibility/Lighthouse also need a Chromium binary
available to Playwright — run `npx playwright install chromium` if needed.

## CLI usage

```bash
node bin/site-audit.js https://example.com
```

Or, after `npm link` (or global install):

```bash
site-audit https://example.com --max-pages 200 --format html,json
```

### Common options

| Option | Description |
| --- | --- |
| `--max-pages <n>` | Maximum number of pages to crawl (default 100) |
| `--max-depth <n>` | Maximum link depth from the start URL (default 5) |
| `--concurrency <n>` | Concurrent requests (default 5) |
| `--delay <ms>` | Delay between requests |
| `--timeout <ms>` | Per-request timeout |
| `--ignore-robots` | Ignore robots.txt while crawling |
| `--include-subdomains` | Treat subdomains as internal |
| `--no-sitemap` | Skip sitemap discovery |
| `--check-external-links` | Verify external links resolve |
| `--include <pattern>` / `--exclude <pattern>` | Filter crawled URLs (repeatable) |
| `--a11y` | Run axe-core accessibility audits on a sample of pages |
| `--lighthouse` | Run Lighthouse audits on a sample of pages |
| `-o, --output <dir>` | Report output directory (default `./site-audit-report`) |
| `-f, --format <formats>` | `html`, `json`, `csv`, or `all` |
| `--fail-under <score>` | Exit 1 if the overall score is below this value |
| `-c, --config <file>` | JSON or JS config file |
| `--open` | Open the HTML report when done |

Run `site-audit --help` for the full list.

### Example: CI gate

```bash
site-audit https://staging.example.com --fail-under 80 --format json --quiet
```

## Programmatic usage

```js
import { runAudit } from './src/index.js';

const report = await runAudit({
  url: 'https://example.com',
  maxPages: 50,
  accessibility: true,
  formats: ['json'],
  quiet: true
});

console.log(report.scores.overall);
```

## Config file

Pass `--config site-audit.config.js` (or `.json`) with any of the options
from `config/defaults.js`. CLI flags override config file values.

```js
// site-audit.config.js
export default {
  maxPages: 200,
  excludePatterns: ['/wp-admin/', '/tag/'],
  checkExternalLinks: true
};
```

## Report output

By default, reports are written to `./site-audit-report/`:

- `report.html` — interactive dashboard with category scores, a filterable
  issue table, and a per-page breakdown.
- `report.json` — the full structured report (scores, every issue, per-page
  data, sitemap/robots info) for CI or further processing.
- `report.csv` — a flat list of issues for spreadsheets.

## Development

```bash
npm test        # runs the node:test suite
```

## Architecture

```
bin/site-audit.js       CLI entry point (commander)
src/index.js            Orchestrates crawl -> checks -> scoring -> reports
src/crawler.js          BFS crawler with robots/sitemap integration
src/pageParser.js       Extracts structured data from HTML via cheerio
src/robots.js           robots.txt parsing/matching
src/sitemap.js          XML sitemap (and sitemap index) parsing
src/httpClient.js       fetch wrapper with manual redirect tracking + retries
src/scoring.js          Severity-weighted scoring per category
src/checks/*.js         SEO, technical, security, content, links,
                         accessibility (axe), performance (Lighthouse + heuristics)
src/report/*.js         HTML/JSON/CSV/console report writers
```
