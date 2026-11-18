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

/**
 * Resolve a token to its permission level by looking it up in D1.
 * Returns null if the token is invalid, inactive, or expired.
 */
export async function resolveToken(
  db: D1Database,
  token: string
): Promise<ResolvedPermission | null> {
  const { results } = await db
    .prepare(
      `SELECT id AS link_id, document_id, token_hash, permission, is_active, expires_at AS link_expires_at
       FROM links
       WHERE token_prefix = ?`
    )
    .bind(tokenPrefix(token))
    .all<LinkCandidate>();

  const row = await firstValidLink(token, results);
  return row && { permission: row.permission, documentId: row.document_id, linkId: row.link_id };
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
