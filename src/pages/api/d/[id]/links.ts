import type { APIRoute } from "astro";
import { nanoid } from "nanoid";
import { getDB } from "../../../../../lib/db";
import { authorize } from "../../../../../lib/authorize";
import { generateToken, hashToken, tokenPrefix } from "../../../../../lib/tokens";
import { encryptToken, decryptToken } from "../../../../../lib/token-crypto";
import { insertShareLink, MAX_ACTIVE_LINKS, SHARE_PERMISSIONS } from "../../../../../lib/links";
import type { NewLink } from "../../../../../lib/links";
import { readJson, rateLimit, tooLong, parseFutureDate, LIMITS } from "../../../../../lib/request";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  const limited = rateLimit(request, "link-create", { max: 20, windowSec: 60 });
  if (limited) return limited;

  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "admin");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{ permission?: unknown; label?: unknown; expires_at?: unknown }>(request);
  if (body instanceof Response) return body;

  const permission = body.permission as NewLink["permission"];
  if (!SHARE_PERMISSIONS.includes(permission)) {
    return Response.json(
      { error: `Invalid permission. Must be one of: ${SHARE_PERMISSIONS.join(", ")}` },
      { status: 400 }
    );
  }
  if (body.label != null && typeof body.label !== "string") {
    return Response.json({ error: "label must be a string" }, { status: 400 });
  }
  const label = body.label || null;
  const tooBig = tooLong([["label", label, LIMITS.label]]);
  if (tooBig) return tooBig;

  let expiresAt: string | null = null;
  if (body.expires_at != null && body.expires_at !== "") {
    const when = parseFutureDate(body.expires_at);
    if (when.error !== undefined) return Response.json({ error: when.error }, { status: 400 });
    expiresAt = when.iso;
  }

  const token = generateToken(permission);
  const linkId = nanoid(16);
  const created = await insertShareLink(db, {
    id: linkId,
    documentId: id,
    prefix: tokenPrefix(token),
    hash: await hashToken(token),
    permission,
    label,
    token: await encryptToken(token),
    expiresAt,
  });
  if (!created) {
    return Response.json(
      { error: `Link limit reached. Maximum ${MAX_ACTIVE_LINKS} active share links per document.` },
      { status: 400 }
    );
  }

  const baseUrl = new URL(request.url).origin;

  return Response.json(
    {
      id: linkId,
      token,
      url: `${baseUrl}/d/${id}?key=${token}`,
      permission,
      label,
      expires_at: expiresAt,
    },
    { status: 201 }
  );
};

export const GET: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const db = getDB();
  const resolved = await authorize(db, request, id, "admin");
  if (resolved instanceof Response) return resolved;

  const baseUrl = new URL(request.url).origin;

  const links = await db
    .prepare(
      `SELECT id, permission, label, is_active, expires_at, created_at, token
       FROM links
       WHERE document_id = ? AND permission != 'admin'
       ORDER BY created_at DESC`
    )
    .bind(id)
    .all<{
      id: string;
      permission: string;
      label: string | null;
      is_active: number;
      expires_at: string | null;
      created_at: string;
      token: string | null;
    }>();

  const linksWithUrls = await Promise.all(
    (links.results || []).map(async (link) => {
      const rawToken = await decryptToken(link.token);
      return {
        ...link,
        token: rawToken,
        url: rawToken ? `${baseUrl}/d/${id}?key=${rawToken}` : null,
      };
    })
  );

  return Response.json({ links: linksWithUrls });
};
