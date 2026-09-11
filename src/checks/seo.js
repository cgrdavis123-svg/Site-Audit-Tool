import { issue, SEVERITY } from './helpers.js';

const TITLE_MIN = 10;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

/** Per-page SEO checks: titles, meta description, headings, canonical, social tags, structured data. */
export function checkSeoPage(page) {
  const issues = [];
  if (!page.ok || page.nonHtml) return issues;
  const url = page.url;

  if (!page.title) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.HIGH, id: 'missing-title', url,
      title: 'Missing <title> tag',
      description: 'The page has no <title> element or it is empty.',
      recommendation: 'Add a unique, descriptive <title> between 10 and 60 characters.' }));
  } else if (page.titleLength < TITLE_MIN) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'title-too-short', url,
      title: 'Title tag is very short',
      description: `Title is ${page.titleLength} characters: "${page.title}".`,
      recommendation: `Expand the title to ${TITLE_MIN}-${TITLE_MAX} characters to better describe the page.` }));
  } else if (page.titleLength > TITLE_MAX) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'title-too-long', url,
      title: 'Title tag may be truncated in search results',
      description: `Title is ${page.titleLength} characters: "${page.title}".`,
      recommendation: `Shorten the title to under ${TITLE_MAX} characters.` }));
  }

  if (!page.metaDescription) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'missing-meta-description', url,
      title: 'Missing meta description',
      description: 'The page has no <meta name="description"> tag.',
      recommendation: `Add a unique meta description between ${DESC_MIN} and ${DESC_MAX} characters.` }));
  } else if (page.metaDescriptionLength > DESC_MAX) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'meta-description-too-long', url,
      title: 'Meta description may be truncated',
      description: `Meta description is ${page.metaDescriptionLength} characters.`,
      recommendation: `Shorten the meta description to under ${DESC_MAX} characters.` }));
  } else if (page.metaDescriptionLength < DESC_MIN) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'meta-description-too-short', url,
      title: 'Meta description is short',
      description: `Meta description is ${page.metaDescriptionLength} characters.`,
      recommendation: `Expand the meta description to at least ${DESC_MIN} characters.` }));
  }

  const h1Count = page.headings?.h1?.length ?? 0;
  if (h1Count === 0) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'missing-h1', url,
      title: 'Missing H1 heading',
      description: 'No <h1> element was found on the page.',
      recommendation: 'Add a single, descriptive <h1> that summarizes the page content.' }));
  } else if (h1Count > 1) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'multiple-h1', url,
      title: 'Multiple H1 headings',
      description: `Found ${h1Count} <h1> elements: ${page.headings.h1.slice(0, 3).join(' | ')}${h1Count > 3 ? '…' : ''}`,
      recommendation: 'Use a single <h1> per page and demote the rest to <h2>/<h3>.' }));
  }

  let prevLevel = 0;
  let skipped = false;
  for (const level of page.headingOrder || []) {
    if (prevLevel && level - prevLevel > 1) skipped = true;
    prevLevel = level;
  }
  if (skipped) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.INFO, id: 'heading-order-skipped', url,
      title: 'Heading levels are skipped',
      description: 'Heading tags skip a level (e.g. H2 followed directly by H4).',
      recommendation: 'Use heading levels in sequential order to preserve document structure.' }));
  }

  if (!page.canonical) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'missing-canonical', url,
      title: 'Missing canonical tag',
      description: 'No <link rel="canonical"> was found.',
      recommendation: 'Add a self-referencing canonical tag to avoid duplicate-content issues.' }));
  } else if (!page.isSelfCanonical) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.INFO, id: 'non-self-canonical', url,
      title: 'Canonical points to a different URL',
      description: `Canonical tag points to ${page.canonical}.`,
      recommendation: 'Confirm this is intentional; otherwise point the canonical at the page itself.' }));
  }

  if (page.isNoIndex) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.INFO, id: 'noindex', url,
      title: 'Page is marked noindex',
      description: `meta robots content: "${page.metaRobots}".`,
      recommendation: 'Confirm this page is intentionally excluded from search results.' }));
  }

  if (!page.lang) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'missing-lang', url,
      title: 'Missing html lang attribute',
      description: 'The <html> element has no lang attribute.',
      recommendation: 'Add a lang attribute (e.g. lang="en") to help search engines and screen readers.' }));
  }

  const missingAlt = (page.images || []).filter((img) => !img.hasAlt);
  if (missingAlt.length) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'images-missing-alt', url,
      title: 'Images missing alt attributes',
      description: `${missingAlt.length} of ${page.images.length} image(s) have no alt attribute.`,
      recommendation: 'Add descriptive alt text to every meaningful image (use alt="" for decorative images).',
      meta: { count: missingAlt.length, examples: missingAlt.slice(0, 5).map((i) => i.src) } }));
  }

  if (!page.openGraph?.['og:title'] || !page.openGraph?.['og:description'] || !page.openGraph?.['og:image']) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.INFO, id: 'incomplete-open-graph', url,
      title: 'Incomplete Open Graph tags',
      description: 'Missing one or more of og:title, og:description, og:image.',
      recommendation: 'Add complete Open Graph tags to control how the page appears when shared on social media.' }));
  }

  const invalidStructuredData = (page.structuredData || []).filter((sd) => !sd.valid);
  if (invalidStructuredData.length) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'invalid-structured-data', url,
      title: 'Invalid JSON-LD structured data',
      description: `${invalidStructuredData.length} <script type="application/ld+json"> block(s) failed to parse.`,
      recommendation: 'Fix the JSON syntax so search engines can parse the structured data.',
      meta: { errors: invalidStructuredData.map((s) => s.error) } }));
  }

  const genericLinks = (page.links || []).filter((l) => l.isGenericText);
  if (genericLinks.length >= 3) {
    issues.push(issue({ category: 'seo', severity: SEVERITY.INFO, id: 'generic-anchor-text', url,
      title: 'Generic anchor text used repeatedly',
      description: `${genericLinks.length} link(s) use generic text like "click here" or "read more".`,
      recommendation: 'Use descriptive anchor text that indicates the destination page content.' }));
  }

  return issues;
}

/** Site-wide SEO checks that need visibility across all crawled pages. */
export function checkSeoSite(pages) {
  const issues = [];
  const byTitle = new Map();
  const byDescription = new Map();

  for (const page of pages) {
    if (!page.ok || page.nonHtml) continue;
    if (page.title) {
      const key = page.title.trim().toLowerCase();
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(page.url);
    }
    if (page.metaDescription) {
      const key = page.metaDescription.trim().toLowerCase();
      if (!byDescription.has(key)) byDescription.set(key, []);
      byDescription.get(key).push(page.url);
    }
  }

  for (const [titleText, urls] of byTitle) {
    if (urls.length > 1) {
      issues.push(issue({ category: 'seo', severity: SEVERITY.MEDIUM, id: 'duplicate-title', url: urls[0],
        title: 'Duplicate title tag across pages',
        description: `${urls.length} pages share the title "${titleText}".`,
        recommendation: 'Give each page a unique, descriptive title.',
        meta: { urls } }));
    }
  }

  for (const [descText, urls] of byDescription) {
    if (urls.length > 1) {
      issues.push(issue({ category: 'seo', severity: SEVERITY.LOW, id: 'duplicate-meta-description', url: urls[0],
        title: 'Duplicate meta description across pages',
        description: `${urls.length} pages share the same meta description.`,
        recommendation: 'Write a unique meta description for each page.',
        meta: { urls, snippet: descText.slice(0, 120) } }));
    }
  }

  return issues;
}
