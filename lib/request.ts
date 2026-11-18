// Small request helpers shared by the API routes: JSON bodies, header text, input caps,
// dates and the per-isolate rate limit.
import { checkRateLimit, rateLimitResponse } from "./rate-limit.ts";

/** Caps on user-supplied text, in characters. Over the cap is a 400. */
export const LIMITS = {
  comment: 10_000,
  authorName: 100,
  anchorText: 5_000,
  label: 200,
} as const;

const bad = (error: string) => Response.json({ error }, { status: 400 });

/** The request's JSON object body, or a 400 Response when it isn't one. */
export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | Response> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as T;
  } catch {
    /* falls through to the 400 */
  }
  return bad("Invalid JSON body");
}

/**
 * A header that may carry non-Latin text. Browsers send it percent-encoded (fetch refuses raw
 * non-Latin header values); other clients send plain ASCII, which is kept as sent.
 */
export function decodeHeader(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The first non-empty string candidate, trimmed and cut to LIMITS.authorName; else "Anonymous". */
export function authorName(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().slice(0, LIMITS.authorName);
  }
  return "Anonymous";
}

/** A 400 naming the first [name, value, max] whose value is longer than max; else null. */
export function tooLong(fields: [name: string, value: unknown, max: number][]): Response | null {
  for (const [name, value, max] of fields) {
    if (typeof value === "string" && value.length > max) {
      return bad(`${name} is too long (max ${max} characters)`);
    }
  }
  return null;
}

/** A required ISO date that must be in the future (and at most maxAheadMs ahead), as toISOString(). */
export function parseFutureDate(
  raw: unknown,
  opts: { now?: number; maxAheadMs?: number } = {}
): { iso: string; error?: undefined } | { iso?: undefined; error: string } {
  const now = opts.now ?? Date.now();
  if (typeof raw !== "string" || !raw.trim()) return { error: "expires_at (ISO 8601) is required" };
  const when = new Date(raw).getTime();
  if (Number.isNaN(when)) return { error: "expires_at is not a valid date" };
  if (when <= now) return { error: "expires_at must be a future date" };
  if (opts.maxAheadMs !== undefined && when > now + opts.maxAheadMs) {
    return { error: "expires_at cannot be more than 1 year from now" };
  }
  return { iso: new Date(when).toISOString() };
}

/** The per-isolate rate limit for this client and action: null while allowed, else the 429. */
export function rateLimit(
  request: Request,
  action: string,
  config: { max: number; windowSec: number }
): Response | null {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const result = checkRateLimit(ip, action, config);
  return result.allowed ? null : rateLimitResponse(result);
}
