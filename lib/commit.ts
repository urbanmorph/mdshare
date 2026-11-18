// Saving a document's content, shared by PUT (whole content) and PATCH (find/replace).
import { nanoid } from "nanoid";
import { sanitizeMarkdown, contentHash, titleFrom } from "./sanitize.ts";
import { isStaleWrite } from "./base-hash.ts";

type Current = { content: string; content_hash: string };

export interface CommitOptions {
  /** the content (and its hash) the write was based on, as read when the request was authorized */
  current: Current;
  /** the new content, not yet sanitized */
  raw: string;
  /** the X-Base-Hash the writer sent, if any */
  baseHash: string | null;
  editedVia: string;
  editedBy: string;
  /** when the request started, for processing_ms and Server-Timing */
  t0: number;
  /** fields added to the success reply (PATCH's applied and operations) */
  extra?: Record<string, unknown>;
  /** tells the document's live sessions (lib/broadcast.ts); injected so this runs outside Workers */
  broadcast?: (id: string, content: string, hash: string) => Promise<void>;
}

const conflict = (now: Current) =>
  Response.json({ error: "conflict", content: now.content, content_hash: now.content_hash }, { status: 409 });

/**
 * Sanitize and save new content for document `id`, keeping the previous content as a version.
 *
 * The version insert and the update only apply while the document still has the hash it had
 * when `current` was read, in one batch (one transaction). So of two writers that read the same
 * content, the second finds the hash moved and gets a 409 with the newer content, whether or not
 * it sent a base hash; nothing of its write is kept.
 */
export async function commitContent(db: D1Database, id: string, o: CommitOptions): Promise<Response> {
  const tSanitize = Date.now();
  let content: string;
  try {
    content = await sanitizeMarkdown(o.raw);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
  const hash = await contentHash(content);
  const sanitizeMs = Date.now() - tSanitize;

  if (hash === o.current.content_hash) {
    return Response.json({ ...o.extra, status: "unchanged", content_hash: hash, processing_ms: Date.now() - o.t0 });
  }

  // A stale writer (an editor tab that missed newer content) must not overwrite it.
  if (isStaleWrite(o.baseHash, o.current.content_hash)) return conflict(o.current);

  const tDb = Date.now();
  const [, update] = await db.batch([
    db
      .prepare(
        `INSERT INTO versions (id, document_id, content, content_hash, edited_via, edited_by)
         SELECT ?, id, content, content_hash, ?, ? FROM documents WHERE id = ? AND content_hash = ?`
      )
      .bind(nanoid(16), o.editedVia, o.editedBy, id, o.current.content_hash),
    db
      .prepare(
        `UPDATE documents SET content = ?, content_hash = ?, title = COALESCE(?, title), updated_at = datetime('now')
         WHERE id = ? AND content_hash = ?`
      )
      .bind(content, hash, titleFrom(content), id, o.current.content_hash),
  ]);
  const dbMs = Date.now() - tDb;

  if (!update.meta?.changes) {
    // another write landed since `current` was read (or the document is gone)
    const now = await db
      .prepare("SELECT content, content_hash FROM documents WHERE id = ?")
      .bind(id)
      .first<Current>();
    return now ? conflict(now) : Response.json({ error: "Not found" }, { status: 404 });
  }

  await o.broadcast?.(id, content, hash);

  const totalMs = Date.now() - o.t0;
  return Response.json(
    { ...o.extra, status: "updated", content_hash: hash, processing_ms: totalMs },
    { headers: { "Server-Timing": `sanitize;dur=${sanitizeMs}, db;dur=${dbMs}, total;dur=${totalMs}` } }
  );
}

export type OperationResult = { index: number; status: "ok" | "not_found" | "ambiguous" | "invalid" };

/**
 * Apply PATCH find/replace operations in order. Each needs a non-empty string `find` and a string
 * `replace`; anything else is reported "invalid". A 400 when `operations` isn't a non-empty array.
 */
export function applyOperations(
  content: string,
  operations: unknown
): { content: string; results: OperationResult[]; applied: number } | Response {
  if (!Array.isArray(operations) || operations.length === 0) {
    return Response.json({ error: "operations array is required" }, { status: 400 });
  }
  const results: OperationResult[] = [];
  operations.forEach((op: unknown, index) => {
    const { find, replace, replace_all } = (op && typeof op === "object" ? op : {}) as Record<string, unknown>;
    if (typeof find !== "string" || !find || typeof replace !== "string") {
      results.push({ index, status: "invalid" });
      return;
    }
    const first = content.indexOf(find);
    if (first === -1) {
      results.push({ index, status: "not_found" });
    } else if (replace_all) {
      content = content.split(find).join(replace);
      results.push({ index, status: "ok" });
    } else if (first !== content.lastIndexOf(find)) {
      results.push({ index, status: "ambiguous" });
    } else {
      content = content.slice(0, first) + replace + content.slice(first + find.length);
      results.push({ index, status: "ok" });
    }
  });
  return { content, results, applied: results.filter((r) => r.status === "ok").length };
}
