import { issue, SEVERITY } from './helpers.js';

function parseSetCookies(headerValue) {
  if (!headerValue) return [];
  // Split on commas that start a new cookie (not inside Expires=... date commas).
  return headerValue.split(/,(?=\s*[^;,\s]+=[^;,\s]*)/g).map((c) => c.trim());
}

export function checkSecurityPage(page) {
  const issues = [];
  const url = page.url;
  if (page.error) return issues;

  const isHttps = url.startsWith('https://');
  const headers = page.headers || {};

  if (!isHttps) {
    issues.push(issue({ category: 'security', severity: SEVERITY.CRITICAL, id: 'no-https', url,
      title: 'Page not served over HTTPS',
      description: 'The page is served over plain HTTP.',
      recommendation: 'Serve all pages over HTTPS and redirect HTTP to HTTPS.' }));
  }

  if (page.nonHtml || !page.ok) return issues;

  if (isHttps && !headers['strict-transport-security']) {
    issues.push(issue({ category: 'security', severity: SEVERITY.MEDIUM, id: 'missing-hsts', url,
      title: 'Missing Strict-Transport-Security header',
      description: 'HSTS header is not set, so browsers may still allow HTTP downgrade attacks.',
      recommendation: 'Add "Strict-Transport-Security: max-age=31536000; includeSubDomains" for HTTPS responses.' }));
  }

  if (!headers['content-security-policy']) {
    issues.push(issue({ category: 'security', severity: SEVERITY.MEDIUM, id: 'missing-csp', url,
      title: 'Missing Content-Security-Policy header',
      description: 'No CSP header was found, reducing protection against XSS and data-injection attacks.',
      recommendation: 'Define a Content-Security-Policy appropriate for the site\'s scripts, styles, and assets.' }));
  }

  if (!headers['x-content-type-options']) {
    issues.push(issue({ category: 'security', severity: SEVERITY.LOW, id: 'missing-x-content-type-options', url,
      title: 'Missing X-Content-Type-Options header',
      description: 'No "X-Content-Type-Options: nosniff" header was found.',
      recommendation: 'Add "X-Content-Type-Options: nosniff" to prevent MIME-sniffing attacks.' }));
  }

  const csp = headers['content-security-policy'] || '';
  const hasFrameAncestors = /frame-ancestors/i.test(csp);
  if (!headers['x-frame-options'] && !hasFrameAncestors) {
    issues.push(issue({ category: 'security', severity: SEVERITY.MEDIUM, id: 'missing-frame-protection', url,
      title: 'Missing clickjacking protection',
      description: 'Neither X-Frame-Options nor a CSP frame-ancestors directive was found.',
      recommendation: 'Add "X-Frame-Options: DENY" (or SAMEORIGIN) or a CSP frame-ancestors directive.' }));
  }

  if (!headers['referrer-policy']) {
    issues.push(issue({ category: 'security', severity: SEVERITY.LOW, id: 'missing-referrer-policy', url,
      title: 'Missing Referrer-Policy header',
      description: 'No Referrer-Policy header was found.',
      recommendation: 'Set a Referrer-Policy such as "strict-origin-when-cross-origin".' }));
  }

  if (!headers['permissions-policy']) {
    issues.push(issue({ category: 'security', severity: SEVERITY.INFO, id: 'missing-permissions-policy', url,
      title: 'Missing Permissions-Policy header',
      description: 'No Permissions-Policy header was found to restrict powerful browser features.',
      recommendation: 'Define a Permissions-Policy limiting access to camera, microphone, geolocation, etc.' }));
  }

  const serverHeader = headers['server'];
  if (serverHeader && /\d/.test(serverHeader)) {
    issues.push(issue({ category: 'security', severity: SEVERITY.LOW, id: 'server-version-disclosure', url,
      title: 'Server header discloses version information',
      description: `Server header: "${serverHeader}".`,
      recommendation: 'Configure the server to omit version numbers from the Server header.' }));
  }
  if (headers['x-powered-by']) {
    issues.push(issue({ category: 'security', severity: SEVERITY.LOW, id: 'x-powered-by-disclosure', url,
      title: 'X-Powered-By header discloses technology stack',
      description: `X-Powered-By: "${headers['x-powered-by']}".`,
      recommendation: 'Disable the X-Powered-By header to reduce fingerprinting surface.' }));
  }

  const setCookies = parseSetCookies(headers['set-cookie']);
  for (const cookie of setCookies) {
    const lower = cookie.toLowerCase();
    const problems = [];
    if (isHttps && !lower.includes('secure')) problems.push('missing Secure flag');
    if (!lower.includes('httponly')) problems.push('missing HttpOnly flag');
    if (!lower.includes('samesite')) problems.push('missing SameSite attribute');
    if (problems.length) {
      issues.push(issue({ category: 'security', severity: SEVERITY.MEDIUM, id: 'insecure-cookie', url,
        title: 'Cookie set without recommended security attributes',
        description: `Cookie "${cookie.split('=')[0]}" is ${problems.join(', ')}.`,
        recommendation: 'Set Secure, HttpOnly, and SameSite on cookies where appropriate.' }));
    }
  }

  if (isHttps) {
    for (const form of page.forms || []) {
      if (form.action && form.action.startsWith('http://')) {
        issues.push(issue({ category: 'security', severity: SEVERITY.HIGH, id: 'insecure-form-action', url,
          title: 'Form submits to an insecure HTTP endpoint',
          description: `Form action is "${form.action}" on an HTTPS page.`,
          recommendation: 'Point the form action at an HTTPS URL to avoid submitting data in plaintext.' }));
      }
    }
  }

  const externalBlankLinks = (page.links || []).filter((l) => l.target === '_blank' && !l.rel.includes('noopener') && !l.rel.includes('noreferrer'));
  if (externalBlankLinks.length) {
    issues.push(issue({ category: 'security', severity: SEVERITY.LOW, id: 'target-blank-no-noopener', url,
      title: 'Links open in a new tab without rel="noopener"',
      description: `${externalBlankLinks.length} link(s) use target="_blank" without rel="noopener noreferrer".`,
      recommendation: 'Add rel="noopener noreferrer" to target="_blank" links to prevent reverse tabnabbing.',
      meta: { count: externalBlankLinks.length } }));
  }

  return issues;
}
