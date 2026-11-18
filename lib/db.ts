import { env } from "cloudflare:workers";

export function getDB(): D1Database {
  return (env as { DB: D1Database }).DB;
}

/** The RATE_LIMIT_SALT Worker secret, if set (see checkDurableRateLimit). */
export function rateLimitSalt(): string | undefined {
  return (env as { RATE_LIMIT_SALT?: string }).RATE_LIMIT_SALT || undefined;
}

/** A document's comments and replies, oldest first, as the API returns them. */
export function commentsQuery(db: D1Database, documentId: string): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id, author_name, content, anchor_text, anchor_start, anchor_end, resolved, parent_id, created_at
       FROM comments WHERE document_id = ? ORDER BY created_at ASC`
    )
    .bind(documentId);
}

export type { DocumentRow } from "./db-types";
