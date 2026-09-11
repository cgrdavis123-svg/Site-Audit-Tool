import { fetchUrl } from './httpClient.js';

/**
 * Parse robots.txt content into per-user-agent rule groups plus any
 * declared sitemaps and crawl-delay directives.
 */
export function parseRobotsTxt(content) {
  const groups = []; // { agents: string[], rules: {type, path}[], crawlDelay?: number }
  const sitemaps = [];
  let current = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sepIndex = line.indexOf(':');
    if (sepIndex === -1) continue;
    const field = line.slice(0, sepIndex).trim().toLowerCase();
    const value = line.slice(sepIndex + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current.rules.push({ type: 'disallow', path: value });
    } else if (field === 'allow' && current) {
      current.rules.push({ type: 'allow', path: value });
    } else if (field === 'crawl-delay' && current) {
      const n = Number(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    } else if (field === 'sitemap') {
      sitemaps.push(value);
    }
  }

  return { groups, sitemaps };
}

function patternToRegExp(path) {
  let regex = '^';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '*') regex += '.*';
    else if (ch === '$' && i === path.length - 1) regex += '$';
    else regex += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex);
}

function selectGroup(groups, userAgent) {
  const ua = userAgent.toLowerCase();
  let best = null;
  let bestSpecificity = -1;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*' && bestSpecificity < 0) {
        best = group;
        bestSpecificity = 0;
      } else if (agent !== '*' && ua.includes(agent) && agent.length > bestSpecificity) {
        best = group;
        bestSpecificity = agent.length;
      }
    }
  }
  return best;
}

export function isAllowedByRobots({ groups }, pathWithQuery, userAgent = '*') {
  const group = selectGroup(groups, userAgent);
  if (!group) return true;

  let matched = null;
  let matchedLength = -1;
  for (const rule of group.rules) {
    if (rule.path === '') {
      if (rule.type === 'disallow') continue;
    }
    const regex = patternToRegExp(rule.path);
    if (regex.test(pathWithQuery) && rule.path.length > matchedLength) {
      matched = rule;
      matchedLength = rule.path.length;
    }
  }
  if (!matched) return true;
  return matched.type === 'allow';
}

/**
 * Fetch and parse robots.txt for the given origin. Returns a permissive
 * default (allow everything, no sitemaps) if it's missing or unreadable.
 */
export async function loadRobotsTxt(origin, options = {}) {
  const robotsUrl = new URL('/robots.txt', origin).toString();
  const result = await fetchUrl(robotsUrl, { ...options, method: 'GET' });
  if (!result.ok || result.status !== 200 || !result.text) {
    return {
      exists: false,
      status: result.status,
      url: robotsUrl,
      groups: [],
      sitemaps: [],
      isAllowed: () => true
    };
  }
  const parsed = parseRobotsTxt(result.text);
  return {
    exists: true,
    status: result.status,
    url: robotsUrl,
    raw: result.text,
    ...parsed,
    isAllowed: (pathWithQuery, userAgent) => isAllowedByRobots(parsed, pathWithQuery, userAgent)
  };
}
