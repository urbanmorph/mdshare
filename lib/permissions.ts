import { tokenPrefix, verifyToken } from "./tokens";
import type { Permission } from "./tokens";

export interface ResolvedPermission {
  permission: Permission;
  documentId: string;
  linkId: string;
}

/**
 * Resolve a token to its permission level by looking it up in D1.
 * Returns null if the token is invalid, inactive, or expired.
 */
export async function resolveToken(
  db: D1Database,
  token: string
): Promise<ResolvedPermission | null> {
  const prefix = tokenPrefix(token);

  const rows = await db
    .prepare(
      `SELECT id, document_id, token_hash, permission, is_active, expires_at
       FROM links
       WHERE token_prefix = ?`
    )
    .bind(prefix)
    .all<{
      id: string;
      document_id: string;
      token_hash: string;
      permission: Permission;
      is_active: number;
      expires_at: string | null;
    }>();

  if (!rows.results || rows.results.length === 0) return null;

  // Check each candidate (there could be prefix collisions)
  for (const row of rows.results) {
    if (!row.is_active) continue;

    // Check expiry
    if (row.expires_at && new Date(row.expires_at) < new Date()) continue;

    // Verify full token hash
    const matches = await verifyToken(token, row.token_hash);
    if (matches) {
      return {
        permission: row.permission,
        documentId: row.document_id,
        linkId: row.id,
      };
    }
  }

  return null;
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
