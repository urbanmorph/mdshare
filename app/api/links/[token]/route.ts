import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { resolveToken } from "@/lib/permissions";
import { tokenPrefix as getTokenPrefix } from "@/lib/tokens";
import type { Permission } from "@/lib/tokens";

export const dynamic = "force-dynamic";

const VALID_PERMISSIONS: Permission[] = ["view", "edit", "comment"];

/**
 * PATCH /api/links/:token?key=ADMIN_TOKEN — Modify a link.
 * Admin only. Can change permission, label, or active status.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: targetToken } = await params;
  const adminKey = request.nextUrl.searchParams.get("key");
  if (!adminKey) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDB();

  // Resolve the target link to find its document
  const targetResolved = await resolveToken(db, targetToken);
  if (!targetResolved) {
    return Response.json({ error: "Link not found" }, { status: 404 });
  }

  // Verify admin has access to this document
  const adminResolved = await resolveToken(db, adminKey);
  if (
    !adminResolved ||
    adminResolved.documentId !== targetResolved.documentId ||
    adminResolved.permission !== "admin"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    permission?: string;
    label?: string;
    is_active?: boolean;
  };
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.permission) {
    if (!VALID_PERMISSIONS.includes(body.permission as Permission)) {
      return Response.json({ error: "Invalid permission" }, { status: 400 });
    }
    updates.push("permission = ?");
    values.push(body.permission);
  }

  if (body.label !== undefined) {
    updates.push("label = ?");
    values.push(body.label);
  }

  if (body.is_active !== undefined) {
    updates.push("is_active = ?");
    values.push(body.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return Response.json({ error: "No updates provided" }, { status: 400 });
  }

  values.push(targetResolved.linkId);

  await db
    .prepare(`UPDATE links SET ${updates.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  return Response.json({ status: "updated" });
}

/**
 * DELETE /api/links/:token?key=ADMIN_TOKEN — Revoke a link.
 * Admin only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: targetToken } = await params;
  const adminKey = request.nextUrl.searchParams.get("key");
  if (!adminKey) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const db = getDB();

  const targetResolved = await resolveToken(db, targetToken);
  if (!targetResolved) {
    return Response.json({ error: "Link not found" }, { status: 404 });
  }

  const adminResolved = await resolveToken(db, adminKey);
  if (
    !adminResolved ||
    adminResolved.documentId !== targetResolved.documentId ||
    adminResolved.permission !== "admin"
  ) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Don't allow deleting the admin link itself
  if (targetResolved.permission === "admin") {
    return Response.json(
      { error: "Cannot revoke admin link" },
      { status: 400 }
    );
  }

  await db.prepare("DELETE FROM links WHERE id = ?").bind(targetResolved.linkId).run();

  return Response.json({ status: "revoked" });
}
