import type { APIRoute } from "astro";
import { getDB } from "../../../../lib/db";
import { checkDurableRateLimit, rateLimitResponse } from "../../../../lib/rate-limit";
import { d1KeyringStore, deleteKeyring, getKeyring, putKeyring, writeKeyFrom } from "../../../../lib/keyrings";

// "Recent documents" sync: an encrypted blob per keyring (see lib/keyrings.ts).
export const prerender = false;

export const GET: APIRoute = ({ params }) => getKeyring(d1KeyringStore(getDB()), params.id!);

export const PUT: APIRoute = async ({ request, params }) => {
  const db = getDB();
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const limit = await checkDurableRateLimit(db, ip, "keyring-write", { max: 120, windowSec: 3600 });
  if (!limit.allowed) return rateLimitResponse(limit);
  const body = (await request.json().catch(() => null)) as { blob?: unknown; base?: unknown } | null;
  return putKeyring(d1KeyringStore(db), params.id!, writeKeyFrom(request), body);
};

export const DELETE: APIRoute = ({ request, params }) =>
  deleteKeyring(d1KeyringStore(getDB()), params.id!, writeKeyFrom(request));
