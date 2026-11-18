// The gate in front of every document API route: the ?key must open document `id` (404
// otherwise, never a hint that the document exists), the document must not have expired (410,
// even before the daily cron deletes it) and the key must allow `need` (403).
import { resolveAccess, resolveDocument, isExpired, canPerform } from "./permissions.ts";
import type { ResolvedAccess, ResolvedDocument, ResolvedPermission } from "./permissions.ts";
import type { Permission } from "./tokens.ts";

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

function keyOf(request: Request): string | null {
  return new URL(request.url).searchParams.get("key");
}

async function gate<T extends ResolvedPermission>(
  db: D1Database,
  resolved: T | null,
  expiresAt: string | null | undefined,
  need: Permission
): Promise<T | Response> {
  if (!resolved) return notFound();
  if (isExpired(expiresAt)) {
    // erase it now rather than at the next daily run; the condition guards a concurrent extension
    await db
      .prepare("DELETE FROM documents WHERE id = ? AND julianday(expires_at) < julianday('now')")
      .bind(resolved.documentId)
      .run();
    return Response.json({ error: "Document has expired" }, { status: 410 });
  }
  if (!canPerform(resolved.permission, need)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return resolved;
}

/**
 * May the request's ?key do `need` on document `id`? One D1 round trip, without the content.
 * With `id` null: on whichever document the key opens. Returns the resolution or the error Response.
 */
export async function authorize(
  db: D1Database,
  request: Request,
  id: string | null,
  need: Permission
): Promise<ResolvedAccess | Response> {
  const key = keyOf(request);
  if (!key) return notFound();
  const resolved = await resolveAccess(db, key, id);
  return gate(db, resolved, resolved?.docExpiresAt, need);
}

/** authorize, plus the document's row (content included), still in one round trip. */
export async function authorizeDocument(
  db: D1Database,
  request: Request,
  id: string,
  need: Permission
): Promise<ResolvedDocument | Response> {
  const key = keyOf(request);
  if (!key) return notFound();
  const resolved = await resolveDocument(db, key, id);
  return gate(db, resolved, resolved?.doc.expires_at, need);
}
