import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { resolveToken } from "@/lib/permissions";
import { heartbeat, getPresence } from "@/lib/presence";

export const dynamic = "force-dynamic";

/**
 * POST /api/d/:id/poll?key=TOKEN — Combined polling endpoint.
 * Returns document hash, comments, and presence in a single request.
 * Body: { session_id, name } for presence heartbeat.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return Response.json({ error: "Not found" }, { status: 404 });

  const db = getDB();
  const resolved = await resolveToken(db, key);
  if (!resolved || resolved.documentId !== id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    session_id?: string;
    name?: string;
    content_hash?: string;
  };

  // Presence heartbeat
  if (body.session_id) {
    heartbeat(id, body.session_id, body.name || "Anonymous");
  }

  // Get document hash + content only if changed
  const doc = await db
    .prepare("SELECT content, content_hash, updated_at FROM documents WHERE id = ?")
    .bind(id)
    .first<{ content: string; content_hash: string; updated_at: string }>();

  if (!doc) return Response.json({ error: "Not found" }, { status: 404 });

  const contentChanged = body.content_hash && doc.content_hash !== body.content_hash;

  // Get comments
  const comments = await db
    .prepare(
      `SELECT id, author_name, content, anchor_text, anchor_start, anchor_end, resolved, created_at
       FROM comments WHERE document_id = ? ORDER BY created_at DESC`
    )
    .bind(id)
    .all();

  // Get presence
  const viewers = getPresence(id);

  return Response.json({
    content_hash: doc.content_hash,
    content: contentChanged ? doc.content : undefined,
    updated_at: doc.updated_at,
    comments: comments.results,
    viewers,
    viewer_count: viewers.length,
  });
}
