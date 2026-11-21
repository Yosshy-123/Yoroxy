/*
 * Per-client token bucket, dependency free.
 *
 * Each client key owns a bucket of `capacity` tokens that refills at
 * `refillPerSecond`. take(key) spends one token and returns true, or
 * returns false when the bucket is empty. Buckets that have been idle long
 * enough to be full again are dropped by a timer that does not keep the
 * process alive.
 */
export function createRateLimiter({
  capacity,
  refillPerSecond,
  now = Date.now,
  sweepIntervalMs = 60_000,
  maxClients = 50_000,
}) {
  if (!(capacity >= 1) || !(refillPerSecond > 0)) {
    throw new RangeError('rate limit needs capacity >= 1 and refillPerSecond > 0');
  }
  const buckets = new Map(); // key -> { tokens, updated }
  const idleMs = (capacity / refillPerSecond) * 1000;

  function sweep() {
    const t = now();
    for (const [key, b] of buckets) if (t - b.updated >= idleMs) buckets.delete(key);
  }

  const timer = setInterval(sweep, sweepIntervalMs);
  timer.unref();

  function take(key) {
    const t = now();
    let b = buckets.get(key);
    if (!b) {
      // Bound memory: when full, drop the least recently used client.
      if (buckets.size >= maxClients) buckets.delete(buckets.keys().next().value);
      b = { tokens: capacity, updated: t };
    } else {
      b.tokens = Math.min(capacity, b.tokens + ((t - b.updated) / 1000) * refillPerSecond);
      b.updated = t;
      buckets.delete(key); // re-insert: keeps Map order = least recently used first
    }
    buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  return {
    take,
    /** Seconds until one token is available again (for Retry-After). */
    retryAfterSeconds: () => Math.max(1, Math.ceil(1 / refillPerSecond)),
    dispose: () => clearInterval(timer),
  };
}
