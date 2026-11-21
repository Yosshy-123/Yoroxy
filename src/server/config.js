/*
 * Process configuration: the only place environment variables are read, and
 * validated. Everything else receives plain values.
 *
 *   PORT           0-65535 (default 8080). 0 lets the OS pick a free port.
 *   TRUSTED_PROXY  how many reverse proxies sit in front of the server
 *                  (default 0 = none). Only when it is set is the
 *                  X-Forwarded-For / X-Forwarded-Host header believed (see
 *                  request-guard.js). Behind a proxy without it, every
 *                  visitor shares the proxy's address and one rate-limit
 *                  bucket; with it set but no proxy actually there, clients
 *                  could pick their own address.
 *   HOST           address to listen on (default: every interface). A host
 *                  name or IP address without spaces.
 *
 * An invalid value throws; index.js reports it and exits.
 */
const DEFAULT_PORT = 8080;
const MAX_PROXY_HOPS = 10;

function integerIn(name, value, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max} (got ${JSON.stringify(value)})`);
  }
  return Number(value);
}

function hostName(name, value) {
  if (!/^\S+$/.test(value)) {
    throw new Error(`${name} must be a host name or address without spaces (got ${JSON.stringify(value)})`);
  }
  return value;
}

export function readConfig(env) {
  return {
    port: env.PORT === undefined ? DEFAULT_PORT : integerIn('PORT', env.PORT, 0, 65535),
    trustedProxy: env.TRUSTED_PROXY === undefined ? 0 : integerIn('TRUSTED_PROXY', env.TRUSTED_PROXY, 0, MAX_PROXY_HOPS),
    host: env.HOST === undefined ? undefined : hostName('HOST', env.HOST),
  };
}
