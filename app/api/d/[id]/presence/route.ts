import { NextRequest } from "next/server";
import { getDB } from "@/lib/db";
import { resolveToken } from "@/lib/permissions";
import { heartbeat, getPresence } from "@/lib/presence";

export const dynamic = "force-dynamic";

/**
 * POST /api/d/:id/presence?key=TOKEN — Send a heartbeat.
 * Body: { session_id, name }
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

  const body = (await request.json()) as { session_id: string; name: string };
  if (!body.session_id) {
    return Response.json({ error: "session_id required" }, { status: 400 });
  }

  heartbeat(id, body.session_id, body.name || "Anonymous");

  const viewers = getPresence(id);
  return Response.json({ viewers, count: viewers.length });
}

/**
 * GET /api/d/:id/presence?key=TOKEN — Get who's online.
 */
export async function GET(
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

  const viewers = getPresence(id);
  return Response.json({ viewers, count: viewers.length });
}
