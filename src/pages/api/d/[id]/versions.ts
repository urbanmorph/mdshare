import type { APIRoute } from "astro";
import { getDB } from "../../../../../lib/db";
import { authorize } from "../../../../../lib/authorize";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "view");
  if (resolved instanceof Response) return resolved;

  const versions = await db
    .prepare(
      `SELECT id, edited_by, edited_via, content_hash, created_at
       FROM versions
       WHERE document_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 50`
    )
    .bind(id)
    .all();

  return Response.json({ versions: versions.results });
};
