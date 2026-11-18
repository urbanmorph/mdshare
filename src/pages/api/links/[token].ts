import type { APIRoute } from "astro";
import { getDB } from "../../../../lib/db";
import { authorize } from "../../../../lib/authorize";
import { findLink } from "../../../../lib/permissions";
import { SHARE_PERMISSIONS, ACTIVE_LINKS_SQL, MAX_ACTIVE_LINKS } from "../../../../lib/links";
import type { SharePermission } from "../../../../lib/links";
import { readJson, tooLong, LIMITS } from "../../../../lib/request";

export const prerender = false;

// /api/links/:link?key=<admin key>. :link is the link's id (from GET /api/d/:id/links), or its
// token, kept for older clients. Either way it is looked up among the admin key's own document's
// links, revoked and expired ones included, so a revoked link can be re-activated or deleted.
// The admin link itself can't be changed or deleted here.

async function target(request: Request, linkParam: string) {
  const db = getDB();
  const admin = await authorize(db, request, null, "admin");
  if (admin instanceof Response) return admin;
  const link = await findLink(db, admin.documentId, linkParam);
  if (!link) return Response.json({ error: "Link not found" }, { status: 404 });
  if (link.permission === "admin") {
    return Response.json({ error: "Cannot change or revoke the admin link" }, { status: 400 });
  }
  return { db, documentId: admin.documentId, linkId: link.id };
}

export const PATCH: APIRoute = async ({ request, params }) => {
  const t = await target(request, params.token!);
  if (t instanceof Response) return t;

  const body = await readJson<{ permission?: unknown; label?: unknown; is_active?: unknown }>(request);
  if (body instanceof Response) return body;

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.permission !== undefined) {
    if (!SHARE_PERMISSIONS.includes(body.permission as SharePermission)) {
      return Response.json({ error: "Invalid permission" }, { status: 400 });
    }
    updates.push("permission = ?");
    values.push(body.permission as SharePermission);
  }

  if (body.label !== undefined) {
    if (body.label !== null && typeof body.label !== "string") {
      return Response.json({ error: "label must be a string" }, { status: 400 });
    }
    const tooBig = tooLong([["label", body.label, LIMITS.label]]);
    if (tooBig) return tooBig;
    updates.push("label = ?");
    values.push(body.label || null);
  }

  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  // re-activating a link must not take the document past the cap of working links
  const res = await t.db
    .prepare(
      `UPDATE links SET ${updates.join(", ")} WHERE id = ? AND document_id = ?
       AND (? = 0 OR is_active = 1 OR ${ACTIVE_LINKS_SQL} < ?)`
    )
    .bind(...values, t.linkId, t.documentId, body.is_active ? 1 : 0, t.documentId, MAX_ACTIVE_LINKS)
    .run();
  if (!res.meta?.changes) {
    return Response.json(
      { error: `Link limit reached. Maximum ${MAX_ACTIVE_LINKS} active share links per document.` },
      { status: 400 }
    );
  }

  return Response.json({ status: "updated" });
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const t = await target(request, params.token!);
  if (t instanceof Response) return t;

  await t.db.prepare("DELETE FROM links WHERE id = ? AND document_id = ?").bind(t.linkId, t.documentId).run();

  return Response.json({ status: "revoked" });
};
