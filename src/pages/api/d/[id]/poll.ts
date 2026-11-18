import type { APIRoute } from "astro";
import { getDB, commentsQuery } from "../../../../../lib/db";
import { authorize } from "../../../../../lib/authorize";
import { heartbeat, getPresence } from "../../../../../lib/presence";
import { readJson, rateLimit, authorName } from "../../../../../lib/request";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  const limited = rateLimit(request, "poll", { max: 20, windowSec: 60 });
  if (limited) return limited;

  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "view");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{ session_id?: unknown; name?: unknown; content_hash?: unknown }>(request);
  if (body instanceof Response) return body;

  if (typeof body.session_id === "string" && body.session_id) {
    heartbeat(id, body.session_id.slice(0, 64), authorName(body.name));
  }

  // The content only when the client has an older hash: most polls find nothing new.
  const known = typeof body.content_hash === "string" && body.content_hash ? body.content_hash : null;
  const [docResult, comments] = await db.batch([
    db
      .prepare(
        `SELECT content_hash, updated_at, CASE WHEN ? IS NOT NULL AND content_hash != ? THEN content END AS content
         FROM documents WHERE id = ?`
      )
      .bind(known, known, id),
    commentsQuery(db, id),
  ]);
  const doc = (docResult.results as { content_hash: string; updated_at: string; content: string | null }[])[0];
  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const viewers = getPresence(id);

  return Response.json({
    content_hash: doc.content_hash,
    content: doc.content ?? undefined,
    updated_at: doc.updated_at,
    comments: comments.results,
    viewers,
    viewer_count: viewers.length,
  });
};
