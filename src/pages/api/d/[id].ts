import type { APIRoute } from "astro";
import { getDB } from "../../../../lib/db";
import { authorize, authorizeDocument } from "../../../../lib/authorize";
import { commitContent, applyOperations } from "../../../../lib/commit";
import type { CommitOptions } from "../../../../lib/commit";
import { broadcastUpdate } from "../../../../lib/broadcast";
import { BASE_HASH_HEADER } from "../../../../lib/base-hash";
import { readJson, rateLimit, decodeHeader, authorName } from "../../../../lib/request";

export const prerender = false;

export const GET: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const db = getDB();
  const resolved = await authorizeDocument(db, request, id, "view");
  if (resolved instanceof Response) return resolved;
  const { doc } = resolved;

  const accept = request.headers.get("accept") || "";

  if (accept.includes("text/markdown")) {
    return new Response(doc.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Source": "user-generated",
      },
    });
  }

  const lastVersion = await db
    .prepare(
      `SELECT edited_by, edited_via, created_at FROM versions
       WHERE document_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(id)
    .first<{ edited_by: string | null; edited_via: string | null; created_at: string }>();

  return Response.json(
    {
      document_id: doc.id,
      title: doc.title,
      content: doc.content,
      content_hash: doc.content_hash,
      permission: resolved.permission,
      last_edited_by: lastVersion?.edited_by || null,
      last_edited_via: lastVersion?.edited_via || null,
      last_edited_at: lastVersion?.created_at || null,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      expires_at: doc.expires_at || null,
    },
    { headers: { "X-Content-Source": "user-generated" } }
  );
};

/** What every save records: how and by whom (X-Author is percent-encoded by the browser). */
function editor(request: Request, bodyAuthor?: unknown): Pick<CommitOptions, "baseHash" | "editedVia" | "editedBy" | "broadcast"> {
  return {
    baseHash: request.headers.get(BASE_HASH_HEADER),
    editedVia: (request.headers.get("x-edited-via") || "api").slice(0, 32),
    editedBy: authorName(bodyAuthor, decodeHeader(request.headers.get("x-author"))),
    broadcast: broadcastUpdate,
  };
}

export const PUT: APIRoute = async ({ request, params }) => {
  const t0 = Date.now();
  const limited = rateLimit(request, "update", { max: 30, windowSec: 60 });
  if (limited) return limited;

  const id = params.id!;
  const db = getDB();
  const resolved = await authorizeDocument(db, request, id, "edit");
  if (resolved instanceof Response) return resolved;

  const raw = await request.text();
  if (!raw.trim()) {
    return Response.json({ error: "Empty content" }, { status: 400 });
  }

  return commitContent(db, id, { current: resolved.doc, raw, t0, ...editor(request) });
};

export const PATCH: APIRoute = async ({ request, params }) => {
  const t0 = Date.now();
  const limited = rateLimit(request, "update", { max: 30, windowSec: 60 });
  if (limited) return limited;

  const id = params.id!;
  const db = getDB();
  const resolved = await authorizeDocument(db, request, id, "edit");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{ operations?: unknown; author?: unknown }>(request);
  if (body instanceof Response) return body;

  const patched = applyOperations(resolved.doc.content, body.operations);
  if (patched instanceof Response) return patched;
  const { applied, results } = patched;
  if (applied === 0) {
    return Response.json({ applied: 0, operations: results }, { status: 422 });
  }

  return commitContent(db, id, {
    current: resolved.doc,
    raw: patched.content,
    t0,
    extra: { applied, operations: results },
    ...editor(request, body.author),
  });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const db = getDB();
  const resolved = await authorize(db, request, params.id!, "admin");
  if (resolved instanceof Response) return resolved;

  await db.prepare("DELETE FROM documents WHERE id = ?").bind(resolved.documentId).run();

  return Response.json({ status: "deleted" });
};
