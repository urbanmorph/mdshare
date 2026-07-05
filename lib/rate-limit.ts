/**
 * Simple in-memory rate limiter using Cloudflare Workers global scope.
 * Tracks request counts per IP with a sliding window.
 *
 * Note: each Worker isolate has its own memory, so limits are per-isolate,
 * not globally coordinated. This is sufficient for basic abuse prevention.
 */

interface RateEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateEntry>();

// Clean up stale entries periodically
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // cleanup once per minute
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

interface RateLimitConfig {
  /** Max requests allowed in the window */
  max: number;
  /** Window duration in seconds */
  windowSec: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  ip: string,
  action: string,
  config: RateLimitConfig
): RateLimitResult {
  cleanup();

  const key = `${action}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowSec * 1000 });
    return { allowed: true, remaining: config.max - 1, resetAt: now + config.windowSec * 1000 };
  }

  if (entry.count >= config.max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: config.max - entry.count, resetAt: entry.resetAt };
}

/**
 * Durable, globally-coordinated rate limit backed by D1.
 *
 * Unlike checkRateLimit above (per-isolate memory), this shares one counter
 * across every edge isolate, so a per-IP cap actually holds. Use it for
 * low-frequency, abuse-prone endpoints (document creation) where an extra D1
 * write per request is acceptable — NOT on hot paths like poll().
 *
 * The upsert is atomic: D1 serializes writes, and ON CONFLICT ... RETURNING
 * increments and reads the post-update count in a single statement, so
 * concurrent requests from the same IP can't race past the limit.
 */
export async function checkDurableRateLimit(
  db: D1Database,
  ip: string,
  action: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const key = `${action}:${ip}`;
  const now = Date.now();
  const resetAt = now + config.windowSec * 1000;

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count    = CASE WHEN rate_limits.reset_at < ? THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at < ? THEN ? ELSE rate_limits.reset_at END
       RETURNING count, reset_at`
    )
    .bind(key, resetAt, now, now, resetAt)
    .first<{ count: number; reset_at: number }>();

  const count = row?.count ?? 1;
  const windowResetAt = row?.reset_at ?? resetAt;
  return {
    allowed: count <= config.max,
    remaining: Math.max(0, config.max - count),
    resetAt: windowResetAt,
  };
}

export function rateLimitResponse(result: RateLimitResult): Response {
  const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
  return Response.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetAt),
      },
    }
  );
}
