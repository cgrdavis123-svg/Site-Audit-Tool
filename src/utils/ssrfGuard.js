import dns from 'node:dns/promises';

/**
 * True if an IPv4 address (dotted-quad string) falls in a private,
 * loopback, link-local, or otherwise non-public range.
 */
export function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + broadcast
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  return false;
}

/**
 * True if an IPv6 address falls in a private, loopback, link-local, or
 * IPv4-mapped-to-a-private-range range.
 */
export function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:') || normalized.startsWith('fec0:')) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return true; // fc00::/7 unique local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip, family) {
  return family === 6 || ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/**
 * Resolve `hostname` and throw if any resolved address is private,
 * loopback, or link-local — the classic SSRF vector where a
 * publicly-reachable service is tricked into fetching an internal-only
 * URL (cloud metadata endpoints, internal admin panels, etc). This is a
 * best-effort check at request time, not a guarantee against DNS
 * rebinding (an attacker-controlled name could resolve differently by
 * the time the crawler actually connects), but it blocks the common,
 * accidental case of someone pointing a publicly exposed dashboard at
 * "localhost" or an internal IP.
 */
export async function assertPublicHost(urlString, { allowPrivate = false } = {}) {
  if (allowPrivate) return;
  let hostname;
  try {
    hostname = new URL(urlString).hostname;
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  const bareHost = hostname.replace(/^\[|\]$/g, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bareHost)) {
    if (isPrivateIPv4(bareHost)) throw new Error(`Refusing to audit a private/internal address: ${hostname}`);
    return;
  }
  if (bareHost.includes(':')) {
    if (isPrivateIPv6(bareHost)) throw new Error(`Refusing to audit a private/internal address: ${hostname}`);
    return;
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Could not resolve hostname "${hostname}": ${error.message}`);
  }
  if (!addresses.length) {
    throw new Error(`Hostname "${hostname}" did not resolve to any address.`);
  }
  for (const { address, family } of addresses) {
    if (isPrivateAddress(address, family)) {
      throw new Error(`Refusing to audit "${hostname}": it resolves to a private/internal address (${address}).`);
    }
  }
}
