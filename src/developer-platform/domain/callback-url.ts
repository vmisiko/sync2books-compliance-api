import { BlockList, isIP } from 'node:net';

/**
 * Rules for a caller-supplied sale callback URL.
 *
 * The service POSTs to this URL from inside our network, so an unchecked URL
 * lets any API caller make us send requests to internal hosts (cloud metadata,
 * the database, the main API's internal routes). Only public https endpoints
 * are accepted. The host is checked twice: here, against the literal hostname,
 * and again at delivery, against every address it resolves to -- a public name
 * can point at a private address.
 */

export const MAX_CALLBACK_URL_LENGTH = 2048;

const PRIVATE_RANGES = (() => {
  const list = new BlockList();
  list.addSubnet('0.0.0.0', 8, 'ipv4');
  list.addSubnet('10.0.0.0', 8, 'ipv4');
  list.addSubnet('100.64.0.0', 10, 'ipv4');
  list.addSubnet('127.0.0.0', 8, 'ipv4');
  list.addSubnet('169.254.0.0', 16, 'ipv4');
  list.addSubnet('172.16.0.0', 12, 'ipv4');
  list.addSubnet('192.0.0.0', 24, 'ipv4');
  list.addSubnet('192.168.0.0', 16, 'ipv4');
  list.addSubnet('198.18.0.0', 15, 'ipv4');
  list.addSubnet('224.0.0.0', 4, 'ipv4');
  list.addSubnet('240.0.0.0', 4, 'ipv4');
  list.addAddress('::', 'ipv6');
  list.addAddress('::1', 'ipv6');
  list.addSubnet('fc00::', 7, 'ipv6');
  list.addSubnet('fe80::', 10, 'ipv6');
  list.addSubnet('ff00::', 8, 'ipv6');
  return list;
})();

/**
 * Local development only: lets a callback reach `http://localhost:…` so the
 * flow can be exercised without a public tunnel. Ignored in production.
 */
export function allowPrivateCallbackUrls(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.SALE_CALLBACK_ALLOW_PRIVATE_URLS === 'true'
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:10.0.0.1) is the IPv4 address in disguise.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return PRIVATE_RANGES.check(mapped[1], 'ipv4');
    return PRIVATE_RANGES.check(address, 'ipv6');
  }
  return PRIVATE_RANGES.check(address, 'ipv4');
}

/**
 * The reason `raw` is not an acceptable callback URL, or null when it is.
 * Literal checks only; resolution happens at delivery time.
 */
export function callbackUrlProblem(
  raw: string,
  allowPrivate = allowPrivateCallbackUrls(),
): string | null {
  if (raw.length > MAX_CALLBACK_URL_LENGTH) {
    return `must be at most ${MAX_CALLBACK_URL_LENGTH} characters`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'must be an absolute URL';
  }
  const httpAllowed = allowPrivate && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !httpAllowed) {
    return 'must use https';
  }
  if (url.username || url.password) {
    return 'must not contain credentials';
  }
  if (allowPrivate) return null;

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return 'must be a public host';
  }
  if (isPrivateAddress(host)) {
    return 'must be a public host';
  }
  return null;
}
