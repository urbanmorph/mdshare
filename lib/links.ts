// Creating share links: the cap and the documents_shared stat, in one D1 batch.
import type { Permission } from "./tokens.ts";

/** At most this many working (active, unexpired) share links per document. */
export const MAX_ACTIVE_LINKS = 50;

/** How many of document ?'s share links work now (active, unexpired). */
export const ACTIVE_LINKS_SQL = `(SELECT COUNT(*) FROM links
  WHERE document_id = ? AND permission != 'admin' AND is_active = 1
    AND (expires_at IS NULL OR julianday(expires_at) > julianday('now')))`;

export type SharePermission = Exclude<Permission, "admin">;
export const SHARE_PERMISSIONS: SharePermission[] = ["view", "edit", "comment"];

export interface NewLink {
  id: string;
  documentId: string;
  prefix: string;
  hash: string;
  permission: SharePermission;
  label: string | null;
  /** the token, encrypted (lib/token-crypto.ts) */
  token: string | null;
  expiresAt: string | null;
}

/**
 * Insert a share link unless the document already has MAX_ACTIVE_LINKS working ones, and count
 * the document as shared on its first share link. One round trip. False when the cap refused it.
 */
export async function insertShareLink(db: D1Database, l: NewLink): Promise<boolean> {
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO links (id, document_id, token_prefix, token_hash, permission, label, token, expires_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${ACTIVE_LINKS_SQL} < ?`
      )
      .bind(l.id, l.documentId, l.prefix, l.hash, l.permission, l.label, l.token, l.expiresAt, l.documentId, MAX_ACTIVE_LINKS),
    db
      .prepare(
        `UPDATE stats SET value = value + 1 WHERE key = 'documents_shared'
         AND (SELECT COUNT(*) FROM links WHERE document_id = ? AND permission != 'admin') = 1`
      )
      .bind(l.documentId),
  ]);
  return !!insert.meta?.changes;
}
