import dns from 'node:dns';
import { sleep } from './utils/concurrency.js';

// Node (via undici) attempts IPv6 first by default. On networks where IPv6
// is advertised but broken or misconfigured — common on home/office Wi-Fi —
// that first attempt fails outright rather than falling back to IPv4 fast
// enough, so an otherwise-reachable site throws a bare "fetch failed" even
// though it loads fine in a browser. Preferring IPv4 avoids that whole class
// of false failures.
dns.setDefaultResultOrder('ipv4first');

const DEFAULT_HEADERS = {
  'user-agent': 'SiteAuditTool/1.0 (+https://github.com/) Node.js',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

/**
 * Fetch a URL manually following (and recording) redirects one hop at a
 * time, so callers can see the full redirect chain instead of only the
 * final response. Retries transient network failures with backoff.
 */
export async function fetchUrl(targetUrl, {
  method = 'GET',
  headers = {},
  timeout = 15000,
  maxRedirects = 10,
  retries = 2,
  retryDelay = 500,
  userAgent,
  extraHeaders = {}
} = {}) {
  const chain = [];
  let currentUrl = targetUrl;
  let attempt = 0;

  const mergedHeaders = {
    ...DEFAULT_HEADERS,
    ...(userAgent ? { 'user-agent': userAgent } : {}),
    ...headers,
    ...extraHeaders
  };

  while (true) {
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let response;
      try {
        response = await fetch(currentUrl, {
          method,
          headers: mergedHeaders,
          redirect: 'manual',
          signal: controller.signal
        });
      } finally {
        clearTimeout(timer);
      }
      const elapsedMs = performance.now() - start;

      if ([301, 302, 303, 307, 308].includes(response.status) && chain.length < maxRedirects) {
        const location = response.headers.get('location');
        chain.push({ url: currentUrl, status: response.status, location, elapsedMs });
        if (!location) {
          return buildResult({ finalUrl: currentUrl, response, chain, elapsedMs, bodyBuffer: null });
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const bodyBuffer = method === 'HEAD' ? null : Buffer.from(await response.arrayBuffer());
      return buildResult({ finalUrl: currentUrl, response, chain, elapsedMs, bodyBuffer });
    } catch (error) {
      const elapsedMs = performance.now() - start;
      if (attempt < retries) {
        attempt++;
        await sleep(retryDelay * attempt);
        continue;
      }
      return {
        ok: false,
        error: error.name === 'AbortError' ? new Error(`Request timed out after ${timeout}ms`) : new Error(describeError(error)),
        requestedUrl: targetUrl,
        finalUrl: currentUrl,
        redirectChain: chain,
        status: 0,
        headers: {},
        elapsedMs,
        body: null,
        text: null,
        sizeBytes: 0
      };
    }
  }
}

/**
 * Node's global fetch() throws a bare `TypeError: fetch failed` and buries
 * the actual reason (DNS failure, connection refused, TLS error, etc.) in
 * `error.cause` — and when multiple addresses were tried (e.g. IPv6 then
 * IPv4), that cause is itself an AggregateError with one entry per attempt.
 * Walk all of that to produce a message that actually says what went wrong.
 */
function describeError(error) {
  const parts = [];
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (Array.isArray(current.errors) && current.errors.length) {
      parts.push(...current.errors.map((e) => e.message || String(e)));
      current = current.errors[0]?.cause;
      continue;
    }
    if (current.message && !parts.includes(current.message)) parts.push(current.message);
    current = current.cause;
  }
  return parts.length ? parts.join(': ') : String(error);
}

function buildResult({ finalUrl, response, chain, elapsedMs, bodyBuffer }) {
  const headers = {};
  for (const [key, value] of response.headers.entries()) headers[key.toLowerCase()] = value;
  return {
    ok: response.status >= 200 && response.status < 400,
    requestedUrl: chain.length ? chain[0].url : finalUrl,
    finalUrl,
    redirectChain: chain,
    status: response.status,
    statusText: response.statusText,
    headers,
    elapsedMs,
    body: bodyBuffer,
    text: bodyBuffer ? bodyBuffer.toString('utf-8') : null,
    sizeBytes: bodyBuffer ? bodyBuffer.length : Number(headers['content-length'] || 0),
    error: null
  };
}
