import type { APIRoute } from "astro";
import { getDB } from "../../../../../lib/db";
import { authorize } from "../../../../../lib/authorize";
import { heartbeat, getPresence } from "../../../../../lib/presence";
import { readJson, authorName } from "../../../../../lib/request";

export const prerender = false;

export const POST: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const resolved = await authorize(getDB(), request, id, "view");
  if (resolved instanceof Response) return resolved;

  const body = await readJson<{ session_id?: unknown; name?: unknown }>(request);
  if (body instanceof Response) return body;
  if (typeof body.session_id !== "string" || !body.session_id) {
    return Response.json({ error: "session_id required" }, { status: 400 });
  }

  heartbeat(id, body.session_id.slice(0, 64), authorName(body.name));

  const viewers = getPresence(id);
  return Response.json({ viewers, count: viewers.length });
};

export const GET: APIRoute = async ({ request, params }) => {
  const id = params.id!;
  const resolved = await authorize(getDB(), request, id, "view");
  if (resolved instanceof Response) return resolved;

  const viewers = getPresence(id);
  return Response.json({ viewers, count: viewers.length });
};
