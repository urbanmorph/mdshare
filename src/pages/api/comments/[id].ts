import type { APIRoute } from "astro";
import { getDB } from "../../../../lib/db";
import { authorize } from "../../../../lib/authorize";
import { readJson, rateLimit } from "../../../../lib/request";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
  const limited = rateLimit(request, "comment-update", { max: 30, windowSec: 60 });
  if (limited) return limited;

  const commentId = params.id!;
  const db = getDB();

  const comment = await db
    .prepare("SELECT document_id FROM comments WHERE id = ?")
    .bind(commentId)
    .first<{ document_id: string }>();
  if (!comment) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  const resolved = await authorize(db, request, comment.document_id, "edit");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{ resolved?: unknown }>(request);
  if (body instanceof Response) return body;

  if (body.resolved !== undefined) {
    const resolvedVal = body.resolved ? 1 : 0;
    await db.batch([
      db.prepare("UPDATE comments SET resolved = ? WHERE id = ?").bind(resolvedVal, commentId),
      db.prepare("UPDATE comments SET resolved = ? WHERE parent_id = ?").bind(resolvedVal, commentId),
    ]);
  }

  return Response.json({ status: "updated" });
};
