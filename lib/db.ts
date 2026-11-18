import { env } from "cloudflare:workers";

export function getDB(): D1Database {
  return (env as { DB: D1Database }).DB;
}

/** The RATE_LIMIT_SALT Worker secret, if set (see checkDurableRateLimit). */
export function rateLimitSalt(): string | undefined {
  return (env as { RATE_LIMIT_SALT?: string }).RATE_LIMIT_SALT || undefined;
}

export type { DocumentRow, LinkRow, CommentRow, VersionRow } from "./db-types";
