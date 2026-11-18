import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { getDB, commentsQuery } from "../../../../../lib/db";
import { authorize } from "../../../../../lib/authorize";
import { readJson, rateLimit, tooLong, LIMITS } from "../../../../../lib/request";
import { incrementStatStatement } from "../../../../../lib/stats";

export const prerender = false;

const optionalInt = (v: unknown) => v === undefined || v === null || Number.isInteger(v);

export const POST: APIRoute = async ({ request, params }) => {
  const limited = rateLimit(request, "comment", { max: 20, windowSec: 60 });
  if (limited) return limited;

  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "comment");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{
    content?: unknown;
    author_name?: unknown;
    anchor_text?: unknown;
    anchor_start?: unknown;
    anchor_end?: unknown;
    parent_id?: unknown;
  }>(request);
  if (body instanceof Response) return body;

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return Response.json({ error: "Comment content required" }, { status: 400 });
  }
  const authorName = (typeof body.author_name === "string" && body.author_name.trim()) || "Anonymous";
  const anchorText = (typeof body.anchor_text === "string" && body.anchor_text) || null;
  const tooBig = tooLong([
    ["content", content, LIMITS.comment],
    ["author_name", authorName, LIMITS.authorName],
    ["anchor_text", anchorText, LIMITS.anchorText],
  ]);
  if (tooBig) return tooBig;
  if (!optionalInt(body.anchor_start) || !optionalInt(body.anchor_end)) {
    return Response.json({ error: "anchor_start and anchor_end must be integers" }, { status: 400 });
  }

  let parentId = typeof body.parent_id === "string" && body.parent_id ? body.parent_id : null;
  if (parentId) {
    const parent = await db
      .prepare("SELECT parent_id FROM comments WHERE id = ? AND document_id = ?")
      .bind(parentId, id)
      .first<{ parent_id: string | null }>();
    if (!parent) {
      return Response.json({ error: "Parent comment not found" }, { status: 400 });
    }
    // one level of replies: a reply to a reply joins its thread
    if (parent.parent_id) parentId = parent.parent_id;
  }

  const commentId = nanoid(16);
  const statements = [
    db
      .prepare(
        `INSERT INTO comments (id, document_id, author_name, content, anchor_text, anchor_start, anchor_end, parent_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(commentId, id, authorName, content, anchorText, body.anchor_start ?? null, body.anchor_end ?? null, parentId),
    incrementStatStatement(db, "comments_posted"),
  ];
  if (authorName !== "Anonymous") {
    // a collaborator is a name's first comment anywhere (indexed: migrations/0011)
    statements.push(
      db
        .prepare(
          `UPDATE stats SET value = value + 1 WHERE key = 'collaborators'
           AND NOT EXISTS (SELECT 1 FROM comments WHERE author_name = ? AND id != ?)`
        )
        .bind(authorName, commentId)
    );
  }
  await db.batch(statements);

  return Response.json({ id: commentId, status: "created" }, { status: 201 });
};

export const GET: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "view");
  if (resolved instanceof Response) return resolved;

  const comments = await commentsQuery(db, id).all();

  return Response.json({ comments: comments.results });
};
