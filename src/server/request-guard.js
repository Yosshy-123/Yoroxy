/*
 * Who is calling /bare/ (SEC-05).
 *
 * Bare is an open relay by design, and it answers with CORS `*`, so a page on
 * any other website could otherwise use a visitor's browser (or this server)
 * to reach arbitrary hosts. Two cheap checks, applied before Bare sees the
 * request:
 *
 *   clientKey(req)         the address rate limits are counted against
 *   isSameSiteRequest(req) rejects browser requests made from another origin
 *   isLocalUser(req)       the person using the proxy is on this machine
 *
 * The first two do not stop a non-browser client, which can send any headers
 * it likes. isLocalUser decides who may use the proxy to reach this machine's
 * own addresses (see bare-gateway.js).
 */
import net from 'node:net';

/*
 * Rate-limit key for an IP. IPv4-mapped IPv6 collapses to the IPv4 address;
 * an IPv6 client is keyed by its /64, because one subscriber normally owns a
 * whole /64 and could otherwise rotate through addresses to dodge the limit.
 */
export function normalizeIp(address) {
  if (!address) return 'unknown';
  let ip = String(address).trim();
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return ip.toLowerCase();

  const halves = ip.toLowerCase().split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length > 1 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/*
 * trustedProxy = number of reverse proxies in front of this server (0: none).
 * Only then is X-Forwarded-For read, and only the entry the outermost
 * trusted proxy appended: entries further left are client-controlled.
 */
export function clientIp(req, trustedProxy = 0) {
  const socketIp = req.socket && req.socket.remoteAddress;
  if (trustedProxy > 0) {
    const header = req.headers['x-forwarded-for'];
    if (typeof header === 'string') {
      const chain = header.split(',').map((s) => s.trim()).filter(Boolean);
      if (chain.length >= trustedProxy) return chain[chain.length - trustedProxy];
    }
  }
  return socketIp;
}

export function clientKey(req, trustedProxy = 0) {
  return normalizeIp(clientIp(req, trustedProxy));
}

function expectedHost(req, trustedProxy) {
  if (trustedProxy > 0) {
    const forwarded = req.headers['x-forwarded-host'];
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim().toLowerCase();
  }
  const host = req.headers.host;
  return typeof host === 'string' ? host.toLowerCase() : '';
}

/*
 * True unless a browser says the request comes from another site:
 *   - Sec-Fetch-Site: cross-site, or
 *   - an Origin whose host differs from the host being requested (this
 *     includes the opaque origin "null").
 * A request without Origin is allowed: same-origin GETs do not send one.
 */
export function isSameSiteRequest(req, trustedProxy = 0) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  try {
    const host = expectedHost(req, trustedProxy);
    return host !== '' && new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

const LOOPBACK_ADDRESS = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i;
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i;
const FORWARDING_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'x-real-ip'];

/*
 * True when the person using the proxy is on the machine it runs on: the
 * connection comes from a loopback address, to a loopback host name, and no
 * reverse proxy sits in between. Such a person could reach this machine's
 * addresses anyway, so letting the proxy do it for them gives nothing away.
 *
 * Any sign of a reverse proxy makes the answer no: TRUSTED_PROXY is set, or
 * the request carries a forwarding header, or the Host is not a loopback
 * name. A proxy on the same machine otherwise makes every visitor look like
 * a loopback client, which is what TRUSTED_PROXY (see config.js) is for.
 */
export function isLocalUser(req, trustedProxy = 0) {
  if (trustedProxy > 0) return false;
  if (FORWARDING_HEADERS.some((name) => req.headers[name] !== undefined)) return false;
  const host = req.headers.host;
  if (typeof host !== 'string' || !LOOPBACK_HOST.test(host)) return false;
  const address = req.socket && req.socket.remoteAddress;
  return typeof address === 'string' && LOOPBACK_ADDRESS.test(address);
}
