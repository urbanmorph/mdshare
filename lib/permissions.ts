import { tokenPrefix, verifyToken } from "./tokens.ts";
import type { Permission } from "./tokens.ts";
import type { DocumentRow } from "./db-types.ts";

export interface ResolvedPermission {
  permission: Permission;
  documentId: string;
  linkId: string;
}

export interface ResolvedDocument extends ResolvedPermission {
  doc: DocumentRow;
}

interface LinkCandidate {
  link_id: string;
  document_id: string;
  token_hash: string;
  permission: Permission;
  is_active: number;
  link_expires_at: string | null;
}

/**
 * The first candidate that is active, unexpired and whose stored hash matches
 * the full token. Rows share an 8-char prefix, so there can be several.
 */
async function firstValidLink<T extends LinkCandidate>(token: string, rows: T[] | undefined): Promise<T | null> {
  for (const row of rows ?? []) {
    if (!row.is_active) continue;
    if (row.link_expires_at && new Date(row.link_expires_at) < new Date()) continue;
    if (await verifyToken(token, row.token_hash)) return row;
  }
  return null;
}

export interface ResolvedAccess extends ResolvedPermission {
  /** the document's own expiry (not the link's) */
  docExpiresAt: string | null;
}

/**
 * Resolve a token to its permission on a document that still exists, in one D1 round trip,
 * without reading the content. With `id`, only a link of that document; with null, whichever
 * document the token opens. Null if the token is unknown, inactive or expired, or the
 * document is gone. The document's own expiry is the caller's to check (isExpired).
 */
export async function resolveAccess(
  db: D1Database,
  token: string,
  id: string | null
): Promise<ResolvedAccess | null> {
  const { results } = await db
    .prepare(
      `SELECT l.id AS link_id, l.document_id, l.token_hash, l.permission, l.is_active,
              l.expires_at AS link_expires_at, d.expires_at AS doc_expires_at
       FROM links l JOIN documents d ON d.id = l.document_id
       WHERE l.token_prefix = ? AND (? IS NULL OR l.document_id = ?)`
    )
    .bind(tokenPrefix(token), id, id)
    .all<LinkCandidate & { doc_expires_at: string | null }>();

  const row = await firstValidLink(token, results);
  return (
    row && {
      permission: row.permission,
      documentId: row.document_id,
      linkId: row.link_id,
      docExpiresAt: row.doc_expires_at,
    }
  );
}

/** Whether a document's expires_at (an ISO string, or null for never) has passed. */
export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  return !!expiresAt && Date.parse(expiresAt) < now;
}

/**
 * One of a document's links, addressed by its id or by its token, whatever its state: revoked
 * and expired links included, so an admin can re-activate or delete them. Never a link of
 * another document; a token must match the stored hash, not just the prefix.
 */
export async function findLink(
  db: D1Database,
  documentId: string,
  idOrToken: string
): Promise<{ id: string; permission: Permission } | null> {
  if (!idOrToken) return null;
  const { results } = await db
    .prepare(
      `SELECT id, permission, token_hash FROM links
       WHERE document_id = ? AND (id = ? OR token_prefix = ?)`
    )
    .bind(documentId, idOrToken, tokenPrefix(idOrToken))
    .all<{ id: string; permission: Permission; token_hash: string }>();
  for (const row of results ?? []) {
    if (row.id === idOrToken || (await verifyToken(idOrToken, row.token_hash))) {
      return { id: row.id, permission: row.permission };
    }
  }
  return null;
}

/**
 * Resolve a token for one document and fetch that document, in a single D1
 * round trip. Same checks as resolveToken plus `documentId === id`, and null
 * when the document no longer exists.
 */
export async function resolveDocument(
  db: D1Database,
  token: string,
  id: string
): Promise<ResolvedDocument | null> {
  const { results } = await db
    .prepare(
      `SELECT l.id AS link_id, l.document_id, l.token_hash, l.permission, l.is_active,
              l.expires_at AS link_expires_at, d.*
       FROM links l JOIN documents d ON d.id = l.document_id
       WHERE l.token_prefix = ? AND l.document_id = ?`
    )
    .bind(tokenPrefix(token), id)
    .all<LinkCandidate & DocumentRow>();

  const row = await firstValidLink(token, results);
  if (!row) return null;
  // strip the link columns so the token hash never reaches the page's props
  const { link_id, document_id, permission, token_hash: _h, is_active: _a, link_expires_at: _e, ...doc } = row;
  return { permission, documentId: document_id, linkId: link_id, doc };
}

/**
 * Check if a permission level can perform an action.
 */
const PERMISSION_HIERARCHY: Record<Permission, number> = {
  admin: 4,
  edit: 3,
  comment: 2,
  view: 1,
};

export function canPerform(
  has: Permission,
  needs: Permission
): boolean {
  return PERMISSION_HIERARCHY[has] >= PERMISSION_HIERARCHY[needs];
}
