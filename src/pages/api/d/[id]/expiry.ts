import type { APIRoute } from "astro";
import { getDB } from "../../../../../lib/db";
import { authorize } from "../../../../../lib/authorize";
import { readJson, rateLimit, parseFutureDate } from "../../../../../lib/request";

export const prerender = false;

// A document's expiry can be moved, within a bounded horizon, so nothing lives forever without
// a deliberate act. Setting a nearer (still-future) date is the "erase sooner" path: once the
// date passes, the document answers 410 and is deleted (at its next request, or by the daily
// cron). Requires the admin token, as does DELETE /api/d/:id, which erases it at once.
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000; // at most 1 year out

export const PUT: APIRoute = async ({ request, params }) => {
  const limited = rateLimit(request, "expiry", { max: 10, windowSec: 60 });
  if (limited) return limited;

  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "admin");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{ expires_at?: unknown }>(request);
  if (body instanceof Response) return body;

  const when = parseFutureDate(body.expires_at, { maxAheadMs: MAX_HORIZON_MS });
  if (when.error !== undefined) return Response.json({ error: when.error }, { status: 400 });

  const res = await db.prepare("UPDATE documents SET expires_at = ? WHERE id = ?").bind(when.iso, id).run();
  if (!res.meta?.changes) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ status: "updated", expires_at: when.iso });
};
