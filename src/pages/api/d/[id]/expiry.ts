import type { APIRoute } from "astro";
import { getDB } from "../../../../../lib/db";
import { resolveToken } from "../../../../../lib/permissions";

export const prerender = false;

// A document's expiry can be moved, but only forward in time and within a
// bounded horizon, so nothing lives forever without a deliberate act. Setting a
// nearer (still-future) date is the honest "erase sooner" path — the daily cron
// (or the next authenticated read) deletes the document once the date passes.
// Requires the admin token; there is intentionally no self-serve hard delete.
const MAX_HORIZON_MS = 365 * 24 * 60 * 60 * 1000; // at most 1 year out

export const PUT: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDB();
  const resolved = await resolveToken(db, key);
  if (!resolved || resolved.documentId !== id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (resolved.permission !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { expires_at?: unknown };
  try {
    body = (await request.json()) as { expires_at?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = body.expires_at;
  if (typeof raw !== "string" || !raw.trim()) {
    return Response.json({ error: "expires_at (ISO 8601) is required" }, { status: 400 });
  }

  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return Response.json({ error: "expires_at is not a valid date" }, { status: 400 });
  }

  const now = Date.now();
  if (when.getTime() <= now) {
    return Response.json({ error: "expires_at must be a future date" }, { status: 400 });
  }
  if (when.getTime() > now + MAX_HORIZON_MS) {
    return Response.json(
      { error: "expires_at cannot be more than 1 year from now" },
      { status: 400 }
    );
  }

  // Store in the same ISO format used at creation.
  const iso = when.toISOString();
  const res = await db
    .prepare("UPDATE documents SET expires_at = ? WHERE id = ?")
    .bind(iso, id)
    .run();

  if (!res.meta?.changes) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ status: "updated", expires_at: iso });
};
