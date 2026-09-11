import { sleep } from './utils/concurrency.js';

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
        error: error.name === 'AbortError' ? new Error(`Request timed out after ${timeout}ms`) : error,
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
