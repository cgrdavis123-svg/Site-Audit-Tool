import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { issue, SEVERITY } from './helpers.js';

const THIN_CONTENT_WORDS = 300;

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const matches = w.match(/[aeiouy]+/g);
  let count = matches ? matches.length : 1;
  if (w.endsWith('e') && count > 1) count--;
  return Math.max(count, 1);
}

/** Flesch Reading Ease score (0-100, higher = easier to read). */
function fleschReadingEase(text) {
  const sentences = (text.match(/[.!?]+(\s|$)/g) || []).length || 1;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function extractBodyText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, nav, footer, header').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

export function checkContentPage(page) {
  const issues = [];
  if (!page.ok || page.nonHtml) return issues;
  const url = page.url;

  if (page.wordCount < THIN_CONTENT_WORDS) {
    issues.push(issue({ category: 'content', severity: SEVERITY.LOW, id: 'thin-content', url,
      title: 'Thin content',
      description: `Page has only ${page.wordCount} words of body text.`,
      recommendation: `Aim for at least ${THIN_CONTENT_WORDS} words of substantive content for informational pages.` }));
  }

  if (page.textToHtmlRatio < 0.1 && page.wordCount > 0) {
    issues.push(issue({ category: 'content', severity: SEVERITY.INFO, id: 'low-text-to-html-ratio', url,
      title: 'Low text-to-HTML ratio',
      description: `Only ${(page.textToHtmlRatio * 100).toFixed(1)}% of the document is visible text.`,
      recommendation: 'Reduce unnecessary markup or inline scripts/styles relative to content.' }));
  }

  const bodyText = extractBodyText(page.html);
  const readability = fleschReadingEase(bodyText);
  page.readabilityScore = readability;
  if (readability !== null && readability < 30 && page.wordCount > 100) {
    issues.push(issue({ category: 'content', severity: SEVERITY.INFO, id: 'hard-to-read', url,
      title: 'Content may be difficult to read',
      description: `Flesch Reading Ease score is ${readability} (very difficult).`,
      recommendation: 'Use shorter sentences and simpler words to improve readability.' }));
  }

  return issues;
}

/** Detect near-duplicate content across pages by hashing normalized body text. */
export function checkContentSite(pages) {
  const issues = [];
  const byHash = new Map();

  for (const page of pages) {
    if (!page.ok || page.nonHtml || !page.html) continue;
    const bodyText = extractBodyText(page.html).toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (bodyText.length < 200) continue;
    const hash = createHash('sha1').update(bodyText).digest('hex');
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(page.url);
  }

  for (const [, urls] of byHash) {
    if (urls.length > 1) {
      issues.push(issue({ category: 'content', severity: SEVERITY.MEDIUM, id: 'duplicate-content', url: urls[0],
        title: 'Duplicate content across pages',
        description: `${urls.length} pages have near-identical body text.`,
        recommendation: 'Consolidate duplicate pages, use canonical tags, or differentiate the content.',
        meta: { urls } }));
    }
  }

  return issues;
}
